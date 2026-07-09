const { obtenerTramo } = require('../utils/tramos-licitacion');
const { obtenerValorUTM } = require('./utm.service');

/**
 * Dado el detalle de una licitación y la lista de configuraciones activas,
 * devuelve las configuraciones (con su usuario) que hacen match.
 *
 * Solo matchea licitaciones "Publicada" y con fecha de cierre aún no vencida.
 * El endpoint de listado (?estado=activas) incluye licitaciones en distintas
 * etapas del proceso, no solo las abiertas para ofertar — por ejemplo, puede
 * traer licitaciones cuyo plazo de ofertas ya cerró pero siguen "activas"
 * mientras se evalúan o adjudican. Notificar sobre esas no tiene sentido,
 * porque ya no se puede ofertar. Se usan dos chequeos independientes (estado
 * y fecha) porque no tenemos la lista completa y confirmada de todos los
 * valores posibles de Estado — la fecha es un resguardo que no depende de eso.
 *
 * Criterios de matching (todos opcionales; una config sin ningún criterio matchea con todo):
 * - categorias: si la config tiene categorías, el codigo_categoria de la licitación debe estar incluido.
 * - montoMinimo: el monto estimado de la licitación debe ser >= al mínimo de la config.
 *   Si Mercado Público no publicó un MontoEstimado exacto, se usa el mínimo GARANTIZADO
 *   del tramo de la licitación (ej. tipo "LP" garantiza monto >= 1.000 UTM) convertido a
 *   pesos con el valor vigente de la UTM — no es una estimación al azar, es un piso real.
 * - region: si la config tiene región, debe coincidir con la región de la licitación.
 */
async function matchLicitacion(detalle, configs) {
  if (detalle.Estado !== 'Publicada') return [];

  const fechaCierre = detalle.Fechas?.FechaCierre;
  if (fechaCierre && new Date(fechaCierre) < new Date()) return [];

  const item = detalle.Items?.Listado?.[0];
  const codigoCategoria = item?.CodigoCategoria || null;
  const region = detalle.Comprador?.RegionUnidad || null;

  let montoEstimado = detalle.MontoEstimado || 0;

  if (!montoEstimado) {
    const tramo = obtenerTramo(detalle.Tipo);
    if (tramo?.utmMinGarantizado) {
      const valorUtm = await obtenerValorUTM();
      if (valorUtm) {
        montoEstimado = tramo.utmMinGarantizado * valorUtm;
      }
    }
  }

  return configs.filter((config) => {
    if (config.categorias && config.categorias.length > 0) {
      if (!codigoCategoria || !config.categorias.includes(codigoCategoria)) return false;
    }
    if (config.monto_minimo && montoEstimado < config.monto_minimo) return false;
    if (config.region && region && config.region.trim() !== region.trim()) return false;
    return true;
  });
}

/**
 * Igual que matchLicitacion, pero para Compras Ágiles.
 *
 * Solo matchea procesos con estado "publicada" — el endpoint de cambios recientes
 * también incluye procesos que cambiaron de estado (cerrados, cancelados, desiertos,
 * adjudicados), que no tiene sentido notificar porque ya no se puede ofertar.
 * Igual se guardan en la base de datos sin importar el estado (ver poll-compra-agil.js),
 * esto solo afecta si generan una alerta o no.
 *
 * NOTA: la API de Compra Ágil no expone una categoría clasificada en el listado,
 * así que por ahora el matching solo usa monto y región. El filtro de categoría
 * de la config se ignora para este tipo de proceso (limitación conocida, revisar en v2
 * si el detalle trae algo aprovechable en `productos_solicitados`).
 */
function matchCompraAgil(item, configs) {
  if (item.estado?.codigo !== 'publicada') return [];

  const montoDisponible = item.montos?.monto_disponible_clp || 0;
  const region = item.institucion?.nombre_region || null;

  return configs.filter((config) => {
    if (config.monto_minimo && montoDisponible < config.monto_minimo) return false;
    if (config.region && region && config.region.trim() !== region.trim()) return false;
    return true;
  });
}

module.exports = { matchLicitacion, matchCompraAgil };
