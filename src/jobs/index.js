const cron = require('node-cron');
const { correrPollingLicitaciones } = require('./poll-licitaciones');
const { correrPollingCompraAgil } = require('./poll-compra-agil');

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

  console.log('[cron] Jobs programados: licitaciones cada 3h, Compra Ágil cada 1h.');
}

module.exports = { iniciarCronJobs };
