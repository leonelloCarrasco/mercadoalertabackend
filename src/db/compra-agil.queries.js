const pool = require('./pool');
const { ESTADOS_FINALES_COMPRA_AGIL } = require('../utils/estados-finales');

async function compraAgilYaVista(codigoExterno) {
  const result = await pool.query(
    'SELECT 1 FROM compras_agiles_vistas WHERE codigo_externo = $1',
    [codigoExterno]
  );
  return result.rowCount > 0;
}

async function obtenerCodigosCompraAgilYaVistos(codigosExternos) {
  if (codigosExternos.length === 0) return new Set();

  const result = await pool.query(
    'SELECT codigo_externo FROM compras_agiles_vistas WHERE codigo_externo = ANY($1)',
    [codigosExternos]
  );
  return new Set(result.rows.map((r) => r.codigo_externo));
}

/**
 * Guarda una Compra Ágil a partir del item de listado (resumen) y,
 * opcionalmente, su detalle completo (si ya se consultó, para incluir proveedores_cotizando).
 */
async function guardarCompraAgil(item, detalle = null) {
  // Por si el polling la descubre por primera vez cuando YA está en un estado
  // final (proceso resuelto muy rápido, nunca la vimos "publicada"). OJO: no
  // basta con que el estado ya sea final — si el detalle vino incompleto en
  // ese instante (ej. proveedores_cotizando vacío por un tema puntual de la
  // API), es mejor dejarla como NO resuelta, para que el job de revisión
  // diario la vuelva a intentar más tarde. Si se marca resuelta=true con datos
  // incompletos, queda atascada así para siempre (el job de revisión solo
  // mira registros con resuelta=false).
  const tieneDatosCompletos = (detalle?.proveedores_cotizando?.length || 0) > 0;
  const resueltaDesdeElInicio = ESTADOS_FINALES_COMPRA_AGIL.includes(item.estado?.codigo) && tieneDatosCompletos;

  await pool.query(
    `INSERT INTO compras_agiles_vistas
       (codigo_externo, nombre, categoria, monto_estimado, region,
        rut_institucion, nombre_institucion, estado, fecha_publicacion, fecha_cierre,
        proveedores_cotizando, productos_solicitados, resuelta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (codigo_externo) DO NOTHING`,
    [
      item.codigo,
      item.nombre,
      null, // Campo original sin uso real — el detalle de categorías ahora vive en productos_solicitados
      item.montos?.monto_disponible_clp || null,
      item.institucion?.nombre_region || null,
      item.institucion?.rut || null,
      item.institucion?.organismo_comprador || null,
      item.estado?.codigo || null,
      item.fechas?.fecha_publicacion || null,
      item.fechas?.fecha_cierre || null,
      detalle ? JSON.stringify(detalle.proveedores_cotizando || []) : null,
      detalle ? JSON.stringify(detalle.productos_solicitados || []) : null,
      resueltaDesdeElInicio,
    ]
  );
}

async function listarComprasAgilesNuevas() {
  const result = await pool.query(
    `SELECT * FROM compras_agiles_vistas ORDER BY primera_vez_vista DESC LIMIT 50`
  );
  return result.rows;
}

/**
 * Compras Ágiles guardadas ANTES de que empezáramos a guardar productos_solicitados
 * (migración 015) — solo las que siguen "publicada", ya que las cerradas/canceladas
 * nunca más van a generar una alerta, y no vale la pena gastar cuota de la API en ellas.
 */
async function listarCompraAgilSinProductos() {
  const result = await pool.query(
    `SELECT codigo_externo FROM compras_agiles_vistas
     WHERE productos_solicitados IS NULL
     ORDER BY primera_vez_vista DESC`
  );
  return result.rows.map((r) => r.codigo_externo);
}

async function actualizarProductosSolicitados(codigoExterno, productosSolicitados) {
  await pool.query(
    'UPDATE compras_agiles_vistas SET productos_solicitados = $1 WHERE codigo_externo = $2',
    [JSON.stringify(productosSolicitados), codigoExterno]
  );
}

/**
 * Compras Ágiles cerradas que seguían "publicada" la última vez que las vimos —
 * candidatas a revisar. Igual que licitaciones, se limita a los últimos 90 días.
 *
 * OJO: el filtro es solo `resuelta = false`, sin importar qué diga `estado`
 * ahora mismo — si en algún momento se guardó un estado intermedio desconocido
 * (ni "publicada" ni "proveedor_seleccionado"), igual tiene que seguir
 * apareciendo acá para revisarse de nuevo. Filtrar por `estado = 'publicada'`
 * dejaría esos casos invisibles para siempre (bug real que tuvimos y corregimos).
 */
async function listarCompraAgilPendienteDeResolucion() {
  const result = await pool.query(
    `SELECT codigo_externo FROM compras_agiles_vistas
     WHERE resuelta = false
       AND fecha_cierre IS NOT NULL
       AND fecha_cierre < NOW()
       AND fecha_cierre > NOW() - INTERVAL '90 days'
     ORDER BY fecha_cierre ASC`
  );
  return result.rows.map((r) => r.codigo_externo);
}

async function actualizarResolucionCompraAgil(codigoExterno, {
  estado, idOrdenCompra, proveedoresCotizando, productosSolicitados, resuelta,
}) {
  await pool.query(
    `UPDATE compras_agiles_vistas
     SET estado = $1, id_orden_compra = $2, proveedores_cotizando = $3,
         productos_solicitados = COALESCE(NULLIF($4::jsonb, '[]'::jsonb), productos_solicitados),
         resuelta = $5, fecha_ultima_revision = NOW()
     WHERE codigo_externo = $6`,
    [estado, idOrdenCompra, JSON.stringify(proveedoresCotizando || []), JSON.stringify(productosSolicitados || []), resuelta, codigoExterno]
  );
}

/**
 * Compras Ágiles marcadas resuelta=true pero con proveedores_cotizando en
 * NULL — quedaron atascadas por un detalle incompleto al momento de marcarse
 * como resueltas (ver guardarCompraAgil). Como el job de revisión diario solo
 * mira resuelta=false, estas nunca se autoreparan solas.
 */
async function listarCompraAgilResueltaSinProveedores() {
  const result = await pool.query(
    `SELECT codigo_externo FROM compras_agiles_vistas
     WHERE resuelta = true AND proveedores_cotizando IS NULL
     ORDER BY primera_vez_vista DESC`
  );
  return result.rows.map((r) => r.codigo_externo);
}

module.exports = {
  compraAgilYaVista,
  obtenerCodigosCompraAgilYaVistos,
  guardarCompraAgil,
  listarComprasAgilesNuevas,
  listarCompraAgilSinProductos,
  actualizarProductosSolicitados,
  listarCompraAgilPendienteDeResolucion,
  actualizarResolucionCompraAgil,
  listarCompraAgilResueltaSinProveedores,
};
