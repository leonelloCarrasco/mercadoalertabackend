const { parsearFechaChile } = require('../utils/fecha-chile');

const BASE_URL = 'https://api2.mercadopublico.cl';

// Tamaño de página por defecto para las 3 funciones de listado de acá abajo
// (listarCambiosRecientes, listarCambiosPorRangoFecha, buscarComprasAgiles).
// Antes 50 — bajado a 20 (agosto 2026) porque se confirmó a mano contra la
// API real que tamano_pagina=50 dispara "Endpoint request timed out" (504)
// en algunas consultas, mientras que 20 y 15 responden bien de forma
// consistente. Página más chica = más páginas totales para recorrer el
// mismo volumen de datos (ver el corte temprano de paginación y la pausa
// entre páginas, pensados justo para que eso no sea un problema), pero
// cada pedido individual tiene mucha menos chance de superar el timeout
// del gateway de Mercado Público.
const TAMANO_PAGINA_DEFECTO = 20;

class CuotaAgotadaError extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'CuotaAgotadaError';
  }
}

/**
 * Falla transitoria de UN pedido puntual (5xx tras agotar los reintentos) —
 * a propósito NO es CuotaAgotadaError. La diferencia importa para quien
 * llama: un 429 real significa "todo lo que sigue también va a fallar,
 * cortá todo" — pero un 504 en un pedido puntual no dice nada sobre el
 * PRÓXIMO pedido, que perfectamente puede salir bien. Antes esto se
 * lanzaba como CuotaAgotadaError, y el loop de detalles de
 * poll-compra-agil.js cortaba TODO el resto de la corrida por una falla
 * de un solo ítem — de mala manera conservador, descartando ítems que
 * hubieran funcionado bien (encontrado en producción, agosto 2026).
 */
class ErrorTransitorioItem extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorTransitorioItem';
  }
}

// Pausa entre página y página al recorrer un listado completo — sin esto,
// una ventana con muchas páginas (ej. un solo día con 90 páginas) dispara
// pedidos en ráfaga que Mercado Público puede frenar con un límite de
// corto plazo, distinto de la cuota diaria (y que no siempre se anuncia
// como HTTP 429, ver el manejo de errores en llamarApi más abajo).
const PAUSA_ENTRE_PAGINAS_MS = 300;
function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reintentos para errores 5xx (502/503/504) — estos son fallas transitorias
// de infraestructura del LADO DE MERCADO PÚBLICO (gateway/proxy que no
// llegó a tiempo, no necesariamente por exceso de pedidos nuestro), muy
// distintas en naturaleza a un 429 o a un límite de cuota: lo normal es que
// se resuelvan solas en segundos, no que haga falta esperar hasta la
// próxima corrida programada del cron (horas después). Un 504 real
// observado en producción (agosto 2026): body {"message":"Endpoint request
// timed out"} — formato típico de un timeout de API Gateway de AWS, ni
// siquiera trae el shape {success, errors} propio de la API.
const REINTENTOS_5XX = 2;
const PAUSA_ENTRE_REINTENTOS_5XX_MS = 1500;

async function llamarApi(path, params = {}) {
  const ticket = process.env.COMPRAAGIL_TICKET;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    // estado (y cualquier otro filtro futuro) puede venir como array — la API
    // acepta "1 o más" repitiendo la misma key (?estado=publicada&estado=cerrada),
    // URLSearchParams no soporta arrays en un objeto plano, así que se arma a mano.
    if (Array.isArray(value)) {
      value.forEach((v) => query.append(key, v));
    } else {
      query.append(key, value);
    }
  }
  const url = `${BASE_URL}${path}${query.toString() ? `?${query.toString()}` : ''}`;

  let response;
  for (let intento = 0; intento <= REINTENTOS_5XX; intento++) {
    response = await fetch(url, { headers: { ticket } });

    if (response.status < 500) break; // no es un 5xx, no hace falta reintentar

    if (intento < REINTENTOS_5XX) {
      console.warn(`[compraagil.service] HTTP ${response.status} (intento ${intento + 1}/${REINTENTOS_5XX + 1}) — probablemente transitorio, reintentando en ${PAUSA_ENTRE_REINTENTOS_5XX_MS}ms...`);
      await esperar(PAUSA_ENTRE_REINTENTOS_5XX_MS);
    }
  }

  if (response.status === 429) {
    throw new CuotaAgotadaError('Se agotó la cuota diaria de la API de Compra Ágil. Reintentar mañana.');
  }

  if (response.status >= 500) {
    // ErrorTransitorioItem, NO CuotaAgotadaError (ver la clase, definida
    // más arriba, para el porqué) — se agotaron los reintentos para ESTE
    // pedido puntual, pero eso no dice nada sobre el próximo.
    throw new ErrorTransitorioItem(`Servidor de Mercado Público no respondió (HTTP ${response.status}) tras ${REINTENTOS_5XX + 1} intentos en este pedido puntual — probablemente transitorio, no un tema de cuota.`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    // La respuesta no fue JSON válido — pasa con algunos límites de ráfaga
    // (proxy/gateway que corta la conexión y devuelve HTML o texto plano en
    // vez del JSON esperado). Se trata como cuota agotada en vez de reventar
    // con un error genérico, que es lo más probable dado el contexto.
    throw new CuotaAgotadaError(`Respuesta no válida de la API de Compra Ágil (HTTP ${response.status}) — probablemente un límite de ráfaga, no la cuota diaria formal. Mensaje original: ${err.message}`);
  }

  if (data.success !== 'OK') {
    const err = (data.errors && data.errors[0]) || {};
    const mensajeCompleto = `${err.codigo || ''} ${err.mensaje || ''}`.toLowerCase();
    const sinDetalleDeError = !err.codigo && !err.mensaje;

    console.error(`[compraagil.service] success != 'OK' — HTTP ${response.status}, body:`, JSON.stringify(data).slice(0, 500));

    // Además del 429 explícito de arriba, algunos límites de ráfaga vuelven
    // con HTTP 200 y success != 'OK', pero de dos formas distintas:
    //  a) con un cuerpo de error normal, cuyo texto menciona cuota/límite/
    //     exceso — se detecta por palabra clave.
    //  b) SIN ningún detalle de error (data.errors vacío o ausente) — el
    //     caso real que rompió el corte prolijo de estos jobs (agosto
    //     2026): "[undefined]: undefined", nada de texto para buscarle
    //     palabra clave. Una respuesta success != 'OK' pero sin ningún
    //     detalle de error es en sí misma una señal rara — más probable
    //     que sea un proxy/gateway cortando la conexión por exceso de
    //     pedidos que un error real y bien formado de la API. El log de
    //     arriba deja rastro por si esta suposición alguna vez resulta
    //     equivocada — así queda algo para diagnosticar, no falla en
    //     silencio.
    const pareceLimiteDeCuota = /cuota|límite|limite|exceso|demasiad|rate.?limit/.test(mensajeCompleto) || sinDetalleDeError;
    if (pareceLimiteDeCuota) {
      throw new CuotaAgotadaError(`Posible límite de la API de Compra Ágil: [${err.codigo}] ${err.mensaje}`);
    }

    throw new Error(`Error de la API de Compra Ágil [${err.codigo}]: ${err.mensaje}`);
  }

  return data.payload;
}

/**
 * Lista Compras Ágiles con estado "publicada" — TODAS las que están activas
 * ahora mismo, no las que "cambiaron" en una ventana de tiempo. Confirmado
 * contra la API real (agosto 2026) que estado=publicada funciona SIN
 * ttl_cambio_ms (que en cualquier otro contexto es obligatorio) — es el
 * equivalente de esta API a obtenerLicitacionesActivas() para licitaciones.
 */
async function listarPublicadas(opciones = {}) {
  return llamarApi('/v2/compra-agil', {
    estado: 'publicada',
    tamano_pagina: opciones.tamanoPagina || TAMANO_PAGINA_DEFECTO,
    numero_pagina: opciones.numeroPagina || 1,
    ...(opciones.region ? { region: opciones.region } : {}),
  });
}

/**
 * Recorre las páginas de "publicada" y devuelve el array de items. Mismo
 * mecanismo de corte temprano y manejo de errores que la versión anterior
 * basada en ttl_cambio_ms (ver historial de este archivo) — confirmado
 * contra la API real (agosto 2026) que estado=publicada ordena por
 * fecha_publicacion descendente (NO fecha_ultimo_cambio — probado con una
 * sola página de 20 ítems: fecha_ultimo_cambio resultó ser idéntica, al
 * milisegundo, en los 20; fecha_publicacion sí bajaba de forma prolija.
 * Corregido acá porque el comentario original asumía fecha_ultimo_cambio,
 * arrastrado del endpoint viejo con ttl_cambio_ms, sin volver a verificarlo
 * para este modo de consulta específico).
 *
 * Por qué se reemplazó ttl_cambio_ms por esto (ver conversación de diseño,
 * agosto 2026): con una ventana de tiempo, algo que no se llega a procesar
 * en una corrida (por un error transitorio, por ejemplo) corre el riesgo de
 * quedar fuera de la ventana en la corrida siguiente, y perderse para
 * siempre. Con "publicada" no hay ventana de la que salirse — mientras algo
 * siga activo, va a seguir apareciendo en cada corrida hasta que se procese
 * bien o cierre. Autocorrección estructural, no un parche.
 *
 * `opciones.detenerSiPaginaCompleta`: misma función que antes, ver el
 * comentario de la versión vieja en el historial de git de este archivo.
 *
 * `opciones.cortarAntesDeFecha` (Date, opcional): corte adicional para la
 * carga en frío o después de un hueco largo sin correr — sin esto, la
 * PRIMERA vez que se corre este job contra una base vacía, el corte de
 * "página completa conocida" nunca se dispara (no hay nada conocido
 * todavía con qué comparar), y termina recorriendo las 8.000+ Compras
 * Ágiles publicadas enteras en una sola corrida, agotando la cuota diaria
 * de un saque (encontrado en producción, agosto 2026). Con esto, apenas el
 * ÚLTIMO ítem de una página (el más viejo, dado el orden descendente) tiene
 * fecha_publicacion anterior a la fecha límite, se corta ahí — en la
 * primera corrida contra una base vacía, esto limita la carga a "lo
 * publicado hoy", en vez de recorrer meses de historial de una vez. En
 * corridas posteriores del mismo día, el corte de "página completa
 * conocida" suele dispararse primero (más barato, no hace falta llegar
 * hasta el límite del día) — los dos coexisten, gana el que dispare antes.
 */
async function listarTodasLasPublicadas(opciones = {}) {
  let numeroPagina = 1;
  let totalPaginas = 1;
  const items = [];

  do {
    let payload;
    try {
      payload = await listarPublicadas({ ...opciones, numeroPagina });
    } catch (err) {
      // A nivel de PÁGINA (no de ítem individual), un ErrorTransitorioItem
      // se trata igual que CuotaAgotadaError — cortar acá y quedarse con lo
      // ya juntado. A diferencia del loop de detalles por ítem (ver
      // ErrorTransitorioItem, definida más arriba), acá no hay una cola de
      // pendientes por PÁGINA — saltarse una página que falló transitoriamente
      // perdería esos códigos sin ningún mecanismo de recuperación, así que
      // conviene ser conservador y cortar, igual que con cuota agotada.
      if (err instanceof CuotaAgotadaError || err instanceof ErrorTransitorioItem) {
        console.warn(`[compraagil.service] Se corta la paginación: ${err.message}`);
        break;
      }
      throw err;
    }
    console.log(`[compraagil.service] OK Página ${numeroPagina} de ${payload.paginacion.total_paginas}`);

    if (numeroPagina === 1) {
      console.log(`[compraagil.service] Respuesta cruda (estado=publicada): total_resultados=${payload.paginacion.total_resultados}, total_paginas=${payload.paginacion.total_paginas}, items en esta página=${payload.items.length}`);
    }

    items.push(...payload.items);
    totalPaginas = payload.paginacion.total_paginas;

    if (opciones.detenerSiPaginaCompleta && payload.items.length > 0) {
      const codigosPagina = payload.items.map((item) => item.codigo);
      const paginaCompletaConocida = await opciones.detenerSiPaginaCompleta(codigosPagina);
      if (paginaCompletaConocida) {
        console.log(`[compraagil.service] Página ${numeroPagina} ya era 100% conocida — se corta la paginación acá (de ${totalPaginas} páginas totales).`);
        break;
      }
    }

    // Corte por fecha — ver el comentario largo de la función, arriba.
    // Se mira el ÚLTIMO ítem de la página (el más viejo, dado el orden
    // descendente por fecha_publicacion) — si ya es anterior al límite,
    // todo lo que sigue en páginas posteriores también lo va a ser.
    if (opciones.cortarAntesDeFecha && payload.items.length > 0) {
      const ultimoItem = payload.items[payload.items.length - 1];
      const fechaPublicacionUltimo = parsearFechaChile(ultimoItem.fechas?.fecha_publicacion);
      if (fechaPublicacionUltimo && fechaPublicacionUltimo < opciones.cortarAntesDeFecha) {
        console.log(`[compraagil.service] Página ${numeroPagina} ya tiene ítems anteriores a la fecha límite (${opciones.cortarAntesDeFecha.toISOString()}) — se corta la paginación acá.`);
        break;
      }
    }

    numeroPagina += 1;
    if (numeroPagina <= totalPaginas) await esperar(PAUSA_ENTRE_PAGINAS_MS);
  } while (numeroPagina <= totalPaginas);

  return items;
}

/**
 * Lista Compras Ágiles con cambios en los últimos `ttlMs` milisegundos.
 * Ya NO la usa el polling (ver listarPublicadas/listarTodasLasPublicadas más
 * arriba) — queda para busqueda-admin.service.js, que sigue necesitando
 * "buscar cambios en los últimos N días" como modo de búsqueda manual.
 */
async function listarCambiosRecientes(ttlMs, opciones = {}) {
  return llamarApi('/v2/compra-agil', {
    ttl_cambio_ms: ttlMs,
    tamano_pagina: opciones.tamanoPagina || TAMANO_PAGINA_DEFECTO,
    numero_pagina: opciones.numeroPagina || 1,
    ...(opciones.estado ? { estado: opciones.estado } : {}),
    ...(opciones.region ? { region: opciones.region } : {}),
  });
}

/**
 * Trae el detalle completo de una Compra Ágil (productos, proveedores cotizando, precios, etc.).
 */
async function obtenerDetalleCompraAgil(codigo) {
  return llamarApi(`/v2/compra-agil/${encodeURIComponent(codigo)}`);
}

/**
 * Lista Compras Ágiles con cambios en un rango de fechas EXACTO
 * (cambio_desde/cambio_hasta, ISO 8601) — a diferencia de ttl_cambio_ms
 * (relativo a "ahora", y con el bug de ventana corta documentado en
 * poll-compra-agil.js), este filtro apunta a un rango de calendario fijo.
 * Ojo: igual que ttl_cambio_ms, filtra por fecha_ultimo_cambio, no por
 * fecha_publicacion — un ítem publicado ese día pero modificado después no
 * va a aparecer acá buscando ese día, y uno publicado antes pero modificado
 * ese día sí. Para "qué se publicó tal día" es una aproximación, no exacto.
 */
async function listarCambiosPorRangoFecha(cambioDesde, cambioHasta, opciones = {}) {
  return llamarApi('/v2/compra-agil', {
    cambio_desde: cambioDesde,
    cambio_hasta: cambioHasta,
    tamano_pagina: opciones.tamanoPagina || TAMANO_PAGINA_DEFECTO,
    numero_pagina: opciones.numeroPagina || 1,
    ...(opciones.estado ? { estado: opciones.estado } : {}),
    ...(opciones.region ? { region: opciones.region } : {}),
  });
}

/** Recorre todas las páginas de un rango de fechas exacto y devuelve el array completo de items. */
async function listarTodosLosCambiosPorRangoFecha(cambioDesde, cambioHasta, opciones = {}) {
  let numeroPagina = 1;
  let totalPaginas = 1;
  const items = [];

  do {
    let payload;
    try {
      payload = await listarCambiosPorRangoFecha(cambioDesde, cambioHasta, { ...opciones, numeroPagina });
    } catch (err) {
      // A nivel de PÁGINA, ErrorTransitorioItem se trata igual que
      // CuotaAgotadaError — ver el comentario largo en
      // listarTodasLasPublicadas más arriba para el porqué. Se usa
      // err.message (la razón real y específica) en vez de un texto fijo,
      // para no repetir la confusión de un 504 mostrándose como "cuota
      // agotada" que ya se corrigió acá.
      if (err instanceof CuotaAgotadaError || err instanceof ErrorTransitorioItem) {
        console.warn(`[compraagil.service] Se corta la paginación: ${err.message}`);
        break;
      }
      throw err;
    }

    if (numeroPagina === 1) {
      console.log(`[compraagil.service] Rango ${cambioDesde} a ${cambioHasta}: total_resultados=${payload.paginacion.total_resultados}, total_paginas=${payload.paginacion.total_paginas}`);
    }

    items.push(...payload.items);
    totalPaginas = payload.paginacion.total_paginas;
    numeroPagina += 1;
    if (numeroPagina <= totalPaginas) await esperar(PAUSA_ENTRE_PAGINAS_MS);
  } while (numeroPagina <= totalPaginas);

  return items;
}

/**
 * Búsqueda de UNA sola página (a diferencia de listarTodosLosCambiosRecientes,
 * que recorre TODAS las páginas para el polling) — usada por la sección
 * "Búsquedas" del dashboard, donde el usuario pagina de a una página real de
 * la API por vez (ver busqueda-ejecutor.service.js). Combina los filtros que
 * la API sí soporta libremente entre sí: texto libre (q), región (código
 * numérico INE), estado (uno o más) y "nuevas en las últimas N horas"
 * (ttl_cambio_ms).
 */
async function buscarComprasAgiles({ texto, codigoRegion, estados, horasRecientes, numeroPagina, tamanoPagina }) {
  return llamarApi('/v2/compra-agil', {
    q: texto || undefined,
    region: codigoRegion || undefined,
    estado: (estados && estados.length > 0) ? estados : undefined,
    ttl_cambio_ms: horasRecientes ? horasRecientes * 60 * 60 * 1000 : undefined,
    tamano_pagina: tamanoPagina || TAMANO_PAGINA_DEFECTO,
    numero_pagina: numeroPagina || 1,
  });
}

module.exports = {
  CuotaAgotadaError,
  ErrorTransitorioItem,
  listarPublicadas,
  listarTodasLasPublicadas,
  listarCambiosRecientes,
  listarCambiosPorRangoFecha,
  listarTodosLosCambiosPorRangoFecha,
  obtenerDetalleCompraAgil,
  buscarComprasAgiles,
};
