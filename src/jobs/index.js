const cron = require('node-cron');
const { correrPollingLicitaciones } = require('./poll-licitaciones');
const { correrPollingCompraAgil } = require('./poll-compra-agil');
const { correrRevisionResoluciones } = require('./revisar-resoluciones');
const { correrRecordatorioCierre } = require('./recordatorio-cierre');
const { correrSeguimientoEstado } = require('./seguimiento-estado');
const { correrAvisosTrial } = require('./avisos-trial');
const { correrLimpiezaDatosAntiguos } = require('./limpieza-datos-antiguos');

// Todos los cron.schedule de acá abajo llevan { timezone: 'America/Santiago' }
// explícito — sin esto, node-cron usa la hora del SERVIDOR, que en Render es
// UTC, no la de Chile. Encontrado en producción (agosto 2026): "revisión de
// adjudicaciones a las 03:00" en realidad corría a las 23:00 del día
// anterior, hora de Chile (UTC-4 en invierno) — todas las horas de acá abajo
// estaban pensadas en hora de Chile, pero corrían 3-4 horas corridas sin que
// nadie lo notara, porque son horarios de todas formas poco visibles.
// 'America/Santiago' además maneja solo el cambio de horario de
// verano/invierno de Chile — un offset fijo se hubiera roto en marzo/septiembre.
const TIMEZONE = { timezone: 'America/Santiago' };

function iniciarCronJobs() {
  // Licitaciones: cada 3 horas (el volumen de detalle a traer puede tardar varios minutos
  // por el delay de 3s entre llamadas, así que no conviene correrlo más seguido).
  cron.schedule('0 */3 * * *', async () => {
    try {
      await correrPollingLicitaciones();
    } catch (err) {
      console.error('[cron] Error en polling de licitaciones:', err);
    }
  }, TIMEZONE);

  // Compra Ágil: cada 3 horas, corrido 1 hora después del polling de
  // licitaciones (hora 1, 4, 7... en vez de 0, 3, 6...) para que no se
  // topen — igual criterio que ya usa seguimiento-estado más abajo, solo
  // que con 1h de desfase en vez de 30 min. Rediseño de agosto 2026: pasó
  // de ttl_cambio_ms a estado=publicada (ver poll-compra-agil.js).
  cron.schedule('0 1-23/3 * * *', async () => {
    try {
      await correrPollingCompraAgil();
    } catch (err) {
      console.error('[cron] Error en polling de Compra Ágil:', err);
    }
  }, TIMEZONE);

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
  }, TIMEZONE);

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
  }, TIMEZONE);

  // Seguimiento de estado (Oportunidades): cada 3 horas, corrido 30 min
  // después del polling de licitaciones (minuto 30 en vez de 0) para no
  // competir por la misma API rate-limited al mismo tiempo.
  cron.schedule('30 */3 * * *', async () => {
    try {
      await correrSeguimientoEstado();
    } catch (err) {
      console.error('[cron] Error en seguimiento de estado:', err);
    }
  }, TIMEZONE);

  // Avisos de trial: una vez al día (08:00 — horario razonable para que el
  // correo llegue durante el día laboral, no de madrugada). Barato, solo
  // lee empresas locales, no pega contra ninguna API externa.
  cron.schedule('0 8 * * *', async () => {
    try {
      await correrAvisosTrial();
    } catch (err) {
      console.error('[cron] Error en avisos de trial:', err);
    }
  }, TIMEZONE);

  // Limpieza de datos antiguos: una vez al día (04:00, justo después de la
  // revisión de adjudicaciones de las 03:00). Solo lee/borra de la base
  // local, no pega contra ninguna API externa — no compite por cuota con
  // ningún otro job, así que la hora exacta no es crítica, solo se eligió
  // 04:00 para que corra de madrugada como los demás jobs de bajo tráfico.
  cron.schedule('0 4 * * *', async () => {
    try {
      await correrLimpiezaDatosAntiguos();
    } catch (err) {
      console.error('[cron] Error en limpieza de datos antiguos:', err);
    }
  }, TIMEZONE);

  console.log('[cron] Jobs programados (hora de Chile): licitaciones cada 3h (hora 0,3,6...), Compra Ágil cada 3h (hora 1,4,7...), revisión de adjudicaciones diaria a las 03:00, limpieza de datos antiguos diaria a las 04:00, recordatorios cada 15 min, seguimiento de estado cada 3h (min 30), avisos de trial diarios a las 08:00.');
}

module.exports = { iniciarCronJobs };
