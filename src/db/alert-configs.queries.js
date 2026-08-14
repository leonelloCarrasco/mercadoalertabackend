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
 * categorias/palabrasClave: al menos uno de los dos tiene que venir con
 * contenido (ver validarCamposObligatorios en alerts.routes.js — ya NO es
 * "categorias siempre obligatorio", es "categorias O palabrasClave"). El
 * resto son criterios opcionales que "no filtran" si vienen vacíos.
 */
async function crearAlertConfig(userId, { categorias, palabrasClave, palabrasClaveExcluir, montoMinimo, montoMaximo, regiones, tiposProceso, tramosLicitacion, organismos }) {
  const result = await pool.query(
    `INSERT INTO alert_configs (user_id, categorias, palabras_clave, palabras_clave_excluir, monto_minimo, monto_maximo, regiones, tipos_proceso, tramos_licitacion, organismos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      userId,
      categorias || [],
      normalizarArrayOpcional(palabrasClave),
      normalizarArrayOpcional(palabrasClaveExcluir),
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
    SELECT ac.*, u.email, u.nombre, u.telegram_chat_id, u.whatsapp_numero, u.whatsapp_verificado, u.empresa_id, e.plan
    FROM alert_configs ac
    JOIN users u ON u.id = ac.user_id
    JOIN empresas e ON e.id = u.empresa_id
    WHERE ac.activo = true
  `);
  return result.rows;
}

/**
 * Igual que listarAlertConfigsActivas pero para UNA sola config por id (con
 * el email/telegram_chat_id/whatsapp/plan del usuario ya unidos) — usada
 * justo después de crear una alerta, para el backfill contra procesos ya
 * publicados (ver procesarBackfillNuevaAlerta en alerting.service.js).
 * crearAlertConfig devuelve la fila cruda de alert_configs sin esos campos,
 * porque viven en users/empresas.
 */
async function obtenerAlertConfigConContacto(id) {
  const result = await pool.query(`
    SELECT ac.*, u.email, u.nombre, u.telegram_chat_id, u.whatsapp_numero, u.whatsapp_verificado, u.empresa_id, e.plan
    FROM alert_configs ac
    JOIN users u ON u.id = ac.user_id
    JOIN empresas e ON e.id = u.empresa_id
    WHERE ac.id = $1
  `, [id]);
  return result.rows[0] || null;
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
async function actualizarAlertConfig(id, userId, { categorias, palabrasClave, palabrasClaveExcluir, montoMinimo, montoMaximo, regiones, tiposProceso, tramosLicitacion, organismos, activo }) {
  const regionesAGuardar = regiones !== undefined ? normalizarArrayOpcional(regiones) : undefined;
  const tiposProcesoAGuardar = tiposProceso !== undefined ? normalizarArrayOpcional(tiposProceso) : undefined;
  const tramosLicitacionAGuardar = tramosLicitacion !== undefined ? normalizarArrayOpcional(tramosLicitacion) : undefined;
  const organismosAGuardar = organismos !== undefined ? normalizarArrayOpcional(organismos) : undefined;
  const palabrasClaveAGuardar = palabrasClave !== undefined ? normalizarArrayOpcional(palabrasClave) : undefined;
  const palabrasClaveExcluirAGuardar = palabrasClaveExcluir !== undefined ? normalizarArrayOpcional(palabrasClaveExcluir) : undefined;

  const result = await pool.query(
    `UPDATE alert_configs
     SET categorias = COALESCE($1, categorias),
         monto_minimo = COALESCE($2, monto_minimo),
         monto_maximo = COALESCE($3, monto_maximo),
         regiones = CASE WHEN $4::boolean THEN $5 ELSE regiones END,
         tipos_proceso = CASE WHEN $6::boolean THEN $7 ELSE tipos_proceso END,
         tramos_licitacion = CASE WHEN $8::boolean THEN $9 ELSE tramos_licitacion END,
         organismos = CASE WHEN $10::boolean THEN $11 ELSE organismos END,
         palabras_clave = CASE WHEN $12::boolean THEN $13 ELSE palabras_clave END,
         palabras_clave_excluir = CASE WHEN $14::boolean THEN $15 ELSE palabras_clave_excluir END,
         activo = COALESCE($16, activo)
     WHERE id = $17 AND user_id = $18
     RETURNING *`,
    [
      categorias, montoMinimo, montoMaximo,
      regiones !== undefined, regionesAGuardar,
      tiposProceso !== undefined, tiposProcesoAGuardar,
      tramosLicitacion !== undefined, tramosLicitacionAGuardar,
      organismos !== undefined, organismosAGuardar,
      palabrasClave !== undefined, palabrasClaveAGuardar,
      palabrasClaveExcluir !== undefined, palabrasClaveExcluirAGuardar,
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
  obtenerAlertConfigConContacto,
  contarConfigsActivasDeUsuario,
  obtenerAlertConfigPorId,
  actualizarAlertConfig,
  eliminarAlertConfig,
};
