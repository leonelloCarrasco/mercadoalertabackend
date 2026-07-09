const pool = require('./pool');
const { obtenerTramo } = require('../utils/tramos-licitacion');

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
  const tramo = obtenerTramo(detalle.Tipo);

  await pool.query(
    `INSERT INTO licitaciones_vistas
       (codigo_externo, nombre, categoria, codigo_categoria, monto_estimado,
        region, nombre_organismo, fecha_publicacion, fecha_cierre,
        tipo_licitacion, monto_utm_min, monto_utm_max)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
    ]
  );
}

async function listarLicitacionesNuevas() {
  const result = await pool.query(
    `SELECT * FROM licitaciones_vistas ORDER BY primera_vez_vista DESC LIMIT 50`
  );
  return result.rows;
}

module.exports = {
  licitacionYaVista,
  obtenerCodigosYaVistos,
  guardarLicitacion,
  listarLicitacionesNuevas,
};
