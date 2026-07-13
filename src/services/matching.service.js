const { obtenerHijosPorCodigo } = require('../db/categorias-unspsc.queries');

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
 * Un código de 9 dígitos es de la sección Obras/Consultoría (migración 022),
 * que tiene su propia numeración con jerarquía real pero SIN convención de
 * prefijo/sufijo que permita inferir la relación padre-hijo desde el número
 * (a diferencia de UNSPSC). Por eso se usa `hijosPorCodigo` (migración 026,
 * precomputado desde el árbol real del Excel de origen): si el código elegido
 * es un nodo agrupador (ej. "Obras"), matchea tanto ese código exacto como
 * cualquiera de sus códigos hoja descendientes (ej. "Licitación Pública de
 * Obra"). Si es un código hoja sin hijos, matchea exacto, igual que un producto.
 *
 * codigosDisponibles: array de strings (codigo_producto u codigo_categoria de
 * los ítems del proceso). codigosSeleccionados: array de códigos elegidos en la
 * alerta. hijosPorCodigo: Map código -> códigos hoja descendientes (ver
 * obtenerHijosPorCodigo), solo tiene entradas para nodos agrupadores de 9 dígitos.
 */
function algunCodigoCoincide(codigosDisponibles, codigosSeleccionados, hijosPorCodigo) {
  if (codigosDisponibles.length === 0) return false;

  return codigosSeleccionados.some((seleccionado) => {
    const cod = String(seleccionado);

    if (/^\d{9}$/.test(cod)) {
      if (codigosDisponibles.includes(cod)) return true;
      const hijos = hijosPorCodigo.get(cod);
      return hijos ? hijos.some((hijo) => codigosDisponibles.includes(hijo)) : false;
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
 * - regiones: si la config tiene regiones (una o más), la región de la licitación debe
 *   estar incluida en esa lista. Si la config no tiene regiones (NULL o array vacío —
 *   el usuario no marcó ningún checkbox al crear la alerta), se entiende que aplica a
 *   TODAS las regiones, así que no filtra nada.
 * - tipos_proceso: si la config especifica 'licitacion' y/o 'compra_agil', debe incluir
 *   'licitacion' para que una LICITACIÓN matchee (ver la función simétrica para Compra
 *   Ágil más abajo). Vacío = aplica a ambos tipos.
 * - tramos_licitacion: si la config tiene tramos elegidos (L1, LE, LP, ...), el campo
 *   Tipo de la licitación debe estar entre ellos. Es el ÚNICO criterio de monto para
 *   licitaciones (migración 029) — monto_minimo/monto_maximo son exclusivos de Compra
 *   Ágil (ver matchCompraAgil) porque un tramo YA define un rango de monto por sí solo;
 *   pedir ambos criterios a la vez para el mismo proceso sería redundante y confuso.
 * - organismos: si la config tiene organismos elegidos, el organismo comprador de la
 *   licitación debe estar EXACTO entre ellos (se eligen desde un autocompletado sobre
 *   organismos reales, no texto libre — por eso alcanza con comparación exacta).
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
  const organismo = detalle.Comprador?.NombreOrganismo || null;
  const tipoLicitacion = detalle.Tipo || null;

  const hijosPorCodigo = await obtenerHijosPorCodigo();

  return configs.filter((config) => {
    if (config.categorias && config.categorias.length > 0) {
      if (!algunCodigoCoincide(codigosDisponibles, config.categorias, hijosPorCodigo)) return false;
    }
    if (config.regiones && config.regiones.length > 0 && region && !config.regiones.includes(region.trim())) return false;
    if (config.tipos_proceso && config.tipos_proceso.length > 0 && !config.tipos_proceso.includes('licitacion')) return false;
    if (config.tramos_licitacion && config.tramos_licitacion.length > 0 && tipoLicitacion && !config.tramos_licitacion.includes(tipoLicitacion)) return false;
    if (config.organismos && config.organismos.length > 0 && organismo && !config.organismos.includes(organismo.trim())) return false;
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
 *
 * tipos_proceso: análogo a matchLicitacion, pero exige incluir 'compra_agil'.
 * tramos_licitacion: NO aplica acá — Compra Ágil no tiene el concepto de tramo UTM.
 * monto_minimo / monto_maximo (migración 029): criterio EXCLUSIVO de Compra Ágil — para
 * Licitaciones el rango de monto se cubre con tramos_licitacion (ver matchLicitacion).
 * organismos: mismo criterio que en licitaciones, comparando contra nombre_institucion.
 */
async function matchCompraAgil(item, configs) {
  if (item.estado?.codigo !== 'publicada') return [];

  const montoDisponible = item.montos?.monto_disponible_clp || 0;
  const region = item.institucion?.nombre_region || null;
  const organismo = item.institucion?.organismo_comprador || null;
  const codigosDisponibles = (item.productos_solicitados || [])
    .map((p) => (p.codigo_producto ? String(p.codigo_producto) : null))
    .filter(Boolean);

  const hijosPorCodigo = await obtenerHijosPorCodigo();

  return configs.filter((config) => {
    if (config.categorias && config.categorias.length > 0) {
      if (!algunCodigoCoincide(codigosDisponibles, config.categorias, hijosPorCodigo)) return false;
    }
    if (config.monto_minimo && montoDisponible < config.monto_minimo) return false;
    if (config.monto_maximo && montoDisponible > config.monto_maximo) return false;
    if (config.regiones && config.regiones.length > 0 && region && !config.regiones.includes(region.trim())) return false;
    if (config.tipos_proceso && config.tipos_proceso.length > 0 && !config.tipos_proceso.includes('compra_agil')) return false;
    if (config.organismos && config.organismos.length > 0 && organismo && !config.organismos.includes(organismo.trim())) return false;
    return true;
  });
}

module.exports = { matchLicitacion, matchCompraAgil, algunCodigoCoincide };
