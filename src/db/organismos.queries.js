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
 * El picker sigue siendo por NOMBRE (no cambia el frontend), pero lo que
 * finalmente se guarda en alert_configs.organismos es el CÓDIGO — ver
 * traducirOrganismosACodigos en alerts.routes.js y la migración 032.
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
 * Se usa en dos lugares:
 * - alerts.routes.js (traducirOrganismosACodigos): al guardar una alerta, para
 *   traducir los nombres que llegan del picker del formulario al código real
 *   que se guarda en alert_configs.organismos (ver migración 032).
 * - matching.service.js: para resolver el codigo_organismo de un proceso a
 *   partir del NOMBRE que reporta la API, en los casos donde no hay código
 *   directo disponible (Compra Ágil no lo expone) o como fallback si la API
 *   de Licitaciones no lo trajera en un caso puntual.
 *
 * Como los nombres que llegan en ambos casos vienen exactamente del picker o
 * de la API (no texto libre), no hace falta normalizar acá — el cruce es por
 * igualdad exacta.
 */
async function obtenerMapaNombreCodigo() {
  if (cacheMapaNombreCodigo) return cacheMapaNombreCodigo;

  const result = await pool.query('SELECT codigo, nombre FROM organismos_compradores');
  cacheMapaNombreCodigo = new Map(result.rows.map((r) => [r.nombre, r.codigo]));
  return cacheMapaNombreCodigo;
}

// Dato estático que solo cambia al re-sembrar el catálogo.
let cacheMapaCodigoNombre = null;

/**
 * Mapa codigo -> nombre de TODO el catálogo — el inverso de obtenerMapaNombreCodigo.
 *
 * Se usa para mostrarle al usuario el NOMBRE del organismo en las respuestas
 * de la API (listar/crear/actualizar alert_configs), aunque puertas adentro
 * ahora se guarde el CÓDIGO (ver migración 032) — el frontend no cambia,
 * sigue esperando nombres.
 */
async function obtenerMapaCodigoNombre() {
  if (cacheMapaCodigoNombre) return cacheMapaCodigoNombre;

  const result = await pool.query('SELECT codigo, nombre FROM organismos_compradores');
  cacheMapaCodigoNombre = new Map(result.rows.map((r) => [r.codigo, r.nombre]));
  return cacheMapaCodigoNombre;
}

module.exports = { buscarOrganismos, obtenerMapaNombreCodigo, obtenerMapaCodigoNombre };
