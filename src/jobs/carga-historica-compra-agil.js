const {
  listarTodosLosCambiosPorRangoFecha,
  obtenerDetalleCompraAgil,
  CuotaAgotadaError,
} = require('../services/compraagil.service');
const { obtenerCodigosCompraAgilYaVistos, guardarCompraAgil } = require('../db/compra-agil.queries');

// Fecha de arranque del rescate — la carga por archivo anterior no trajo
// todo, así que se recorre desde acá hacia adelante (ver conversación de
// diseño: siempre arranca del mismo día, nunca guarda "hasta dónde llegó",
// porque así se auto-repara solo cualquier día que haya quedado a medias
// por un corte de cuota a mitad de un día — al pasar de nuevo por ahí, los
// códigos que ya se guardaron se saltan, y solo se reintentan los que
// faltan de verdad).
const FECHA_INICIO_CARGA_HISTORICA = '2026-05-01';

// Evita que dos corridas pisen la cuota diaria al mismo tiempo si alguien
// dispara cualquiera de los dos endpoints (recorrido completo o un día
// puntual) mientras ya hay uno corriendo — comparten el mismo flag a
// propósito, para que no compitan entre sí por la misma cuota.
let cargaEnCurso = false;

function formatearFechaISO(fecha) {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Procesa UN día puntual: lista con cambio_desde/cambio_hasta (el filtro
 * exacto, no el rodeo con ttl_cambio_ms del polling normal), se queda solo
 * con los códigos que todavía no están en la base, y para esos pide el
 * DETALLE completo (no el resumen) y lo guarda.
 *
 * No decide si seguir a otro día — eso lo maneja quien llama:
 * correrCargaHistoricaCompraAgil() la llama una vez por día en un loop;
 * correrCargaHistoricaCompraAgilUnDia() la llama una sola vez y termina ahí.
 *
 * Cualquier error QUE NO sea CuotaAgotadaError se deja subir (el que llama
 * decide qué hacer) — pero como compraagil.service.js ahora también
 * detecta límites de ráfaga disfrazados de error genérico (no solo el 429
 * de la cuota diaria formal), la enorme mayoría de los cortes reales van a
 * llegar acá como CuotaAgotadaError de todas formas.
 */
async function procesarUnDia(fechaISO) {
  const cambioDesde = `${fechaISO}T00:00:00Z`;
  const cambioHasta = `${fechaISO}T23:59:59Z`;

  let items;
  try {
    items = await listarTodosLosCambiosPorRangoFecha(cambioDesde, cambioHasta);
  } catch (err) {
    if (err instanceof CuotaAgotadaError) {
      console.warn(`[carga-historica] Cuota/límite agotado listando el día ${fechaISO} — se corta acá.`);
      return { itemsEnListado: 0, nuevosEncontrados: 0, guardadas: 0, cortado: true, motivoCorte: err.message };
    }
    throw err;
  }

  if (items.length === 0) {
    return { itemsEnListado: 0, nuevosEncontrados: 0, guardadas: 0, cortado: false };
  }

  const codigos = items.map((item) => item.codigo);
  const yaVistos = await obtenerCodigosCompraAgilYaVistos(codigos);
  const nuevos = codigos.filter((c) => !yaVistos.has(c));

  if (nuevos.length > 0) {
    console.log(`[carga-historica] ${fechaISO}: ${items.length} en el listado, ${nuevos.length} nuevos por cargar.`);
  }

  let guardadas = 0;
  for (const codigo of nuevos) {
    try {
      const detalle = await obtenerDetalleCompraAgil(codigo);
      // El detalle ya trae todos los campos que trae un ítem de listado
      // (codigo, nombre, estado, fechas, montos, institución) MÁS
      // proveedores_cotizando/productos_solicitados — se puede pasar como
      // los dos argumentos de guardarCompraAgil sin necesitar el ítem de
      // listado por separado.
      await guardarCompraAgil(detalle, detalle);
      guardadas++;
      console.log(`  guardada: ${codigo}`);
    } catch (err) {
      if (err instanceof CuotaAgotadaError) {
        console.warn(`[carga-historica] Cuota/límite agotado pidiendo el detalle de ${codigo} (día ${fechaISO}) — se corta acá.`);
        return { itemsEnListado: items.length, nuevosEncontrados: nuevos.length, guardadas, cortado: true, motivoCorte: err.message };
      }
      console.error(`[carga-historica] Error guardando ${codigo}, se sigue con el próximo:`, err.message);
    }
  }

  return { itemsEnListado: items.length, nuevosEncontrados: nuevos.length, guardadas, cortado: false };
}

/**
 * Recorre día por día desde FECHA_INICIO_CARGA_HISTORICA hasta hoy. Se
 * corta apenas procesarUnDia devuelve cortado:true — ahí termina la
 * corrida de hoy. Al otro día, disparar de nuevo: arranca del mismo
 * FECHA_INICIO_CARGA_HISTORICA, pero como los días ya completos no tienen
 * códigos nuevos que cargar, pasan rápido hasta llegar de nuevo a donde se
 * cortó ayer.
 *
 * Envuelve TODO el recorrido en un try/catch general (no solo
 * CuotaAgotadaError) — si pasa algo genuinamente inesperado (un bug, un
 * error de red que no calza en ningún patrón conocido), la corrida termina
 * prolijo igual, informando qué alcanzó a hacer, en vez de un "Error no
 * manejado" sin contexto en la ruta que la disparó.
 */
async function correrCargaHistoricaCompraAgil() {
  if (cargaEnCurso) {
    console.warn('[carga-historica] Ya hay una carga en curso — se ignora este disparo.');
    return { yaEnCurso: true };
  }

  cargaEnCurso = true;
  console.log(`[carga-historica] Iniciando — recorre día por día desde ${FECHA_INICIO_CARGA_HISTORICA} hasta hoy, saltando lo que ya está guardado.`);

  let totalGuardadas = 0;
  let diasRecorridos = 0;
  let cortado = false;
  let motivoCorte = null;

  try {
    const fechaActual = new Date(`${FECHA_INICIO_CARGA_HISTORICA}T00:00:00Z`);
    const hoy = new Date();

    while (fechaActual <= hoy) {
      const fechaISO = formatearFechaISO(fechaActual);
      const resultado = await procesarUnDia(fechaISO);
      diasRecorridos++;
      totalGuardadas += resultado.guardadas;

      if (resultado.cortado) {
        cortado = true;
        motivoCorte = resultado.motivoCorte;
        break;
      }

      fechaActual.setUTCDate(fechaActual.getUTCDate() + 1);
    }
  } catch (err) {
    console.error('[carga-historica] Error inesperado (no era cuota/límite conocido) — se corta la corrida:', err);
    cortado = true;
    motivoCorte = `Error inesperado: ${err.message}`;
  } finally {
    cargaEnCurso = false;
  }

  const mensaje = cortado
    ? `Se cortó a mitad de camino (${motivoCorte}). ${diasRecorridos} días recorridos, ${totalGuardadas} Compras Ágiles nuevas guardadas. Volver a llamar más tarde/mañana para seguir.`
    : `Terminado — llegó hasta hoy. ${diasRecorridos} días recorridos, ${totalGuardadas} Compras Ágiles nuevas guardadas.`;

  console.log(`[carga-historica] ${mensaje}`);
  return { cortado, motivoCorte, diasRecorridos, totalGuardadas, mensaje };
}

/**
 * Carga UN solo día puntual (ver POST /api/admin/carga-historica-compra-agil/:fecha)
 * y termina ahí — a diferencia de correrCargaHistoricaCompraAgil(), nunca
 * sigue a otro día, sea que se corte por cuota/límite o que termine bien.
 * Mismo manejo defensivo de errores inesperados que la función de arriba.
 */
async function correrCargaHistoricaCompraAgilUnDia(fechaISO) {
  if (cargaEnCurso) {
    console.warn('[carga-historica] Ya hay una carga en curso — se ignora este disparo.');
    return { yaEnCurso: true };
  }

  cargaEnCurso = true;
  console.log(`[carga-historica] Iniciando carga puntual del día ${fechaISO}.`);

  let resultado;
  try {
    resultado = await procesarUnDia(fechaISO);
  } catch (err) {
    console.error(`[carga-historica] Error inesperado procesando ${fechaISO} (no era cuota/límite conocido):`, err);
    resultado = { itemsEnListado: 0, nuevosEncontrados: 0, guardadas: 0, cortado: true, motivoCorte: `Error inesperado: ${err.message}` };
  } finally {
    cargaEnCurso = false;
  }

  const mensaje = resultado.cortado
    ? `Se cortó procesando ${fechaISO} (${resultado.motivoCorte}). ${resultado.guardadas} Compras Ágiles nuevas guardadas antes del corte.`
    : `Terminado — día ${fechaISO}: ${resultado.itemsEnListado} en el listado, ${resultado.nuevosEncontrados} nuevos, ${resultado.guardadas} guardadas.`;

  console.log(`[carga-historica] ${mensaje}`);
  return { ...resultado, mensaje };
}

module.exports = { correrCargaHistoricaCompraAgil, correrCargaHistoricaCompraAgilUnDia };
