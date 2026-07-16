const { obtenerDetalleLicitacion } = require('../services/mercadopublico.service');
const { actualizarResolucionLicitacion } = require('../db/licitaciones.queries');
const {
  listarCodigosSeguidosUnicos,
  listarSeguidoresPorCodigo,
  actualizarUltimoEstadoNotificado,
} = require('../db/seguimientos.queries');
const { ESTADOS_FINALES_LICITACION } = require('../utils/estados-finales');
const { extraerItemsConAdjudicacion } = require('../utils/adjudicacion');
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
