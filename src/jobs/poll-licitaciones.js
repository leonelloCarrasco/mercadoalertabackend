const { obtenerLicitacionesActivas, obtenerDetalleLicitacion } = require('../services/mercadopublico.service');
const { obtenerCodigosYaVistos, guardarLicitacion } = require('../db/licitaciones.queries');
const { procesarAlertasLicitaciones } = require('../services/alerting.service');

// Mismo delay que ya usa mercadopublico.service.js internamente (3s mínimo
// confirmado + margen) — acá se necesita el propio porque se llama
// obtenerDetalleLicitacion() directo (una por una), no el helper
// obtenerDetallesConDelay() que ya trae su propio delay incorporado pero
// junta TODO en un array antes de devolver nada (ver el motivo del cambio
// más abajo).
const DELAY_ENTRE_LLAMADAS_MS = 3100;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Corre una pasada de detección de licitaciones nuevas:
 * 1. Trae el listado resumido de licitaciones activas.
 * 2. Filtra las que ya conocemos (por CodigoExterno).
 * 3. Para cada nueva: trae el detalle y lo guarda AL TOQUE, antes de pasar
 *    a la siguiente — no junta todos los detalles en memoria primero y
 *    guarda al final. Con el delay de 3s entre llamadas, procesar un lote
 *    grande puede tardar varios minutos — si el proceso se cae a mitad de
 *    camino (redeploy, crash, lo que sea) con el patrón viejo se perdía
 *    TODO lo ya traído pero no guardado; con este patrón, lo que ya se
 *    guardó queda guardado, y la próxima corrida retoma nomás desde ahí
 *    (obtenerCodigosYaVistos ya filtra lo que quedó a medio camino). Mismo
 *    criterio que ya usa poll-compra-agil.js.
 *
 * Devuelve el array de detalles de licitaciones nuevas (útil para el matching de alertas en Fase 3).
 */
async function correrPollingLicitaciones(opciones = {}) {
  console.log('[poll-licitaciones] Iniciando...');

  const activas = await obtenerLicitacionesActivas();
  console.log(`[poll-licitaciones] ${activas.length} licitaciones activas encontradas.`);

  const codigosActivos = activas.map((item) => item.CodigoExterno);
  const yaVistos = await obtenerCodigosYaVistos(codigosActivos);
  let nuevas = codigosActivos.filter((codigo) => !yaVistos.has(codigo));

  if (opciones.limite) {
    console.log(`[poll-licitaciones] Limitando a las primeras ${opciones.limite} (de ${nuevas.length} nuevas) para esta corrida.`);
    nuevas = nuevas.slice(0, opciones.limite);
  }

  if (nuevas.length === 0) {
    console.log('[poll-licitaciones] No hay licitaciones nuevas.');
    return [];
  }

  console.log(`[poll-licitaciones] ${nuevas.length} licitaciones a procesar — trayendo detalle y guardando una por una (esto toma ~${nuevas.length * 3}s)...`);

  const detalles = [];
  for (let i = 0; i < nuevas.length; i++) {
    const codigo = nuevas[i];
    try {
      const detalle = await obtenerDetalleLicitacion(codigo);
      if (detalle) {
        await guardarLicitacion(detalle);
        detalles.push(detalle);
      }
    } catch (err) {
      console.error(`[poll-licitaciones] Error ${i + 1}/${nuevas.length} — no se pudo obtener/guardar el detalle de ${codigo}:`, err.message);
    }

    if (i < nuevas.length - 1) await sleep(DELAY_ENTRE_LLAMADAS_MS);
  }

  console.log(`[poll-licitaciones] ${detalles.length} licitaciones nuevas guardadas.`);

  await procesarAlertasLicitaciones(detalles);

  return detalles;
}

module.exports = { correrPollingLicitaciones };
