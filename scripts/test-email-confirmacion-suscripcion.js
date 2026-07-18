/**
 * Script de prueba: envía el correo de "tu suscripción está activa" con
 * datos de ejemplo, sin depender de que el webhook real de MercadoPago
 * dispare la confirmación.
 *
 * Corre con:
 *   node scripts/test-email-confirmacion-suscripcion.js tucorreo@ejemplo.com basico
 *   node scripts/test-email-confirmacion-suscripcion.js tucorreo@ejemplo.com full
 * (el segundo argumento es opcional, por defecto "full")
 */
require('dotenv').config({ quiet: true });
const { armarEmailConfirmacionSuscripcion, enviarEmailAlerta } = require('../src/services/email.service');

const MONTOS = { basico: 8990, full: 14990 };

async function main() {
  const destinatario = process.argv[2];
  const plan = process.argv[3] === 'basico' ? 'basico' : 'full';

  if (!destinatario) {
    console.error('Falta el correo de destino. Uso: node scripts/test-email-confirmacion-suscripcion.js tucorreo@ejemplo.com [basico|full]');
    process.exit(1);
  }

  const { subject, html } = armarEmailConfirmacionSuscripcion({
    nombre: 'Leonello',
    plan,
    monto: MONTOS[plan],
    tarjeta: { ultimosDigitos: '4242', marca: 'visa' },
  });

  console.log(`Enviando a: ${destinatario} (plan: ${plan})`);
  console.log(`Asunto: ${subject}`);

  const resultado = await enviarEmailAlerta({ to: destinatario, subject, html });

  if (resultado.simulado) {
    console.log('\n⚠️  RESEND_API_KEY no configurada — se mostró arriba en modo simulación, no se envió nada de verdad.');
  } else {
    console.log('\n✅ Enviado. Revisa la bandeja (y spam) de', destinatario);
  }
}

main().catch((err) => {
  console.error('Error al enviar el correo de prueba:', err.message);
  process.exit(1);
});
