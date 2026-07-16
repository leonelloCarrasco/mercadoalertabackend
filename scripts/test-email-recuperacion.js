/**
 * Script de prueba: envía el email de recuperación de contraseña con el
 * nuevo formato, sin pasar por POST /auth/olvide-password (que exige un
 * usuario real registrado).
 *
 * Corre con: node scripts/test-email-recuperacion.js tucorreo@ejemplo.com
 */
require('dotenv').config({ quiet: true });
const { armarEmailRecuperacion, enviarEmailAlerta } = require('../src/services/email.service');

async function main() {
  const destinatario = process.argv[2];
  if (!destinatario) {
    console.error('Falta el correo de destino. Uso: node scripts/test-email-recuperacion.js tucorreo@ejemplo.com');
    process.exit(1);
  }

  const linkDePrueba = `${process.env.FRONTEND_URL || 'https://mercadoalerta.cl'}/reset-password.html?token=token-de-prueba-123`;
  const { subject, html } = armarEmailRecuperacion(linkDePrueba);

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
