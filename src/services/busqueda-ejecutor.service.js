const {
  obtenerDetalleLicitacion,
  buscarLicitacionesConParametros,
  buscarProveedorPorRut,
} = require('./mercadopublico.service');
const { listarTodosLosCambiosRecientes } = require('./compraagil.service');
const { obtenerMapaNombreCodigo } = require('../db/organismos.queries');
const { traducirEstadoLicitacion } = require('../utils/estados-licitacion');

const LIMITE_RESULTADOS = 300;
const TTL_COMPRA_AGIL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días — búsqueda exploratoria, no polling

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
 */
async function ejecutarBusqueda(busqueda) {

  console.log('[busqueda] Ejecutando tipo búsqueda: ', busqueda.tipo);
  if (busqueda.tipo === 'licitacion') {
    return { tipo: 'licitacion', modo: busqueda.modo, resultados: await buscarLicitaciones(busqueda) };
  }
  return { tipo: 'compra_agil', resultados: await buscarComprasAgiles(busqueda) };
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
 * Compra Ágil: el listado de cambios recientes SÍ trae monto, región y
 * organismo por item (sin necesitar detalle), así que esos tres se filtran
 * en memoria sin costo extra. El rubro/producto NO (requeriría el detalle de
 * cada proceso candidato), así que no se ofrece para este tipo.
 */
async function buscarComprasAgiles({ regiones, monto_minimo, monto_maximo, organismos }) {
  // La API solo acepta UNA región por consulta — si hay más de una elegida,
  // se trae sin filtrar por región (se filtran todas en memoria más abajo).
  const regionParaApi = regiones && regiones.length === 1 ? regiones[0] : undefined;

  const items = await listarTodosLosCambiosRecientes(TTL_COMPRA_AGIL_MS, { estado: 'publicada', region: regionParaApi });
  const mapaNombreCodigo = organismos && organismos.length > 0 ? await obtenerMapaNombreCodigo() : null;

  return items
    .filter((item) => {
      const monto = item.montos?.monto_disponible_clp || 0;
      if (monto_minimo && monto < monto_minimo) return false;
      if (monto_maximo && monto > monto_maximo) return false;

      const region = item.institucion?.nombre_region || null;
      if (regiones && regiones.length > 0 && region && !regiones.includes(region.trim())) return false;

      if (organismos && organismos.length > 0) {
        const organismo = item.institucion?.organismo_comprador || null;
        const codigo = organismo ? mapaNombreCodigo.get(organismo.trim()) : null;
        if (!codigo || !organismos.includes(codigo)) return false;
      }
      return true;
    })
    .slice(0, LIMITE_RESULTADOS)
    .map((item) => ({
      codigo_externo: item.codigo,
      nombre: item.nombre,
      monto_estimado: item.montos?.monto_disponible_clp || null,
      region: item.institucion?.nombre_region || null,
      organismo: item.institucion?.organismo_comprador || null,
      fecha_publicacion: item.fechas?.fecha_publicacion || null,
      fecha_cierre: item.fechas?.fecha_cierre || null,
    }));
}

module.exports = { ejecutarBusqueda };
