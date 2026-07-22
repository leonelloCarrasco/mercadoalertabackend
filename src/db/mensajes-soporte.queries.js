const pool = require('./pool');

async function crearMensajeSoporte({ userId, email, nombre, asunto, mensaje, emailEnviado }) {
  const result = await pool.query(
    `INSERT INTO mensajes_soporte (user_id, email, nombre, asunto, mensaje, email_enviado)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, email, nombre || null, asunto, mensaje, emailEnviado]
  );
  return result.rows[0];
}

module.exports = { crearMensajeSoporte };
