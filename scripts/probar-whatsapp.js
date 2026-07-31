/**
 * Script de prueba para mandar mensajes de WhatsApp directo, sin pasar por
 * el flujo completo de la UI — mismo espíritu que
 * scripts/probar-mensaje-telegram.js.
 *
 * La vinculación en sí (que funciona con "el usuario escribe primero", ver
 * whatsapp.routes.js) no se puede probar con un script simple como este —
 * necesita el webhook real recibiendo un mensaje entrante. Para probar ESO,
 * la forma más simple es usar el flujo real desde el dashboard una vez que
 * tengas WHATSAPP_APP_SECRET y el webhook dado de alta en Meta.
 *
 * Si WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID no están configurados,
 * cae en modo simulación (imprime en consola en vez de mandar de verdad) —
 * funciona igual sin credenciales, solo que no llega nada real al teléfono.
 *
 * Uso:
 *   node scripts/probar-whatsapp.js resumen {numero} {cantidad}
 *   node scripts/probar-whatsapp.js texto {numero} {mensaje}
 *
 * Ejemplos:
 *   node scripts/probar-whatsapp.js resumen 56912345678 3
 *   node scripts/probar-whatsapp.js texto 56912345678 "Hola, esto es una prueba"
 */
require('dotenv').config({ quiet: true });
const { enviarResumenAlertaWhatsapp, enviarMensajeWhatsappCrudo } = require('../src/services/whatsapp.service');

async function main() {
  const tipo = process.argv[2];
  const numero = process.argv[3];

  if (!tipo || !numero || !['resumen', 'texto'].includes(tipo)) {
    console.error('Uso:');
    console.error('  node scripts/probar-whatsapp.js resumen {numero} {cantidad}');
    console.error('  node scripts/probar-whatsapp.js texto {numero} {mensaje}');
    process.exit(1);
  }

  if (tipo === 'resumen') {
    const cantidad = parseInt(process.argv[4], 10) || 1;
    console.log(`Mandando plantilla "alerta_resumen" a ${numero} con cantidad=${cantidad}...\n`);
    await enviarResumenAlertaWhatsapp(numero, cantidad);
  } else {
    const mensaje = process.argv.slice(4).join(' ') || 'Mensaje de prueba de MercadoAlerta.';
    // Ojo: esto es texto libre SIN plantilla — solo funciona de verdad si
    // ESE número te escribió primero dentro de las últimas 24hs (si no,
    // Meta lo va a rechazar con el error 131047).
    console.log(`Mandando texto libre a ${numero}: "${mensaje}"...\n`);
    await enviarMensajeWhatsappCrudo(numero, mensaje);
  }

  console.log('\nListo — revisá tu WhatsApp (o el log de arriba si estás en modo simulación).');
}

main().catch((err) => {
  console.error('Error general:', err);
  process.exit(1);
});
