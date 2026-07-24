/**
 * Carga licitaciones publicadas en UNA fecha puntual, de los tipos
 * relevantes (L1, LE, LP, LQ, LR, LS, 01) — parecido a poll-licitaciones.js,
 * pero SIN el filtro estado=activas (trae TODO lo publicado ese día, sin
 * importar en qué estado esté ahora) y para una fecha puntual, no continuo.
 *
 * A diferencia del polling en vivo, este script NO dispara notificaciones de
 * alertas — es puramente para cargar datos históricos (backfill).
 *
 * El tipo de licitación se extrae directamente del propio CodigoExterno (ej.
 * "1236-13-LE26" -> tipo "LE", año "26") en vez de pedir el detalle de TODAS
 * las licitaciones del día para enterarse — el listado resumido por fecha no
 * trae el campo Tipo (solo CodigoExterno, Nombre, CodigoEstado, FechaCierre;
 * ver el comentario en estados-licitacion.js), así que sin este atajo habría
 * que traer el detalle completo de cada una solo para descartar la mayoría
 * después. El último segmento del código (después del último guión) siempre
 * termina en el año de 2 dígitos — todo lo anterior a eso, en ese mismo
 * segmento, es el tipo. Verificado contra 3 códigos reales ya conocidos
 * (1236-13-LE26, 1509-5-L114, 1058085-122-LE26) antes de confiar en esto.
 *
 * Uso:
 *   node scripts/carga-licitaciones-por-fecha.js DDMMAAAA
 *   node scripts/carga-licitaciones-por-fecha.js 15072026
 */
require('dotenv').config({ quiet: true });
const { obtenerLicitacionesPorFecha, obtenerDetallesConDelay } = require('../src/services/mercadopublico.service');
const { obtenerCodigosYaVistos, guardarLicitacion } = require('../src/db/licitaciones.queries');
const pool = require('../src/db/pool');

const TIPOS_A_CARGAR = ['L1', 'LE', 'LP', 'LQ', 'LR', 'LS', 'O1'];

/**
 * El código externo termina en [TIPO][AA] (año de 2 dígitos) — ej.
 * "1236-13-LE26" -> tipo "LE". Se toma el último segmento (después del
 * último '-') y se separan los últimos 2 caracteres (año) del resto (tipo).
 * Devuelve null si el código no tiene la forma esperada (muy corto, o sin
 * guiones) — en ese caso, quien llama decide qué hacer (por ahora: se omite,
 * mejor no cargarla que cargarla mal clasificada).
 */
function extraerTipoDesdeCodigo(codigoExterno) {
  if (!codigoExterno) return null;
  const segmentos = codigoExterno.split('-');
  const ultimoSegmento = segmentos[segmentos.length - 1];
  if (!ultimoSegmento || ultimoSegmento.length < 3) return null;
  return ultimoSegmento.slice(0, -2);
}

async function main() {
  const fecha = process.argv[2];
  if (!fecha || !/^\d{8}$/.test(fecha)) {
    console.error('Falta la fecha o el formato no es válido.');
    console.error('Uso: node scripts/carga-licitaciones-por-fecha.js DDMMAAAA');
    console.error('Ejemplo: node scripts/carga-licitaciones-por-fecha.js 15072026');
    process.exit(1);
  }

  console.log(`Consultando licitaciones publicadas el ${fecha}...`);
  const listado = await obtenerLicitacionesPorFecha(fecha);
  console.log(`${listado.length} licitaciones publicadas ese día (todos los tipos y estados).`);

  // 1. Filtrar por tipo usando el propio código externo — sin pedir ningún
  // detalle todavía, así no se gasta ni un solo llamado de más en tipos que
  // no interesan.
  const tiposEncontrados = new Map(); // para el resumen final, informativo
  const conTipoValido = listado.filter((item) => {
    const tipo = extraerTipoDesdeCodigo(item.CodigoExterno);
    tiposEncontrados.set(tipo, (tiposEncontrados.get(tipo) || 0) + 1);
    return tipo && TIPOS_A_CARGAR.includes(tipo);
  });
  console.log(`${conTipoValido.length} de esos son de los tipos buscados (${TIPOS_A_CARGAR.join(', ')}).`);

  // 2. Sacar las que ya tenemos guardadas — no hace falta pedir su detalle
  // de nuevo (mismo criterio que poll-licitaciones.js).
  const codigos = conTipoValido.map((item) => item.CodigoExterno);
  const yaVistos = await obtenerCodigosYaVistos(codigos);
  const nuevos = codigos.filter((codigo) => !yaVistos.has(codigo));

  console.log(`${codigos.length - nuevos.length} ya estaban guardadas, se omiten.`);

  if (nuevos.length === 0) {
    console.log('\nNada nuevo que cargar.');
    await pool.end();
    return;
  }

  console.log(`${nuevos.length} licitaciones nuevas a cargar — trayendo detalle (esto toma ~${Math.round(nuevos.length * 3.1)}s, respetando el delay entre llamadas)...\n`);
  const detalles = await obtenerDetallesConDelay(nuevos);

  let guardadas = 0;
  let conError = 0;
  for (const detalle of detalles) {
    try {
      await guardarLicitacion(detalle);
      guardadas++;
    } catch (err) {
      conError++;
      console.error(`  ❌ ${detalle.CodigoExterno}: ${err.message}`);
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log('Resumen:');
  console.log(`  Publicadas ese día (todos los tipos):     ${listado.length}`);
  console.log(`  De los tipos buscados:                    ${conTipoValido.length}`);
  console.log(`  Ya existían (se omitieron):                ${codigos.length - nuevos.length}`);
  console.log(`  Detalles obtenidos de Mercado Público:     ${detalles.length}`);
  console.log(`  Guardadas en la base:                      ${guardadas}`);
  console.log(`  Con error al guardar:                      ${conError}`);
  console.log('─'.repeat(50));
  console.log('\nDesglose de tipos vistos ese día (para referencia):');
  [...tiposEncontrados.entries()].sort((a, b) => b[1] - a[1]).forEach(([tipo, cant]) => {
    console.log(`  ${tipo || '(sin tipo detectado)'}: ${cant}`);
  });

  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error general:', err);
    process.exit(1);
  });
}

module.exports = { extraerTipoDesdeCodigo, TIPOS_A_CARGAR, main };
