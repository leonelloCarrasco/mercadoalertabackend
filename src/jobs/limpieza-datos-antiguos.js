const { eliminarLicitacionesAntiguas } = require('../db/licitaciones.queries');
const { eliminarComprasAgilesAntiguas } = require('../db/compra-agil.queries');

const MESES_LICITACIONES = 6;
const MESES_COMPRA_AGIL = 3;

/**
 * Limpieza diaria de licitaciones/Compras Ágiles viejas — ver el detalle de
 * criterios (por qué 'Cerrada' queda afuera, el respaldo de fecha, y por
 * qué se salta lo que un usuario todavía tiene referenciado) en los
 * comentarios de eliminarLicitacionesAntiguas/eliminarComprasAgilesAntiguas
 * en licitaciones.queries.js / compra-agil.queries.js — las dos queries ya
 * hacen todo el trabajo pesado, esto solo las llama y loguea el resultado.
 *
 * El precio ya quedó a salvo en historico_precios antes de que esto corra
 * (se archiva en el momento de la resolución, ver revisar-resoluciones.js)
 * — este job no necesita preocuparse de eso, solo limpia el dato operativo.
 */
async function correrLimpiezaDatosAntiguos() {
  console.log('[limpieza-datos-antiguos] Iniciando...');

  try {
    const licitacionesBorradas = await eliminarLicitacionesAntiguas(MESES_LICITACIONES);
    console.log(`[limpieza-datos-antiguos] ${licitacionesBorradas} licitaciones borradas (Adjudicada/Desierta/Revocada, +${MESES_LICITACIONES} meses).`);
  } catch (err) {
    console.error('[limpieza-datos-antiguos] Error borrando licitaciones:', err.message);
  }

  try {
    const comprasAgilesBorradas = await eliminarComprasAgilesAntiguas(MESES_COMPRA_AGIL);
    console.log(`[limpieza-datos-antiguos] ${comprasAgilesBorradas} Compras Ágiles borradas (+${MESES_COMPRA_AGIL} meses, cualquier estado).`);
  } catch (err) {
    console.error('[limpieza-datos-antiguos] Error borrando Compras Ágiles:', err.message);
  }

  console.log('[limpieza-datos-antiguos] Terminado.');
}

module.exports = { correrLimpiezaDatosAntiguos };
