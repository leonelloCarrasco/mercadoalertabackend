/**
 * Obtiene el valor vigente de la UTM (Unidad Tributaria Mensual) en pesos chilenos,
 * usando la API pública de mindicador.cl. Se cachea por día — la UTM cambia una vez
 * al mes, así que no hace falta consultar la API en cada matching.
 */
const MINDICADOR_URL = 'https://mindicador.cl/api/utm';

let cache = { valor: null, fecha: null };

async function obtenerValorUTM() {
  const hoy = new Date().toISOString().slice(0, 10);

  if (cache.valor && cache.fecha === hoy) {
    return cache.valor;
  }

  try {
    const response = await fetch(MINDICADOR_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const valor = data?.serie?.[0]?.valor;

    if (!valor) {
      throw new Error('La respuesta no trajo un valor de UTM válido');
    }

    cache = { valor, fecha: hoy };
    return valor;
  } catch (err) {
    console.error('[utm.service] Error obteniendo el valor de la UTM:', err.message);
    // Si falla y ya teníamos un valor cacheado de un día anterior, mejor usar ese
    // (ligeramente desactualizado) que no tener ninguno.
    return cache.valor;
  }
}

module.exports = { obtenerValorUTM };
