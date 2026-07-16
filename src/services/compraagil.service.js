const BASE_URL = 'https://api2.mercadopublico.cl';

class CuotaAgotadaError extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'CuotaAgotadaError';
  }
}

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

  const response = await fetch(url, {
    headers: { ticket },
  });

  if (response.status === 429) {
    throw new CuotaAgotadaError('Se agotó la cuota diaria de la API de Compra Ágil. Reintentar mañana.');
  }

  const data = await response.json();

  if (data.success !== 'OK') {
    const err = (data.errors && data.errors[0]) || {};
    throw new Error(`Error de la API de Compra Ágil [${err.codigo}]: ${err.mensaje}`);
  }

  return data.payload;
}

/**
 * Lista Compras Ágiles con cambios en los últimos `ttlMs` milisegundos.
 * Ideal para el polling periódico (Grupo 1, opción A de la doc).
 */
async function listarCambiosRecientes(ttlMs, opciones = {}) {
  return llamarApi('/v2/compra-agil', {
    ttl_cambio_ms: ttlMs,
    tamano_pagina: opciones.tamanoPagina || 50,
    numero_pagina: opciones.numeroPagina || 1,
    ...(opciones.estado ? { estado: opciones.estado } : {}),
    ...(opciones.region ? { region: opciones.region } : {}),
  });
}

/**
 * Recorre todas las páginas de un listado de cambios recientes y devuelve el array completo de items.
 * Se detiene si se agota la cuota a mitad de camino, devolviendo lo que alcanzó a traer.
 */
async function listarTodosLosCambiosRecientes(ttlMs, opciones = {}) {
  let numeroPagina = 1;
  let totalPaginas = 1;
  const items = [];

  do {
    let payload;
    try {
      payload = await listarCambiosRecientes(ttlMs, { ...opciones, numeroPagina });
    } catch (err) {
      if (err instanceof CuotaAgotadaError) {
        console.warn('Cuota agotada durante la paginación, se corta con lo obtenido hasta ahora.');
        break;
      }
      throw err;
    }

    if (numeroPagina === 1) {
      console.log(`[compraagil.service] Respuesta cruda: total_resultados=${payload.paginacion.total_resultados}, total_paginas=${payload.paginacion.total_paginas}, items en esta página=${payload.items.length}`);
    }

    items.push(...payload.items);
    totalPaginas = payload.paginacion.total_paginas;
    numeroPagina += 1;
  } while (numeroPagina <= totalPaginas);

  return items;
}

/**
 * Trae el detalle completo de una Compra Ágil (productos, proveedores cotizando, precios, etc.).
 */
async function obtenerDetalleCompraAgil(codigo) {
  return llamarApi(`/v2/compra-agil/${encodeURIComponent(codigo)}`);
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
    tamano_pagina: tamanoPagina || 50,
    numero_pagina: numeroPagina || 1,
  });
}

module.exports = {
  CuotaAgotadaError,
  listarCambiosRecientes,
  listarTodosLosCambiosRecientes,
  obtenerDetalleCompraAgil,
  buscarComprasAgiles,
};
