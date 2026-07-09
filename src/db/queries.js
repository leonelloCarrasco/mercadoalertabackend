const pool = require('./pool');

async function crearUsuario({ email, passwordHash, nombre, apellido, empresaId }) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, nombre, apellido, empresa_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, nombre, apellido, empresa_id, created_at`,
    [email, passwordHash, nombre, apellido, empresaId]
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
    `SELECT u.id, u.email, u.nombre, u.apellido, u.created_at, u.empresa_id,
            e.rut AS rut_empresa, e.nombre_empresa, e.rut_validado, e.declara_emt,
            e.plan, e.estado_pago, e.fecha_expiracion_trial, e.monto_mensual
     FROM users u
     JOIN empresas e ON e.id = u.empresa_id
     WHERE u.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function actualizarPasswordUsuario(userId, passwordHash) {
  await pool.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2',
    [passwordHash, userId]
  );
}

async function actualizarNombreApellido(userId, nombre, apellido) {
  const result = await pool.query(
    'UPDATE users SET nombre = $1, apellido = $2 WHERE id = $3 RETURNING id, email, nombre, apellido',
    [nombre, apellido, userId]
  );
  return result.rows[0] || null;
}

async function obtenerPasswordHash(userId) {
  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  return result.rows[0]?.password_hash || null;
}

module.exports = {
  crearUsuario,
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  actualizarPasswordUsuario,
  actualizarNombreApellido,
  obtenerPasswordHash,
};
