const {
  listarTodosLosCambiosRecientes,
  obtenerDetalleCompraAgil,
  CuotaAgotadaError,
} = require('../services/compraagil.service');
const { obtenerCodigosCompraAgilYaVistos, guardarCompraAgil } = require('../db/compra-agil.queries');
const { procesarAlertasCompraAgil } = require('../services/alerting.service');

// Debe ser mayor al intervalo real entre corridas del cron, para no dejar huecos
// si una corrida se atrasa o falla. En pruebas, una ventana de 90 min a veces dio 0
// resultados (posible irregularidad en la frecuencia de actualización del índice de
// cambios de esta API Beta) — se usa 3 horas de margen para mayor confiabilidad.
const TTL_CAMBIO_MS = 3 * 60 * 60 * 1000;

/**
 * Corre una pasada de detección de Compras Ágiles nuevas:
 * 1. Trae los cambios de los últimos TTL_CAMBIO_MS milisegundos (todas las páginas).
 * 2. Filtra las que ya conocemos.
 * 3. Para las nuevas, intenta traer el detalle completo (proveedores_cotizando incluido).
 * 4. Las guarda en la base de datos.
 *
 * Prioriza guardar rápido (sin esperar el detalle) porque una Compra Ágil puede cerrar en 24hs;
 * si el detalle falla por cuota agotada, igual se guarda el resumen y se sigue.
 */
async function correrPollingCompraAgil(opciones = {}) {
  console.log('[poll-compra-agil] Iniciando...');

  const ttlMs = opciones.ttlMs || TTL_CAMBIO_MS;
  console.log(`[poll-compra-agil] Usando ttl_cambio_ms=${ttlMs}`);

  let items;
  try {
    items = await listarTodosLosCambiosRecientes(ttlMs);
  } catch (err) {
    if (err instanceof CuotaAgotadaError) {
      console.warn('[poll-compra-agil] Cuota diaria agotada, se omite esta corrida.');
      return [];
    }
    throw err;
  }

  console.log(`[poll-compra-agil] ${items.length} procesos con cambios recientes.`);

  const codigos = items.map((item) => item.codigo);
  const yaVistos = await obtenerCodigosCompraAgilYaVistos(codigos);
  const nuevas = items.filter((item) => !yaVistos.has(item.codigo));

  if (nuevas.length === 0) {
    console.log('[poll-compra-agil] No hay Compras Ágiles nuevas.');
    return [];
  }

  console.log(`[poll-compra-agil] ${nuevas.length} Compras Ágiles nuevas — guardando...`);

  const guardadas = [];
  for (const item of nuevas) {
    let detalle = null;
    try {
      detalle = await obtenerDetalleCompraAgil(item.codigo);
    } catch (err) {
      if (err instanceof CuotaAgotadaError) {
        console.warn(`[poll-compra-agil] Cuota agotada al pedir detalle de ${item.codigo}, se guarda solo el resumen.`);
      } else {
        console.error(`[poll-compra-agil] Error al pedir detalle de ${item.codigo}:`, err.message);
      }
    }

    await guardarCompraAgil(item, detalle);
    guardadas.push({ item, detalle });
  }

  console.log(`[poll-compra-agil] ${guardadas.length} Compras Ágiles nuevas guardadas.`);

  await procesarAlertasCompraAgil(guardadas);

  return guardadas;
}

module.exports = { correrPollingCompraAgil };
