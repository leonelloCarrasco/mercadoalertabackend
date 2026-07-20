const pool = require('./pool');

/**
 * El análisis PROPIO de este usuario para ese proceso — no el de cualquiera
 * (regla C: cada usuario tiene su copia independiente, no hay caché
 * compartido entre usuarios distintos).
 */
async function buscarMiAnalisis(userId, tipoProceso, codigoExterno) {
  const result = await pool.query(
    'SELECT * FROM analisis_ia WHERE user_id = $1 AND tipo_proceso = $2 AND codigo_externo = $3',
    [userId, tipoProceso, codigoExterno]
  );
  return result.rows[0] || null;
}

/**
 * ¿Existe YA un análisis (de cualquier usuario) para este proceso con este
 * mismo hash de archivo? — es el chequeo que evita llamar a la IA de nuevo
 * sobre un archivo idéntico byte por byte (ver migración 040). Si lo hay,
 * se usa su `contenido` para hacerle una copia al usuario que la pide, sin
 * volver a analizar.
 */
async function buscarAnalisisPorHash(tipoProceso, codigoExterno, archivoHash) {
  const result = await pool.query(
    `SELECT * FROM analisis_ia
     WHERE tipo_proceso = $1 AND codigo_externo = $2 AND archivo_hash = $3
     ORDER BY updated_at DESC LIMIT 1`,
    [tipoProceso, codigoExterno, archivoHash]
  );
  return result.rows[0] || null;
}

/**
 * Igual que buscarAnalisisPorHash, pero para el modo "sin adjuntos" (no hay
 * archivo, así que no hay hash que comparar) — la fuente ahí es siempre la
 * misma ficha pública, así que cualquier análisis "sin adjuntos" ya hecho
 * para este proceso sirve de copia, EXCEPTO si la fecha de cierre cambió
 * desde entonces (señal de que las bases pudieron modificarse — ver
 * analisis-ia.routes.js, que hace esa comparación antes de decidir copiar).
 */
async function buscarAnalisisSinAdjuntos(tipoProceso, codigoExterno) {
  const result = await pool.query(
    `SELECT * FROM analisis_ia
     WHERE tipo_proceso = $1 AND codigo_externo = $2 AND sin_adjuntos = true
     ORDER BY updated_at DESC LIMIT 1`,
    [tipoProceso, codigoExterno]
  );
  return result.rows[0] || null;
}

/**
 * Crea o reemplaza (UPDATE, no versiona) EL análisis de ESTE usuario para
 * ese proceso — "rehacer" pisa la fila del propio usuario, nunca la de otro.
 */
async function guardarAnalisis({ userId, tipoProceso, codigoExterno, nombre, contenido, sinAdjuntos, archivoHash, fechaCierreSnapshot }) {
  const result = await pool.query(
    `INSERT INTO analisis_ia (user_id, tipo_proceso, codigo_externo, nombre, contenido, sin_adjuntos, archivo_hash, fecha_cierre_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, tipo_proceso, codigo_externo) DO UPDATE SET
       nombre = EXCLUDED.nombre,
       contenido = EXCLUDED.contenido,
       sin_adjuntos = EXCLUDED.sin_adjuntos,
       archivo_hash = EXCLUDED.archivo_hash,
       fecha_cierre_snapshot = EXCLUDED.fecha_cierre_snapshot,
       updated_at = NOW()
     RETURNING *`,
    [userId, tipoProceso, codigoExterno, nombre, JSON.stringify(contenido), sinAdjuntos, archivoHash || null, fechaCierreSnapshot || null]
  );
  return result.rows[0];
}

async function listarMisAnalisis(userId) {
  const result = await pool.query(
    'SELECT * FROM analisis_ia WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId]
  );
  return result.rows;
}

/**
 * Ciclo rotativo (regla A): NO es mes calendario. Devuelve la fecha de
 * inicio del ciclo vigente, o null si nunca empezó uno, o si el que había
 * ya venció (más de 1 mes desde que arrancó) — en los dos casos "null" se
 * interpreta como "el usuario está en 0 consumido, listo para un ciclo nuevo".
 */
async function obtenerCicloVigente(userId) {
  const result = await pool.query('SELECT analisis_ciclo_inicio FROM users WHERE id = $1', [userId]);
  const inicio = result.rows[0]?.analisis_ciclo_inicio;
  if (!inicio) return null;

  const finCiclo = new Date(inicio);
  finCiclo.setMonth(finCiclo.getMonth() + 1);
  return new Date() < finCiclo ? inicio : null;
}

/**
 * Cuenta los consumos DENTRO del ciclo vigente — si cicloInicio es null
 * (nunca arrancó uno, o el anterior ya venció), el conteo es 0 sin ni
 * siquiera consultar la tabla de consumos: un ciclo vencido no arrastra
 * nada (regla A, "no se traspasan cuotas sin uso al siguiente periodo" —
 * y por la misma razón, tampoco arrastra consumos ya gastados).
 */
async function contarConsumosDelCiclo(userId, cicloInicio) {
  if (!cicloInicio) return 0;
  const result = await pool.query(
    'SELECT COUNT(*)::int AS total FROM analisis_ia_consumos WHERE user_id = $1 AND created_at >= $2',
    [userId, cicloInicio]
  );
  return result.rows[0].total;
}

/**
 * Registra el consumo y, si hace falta, arranca un ciclo nuevo (cuando no
 * había uno vigente — ver obtenerCicloVigente). Se llama SIEMPRE que un
 * análisis se guarda con éxito, sea por IA real o por copia de hash (regla
 * B: reprocesar/copiar igual gasta cupo).
 */
async function registrarConsumo(userId, analisisId, cicloVigente) {
  if (!cicloVigente) {
    await pool.query('UPDATE users SET analisis_ciclo_inicio = NOW() WHERE id = $1', [userId]);
  }
  await pool.query('INSERT INTO analisis_ia_consumos (user_id, analisis_id) VALUES ($1, $2)', [userId, analisisId]);
}

module.exports = {
  buscarMiAnalisis,
  buscarAnalisisPorHash,
  buscarAnalisisSinAdjuntos,
  guardarAnalisis,
  listarMisAnalisis,
  obtenerCicloVigente,
  contarConsumosDelCiclo,
  registrarConsumo,
};
