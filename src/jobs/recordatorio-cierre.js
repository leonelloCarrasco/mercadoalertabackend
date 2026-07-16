const { listarRecordatoriosPendientes, marcarRecordatorioNotificado } = require('../db/recordatorios.queries');
const { enviarEmailAlerta, armarEmailRecordatorio } = require('../services/email.service');
const { enviarTelegramAlerta } = require('../services/telegram.service');

function armarTextoTelegramRecordatorio(r) {
  const emoji = r.tipo_proceso === 'compra_agil' ? '⚡' : '📋';
  const monto = r.monto ? `$${Number(r.monto).toLocaleString('es-CL')}` : 'No especificado';
  return `⏰ Recordatorio de cierre\n\n${emoji} ${r.nombre}\nCódigo: ${r.codigo_externo}\nOrganismo: ${r.organismo || 'No especificado'}\nMonto: ${monto}\nCierra: ${r.fecha_cierre}`;
}

/**
 * Corre seguido (cada 15 min) y es barato — solo lee licitaciones_vistas /
 * compras_agiles_vistas (ya sincronizadas por el polling normal), no pega
 * contra ninguna API en vivo. Ver listarRecordatoriosPendientes para el
 * criterio exacto de "ya toca avisar".
 */
async function correrRecordatorioCierre() {
  const pendientes = await listarRecordatoriosPendientes();

  if (pendientes.length === 0) {
    console.log('[recordatorio-cierre] Sin recordatorios pendientes.');
    return;
  }

  console.log(`[recordatorio-cierre] ${pendientes.length} recordatorios para notificar...`);
  let enviados = 0;

  for (const r of pendientes) {
    try {
      const { subject, html } = armarEmailRecordatorio(r);
      await enviarEmailAlerta({ to: r.email, subject, html });

      if (r.telegram_chat_id) {
        await enviarTelegramAlerta(r.telegram_chat_id, armarTextoTelegramRecordatorio(r));
      }

      await marcarRecordatorioNotificado(r.id);
      enviados++;
    } catch (err) {
      console.error(`[recordatorio-cierre] Error notificando recordatorio ${r.id} (${r.codigo_externo}):`, err.message);
    }
  }

  console.log(`[recordatorio-cierre] ${enviados}/${pendientes.length} notificados.`);
}

module.exports = { correrRecordatorioCierre };
