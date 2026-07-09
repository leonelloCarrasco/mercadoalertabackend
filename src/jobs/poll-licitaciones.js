const { obtenerLicitacionesActivas, obtenerDetallesConDelay } = require('../services/mercadopublico.service');
const { obtenerCodigosYaVistos, guardarLicitacion } = require('../db/licitaciones.queries');
const { procesarAlertasLicitaciones } = require('../services/alerting.service');

/**
 * Corre una pasada de detección de licitaciones nuevas:
 * 1. Trae el listado resumido de licitaciones activas.
 * 2. Filtra las que ya conocemos (por CodigoExterno).
 * 3. Para las nuevas, trae el detalle completo (respetando el delay de 3s entre llamadas).
 * 4. Las guarda en la base de datos.
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

  console.log(`[poll-licitaciones] ${nuevas.length} licitaciones a procesar — trayendo detalle (esto toma ~${nuevas.length * 3}s)...`);
  const detalles = await obtenerDetallesConDelay(nuevas);

  for (const detalle of detalles) {
    await guardarLicitacion(detalle);
  }

  console.log(`[poll-licitaciones] ${detalles.length} licitaciones nuevas guardadas.`);

  await procesarAlertasLicitaciones(detalles);

  return detalles;
}

module.exports = { correrPollingLicitaciones };
