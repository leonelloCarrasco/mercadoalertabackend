const pool = require('./pool');

const DURACION_CICLO_MESES = 1;

/**
 * Devuelve la fecha de inicio del ciclo vigente de la empresa, o null si
 * nunca empezó uno, o si el que había ya venció (más de 1 mes desde que
 * arrancó). Mismo criterio que obtenerCicloVigente de Análisis IA
 * (analisis-ia.queries.js), pero a nivel empresa en vez de usuario — acá el
 * ancla es la activación de WhatsApp, no el primer consumo.
 */
async function obtenerCicloVigente(empresaId) {
  const result = await pool.query('SELECT whatsapp_ciclo_inicio FROM empresas WHERE id = $1', [empresaId]);
  const inicio = result.rows[0]?.whatsapp_ciclo_inicio;
  if (!inicio) return null;

  const finCiclo = new Date(inicio);
  finCiclo.setMonth(finCiclo.getMonth() + DURACION_CICLO_MESES);
  return new Date() < finCiclo ? inicio : null;
}

/**
 * Se llama SIEMPRE que un usuario de la empresa vincula WhatsApp (sea la
 * primera vez, o de nuevo después de desvincular). A propósito NO estampa
 * whatsapp_ciclo_inicio a ciegas: si ya hay un ciclo vigente, no lo toca —
 * desvincular y volver a vincular NUNCA reinicia el contador ni corre la
 * fecha de renovación (evita que alguien "resetee" la cuota a propósito
 * justo antes de llegar al tope). Solo abre un ciclo nuevo cuando el
 * anterior ya venció por tiempo, o si nunca hubo uno.
 *
 * Devuelve la fecha de inicio del ciclo vigente después de esta llamada
 * (la que ya había, o la recién creada).
 */
async function asegurarCicloVigenteWhatsapp(empresaId) {
  const vigente = await obtenerCicloVigente(empresaId);
  if (vigente) return vigente;

  const result = await pool.query(
    'UPDATE empresas SET whatsapp_ciclo_inicio = NOW(), whatsapp_aviso_80_enviado = false WHERE id = $1 RETURNING whatsapp_ciclo_inicio',
    [empresaId]
  );
  return result.rows[0]?.whatsapp_ciclo_inicio || null;
}

/**
 * Cuenta los envíos DENTRO del ciclo vigente. Si cicloInicio es null (nunca
 * arrancó uno, o el anterior ya venció), el conteo es 0 sin ni siquiera
 * consultar la tabla — un ciclo vencido no arrastra consumos ya gastados.
 */
async function contarEnviosDelCiclo(empresaId, cicloInicio) {
  if (!cicloInicio) return 0;
  const result = await pool.query(
    'SELECT COUNT(*)::int AS total FROM whatsapp_envios WHERE empresa_id = $1 AND sent_at >= $2',
    [empresaId, cicloInicio]
  );
  return result.rows[0].total;
}

/** Registra un envío exitoso — llamada desde enviarPlantillaWhatsapp() después de una entrega real (nunca en modo simulación). */
async function registrarEnvio(empresaId) {
  await pool.query('INSERT INTO whatsapp_envios (empresa_id) VALUES ($1)', [empresaId]);
}

/** ¿Ya se mandó el aviso de 80% en este ciclo? Evita mandarlo más de una vez. */
async function yaSeAvisoOchentaPorciento(empresaId) {
  const result = await pool.query('SELECT whatsapp_aviso_80_enviado FROM empresas WHERE id = $1', [empresaId]);
  return Boolean(result.rows[0]?.whatsapp_aviso_80_enviado);
}

async function marcarAvisoOchentaPorcientoEnviado(empresaId) {
  await pool.query('UPDATE empresas SET whatsapp_aviso_80_enviado = true WHERE id = $1', [empresaId]);
}

module.exports = {
  obtenerCicloVigente,
  asegurarCicloVigenteWhatsapp,
  contarEnviosDelCiclo,
  registrarEnvio,
  yaSeAvisoOchentaPorciento,
  marcarAvisoOchentaPorcientoEnviado,
};
