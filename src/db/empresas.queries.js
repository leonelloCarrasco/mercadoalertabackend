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
     SET plan = $1, monto_mensual = $2, fecha_expiracion_trial = NULL, estado_pago = 'pendiente',
         suscripcion_cancelada_en = NULL, acceso_hasta = NULL,
         aviso_acceso_2dias_enviado = false, aviso_acceso_terminado_enviado = false
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

/**
 * RUT de la empresa de un usuario puntual (join users -> empresas) — usado
 * por la detección automática de ganado/perdido del pipeline
 * (seguimiento-estado.js): se compara este RUT contra el del proveedor
 * ganador que trae la adjudicación.
 */
async function obtenerRutDeUsuario(userId) {
  const result = await pool.query(
    `SELECT e.rut FROM users u JOIN empresas e ON e.id = u.empresa_id WHERE u.id = $1`,
    [userId]
  );
  return result.rows[0]?.rut || null;
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

/**
 * Empresas en trial a las que hay que avisar que faltan ~2 días para que
 * venza (mismo umbral que ya usa el banner del dashboard, mostrarBannerPlan
 * en dashboard.js) — y todavía no se les mandó ese aviso. Trae directo el
 * email/nombre del usuario de la empresa (modelo 1 usuario = 1 empresa
 * desde la migración 023, así que siempre hay exactamente uno).
 */
async function listarEmpresasParaAviso2Dias() {
  const result = await pool.query(
    `SELECT e.id AS empresa_id, e.nombre_empresa, e.fecha_expiracion_trial, u.email, u.nombre
     FROM empresas e
     JOIN users u ON u.empresa_id = e.id
     WHERE e.plan = 'trial'
       AND e.aviso_2dias_enviado = false
       AND e.fecha_expiracion_trial > NOW()
       AND e.fecha_expiracion_trial <= NOW() + INTERVAL '2 days'`
  );
  return result.rows;
}

/**
 * Empresas en trial cuyo período YA venció y todavía no se les mandó el
 * aviso de "se acabó, elige un plan".
 */
async function listarEmpresasParaAvisoVencido() {
  const result = await pool.query(
    `SELECT e.id AS empresa_id, e.nombre_empresa, e.fecha_expiracion_trial, u.email, u.nombre
     FROM empresas e
     JOIN users u ON u.empresa_id = e.id
     WHERE e.plan = 'trial'
       AND e.aviso_vencido_enviado = false
       AND e.fecha_expiracion_trial <= NOW()`
  );
  return result.rows;
}

async function marcarAviso2DiasEnviado(empresaId) {
  await pool.query('UPDATE empresas SET aviso_2dias_enviado = true WHERE id = $1', [empresaId]);
}

async function marcarAvisoVencidoEnviado(empresaId) {
  await pool.query('UPDATE empresas SET aviso_vencido_enviado = true WHERE id = $1', [empresaId]);
}

async function marcarSuscripcionCancelada(empresaId, accesoHasta) {
  const result = await pool.query(
    'UPDATE empresas SET suscripcion_cancelada_en = NOW(), acceso_hasta = $1 WHERE id = $2 RETURNING *',
    [accesoHasta || null, empresaId]
  );
  return result.rows[0] || null;
}

/**
 * Empresas con suscripción cancelada a las que hay que avisar que faltan
 * ~2 días para que se corte el acceso (mismo umbral que el aviso de trial).
 */
async function listarEmpresasParaAvisoAcceso2Dias() {
  const result = await pool.query(
    `SELECT e.id AS empresa_id, e.nombre_empresa, e.acceso_hasta, u.email, u.nombre
     FROM empresas e
     JOIN users u ON u.empresa_id = e.id
     WHERE e.suscripcion_cancelada_en IS NOT NULL
       AND e.aviso_acceso_2dias_enviado = false
       AND e.acceso_hasta > NOW()
       AND e.acceso_hasta <= NOW() + INTERVAL '2 days'`
  );
  return result.rows;
}

/**
 * Empresas con suscripción cancelada cuyo acceso_hasta YA pasó y todavía
 * están con estado_pago='activo' (o sea, todavía no se les cortó el acceso
 * de verdad) — a estas hay que avisarles Y cortarles el acceso en el mismo
 * paso (ver avisos-trial.js).
 */
async function listarEmpresasParaCorteDeAcceso() {
  const result = await pool.query(
    `SELECT e.id AS empresa_id, e.nombre_empresa, u.email, u.nombre
     FROM empresas e
     JOIN users u ON u.empresa_id = e.id
     WHERE e.suscripcion_cancelada_en IS NOT NULL
       AND e.aviso_acceso_terminado_enviado = false
       AND e.acceso_hasta <= NOW()
       AND e.estado_pago = 'activo'`
  );
  return result.rows;
}

async function marcarAvisoAcceso2DiasEnviado(empresaId) {
  await pool.query('UPDATE empresas SET aviso_acceso_2dias_enviado = true WHERE id = $1', [empresaId]);
}

/**
 * Corta el acceso de verdad (estado_pago -> 'pendiente', mismo estado que ya
 * usa requireEmpresaActiva.middleware.js para bloquear) y marca el aviso
 * como enviado, en una sola operación — se usa DESPUÉS de mandar el correo.
 */
async function marcarAvisoAccesoTerminadoYCortarAcceso(empresaId) {
  await pool.query(
    `UPDATE empresas SET aviso_acceso_terminado_enviado = true, estado_pago = 'pendiente' WHERE id = $1`,
    [empresaId]
  );
}

module.exports = {
  crearEmpresa,
  buscarEmpresaPorRut,
  buscarEmpresaPorId,
  buscarEmpresaPorSuscripcion,
  obtenerRutDeUsuario,
  contarUsuariosDeEmpresa,
  guardarSuscripcionMercadoPago,
  activarPagoEmpresa,
  actualizarPlanEmpresa,
  eliminarEmpresa,
  listarEmpresasParaAviso2Dias,
  listarEmpresasParaAvisoVencido,
  marcarAviso2DiasEnviado,
  marcarAvisoVencidoEnviado,
  marcarSuscripcionCancelada,
  listarEmpresasParaAvisoAcceso2Dias,
  listarEmpresasParaCorteDeAcceso,
  marcarAvisoAcceso2DiasEnviado,
  marcarAvisoAccesoTerminadoYCortarAcceso,
};
