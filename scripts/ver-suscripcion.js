/**
 * Script de diagnóstico: muestra el estado de suscripción actual (real, tal
 * como está guardado en la base) de la empresa de un usuario — para
 * comparar contra el ID que estás probando en el simulador de webhooks de
 * MercadoPago, o contra lo que esperás que haya quedado guardado.
 *
 * Corre con: node scripts/ver-suscripcion.js tucorreo@ejemplo.com
 */
require('dotenv').config({ quiet: true });
const pool = require('../src/db/pool');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Falta el correo. Uso: node scripts/ver-suscripcion.js tucorreo@ejemplo.com');
    process.exit(1);
  }

  const result = await pool.query(
    `SELECT e.id AS empresa_id, e.nombre_empresa, e.plan, e.estado_pago,
            e.mercadopago_subscription_id, e.suscripcion_cancelada_en, e.acceso_hasta
     FROM empresas e JOIN users u ON u.empresa_id = e.id
     WHERE u.email = $1`,
    [email]
  );

  const empresa = result.rows[0];
  if (!empresa) {
    console.error(`No se encontró ninguna empresa para el usuario ${email}`);
    process.exit(1);
  }

  console.log('\nEstado actual en la base de datos:');
  console.log('─'.repeat(50));
  console.log('Empresa ID:                  ', empresa.empresa_id);
  console.log('Nombre:                      ', empresa.nombre_empresa);
  console.log('Plan:                        ', empresa.plan);
  console.log('Estado de pago:              ', empresa.estado_pago);
  console.log('mercadopago_subscription_id: ', empresa.mercadopago_subscription_id || '(ninguno)');
  console.log('Suscripción cancelada en:    ', empresa.suscripcion_cancelada_en || '(no cancelada)');
  console.log('Acceso hasta:                ', empresa.acceso_hasta || '(no aplica)');
  console.log('─'.repeat(50));
  console.log('\nEste es el ÚNICO ID que el webhook va a reconocer ahora mismo — cualquier');
  console.log('otro ID (de un intento anterior, o cancelado) va a dar "no se encontró empresa".\n');

  await pool.end();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
