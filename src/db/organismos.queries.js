const pool = require('./pool');

/**
 * Busca organismos compradores por texto, entre los que ya aparecen en datos
 * reales (licitaciones_vistas.nombre_organismo + compras_agiles_vistas.nombre_institucion),
 * igual criterio que listarRegionesDisponibles en regiones.queries.js: se usa
 * el texto tal como lo entrega Mercado Público (no una lista propia), porque el
 * matching de alertas compara el string exacto — es la única fuente confiable.
 *
 * Devuelve como máximo 20 resultados, para el picker con autocompletado del
 * formulario de alertas (selección exacta, no texto libre).
 */
async function buscarOrganismos(texto) {
  const result = await pool.query(
    `SELECT DISTINCT TRIM(organismo) AS organismo
     FROM (
       SELECT nombre_organismo AS organismo FROM licitaciones_vistas WHERE nombre_organismo IS NOT NULL
       UNION
       SELECT nombre_institucion AS organismo FROM compras_agiles_vistas WHERE nombre_institucion IS NOT NULL
     ) AS todos_los_organismos
     WHERE TRIM(organismo) != '' AND organismo ILIKE '%' || $1 || '%'
     ORDER BY organismo
     LIMIT 20`,
    [texto]
  );
  return result.rows.map((r) => r.organismo);
}

module.exports = { buscarOrganismos };
