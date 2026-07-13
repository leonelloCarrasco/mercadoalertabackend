const pool = require('./pool');

/**
 * Busca organismos compradores por texto, sobre el catálogo propio poblado
 * desde el listado oficial de ChileCompra (migración 030 + seed-organismos-compradores.js)
 * — ya NO se deriva de licitaciones_vistas/compras_agiles_vistas, así que el
 * buscador ofrece TODO el universo de organismos registrados, no solo los que
 * ya vimos en algún proceso importado.
 *
 * Devuelve como máximo 20 resultados, para el picker con autocompletado del
 * formulario de alertas (selección exacta, no texto libre).
 *
 * OJO — el matching de alertas (matching.service.js) sigue comparando por
 * NOMBRE exacto contra lo que reporta cada licitación/Compra Ágil (no por
 * `codigo`, que es el CodigoOrganismo oficial de Mercado Público) — ver la
 * nota en la migración 030 sobre por qué, y la mejora pendiente de guardar
 * ese código en licitaciones_vistas para matchear por código en vez de texto.
 */
async function buscarOrganismos(texto) {
  const result = await pool.query(
    `SELECT nombre FROM organismos_compradores
     WHERE nombre ILIKE '%' || $1 || '%'
     ORDER BY nombre
     LIMIT 20`,
    [texto]
  );
  return result.rows.map((r) => r.nombre);
}

module.exports = { buscarOrganismos };
