const cheerio = require('cheerio');

/**
 * Convierte el HTML crudo de la ficha pública en texto plano legible, para
 * mandarlo como contexto a la IA. No se apunta a un selector CSS específico
 * de la sección "Contenido de las bases" a propósito — esa estructura no
 * está documentada en ningún lado y puede cambiar sin aviso; en cambio, se
 * saca TODO el texto visible de la página (sacando scripts/estilos/imágenes)
 * y se recorta el ruido de navegación conocido al final. Más robusto ante
 * cambios menores de maquetación que un selector puntual.
 */
function extraerTextoFicha(html) {
  const $ = cheerio.load(html);
  $('script, style, img, noscript').remove();

  // Sin esto, cheerio concatena el texto de elementos de bloque distintos
  // sin ningún separador (ej. un <h1> pegado directo al <p> siguiente) —
  // se le agrega un salto de línea al final de cada elemento de bloque
  // ANTES de extraer el texto, para que la IA reciba algo con estructura
  // reconocible en vez de todo corrido.
  $('br').replaceWith('\n');
  $('p, div, h1, h2, h3, h4, h5, h6, li, tr, td, th, section, article').each((i, el) => {
    $(el).append('\n');
  });

  const texto = $('body').text()
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');

  return texto;
}

module.exports = { extraerTextoFicha };
