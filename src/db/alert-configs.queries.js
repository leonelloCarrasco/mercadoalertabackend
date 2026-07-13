const pool = require('./pool');

/**
 * Normaliza un array "opcional": [] o undefined -> null (significa "sin
 * filtrar por esto" — mismo criterio para regiones, tipos_proceso,
 * tramos_licitacion y organismos, ver matching.service.js).
 */
function normalizarArrayOpcional(valores) {
  return (valores && valores.length > 0) ? valores : null;
}

/**
 * Único campo obligatorio: categorias (producto/rubro, máximo 1 — ver
 * validarCamposObligatorios en alerts.routes.js). El resto son criterios
 * opcionales que "no filtran" si vienen vacíos.
 */
async function crearAlertConfig(userId, { categorias, montoMinimo, montoMaximo, regiones, tiposProceso, tramosLicitacion, organismos }) {
  const result = await pool.query(
    `INSERT INTO alert_configs (user_id, categorias, monto_minimo, monto_maximo, regiones, tipos_proceso, tramos_licitacion, organismos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      userId,
      categorias || [],
      montoMinimo || null,
      montoMaximo || null,
      normalizarArrayOpcional(regiones),
      normalizarArrayOpcional(tiposProceso),
      normalizarArrayOpcional(tramosLicitacion),
      normalizarArrayOpcional(organismos),
    ]
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

/**
 * Cada array opcional sigue el mismo patrón "nullable a propósito": si viene
 * undefined, no se toca (COALESCE deja lo que ya había); si viene [] explícito,
 * se guarda como NULL ("sin filtrar por esto"). montoMinimo/montoMaximo usan
 * COALESCE simple porque no tienen ese matiz (o se manda un número, o no se toca).
 */
async function actualizarAlertConfig(id, userId, { categorias, montoMinimo, montoMaximo, regiones, tiposProceso, tramosLicitacion, organismos, activo }) {
  const regionesAGuardar = regiones !== undefined ? normalizarArrayOpcional(regiones) : undefined;
  const tiposProcesoAGuardar = tiposProceso !== undefined ? normalizarArrayOpcional(tiposProceso) : undefined;
  const tramosLicitacionAGuardar = tramosLicitacion !== undefined ? normalizarArrayOpcional(tramosLicitacion) : undefined;
  const organismosAGuardar = organismos !== undefined ? normalizarArrayOpcional(organismos) : undefined;

  const result = await pool.query(
    `UPDATE alert_configs
     SET categorias = COALESCE($1, categorias),
         monto_minimo = COALESCE($2, monto_minimo),
         monto_maximo = COALESCE($3, monto_maximo),
         regiones = CASE WHEN $4::boolean THEN $5 ELSE regiones END,
         tipos_proceso = CASE WHEN $6::boolean THEN $7 ELSE tipos_proceso END,
         tramos_licitacion = CASE WHEN $8::boolean THEN $9 ELSE tramos_licitacion END,
         organismos = CASE WHEN $10::boolean THEN $11 ELSE organismos END,
         activo = COALESCE($12, activo)
     WHERE id = $13 AND user_id = $14
     RETURNING *`,
    [
      categorias, montoMinimo, montoMaximo,
      regiones !== undefined, regionesAGuardar,
      tiposProceso !== undefined, tiposProcesoAGuardar,
      tramosLicitacion !== undefined, tramosLicitacionAGuardar,
      organismos !== undefined, organismosAGuardar,
      activo, id, userId,
    ]
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
