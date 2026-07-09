/**
 * Mapeo del campo "Tipo" de una licitación (ej. "LE", "LP") a su tramo de monto
 * en UTM, según la clasificación oficial de Mercado Público.
 *
 * `utmMinGarantizado`: el monto real de la licitación es SIEMPRE mayor o igual
 * a este valor — no es una estimación, es parte de la definición del tramo
 * (ej. una licitación "LP" es por definición >= 1.000 UTM). Se usa para el
 * matching de alertas cuando no hay MontoEstimado exacto publicado.
 *
 * `utmMax`: cota superior del tramo, si existe (útil solo para mostrar el rango,
 * no se usa para garantizar un mínimo).
 *
 * Tramos sin `utmMinGarantizado` (ej. "menor a 100 UTM", o tipos sin rango
 * definido como Obras/Innovación/Diálogos Competitivos) no aportan ninguna
 * garantía útil para el matching por monto mínimo.
 */
const TRAMOS_LICITACION = {
  L1: { descripcion: 'Licitación Pública Menor a 100 UTM', utmMinGarantizado: null, utmMax: 100 },
  LE: { descripcion: 'Licitación Pública Entre 100 y 1.000 UTM', utmMinGarantizado: 100, utmMax: 1000 },
  LP: { descripcion: 'Licitación Pública igual o superior a 1.000 UTM e inferior a 2.000 UTM', utmMinGarantizado: 1000, utmMax: 2000 },
  LQ: { descripcion: 'Licitación Pública igual o superior a 2.000 UTM e inferior a 5.000 UTM', utmMinGarantizado: 2000, utmMax: 5000 },
  LR: { descripcion: 'Licitación Pública igual o superior a 5.000 UTM', utmMinGarantizado: 5000, utmMax: null },
  LS: { descripcion: 'Licitación Pública Servicios personales especializados', utmMinGarantizado: null, utmMax: null },
  O1: { descripcion: 'Licitación Pública de Obras', utmMinGarantizado: null, utmMax: null },
  E2: { descripcion: 'Licitación Privada Inferior a 100 UTM', utmMinGarantizado: null, utmMax: 100 },
  CO: { descripcion: 'Licitación Privada igual o superior a 100 UTM e inferior a 1.000 UTM', utmMinGarantizado: 100, utmMax: 1000 },
  B2: { descripcion: 'Licitación Privada igual o superior a 1.000 UTM e inferior a 2.000 UTM', utmMinGarantizado: 1000, utmMax: 2000 },
  H2: { descripcion: 'Licitación Privada igual o superior a 2.000 UTM e inferior a 5.000 UTM', utmMinGarantizado: 2000, utmMax: 5000 },
  I2: { descripcion: 'Licitación Privada Mayor a 5.000 UTM', utmMinGarantizado: 5000, utmMax: null },
  O2: { descripcion: 'Licitación Privada de Obras', utmMinGarantizado: null, utmMax: null },
  CI: { descripcion: 'Contrato para la Innovación con preselección', utmMinGarantizado: null, utmMax: null },
  DC: { descripcion: 'Diálogos Competitivos', utmMinGarantizado: null, utmMax: null },
  CI2: { descripcion: 'Contratos para la Innovación Fase 2', utmMinGarantizado: null, utmMax: null },
  DC2: { descripcion: 'Diálogos Competitivos Fase 2', utmMinGarantizado: null, utmMax: null },
};

function obtenerTramo(codigoTipo) {
  return TRAMOS_LICITACION[codigoTipo] || null;
}

module.exports = { TRAMOS_LICITACION, obtenerTramo };
