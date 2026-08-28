const { obtenerDetalleLicitacion } = require('../services/mercadopublico.service');
const { obtenerDetalleCompraAgil, CuotaAgotadaError } = require('../services/compraagil.service');
const {
  listarLicitacionesPendientesDeResolucion,
  actualizarResolucionLicitacion,
} = require('../db/licitaciones.queries');
const {
  listarCompraAgilPendienteDeResolucion,
  actualizarResolucionCompraAgil,
} = require('../db/compra-agil.queries');
const { ESTADOS_FINALES_LICITACION, ESTADOS_FINALES_COMPRA_AGIL } = require('../utils/estados-finales');
const { extraerItemsConAdjudicacion } = require('../utils/adjudicacion');
const { archivarPreciosLicitacion, archivarPreciosCompraAgil } = require('../db/historico-precios.queries');
const { parsearFechaChile } = require('../utils/fecha-chile');

const DELAY_LICITACIONES_MS = 3100; // mismo mínimo que exige la API de licitaciones

// Compra Ágil no tiene un mínimo documentado como licitaciones, pero corre el
// mismo riesgo de límite de corto plazo por ráfaga que ya se corrigió en
// poll-compra-agil.js (misma API, mismo problema) — mismo valor que se usa
// en el resto del código para Compra Ágil (PAUSA_ENTRE_PAGINAS_MS /
// PAUSA_ENTRE_DETALLES_MS en compraagil.service.js y poll-compra-agil.js),
// para no inventar un tercer número distinto sin motivo. Subido de 300ms a
// 1s en agosto 2026 — ver el comentario largo en PAUSA_ENTRE_PAGINAS_MS
// (compraagil.service.js) sobre la sospecha de cuota compartida entre
// todos los consumidores de esta API.
const DELAY_COMPRA_AGIL_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function revisarLicitaciones(limite) {
  let codigos = await listarLicitacionesPendientesDeResolucion();

  if (limite) {
    codigos = codigos.slice(0, limite);
  }

  if (codigos.length === 0) {
    console.log('[revisar-resoluciones] Sin licitaciones pendientes de revisar.');
    return;
  }

  console.log(`[revisar-resoluciones] Revisando ${codigos.length} licitaciones cerradas...`);

  let resueltas = 0;
  let siguenPendientes = 0;

  for (const codigo of codigos) {
    try {
      const detalle = await obtenerDetalleLicitacion(codigo);
      if (detalle) {
        const esFinal = ESTADOS_FINALES_LICITACION.includes(detalle.Estado);
        const items = extraerItemsConAdjudicacion(detalle);
        // Fechas.FechaAdjudicacion trae la hora real; Adjudicacion.Fecha
        // (separado) siempre viene a medianoche en la API — se prioriza el
        // que sí tiene hora (mismo fix reutilizado para el archivado de abajo).
        // parsearFechaChile: la API manda este campo SIN zona horaria (hora
        // de Chile) — se convierte UNA sola vez, acá, y el mismo valor ya
        // convertido se reusa tanto para actualizarResolucionLicitacion
        // como para archivarPreciosLicitacion más abajo.
        const fechaAdjudicacion = parsearFechaChile(detalle.Fechas?.FechaAdjudicacion || detalle.Adjudicacion?.Fecha);

        await actualizarResolucionLicitacion(codigo, {
          items,
          estado: detalle.Estado || null,
          fechaAdjudicacion,
          numeroOferentes: detalle.Adjudicacion?.NumeroOferentes || null,
          urlActa: detalle.Adjudicacion?.UrlActa || null,
          resuelta: esFinal,
        });

        if (esFinal) {
          resueltas++;
          // Archivado de precios (Fase 1 del plan de retención) — camino
          // principal, en el momento exacto en que se sabe el resultado. Si
          // esto falla, NO se pierde la resolución ya guardada arriba —
          // solo se pierde este archivado puntual, que igual queda cubierto
          // más adelante por la red de seguridad del cron de limpieza.
          try {
            const guardadas = await archivarPreciosLicitacion({
              codigoExterno: codigo,
              nombre: detalle.Nombre,
              organismo: detalle.Comprador?.NombreOrganismo,
              fechaAdjudicacion,
              numeroOferentes: detalle.Adjudicacion?.NumeroOferentes || null,
              urlActa: detalle.Adjudicacion?.UrlActa || null,
              items,
            });
            if (guardadas > 0) console.log(`[revisar-resoluciones] Archivados ${guardadas} precios de ${codigo} en historico_precios.`);
          } catch (err) {
            console.error(`[revisar-resoluciones] Error archivando precios de ${codigo} (no afecta la resolución ya guardada):`, err.message);
          }
        } else {
          siguenPendientes++;
        }
      }
    } catch (err) {
      console.error(`[revisar-resoluciones] Error revisando licitación ${codigo}:`, err.message);
    }
    await sleep(DELAY_LICITACIONES_MS);
  }

  console.log(`[revisar-resoluciones] Licitaciones: ${resueltas} resueltas, ${siguenPendientes} siguen pendientes.`);
}

async function revisarComprasAgiles() {
  const codigos = await listarCompraAgilPendienteDeResolucion();

  if (codigos.length === 0) {
    console.log('[revisar-resoluciones] Sin Compras Ágiles pendientes de revisar.');
    return;
  }

  console.log(`[revisar-resoluciones] Revisando ${codigos.length} Compras Ágiles cerradas...`);

  let resueltas = 0;
  let siguenPendientes = 0;

  for (const codigo of codigos) {
    try {
      const detalle = await obtenerDetalleCompraAgil(codigo);
      const nuevoEstado = detalle.estado?.codigo || null;
      const esFinal = ESTADOS_FINALES_COMPRA_AGIL.includes(nuevoEstado);

      await actualizarResolucionCompraAgil(codigo, {
        estado: nuevoEstado,
        idOrdenCompra: detalle.id_orden_compra || null,
        proveedoresCotizando: detalle.proveedores_cotizando || [],
        productosSolicitados: detalle.productos_solicitados || [],
        resuelta: esFinal,
      });

      if (esFinal) {
        resueltas++;
        // Archivado de precios — mismo criterio que licitaciones: camino
        // principal acá, red de seguridad en el cron de limpieza. Se
        // guardan TODAS las cotizaciones, no solo la ganadora.
        try {
          const guardadas = await archivarPreciosCompraAgil({
            codigoExterno: codigo,
            nombre: detalle.nombre,
            organismo: detalle.institucion?.organismo_comprador,
            // parsearFechaChile: mismo criterio que para licitaciones más
            // arriba — la API manda este campo sin zona horaria.
            fechaCierre: parsearFechaChile(detalle.fechas?.fecha_cierre),
            proveedoresCotizando: detalle.proveedores_cotizando || [],
          });
          if (guardadas > 0) console.log(`[revisar-resoluciones] Archivados ${guardadas} precios de ${codigo} en historico_precios.`);
        } catch (err) {
          console.error(`[revisar-resoluciones] Error archivando precios de ${codigo} (no afecta la resolución ya guardada):`, err.message);
        }
      } else {
        siguenPendientes++;
      }
    } catch (err) {
      if (err instanceof CuotaAgotadaError) {
        console.warn('[revisar-resoluciones] Cuota diaria de Compra Ágil agotada, se corta acá por hoy.');
        break;
      }
      // ErrorTransitorioItem (u otro error puntual) cae acá — sigue con la
      // próxima Compra Ágil pendiente en vez de cortar toda la revisión
      // del día, mismo criterio que procesarConPausa en poll-compra-agil.js.
      console.error(`[revisar-resoluciones] Error revisando Compra Ágil ${codigo}:`, err.message);
    }
    await sleep(DELAY_COMPRA_AGIL_MS);
  }

  console.log(`[revisar-resoluciones] Compra Ágil: ${resueltas} resueltas, ${siguenPendientes} siguen pendientes.`);
}

/**
 * Revisa licitaciones y Compras Ágiles cerradas que aún no sabemos si se
 * resolvieron (adjudicadas, desiertas, etc.), y guarda el resultado cuando
 * ya haya uno. Pensado para correr una vez al día (no hay apuro — la
 * adjudicación puede tardar días o semanas en publicarse).
 *
 * Compra Ágil: confirmado con un caso real que al resolverse el estado.codigo
 * cambia de "publicada" a otro valor (ej. "proveedor_seleccionado"), y
 * proveedores_cotizando queda con el detalle completo de TODAS las cotizaciones
 * recibidas — no solo la ganadora — incluyendo precio unitario por producto de
 * cada una y por qué se rechazaron las que no ganaron. Justo el dato que hace
 * falta para comparar precios de la competencia a futuro.
 */
async function correrRevisionResoluciones(opciones = {}) {
  console.log('[revisar-resoluciones] Iniciando...');
  // Compra Ágil primero: su pausa entre llamadas (300ms) es mucho más chica
  // que la de licitaciones (3.1s obligatorios), así que sigue siendo mucho
  // más rápido en total — alcanza a terminar aunque licitaciones se corte
  // por timeout HTTP a mitad de camino (con el delay de licitaciones, una
  // corrida grande puede tardar mucho más que cualquier timeout razonable).
  // Antes Compra Ágil no tenía ninguna pausa acá — se agregó en agosto 2026
  // (mismo riesgo de límite de corto plazo que ya se había corregido en
  // poll-compra-agil.js, pero nunca se replicó en este archivo).
  await revisarComprasAgiles();
  await revisarLicitaciones(opciones.limiteLicitaciones);
  console.log('[revisar-resoluciones] Terminado.');
}

module.exports = { correrRevisionResoluciones };
