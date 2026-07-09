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
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
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
    'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
    [userId]
  );
}

/**
 * Mismo mecanismo que el reset de contraseña, pero para el "magic link" de
 * acceso al sitio de gestión de empresa (sin password) — se distingue por
 * tipo='acceso_empresa' y usa empresa_id en vez de user_id.
 */
async function crearTokenAccesoEmpresa(empresaId, tokenHash, expiresAt) {
  const result = await pool.query(
    `INSERT INTO password_reset_tokens (empresa_id, token_hash, expires_at, tipo)
     VALUES ($1, $2, $3, 'acceso_empresa')
     RETURNING id, empresa_id, expires_at`,
    [empresaId, tokenHash, expiresAt]
  );
  return result.rows[0];
}

async function buscarTokenAccesoEmpresaVigente(tokenHash) {
  const result = await pool.query(
    `SELECT id, empresa_id, expires_at
     FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() AND tipo = 'acceso_empresa'`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

async function invalidarTokensAccesoDeEmpresa(empresaId) {
  await pool.query(
    "UPDATE password_reset_tokens SET used_at = NOW() WHERE empresa_id = $1 AND used_at IS NULL AND tipo = 'acceso_empresa'",
    [empresaId]
  );
}

module.exports = {
  crearTokenReset,
  buscarTokenResetVigente,
  marcarTokenResetUsado,
  invalidarTokensResetDeUsuario,
  crearTokenAccesoEmpresa,
  buscarTokenAccesoEmpresaVigente,
  invalidarTokensAccesoDeEmpresa,
};
