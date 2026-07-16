/**
 * Script de prueba: envía el email de "nuevas licitaciones que coinciden con
 * tus alertas" con datos de ejemplo (mismo shape que devuelve la API de
 * Mercado Público para el detalle de una licitación), sin depender de que el
 * polling real encuentre algo justo ahora.
 *
 * Corre con: node scripts/test-email-resumen-licitaciones.js tucorreo@ejemplo.com
 */
require('dotenv').config({ quiet: true });
const { armarResumenLicitaciones, enviarEmailAlerta } = require('../src/services/email.service');

const LICITACIONES_DE_PRUEBA = [
  {
    CodigoExterno: '1509-5-L114',
    Nombre: 'ADQUISICIÓN DE EQUIPOS COMPUTACIONALES PARA OFICINAS REGIONALES',
    MontoEstimado: 45000000,
    Tipo: 'LE',
    Comprador: { NombreOrganismo: 'SERVICIO DE SALUD OSORNO' },
    Fechas: { FechaCierre: '2026-08-15T15:00:00' },
  },
  {
    CodigoExterno: '2483-170-LE26',
    Nombre: 'SUMINISTRO DE PLACAS PROVISORIAS SEMESTRAL',
    MontoEstimado: null,
    Tipo: 'LP',
    Comprador: { NombreOrganismo: 'ILUSTRE MUNICIPALIDAD DE QUILICURA' },
    Fechas: { FechaCierre: '2026-08-20T15:01:00' },
  },
];

async function main() {
  const destinatario = process.argv[2];
  if (!destinatario) {
    console.error('Falta el correo de destino. Uso: node scripts/test-email-resumen-licitaciones.js tucorreo@ejemplo.com');
    process.exit(1);
  }

  const { subject, html } = armarResumenLicitaciones(LICITACIONES_DE_PRUEBA);

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
