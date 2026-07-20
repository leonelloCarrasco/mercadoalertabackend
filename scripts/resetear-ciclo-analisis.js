/**
 * Script de utilidad para PROBAR el reinicio de cuota sin esperar un mes de
 * verdad.
 *
 * Corre con:
 *   node scripts/resetear-ciclo-analisis.js tucorreo@ejemplo.com vencer   (hace como si tu ciclo ya venció → próximo análisis arranca uno nuevo)
 *   node scripts/resetear-ciclo-analisis.js tucorreo@ejemplo.com borrar   (borra el ciclo por completo, mismo efecto que "nunca haber analizado nada")
 */
require('dotenv').config({ quiet: true });
const pool = require('../src/db/pool');

async function main() {
  const email = process.argv[2];
  const modo = process.argv[3] || 'vencer';

  if (!email) {
    console.error('Falta el correo. Uso: node scripts/resetear-ciclo-analisis.js tucorreo@ejemplo.com [vencer|borrar]');
    process.exit(1);
  }

  const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  const usuario = result.rows[0];
  if (!usuario) {
    console.error('No se encontró ningún usuario con ese correo.');
    process.exit(1);
  }

  if (modo === 'borrar') {
    await pool.query('UPDATE users SET analisis_ciclo_inicio = NULL WHERE id = $1', [usuario.id]);
    console.log(`✅ Usuario ${usuario.id}: ciclo borrado. El próximo análisis arranca de cero.`);
  } else {
    // Pone el inicio del ciclo hace 32 días — ya pasó el mes, así que
    // obtenerCicloVigente() lo va a considerar vencido.
    await pool.query(
      `UPDATE users SET analisis_ciclo_inicio = NOW() - INTERVAL '32 days' WHERE id = $1`,
      [usuario.id]
    );
    console.log(`✅ Usuario ${usuario.id}: ciclo movido a hace 32 días (vencido). El próximo análisis debería arrancar un ciclo nuevo con cupo completo.`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
