/**
 * Carga manual de Compras Ágiles con cambios en un día puntual, usando el
 * filtro de rango de fecha exacto de la API (cambio_desde/cambio_hasta,
 * ISO 8601) en vez del rodeo con ttl_cambio_ms que usaba la versión
 * anterior de este script.
 *
 * Ojo: cambio_desde/cambio_hasta filtran por fecha_ultimo_cambio, no por
 * fecha_publicacion — un ítem publicado ese día pero modificado después no
 * va a aparecer buscando ese día, y uno publicado antes pero modificado ese
 * día sí. Para "qué se publicó tal día" es una aproximación, no exacto —
 * pero para "qué tuvo actividad tal día" (que es lo más común que se quiere
 * recargar) es exacto.
 *
 * Uso:
 *   node scripts/backfill-compra-agil-por-dia.js ddmmaaaa [--avisar]
 *
 * Ejemplos:
 *   node scripts/backfill-compra-agil-por-dia.js 01082026
 *   node scripts/backfill-compra-agil-por-dia.js 01082026 --avisar
 *
 * Por default NO manda alertas a los usuarios (procesarAlertasCompraAgil) —
 * un backfill de un día pasado no debería spamear a nadie con "¡nueva!"
 * sobre algo de hace tiempo. Con --avisar sí se procesan alertas normales
 * para lo que se encuentre y sea nuevo.
 */
require('dotenv').config({ quiet: true });

const {
  listarTodosLosCambiosPorRangoFecha,
  obtenerDetalleCompraAgil,
  CuotaAgotadaError,
} = require('../src/services/compraagil.service');
const { obtenerCodigosCompraAgilYaVistos, guardarCompraAgil } = require('../src/db/compra-agil.queries');
const { procesarAlertasCompraAgil } = require('../src/services/alerting.service');
const pool = require('../src/db/pool');

const fechaArg = process.argv[2];
const avisar = process.argv.includes('--avisar');

if (!fechaArg || !/^\d{8}$/.test(fechaArg)) {
  console.error('Uso: node scripts/backfill-compra-agil-por-dia.js ddmmaaaa [--avisar]');
  process.exit(1);
}

const dia = fechaArg.slice(0, 2);
const mes = fechaArg.slice(2, 4);
const anio = fechaArg.slice(4, 8);
const fechaISO = `${anio}-${mes}-${dia}`;

const cambioDesde = `${fechaISO}T00:00:00Z`;
const cambioHasta = `${fechaISO}T23:59:59Z`;

console.log(`Buscando Compras Ágiles con cambios el ${fechaISO} (${cambioDesde} a ${cambioHasta})...`);
if (avisar) console.log('Modo --avisar activado: SÍ se van a mandar alertas a los usuarios por lo que se encuentre nuevo.');

(async () => {
  let items;
  try {
    items = await listarTodosLosCambiosPorRangoFecha(cambioDesde, cambioHasta);
  } catch (err) {
    if (err instanceof CuotaAgotadaError) {
      console.warn('Cuota diaria agotada — no se pudo completar la consulta.');
      await pool.end();
      return;
    }
    console.error('Error consultando la API:', err.message);
    await pool.end();
    process.exit(1);
  }

  console.log(`\n${items.length} ítems encontrados con cambios ese día.`);

  if (items.length === 0) {
    console.log('Nada para guardar.');
    await pool.end();
    return;
  }

  const codigos = items.map((item) => item.codigo);
  const yaVistos = await obtenerCodigosCompraAgilYaVistos(codigos);
  const nuevas = items.filter((item) => !yaVistos.has(item.codigo));

  console.log(`${nuevas.length} de ${items.length} son nuevas (el resto ya estaban guardadas en la base).`);

  if (nuevas.length === 0) {
    await pool.end();
    return;
  }

  const guardadas = [];
  for (const item of nuevas) {
    let detalle = null;
    try {
      detalle = await obtenerDetalleCompraAgil(item.codigo);
    } catch (err) {
      if (err instanceof CuotaAgotadaError) {
        console.warn(`Cuota agotada al pedir detalle de ${item.codigo} — se guarda solo el resumen.`);
      } else {
        console.error(`Error al pedir detalle de ${item.codigo}:`, err.message);
      }
    }
    await guardarCompraAgil(item, detalle);
    guardadas.push({ item, detalle });
    console.log(`  guardada: ${item.codigo} — ${item.nombre}`);
  }

  console.log(`\n${guardadas.length} Compras Ágiles guardadas.`);

  if (avisar && guardadas.length > 0) {
    console.log('Procesando alertas para lo recién guardado...');
    await procesarAlertasCompraAgil(guardadas);
    console.log('Alertas procesadas.');
  }

  await pool.end();
})();
