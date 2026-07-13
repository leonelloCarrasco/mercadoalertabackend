const pool = require('./pool');

/**
 * Listado completo de usuarios para el panel de administrador, con los datos
 * de su empresa incluidos (1 usuario = 1 empresa, ver migración 023).
 */
async function listarTodosLosUsuarios() {
  const result = await pool.query(
    `SELECT u.id, u.email, u.nombre, u.apellido, u.telefono, u.estado, u.es_admin,
            u.acepta_terminos, u.created_at, u.empresa_id,
            e.rut AS rut_empresa, e.nombre_empresa, e.rut_validado, e.declara_emt,
            e.plan, e.estado_pago, e.fecha_expiracion_trial, e.monto_mensual,
            e.mercadopago_subscription_id
     FROM users u
     JOIN empresas e ON e.id = u.empresa_id
     ORDER BY u.created_at DESC`
  );
  return result.rows;
}

/**
 * Actualiza TODOS los campos editables de un usuario y su empresa en una sola
 * llamada (dos UPDATEs, uno por tabla) — usado por el panel de administrador,
 * después de la confirmación por modal en el frontend. COALESCE hace que
 * cualquier campo no enviado (undefined -> null en el query) quede como estaba.
 */
async function actualizarUsuarioCompleto(userId, empresaId, campos) {
  await pool.query(
    `UPDATE users SET
       nombre = COALESCE($1, nombre),
       apellido = COALESCE($2, apellido),
       email = COALESCE($3, email),
       telefono = COALESCE($4, telefono),
       estado = COALESCE($5, estado),
       es_admin = COALESCE($6, es_admin),
       acepta_terminos = COALESCE($7, acepta_terminos)
     WHERE id = $8`,
    [
      campos.nombre, campos.apellido, campos.email, campos.telefono,
      campos.estado, campos.esAdmin, campos.aceptaTerminos, userId,
    ]
  );

  await pool.query(
    `UPDATE empresas SET
       rut = COALESCE($1, rut),
       nombre_empresa = COALESCE($2, nombre_empresa),
       rut_validado = COALESCE($3, rut_validado),
       declara_emt = COALESCE($4, declara_emt),
       plan = COALESCE($5, plan),
       monto_mensual = COALESCE($6, monto_mensual),
       fecha_expiracion_trial = COALESCE($7, fecha_expiracion_trial),
       estado_pago = COALESCE($8, estado_pago)
     WHERE id = $9`,
    [
      campos.rutEmpresa, campos.nombreEmpresa, campos.rutValidado, campos.declaraEmt,
      campos.plan, campos.montoMensual, campos.fechaExpiracionTrial, campos.estadoPago,
      empresaId,
    ]
  );
}

/**
 * Cambia la contraseña de un usuario desde el panel de administrador (reset
 * manual, ej. si un usuario quedó bloqueado). Aparte de actualizarUsuarioCompleto
 * porque acá se recibe el hash ya calculado (bcrypt), no el campo crudo.
 */
async function actualizarPasswordDesdeAdmin(userId, passwordHash) {
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}

module.exports = { listarTodosLosUsuarios, actualizarUsuarioCompleto, actualizarPasswordDesdeAdmin };
