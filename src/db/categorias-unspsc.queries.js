const pool = require('./pool');

/**
 * Busca categorías/rubros y productos por texto (título o código), para el
 * buscador de la alerta en modo "Producto". Usa pg_trgm (ver migración 014)
 * para que la búsqueda por substring sea rápida incluso sobre las ~20.000 filas
 * de la tabla.
 *
 * `nivel` es opcional: si se pasa ('categoria' o 'producto'), filtra solo ese
 * nivel — se usa para no mezclar rubros con productos en el modo "Producto"
 * del buscador (el modo "Rubro" usa el árbol, ver obtenerArbolRubros).
 */
async function buscarCategorias(texto, { nivel, limite = 20 } = {}) {
  const params = [texto];
  let filtroNivel = '';
  if (nivel) {
    params.push(nivel);
    filtroNivel = `AND nivel = $${params.length}`;
  }
  params.push(limite);

  const result = await pool.query(
    `SELECT codigo, titulo, nivel FROM categorias_unspsc
     WHERE (titulo ILIKE '%' || $1 || '%' OR codigo ILIKE $1 || '%') ${filtroNivel}
     ORDER BY nivel, titulo
     LIMIT $${params.length}`,
    params
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

// El árbol completo (segmento -> familia -> rubros) es un dato estático que
// solo cambia cuando se corre de nuevo el seed (ver scripts/seed-categorias-unspsc.js),
// así que se cachea en memoria del proceso — evita repetir ~2.000 filas de
// query en cada apertura del buscador de alertas. Mismo patrón que
// utm.service.js, salvo que acá no hay TTL: si se re-siembra la tabla, hay
// que reiniciar el proceso del backend para que el árbol se actualice.
let cacheArbol = null;

/**
 * Arma el árbol Segmento -> Familia -> Rubro (nivel 3, seleccionable) para el
 * modo "Rubro" del buscador de alertas. Solo incluye categorías con nivel1/nivel2
 * (los rubros de "obra", migración 022, quedan afuera — no tienen jerarquía real).
 */
async function obtenerArbolRubros() {
  if (cacheArbol) return cacheArbol;

  const result = await pool.query(
    `SELECT codigo, titulo, nivel1, nivel2 FROM categorias_unspsc
     WHERE nivel = 'categoria' AND nivel1 IS NOT NULL AND nivel2 IS NOT NULL
     ORDER BY nivel1, nivel2, titulo`
  );

  const segmentos = new Map(); // nivel1 -> Map(nivel2 -> [{codigo,titulo}])
  for (const row of result.rows) {
    if (!segmentos.has(row.nivel1)) segmentos.set(row.nivel1, new Map());
    const familias = segmentos.get(row.nivel1);
    if (!familias.has(row.nivel2)) familias.set(row.nivel2, []);
    familias.get(row.nivel2).push({ codigo: row.codigo, titulo: row.titulo });
  }

  cacheArbol = [...segmentos.entries()].map(([segmento, familias]) => ({
    segmento,
    familias: [...familias.entries()].map(([familia, rubros]) => ({ familia, rubros })),
  }));

  return cacheArbol;
}

// Igual patrón de caché que el árbol de rubros: dato estático que solo cambia
// al re-sembrar la tabla.
let cacheHijos = null;

/**
 * Mapa código -> lista de códigos hoja descendientes, SOLO para los códigos
 * de 9 dígitos (sección Obras/Consultoría) que agrupan otros códigos — ver
 * migración 026. Lo usa matching.service.js para que seleccionar un rubro de
 * esa sección matchee también a sus códigos específicos hijos, no solo al
 * código exacto del grupo (a diferencia de UNSPSC de 8 dígitos, acá no hay
 * ninguna convención de prefijo que permita inferir esto del número mismo).
 */
async function obtenerHijosPorCodigo() {
  if (cacheHijos) return cacheHijos;

  const result = await pool.query(
    `SELECT codigo, hijos FROM categorias_unspsc WHERE hijos IS NOT NULL AND array_length(hijos, 1) > 0`
  );

  cacheHijos = new Map(result.rows.map((r) => [r.codigo, r.hijos]));
  return cacheHijos;
}

module.exports = { buscarCategorias, obtenerTitulosPorCodigos, obtenerArbolRubros, obtenerHijosPorCodigo };
