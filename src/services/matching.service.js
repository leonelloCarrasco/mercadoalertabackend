const { obtenerTramo } = require('../utils/tramos-licitacion');
const { obtenerValorUTM } = require('./utm.service');

/**
 * Compara los códigos disponibles (de una licitación o Compra Ágil) contra las
 * categorías/productos elegidos en una alerta.
 *
 * Un código UNSPSC de 8 dígitos que TERMINA en "00" es de categoría (nivel 3,
 * ej. "51101500" = Antibióticos) — matchea por PREFIJO de 6 dígitos, así que
 * "cubre" cualquier producto de esa categoría.
 *
 * Un código que NO termina en "00" es un producto específico (nivel 4, ej.
 * "51101503" = Cloranfenicol) — matchea EXACTO, porque el usuario eligió ese
 * producto puntual, no toda la categoría.
 *
 * codigosDisponibles: array de strings (codigo_producto u codigo_categoria de
 * los ítems del proceso). codigosSeleccionados: array de códigos elegidos en la alerta.
 */
function algunCodigoCoincide(codigosDisponibles, codigosSeleccionados) {
  if (codigosDisponibles.length === 0) return false;

  return codigosSeleccionados.some((seleccionado) => {
    const cod = String(seleccionado);

    // Formato Obras (9 dígitos) — solo existen 3 categorías conocidas hoy
    // (Obra, Consultoría, Obra MINVU, ver migración 022), sin sub-jerarquía
    // real, así que acá SIEMPRE es coincidencia exacta, nunca por prefijo.
    if (/^\d{9}$/.test(cod)) {
      return codigosDisponibles.includes(cod);
    }

    // Formato UNSPSC estándar (8 dígitos) — categoría (termina en "00") por
    // prefijo de 6 dígitos, producto específico por coincidencia exacta.
    if (/^\d{8}$/.test(cod)) {
      const disponiblesValidos = codigosDisponibles.filter((c) => /^\d{8}$/.test(c));
      if (cod.endsWith('00')) {
        const prefijo = cod.slice(0, 6);
        return disponiblesValidos.some((disponible) => disponible.startsWith(prefijo));
      }
      return disponiblesValidos.includes(cod);
    }

    return false; // formato desconocido — se ignora en vez de arriesgar un match mal calculado
  });
}

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
 * - categorias: una licitación puede tener VARIOS ítems (productos), cada uno con su propio
 *   codigo_producto y codigo_categoria — antes solo mirábamos el primer ítem, lo que hacía
 *   perder matches reales. Ahora se revisan TODOS los ítems, comparando tanto por código de
 *   producto como de categoría contra lo elegido en la alerta (ver algunCodigoCoincide).
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

  const items = detalle.Items?.Listado || [];
  const codigosDisponibles = items.flatMap((it) => [
    it.CodigoProducto ? String(it.CodigoProducto) : null,
    it.CodigoCategoria ? String(it.CodigoCategoria) : null,
  ]).filter(Boolean);

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
      if (!algunCodigoCoincide(codigosDisponibles, config.categorias)) return false;
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
 * categorias: cada Compra Ágil puede pedir VARIOS productos a la vez (`productos_solicitados`),
 * cada uno con su propio codigo_producto (8 dígitos). La API de Compra Ágil NO expone
 * categoría (solo producto), pero igual funciona: si el usuario eligió una categoría en su
 * alerta, se compara por prefijo contra estos códigos de producto (ver algunCodigoCoincide).
 */
function matchCompraAgil(item, configs) {
  if (item.estado?.codigo !== 'publicada') return [];

  const montoDisponible = item.montos?.monto_disponible_clp || 0;
  const region = item.institucion?.nombre_region || null;
  const codigosDisponibles = (item.productos_solicitados || [])
    .map((p) => (p.codigo_producto ? String(p.codigo_producto) : null))
    .filter(Boolean);

  return configs.filter((config) => {
    if (config.categorias && config.categorias.length > 0) {
      if (!algunCodigoCoincide(codigosDisponibles, config.categorias)) return false;
    }
    if (config.monto_minimo && montoDisponible < config.monto_minimo) return false;
    if (config.region && region && config.region.trim() !== region.trim()) return false;
    return true;
  });
}

module.exports = { matchLicitacion, matchCompraAgil };
