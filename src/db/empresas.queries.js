const pool = require('./pool');

/**
 * Crea la empresa asociada a un registro nuevo. Desde la migración 023
 * (1 usuario = 1 empresa), los datos de contacto/responsable ya no se
 * guardan acá — viven en el usuario único de la empresa (ver queries.js).
 */
async function crearEmpresa({ rut, nombreEmpresa, plan, montoMensual, fechaExpiracionTrial, estadoPago }) {
  const result = await pool.query(
    `INSERT INTO empresas (rut, nombre_empresa, rut_validado, plan, monto_mensual, fecha_expiracion_trial, estado_pago)
     VALUES ($1, $2, true, $3, $4, $5, $6)
     RETURNING id, rut, nombre_empresa, rut_validado, plan, monto_mensual, fecha_expiracion_trial, estado_pago, created_at`,
    [rut, nombreEmpresa || null, plan, montoMensual, fechaExpiracionTrial, estadoPago]
  );
  return result.rows[0];
}

/**
 * Pasa una empresa de trial a un plan pago (basic/full), congelando el monto
 * vigente al momento del upgrade. Deja estado_pago='pendiente' hasta que se
 * confirme el pago (ver pagos.routes.js). Usado por el upgrade in-app desde
 * el dashboard (trial vencido) — flujo independiente del registro.
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

/**
 * Confirma el pago de una empresa: activa tanto la empresa (estado_pago)
 * como a su usuario (estado) — el webhook de MercadoPago y el endpoint de
 * simulación local llaman a esto para dar por completo el registro.
 */
async function activarPagoEmpresa(empresaId) {
  await pool.query("UPDATE empresas SET estado_pago = 'activo' WHERE id = $1", [empresaId]);
  await pool.query(
    "UPDATE users SET estado = 'activo' WHERE empresa_id = $1 AND estado != 'activo'",
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

/**
 * Elimina una empresa — se usa únicamente para "reclamar" intentos de
 * registro abandonados. El caller debe haber eliminado ya al usuario
 * asociado (FK NOT NULL de users.empresa_id).
 */
async function eliminarEmpresa(empresaId) {
  await pool.query('DELETE FROM empresas WHERE id = $1', [empresaId]);
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
  eliminarEmpresa,
};
