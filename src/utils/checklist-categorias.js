// Lista CERRADA de categorías — el prompt en analisis-ia.service.js le pide
// a la IA que use exactamente uno de estos 4 valores, para que el
// agrupamiento sea 100% predecible (no queda a criterio de la IA inventar
// categorías nuevas caso a caso, que generaría resultados inconsistentes
// entre distintos análisis). El orden de este array ES el orden en que se
// muestran los grupos — tanto acá (al armar el correo) como en el frontend.
const CATEGORIAS_CHECKLIST = [
  { valor: 'anexos', etiqueta: 'Anexos' },
  { valor: 'certificados', etiqueta: 'Certificados' },
  { valor: 'legal_societario', etiqueta: 'Documentos legales y societarios' },
  { valor: 'otros', etiqueta: 'Otros' },
];

const VALORES_VALIDOS = CATEGORIAS_CHECKLIST.map((c) => c.valor);

/**
 * Nunca se confía a ciegas en que la IA respetó el enum cerrado del prompt
 * — se valida acá antes de guardar. Si `categoria` no vino o no es uno de
 * los 4 valores válidos, cae en "otros" por defecto (nunca se descarta el
 * documento por esto, solo se reclasifica).
 *
 * También cubre análisis viejos, guardados ANTES de este cambio (sin
 * `categoria` en absoluto) — por eso el frontend hace esta misma
 * normalización de nuevo al mostrar, en vez de asumir que todo lo que viene
 * de la base ya está validado.
 */
function normalizarChecklist(checklistDocumentos) {
  return (checklistDocumentos || []).map((d) => ({
    ...d,
    categoria: VALORES_VALIDOS.includes(d.categoria) ? d.categoria : 'otros',
  }));
}

/**
 * Agrupa por categoría (en el orden fijo de CATEGORIAS_CHECKLIST) y, dentro
 * de cada grupo, obligatorios primero. Devuelve solo los grupos que tienen
 * al menos un documento (no arrastra grupos vacíos).
 */
function agruparChecklist(checklistDocumentos) {
  const normalizado = normalizarChecklist(checklistDocumentos);

  return CATEGORIAS_CHECKLIST
    .map((cat) => ({
      categoria: cat.valor,
      etiqueta: cat.etiqueta,
      documentos: normalizado
        .filter((d) => d.categoria === cat.valor)
        .sort((a, b) => (b.obligatorio ? 1 : 0) - (a.obligatorio ? 1 : 0)),
    }))
    .filter((grupo) => grupo.documentos.length > 0);
}

module.exports = { CATEGORIAS_CHECKLIST, normalizarChecklist, agruparChecklist };
