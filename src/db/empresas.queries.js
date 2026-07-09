const pool = require('./pool');

async function crearEmpresa({
  rut, nombreEmpresa, rutValidado, declaraEmt,
  responsableNombre, responsableApellido, emailContacto, telefonoContacto,
  plan, montoMensual, fechaExpiracionTrial, estadoPago,
}) {
  const result = await pool.query(
    `INSERT INTO empresas
       (rut, nombre_empresa, rut_validado, declara_emt,
        responsable_nombre, responsable_apellido, email_contacto, telefono_contacto,
        plan, monto_mensual, fecha_expiracion_trial, estado_pago)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, rut, nombre_empresa, rut_validado, declara_emt,
               responsable_nombre, responsable_apellido, email_contacto, telefono_contacto,
               plan, monto_mensual, fecha_expiracion_trial, estado_pago, created_at`,
    [
      rut, nombreEmpresa || null, rutValidado, declaraEmt,
      responsableNombre, responsableApellido, emailContacto, telefonoContacto,
      plan, montoMensual, fechaExpiracionTrial, estadoPago,
    ]
  );
  return result.rows[0];
}

/**
 * Pasa una empresa de trial a un plan pago (basic/full), congelando el monto
 * vigente al momento del upgrade. Deja estado_pago='pendiente' hasta que se
 * confirme el pago (ver pagos.routes.js).
 */
async function actualizarPlanEmpresa(empresaId, { plan, montoMensual }) {
  const result = await pool.query(
    `UPDATE empresas
     SET plan = $1, monto_mensual = $2, fecha_expiracion_trial = NULL, estado_pago = 'pendiente'
     WHERE id = $3
     RETURNING *`,
    [plan, montoMensual, empresaId]
  );
  return result.rows[0] || null;
}

async function guardarSuscripcionMercadoPago(empresaId, subscriptionId) {
  await pool.query(
    'UPDATE empresas SET mercadopago_subscription_id = $1 WHERE id = $2',
    [subscriptionId, empresaId]
  );
}

async function activarPagoEmpresa(empresaId) {
  await pool.query(
    "UPDATE empresas SET estado_pago = 'activo' WHERE id = $1",
    [empresaId]
  );
}

async function buscarEmpresaPorSuscripcion(subscriptionId) {
  const result = await pool.query(
    'SELECT * FROM empresas WHERE mercadopago_subscription_id = $1',
    [subscriptionId]
  );
  return result.rows[0] || null;
}

async function buscarEmpresaPorId(id) {
  const result = await pool.query('SELECT * FROM empresas WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function buscarEmpresaPorRut(rut) {
  const result = await pool.query('SELECT * FROM empresas WHERE rut = $1', [rut]);
  return result.rows[0] || null;
}

async function contarUsuariosDeEmpresa(empresaId) {
  const result = await pool.query(
    'SELECT COUNT(*)::int AS total FROM users WHERE empresa_id = $1',
    [empresaId]
  );
  return result.rows[0].total;
}

async function actualizarContactoEmpresa(empresaId, { responsableNombre, responsableApellido, emailContacto, telefonoContacto }) {
  const result = await pool.query(
    `UPDATE empresas
     SET responsable_nombre = $1, responsable_apellido = $2, email_contacto = $3, telefono_contacto = $4
     WHERE id = $5
     RETURNING *`,
    [responsableNombre, responsableApellido, emailContacto, telefonoContacto, empresaId]
  );
  return result.rows[0] || null;
}

module.exports = {
  crearEmpresa,
  buscarEmpresaPorRut,
  buscarEmpresaPorId,
  buscarEmpresaPorSuscripcion,
  contarUsuariosDeEmpresa,
  guardarSuscripcionMercadoPago,
  activarPagoEmpresa,
  actualizarPlanEmpresa,
  actualizarContactoEmpresa,
};
