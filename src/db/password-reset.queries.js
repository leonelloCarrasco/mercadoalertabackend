const pool = require('./pool');

async function crearTokenReset(userId, tokenHash, expiresAt) {
  const result = await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, expires_at`,
    [userId, tokenHash, expiresAt]
  );
  return result.rows[0];
}

/**
 * Busca un token vigente: no usado y no vencido. Devuelve también el
 * user_id para que el caller pueda actualizar la contraseña sin otra consulta.
 */
async function buscarTokenResetVigente(tokenHash) {
  const result = await pool.query(
    `SELECT id, user_id, expires_at
     FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() AND tipo = 'reset_password'`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

async function marcarTokenResetUsado(id) {
  await pool.query(
    'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
    [id]
  );
}

/**
 * Invalida cualquier token previo del usuario antes de emitir uno nuevo —
 * así un link de recuperación viejo (ej. de un email anterior) deja de servir
 * apenas se pide uno nuevo.
 */
async function invalidarTokensResetDeUsuario(userId) {
  await pool.query(
    "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL AND tipo = 'reset_password'",
    [userId]
  );
}

/**
 * Mismo mecanismo que el reset de contraseña, pero para confirmar la cuenta
 * recién creada (registro nuevo, migración 023) — se distingue por
 * tipo='confirmacion_cuenta'.
 */
async function crearTokenConfirmacionCuenta(userId, tokenHash, expiresAt) {
  const result = await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, tipo)
     VALUES ($1, $2, $3, 'confirmacion_cuenta')
     RETURNING id, user_id, expires_at`,
    [userId, tokenHash, expiresAt]
  );
  return result.rows[0];
}

async function buscarTokenConfirmacionVigente(tokenHash) {
  const result = await pool.query(
    `SELECT id, user_id, expires_at
     FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() AND tipo = 'confirmacion_cuenta'`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

/**
 * Mismo mecanismo otra vez, para vincular la cuenta de Telegram del usuario
 * (tipo='telegram_link') — ver telegram.routes.js. A diferencia de los otros
 * dos tipos, este token viaja dentro de un deep link de Telegram
 * (https://t.me/BOT?start=TOKEN), no por email.
 */
async function crearTokenTelegramLink(userId, tokenHash, expiresAt) {
  const result = await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, tipo)
     VALUES ($1, $2, $3, 'telegram_link')
     RETURNING id, user_id, expires_at`,
    [userId, tokenHash, expiresAt]
  );
  return result.rows[0];
}

async function buscarTokenTelegramLinkVigente(tokenHash) {
  const result = await pool.query(
    `SELECT id, user_id, expires_at
     FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() AND tipo = 'telegram_link'`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

/**
 * Igual que invalidarTokensResetDeUsuario — invalida cualquier link de
 * vinculación anterior sin usar antes de emitir uno nuevo, para que no queden
 * varios links "vivos" al mismo tiempo si el usuario pide el link más de una vez.
 */
async function invalidarTokensTelegramLinkDeUsuario(userId) {
  await pool.query(
    "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL AND tipo = 'telegram_link'",
    [userId]
  );
}

module.exports = {
  crearTokenReset,
  buscarTokenResetVigente,
  marcarTokenResetUsado,
  invalidarTokensResetDeUsuario,
  crearTokenConfirmacionCuenta,
  buscarTokenConfirmacionVigente,
  crearTokenTelegramLink,
  buscarTokenTelegramLinkVigente,
  invalidarTokensTelegramLinkDeUsuario,
};
