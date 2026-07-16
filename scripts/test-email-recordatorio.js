/**
 * Script de prueba: envía el email de "recordatorio de cierre" (sección
 * Oportunidades) con datos de ejemplo, sin esperar a que el job real
 * (recordatorio-cierre.js) encuentre uno pendiente.
 *
 * Corre con:
 *   node scripts/test-email-recordatorio.js tucorreo@ejemplo.com licitacion
 *   node scripts/test-email-recordatorio.js tucorreo@ejemplo.com compra_agil
 * (el segundo argumento es opcional, por defecto "licitacion")
 */
require('dotenv').config({ quiet: true });
const { armarEmailRecordatorio, enviarEmailAlerta } = require('../src/services/email.service');

const RECORDATORIOS_DE_PRUEBA = {
  licitacion: {
    tipo_proceso: 'licitacion',
    nombre: 'ADQUISICIÓN DE EQUIPOS COMPUTACIONALES PARA OFICINAS REGIONALES',
    codigo_externo: '1509-5-L114',
    organismo: 'SERVICIO DE SALUD OSORNO',
    monto: 45000000,
    fecha_cierre: '2026-08-15T15:00:00',
    horas_antes: 24,
  },
  compra_agil: {
    tipo_proceso: 'compra_agil',
    nombre: 'SUMINISTRO DE MATERIALES ELÉCTRICOS PARA MANTENCIÓN',
    codigo_externo: '1195-39-COT26',
    organismo: 'MUNICIPALIDAD DE PROVIDENCIA',
    monto: 3200000,
    fecha_cierre: '2026-07-18T18:00:00',
    horas_antes: 6,
  },
};

async function main() {
  const destinatario = process.argv[2];
  const tipo = process.argv[3] === 'compra_agil' ? 'compra_agil' : 'licitacion';

  if (!destinatario) {
    console.error('Falta el correo de destino. Uso: node scripts/test-email-recordatorio.js tucorreo@ejemplo.com [licitacion|compra_agil]');
    process.exit(1);
  }

  const { subject, html } = armarEmailRecordatorio(RECORDATORIOS_DE_PRUEBA[tipo]);

  console.log(`Enviando a: ${destinatario} (tipo: ${tipo})`);
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
