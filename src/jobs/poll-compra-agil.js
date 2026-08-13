const {
  listarTodosLosCambiosRecientes,
  obtenerDetalleCompraAgil,
  CuotaAgotadaError,
} = require('../services/compraagil.service');
const { obtenerCodigosCompraAgilYaVistos, guardarCompraAgil } = require('../db/compra-agil.queries');
const { procesarAlertasCompraAgil } = require('../services/alerting.service');

// La ventana corta (antes 90 min, después 6hs) dejó de funcionar del todo
// en agosto 2026 — la API Beta de Compra Ágil devuelve total_resultados=0
// de forma consistente para ttl_cambio_ms chico (confirmado con logs de
// producción durante una semana entera + prueba manual directa contra la
// API). Con ttl_cambio_ms=7 días la API SÍ responde con datos reales y
// recientes (confirmado manualmente) — el parámetro además es obligatorio,
// omitirlo tira ERROR_INTERNO, así que no se puede sacar sin más.
//
// Recorrer 1000 páginas cada corrida sería absurdo — por eso
// listarTodosLosCambiosRecientes ahora corta la paginación apenas
// encuentra una página 100% conocida (ver detenerSiPaginaCompleta más
// abajo), apoyándose en que la API ordena por fecha_ultimo_cambio
// descendente. En la práctica, cada corrida solo pagina hasta donde
// alcanzan los cambios genuinamente nuevos desde la corrida anterior.
const TTL_CAMBIO_MS = 6 * 60 * 60 * 1000;

/**
 * Corre una pasada de detección de Compras Ágiles nuevas:
 * 1. Trae los cambios de los últimos TTL_CAMBIO_MS milisegundos, paginando
 *    hasta encontrar una página 100% ya conocida (no todas las páginas).
 * 2. Filtra las que ya conocemos.
 * 3. Para las nuevas, intenta traer el detalle completo (proveedores_cotizando incluido).
 * 4. Las guarda en la base de datos.
 *
 * Prioriza guardar rápido (sin esperar el detalle) porque una Compra Ágil puede cerrar en 24hs;
 * si el detalle falla por cuota agotada, igual se guarda el resumen y se sigue.
 */
async function correrPollingCompraAgil(opciones = {}) {
  console.log('[poll-compra-agil] Iniciando...');

  const ttlMs = opciones.ttlMs || TTL_CAMBIO_MS;
  console.log(`[poll-compra-agil] Usando ttl_cambio_ms=${ttlMs}`);

  let items;
  try {
    items = await listarTodosLosCambiosRecientes(ttlMs, {
      // Corte temprano de paginación — ver el comentario largo en
      // TTL_CAMBIO_MS más arriba y el de listarTodosLosCambiosRecientes en
      // compraagil.service.js. Reusa la misma función que ya se usaba más
      // abajo para filtrar — acá se llama por página en vez de una sola
      // vez al final, así se puede cortar apenas ya no hay nada nuevo.
      detenerSiPaginaCompleta: async (codigosPagina) => {
        const yaVistosPagina = await obtenerCodigosCompraAgilYaVistos(codigosPagina);
        return codigosPagina.every((c) => yaVistosPagina.has(c));
      },
    });
  } catch (err) {
    if (err instanceof CuotaAgotadaError) {
      console.warn('[poll-compra-agil] Cuota diaria agotada, se omite esta corrida.');
      return [];
    }
    throw err;
  }

  console.log(`[poll-compra-agil] ${items.length} procesos con cambios recientes.`);

  const codigos = items.map((item) => item.codigo);
  const yaVistos = await obtenerCodigosCompraAgilYaVistos(codigos);
  const nuevas = items.filter((item) => !yaVistos.has(item.codigo));

  if (nuevas.length === 0) {
    console.log('[poll-compra-agil] No hay Compras Ágiles nuevas.');
    return [];
  }

  console.log(`[poll-compra-agil] ${nuevas.length} Compras Ágiles nuevas — guardando...`);

  const guardadas = [];
  for (const item of nuevas) {
    let detalle = null;
    try {
      detalle = await obtenerDetalleCompraAgil(item.codigo);
    } catch (err) {
      if (err instanceof CuotaAgotadaError) {
        console.warn(`[poll-compra-agil] Cuota agotada al pedir detalle de ${item.codigo}, se guarda solo el resumen.`);
      } else {
        console.error(`[poll-compra-agil] Error al pedir detalle de ${item.codigo}:`, err.message);
      }
    }

    await guardarCompraAgil(item, detalle);
    guardadas.push({ item, detalle });
  }

  console.log(`[poll-compra-agil] ${guardadas.length} Compras Ágiles nuevas guardadas.`);

  await procesarAlertasCompraAgil(guardadas);

  return guardadas;
}

module.exports = { correrPollingCompraAgil };
