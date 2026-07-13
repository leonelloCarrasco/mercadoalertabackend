const { listarAlertConfigsActivas } = require('../db/alert-configs.queries');
const { intentarReservarEnvio, liberarReserva } = require('../db/alerts-sent.queries');
const { matchLicitacion, matchCompraAgil } = require('./matching.service');
const { enviarEmailAlerta, armarResumenLicitaciones, armarResumenCompraAgil } = require('./email.service');
const { enviarTelegramAlerta } = require('./telegram.service');

/**
 * Recorre los items nuevos, hace matching contra las configuraciones activas,
 * y agrupa por usuario + canal los items que le corresponden a cada uno —
 * reservando atómicamente cada (usuario, item, canal) antes de agregarlo al grupo,
 * para no duplicar envíos si esta misma corrida se solapa con otra (ver alerts-sent.queries.js).
 *
 * Devuelve dos Maps: uno para email, otro para telegram, cada uno
 * userId -> { config, items: [...], reservaIds: [...] }
 */
async function agruparPorUsuario(items, matchFn, tipoProceso, extraerCodigo) {
  const configs = await listarAlertConfigsActivas();
  const porUsuarioEmail = new Map();
  const porUsuarioTelegram = new Map();

  if (configs.length === 0) {
    console.log('[alerting] No hay ninguna configuración de alerta activa en todo el sistema.');
    return { porUsuarioEmail, porUsuarioTelegram };
  }

  for (const item of items) {
    const matches = await matchFn(item, configs);
    const codigoExterno = extraerCodigo(item);

    for (const config of matches) {
      const reservaEmailId = await intentarReservarEnvio(config.user_id, codigoExterno, tipoProceso, 'email', config.id);
      if (reservaEmailId) {
        if (!porUsuarioEmail.has(config.user_id)) {
          porUsuarioEmail.set(config.user_id, { config, items: [], reservaIds: [] });
        }
        const bucket = porUsuarioEmail.get(config.user_id);
        bucket.items.push(item);
        bucket.reservaIds.push(reservaEmailId);
      }

      if (config.telegram_chat_id) {
        const reservaTelegramId = await intentarReservarEnvio(config.user_id, codigoExterno, tipoProceso, 'telegram', config.id);
        if (reservaTelegramId) {
          if (!porUsuarioTelegram.has(config.user_id)) {
            porUsuarioTelegram.set(config.user_id, { config, items: [], reservaIds: [] });
          }
          const bucket = porUsuarioTelegram.get(config.user_id);
          bucket.items.push(item);
          bucket.reservaIds.push(reservaTelegramId);
        }
      }
    }
  }

  return { porUsuarioEmail, porUsuarioTelegram };
}

async function enviarResumenesPorEmail(porUsuarioEmail, armarResumenFn) {
  let enviados = 0;
  for (const [, bucket] of porUsuarioEmail) {
    const { subject, html } = armarResumenFn(bucket.items);
    try {
      await enviarEmailAlerta({ to: bucket.config.email, subject, html });
      enviados++;
    } catch (err) {
      console.error(`[alerting] Error enviando resumen por email a ${bucket.config.email}:`, err.message);
      for (const id of bucket.reservaIds) await liberarReserva(id);
    }
  }
  return enviados;
}

async function enviarResumenesPorTelegram(porUsuarioTelegram, armarTextoFn) {
  let enviados = 0;
  for (const [, bucket] of porUsuarioTelegram) {
    const texto = armarTextoFn(bucket.items);
    try {
      await enviarTelegramAlerta(bucket.config.telegram_chat_id, texto);
      enviados++;
    } catch (err) {
      console.error(`[alerting] Error enviando resumen por Telegram a user ${bucket.config.user_id}:`, err.message);
      for (const id of bucket.reservaIds) await liberarReserva(id);
    }
  }
  return enviados;
}

function armarTextoTelegramLicitaciones(items) {
  const encabezado = items.length === 1
    ? '📋 Nueva licitación que coincide con tus alertas:'
    : `📋 ${items.length} nuevas licitaciones que coinciden con tus alertas:`;

  const lista = items.map((d) =>
    `\n\n• ${d.Nombre}\n  Monto: ${d.MontoEstimado || 'N/E'}\n  Cierra: ${d.Fechas?.FechaCierre || 'N/E'}`
  ).join('');

  return encabezado + lista;
}

function armarTextoTelegramCompraAgil(items) {
  const encabezado = items.length === 1
    ? '⚡ Nueva Compra Ágil que coincide con tus alertas:'
    : `⚡ ${items.length} nuevas Compras Ágiles que coinciden con tus alertas:`;

  const lista = items.map((item) =>
    `\n\n• ${item.nombre}\n  Monto: ${item.montos?.monto_disponible_clp || 'N/E'}\n  ⚠️ Cierra: ${item.fechas?.fecha_cierre || 'N/E'}`
  ).join('');

  return encabezado + lista + '\n\n⚠️ Recuerda que las Compras Ágiles pueden cerrar en menos de 24 horas.';
}

/**
 * Recorre las licitaciones nuevas detectadas, hace matching contra las configuraciones
 * activas, y envía UN email resumen (y UN mensaje de Telegram) por usuario, agrupando
 * todas las licitaciones que le hicieron match en esta corrida — en vez de un mensaje
 * por cada licitación, que era poco práctico con corridas grandes.
 */
async function procesarAlertasLicitaciones(licitacionesNuevas) {
  if (licitacionesNuevas.length === 0) return;

  const { porUsuarioEmail, porUsuarioTelegram } = await agruparPorUsuario(
    licitacionesNuevas,
    matchLicitacion,
    'licitacion',
    (detalle) => detalle.CodigoExterno
  );

  if (porUsuarioEmail.size === 0 && porUsuarioTelegram.size === 0) {
    console.log('[alerting] Hay configuraciones activas, pero ninguna coincidió con estos items.');
    return;
  }

  const emailsEnviados = await enviarResumenesPorEmail(porUsuarioEmail, armarResumenLicitaciones);
  const telegramsEnviados = await enviarResumenesPorTelegram(porUsuarioTelegram, armarTextoTelegramLicitaciones);

  console.log(`[alerting] ${emailsEnviados} emails resumen y ${telegramsEnviados} mensajes de Telegram enviados (licitaciones).`);
}

/**
 * Igual que procesarAlertasLicitaciones, pero para Compras Ágiles.
 * Recibe el array de { item, detalle } que devuelve el job de polling.
 */
async function procesarAlertasCompraAgil(comprasAgilesNuevas) {
  if (comprasAgilesNuevas.length === 0) return;

  // El listado (item) no trae categoría — pero el detalle sí trae productos_solicitados
  // (con codigo_producto por cada ítem pedido), que es lo que matchCompraAgil necesita
  // para el filtro por categoría. Se combinan acá antes de pasar al matching.
  const items = comprasAgilesNuevas.map((entrada) => ({
    ...entrada.item,
    productos_solicitados: entrada.detalle?.productos_solicitados || [],
  }));

  const { porUsuarioEmail, porUsuarioTelegram } = await agruparPorUsuario(
    items,
    matchCompraAgil,
    'compra_agil',
    (item) => item.codigo
  );

  if (porUsuarioEmail.size === 0 && porUsuarioTelegram.size === 0) {
    console.log('[alerting] Hay configuraciones activas, pero ninguna coincidió con estos items.');
    return;
  }

  const emailsEnviados = await enviarResumenesPorEmail(porUsuarioEmail, armarResumenCompraAgil);
  const telegramsEnviados = await enviarResumenesPorTelegram(porUsuarioTelegram, armarTextoTelegramCompraAgil);

  console.log(`[alerting] ${emailsEnviados} emails resumen y ${telegramsEnviados} mensajes de Telegram enviados (Compra Ágil).`);
}

module.exports = { procesarAlertasLicitaciones, procesarAlertasCompraAgil };
