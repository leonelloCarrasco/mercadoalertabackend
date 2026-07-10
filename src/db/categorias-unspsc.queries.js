const pool = require('./pool');

/**
 * Busca categorías por texto (título o código), para el buscador de la
 * alerta. Usa pg_trgm (ver migración 014) para que la búsqueda por substring
 * sea rápida incluso sobre las ~10.700 filas de la tabla.
 */
async function buscarCategorias(texto, limite = 20) {
  const result = await pool.query(
    `SELECT codigo, titulo, nivel FROM categorias_unspsc
     WHERE titulo ILIKE '%' || $1 || '%' OR codigo ILIKE $1 || '%'
     ORDER BY nivel, titulo
     LIMIT $2`,
    [texto, limite]
  );
  return result.rows;
}

/**
 * Resuelve una lista de códigos a sus títulos — se usa para mostrar la
 * descripción de las categorías ya seleccionadas en una alerta, en vez de
 * solo el código.
 */
async function obtenerTitulosPorCodigos(codigos) {
  if (!codigos || codigos.length === 0) return [];
  const result = await pool.query(
    'SELECT codigo, titulo, nivel FROM categorias_unspsc WHERE codigo = ANY($1)',
    [codigos]
  );
  return result.rows;
}

module.exports = { buscarCategorias, obtenerTitulosPorCodigos };
