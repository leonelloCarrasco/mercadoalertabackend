const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODELO = 'claude-sonnet-5';

// Límite generoso de caracteres de contexto que se manda a la IA — varios
// documentos de bases pueden sumar bastante texto (ver conversación de
// diseño: "hay que iterar sobre una lista, no asumir un solo archivo").
// Si algún día se agregan los adjuntos automáticos, este límite evita mandar
// contexto desproporcionado (costo) por una licitación con 10 anexos de 40
// páginas cada uno.
const MAX_CARACTERES_CONTEXTO = 60000;

/**
 * Arma el prompt — le pide a la IA que devuelva SOLO JSON (nada de texto
 * antes/después), con la forma exacta que después se guarda en
 * analisis_ia.contenido. Se le da la metadata que YA tenemos (nombre,
 * organismo, código, fecha de cierre) para que pueda validar que el texto
 * de bases corresponde al proceso declarado (paso 5 del diseño) sin
 * necesitar una llamada aparte.
 */
function armarPrompt({ tipoProceso, codigoExterno, metadata, textoBases, sinAdjuntos }) {
  const textoRecortado = textoBases.length > MAX_CARACTERES_CONTEXTO
    ? `${textoBases.slice(0, MAX_CARACTERES_CONTEXTO)}\n\n[...texto recortado por longitud...]`
    : textoBases;

  const tipoTexto = tipoProceso === 'compra_agil' ? 'Compra Ágil' : 'Licitación';

  return `Eres un asistente que ayuda a pequeñas y medianas empresas chilenas a entender licitaciones y Compras Ágiles del Estado (Mercado Público), ANTES de que decidan postular. Tu trabajo es dar un apoyo claro y honesto — NUNCA redactar ni completar la oferta en sí, solo ayudar a entender qué se pide.

DATOS YA CONOCIDOS de este proceso (${tipoTexto}, código ${codigoExterno}):
${JSON.stringify(metadata, null, 2)}

${sinAdjuntos
    ? 'IMPORTANTE: No se subió ningún documento de bases — el texto de abajo es solo la ficha pública resumida del proceso, no las bases administrativas/técnicas completas. Tu análisis va a estar necesariamente incompleto.'
    : 'El texto de abajo viene del/de los documento(s) de bases que el usuario subió.'}

TEXTO A ANALIZAR:
"""
${textoRecortado}
"""

Responde EXCLUSIVAMENTE con un JSON válido (sin texto antes ni después, sin markdown, sin \`\`\`), con esta forma exacta:

{
  "coincide": true o false — el texto de arriba corresponde de verdad a esta licitación/Compra Ágil (mismo nombre, organismo o código, aunque sea parcialmente)? Si el texto no menciona nada relacionado con los datos conocidos, es false.
  "razonNoCoincide": string o null — si coincide=false, explica brevemente por qué.
  "resumen": string — resumen en lenguaje simple y directo (3-5 párrafos), pensado para alguien sin formación legal. Qué se licita, quién compra, cuándo cierra, y lo más importante para decidir si postular o no.
  "fechasClave": array de objetos {"nombre": string, "fecha": string} — todas las fechas relevantes que encuentres.
  "checklistDocumentos": array de objetos {"documento": string, "obligatorio": true/false, "notas": string o null} — TODOS los documentos/anexos que se exigen presentar, sacados del texto. Sé exhaustivo.
  "criteriosEvaluacion": array de objetos {"criterio": string, "ponderacion": string, "detalle": string o null} — cómo se evalúan las ofertas.
  "puntosDeAtencion": array de strings — cosas puntuales que un proponente podría pasar por alto y que causarían el rechazo/inadmisibilidad de su oferta.
}

Si sin_adjuntos es true o el texto es muy limitado, igual completa los campos con lo que SÍ se pueda saber, dejando arrays vacíos donde no haya información — no inventes datos que no estén en el texto.`;
}

/**
 * Llama a la API de Claude y parsea la respuesta como JSON. Lanza si la
 * respuesta no es JSON válido (no se intenta "adivinar" una estructura
 * parcial — mejor fallar claro que guardar algo corrupto en el caché
 * compartido, que vería cualquier otro usuario después).
 */
async function llamarIA(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY no configurada — no se puede ejecutar el análisis.');
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
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Error llamando a la API de Claude: HTTP ${response.status} — ${errorBody}`);
  }

  const data = await response.json();

  // Si Claude se quedó sin espacio a mitad del JSON, stop_reason lo dice
  // explícito — mejor un error claro de "hace falta más espacio" que un
  // JSON.parse fallando genérico más abajo.
  if (data.stop_reason === 'max_tokens') {
    console.error('[analisis-ia.service] La respuesta se cortó por max_tokens — el texto de entrada puede ser muy largo/detallado para el límite actual.');
    throw new Error('El análisis quedó incompleto porque el documento es muy extenso. Intenta de nuevo — si vuelve a pasar, avisa para ajustar el límite.');
  }

  const textoRespuesta = data.content?.find((b) => b.type === 'text')?.text;
  if (!textoRespuesta) {
    throw new Error('La IA no devolvió contenido de texto.');
  }

  // Extracción tolerante: en vez de asumir que la respuesta es JSON puro de
  // punta a punta (el prompt lo pide así, pero el modelo a veces igual
  // agrega una frase antes/después pese a la instrucción), se toma desde la
  // primera '{' hasta la última '}' — más robusto que solo sacar fences de
  // markdown.
  const inicio = textoRespuesta.indexOf('{');
  const fin = textoRespuesta.lastIndexOf('}');
  const jsonLimpio = (inicio !== -1 && fin !== -1 && fin > inicio)
    ? textoRespuesta.slice(inicio, fin + 1)
    : textoRespuesta.trim();

  try {
    return JSON.parse(jsonLimpio);
  } catch (err) {
    console.error('[analisis-ia.service] Respuesta de la IA no es JSON válido. Primeros 1000 caracteres:', textoRespuesta.slice(0, 1000));
    console.error('[analisis-ia.service] Últimos 300 caracteres:', textoRespuesta.slice(-300));
    throw new Error('La IA devolvió una respuesta con formato inesperado. Intenta de nuevo.');
  }
}

/**
 * Orquesta todo: arma el prompt con lo que ya se extrajo (texto de
 * archivo(s) y/o de la ficha pública) y la metadata conocida, llama a la IA,
 * y devuelve el JSON estructurado listo para guardar en caché.
 */
async function analizarProceso({ tipoProceso, codigoExterno, metadata, textoBases, sinAdjuntos }) {
  const prompt = armarPrompt({ tipoProceso, codigoExterno, metadata, textoBases, sinAdjuntos });
  return llamarIA(prompt);
}

module.exports = { analizarProceso };
