/**
 * Script de utilidad para PROBAR el flujo de corte de acceso post-cancelación
 * sin depender de MercadoPago ni esperar a que pase un mes de verdad.
 * Simula el resultado de POST /api/pagos/cancelar directamente en la base.
 *
 * Corre con:
 *   node scripts/simular-cancelacion.js tucorreo@ejemplo.com           (acceso vencido AHORA)
 *   node scripts/simular-cancelacion.js tucorreo@ejemplo.com 2dias     (acceso vence en 2 días — para probar el aviso previo)
 *   node scripts/simular-cancelacion.js tucorreo@ejemplo.com reset     (deshace la cancelación simulada)
 *
 * OJO: solo tiene efecto sobre empresas con plan pago (no trial) y
 * estado_pago='activo'. Si no hay ninguna suscripción "activa" que cancelar,
 * el script avisa y no hace nada.
 */
require('dotenv').config({ quiet: true });
const pool = require('../src/db/pool');

async function main() {
  const email = process.argv[2];
  const modo = process.argv[3] || 'ahora';

  if (!email) {
    console.error('Falta el correo. Uso: node scripts/simular-cancelacion.js tucorreo@ejemplo.com [2dias|reset]');
    process.exit(1);
  }

  const empresaResult = await pool.query(
    `SELECT e.id, e.plan, e.estado_pago FROM empresas e JOIN users u ON u.empresa_id = e.id WHERE u.email = $1`,
    [email]
  );
  const empresa = empresaResult.rows[0];

  if (!empresa) {
    console.error(`No se encontró ninguna empresa para el usuario ${email}`);
    process.exit(1);
  }

  if (modo === 'reset') {
    await pool.query(
      `UPDATE empresas SET suscripcion_cancelada_en = NULL, acceso_hasta = NULL,
       aviso_acceso_2dias_enviado = false, aviso_acceso_terminado_enviado = false,
       estado_pago = 'activo' WHERE id = $1`,
      [empresa.id]
    );
    console.log(`✅ Empresa ${empresa.id}: cancelación simulada deshecha, estado_pago vuelto a 'activo'.`);
  } else if (modo === '2dias') {
    await pool.query(
      `UPDATE empresas SET suscripcion_cancelada_en = NOW() - INTERVAL '5 minutes',
       acceso_hasta = NOW() + INTERVAL '1 day 12 hours', aviso_acceso_2dias_enviado = false,
       estado_pago = 'activo' WHERE id = $1`,
      [empresa.id]
    );
    console.log(`✅ Empresa ${empresa.id}: suscripción "cancelada", acceso vence en ~36 horas. Corre scripts/correr-avisos-trial.js para disparar el correo.`);
  } else {
    if (empresa.plan === 'trial') {
      console.error('Esta empresa está en trial, no en un plan pago — no hay suscripción que cancelar. Usa expirar-trial.js para probar el caso de trial.');
      process.exit(1);
    }
    await pool.query(
      `UPDATE empresas SET suscripcion_cancelada_en = NOW() - INTERVAL '1 hour',
       acceso_hasta = NOW() - INTERVAL '1 minute', aviso_acceso_terminado_enviado = false,
       estado_pago = 'activo' WHERE id = $1`,
      [empresa.id]
    );
    console.log(`✅ Empresa ${empresa.id}: suscripción "cancelada" hace 1 hora, acceso ya vencido. Ya puedes probar:`);
    console.log('   - Login → debería redirigir a trial-vencido.html con el texto de "acceso terminado"');
    console.log('   - Cualquier llamada a la API mientras la sesión sigue abierta → debería dar 402 (defensa del middleware)');
    console.log("   - node scripts/correr-avisos-trial.js → manda el correo Y deja estado_pago en 'pendiente' de verdad");
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
