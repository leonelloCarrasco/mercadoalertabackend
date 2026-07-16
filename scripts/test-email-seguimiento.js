/**
 * Script de prueba: envía el email de "cambio de estado" (sección
 * Oportunidades / seguimiento-estado.js) con datos de ejemplo, cubriendo
 * los dos casos reales: un cambio intermedio (sin adjudicación todavía) y
 * el caso "Adjudicada" (con el detalle de ganador/monto).
 *
 * Corre con:
 *   node scripts/test-email-seguimiento.js tucorreo@ejemplo.com intermedio
 *   node scripts/test-email-seguimiento.js tucorreo@ejemplo.com adjudicada
 * (el segundo argumento es opcional, por defecto "intermedio")
 */
require('dotenv').config({ quiet: true });
const { armarEmailSeguimiento, enviarEmailAlerta } = require('../src/services/email.service');

const CASOS_DE_PRUEBA = {
  intermedio: {
    nombre: 'ADQUISICIÓN DE EQUIPOS COMPUTACIONALES PARA OFICINAS REGIONALES',
    codigoExterno: '1509-5-L114',
    estadoAnterior: 'Publicada',
    estadoNuevo: 'Cerrada',
    items: [],
  },
  adjudicada: {
    nombre: 'ADQUISICIÓN DE EQUIPOS COMPUTACIONALES PARA OFICINAS REGIONALES',
    codigoExterno: '1509-5-L114',
    estadoAnterior: 'Cerrada',
    estadoNuevo: 'Adjudicada',
    items: [
      {
        nombre_producto: 'Computadores de escritorio',
        categoria: 'Equipos informáticos',
        adjudicacion: {
          nombre_proveedor: 'COMERCIAL TECNO SPA',
          rut_proveedor: '76.123.456-7',
          cantidad: 15,
          monto_unitario: 350000,
        },
      },
      {
        nombre_producto: 'Impresoras multifunción',
        categoria: 'Equipos informáticos',
        adjudicacion: {
          nombre_proveedor: 'DISTRIBUIDORA OFICINA SUR LTDA',
          rut_proveedor: '77.987.654-3',
          cantidad: 5,
          monto_unitario: 180000,
        },
      },
    ],
  },
};

async function main() {
  const destinatario = process.argv[2];
  const caso = process.argv[3] === 'adjudicada' ? 'adjudicada' : 'intermedio';

  if (!destinatario) {
    console.error('Falta el correo de destino. Uso: node scripts/test-email-seguimiento.js tucorreo@ejemplo.com [intermedio|adjudicada]');
    process.exit(1);
  }

  const { subject, html } = armarEmailSeguimiento(CASOS_DE_PRUEBA[caso]);

  console.log(`Enviando a: ${destinatario} (caso: ${caso})`);
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
