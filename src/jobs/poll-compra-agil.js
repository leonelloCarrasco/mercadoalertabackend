const {
  listarTodasLasPublicadas,
  obtenerDetalleCompraAgil,
  CuotaAgotadaError,
} = require('../services/compraagil.service');
const { obtenerCodigosCompraAgilYaVistos, guardarCompraAgil } = require('../db/compra-agil.queries');
const { procesarAlertasCompraAgil } = require('../services/alerting.service');

// Pausa entre cada llamado de detalle — antes no existía ninguna acá,
// mientras que el listado por páginas sí la tenía (PAUSA_ENTRE_PAGINAS_MS
// en compraagil.service.js). Si en una corrida aparecen muchas Compras
// Ágiles nuevas de golpe (por ejemplo, después de que el listado estuvo
// fallando un rato y se acumularon), pedir el detalle de todas en ráfaga
// corre el mismo riesgo de límite de corto plazo que ya se corrigió para
// la paginación — nunca se aplicó la misma lección acá (hallazgo del
// análisis de agosto 2026).
const PAUSA_ENTRE_DETALLES_MS = 300;
function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Evita que dos corridas se pisen si el cron (cada 3h) y un disparo manual
// vía /api/admin/poll-compra-agil caen al mismo tiempo — sin esto, las dos
// pagean en paralelo compitiendo por la misma cuota, y los logs de las dos
// quedan entrelazados (visto en producción: reintentos de 5xx duplicados
// en el mismo bloque de log, agosto 2026 — parecía un solo intento
// fallando 4 veces, pero eran dos corridas superpuestas).
let pollEnCurso = false;

/**
 * Corre una pasada de detección de Compras Ágiles nuevas:
 * 1. Trae TODAS las Compras Ágiles con estado "publicada" ahora mismo,
 *    paginando hasta encontrar una página 100% ya conocida (no todas las
 *    páginas) — ver listarTodasLasPublicadas en compraagil.service.js.
 * 2. Filtra las que ya conocemos.
 * 3. Para las nuevas, pide el detalle completo (proveedores_cotizando
 *    incluido) UNA POR UNA, con pausa entre cada pedido.
 * 4. Las guarda en la base de datos.
 *
 * Rediseño de agosto 2026 (ver conversación de análisis): antes esto se
 * basaba en ttl_cambio_ms (ventana de tiempo de "qué cambió") — se
 * reemplazó por estado=publicada (foto de "qué está activo ahora"),
 * confirmado que funciona sin ttl_cambio_ms contra la API real. La
 * diferencia importa: con una ventana de tiempo, algo que no se
 * alcanzaba a procesar en una corrida (por un error transitorio, por
 * ejemplo) corría el riesgo de quedar fuera de la ventana en la corrida
 * siguiente, y perderse para siempre. Con "publicada" no hay ventana de
 * la que salirse.
 *
 * También cambió el criterio ante una falla de detalle: ANTES se
 * guardaba igual, con detalle=null — eso dejaba la Compra Ágil "vista"
 * para siempre (ya no se reintentaba) pero con productos_solicitados
 * vacío, lo que la volvía INVISIBLE para el matching por categoría
 * (encontrado en el análisis de agosto 2026 — un bug real y silencioso).
 * AHORA, si falla el detalle, NO se guarda nada — mismo criterio que ya
 * usa poll-licitaciones.js. Como sigue "publicada", va a volver a
 * aparecer como "no vista" en la próxima corrida, y se reintenta solo.
 */
async function correrPollingCompraAgil(opciones = {}) {
  if (pollEnCurso) {
    console.warn('[poll-compra-agil] Ya hay una corrida en curso (cron o disparo manual) — se ignora este disparo para no competir por la misma cuota.');
    return [];
  }
  pollEnCurso = true;

  try {
    console.log('[poll-compra-agil] Iniciando (estado=publicada)...');

    let items;
    try {
      items = await listarTodasLasPublicadas({
        // Corte temprano de paginación — se apoya en que estado=publicada
        // también ordena por fecha_ultimo_cambio descendente (confirmado
        // contra la API real, agosto 2026).
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

    console.log(`[poll-compra-agil] ${items.length} procesos publicados encontrados.`);

    const codigos = items.map((item) => item.codigo);
    const yaVistos = await obtenerCodigosCompraAgilYaVistos(codigos);
    const nuevas = items.filter((item) => !yaVistos.has(item.codigo));

    if (nuevas.length === 0) {
      console.log('[poll-compra-agil] No hay Compras Ágiles nuevas.');
      return [];
    }

    console.log(`[poll-compra-agil] ${nuevas.length} Compras Ágiles nuevas — trayendo detalle y guardando una por una...`);

    const guardadas = [];
    for (let i = 0; i < nuevas.length; i++) {
      const item = nuevas[i];
      try {
        const detalle = await obtenerDetalleCompraAgil(item.codigo);
        if (detalle) {
          await guardarCompraAgil(item, detalle);
          guardadas.push({ item, detalle });
        }
      } catch (err) {
        if (err instanceof CuotaAgotadaError) {
          // A diferencia de un error puntual en un ítem, esto es una señal
          // de que el problema es del servidor/cuota en general — seguir
          // intentando los ítems que quedan solo repetiría la misma falla
          // en cada uno. Se corta acá; lo que no se alcanzó a guardar
          // sigue "publicada" y se reintenta solo en la próxima corrida.
          console.warn(`[poll-compra-agil] ${err.message} — se corta acá (${i}/${nuevas.length} procesados). El resto se reintenta en la próxima corrida.`);
          break;
        }
        console.error(`[poll-compra-agil] Error ${i + 1}/${nuevas.length} — no se pudo obtener/guardar el detalle de ${item.codigo}: ${err.message}. Se reintentará en la próxima corrida (sigue "publicada").`);
      }

      if (i < nuevas.length - 1) await esperar(PAUSA_ENTRE_DETALLES_MS);
    }

    console.log(`[poll-compra-agil] ${guardadas.length} Compras Ágiles nuevas guardadas.`);

    await procesarAlertasCompraAgil(guardadas);

    return guardadas;
  } finally {
    pollEnCurso = false;
  }
}

module.exports = { correrPollingCompraAgil };
