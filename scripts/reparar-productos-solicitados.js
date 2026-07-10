/**
 * Repara las Compras Ágiles guardadas ANTES de la migración 015 (que agregó
 * productos_solicitados), re-consultando su detalle contra la API real.
 *
 * Solo toca las que siguen "publicada" — las cerradas/canceladas nunca más
 * van a generar una alerta, así que reconsultarlas sería gastar cuota de la
 * API sin ningún beneficio.
 *
 * Correr:
 *   $env:DATABASE_URL="..."; $env:COMPRAAGIL_TICKET="..."; node scripts/reparar-productos-solicitados.js
 *
 * Se puede cortar en cualquier momento (Ctrl+C) y volver a correr después —
 * cada vuelta solo toma las que todavía tengan productos_solicitados NULL.
 */
require('dotenv').config();
const pool = require('../src/db/pool');
const { obtenerDetalleCompraAgil, CuotaAgotadaError } = require('../src/services/compraagil.service');
const {
  listarCompraAgilSinProductos,
  actualizarProductosSolicitados,
} = require('../src/db/compra-agil.queries');

async function main() {
  const codigos = await listarCompraAgilSinProductos();

  if (codigos.length === 0) {
    console.log('No hay Compras Ágiles publicadas pendientes de reparar.');
    await pool.end();
    return;
  }

  console.log(`Reparando ${codigos.length} Compras Ágiles publicadas sin productos_solicitados...`);

  let reparadas = 0;
  let errores = 0;

  for (const codigo of codigos) {
    try {
      const detalle = await obtenerDetalleCompraAgil(codigo);
      await actualizarProductosSolicitados(codigo, detalle.productos_solicitados || []);
      reparadas++;
      console.log(`  ✓ ${codigo} (${reparadas}/${codigos.length})`);
    } catch (err) {
      if (err instanceof CuotaAgotadaError) {
        console.warn(`\nCuota diaria agotada. Reparadas ${reparadas} de ${codigos.length} — corre este script de nuevo mañana para seguir con el resto.`);
        break;
      }
      console.error(`  ✗ Error con ${codigo}:`, err.message);
      errores++;
    }
  }

  console.log(`\nListo. Reparadas: ${reparadas}. Errores: ${errores}.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Error general:', err);
  process.exit(1);
});
