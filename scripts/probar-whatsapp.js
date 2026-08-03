/**
 * Script de prueba para mandar mensajes de WhatsApp directo (vía YCloud),
 * sin pasar por el flujo completo de la UI — mismo espíritu que
 * scripts/probar-mensaje-telegram.js.
 *
 * La vinculación en sí (que funciona con "el usuario escribe primero", ver
 * whatsapp.routes.js) no se puede probar con un script simple como este —
 * necesita el webhook real recibiendo un mensaje entrante. Para probar ESO,
 * la forma más simple es usar el flujo real desde el dashboard una vez que
 * tengas YCLOUD_WEBHOOK_SECRET y el webhook dado de alta en YCloud.
 *
 * Si YCLOUD_API_KEY no está configurada, cae en modo simulación (imprime en
 * consola en vez de mandar de verdad) — funciona igual sin credenciales,
 * solo que no llega nada real al teléfono.
 *
 * Uso:
 *   node scripts/probar-whatsapp.js resumen {numero} {nombre} {cantidad} {tipo}
 *   node scripts/probar-whatsapp.js cambio-estado {numero} {nombre} {nombreProceso} {codigo} {estadoNuevo}
 *   node scripts/probar-whatsapp.js recordatorio {numero} {nombre} {nombreProceso} {codigo} {fechaCierre} {tipoProceso}
 *   node scripts/probar-whatsapp.js texto {numero} {mensaje}
 *
 * Ejemplos:
 *   node scripts/probar-whatsapp.js resumen 56912345678 Juan 3 licitacion
 *   node scripts/probar-whatsapp.js resumen 56912345678 Juan 1 compra_agil
 *   node scripts/probar-whatsapp.js cambio-estado 56912345678 Juan "Compra de notebooks" 1234-5-LE24 Adjudicada
 *   node scripts/probar-whatsapp.js recordatorio 56912345678 Juan "Compra de notebooks" 1234-5-LE24 "01 ago. 2026, 18:00" licitacion
 *   node scripts/probar-whatsapp.js recordatorio 56912345678 Juan "Insumos de aseo" 987-6-CM24 "01 ago. 2026, 18:00" compra_agil
 *   node scripts/probar-whatsapp.js texto 56912345678 "Hola, esto es una prueba"
 */
require('dotenv').config({ quiet: true });
const {
  enviarResumenAlertaWhatsapp,
  enviarCambioEstadoWhatsapp,
  enviarRecordatorioCierreWhatsapp,
  enviarMensajeWhatsappCrudo,
} = require('../src/services/whatsapp.service');

/** Mismo criterio que describirCantidadYTipo() en alerting.service.js — duplicado acá a propósito, es solo para la prueba, no vale la pena importar todo alerting.service.js (que necesita conexión a la base) solo por esta función. */
function describirCantidadYTipo(cantidad, tipoProceso) {
  const singular = tipoProceso === 'compra_agil' ? 'compra ágil' : 'licitación';
  const plural = tipoProceso === 'compra_agil' ? 'compras ágiles' : 'licitaciones';
  return cantidad === 1 ? `una ${singular}` : `${cantidad} ${plural}`;
}

async function main() {
  const tipo = process.argv[2];
  const numero = process.argv[3];

  const tiposValidos = ['resumen', 'cambio-estado', 'recordatorio', 'texto'];
  if (!tipo || !numero || !tiposValidos.includes(tipo)) {
    console.error('Uso:');
    console.error('  node scripts/probar-whatsapp.js resumen {numero} {nombre} {cantidad} {tipo}');
    console.error('  node scripts/probar-whatsapp.js cambio-estado {numero} {nombre} {nombreProceso} {codigo} {estadoNuevo}');
    console.error('  node scripts/probar-whatsapp.js recordatorio {numero} {nombre} {nombreProceso} {codigo} {fechaCierre}');
    console.error('  node scripts/probar-whatsapp.js texto {numero} {mensaje}');
    process.exit(1);
  }

  if (tipo === 'resumen') {
    const nombre = process.argv[4] || 'Juan';
    const cantidad = parseInt(process.argv[5], 10) || 1;
    const tipoProceso = process.argv[6] || 'licitacion';
    const descripcion = describirCantidadYTipo(cantidad, tipoProceso);
    console.log(`Mandando plantilla "alerta_resumen" a ${numero} con nombre="${nombre}", descripcion="${descripcion}"...\n`);
    await enviarResumenAlertaWhatsapp(numero, nombre, descripcion);
  } else if (tipo === 'cambio-estado') {
    const nombre = process.argv[4] || 'Juan';
    const nombreProceso = process.argv[5] || 'Compra de notebooks';
    const codigo = process.argv[6] || '1234-5-LE24';
    const estadoNuevo = process.argv[7] || 'Adjudicada';
    console.log(`Mandando plantilla "cambio_estado" a ${numero}: ${nombre} / ${nombreProceso} (${codigo}) → ${estadoNuevo}...\n`);
    await enviarCambioEstadoWhatsapp(numero, nombre, nombreProceso, codigo, estadoNuevo);
  } else if (tipo === 'recordatorio') {
    const nombre = process.argv[4] || 'Juan';
    const nombreProceso = process.argv[5] || 'Compra de notebooks';
    const codigo = process.argv[6] || '1234-5-LE24';
    const fechaCierre = process.argv[7] || '01 ago. 2026, 18:00';
    const tipoProceso = process.argv[8] || 'licitacion';
    const plantilla = tipoProceso === 'compra_agil' ? 'recordatorio_cierre_compra_agil' : 'recordatorio_cierre_licitacion';
    console.log(`Mandando plantilla "${plantilla}" a ${numero}: ${nombre} / ${nombreProceso} (${codigo}) cierra ${fechaCierre}...\n`);
    await enviarRecordatorioCierreWhatsapp(numero, nombre, nombreProceso, codigo, fechaCierre, tipoProceso);
  } else {
    const mensaje = process.argv.slice(4).join(' ') || 'Mensaje de prueba de MercadoAlerta.';
    // Ojo: esto es texto libre SIN plantilla — solo funciona de verdad si
    // ESE número te escribió primero dentro de las últimas 24hs (si no,
    // Meta lo va a rechazar con el error 131047).
    console.log(`Mandando texto libre a ${numero}: "${mensaje}"...\n`);
    await enviarMensajeWhatsappCrudo(numero, mensaje);
  }

  console.log('\nListo — revisa tu WhatsApp (o el log de arriba si estás en modo simulación).');
}

main().catch((err) => {
  console.error('Error general:', err);
  process.exit(1);
});
