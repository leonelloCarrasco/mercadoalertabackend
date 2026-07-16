const pool = require('./pool');

async function crearRecordatorio(userId, { tipoProceso, codigoExterno, horasAntes }) {
  const result = await pool.query(
    `INSERT INTO recordatorios_cierre (user_id, tipo_proceso, codigo_externo, horas_antes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, tipo_proceso, codigo_externo) DO UPDATE SET horas_antes = EXCLUDED.horas_antes, notificado_at = NULL
     RETURNING *`,
    [userId, tipoProceso, codigoExterno, horasAntes]
  );
  return result.rows[0];
}

/**
 * Trae los recordatorios del usuario con el detalle de la licitación/Compra
 * Ágil correspondiente (nombre, organismo, región, monto, fecha de cierre) —
 * mismo patrón que listarHistorialUsuario en alerts-sent.queries.js.
 */
async function listarRecordatoriosDeUsuario(userId) {
  const result = await pool.query(
    `SELECT
       r.id, r.tipo_proceso, r.codigo_externo, r.horas_antes, r.notificado_at, r.created_at,
       COALESCE(l.nombre, c.nombre) AS nombre,
       COALESCE(l.nombre_organismo, c.nombre_institucion) AS organismo,
       COALESCE(l.region, c.region) AS region,
       COALESCE(l.monto_estimado, c.monto_estimado) AS monto,
       COALESCE(l.fecha_cierre, c.fecha_cierre) AS fecha_cierre
     FROM recordatorios_cierre r
     LEFT JOIN licitaciones_vistas l ON r.tipo_proceso = 'licitacion' AND r.codigo_externo = l.codigo_externo
     LEFT JOIN compras_agiles_vistas c ON r.tipo_proceso = 'compra_agil' AND r.codigo_externo = c.codigo_externo
     WHERE r.user_id = $1
     ORDER BY COALESCE(l.fecha_cierre, c.fecha_cierre) ASC NULLS LAST`,
    [userId]
  );
  return result.rows;
}

async function contarRecordatoriosDeUsuario(userId) {
  const result = await pool.query('SELECT COUNT(*)::int AS total FROM recordatorios_cierre WHERE user_id = $1', [userId]);
  return result.rows[0].total;
}

async function eliminarRecordatorio(id, userId) {
  const result = await pool.query(
    'DELETE FROM recordatorios_cierre WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return result.rowCount > 0;
}

/**
 * Recordatorios pendientes cuya ventana ya se cumplió (fecha_cierre - horas_antes
 * <= NOW()) pero que todavía no cerraron (fecha_cierre > NOW() — si ya cerró,
 * ya no tiene sentido "recordar", así que se descarta en silencio). Trae
 * directo el email/telegram_chat_id del usuario (join con users) y los datos
 * de display, todo en una sola consulta — el job de recordatorio-cierre.js
 * no necesita pedir nada más para poder notificar.
 */
async function listarRecordatoriosPendientes() {
  const result = await pool.query(
    `SELECT
       r.id, r.user_id, r.tipo_proceso, r.codigo_externo, r.horas_antes,
       u.email, u.telegram_chat_id,
       COALESCE(l.nombre, c.nombre) AS nombre,
       COALESCE(l.nombre_organismo, c.nombre_institucion) AS organismo,
       COALESCE(l.monto_estimado, c.monto_estimado) AS monto,
       COALESCE(l.fecha_cierre, c.fecha_cierre) AS fecha_cierre
     FROM recordatorios_cierre r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN licitaciones_vistas l ON r.tipo_proceso = 'licitacion' AND r.codigo_externo = l.codigo_externo
     LEFT JOIN compras_agiles_vistas c ON r.tipo_proceso = 'compra_agil' AND r.codigo_externo = c.codigo_externo
     WHERE r.notificado_at IS NULL
       AND COALESCE(l.fecha_cierre, c.fecha_cierre) IS NOT NULL
       AND COALESCE(l.fecha_cierre, c.fecha_cierre) > NOW()
       AND COALESCE(l.fecha_cierre, c.fecha_cierre) - make_interval(hours => r.horas_antes) <= NOW()`
  );
  return result.rows;
}

async function marcarRecordatorioNotificado(id) {
  await pool.query('UPDATE recordatorios_cierre SET notificado_at = NOW() WHERE id = $1', [id]);
}

module.exports = {
  crearRecordatorio,
  listarRecordatoriosDeUsuario,
  contarRecordatoriosDeUsuario,
  eliminarRecordatorio,
  listarRecordatoriosPendientes,
  marcarRecordatorioNotificado,
};
