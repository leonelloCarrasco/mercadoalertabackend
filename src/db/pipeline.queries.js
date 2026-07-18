const pool = require('./pool');

const ESTADOS_VALIDOS = ['por_evaluar', 'evaluando', 'preparando_oferta', 'oferta_enviada', 'ganada', 'perdida', 'descartada'];

async function crearItemPipeline(userId, { tipoProceso, codigoExterno, estadoPersonal }) {
  const result = await pool.query(
    `INSERT INTO pipeline_oportunidades (user_id, tipo_proceso, codigo_externo, estado_personal)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, tipo_proceso, codigo_externo) DO NOTHING
     RETURNING *`,
    [userId, tipoProceso, codigoExterno, estadoPersonal || 'por_evaluar']
  );
  return result.rows[0] || null;
}

/**
 * Trae el pipeline del usuario con el detalle del proceso (nombre, organismo,
 * región, monto, fecha de cierre) — mismo patrón que listarRecordatoriosDeUsuario.
 */
async function listarPipelineDeUsuario(userId) {
  const result = await pool.query(
    `SELECT
       p.id, p.tipo_proceso, p.codigo_externo, p.estado_personal, p.nota, p.created_at, p.updated_at,
       COALESCE(l.nombre, c.nombre) AS nombre,
       COALESCE(l.nombre_organismo, c.nombre_institucion) AS organismo,
       COALESCE(l.region, c.region) AS region,
       COALESCE(l.monto_estimado, c.monto_estimado) AS monto,
       COALESCE(l.fecha_cierre, c.fecha_cierre) AS fecha_cierre
     FROM pipeline_oportunidades p
     LEFT JOIN licitaciones_vistas l ON p.tipo_proceso = 'licitacion' AND p.codigo_externo = l.codigo_externo
     LEFT JOIN compras_agiles_vistas c ON p.tipo_proceso = 'compra_agil' AND p.codigo_externo = c.codigo_externo
     WHERE p.user_id = $1
     ORDER BY p.updated_at DESC`,
    [userId]
  );
  return result.rows;
}

async function contarPipelineDeUsuario(userId) {
  const result = await pool.query('SELECT COUNT(*)::int AS total FROM pipeline_oportunidades WHERE user_id = $1', [userId]);
  return result.rows[0].total;
}

async function obtenerItemPipeline(id, userId) {
  const result = await pool.query(
    'SELECT * FROM pipeline_oportunidades WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return result.rows[0] || null;
}

/**
 * Usada por la detección automática de ganado/perdido (seguimiento-estado.js) —
 * dado un usuario y un código de licitación, ¿tiene un ítem de pipeline para
 * eso? No filtra por tipo_proceso porque la detección automática solo existe
 * para licitaciones de todas formas.
 */
async function obtenerItemPipelinePorCodigo(userId, codigoExterno) {
  const result = await pool.query(
    "SELECT * FROM pipeline_oportunidades WHERE user_id = $1 AND codigo_externo = $2 AND tipo_proceso = 'licitacion'",
    [userId, codigoExterno]
  );
  return result.rows[0] || null;
}

async function actualizarEstadoPipeline(id, userId, estadoPersonal) {
  const result = await pool.query(
    `UPDATE pipeline_oportunidades SET estado_personal = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [estadoPersonal, id, userId]
  );
  return result.rows[0] || null;
}

async function actualizarNotaPipeline(id, userId, nota) {
  const result = await pool.query(
    `UPDATE pipeline_oportunidades SET nota = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [nota, id, userId]
  );
  return result.rows[0] || null;
}

async function eliminarItemPipeline(id, userId) {
  const result = await pool.query(
    'DELETE FROM pipeline_oportunidades WHERE id = $1 AND user_id = $2 RETURNING id, tipo_proceso, codigo_externo',
    [id, userId]
  );
  return result.rows[0] || null;
}

module.exports = {
  ESTADOS_VALIDOS,
  crearItemPipeline,
  listarPipelineDeUsuario,
  contarPipelineDeUsuario,
  obtenerItemPipeline,
  obtenerItemPipelinePorCodigo,
  actualizarEstadoPipeline,
  actualizarNotaPipeline,
  eliminarItemPipeline,
};
