const pool = require('./pool');

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
  await pool.query(
    `INSERT INTO compras_agiles_vistas
       (codigo_externo, nombre, categoria, monto_estimado, region,
        rut_institucion, nombre_institucion, estado, fecha_publicacion, fecha_cierre, proveedores_cotizando)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (codigo_externo) DO NOTHING`,
    [
      item.codigo,
      item.nombre,
      null, // Compra Ágil no expone categoría en el listado; se puede completar leyendo productos_solicitados del detalle si se necesita
      item.montos?.monto_disponible_clp || null,
      item.institucion?.nombre_region || null,
      item.institucion?.rut || null,
      item.institucion?.organismo_comprador || null,
      item.estado?.codigo || null,
      item.fechas?.fecha_publicacion || null,
      item.fechas?.fecha_cierre || null,
      detalle ? JSON.stringify(detalle.proveedores_cotizando || []) : null,
    ]
  );
}

async function listarComprasAgilesNuevas() {
  const result = await pool.query(
    `SELECT * FROM compras_agiles_vistas ORDER BY primera_vez_vista DESC LIMIT 50`
  );
  return result.rows;
}

module.exports = {
  compraAgilYaVista,
  obtenerCodigosCompraAgilYaVistos,
  guardarCompraAgil,
  listarComprasAgilesNuevas,
};
