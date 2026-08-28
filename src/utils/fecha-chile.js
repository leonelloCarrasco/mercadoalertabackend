/**
 * Convierte un string de fecha SIN zona horaria (como los que manda
 * Mercado Público: "2026-08-24 16:00" o "2026-08-09T14:10:01.257", sin
 * sufijo Z ni offset) a un objeto Date que representa el instante UTC
 * correcto, asumiendo que esos dígitos son hora de Chile.
 *
 * Por qué hace falta esto (ver conversación de agosto 2026): sin esta
 * conversión, si se guarda el string crudo tal cual en una columna
 * TIMESTAMPTZ, Postgres/el driver lo interpreta según la zona horaria de
 * la SESIÓN (UTC en producción) — no la de Chile — lo que corre cualquier
 * comparación con NOW() por 3-4 horas (según la época del año) sin que
 * nada tire error. Se resuelve UNA VEZ acá, en el borde donde entra el
 * dato externo, en vez de tener que acordarse de aplicar AT TIME ZONE en
 * cada query que toque estos campos — sobre todo porque algunos puntos
 * del código (el archivado de precios, por ejemplo) a veces reciben el
 * string crudo de la API y otras veces un valor ya leído de la base
 * (que después de esta migración ya sería un TIMESTAMPTZ correcto) —
 * mezclar AT TIME ZONE en la misma query para los dos casos es un error
 * fácil de cometer, porque SQL interpreta AT TIME ZONE distinto según si
 * el valor de entrada ya tiene zona o no. Convertir acá, en JS, antes de
 * que el dato le llegue a cualquier query, evita esa ambigüedad del todo.
 *
 * Usa 'America/Santiago' (no un offset fijo) — Node ya sabe exactamente
 * cuándo Chile cambia de UTC-4 a UTC-3 y viceversa (misma base de datos de
 * zonas horarias que usa Postgres), así que esto sigue funcionando solo,
 * sin tocar código, cuando cambie la temporada.
 */
function parsearFechaChile(fechaSinZona) {
  if (!fechaSinZona) return null;

  const normalizada = String(fechaSinZona).trim().replace(' ', 'T');
  const comoUTC = new Date(normalizada.endsWith('Z') ? normalizada : `${normalizada}Z`);
  if (isNaN(comoUTC.getTime())) return null;

  // Mide cuánto se corre esa misma fecha/hora al mirarla desde Chile en
  // vez de UTC — el offset real que correspondía ese día puntual (-3 o -4
  // según la temporada, resuelto automáticamente).
  const comoSiFueraUTCTexto = comoUTC.toLocaleString('en-US', { timeZone: 'UTC' });
  const comoSiFueraChileTexto = comoUTC.toLocaleString('en-US', { timeZone: 'America/Santiago' });
  const offsetMs = new Date(comoSiFueraUTCTexto).getTime() - new Date(comoSiFueraChileTexto).getTime();

  return new Date(comoUTC.getTime() + offsetMs);
}

module.exports = { parsearFechaChile, inicioDelDiaChile, formatearParaQueryChile };

/**
 * Devuelve el instante UTC correspondiente a las 00:00:00 de HOY, hora de
 * Chile — para cortes de "solo lo de hoy" (ver poll-compra-agil.js). Se
 * apoya en parsearFechaChile: primero arma la fecha de hoy en formato
 * YYYY-MM-DD según la zona de Chile, y la interpreta como medianoche en
 * esa misma zona.
 */
function inicioDelDiaChile() {
  const fechaHoyEnChile = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); // "YYYY-MM-DD"
  return parsearFechaChile(`${fechaHoyEnChile} 00:00:00`);
}

/**
 * Inverso de parsearFechaChile — toma un instante (Date) y lo formatea
 * como "YYYY-MM-DDTHH:mm:ss" en hora de Chile, para mandarlo como
 * parámetro de query a la API de Compra Ágil (ej. publicado_desde).
 * Confirmado contra la API real (agosto 2026) que espera exactamente este
 * formato, sin zona horaria explícita, en hora de Chile.
 */
function formatearParaQueryChile(fecha) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(fecha);
  const obtener = (tipo) => partes.find((p) => p.type === tipo).value;
  return `${obtener('year')}-${obtener('month')}-${obtener('day')}T${obtener('hour')}:${obtener('minute')}:${obtener('second')}`;
}
