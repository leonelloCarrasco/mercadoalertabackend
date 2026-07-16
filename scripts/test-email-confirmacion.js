/**
 * Script de prueba: envía el email de confirmación de cuenta (con el nuevo
 * formato/paleta) directo a una dirección de prueba, sin pasar por
 * POST /api/auth/register (que exige captcha + validar el RUT contra
 * Mercado Público — fricción innecesaria para solo revisar el formato).
 *
 * Corre con: node scripts/test-email-confirmacion.js tucorreo@ejemplo.com
 * Lee RESEND_API_KEY / RESEND_FROM_EMAIL desde tu archivo .env — si no está
 * configurada, igual corre en modo simulación (imprime el contenido en vez
 * de enviar, ver enviarEmailAlerta en email.service.js).
 */
require('dotenv').config({ quiet: true });
const { armarEmailConfirmacionCuenta, enviarEmailAlerta } = require('../src/services/email.service');

async function main() {
  const destinatario = process.argv[2];
  if (!destinatario) {
    console.error('Falta el correo de destino. Uso: node scripts/test-email-confirmacion.js tucorreo@ejemplo.com');
    process.exit(1);
  }

  // Link/nombre de prueba — no corresponden a un token real, es solo para
  // ver el formato del correo (el link no va a funcionar si se hace clic).
  const linkDePrueba = `${process.env.FRONTEND_URL || 'https://mercadoalerta.cl'}/confirmar-cuenta.html?token=token-de-prueba-123`;
  const { subject, html } = armarEmailConfirmacionCuenta(linkDePrueba, 'Leonello Carrasco Araya');

  console.log(`Enviando a: ${destinatario}`);
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
