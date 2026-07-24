const { obtenerDetalleLicitacion } = require('../services/mercadopublico.service');
const { obtenerDetalleCompraAgil, CuotaAgotadaError } = require('../services/compraagil.service');
const {
  listarLicitacionesPendientesDeResolucion,
  actualizarResolucionLicitacion,
} = require('../db/licitaciones.queries');
const {
  listarCompraAgilPendienteDeResolucion,
  actualizarResolucionCompraAgil,
} = require('../db/compra-agil.queries');
const { ESTADOS_FINALES_LICITACION, ESTADOS_FINALES_COMPRA_AGIL } = require('../utils/estados-finales');
const { extraerItemsConAdjudicacion } = require('../utils/adjudicacion');

const DELAY_LICITACIONES_MS = 3100; // mismo mínimo que exige la API de licitaciones

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function revisarLicitaciones(limite) {
  let codigos = await listarLicitacionesPendientesDeResolucion();

  if (limite) {
    codigos = codigos.slice(0, limite);
  }

  if (codigos.length === 0) {
    console.log('[revisar-resoluciones] Sin licitaciones pendientes de revisar.');
    return;
  }

  console.log(`[revisar-resoluciones] Revisando ${codigos.length} licitaciones cerradas...`);

  let resueltas = 0;
  let siguenPendientes = 0;

  for (const codigo of codigos) {
    try {
      const detalle = await obtenerDetalleLicitacion(codigo);
      if (detalle) {
        const esFinal = ESTADOS_FINALES_LICITACION.includes(detalle.Estado);

        await actualizarResolucionLicitacion(codigo, {
          items: extraerItemsConAdjudicacion(detalle),
          estado: detalle.Estado || null,
          // Fechas.FechaAdjudicacion trae la hora real; Adjudicacion.Fecha
          // (separado) siempre viene a medianoche en la API — se prioriza el
          // que sí tiene hora (ver mismo fix en licitaciones.queries.js).
          fechaAdjudicacion: detalle.Fechas?.FechaAdjudicacion || detalle.Adjudicacion?.Fecha || null,
          numeroOferentes: detalle.Adjudicacion?.NumeroOferentes || null,
          urlActa: detalle.Adjudicacion?.UrlActa || null,
          resuelta: esFinal,
        });

        if (esFinal) resueltas++;
        else siguenPendientes++;
      }
    } catch (err) {
      console.error(`[revisar-resoluciones] Error revisando licitación ${codigo}:`, err.message);
    }
    await sleep(DELAY_LICITACIONES_MS);
  }

  console.log(`[revisar-resoluciones] Licitaciones: ${resueltas} resueltas, ${siguenPendientes} siguen pendientes.`);
}

async function revisarComprasAgiles() {
  const codigos = await listarCompraAgilPendienteDeResolucion();

  if (codigos.length === 0) {
    console.log('[revisar-resoluciones] Sin Compras Ágiles pendientes de revisar.');
    return;
  }

  console.log(`[revisar-resoluciones] Revisando ${codigos.length} Compras Ágiles cerradas...`);

  let resueltas = 0;
  let siguenPendientes = 0;

  for (const codigo of codigos) {
    try {
      const detalle = await obtenerDetalleCompraAgil(codigo);
      const nuevoEstado = detalle.estado?.codigo || null;
      const esFinal = ESTADOS_FINALES_COMPRA_AGIL.includes(nuevoEstado);

      await actualizarResolucionCompraAgil(codigo, {
        estado: nuevoEstado,
        idOrdenCompra: detalle.id_orden_compra || null,
        proveedoresCotizando: detalle.proveedores_cotizando || [],
        productosSolicitados: detalle.productos_solicitados || [],
        resuelta: esFinal,
      });

      if (esFinal) resueltas++;
      else siguenPendientes++;
    } catch (err) {
      if (err instanceof CuotaAgotadaError) {
        console.warn('[revisar-resoluciones] Cuota diaria de Compra Ágil agotada, se corta acá por hoy.');
        break;
      }
      console.error(`[revisar-resoluciones] Error revisando Compra Ágil ${codigo}:`, err.message);
    }
  }

  console.log(`[revisar-resoluciones] Compra Ágil: ${resueltas} resueltas, ${siguenPendientes} siguen pendientes.`);
}

/**
 * Revisa licitaciones y Compras Ágiles cerradas que aún no sabemos si se
 * resolvieron (adjudicadas, desiertas, etc.), y guarda el resultado cuando
 * ya haya uno. Pensado para correr una vez al día (no hay apuro — la
 * adjudicación puede tardar días o semanas en publicarse).
 *
 * Compra Ágil: confirmado con un caso real que al resolverse el estado.codigo
 * cambia de "publicada" a otro valor (ej. "proveedor_seleccionado"), y
 * proveedores_cotizando queda con el detalle completo de TODAS las cotizaciones
 * recibidas — no solo la ganadora — incluyendo precio unitario por producto de
 * cada una y por qué se rechazaron las que no ganaron. Justo el dato que hace
 * falta para comparar precios de la competencia a futuro.
 */
async function correrRevisionResoluciones(opciones = {}) {
  console.log('[revisar-resoluciones] Iniciando...');
  // Compra Ágil primero: no tiene delay entre llamadas, así que es rápido y
  // siempre alcanza a correr — aunque licitaciones se corte por timeout HTTP
  // (con el delay de 3s por licitación, una corrida grande puede tardar mucho
  // más que cualquier timeout razonable), Compra Ágil ya quedó procesado.
  await revisarComprasAgiles();
  await revisarLicitaciones(opciones.limiteLicitaciones);
  console.log('[revisar-resoluciones] Terminado.');
}

module.exports = { correrRevisionResoluciones };
