/**
 * Arma el array de items (con su adjudicación, si la tiene) a partir del
 * detalle completo de una licitación — mismo formato que se guarda en
 * licitaciones_vistas.items. Compartida entre revisar-resoluciones.js (revisión
 * diaria de licitaciones cerradas) y seguimiento-estado.js (seguimiento en
 * vivo de licitaciones puntuales) para no tener dos copias de este parseo.
 */
function extraerItemsConAdjudicacion(detalle) {
  return (detalle.Items?.Listado || []).map((it) => ({
    codigo_producto: it.CodigoProducto || null,
    codigo_categoria: it.CodigoCategoria || null,
    categoria: it.Categoria || null,
    nombre_producto: it.NombreProducto || null,
    adjudicacion: it.Adjudicacion
      ? {
          rut_proveedor: it.Adjudicacion.RutProveedor || null,
          nombre_proveedor: it.Adjudicacion.NombreProveedor || null,
          cantidad: it.Adjudicacion.Cantidad || null,
          monto_unitario: it.Adjudicacion.MontoUnitario || null,
        }
      : null,
  }));
}

module.exports = { extraerItemsConAdjudicacion };
