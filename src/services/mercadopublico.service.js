const BASE_URL = 'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json';
const DELAY_ENTRE_LLAMADAS_MS = 3100; // 3s mínimo confirmado + margen de seguridad

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Trae el listado de licitaciones activas (resumen: CodigoExterno, Nombre, CodigoEstado, FechaCierre).
 * La opción estados “activas”, muestra todas las licitaciones publicadas al día de realizada la consulta. 
 * Para el detalle completo de cada una, usar obtenerDetalleLicitacion.
 */
async function obtenerLicitacionesActivas() {
  const ticket = process.env.MERCADOPUBLICO_TICKET;
  const url = `${BASE_URL}?estado=activas&ticket=${ticket}`;

  const response = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`Error consultando licitaciones activas: HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.Listado || [];
}

/**
 * Trae el detalle completo de una licitación por su CodigoExterno.
 */
async function obtenerDetalleLicitacion(codigoExterno) {
  const ticket = process.env.MERCADOPUBLICO_TICKET;
  const url = `${BASE_URL}?codigo=${encodeURIComponent(codigoExterno)}&ticket=${ticket}`;

  const response = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`Error consultando detalle de ${codigoExterno}: HTTP ${response.status}`);
  }

  const data = await response.json();
  return (data.Listado && data.Listado[0]) || null;
}

/**
 * Trae el detalle de varias licitaciones, respetando el mínimo de 3s entre llamadas.
 * Devuelve un array con los detalles obtenidos (omite las que fallen, sin cortar el resto).
 */
async function obtenerDetallesConDelay(codigosExternos) {
  const detalles = [];

  for (const codigo of codigosExternos) {
    try {
      const detalle = await obtenerDetalleLicitacion(codigo);
      if (detalle) detalles.push(detalle);
    } catch (err) {
      console.error(`No se pudo obtener detalle de ${codigo}:`, err.message);
    }
    await sleep(DELAY_ENTRE_LLAMADAS_MS);
  }

  return detalles;
}

module.exports = {
  obtenerLicitacionesActivas,
  obtenerDetalleLicitacion,
  obtenerDetallesConDelay,
};
