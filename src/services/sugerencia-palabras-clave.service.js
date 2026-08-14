const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODELO = 'claude-sonnet-5';

// Prompt corto (no documentos completos como Análisis de Procesos), así que
// alcanza con un límite bajo — evita respuestas desproporcionadas si el
// modelo se desvía.
const MAX_TOKENS = 1024;

/**
 * Arma el prompt — le pide a la IA una lista de ~10-12 palabras clave
 * candidatas EN PLURAL (mismo criterio que ya usa el catálogo UNSPSC real,
 * ver conversación de diseño de agosto 2026: "Animales domésticos", "Aves de
 * corral", etc. — todo plural), a partir de una descripción en lenguaje
 * natural de lo que el usuario vende. Son CANDIDATAS para que el usuario
 * elija hasta 5 en el frontend — la IA no decide la lista final.
 */
function armarPrompt(descripcion) {
  return `Eres un asistente que ayuda a proveedores del Estado de Chile a encontrar palabras clave para monitorear licitaciones y Compras Ágiles en Mercado Público.

El usuario describió en sus palabras qué vende o qué le interesa:
"""
${descripcion}
"""

Genera entre 10 y 12 palabras o frases cortas (2-3 palabras como máximo cada una) que podrían aparecer en el TÍTULO o la descripción de productos de licitaciones relacionadas con lo que describió — sinónimos, variantes, jerga técnica del rubro, términos que un organismo público podría usar al redactar la licitación aunque no sean exactamente las palabras que usó el usuario.

Reglas:
- SIEMPRE en plural (ej. "mesas", "jardines", "computadores" — no "mesa", "jardín", "computador"), igual que usa el catálogo oficial de categorías de compras públicas.
- En español de Chile.
- Sin acentos NI SIN acentos por igual — no importa, se normalizan después; escribe con la ortografía correcta normal.
- No repitas la misma palabra en singular y plural — solo la forma plural.
- No incluyas palabras genéricas que aparecerían en casi cualquier licitación (ej. "servicio", "compra", "adquisición", "suministro").

Responde SOLO con un array JSON de strings, nada de texto antes o después. Ejemplo de formato (no uses este contenido, es solo el formato):
["palabra1", "palabra2", "palabra3"]`;
}

/**
 * Llama a la API de Claude y devuelve el array de palabras candidatas.
 * Mismo patrón de llamada que analisis-ia.service.js, pero con un prompt y
 * un límite de tokens mucho más chicos — esto es una lista corta de
 * palabras, no un análisis de documento completo.
 */
async function sugerirPalabrasClave(descripcion) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY no configurada — no se puede sugerir palabras clave.');
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: armarPrompt(descripcion) }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Error llamando a la API de Claude: HTTP ${response.status} — ${errorBody}`);
  }

  const data = await response.json();
  const textoRespuesta = data.content?.find((b) => b.type === 'text')?.text;
  if (!textoRespuesta) {
    throw new Error('La IA no devolvió contenido de texto.');
  }

  // Extracción tolerante: se toma desde el primer '[' hasta el último ']'
  // (mismo criterio que analisis-ia.service.js usa con '{'/'}') — el prompt
  // pide JSON puro, pero el modelo a veces agrega una frase igual.
  const inicio = textoRespuesta.indexOf('[');
  const fin = textoRespuesta.lastIndexOf(']');
  if (inicio === -1 || fin === -1 || fin < inicio) {
    throw new Error('La IA no devolvió un array JSON válido.');
  }

  let candidatas;
  try {
    candidatas = JSON.parse(textoRespuesta.slice(inicio, fin + 1));
  } catch (err) {
    throw new Error(`La IA devolvió JSON inválido: ${err.message}`);
  }

  if (!Array.isArray(candidatas)) {
    throw new Error('La IA no devolvió un array.');
  }

  // Saneo defensivo: solo strings no vacíos, sin duplicados, tope de 12 por
  // si el modelo se pasó de la cantidad pedida.
  const limpias = [...new Set(candidatas.filter((c) => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim()))];
  return limpias.slice(0, 12);
}

module.exports = { sugerirPalabrasClave };
