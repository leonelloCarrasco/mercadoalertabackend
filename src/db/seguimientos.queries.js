const pool = require('./pool');

/**
 * `estadoActual` se pide desde afuera (no se resuelve acá adentro) porque
 * hace falta ANTES de insertar — se usa como punto de partida de
 * ultimo_estado_notificado, para que el primer chequeo del job no dispare
 * una notificación falsa (ver migración 035).
 *
 * `origen` ('manual' default, o 'pipeline' — migración 036) distingue un
 * seguimiento que el usuario activó a propósito de uno que el pipeline creó
 * solo por detrás, para poder limpiarlo si corresponde al sacar el ítem del
 * pipeline (ver eliminarSeguimientoSiOrigen más abajo).
 */
async function crearSeguimiento(userId, codigoExterno, estadoActual, origen = 'manual') {
  const result = await pool.query(
    `INSERT INTO seguimientos_licitacion (user_id, codigo_externo, ultimo_estado_notificado, origen)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, codigo_externo) DO NOTHING
     RETURNING *`,
    [userId, codigoExterno, estadoActual, origen]
  );
  return result.rows[0] || null;
}

async function listarSeguimientosDeUsuario(userId) {
  const result = await pool.query(
    `SELECT
       s.id, s.codigo_externo, s.ultimo_estado_notificado, s.origen, s.created_at,
       l.nombre, l.nombre_organismo AS organismo, l.region, l.monto_estimado AS monto,
       l.fecha_cierre, l.estado, l.resuelta, l.fecha_adjudicacion
     FROM seguimientos_licitacion s
     LEFT JOIN licitaciones_vistas l ON s.codigo_externo = l.codigo_externo
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC`,
    [userId]
  );
  return result.rows;
}

async function contarSeguimientosDeUsuario(userId) {
  const result = await pool.query('SELECT COUNT(*)::int AS total FROM seguimientos_licitacion WHERE user_id = $1', [userId]);
  return result.rows[0].total;
}

/**
 * ¿El usuario ya sigue este código, sea cual sea el origen? Usada por el
 * pipeline (routes/pipeline.routes.js) para decidir si hace falta crear un
 * seguimiento nuevo al agregar algo, o si ya existía uno (manual o de otro
 * ítem de pipeline) y no hay que gastar cupo de nuevo.
 */
async function obtenerSeguimientoPorUsuarioYCodigo(userId, codigoExterno) {
  const result = await pool.query(
    'SELECT * FROM seguimientos_licitacion WHERE user_id = $1 AND codigo_externo = $2',
    [userId, codigoExterno]
  );
  return result.rows[0] || null;
}

async function eliminarSeguimiento(id, userId) {
  const result = await pool.query(
    'DELETE FROM seguimientos_licitacion WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return result.rowCount > 0;
}

/**
 * Elimina el seguimiento de un código SOLO si su origen coincide con el que
 * se pide — usada al sacar algo del pipeline: si el seguimiento de atrás era
 * 'pipeline' (lo creamos nosotros solos), se borra junto con el ítem; si era
 * 'manual' (el usuario lo había activado aparte), se deja intacto.
 */
async function eliminarSeguimientoSiOrigen(userId, codigoExterno, origen) {
  const result = await pool.query(
    'DELETE FROM seguimientos_licitacion WHERE user_id = $1 AND codigo_externo = $2 AND origen = $3 RETURNING id',
    [userId, codigoExterno, origen]
  );
  return result.rowCount > 0;
}

/**
 * Códigos ÚNICOS a revisar en esta corrida del job — si varios usuarios
 * siguen la misma licitación, se pide el detalle a la API UNA sola vez (ver
 * seguimiento-estado.js). Excluye las que ya están resuelta=true en
 * licitaciones_vistas: una vez en estado final no hay más cambios que esperar.
 */
async function listarCodigosSeguidosUnicos() {
  const result = await pool.query(
    `SELECT DISTINCT s.codigo_externo
     FROM seguimientos_licitacion s
     LEFT JOIN licitaciones_vistas l ON s.codigo_externo = l.codigo_externo
     WHERE l.resuelta IS NOT TRUE`
  );
  return result.rows.map((r) => r.codigo_externo);
}

/**
 * Todos los seguimientos (de cualquier usuario) de un código puntual, con el
 * email/telegram_chat_id de cada usuario ya resuelto — para notificar a cada
 * uno que corresponda en esta corrida (ver seguimiento-estado.js).
 */
async function listarSeguidoresPorCodigo(codigoExterno) {
  const result = await pool.query(
    `SELECT s.id, s.user_id, s.ultimo_estado_notificado, u.email, u.telegram_chat_id
     FROM seguimientos_licitacion s
     JOIN users u ON u.id = s.user_id
     WHERE s.codigo_externo = $1`,
    [codigoExterno]
  );
  return result.rows;
}

async function actualizarUltimoEstadoNotificado(id, estado) {
  await pool.query('UPDATE seguimientos_licitacion SET ultimo_estado_notificado = $1 WHERE id = $2', [estado, id]);
}

module.exports = {
  crearSeguimiento,
  listarSeguimientosDeUsuario,
  contarSeguimientosDeUsuario,
  obtenerSeguimientoPorUsuarioYCodigo,
  eliminarSeguimiento,
  eliminarSeguimientoSiOrigen,
  listarCodigosSeguidosUnicos,
  listarSeguidoresPorCodigo,
  actualizarUltimoEstadoNotificado,
};
