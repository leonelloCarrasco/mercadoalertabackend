const cron = require('node-cron');
const { correrPollingLicitaciones } = require('./poll-licitaciones');
const { correrPollingCompraAgil } = require('./poll-compra-agil');
const { correrRevisionResoluciones } = require('./revisar-resoluciones');
const { correrRecordatorioCierre } = require('./recordatorio-cierre');
const { correrSeguimientoEstado } = require('./seguimiento-estado');

function iniciarCronJobs() {
  // Licitaciones: cada 3 horas (el volumen de detalle a traer puede tardar varios minutos
  // por el delay de 3s entre llamadas, así que no conviene correrlo más seguido).
  cron.schedule('0 */3 * * *', async () => {
    try {
      await correrPollingLicitaciones();
    } catch (err) {
      console.error('[cron] Error en polling de licitaciones:', err);
    }
  });

  // Compra Ágil: cada 1 hora (con TTL de 3h en el job, da 2h de margen si alguna corrida se atrasa).
  // Puede cerrar en 24hs, así que sigue siendo bastante seguido. Cuidado con la cuota diaria del ticket.
  cron.schedule('0 */1 * * *', async () => {
    try {
      await correrPollingCompraAgil();
    } catch (err) {
      console.error('[cron] Error en polling de Compra Ágil:', err);
    }
  });

  // Revisión de adjudicaciones: una vez al día (03:00) — no hay apuro, la
  // adjudicación puede tardar días o semanas en publicarse, así que no vale
  // la pena revisar más seguido. Corre de madrugada para no competir con los
  // otros dos jobs por la cuota/límites de las APIs.
  cron.schedule('0 3 * * *', async () => {
    try {
      await correrRevisionResoluciones();
    } catch (err) {
      console.error('[cron] Error en revisión de resoluciones:', err);
    }
  });

  // Recordatorios de cierre (Oportunidades): cada 15 min. Es barato — solo
  // lee datos ya sincronizados localmente, no pega contra ninguna API — así
  // que puede correr seguido sin costo, para que el aviso llegue con
  // precisión razonable respecto a la hora elegida por el usuario.
  cron.schedule('*/15 * * * *', async () => {
    try {
      await correrRecordatorioCierre();
    } catch (err) {
      console.error('[cron] Error en recordatorio de cierre:', err);
    }
  });

  // Seguimiento de estado (Oportunidades): cada 3 horas, corrido 30 min
  // después del polling de licitaciones (minuto 30 en vez de 0) para no
  // competir por la misma API rate-limited al mismo tiempo.
  cron.schedule('30 */3 * * *', async () => {
    try {
      await correrSeguimientoEstado();
    } catch (err) {
      console.error('[cron] Error en seguimiento de estado:', err);
    }
  });

  console.log('[cron] Jobs programados: licitaciones cada 3h, Compra Ágil cada 1h, revisión de adjudicaciones diaria a las 03:00, recordatorios cada 15 min, seguimiento de estado cada 3h (min 30).');
}

module.exports = { iniciarCronJobs };
