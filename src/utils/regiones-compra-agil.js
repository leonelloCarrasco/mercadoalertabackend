/**
 * La API v2 de Compra Ágil (api2.mercadopublico.cl) pide la región como
 * CÓDIGO NUMÉRICO (1 al 16, códigos INE), no como el nombre completo que
 * usa el resto de esta app (licitaciones_vistas.region, compras_agiles_vistas.region,
 * el selector de región del dashboard, etc. — todos guardan/muestran el
 * nombre, ej. "Región Metropolitana de Santiago").
 *
 * Esta tabla traduce de uno a otro por coincidencia de palabra clave
 * (normalizada: sin tildes, minúscula, sin espacios extra) en vez de
 * comparación exacta, porque ya vimos en la práctica que el nombre de región
 * llega con variaciones (espacios finales, "de los Lagos" vs "de Los Lagos",
 * con o sin "Región del/de la/de/de los" adelante).
 */
const REGIONES_POR_PALABRA_CLAVE = [
  { clave: 'metropolitana', codigo: 13 },
  { clave: 'valparaiso', codigo: 5 },
  { clave: 'libertador', codigo: 6 },
  { clave: 'ohiggins', codigo: 6 },
  { clave: 'maule', codigo: 7 },
  { clave: 'biobio', codigo: 8 },
  { clave: 'araucania', codigo: 9 },
  { clave: 'los lagos', codigo: 10 },
  { clave: 'aysen', codigo: 11 },
  { clave: 'magallanes', codigo: 12 },
  { clave: 'los rios', codigo: 14 },
  { clave: 'arica', codigo: 15 },
  { clave: 'parinacota', codigo: 15 },
  { clave: 'nuble', codigo: 16 },
  { clave: 'coquimbo', codigo: 4 },
  { clave: 'atacama', codigo: 3 },
  { clave: 'antofagasta', codigo: 2 },
  { clave: 'tarapaca', codigo: 1 },
];

function normalizar(texto) {
  return (texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // saca tildes
    .toLowerCase()
    .trim();
}

/**
 * Traduce un nombre de región (como lo guarda el resto de la app) al código
 * numérico INE que espera la API v2 de Compra Ágil. Devuelve null si no
 * reconoce ninguna palabra clave — mejor no mandar el filtro que mandar un
 * código adivinado.
 */
function obtenerCodigoRegion(nombreRegion) {
  const normalizado = normalizar(nombreRegion);
  const encontrada = REGIONES_POR_PALABRA_CLAVE.find((r) => normalizado.includes(r.clave));
  return encontrada ? encontrada.codigo : null;
}

module.exports = { obtenerCodigoRegion };
