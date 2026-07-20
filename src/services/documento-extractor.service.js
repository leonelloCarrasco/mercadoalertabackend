const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// Un PDF/Word escaneado como imagen produce texto casi vacío al extraer —
// este umbral es la señal de "esto no se pudo leer", ver
// analisis-ia.service.js. No es una ciencia exacta: un documento MUY corto
// pero real (poco común en bases de licitación) podría caer bajo este
// umbral igual — se prioriza no mandarle a la IA algo vacío/basura antes que
// nunca rechazar un documento válido corto.
const MIN_CARACTERES_VALIDOS = 200;

/**
 * Extrae el texto de un archivo subido (PDF o Word) según su mimetype.
 * Devuelve { texto, extraible } — extraible=false si el archivo es de un
 * tipo no soportado, o si la extracción dio muy poco texto (típicamente un
 * PDF escaneado como imagen, sin capa de texto real — no hacemos OCR).
 */
async function extraerTextoArchivo(buffer, mimetype, nombreArchivo) {
  try {
    let texto = '';

    if (mimetype === 'application/pdf' || nombreArchivo?.toLowerCase().endsWith('.pdf')) {
      const resultado = await pdfParse(buffer);
      texto = resultado.text || '';
    } else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || nombreArchivo?.toLowerCase().endsWith('.docx')
    ) {
      const resultado = await mammoth.extractRawText({ buffer });
      texto = resultado.value || '';
    } else {
      return { texto: '', extraible: false, motivo: 'Formato no soportado — solo se aceptan PDF o Word (.docx).' };
    }

    const textoLimpio = texto.replace(/\s+/g, ' ').trim();

    if (textoLimpio.length < MIN_CARACTERES_VALIDOS) {
      return {
        texto: '',
        extraible: false,
        motivo: 'No pudimos leer el contenido de este archivo — probablemente es un documento escaneado (imagen), no texto real. Intenta con otro archivo, o continúa sin adjuntos.',
      };
    }

    return { texto: textoLimpio, extraible: true, motivo: null };
  } catch (err) {
    console.error('[documento-extractor] Error extrayendo texto:', err.message);
    return {
      texto: '',
      extraible: false,
      motivo: 'No pudimos leer este archivo — puede estar dañado o no ser un PDF/Word válido.',
    };
  }
}

module.exports = { extraerTextoArchivo };
