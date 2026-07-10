/**
 * Repara Compras Ágiles marcadas resuelta=true pero con proveedores_cotizando
 * en NULL (quedaron atascadas por un detalle incompleto al momento de
 * marcarse como resueltas — ver guardarCompraAgil en compra-agil.queries.js).
 * El job de revisión diario nunca las vuelve a mirar porque ya están en
 * resuelta=true, así que hace falta este script aparte.
 *
 * Correr:
 *   $env:DATABASE_URL="..."; $env:COMPRAAGIL_TICKET="..."; node scripts/reparar-proveedores-cotizando.js
 */
require('dotenv').config();
const pool = require('../src/db/pool');
const { obtenerDetalleCompraAgil, CuotaAgotadaError } = require('../src/services/compraagil.service');
const {
  listarCompraAgilResueltaSinProveedores,
  actualizarResolucionCompraAgil,
} = require('../src/db/compra-agil.queries');
const { ESTADOS_FINALES_COMPRA_AGIL } = require('../src/utils/estados-finales');

async function main() {
  const codigos = await listarCompraAgilResueltaSinProveedores();

  if (codigos.length === 0) {
    console.log('No hay Compras Ágiles atascadas con proveedores_cotizando vacío.');
    await pool.end();
    return;
  }

  console.log(`Reparando ${codigos.length} Compras Ágiles con proveedores_cotizando en NULL...`);

  let reparadas = 0;
  let errores = 0;

  for (const codigo of codigos) {
    try {
      const detalle = await obtenerDetalleCompraAgil(codigo);
      const nuevoEstado = detalle.estado?.codigo || null;

      await actualizarResolucionCompraAgil(codigo, {
        estado: nuevoEstado,
        idOrdenCompra: detalle.id_orden_compra || null,
        proveedoresCotizando: detalle.proveedores_cotizando || [],
        productosSolicitados: detalle.productos_solicitados || [],
        resuelta: ESTADOS_FINALES_COMPRA_AGIL.includes(nuevoEstado),
      });

      reparadas++;
      console.log(`  ✓ ${codigo} (${reparadas}/${codigos.length})`);
    } catch (err) {
      if (err instanceof CuotaAgotadaError) {
        console.warn(`\nCuota diaria agotada. Reparadas ${reparadas} de ${codigos.length} — corre este script de nuevo mañana.`);
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
