/**
 * Script de prueba: envía el email de "nuevas Compras Ágiles que coinciden
 * con tus alertas" con datos de ejemplo (mismo shape que devuelve la API v2
 * de Compra Ágil), sin depender de que el polling real encuentre algo justo
 * ahora.
 *
 * Corre con: node scripts/test-email-resumen-compra-agil.js tucorreo@ejemplo.com
 */
require('dotenv').config({ quiet: true });
const { armarResumenCompraAgil, enviarEmailAlerta } = require('../src/services/email.service');

const COMPRAS_AGILES_DE_PRUEBA = [
  {
    codigo: '1195-39-COT26',
    nombre: 'SUMINISTRO DE MATERIALES ELÉCTRICOS PARA MANTENCIÓN',
    montos: { monto_disponible_clp: 3200000 },
    institucion: { organismo_comprador: 'MUNICIPALIDAD DE PROVIDENCIA' },
    fechas: { fecha_cierre: '2026-07-18T18:00:00' },
  },
];

async function main() {
  const destinatario = process.argv[2];
  if (!destinatario) {
    console.error('Falta el correo de destino. Uso: node scripts/test-email-resumen-compra-agil.js tucorreo@ejemplo.com');
    process.exit(1);
  }

  const { subject, html } = armarResumenCompraAgil(COMPRAS_AGILES_DE_PRUEBA);

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
