/**
 * Script de utilidad para PROBAR el flujo de trial vencido sin esperar 14
 * días de verdad. Pone fecha_expiracion_trial en el pasado (o en el futuro
 * cercano, para probar el aviso de "2 días antes") para la empresa del
 * correo indicado.
 *
 * Corre con:
 *   node scripts/expirar-trial.js tucorreo@ejemplo.com           (vence AHORA)
 *   node scripts/expirar-trial.js tucorreo@ejemplo.com 2dias     (vence en 2 días — para probar el aviso previo)
 *   node scripts/expirar-trial.js tucorreo@ejemplo.com reset     (vuelve a poner 14 días desde hoy, y resetea los avisos)
 *
 * OJO: solo tiene efecto sobre empresas con plan='trial'. Si la empresa ya
 * pasó a un plan pago, este script no hace nada (a propósito — no tiene
 * sentido "vencer" un plan pago).
 */
require('dotenv').config({ quiet: true });
const pool = require('../src/db/pool');

async function main() {
  const email = process.argv[2];
  const modo = process.argv[3] || 'ahora';

  if (!email) {
    console.error('Falta el correo. Uso: node scripts/expirar-trial.js tucorreo@ejemplo.com [2dias|reset]');
    process.exit(1);
  }

  const empresaResult = await pool.query(
    `SELECT e.id, e.plan, e.aviso_2dias_enviado, e.aviso_vencido_enviado
     FROM empresas e JOIN users u ON u.empresa_id = e.id
     WHERE u.email = $1`,
    [email]
  );
  const empresa = empresaResult.rows[0];

  if (!empresa) {
    console.error(`No se encontró ninguna empresa para el usuario ${email}`);
    process.exit(1);
  }
  if (empresa.plan !== 'trial') {
    console.error(`Esta empresa ya está en plan '${empresa.plan}', no en trial — no hay nada que vencer.`);
    process.exit(1);
  }

  if (modo === 'reset') {
    await pool.query(
      `UPDATE empresas SET fecha_expiracion_trial = NOW() + INTERVAL '14 days',
       aviso_2dias_enviado = false, aviso_vencido_enviado = false WHERE id = $1`,
      [empresa.id]
    );
    console.log(`✅ Empresa ${empresa.id}: trial reseteado a 14 días desde ahora, avisos reseteados.`);
  } else if (modo === '2dias') {
    await pool.query(
      `UPDATE empresas SET fecha_expiracion_trial = NOW() + INTERVAL '1 day 12 hours',
       aviso_2dias_enviado = false WHERE id = $1`,
      [empresa.id]
    );
    console.log(`✅ Empresa ${empresa.id}: trial vence en ~36 horas (dentro del umbral de "2 días antes"). Corre scripts/correr-avisos-trial.js para disparar el correo.`);
  } else {
    await pool.query(
      `UPDATE empresas SET fecha_expiracion_trial = NOW() - INTERVAL '1 hour',
       aviso_vencido_enviado = false WHERE id = $1`,
      [empresa.id]
    );
    console.log(`✅ Empresa ${empresa.id}: trial vencido hace 1 hora. Ya puedes probar:`);
    console.log('   - Login → debería redirigir a trial-vencido.html');
    console.log('   - node scripts/correr-avisos-trial.js → debería mandar el correo de "vencido"');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
