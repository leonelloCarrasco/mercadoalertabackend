const {
  obtenerDetalleLicitacion,
  buscarLicitacionesConParametros,
  buscarProveedorPorRut,
} = require('./mercadopublico.service');
const {
  obtenerDetalleCompraAgil,
  buscarComprasAgiles: buscarComprasAgilesEnApi,
} = require('./compraagil.service');
const { traducirEstadoLicitacion } = require('../utils/estados-licitacion');
const { obtenerCodigoRegion } = require('../utils/regiones-compra-agil');

const LIMITE_RESULTADOS = 300;
const TAMANO_PAGINA_COMPRA_AGIL = 10; // misma cantidad que ya usaba el polling (Grupo 1)

function formatearFechaDDMMYYYY(fecha) {
  const d = String(fecha.getDate()).padStart(2, '0');
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const y = fecha.getFullYear();
  return `${d}${m}${y}`;
}

// Postgres devuelve DATE como objeto Date en hora UTC medianoche — para no
// correr el riesgo de que se corra un día hacia atrás/adelante según el huso
// horario del proceso Node, se arma la fecha a mano desde sus componentes UTC.
function fechaGuardadaADDMMYYYY(fechaColumna) {
  const d = String(fechaColumna.getUTCDate()).padStart(2, '0');
  const m = String(fechaColumna.getUTCMonth() + 1).padStart(2, '0');
  const y = fechaColumna.getUTCFullYear();
  return `${d}${m}${y}`;
}

function obtenerFechaParaConsulta(fechaGuardada) {
  return fechaGuardada ? fechaGuardadaADDMMYYYY(new Date(fechaGuardada)) : formatearFechaDDMMYYYY(new Date());
}

/**
 * Ejecuta una búsqueda guardada DIRECTO contra las APIs en vivo de Mercado
 * Público — no hay base local de por medio. Cada búsqueda guardada es de UN
 * solo tipo (licitacion o compra_agil, ver busquedas.routes.js), porque los
 * filtros que cada API realmente soporta son muy distintos entre sí.
 *
 * `numeroPagina` solo aplica a Compra Ágil en modo 'listado' — es la única de
 * las dos APIs que pagina de verdad (ver POST /api/busquedas/:id/ejecutar).
 */
async function ejecutarBusqueda(busqueda, { numeroPagina } = {}) {
  console.log('[busqueda] Ejecutando tipo búsqueda: ', busqueda.tipo);
  if (busqueda.tipo === 'licitacion') {
    return { tipo: 'licitacion', modo: busqueda.modo, resultados: await buscarLicitaciones(busqueda) };
  }
  return { tipo: 'compra_agil', modo: busqueda.modo, ...(await buscarComprasAgiles(busqueda, numeroPagina || 1)) };
}

/**
 * Licitaciones: 4 modos excluyentes entre sí, calcados de las 4
 * combinaciones que realmente documenta la API (ver migración 033).
 */
async function buscarLicitaciones(busqueda) {
  let listado = [];

  if (busqueda.modo === 'codigo') {
    // Búsqueda por código: siempre trae el DETALLE completo (no el resumen),
    // y la fecha es irrelevante — la propia API lo documenta así.
    const detalle = await obtenerDetalleLicitacion(busqueda.codigo_externo);
    listado = detalle ? [{
      CodigoExterno: detalle.CodigoExterno,
      Nombre: detalle.Nombre,
      CodigoEstado: detalle.CodigoEstado,
      Estado: detalle.Estado, // el detalle SÍ trae el texto directo, no hace falta traducir
      FechaCierre: detalle.Fechas?.FechaCierre || detalle.FechaCierre,
    }] : [];
  } else if (busqueda.modo === 'estado_fecha') {
    const fecha = obtenerFechaParaConsulta(busqueda.fecha);
    const estado = busqueda.estado || 'todos';
    listado = await buscarLicitacionesConParametros({ fecha, estado });
  } else if (busqueda.modo === 'proveedor') {
    const fecha = obtenerFechaParaConsulta(busqueda.fecha);
    const proveedor = await buscarProveedorPorRut(busqueda.rut_proveedor);
    if (!proveedor) {
      return []; // RUT no encontrado como proveedor registrado — sin resultados, no es un error
    }
    listado = await buscarLicitacionesConParametros({ fecha, CodigoProveedor: proveedor.codigo });
  } else if (busqueda.modo === 'organismo') {
    const fecha = obtenerFechaParaConsulta(busqueda.fecha);
    const codigoOrganismo = busqueda.organismos && busqueda.organismos[0];
    if (!codigoOrganismo) return [];
    listado = await buscarLicitacionesConParametros({ fecha, CodigoOrganismo: codigoOrganismo });
  }

  return listado.slice(0, LIMITE_RESULTADOS).map((l) => ({
    codigo_externo: l.CodigoExterno,
    nombre: l.Nombre,
    // El resumen (fecha/estado/organismo/proveedor) solo trae CodigoEstado —
    // el detalle (modo 'codigo') ya trae "Estado" como texto directo.
    estado: l.Estado || traducirEstadoLicitacion(l.CodigoEstado) || 'Desconocido',
    fecha_cierre: l.FechaCierre,
  }));
}

/**
 * Compra Ágil: DOS modos (a diferencia de Licitaciones, acá la API v2 SÍ deja
 * combinar libremente texto libre / región / estado(s) / "recientes" entre
 * sí — no son combinaciones rígidas, así que no hace falta un modo por cada
 * combinación documentada).
 *
 *   'codigo'  -> detalle completo por código (GET /v2/compra-agil/{codigo}),
 *                ignora cualquier otro filtro.
 *   'listado' -> texto_libre (q) + regiones (traducido a código numérico
 *                INE, la API no acepta el nombre) + estados (uno o más) +
 *                horas_recientes (ttl_cambio_ms) — todos opcionales y
 *                combinables. Pagina de a TAMANO_PAGINA_COMPRA_AGIL por vez;
 *                el frontend pide la página siguiente recién cuando el
 *                usuario efectivamente avanza el paginador (ver dashboard.js).
 */
async function buscarComprasAgiles(busqueda, numeroPagina) {
  if (busqueda.modo === 'codigo') {
    const detalle = await obtenerDetalleCompraAgil(busqueda.codigo_externo);
    const resultados = detalle ? [mapearItemCompraAgil(detalle)] : [];
    return { resultados, paginacion: { numero_pagina: 1, total_paginas: 1, total_resultados: resultados.length } };
  }

  const codigoRegion = (busqueda.regiones && busqueda.regiones.length > 0)
    ? obtenerCodigoRegion(busqueda.regiones[0])
    : null;

  const payload = await buscarComprasAgilesEnApi({
    texto: busqueda.texto_libre || undefined,
    codigoRegion: codigoRegion || undefined,
    estados: busqueda.estados || undefined,
    horasRecientes: busqueda.horas_recientes || undefined,
    numeroPagina,
    tamanoPagina: TAMANO_PAGINA_COMPRA_AGIL,
  });

  return {
    resultados: (payload.items || []).slice(0, LIMITE_RESULTADOS).map(mapearItemCompraAgil),
    paginacion: {
      numero_pagina: payload.paginacion.numero_pagina,
      total_paginas: payload.paginacion.total_paginas,
      total_resultados: payload.paginacion.total_resultados,
    },
  };
}

function mapearItemCompraAgil(item) {
  return {
    codigo_externo: item.codigo,
    nombre: item.nombre,
    // La API entrega directo la glosa (texto legible del estado) — a
    // diferencia de Licitaciones, acá no hace falta traducir ningún código.
    estado: item.estado?.glosa || item.estado?.codigo || 'Desconocido',
    fecha_cierre: item.fechas?.fecha_cierre || null,
  };
}

module.exports = { ejecutarBusqueda };
