const pool = require('./pool');

/**
 * Crea el usuario de una empresa recién registrada. `estado` arranca en
 * 'pendiente_email' (default) hasta que se confirme el correo — ver
 * POST /auth/confirmar-cuenta en auth.routes.js.
 */
async function crearUsuario({ email, passwordHash, nombre, apellido, telefono, empresaId, aceptaTerminos }) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, nombre, apellido, telefono, empresa_id, estado, acepta_terminos, acepta_terminos_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pendiente_email', $7, CASE WHEN $7 THEN NOW() ELSE NULL END)
     RETURNING id, email, nombre, apellido, telefono, empresa_id, estado, created_at`,
    [email, passwordHash, nombre, apellido, telefono || null, empresaId, Boolean(aceptaTerminos)]
  );
  return result.rows[0];
}

async function buscarUsuarioPorEmail(email) {
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

/**
 * Trae el usuario con los datos de su empresa vía JOIN — nombre_empresa, rut_empresa,
 * rut_validado, declara_emt y plan viven en la tabla empresas, no en users, pero se
 * devuelven con los mismos nombres de campo de antes para no romper el frontend.
 */
async function buscarUsuarioPorId(id) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.nombre, u.apellido, u.telefono, u.estado, u.es_admin, u.created_at, u.empresa_id,
            e.rut AS rut_empresa, e.nombre_empresa, e.rut_validado, e.declara_emt,
            e.plan, e.estado_pago, e.fecha_expiracion_trial, e.monto_mensual,
            e.suscripcion_cancelada_en, e.acceso_hasta
     FROM users u
     JOIN empresas e ON e.id = u.empresa_id
     WHERE u.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Trae el (único) usuario asociado a una empresa, si existe — usado en el
 * registro para detectar intentos de registro anteriores incompletos
 * (estado != 'activo') que se pueden "reclamar" y reemplazar.
 */
async function buscarUsuarioPorEmpresaId(empresaId) {
  const result = await pool.query('SELECT * FROM users WHERE empresa_id = $1 LIMIT 1', [empresaId]);
  return result.rows[0] || null;
}

async function actualizarPasswordUsuario(userId, passwordHash) {
  await pool.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2',
    [passwordHash, userId]
  );
}

async function actualizarDatosUsuario(userId, nombre, apellido, telefono) {
  const result = await pool.query(
    'UPDATE users SET nombre = $1, apellido = $2, telefono = $3 WHERE id = $4 RETURNING id, email, nombre, apellido, telefono',
    [nombre, apellido, telefono, userId]
  );
  return result.rows[0] || null;
}

async function obtenerPasswordHash(userId) {
  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  return result.rows[0]?.password_hash || null;
}

/**
 * Avanza el estado del flujo de registro/pago de un usuario:
 * 'pendiente_email' -> 'pendiente_pago' (solo basic/full) -> 'activo'.
 */
async function actualizarEstadoUsuario(userId, estado) {
  const result = await pool.query(
    'UPDATE users SET estado = $1 WHERE id = $2 RETURNING id, estado',
    [estado, userId]
  );
  return result.rows[0] || null;
}

/**
 * Elimina un usuario — se usa únicamente para "reclamar" intentos de registro
 * abandonados (mismo RUT o email, pero que nunca llegaron a estado 'activo').
 * Debe llamarse ANTES de eliminar la empresa asociada (FK NOT NULL).
 */
async function eliminarUsuario(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

module.exports = {
  crearUsuario,
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  buscarUsuarioPorEmpresaId,
  actualizarPasswordUsuario,
  actualizarDatosUsuario,
  obtenerPasswordHash,
  actualizarEstadoUsuario,
  eliminarUsuario,
};
