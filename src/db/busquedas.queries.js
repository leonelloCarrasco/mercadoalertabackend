const pool = require('./pool');

function normalizarArrayOpcional(valores) {
  return (valores && valores.length > 0) ? valores : null;
}

async function crearBusqueda(userId, {
  nombre, tipo, modo, codigoExterno, estado, fecha, rutProveedor,
  textoLibre, estados, horasRecientes, regiones, organismos,
}) {
  const result = await pool.query(
    `INSERT INTO busquedas_guardadas
       (user_id, nombre, tipo, modo, codigo_externo, estado, fecha, rut_proveedor,
        texto_libre, estados, horas_recientes, regiones, organismos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      userId,
      nombre,
      tipo,
      modo || null,
      codigoExterno || null,
      estado || null,
      fecha || null,
      rutProveedor || null,
      textoLibre || null,
      normalizarArrayOpcional(estados),
      horasRecientes || null,
      normalizarArrayOpcional(regiones),
      normalizarArrayOpcional(organismos),
    ]
  );
  return result.rows[0];
}

async function listarBusquedasDeUsuario(userId) {
  const result = await pool.query(
    'SELECT * FROM busquedas_guardadas WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows;
}

async function contarBusquedasDeUsuario(userId) {
  const result = await pool.query(
    'SELECT COUNT(*)::int AS total FROM busquedas_guardadas WHERE user_id = $1',
    [userId]
  );
  return result.rows[0].total;
}

async function obtenerBusquedaPorId(id, userId) {
  const result = await pool.query(
    'SELECT * FROM busquedas_guardadas WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return result.rows[0] || null;
}

async function eliminarBusqueda(id, userId) {
  const result = await pool.query(
    'DELETE FROM busquedas_guardadas WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return result.rowCount > 0;
}

module.exports = {
  crearBusqueda,
  listarBusquedasDeUsuario,
  contarBusquedasDeUsuario,
  obtenerBusquedaPorId,
  eliminarBusqueda,
};
