const pool = require('./pool');
const { obtenerTramo } = require('../utils/tramos-licitacion');
const { ESTADOS_FINALES_LICITACION } = require('../utils/estados-finales');

async function licitacionYaVista(codigoExterno) {
  const result = await pool.query(
    'SELECT 1 FROM licitaciones_vistas WHERE codigo_externo = $1',
    [codigoExterno]
  );
  return result.rowCount > 0;
}

/**
 * Verifica en una sola consulta cuáles de los códigos dados ya están guardados.
 * Mucho más rápido que consultar de a uno cuando hay miles de licitaciones activas.
 */
async function obtenerCodigosYaVistos(codigosExternos) {
  if (codigosExternos.length === 0) return new Set();

  const result = await pool.query(
    'SELECT codigo_externo FROM licitaciones_vistas WHERE codigo_externo = ANY($1)',
    [codigosExternos]
  );
  return new Set(result.rows.map((r) => r.codigo_externo));
}

async function guardarLicitacion(detalle) {
  const item = detalle.Items?.Listado?.[0];
  const todosLosItems = detalle.Items?.Listado || [];
  const tramo = obtenerTramo(detalle.Tipo);

  // Se guardan TODOS los ítems (una licitación puede tener varios productos de
  // categorías distintas — el campo categoria/codigo_categoria de arriba se
  // mantiene solo por compatibilidad con lo ya guardado, pero el matching real
  // usa este arreglo completo, no solo el primer ítem. También se incluye la
  // adjudicación por ítem por si esta licitación ya llega resuelta desde la
  // primera vez que la vemos (poco común, pero puede pasar).
  const itemsParaGuardar = todosLosItems.map((it) => ({
    codigo_producto: it.CodigoProducto || null,
    codigo_categoria: it.CodigoCategoria || null,
    categoria: it.Categoria || null,
    nombre_producto: it.NombreProducto || null,
    adjudicacion: it.Adjudicacion
      ? {
          rut_proveedor: it.Adjudicacion.RutProveedor || null,
          nombre_proveedor: it.Adjudicacion.NombreProveedor || null,
          cantidad: it.Adjudicacion.Cantidad || null,
          monto_unitario: it.Adjudicacion.MontoUnitario || null,
        }
      : null,
  }));

  // Por si el polling la descubre por primera vez cuando YA está en un estado
  // final (poco común — normalmente solo se capturan licitaciones "Publicada" —
  // pero así queda cubierto el caso igual, sin quedar erróneamente pendiente).
  const resueltaDesdeElInicio = ESTADOS_FINALES_LICITACION.includes(detalle.Estado);

  await pool.query(
    `INSERT INTO licitaciones_vistas
       (codigo_externo, nombre, categoria, codigo_categoria, monto_estimado,
        region, nombre_organismo, fecha_publicacion, fecha_cierre,
        tipo_licitacion, monto_utm_min, monto_utm_max, items, estado,
        fecha_adjudicacion, numero_oferentes, url_acta, resuelta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (codigo_externo) DO NOTHING`,
    [
      detalle.CodigoExterno,
      detalle.Nombre,
      item?.Categoria || null,
      item?.CodigoCategoria || null,
      detalle.MontoEstimado || null,
      detalle.Comprador?.RegionUnidad || null,
      detalle.Comprador?.NombreOrganismo || null,
      detalle.Fechas?.FechaPublicacion || null,
      detalle.Fechas?.FechaCierre || null,
      detalle.Tipo || null,
      tramo?.utmMinGarantizado || null,
      tramo?.utmMax || null,
      JSON.stringify(itemsParaGuardar),
      detalle.Estado || null,
      detalle.Adjudicacion?.Fecha || detalle.Fechas?.FechaAdjudicacion || null,
      detalle.Adjudicacion?.NumeroOferentes || null,
      detalle.Adjudicacion?.UrlActa || null,
      resueltaDesdeElInicio,
    ]
  );
}

async function listarLicitacionesNuevas() {
  const result = await pool.query(
    `SELECT * FROM licitaciones_vistas ORDER BY primera_vez_vista DESC LIMIT 50`
  );
  return result.rows;
}

/**
 * Licitaciones guardadas ANTES de que empezáramos a guardar todos los ítems
 * (migración 016) — solo las que aún no cierran, ya que una vez pasada la
 * fecha de cierre el matching las descarta igual (ver matching.service.js),
 * así que no vale la pena gastar llamadas (con su delay de 3s) en esas.
 */
async function listarLicitacionesSinItems() {
  const result = await pool.query(
    `SELECT codigo_externo FROM licitaciones_vistas
     WHERE items IS NULL AND (fecha_cierre IS NULL OR fecha_cierre > NOW())
     ORDER BY fecha_cierre ASC NULLS LAST`
  );
  return result.rows.map((r) => r.codigo_externo);
}

async function actualizarItemsLicitacion(codigoExterno, items) {
  await pool.query(
    'UPDATE licitaciones_vistas SET items = $1 WHERE codigo_externo = $2',
    [JSON.stringify(items), codigoExterno]
  );
}

/**
 * Licitaciones cerradas que todavía no sabemos si se adjudicaron — candidatas
 * a revisar. Se limita a los últimos 90 días desde el cierre: pasado ese plazo,
 * dejamos de insistir (algunas licitaciones simplemente nunca publican resultado).
 */
async function listarLicitacionesPendientesDeResolucion() {
  const result = await pool.query(
    `SELECT codigo_externo FROM licitaciones_vistas
     WHERE resuelta = false
       AND fecha_cierre IS NOT NULL
       AND fecha_cierre < NOW()
       AND fecha_cierre > NOW() - INTERVAL '90 days'
     ORDER BY fecha_cierre ASC`
  );
  return result.rows.map((r) => r.codigo_externo);
}

/**
 * Guarda el resultado de una revisión de adjudicación. `resuelta=true` cuando
 * el Estado es uno de los que consideramos "final" (ver ESTADOS_FINALES en el
 * job) — de ahí en adelante no se vuelve a revisar esa licitación.
 */
async function actualizarResolucionLicitacion(codigoExterno, {
  items, estado, fechaAdjudicacion, numeroOferentes, urlActa, resuelta,
}) {
  await pool.query(
    `UPDATE licitaciones_vistas
     SET items = $1, estado = $2, fecha_adjudicacion = $3, numero_oferentes = $4,
         url_acta = $5, resuelta = $6, fecha_ultima_revision = NOW()
     WHERE codigo_externo = $7`,
    [JSON.stringify(items), estado, fechaAdjudicacion, numeroOferentes, urlActa, resuelta, codigoExterno]
  );
}

module.exports = {
  licitacionYaVista,
  obtenerCodigosYaVistos,
  guardarLicitacion,
  listarLicitacionesNuevas,
  listarLicitacionesSinItems,
  actualizarItemsLicitacion,
  listarLicitacionesPendientesDeResolucion,
  actualizarResolucionLicitacion,
};
