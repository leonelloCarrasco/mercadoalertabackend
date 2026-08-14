const pool = require('./pool');

/**
 * ¿Ya hay algo archivado para este código? — se usa como chequeo de
 * deduplicación antes de archivar en la red de seguridad de la limpieza
 * (ver eliminarLicitacionesAntiguas/eliminarComprasAgilesAntiguas): si algo
 * ya se archivó en el momento de la resolución (camino principal), no hay
 * que volver a archivarlo antes de borrar, o quedarían precios duplicados.
 */
async function tienePreciosArchivados(codigoExterno) {
  const result = await pool.query('SELECT 1 FROM historico_precios WHERE codigo_externo = $1 LIMIT 1', [codigoExterno]);
  return result.rows.length > 0;
}

/**
 * Archiva el precio de adjudicación de cada item de una licitación resuelta
 * — se llama en DOS momentos (ver el comentario en la migración 049):
 * cuando revisar-resoluciones.js confirma la resolución, y como red de
 * seguridad justo antes de borrar (por si algo se coló sin pasar por el
 * primer camino).
 *
 * Si el item no tiene adjudicación (licitación Desierta/Revocada, o item sin
 * ganador dentro de una adjudicada parcial), simplemente no se archiva ese
 * item — no hace falta chequear el estado por separado.
 *
 * `items` viene en el mismo formato que produce extraerItemsConAdjudicacion
 * (ver utils/adjudicacion.js) — es exactamente lo que ya queda guardado en
 * licitaciones_vistas.items, así que la red de seguridad puede reusar la
 * fila tal cual está en la base, sin volver a pedirle nada a la API.
 */
async function archivarPreciosLicitacion({ codigoExterno, nombre, organismo, fechaAdjudicacion, numeroOferentes, urlActa, items }) {
  const filas = (items || []).filter((item) => item.adjudicacion?.monto_unitario != null);
  if (filas.length === 0) return 0;

  for (const item of filas) {
    await pool.query(
      `INSERT INTO historico_precios
         (codigo_externo, fuente, codigo_producto, nombre_producto, proceso_nombre,
          organismo, fecha_adjudicacion, rut_proveedor, nombre_proveedor,
          precio_unitario, cantidad, gano, numero_oferentes, url_acta)
       VALUES ($1, 'licitacion', $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12)`,
      [
        codigoExterno,
        item.codigo_producto,
        item.nombre_producto,
        nombre,
        organismo,
        fechaAdjudicacion,
        item.adjudicacion.rut_proveedor,
        item.adjudicacion.nombre_proveedor,
        item.adjudicacion.monto_unitario,
        item.adjudicacion.cantidad,
        numeroOferentes,
        urlActa,
      ]
    );
  }

  return filas.length;
}

/**
 * Archiva el precio de CADA cotización de una Compra Ágil resuelta — no
 * solo la ganadora, para poder comparar a futuro qué precio ganó vs.
 * cuáles quedaron afuera. Mismos dos momentos de llamada que la de arriba.
 *
 * `proveedoresCotizando` viene tal cual llega de la API — es exactamente lo
 * que ya queda guardado en compras_agiles_vistas.proveedores_cotizando.
 */
async function archivarPreciosCompraAgil({ codigoExterno, nombre, organismo, fechaCierre, proveedoresCotizando }) {
  let guardadas = 0;

  for (const prov of proveedoresCotizando || []) {
    const gano = Number(prov.proveedor_seleccionado) === 1;

    for (const prod of prov.productos_cotizados || []) {
      if (prod.precio_unitario == null) continue;

      await pool.query(
        `INSERT INTO historico_precios
           (codigo_externo, fuente, codigo_producto, nombre_producto, proceso_nombre,
            organismo, fecha_adjudicacion, rut_proveedor, nombre_proveedor,
            precio_unitario, cantidad, gano, motivo_rechazo)
         VALUES ($1, 'compra_agil', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          codigoExterno,
          prod.codigo_producto,
          prod.nombre_producto,
          nombre,
          organismo,
          fechaCierre,
          prov.rut_proveedor,
          prov.razon_social,
          prod.precio_unitario,
          prod.cantidad,
          gano,
          prov.justificacion_inadmisibilidad || null,
        ]
      );
      guardadas++;
    }
  }

  return guardadas;
}

module.exports = { tienePreciosArchivados, archivarPreciosLicitacion, archivarPreciosCompraAgil };
