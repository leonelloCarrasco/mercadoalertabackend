/**
 * El listado resumido de licitaciones (estado=activas / fecha=X) solo trae
 * CodigoEstado (numérico) — no el texto — a diferencia del detalle por
 * código, que sí trae "Estado" como texto. Esta tabla es la documentada por
 * la propia API (https://api.mercadopublico.cl/modules/api.aspx, sección
 * "IMPORTANTE" de Licitaciones) para traducir uno a otro.
 */
const ESTADOS_LICITACION_POR_CODIGO = {
  5: 'Publicada',
  6: 'Cerrada',
  7: 'Desierta',
  8: 'Adjudicada',
  18: 'Revocada',
  19: 'Suspendida',
};

/**
 * Valores válidos para el parámetro `estado` en licitaciones.json cuando se
 * combina con `fecha` (distinto del `estado=activas`, que es un modo aparte).
 * 'todos' es el valor por defecto si el usuario no elige uno puntual.
 */
const ESTADOS_BUSQUEDA_VALIDOS = ['publicada', 'cerrada', 'desierta', 'adjudicada', 'revocada', 'suspendida', 'todos'];

function traducirEstadoLicitacion(codigoEstado) {
  return ESTADOS_LICITACION_POR_CODIGO[Number(codigoEstado)] || null;
}

module.exports = { ESTADOS_LICITACION_POR_CODIGO, ESTADOS_BUSQUEDA_VALIDOS, traducirEstadoLicitacion };
