const BASE_URL = 'https://api2.mercadopublico.cl';

class CuotaAgotadaError extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'CuotaAgotadaError';
  }
}

async function llamarApi(path, params = {}) {
  const ticket = process.env.COMPRAAGIL_TICKET;
  const query = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}${query ? `?${query}` : ''}`;

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
 * Trae el detalle completo de una Compra Ágil (productos, proveedores cotizando, montos, etc.).
 */
async function obtenerDetalleCompraAgil(codigo) {
  return llamarApi(`/v2/compra-agil/${encodeURIComponent(codigo)}`);
}

module.exports = {
  CuotaAgotadaError,
  listarCambiosRecientes,
  listarTodosLosCambiosRecientes,
  obtenerDetalleCompraAgil,
};
