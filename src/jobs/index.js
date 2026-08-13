const cron = require('node-cron');
const { correrPollingLicitaciones } = require('./poll-licitaciones');
const { correrPollingCompraAgil } = require('./poll-compra-agil');
const { correrRevisionResoluciones } = require('./revisar-resoluciones');
const { correrRecordatorioCierre } = require('./recordatorio-cierre');
const { correrSeguimientoEstado } = require('./seguimiento-estado');
const { correrAvisosTrial } = require('./avisos-trial');

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

  // Compra Ágil: cada 3 horas, corrido 1 hora después del polling de
  // licitaciones (hora 1, 4, 7... en vez de 0, 3, 6...) para que no se
  // topen — igual criterio que ya usa seguimiento-estado más abajo, solo
  // que con 1h de desfase en vez de 30 min. Antes corría cada 1h con
  // ttl_cambio_ms=3h — pasó a ttl_cambio_ms=30 días con corte temprano de
  // paginación (ver poll-compra-agil.js), así que ya no hace falta
  // correrlo tan seguido: el corte temprano hace que cada corrida sea
  // barata sin importar cada cuánto se dispare.
  cron.schedule('0 1-23/3 * * *', async () => {
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

  // Avisos de trial: una vez al día (08:00 — horario razonable para que el
  // correo llegue durante el día laboral, no de madrugada). Barato, solo
  // lee empresas locales, no pega contra ninguna API externa.
  cron.schedule('0 8 * * *', async () => {
    try {
      await correrAvisosTrial();
    } catch (err) {
      console.error('[cron] Error en avisos de trial:', err);
    }
  });

  console.log('[cron] Jobs programados: licitaciones cada 3h (hora 0,3,6...), Compra Ágil cada 3h (hora 1,4,7...), revisión de adjudicaciones diaria a las 03:00, recordatorios cada 15 min, seguimiento de estado cada 3h (min 30), avisos de trial diarios a las 08:00.');
}

module.exports = { iniciarCronJobs };
