/**
 * Script de prueba: envía el aviso de "tu prueba termina en 2 días", sin
 * esperar a que el job real (avisos-trial.js) encuentre una empresa que
 * cumpla el umbral.
 *
 * Corre con: node scripts/test-email-aviso-2dias.js tucorreo@ejemplo.com
 */
require('dotenv').config({ quiet: true });
const { armarEmailAviso2Dias, enviarEmailAlerta } = require('../src/services/email.service');

async function main() {
  const destinatario = process.argv[2];
  if (!destinatario) {
    console.error('Falta el correo de destino. Uso: node scripts/test-email-aviso-2dias.js tucorreo@ejemplo.com');
    process.exit(1);
  }

  const enDosDias = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const { subject, html } = armarEmailAviso2Dias({ nombre: 'Leonello', fechaExpiracionTrial: enDosDias });

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
