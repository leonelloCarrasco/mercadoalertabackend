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

  console.log('[busqueda-licitacion] Ejecutando búsqueda por codigo: ', `${BASE_URL}?codigo=${encodeURIComponent(codigoExterno)}&ticket={ticket}`); // Loguea la URL para depuración

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

/**
 * Trae el listado de licitaciones PUBLICADAS en una fecha puntual (no es un
 * filtro de rango — la API de Mercado Público solo acepta un día exacto por
 * consulta). Usado por el panel de administrador para buscar licitaciones
 * históricas que el polling automático pudo haberse perdido.
 *
 * fecha: string en formato DDMMYYYY (ej. "05072026" para el 5 de julio de 2026).
 */
async function obtenerLicitacionesPorFecha(fecha) {
  const ticket = process.env.MERCADOPUBLICO_TICKET;
  const url = `${BASE_URL}?fecha=${encodeURIComponent(fecha)}&ticket=${ticket}`;

  const response = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`Error consultando licitaciones por fecha: HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.Listado || [];
}

/**
 * Genérica: arma la URL de licitaciones.json con los parámetros que se le
 * pasen (fecha, estado, CodigoOrganismo, CodigoProveedor, codigo) y trae el
 * listado. Usada por busqueda-ejecutor.service.js — ahí cada "modo" de
 * búsqueda de Licitaciones arma su propia combinación de parámetros (la API
 * solo permite las combinaciones documentadas, no cualquier mezcla).
 */
async function buscarLicitacionesConParametros(params) {
  console.log('[busqueda-licitacion] Ejecutando búsqueda con parámetros: ', params); 

  const ticket = process.env.MERCADOPUBLICO_TICKET;
  const query = new URLSearchParams({ ...params, ticket }).toString();
  const url = `${BASE_URL}?${query}`;

  const response = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`Error consultando licitaciones: HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.Listado || [];
}

/**
 * Busca el código de un proveedor a partir de su RUT (con puntos, guión y
 * dígito verificador, ej. "70.017.820-k") — paso previo obligatorio para
 * buscar licitaciones por CodigoProveedor (la API de Licitaciones no acepta
 * el RUT directo, solo el CodigoEmpresa que devuelve este otro servicio).
 * Devuelve { codigo, nombre } o null si el RUT no está registrado como
 * proveedor en Mercado Público.
 */
async function buscarProveedorPorRut(rut) {
  const ticket = process.env.MERCADOPUBLICO_TICKET;
  const url = `https://api.mercadopublico.cl/servicios/v1/Publico/Empresas/BuscarProveedor?rutempresaproveedor=${encodeURIComponent(rut)}&ticket=${ticket}`;

  const response = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`Error buscando proveedor por RUT: HTTP ${response.status}`);
  }

  const data = await response.json();
  // La API documenta las claves como "Código Empresa"/"Nombre Empresa" (con
  // acento y espacio), pero las respuestas reales de APIs .NET de Mercado
  // Público vienen sin acento/espacio (CodigoEmpresa/NombreEmpresa) — se
  // revisan ambas variantes por seguridad, y también un posible envoltorio
  // en "Listado" (mismo patrón que licitaciones.json).
  const resultados = Array.isArray(data) ? data : (data.Listado || [data]);
  const primero = resultados[0];
  if (!primero) return null;

  const codigo = primero.CodigoEmpresa ?? primero['Código Empresa'] ?? primero.codigoEmpresa;
  const nombre = primero.NombreEmpresa ?? primero['Nombre Empresa'] ?? primero.nombreEmpresa;
  if (!codigo) return null;

  return { codigo: String(codigo), nombre: nombre || null };
}

module.exports = {
  obtenerLicitacionesActivas,
  obtenerLicitacionesPorFecha,
  obtenerDetalleLicitacion,
  obtenerDetallesConDelay,
  buscarLicitacionesConParametros,
  buscarProveedorPorRut,
};
