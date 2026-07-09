const pool = require('./pool');

/**
 * Trae la lista de regiones reales que existen en los datos ya guardados
 * (licitaciones + Compras Ágiles), sin duplicados y ordenadas alfabéticamente.
 *
 * Se usa esto en vez de una lista hardcodeada de las 16 regiones de Chile porque
 * el texto exacto que devuelve Mercado Público no siempre coincide con la forma
 * "oficial" de escribir el nombre (ej. tildes distintas, "de" vs "del", sufijos
 * como "Chilena" presentes o ausentes según el proceso). El matching de alertas
 * compara el string exacto, así que la única fuente confiable es lo que la propia
 * API ya nos entregó — no lo que alguien tipeó a mano.
 */
async function listarRegionesDisponibles() {
  const result = await pool.query(`
    SELECT DISTINCT TRIM(region) AS region
    FROM (
      SELECT region FROM licitaciones_vistas WHERE region IS NOT NULL AND TRIM(region) != ''
      UNION
      SELECT region FROM compras_agiles_vistas WHERE region IS NOT NULL AND TRIM(region) != ''
    ) AS todas_las_regiones
    ORDER BY region
  `);
  return result.rows.map((r) => r.region);
}

module.exports = { listarRegionesDisponibles };
