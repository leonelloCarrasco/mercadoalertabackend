const { obtenerDetalleLicitacion } = require('../services/mercadopublico.service');
const { actualizarResolucionLicitacion } = require('../db/licitaciones.queries');
const {
  listarCodigosSeguidosUnicos,
  listarSeguidoresPorCodigo,
  actualizarUltimoEstadoNotificado,
} = require('../db/seguimientos.queries');
const { obtenerItemPipelinePorCodigo, actualizarEstadoPipeline } = require('../db/pipeline.queries');
const { obtenerRutDeUsuario } = require('../db/empresas.queries');
const { ESTADOS_FINALES_LICITACION } = require('../utils/estados-finales');
const { extraerItemsConAdjudicacion } = require('../utils/adjudicacion');
const { normalizarRut } = require('../utils/rut');
const { enviarEmailAlerta, armarEmailSeguimiento } = require('../services/email.service');
const { enviarTelegramAlerta } = require('../services/telegram.service');

const DELAY_LICITACIONES_MS = 3100; // mismo mínimo que exige la API de licitaciones

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function armarTextoTelegramSeguimiento({ nombre, codigoExterno, estadoAnterior, estadoNuevo }) {
  return `📋 Cambio de estado\n\n${nombre}\nCódigo: ${codigoExterno}\n${estadoAnterior} → ${estadoNuevo}`;
}

/**
 * Mini-CRM (migración 036): si este usuario tiene la licitación en su
 * pipeline, compara el RUT de cada proveedor adjudicado contra el RUT de su
 * propia empresa (empresas.rut) — normalizando ambos, porque el formato que
 * trae la API en Adjudicacion.RutProveedor no está 100% garantizado.
 *
 * - Si coincide con algún ítem → mueve la tarjeta sola a 'ganada'.
 * - Si no coincide con ninguno Y la tarjeta ya estaba en 'oferta_enviada' →
 *   la mueve a 'perdida' (evita marcar "perdida" a algo que el usuario ni
 *   siquiera había llegado a postular — ahí se deja para que la revise a mano).
 * - Cualquier otro caso (no está en pipeline, o está en un estado anterior a
 *   'oferta_enviada' y no ganó) no se toca — el usuario decide.
 */
async function intentarActualizarPipelinePorAdjudicacion(userId, codigoExterno, items) {
  try {
    const itemPipeline = await obtenerItemPipelinePorCodigo(userId, codigoExterno);
    if (!itemPipeline) return;

    const rutEmpresa = await obtenerRutDeUsuario(userId);
    const rutEmpresaNorm = rutEmpresa ? normalizarRut(rutEmpresa) : null;

    const gano = !!rutEmpresaNorm && items.some((it) => (
      it.adjudicacion && normalizarRut(it.adjudicacion.rut_proveedor) === rutEmpresaNorm
    ));

    if (gano) {
      await actualizarEstadoPipeline(itemPipeline.id, userId, 'ganada');
    } else if (itemPipeline.estado_personal === 'oferta_enviada') {
      await actualizarEstadoPipeline(itemPipeline.id, userId, 'perdida');
    }
  } catch (err) {
    console.error(`[seguimiento-estado] Error en detección de pipeline para user ${userId} / ${codigoExterno}:`, err.message);
  }
}

/**
 * Revisa TODAS las licitaciones seguidas (por cualquier usuario), sin
 * importar si ya cerraron o no — a diferencia de revisar-resoluciones.js,
 * que solo mira las que ya pasaron su fecha_cierre. Hace falta este rango
 * más amplio porque acá interesa avisar en CUALQUIER cambio de estado,
 * incluida una revocación/suspensión que puede pasar incluso antes del cierre.
 *
 * Si varios usuarios siguen el mismo código, se pide el detalle a la API
 * UNA sola vez (ver listarCodigosSeguidosUnicos) y se evalúa el cambio por
 * separado para cada seguidor (cada uno puede tener un ultimo_estado_notificado
 * distinto, según cuándo empezó a seguirla).
 *
 * Si el nuevo estado es FINAL (Adjudicada/Desierta/Revocada), se guarda con
 * el mismo criterio que revisar-resoluciones.js (misma función,
 * actualizarResolucionLicitacion, mismo parseo de items/adjudicación) y
 * queda resuelta=true — así ese job diario ya no la vuelve a pedir de nuevo,
 * este ya hizo el trabajo.
 */
async function correrSeguimientoEstado() {
  const codigos = await listarCodigosSeguidosUnicos();

  if (codigos.length === 0) {
    console.log('[seguimiento-estado] Sin licitaciones en seguimiento activo.');
    return;
  }

  console.log(`[seguimiento-estado] Revisando ${codigos.length} licitaciones seguidas...`);
  let notificaciones = 0;

  for (const codigo of codigos) {
    try {
      const detalle = await obtenerDetalleLicitacion(codigo);
      if (!detalle) {
        await sleep(DELAY_LICITACIONES_MS);
        continue;
      }

      const nuevoEstado = detalle.Estado || null;
      const esFinal = ESTADOS_FINALES_LICITACION.includes(nuevoEstado);
      const items = extraerItemsConAdjudicacion(detalle);

      await actualizarResolucionLicitacion(codigo, {
        items,
        estado: nuevoEstado,
        fechaAdjudicacion: detalle.Adjudicacion?.Fecha || detalle.Fechas?.FechaAdjudicacion || null,
        numeroOferentes: detalle.Adjudicacion?.NumeroOferentes || null,
        urlActa: detalle.Adjudicacion?.UrlActa || null,
        resuelta: esFinal,
      });

      const seguidores = await listarSeguidoresPorCodigo(codigo);
      for (const s of seguidores) {
        if (!nuevoEstado || s.ultimo_estado_notificado === nuevoEstado) continue; // sin cambios para este usuario

        try {
          const { subject, html } = armarEmailSeguimiento({
            nombre: detalle.Nombre,
            codigoExterno: codigo,
            estadoAnterior: s.ultimo_estado_notificado,
            estadoNuevo: nuevoEstado,
            items,
          });
          await enviarEmailAlerta({ to: s.email, subject, html });

          if (s.telegram_chat_id) {
            await enviarTelegramAlerta(s.telegram_chat_id, armarTextoTelegramSeguimiento({
              nombre: detalle.Nombre,
              codigoExterno: codigo,
              estadoAnterior: s.ultimo_estado_notificado,
              estadoNuevo: nuevoEstado,
            }));
          }

          await actualizarUltimoEstadoNotificado(s.id, nuevoEstado);
          notificaciones++;

          // Detección automática de ganado/perdido en el pipeline (mini-CRM,
          // migración 036) — solo tiene sentido en el estado final Adjudicada,
          // y solo si este usuario tiene esta licitación en su pipeline.
          if (nuevoEstado === 'Adjudicada') {
            await intentarActualizarPipelinePorAdjudicacion(s.user_id, codigo, items);
          }
        } catch (err) {
          console.error(`[seguimiento-estado] Error notificando a user ${s.user_id} sobre ${codigo}:`, err.message);
        }
      }
    } catch (err) {
      console.error(`[seguimiento-estado] Error revisando licitación ${codigo}:`, err.message);
    }
    await sleep(DELAY_LICITACIONES_MS);
  }

  console.log(`[seguimiento-estado] Terminado. ${notificaciones} notificaciones enviadas.`);
}

module.exports = { correrSeguimientoEstado };
