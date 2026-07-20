/**
 * Script de diagnóstico: muestra el ciclo de cuota vigente, cuántos
 * análisis lleva consumidos, y el listado completo de sus análisis
 * guardados — para no tener que mirar la base a mano mientras se prueba.
 *
 * Corre con: node scripts/ver-analisis-ia.js tucorreo@ejemplo.com
 */
require('dotenv').config({ quiet: true });
const pool = require('../src/db/pool');
const { obtenerCicloVigente, contarConsumosDelCiclo, listarMisAnalisis } = require('../src/db/analisis-ia.queries');
const { obtenerPlan } = require('../src/utils/planes');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Falta el correo. Uso: node scripts/ver-analisis-ia.js tucorreo@ejemplo.com');
    process.exit(1);
  }

  const result = await pool.query(
    `SELECT u.id, u.email, u.analisis_ciclo_inicio, e.plan
     FROM users u JOIN empresas e ON e.id = u.empresa_id
     WHERE u.email = $1`,
    [email]
  );
  const usuario = result.rows[0];
  if (!usuario) {
    console.error(`No se encontró ningún usuario con ese correo.`);
    process.exit(1);
  }

  const limites = obtenerPlan(usuario.plan);
  const limiteAnalisis = limites?.limiteAnalisisIA ?? 1;
  const cicloVigente = await obtenerCicloVigente(usuario.id);
  const consumidos = await contarConsumosDelCiclo(usuario.id, cicloVigente);
  const misAnalisis = await listarMisAnalisis(usuario.id);

  console.log('\nEstado de cuota:');
  console.log('─'.repeat(50));
  console.log('Usuario:                ', usuario.email, `(id ${usuario.id})`);
  console.log('Plan:                   ', usuario.plan, `(cupo: ${limiteAnalisis}/ciclo)`);
  console.log('Ciclo guardado (raw):    ', usuario.analisis_ciclo_inicio || '(nunca empezó uno)');
  console.log('Ciclo VIGENTE ahora:     ', cicloVigente || '(ninguno vigente — el próximo análisis arranca uno nuevo)');
  console.log('Consumidos en el ciclo:  ', `${consumidos}/${limiteAnalisis}`);
  console.log('Cupo disponible ahora:   ', Math.max(0, limiteAnalisis - consumidos));
  console.log('─'.repeat(50));

  console.log(`\nAnálisis guardados (${misAnalisis.length}):`);
  if (misAnalisis.length === 0) {
    console.log('  (ninguno todavía)');
  } else {
    misAnalisis.forEach((a) => {
      console.log(`  - [${a.tipo_proceso}] ${a.codigo_externo} — ${a.nombre || '(sin nombre)'} ${a.sin_adjuntos ? '(sin adjuntos)' : `(hash: ${a.archivo_hash?.slice(0, 12)}...)`}`);
    });
  }
  console.log('');

  await pool.end();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
