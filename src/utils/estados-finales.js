/**
 * Estados que consideramos CONFIRMADOS como finales — con datos reales de
 * adjudicación/resolución. Todo lo demás se sigue revisando por las dudas
 * (ver revisar-resoluciones.js para la explicación completa de por qué se
 * es conservador acá — el costo de tratar un estado como final antes de
 * tiempo es mucho más alto que el de revisar de más).
 *
 * Se usan en DOS momentos: al guardar por primera vez (por si algo ya llega
 * resuelto desde el principio) y en el job de revisión nocturno.
 */
const ESTADOS_FINALES_LICITACION = ['Adjudicada','Desierta','Revocada'];
const ESTADOS_FINALES_COMPRA_AGIL = ['proveedor_seleccionado','desierta','revocada'];

module.exports = { ESTADOS_FINALES_LICITACION, ESTADOS_FINALES_COMPRA_AGIL };
