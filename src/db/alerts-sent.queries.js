const pool = require('./pool');

/**
 * Intenta "reservar" el derecho a enviar esta alerta, de forma atómica a nivel
 * de base de datos (usando el constraint UNIQUE como candado). Si dos procesos
 * compiten por la misma licitación/canal al mismo tiempo (ej. el cron automático
 * y una corrida manual), solo uno de los dos va a ganar la reserva.
 *
 * alertConfigId: qué alerta específica del usuario generó este envío (migración
 * 027) — un usuario puede tener varias activas a la vez. Es solo informativo
 * (para historial/depuración), no participa en la lógica de deduplicación
 * (el UNIQUE sigue siendo por user_id+codigo_externo+canal, no por alerta).
 *
 * Devuelve el id del registro si la reserva fue exitosa (→ hay que enviar),
 * o null si ya estaba reservada/enviada antes (→ no enviar, evitar duplicado).
 */
async function intentarReservarEnvio(userId, codigoExterno, tipoProceso, canal, alertConfigId = null) {
  const result = await pool.query(
    `INSERT INTO alerts_sent (user_id, codigo_externo, tipo_proceso, canal, alert_config_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, codigo_externo, canal) DO NOTHING
     RETURNING id`,
    [userId, codigoExterno, tipoProceso, canal, alertConfigId]
  );
  return result.rows[0]?.id || null;
}

/**
 * Libera una reserva (borra el registro) si el envío falló después de reservar —
 * así la próxima corrida del polling puede reintentarlo, en vez de quedar
 * marcado como "enviado" cuando en realidad nunca llegó.
 */
async function liberarReserva(id) {
  await pool.query('DELETE FROM alerts_sent WHERE id = $1', [id]);
}

/**
 * Trae el historial de alertas enviadas a un usuario, con el detalle del proceso
 * (nombre, monto, fecha de cierre, región y organismo comprador) sacado de la
 * tabla que corresponda según tipo_proceso.
 */
async function listarHistorialUsuario(userId) {
  const result = await pool.query(
    `SELECT
       a.id,
       a.alert_config_id,
       a.codigo_externo,
       a.tipo_proceso,
       a.canal,
       a.sent_at,
       COALESCE(l.nombre, c.nombre) AS nombre,
       COALESCE(l.monto_estimado, c.monto_estimado) AS monto,
       l.monto_utm_min,
       l.monto_utm_max,
       COALESCE(l.fecha_cierre, c.fecha_cierre) AS fecha_cierre,
       COALESCE(l.region, c.region) AS region,
       COALESCE(l.nombre_organismo, c.nombre_institucion) AS organismo
     FROM alerts_sent a
     LEFT JOIN licitaciones_vistas l ON a.tipo_proceso = 'licitacion' AND a.codigo_externo = l.codigo_externo
     LEFT JOIN compras_agiles_vistas c ON a.tipo_proceso = 'compra_agil' AND a.codigo_externo = c.codigo_externo
     WHERE a.user_id = $1
     ORDER BY a.sent_at DESC
     LIMIT 100`,
    [userId]
  );
  return result.rows;
}

module.exports = { intentarReservarEnvio, liberarReserva, listarHistorialUsuario };
