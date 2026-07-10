/**
 * Repara las licitaciones guardadas ANTES de la migración 016 (que agregó
 * guardar todos los ítems, no solo el primero), re-consultando su detalle
 * contra la API real.
 *
 * Solo toca las que aún no cierran — una vez pasada la fecha de cierre, el
 * matching las descarta igual, así que no vale la pena gastar llamadas en esas.
 *
 * OJO: a diferencia del script de Compra Ágil, acá cada llamada respeta el
 * mínimo de 3 segundos entre consultas que exige la API de Mercado Público —
 * con muchas licitaciones pendientes esto puede tardar bastante
 * (ej. 500 licitaciones ≈ 25 minutos). Se puede cortar con Ctrl+C y correr
 * de nuevo después, retoma donde quedó.
 *
 * Correr:
 *   $env:DATABASE_URL="..."; $env:MERCADOPUBLICO_TICKET="..."; node scripts/reparar-items-licitaciones.js
 */
require('dotenv').config();
const pool = require('../src/db/pool');
const { obtenerDetalleLicitacion } = require('../src/services/mercadopublico.service');
const {
  listarLicitacionesSinItems,
  actualizarItemsLicitacion,
} = require('../src/db/licitaciones.queries');

const DELAY_ENTRE_LLAMADAS_MS = 3100; // mismo margen que usa el polling normal

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extraerItems(detalle) {
  return (detalle.Items?.Listado || []).map((it) => ({
    codigo_producto: it.CodigoProducto || null,
    codigo_categoria: it.CodigoCategoria || null,
    categoria: it.Categoria || null,
    nombre_producto: it.NombreProducto || null,
  }));
}

async function main() {
  const codigos = await listarLicitacionesSinItems();

  if (codigos.length === 0) {
    console.log('No hay licitaciones vigentes pendientes de reparar.');
    await pool.end();
    return;
  }

  const minutosEstimados = Math.ceil((codigos.length * DELAY_ENTRE_LLAMADAS_MS) / 60000);
  console.log(`Reparando ${codigos.length} licitaciones vigentes sin items guardados.`);
  console.log(`Tiempo estimado: ~${minutosEstimados} minutos (3s entre cada una).\n`);

  let reparadas = 0;
  let errores = 0;

  for (const codigo of codigos) {
    try {
      const detalle = await obtenerDetalleLicitacion(codigo);
      if (detalle) {
        await actualizarItemsLicitacion(codigo, extraerItems(detalle));
        reparadas++;
        console.log(`  ✓ ${codigo} (${reparadas}/${codigos.length})`);
      } else {
        console.warn(`  ⚠ ${codigo}: no se encontró detalle (puede haber sido retirada)`);
        errores++;
      }
    } catch (err) {
      console.error(`  ✗ Error con ${codigo}:`, err.message);
      errores++;
    }
    await sleep(DELAY_ENTRE_LLAMADAS_MS);
  }

  console.log(`\nListo. Reparadas: ${reparadas}. Errores: ${errores}.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Error general:', err);
  process.exit(1);
});
