/**
 * Script de prueba: corre analizarProceso() directo, con un texto de bases
 * de ejemplo (extracto corto de la licitación real del Hospital del
 * Salvador que revisamos en la conversación de diseño), sin depender de
 * subir un archivo real desde el dashboard.
 *
 * Requiere ANTHROPIC_API_KEY configurada en tu .env — a diferencia de los
 * scripts de correo, ACÁ NO HAY MODO SIMULACIÓN: esto sí llama a la API real
 * de Claude y consume créditos (unos centavos de dólar, ver la conversación
 * de costos), así que solo corre esto cuando quieras probar la integración
 * de verdad.
 *
 * Corre con: node scripts/test-analisis-ia.js
 */
require('dotenv').config({ quiet: true });
const { analizarProceso } = require('../src/services/analisis-ia.service');

const TEXTO_DE_PRUEBA = `
RESOLUCION EXENTA N°: 2211 - Santiago, 01 de julio de 2026
REF: Convenio Suministro de Medicamentos corticoides G-5 para el Hospital del Salvador

RESUELVO:
1.- Apruébense las Bases que regularán el proceso para efectuar llamado a Propuesta Pública.

ARTÍCULO 6°: CRONOGRAMA
Fecha de Cierre de Recepción de Ofertas: 10 días corridos desde la publicación, a las 16:00 horas.
Período de Consultas: desde la publicación hasta el tercer día hábil posterior.

ARTÍCULO 10°: DOCUMENTOS ADMINISTRATIVOS OBLIGATORIOS
a) Declaración jurada simple de conocimiento y aceptación de las bases. Anexo N°1.
b) Declaración Jurada de no encontrarse dentro de las inhabilidades del Art. 4 de la Ley N°19.886. Anexo N°2.
c) Declaración Jurada Ley N°20.393. Anexo N°3.

ARTÍCULO 13°: OFERTA ECONÓMICA
Presupuesto por línea:
- PREDNISOLONA ACETATO: $19.157.400
- CLORANFENICOL: $3.668.500
- BUDESONIDA: $22.176.000
El no cumplimiento del valor presupuestado por línea podrá determinar la inadmisibilidad de la oferta.

ARTÍCULO 20°: CRITERIOS DE EVALUACIÓN
Precio: 60%
Calidad Técnica: 37%
Cumplimiento de Programa de Integridad: 1%
Cumplimiento de requisitos formales: 2%

ARTÍCULO 42°: MULTAS
Incumplimiento en plazos de entrega: 20% del valor del producto no despachado por cada día de atraso.
Calidad inferior a la ofertada: 20% del valor del producto defectuoso.
`.trim();

async function main() {
  console.log('Llamando a la API de Claude con un texto de prueba...\n');

  const resultado = await analizarProceso({
    tipoProceso: 'licitacion',
    codigoExterno: 'PRUEBA-2211-2026',
    metadata: {
      nombre: 'CONVENIO SUMINISTRO DE MEDICAMENTOS CORTICOIDES G-5 PARA EL HOSPITAL DEL SALVADOR',
      organismo: 'SERVICIO DE SALUD ORIENTE HOSPITAL DEL SALVADOR',
      region: 'Región Metropolitana de Santiago',
      montoEstimado: 45001900,
      fechaCierre: '2026-07-22T16:00:00',
    },
    textoBases: TEXTO_DE_PRUEBA,
    textoFicha: TEXTO_DE_PRUEBA,
    sinAdjuntos: false,
  });

  console.log('Resultado:\n');
  console.log(JSON.stringify(resultado, null, 2));
}

main().catch((err) => {
  console.error('\nError al analizar:', err.message);
  process.exit(1);
});
