const {
  listarTodasLasPublicadas,
  obtenerDetalleCompraAgil,
  CuotaAgotadaError,
  ErrorTransitorioItem,
} = require('../services/compraagil.service');
const {
  obtenerCodigosCompraAgilYaVistos,
  guardarCompraAgil,
  agregarPendientesDetalleCompraAgil,
  listarPendientesDetalleCompraAgil,
  quitarPendienteDetalleCompraAgil,
} = require('../db/compra-agil.queries');
const { procesarAlertasCompraAgil } = require('../services/alerting.service');
const { estaEnCurso, marcarEnCurso } = require('../utils/compra-agil-lock');
const { inicioDelDiaChile } = require('../utils/fecha-chile');

// Pausa entre cada llamado de detalle — ver PAUSA_ENTRE_PAGINAS_MS en
// compraagil.service.js, mismo motivo (evitar ráfaga contra la misma API).
const PAUSA_ENTRE_DETALLES_MS = 300;
function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pide detalle y guarda, uno por uno con pausa entre cada llamado —
 * reusado tanto para la cola de pendientes como para lo recién
 * descubierto en esta misma corrida (ver correrPollingCompraAgil).
 *
 * `cosas`: array de lo que hay que procesar — puede ser un array de
 * strings (códigos, para la cola de pendientes) o de objetos con
 * `.codigo` (resúmenes del listado, para lo recién descubierto).
 * `obtenerCodigo(cosa)`: saca el código de cada elemento.
 * `guardar(cosa, detalle)`: hace el guardado real — distinto según el
 * caso (ver los dos usos en correrPollingCompraAgil más abajo).
 *
 * Devuelve { guardadas, procesadas, cortadoPorCuota } — `procesadas` son
 * los índices de `cosas` que se alcanzaron a INTENTAR (haya salido bien o
 * mal), para que quien llama sepa cuáles quedaron sin ni siquiera
 * intentarse si hubo un corte por cuota a mitad de camino.
 */
async function procesarConPausa(cosas, { obtenerCodigo, guardar }) {
  const guardadas = [];
  let cortadoPorCuota = false;
  let procesadas = 0;

  for (let i = 0; i < cosas.length; i++) {
    const cosa = cosas[i];
    const codigo = obtenerCodigo(cosa);

    try {
      const detalle = await obtenerDetalleCompraAgil(codigo);
      if (detalle) {
        await guardar(cosa, detalle);
        guardadas.push({ item: cosa, detalle });
      }
      procesadas++;
    } catch (err) {
      if (err instanceof CuotaAgotadaError) {
        // Cuota/límite real — es una señal de que el problema es del
        // servidor/cuota en general, no de este ítem puntual. Seguir
        // intentando los que quedan solo repetiría la misma falla en cada
        // uno. Se corta acá; lo que no se guardó (haya fallado o ni
        // siquiera se haya llegado a intentar) lo maneja quien llama.
        console.warn(`[poll-compra-agil] ${err.message} — se corta acá (${i}/${cosas.length} procesados).`);
        cortadoPorCuota = true;
        break;
      }
      // ErrorTransitorioItem (o cualquier otro error puntual) cae acá —
      // a propósito NO corta el loop. Antes, un 504 tras 3 reintentos
      // también se lanzaba como CuotaAgotadaError, y esta función cortaba
      // TODO el resto de la corrida por la falla de un solo ítem —
      // demasiado conservador: no hay ninguna razón para asumir que el
      // PRÓXIMO ítem también va a fallar. Este ítem queda afuera de
      // `guardadas`, así que igual termina en la cola de pendientes (ver
      // correrPollingCompraAgil) — se reintenta solo en la próxima
      // corrida, sin descartar de paso todo lo que sigue.
      console.error(`[poll-compra-agil] Error ${i + 1}/${cosas.length} — no se pudo obtener/guardar el detalle de ${codigo}: ${err.message}.`);
      procesadas++;
    }

    if (i < cosas.length - 1) await esperar(PAUSA_ENTRE_DETALLES_MS);
  }

  return { guardadas, procesadas, cortadoPorCuota };
}

/**
 * Corre una pasada de detección de Compras Ágiles nuevas:
 *
 * 0. PRIMERO procesa la cola de pendientes (compra_agil_pendientes_detalle)
 *    — códigos descubiertos en una corrida anterior pero que no se
 *    alcanzaron a guardar (por un corte de cuota a mitad de camino). Ver
 *    el comentario largo en la migración 052 sobre por qué esto hace
 *    falta: sin esto, algo que quedó a medio camino puede terminar
 *    "enterrado" bajo publicaciones más nuevas, y el corte temprano del
 *    paso 1 nunca vuelve a bajar lo suficiente como para encontrarlo.
 * 1. Trae TODAS las Compras Ágiles con estado "publicada" ahora mismo,
 *    paginando hasta encontrar una página 100% ya conocida — ver
 *    listarTodasLasPublicadas en compraagil.service.js.
 * 2. Filtra las que ya conocemos.
 * 3. Para las nuevas, pide el detalle completo UNA POR UNA, con pausa.
 * 4. Cualquier cosa (de la cola de pendientes o recién descubierta) que
 *    no se haya alcanzado a guardar bien queda (o vuelve a quedar) en la
 *    cola de pendientes, para la próxima corrida.
 *
 * Rediseño de agosto 2026 (ver conversación de análisis): antes esto se
 * basaba en ttl_cambio_ms — se reemplazó por estado=publicada. Y ante una
 * falla de detalle, ya NO se guarda con detalle=null (eso dejaba la
 * Compra Ágil invisible para el matching por categoría, para siempre) —
 * ahora simplemente no se guarda, y queda en la cola de pendientes para
 * reintentarse.
 */
async function correrPollingCompraAgil(opciones = {}) {
  if (estaEnCurso()) {
    console.warn('[poll-compra-agil] Ya hay una corrida en curso (cron, disparo manual, o recuperación) — se ignora este disparo para no competir por la misma cuota.');
    return [];
  }
  marcarEnCurso(true);

  try {
    console.log('[poll-compra-agil] Iniciando (estado=publicada)...');

    // --- Paso 0: cola de pendientes de una corrida anterior ---
    const pendientes = await listarPendientesDetalleCompraAgil();
    let guardadasDePendientes = [];
    if (pendientes.length > 0) {
      console.log(`[poll-compra-agil] ${pendientes.length} pendientes de una corrida anterior — se procesan primero.`);
      const resultado = await procesarConPausa(pendientes, {
        obtenerCodigo: (codigo) => codigo,
        // No hay resumen del listado para estos — el detalle solo alcanza
        // (mismo patrón ya usado en carga-historica-compra-agil.js).
        guardar: (codigo, detalle) => guardarCompraAgil(detalle, detalle),
      });
      guardadasDePendientes = resultado.guardadas;

      // Los que se guardaron bien salen de la cola. Los que fallaron un
      // ítem puntual quedan (se reintentan en la próxima corrida). Los que
      // ni siquiera se alcanzaron a intentar (por el corte de cuota)
      // también quedan, sin tocarlos.
      for (const { item: codigo } of guardadasDePendientes) {
        await quitarPendienteDetalleCompraAgil(codigo);
      }
      console.log(`[poll-compra-agil] Pendientes: ${guardadasDePendientes.length} guardados, ${pendientes.length - guardadasDePendientes.length} siguen en cola.`);

      if (resultado.cortadoPorCuota) {
        // Si la cuota ya se agotó procesando pendientes, ni vale la pena
        // salir a descubrir cosas nuevas en esta misma corrida.
        console.warn('[poll-compra-agil] Cuota agotada procesando pendientes — se omite el descubrimiento de esta corrida.');
        await procesarAlertasCompraAgil(guardadasDePendientes);
        return guardadasDePendientes;
      }
    }

    // --- Paso 1-2: descubrimiento normal ---
    let items;
    try {
      items = await listarTodasLasPublicadas({
        // Corte 1 — página 100% conocida. Se apoya en que estado=publicada
        // ordena por fecha_publicacion descendente (ver el comentario largo
        // en listarTodasLasPublicadas, compraagil.service.js, para el
        // porqué se corrigió de fecha_ultimo_cambio a fecha_publicacion).
        detenerSiPaginaCompleta: async (codigosPagina) => {
          const yaVistosPagina = await obtenerCodigosCompraAgilYaVistos(codigosPagina);
          return codigosPagina.every((c) => yaVistosPagina.has(c));
        },
        // Corte 2 — nada anterior a hoy (hora de Chile). Coexiste con el
        // corte 1 (gana el que dispare antes) — este es el que evita que la
        // PRIMERA corrida contra una base vacía recorra las 8.000+ Compras
        // Ágiles publicadas enteras de una sola vez, agotando la cuota
        // diaria (encontrado en producción, agosto 2026). Ver el comentario
        // largo en listarTodasLasPublicadas para el detalle completo.
        cortarAntesDeFecha: inicioDelDiaChile(),
      });
    } catch (err) {
      if (err instanceof CuotaAgotadaError) {
        console.warn('[poll-compra-agil] Cuota diaria agotada, se omite el descubrimiento de esta corrida.');
        await procesarAlertasCompraAgil(guardadasDePendientes);
        return guardadasDePendientes;
      }
      throw err;
    }

    console.log(`[poll-compra-agil] ${items.length} procesos publicados encontrados.`);

    const codigos = items.map((item) => item.codigo);
    const yaVistos = await obtenerCodigosCompraAgilYaVistos(codigos);
    const nuevas = items.filter((item) => !yaVistos.has(item.codigo));

    if (nuevas.length === 0) {
      console.log('[poll-compra-agil] No hay Compras Ágiles nuevas.');
      await procesarAlertasCompraAgil(guardadasDePendientes);
      return guardadasDePendientes;
    }

    console.log(`[poll-compra-agil] ${nuevas.length} Compras Ágiles nuevas — trayendo detalle y guardando una por una...`);

    // --- Paso 3-4: pedir detalle y guardar, con lo que no se logre yendo a la cola ---
    const resultado = await procesarConPausa(nuevas, {
      obtenerCodigo: (item) => item.codigo,
      guardar: (item, detalle) => guardarCompraAgil(item, detalle),
    });

    const codigosGuardados = new Set(resultado.guardadas.map((g) => g.item.codigo));
    const noGuardadas = nuevas.filter((item) => !codigosGuardados.has(item.codigo)).map((item) => item.codigo);
    if (noGuardadas.length > 0) {
      await agregarPendientesDetalleCompraAgil(noGuardadas);
      console.log(`[poll-compra-agil] ${noGuardadas.length} quedaron pendientes (fallaron o no se alcanzaron a procesar por corte de cuota) — se agregan a la cola para la próxima corrida.`);
    }

    const todasLasGuardadas = [...guardadasDePendientes, ...resultado.guardadas];
    console.log(`[poll-compra-agil] ${todasLasGuardadas.length} Compras Ágiles nuevas guardadas en total.`);

    await procesarAlertasCompraAgil(todasLasGuardadas);

    return todasLasGuardadas;
  } finally {
    marcarEnCurso(false);
  }
}

module.exports = { correrPollingCompraAgil };
