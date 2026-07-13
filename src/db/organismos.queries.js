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

// Dato estático que solo cambia al re-sembrar el catálogo (mismo patrón de
// caché que el árbol de rubros / hijosPorCodigo en categorias-unspsc.queries.js).
let cacheMapaNombreCodigo = null;

/**
 * Mapa nombre -> codigo de TODO el catálogo de organismos_compradores.
 *
 * Se usa para traducir los organismos elegidos en una alerta (guardados como
 * nombre en alert_configs.organismos, porque el picker del formulario sigue
 * siendo por nombre — ver buscarOrganismos arriba) al codigo_organismo real
 * que trae cada licitación, para que matching.service.js pueda comparar por
 * CÓDIGO en vez de por nombre de texto (ver migración 031). El filtro que ve
 * el usuario no cambia — nombre; el match interno sí.
 *
 * Como los nombres en alert_configs.organismos vienen exactamente del picker
 * (autocompletado sobre esta misma tabla, no texto libre), no hace falta
 * normalizar acá — el cruce es por igualdad exacta.
 */
async function obtenerMapaNombreCodigo() {
  if (cacheMapaNombreCodigo) return cacheMapaNombreCodigo;

  const result = await pool.query('SELECT codigo, nombre FROM organismos_compradores');
  cacheMapaNombreCodigo = new Map(result.rows.map((r) => [r.nombre, r.codigo]));
  return cacheMapaNombreCodigo;
}

module.exports = { buscarOrganismos, obtenerMapaNombreCodigo };
