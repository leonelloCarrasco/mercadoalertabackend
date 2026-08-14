const pool = require('./pool');

/**
 * Cuenta cuántas veces el usuario ya usó "Sugerir palabras clave" HOY (hora
 * del servidor) — sin ciclo mensual, a diferencia de Análisis IA: acá el
 * costo por llamada es bajo (una lista corta de palabras, no un documento
 * completo), así que un contador diario simple alcanza, sin necesitar la
 * lógica de ciclo/reseteo mensual que sí justifica esa otra cuota.
 *
 * El tope "por alerta" (2 en Trial, 5 en Basic/Full) NO se controla acá —
 * se maneja en el frontend, contando los clics dentro de la sesión del
 * modal de creación, porque todavía no existe un alert_config.id al que
 * asociar el consumo mientras se está creando la alerta. Este contador
 * diario es el único resguardo del lado del servidor.
 */
async function contarSugerenciasDeHoy(userId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS total FROM sugerencias_palabras_clave_consumos
     WHERE user_id = $1 AND created_at >= CURRENT_DATE`,
    [userId]
  );
  return result.rows[0].total;
}

async function registrarSugerencia(userId) {
  await pool.query('INSERT INTO sugerencias_palabras_clave_consumos (user_id) VALUES ($1)', [userId]);
}

module.exports = { contarSugerenciasDeHoy, registrarSugerencia };
