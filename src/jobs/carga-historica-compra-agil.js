const {
  listarTodosLosCambiosPorRangoFecha,
  obtenerDetalleCompraAgil,
  CuotaAgotadaError,
  ErrorTransitorioItem,
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
// dispara el endpoint dos veces (a propósito o por error) mientras la
// anterior sigue corriendo.
let cargaEnCurso = false;

function formatearFechaISO(fecha) {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Recorre día por día desde FECHA_INICIO_CARGA_HISTORICA hasta hoy, usando
 * el filtro de rango exacto (cambio_desde/cambio_hasta) para cada día — NO
 * el rodeo con ttl_cambio_ms que usa el polling normal (ver el bug de
 * ventana corta documentado en poll-compra-agil.js).
 *
 * Por cada día: lista los códigos con cambios ese día, se queda solo con
 * los que TODAVÍA no están en la base (obtenerCodigosCompraAgilYaVistos,
 * el mismo criterio que ya usa el polling), y para esos pide el DETALLE
 * completo (no el resumen) — a diferencia del polling normal, acá siempre
 * hay presupuesto de sobra para pedir detalle de todo lo nuevo, porque el
 * volumen diario histórico es bajo comparado con la cuota.
 *
 * Se corta apenas la API devuelve "cuota agotada" — sea listando un día o
 * pidiendo un detalle puntual — y ahí termina la corrida de hoy. Al otro
 * día, disparar de nuevo el mismo endpoint: arranca del mismo
 * FECHA_INICIO_CARGA_HISTORICA, pero como los días ya completos no tienen
 * códigos nuevos que cargar, pasan rápido (solo el listado, sin pedir
 * ningún detalle) hasta llegar de nuevo a donde se cortó ayer.
 */
async function correrCargaHistoricaCompraAgil() {
  if (cargaEnCurso) {
    console.warn('[carga-historica] Ya hay una carga en curso — se ignora este disparo.');
    return { yaEnCurso: true };
  }

  cargaEnCurso = true;
  console.log(`[carga-historica] Iniciando — recorre día por día desde ${FECHA_INICIO_CARGA_HISTORICA} hasta hoy, saltando lo que ya está guardado.`);

  let totalGuardadas = 0;
  let totalRevisadas = 0;
  let diasRecorridos = 0;
  let cortadoPorCuota = false;

  try {
    const fechaActual = new Date(`${FECHA_INICIO_CARGA_HISTORICA}T00:00:00Z`);
    const hoy = new Date();

    while (fechaActual <= hoy) {
      const fechaISO = formatearFechaISO(fechaActual);
      const cambioDesde = `${fechaISO}T00:00:00Z`;
      const cambioHasta = `${fechaISO}T23:59:59Z`;

      let items;
      try {
        items = await listarTodosLosCambiosPorRangoFecha(cambioDesde, cambioHasta);
      } catch (err) {
        if (err instanceof CuotaAgotadaError) {
          console.warn(`[carga-historica] Cuota agotada listando el día ${fechaISO} — se corta acá.`);
          cortadoPorCuota = true;
          break;
        }
        console.error(`[carga-historica] Error listando ${fechaISO}, se sigue con el día siguiente:`, err.message);
        fechaActual.setUTCDate(fechaActual.getUTCDate() + 1);
        continue;
      }

      diasRecorridos++;

      if (items.length > 0) {
        const codigos = items.map((item) => item.codigo);
        const yaVistos = await obtenerCodigosCompraAgilYaVistos(codigos);
        const nuevos = codigos.filter((c) => !yaVistos.has(c));

        if (nuevos.length > 0) {
          console.log(`[carga-historica] ${fechaISO}: ${items.length} en el listado, ${nuevos.length} nuevos por cargar.`);
        }

        for (const codigo of nuevos) {
          totalRevisadas++;
          try {
            const detalle = await obtenerDetalleCompraAgil(codigo);
            // El detalle ya trae todos los campos que trae un ítem de
            // listado (codigo, nombre, estado, fechas, montos, institución)
            // MÁS proveedores_cotizando/productos_solicitados — se puede
            // pasar como los dos argumentos de guardarCompraAgil sin
            // necesitar el ítem de listado por separado.
            await guardarCompraAgil(detalle, detalle);
            totalGuardadas++;
            console.log(`  guardada: ${codigo}`);
          } catch (err) {
            if (err instanceof CuotaAgotadaError) {
              console.warn(`[carga-historica] Cuota agotada pidiendo el detalle de ${codigo} (día ${fechaISO}) — se corta acá.`);
              cortadoPorCuota = true;
              break;
            }
            // ErrorTransitorioItem (u otro error puntual) cae acá — sigue
            // con el próximo código del mismo día en vez de cortar todo,
            // mismo criterio que procesarConPausa en poll-compra-agil.js.
            console.error(`[carga-historica] Error guardando ${codigo}, se sigue con el próximo:`, err.message);
          }
        }
      }

      if (cortadoPorCuota) break;
      fechaActual.setUTCDate(fechaActual.getUTCDate() + 1);
    }
  } finally {
    cargaEnCurso = false;
  }

  const mensaje = cortadoPorCuota
    ? `Cuota diaria agotada — se cortó a mitad de camino. ${diasRecorridos} días recorridos, ${totalGuardadas} Compras Ágiles nuevas guardadas. Volver a llamar mañana para seguir.`
    : `Terminado — llegó hasta hoy. ${diasRecorridos} días recorridos, ${totalGuardadas} Compras Ágiles nuevas guardadas.`;

  console.log(`[carga-historica] ${mensaje}`);
  return { cortadoPorCuota, diasRecorridos, totalRevisadas, totalGuardadas, mensaje };
}

module.exports = { correrCargaHistoricaCompraAgil };
