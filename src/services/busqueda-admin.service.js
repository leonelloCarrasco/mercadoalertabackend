const {
  obtenerLicitacionesActivas,
  obtenerLicitacionesPorFecha,
  obtenerDetalleLicitacion,
  obtenerDetallesConDelay,
} = require('./mercadopublico.service');
const { obtenerDetalleCompraAgil, listarCambiosRecientes, CuotaAgotadaError } = require('./compraagil.service');
const { obtenerCodigosYaVistos } = require('../db/licitaciones.queries');
const { obtenerCodigosCompraAgilYaVistos } = require('../db/compra-agil.queries');
const { algunCodigoCoincide } = require('./matching.service');
const { obtenerHijosPorCodigo } = require('../db/categorias-unspsc.queries');

// Traer el detalle de una licitación tarda ~3s c/u (mínimo exigido por la API
// de Mercado Público) — filtrar por producto/rubro obliga a traer el detalle
// de TODOS los candidatos del día para poder revisar sus ítems, así que se
// limita la cantidad para no dejar al admin esperando varios minutos.
const TOPE_DETALLE_POR_BUSQUEDA = 30;

function formatearResultadoLicitacion(detalle, yaVistos) {
  return {
    codigoExterno: detalle.CodigoExterno,
    nombre: detalle.Nombre,
    estado: detalle.Estado,
    fechaPublicacion: detalle.Fechas?.FechaPublicacion || null,
    fechaCierre: detalle.Fechas?.FechaCierre || null,
    organismo: detalle.Comprador?.NombreOrganismo || null,
    region: detalle.Comprador?.RegionUnidad || null,
    montoEstimado: detalle.MontoEstimado || null,
    tipo: detalle.Tipo || null,
    yaEnBD: yaVistos.has(detalle.CodigoExterno),
  };
}

/**
 * Busca licitaciones en vivo en Mercado Público (no en nuestra base de datos)
 * para el panel de administrador, cruzando contra licitaciones_vistas para
 * marcar cuáles ya están importadas.
 *
 * - codigo: búsqueda exacta (1 sola llamada, siempre trae detalle completo).
 * - fecha: día exacto en formato DDMMYYYY (la API de Mercado Público no acepta
 *   rangos). Si no se pasa fecha ni código, se listan las licitaciones activas.
 * - producto: código de categoría/producto/rubro (mismo picker que las alertas)
 *   — al usarse, obliga a traer el detalle de cada candidato del listado para
 *   poder revisar sus ítems (ver TOPE_DETALLE_POR_BUSQUEDA).
 */
async function buscarLicitaciones({ fecha, codigo, producto }) {
  if (codigo) {
    const detalle = await obtenerDetalleLicitacion(codigo);
    if (!detalle) return { resultados: [], truncado: false };
    const yaVistos = await obtenerCodigosYaVistos([detalle.CodigoExterno]);
    return { resultados: [formatearResultadoLicitacion(detalle, yaVistos)], truncado: false };
  }

  const listado = fecha ? await obtenerLicitacionesPorFecha(fecha) : await obtenerLicitacionesActivas();
  const codigosListado = listado.map((it) => it.CodigoExterno);
  const yaVistos = await obtenerCodigosYaVistos(codigosListado);

  if (!producto) {
    // Sin filtro de producto: resumen rápido, sin traer detalle (la lista de
    // un día o de "activas" puede tener cientos/miles de resultados).
    return {
      resultados: listado.map((it) => ({
        codigoExterno: it.CodigoExterno,
        nombre: it.Nombre,
        estado: it.CodigoEstado,
        fechaCierre: it.FechaCierre,
        yaEnBD: yaVistos.has(it.CodigoExterno),
        detalleParcial: true, // el admin puede seleccionarla igual; el detalle se trae recién al importar
      })),
      truncado: false,
    };
  }

  const truncado = codigosListado.length > TOPE_DETALLE_POR_BUSQUEDA;
  const candidatos = codigosListado.slice(0, TOPE_DETALLE_POR_BUSQUEDA);
  const detalles = await obtenerDetallesConDelay(candidatos);
  const hijosPorCodigo = await obtenerHijosPorCodigo();

  const filtrados = detalles.filter((d) => {
    const codigosDisponibles = (d.Items?.Listado || []).flatMap((it) => [
      it.CodigoProducto ? String(it.CodigoProducto) : null,
      it.CodigoCategoria ? String(it.CodigoCategoria) : null,
    ]).filter(Boolean);
    return algunCodigoCoincide(codigosDisponibles, [producto], hijosPorCodigo);
  });

  return { resultados: filtrados.map((d) => formatearResultadoLicitacion(d, yaVistos)), truncado };
}

/**
 * El endpoint de detalle por código (GET /v2/compra-agil/:codigo) es de un
 * solo recurso, así que asumimos que devuelve tanto los campos de resumen
 * (nombre, estado, fechas, institución, montos) como el detalle propiamente tal
 * (proveedores_cotizando, productos_solicitados) en un solo objeto — igual que
 * el resto de este archivo asume en buscarComprasAgiles. Si al probar contra la
 * API real se confirma una forma distinta (ej. campos anidados bajo otra
 * clave), este es el único lugar que hay que ajustar.
 */
function construirItemDesdeDetalleCompraAgil(codigo, detalle) {
  return {
    codigo,
    nombre: detalle.nombre || null,
    estado: detalle.estado || null,
    fechas: detalle.fechas || null,
    institucion: detalle.institucion || null,
    montos: detalle.montos || null,
  };
}

/**
 * Busca Compras Ágiles en vivo, para el panel de administrador.
 *
 * IMPORTANTE — limitación real de la API pública de Compra Ágil (v2, Beta):
 * a diferencia de Licitaciones, esta API no ofrece un parámetro de fecha
 * exacta ni de código de producto en el listado — solo "cambios recientes"
 * dentro de una ventana de tiempo (ttl_cambio_ms) y detalle exacto por código.
 * Acá "fecha" se traduce a una ventana de días hacia atrás desde hoy (aproximado,
 * no un día exacto como en Licitaciones). Si ChileCompra confirma parámetros
 * de búsqueda más precisos (fecha_publicacion, palabras_clave — mencionados en
 * el anuncio de la nueva API pero sin documentación técnica pública verificada
 * al momento de escribir esto), conviene reemplazar este enfoque por esos
 * parámetros directamente en compraagil.service.js.
 *
 * - codigo: búsqueda exacta por código.
 * - ventanaDias: se traduce a ttl_cambio_ms para listarCambiosRecientes.
 * - producto: mismo filtro que en licitaciones, requiere traer detalle de
 *   cada candidato (consume cuota diaria de la API — ver TOPE_DETALLE_POR_BUSQUEDA).
 */
async function buscarComprasAgiles({ ventanaDias, codigo, producto }) {
  if (codigo) {
    let detalle;
    try {
      detalle = await obtenerDetalleCompraAgil(codigo);
    } catch (err) {
      if (err instanceof CuotaAgotadaError) throw err;
      return { resultados: [], truncado: false };
    }
    if (!detalle) return { resultados: [], truncado: false };

    const yaVistos = await obtenerCodigosCompraAgilYaVistos([codigo]);
    return {
      resultados: [{
        codigo,
        nombre: detalle.nombre || null,
        estado: detalle.estado?.codigo || null,
        fechaPublicacion: detalle.fechas?.fecha_publicacion || null,
        fechaCierre: detalle.fechas?.fecha_cierre || null,
        organismo: detalle.institucion?.organismo_comprador || null,
        region: detalle.institucion?.nombre_region || null,
        montoDisponible: detalle.montos?.monto_disponible_clp || null,
        yaEnBD: yaVistos.has(codigo),
      }],
      truncado: false,
    };
  }
  // Solo se trae la primera página (hasta 100 resultados) — a diferencia del
  // polling automático (que sí recorre todas las páginas para no perderse
  // nada), acá es una búsqueda manual del admin: si hay más de 100 cambios en
  // la ventana elegida, conviene acotar la ventana en vez de traer miles.
  const ttlMs = (ventanaDias || 1) * 24 * 60 * 60 * 1000;
  let payload;
  try {
    payload = await listarCambiosRecientes(ttlMs, { tamanoPagina: 100 });
  } catch (err) {
    if (err instanceof CuotaAgotadaError) throw err;
    throw err;
  }
  const items = payload.items || [];

  const codigosListado = items.map((it) => it.codigo);
  const yaVistos = await obtenerCodigosCompraAgilYaVistos(codigosListado);

  if (!producto) {
    return {
      resultados: items.map((it) => ({
        codigo: it.codigo,
        nombre: it.nombre,
        estado: it.estado?.codigo || null,
        fechaCierre: it.fechas?.fecha_cierre || null,
        yaEnBD: yaVistos.has(it.codigo),
        detalleParcial: true,
      })),
      truncado: false,
    };
  }

  const truncado = codigosListado.length > TOPE_DETALLE_POR_BUSQUEDA;
  const candidatos = items.slice(0, TOPE_DETALLE_POR_BUSQUEDA);
  const hijosPorCodigo = await obtenerHijosPorCodigo();
  const resultados = [];

  for (const item of candidatos) {
    let detalle = null;
    try {
      detalle = await obtenerDetalleCompraAgil(item.codigo);
    } catch (err) {
      if (err instanceof CuotaAgotadaError) break; // se corta, se devuelve lo que se alcanzó a revisar
      continue;
    }

    const codigosDisponibles = (detalle.productos_solicitados || [])
      .map((p) => (p.codigo_producto ? String(p.codigo_producto) : null))
      .filter(Boolean);

    if (algunCodigoCoincide(codigosDisponibles, [producto], hijosPorCodigo)) {
      resultados.push({
        codigo: item.codigo,
        nombre: item.nombre,
        estado: item.estado?.codigo || null,
        fechaCierre: item.fechas?.fecha_cierre || null,
        organismo: item.institucion?.organismo_comprador || null,
        region: item.institucion?.nombre_region || null,
        montoDisponible: item.montos?.monto_disponible_clp || null,
        yaEnBD: yaVistos.has(item.codigo),
      });
    }
  }

  return { resultados, truncado };
}

module.exports = { buscarLicitaciones, buscarComprasAgiles, construirItemDesdeDetalleCompraAgil, TOPE_DETALLE_POR_BUSQUEDA };
