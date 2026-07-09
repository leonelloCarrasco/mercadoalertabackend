const pool = require('./pool');

async function crearAlertConfig(userId, { categorias, montoMinimo, region }) {
  const result = await pool.query(
    `INSERT INTO alert_configs (user_id, categorias, monto_minimo, region)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, categorias || [], montoMinimo || null, region || null]
  );
  return result.rows[0];
}

async function listarAlertConfigsDeUsuario(userId) {
  const result = await pool.query(
    'SELECT * FROM alert_configs WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows;
}

/**
 * Cuenta cuántas configuraciones ACTIVAS tiene un usuario. Las pausadas no
 * cuentan contra el límite del plan. Si se pasa excludeConfigId, esa configuración
 * se excluye del conteo — útil al reactivar una config existente sin contarla dos veces.
 */
async function contarConfigsActivasDeUsuario(userId, excludeConfigId = null) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS total FROM alert_configs
     WHERE user_id = $1 AND activo = true
       AND ($2::int IS NULL OR id != $2)`,
    [userId, excludeConfigId]
  );
  return result.rows[0].total;
}

/**
 * Trae todas las configuraciones activas de todos los usuarios, con el email
 * y telegram_chat_id ya incluidos (join con users) — para usar en el matching.
 */
async function listarAlertConfigsActivas() {
  const result = await pool.query(`
    SELECT ac.*, u.email, u.telegram_chat_id
    FROM alert_configs ac
    JOIN users u ON u.id = ac.user_id
    WHERE ac.activo = true
  `);
  return result.rows;
}

async function obtenerAlertConfigPorId(id, userId) {
  const result = await pool.query(
    'SELECT * FROM alert_configs WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return result.rows[0] || null;
}

async function actualizarAlertConfig(id, userId, { categorias, montoMinimo, region, activo }) {
  const result = await pool.query(
    `UPDATE alert_configs
     SET categorias = COALESCE($1, categorias),
         monto_minimo = COALESCE($2, monto_minimo),
         region = COALESCE($3, region),
         activo = COALESCE($4, activo)
     WHERE id = $5 AND user_id = $6
     RETURNING *`,
    [categorias, montoMinimo, region, activo, id, userId]
  );
  return result.rows[0] || null;
}

async function eliminarAlertConfig(id, userId) {
  const result = await pool.query(
    'DELETE FROM alert_configs WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return result.rowCount > 0;
}

module.exports = {
  crearAlertConfig,
  listarAlertConfigsDeUsuario,
  listarAlertConfigsActivas,
  contarConfigsActivasDeUsuario,
  obtenerAlertConfigPorId,
  actualizarAlertConfig,
  eliminarAlertConfig,
};
