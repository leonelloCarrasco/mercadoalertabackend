const {
  listarEmpresasParaAviso2Dias,
  listarEmpresasParaAvisoVencido,
  marcarAviso2DiasEnviado,
  marcarAvisoVencidoEnviado,
  listarEmpresasParaAvisoAcceso2Dias,
  listarEmpresasParaCorteDeAcceso,
  marcarAvisoAcceso2DiasEnviado,
  marcarAvisoAccesoTerminadoYCortarAcceso,
} = require('../db/empresas.queries');
const {
  enviarEmailAlerta,
  armarEmailAviso2Dias,
  armarEmailTrialVencido,
  armarEmailAvisoAcceso2Dias,
  armarEmailAccesoTerminado,
} = require('../services/email.service');

/**
 * Corre una vez al día. Cubre dos situaciones distintas, pero con el mismo
 * patrón de "avisar antes + avisar/actuar el día que corresponde":
 *  - Trial por vencer / vencido (avisar2DiasAntes / avisarVencido).
 *  - Acceso por cortarse / cortado tras una cancelación de suscripción
 *    (avisarAcceso2DiasAntes / avisarYCortarAcceso — ver migración 039 y
 *    POST /api/pagos/cancelar).
 *
 * En los dos casos es el único aviso PROACTIVO — el banner del dashboard y
 * requireEmpresaActiva.middleware.js solo actúan si el usuario efectivamente
 * abre la app; sin este job, alguien que no vuelve a entrar nunca se entera.
 */
async function correrAvisosTrial() {
  await avisar2DiasAntes();
  await avisarVencido();
  await avisarAcceso2DiasAntes();
  await avisarYCortarAcceso();
}

async function avisar2DiasAntes() {
  const empresas = await listarEmpresasParaAviso2Dias();
  if (empresas.length === 0) {
    console.log('[avisos-trial] Sin avisos de "2 días antes" pendientes.');
    return;
  }

  console.log(`[avisos-trial] ${empresas.length} avisos de "2 días antes" para enviar...`);
  for (const e of empresas) {
    try {
      const { subject, html } = armarEmailAviso2Dias({ nombre: e.nombre, fechaExpiracionTrial: e.fecha_expiracion_trial });
      await enviarEmailAlerta({ to: e.email, subject, html });
      await marcarAviso2DiasEnviado(e.empresa_id);
    } catch (err) {
      console.error(`[avisos-trial] Error avisando "2 días antes" a empresa ${e.empresa_id}:`, err.message);
    }
  }
}

async function avisarVencido() {
  const empresas = await listarEmpresasParaAvisoVencido();
  if (empresas.length === 0) {
    console.log('[avisos-trial] Sin avisos de "vencido" pendientes.');
    return;
  }

  console.log(`[avisos-trial] ${empresas.length} avisos de "vencido" para enviar...`);
  for (const e of empresas) {
    try {
      const { subject, html } = armarEmailTrialVencido({ nombre: e.nombre });
      await enviarEmailAlerta({ to: e.email, subject, html });
      await marcarAvisoVencidoEnviado(e.empresa_id);
    } catch (err) {
      console.error(`[avisos-trial] Error avisando "vencido" a empresa ${e.empresa_id}:`, err.message);
    }
  }
}

async function avisarAcceso2DiasAntes() {
  const empresas = await listarEmpresasParaAvisoAcceso2Dias();
  if (empresas.length === 0) {
    console.log('[avisos-trial] Sin avisos de "acceso por cortarse" pendientes.');
    return;
  }

  console.log(`[avisos-trial] ${empresas.length} avisos de "acceso por cortarse" para enviar...`);
  for (const e of empresas) {
    try {
      const { subject, html } = armarEmailAvisoAcceso2Dias({ nombre: e.nombre, accesoHasta: e.acceso_hasta });
      await enviarEmailAlerta({ to: e.email, subject, html });
      await marcarAvisoAcceso2DiasEnviado(e.empresa_id);
    } catch (err) {
      console.error(`[avisos-trial] Error avisando "acceso por cortarse" a empresa ${e.empresa_id}:`, err.message);
    }
  }
}

/**
 * A diferencia de los otros 3 avisos (que solo notifican), este además
 * CORTA el acceso de verdad — marcarAvisoAccesoTerminadoYCortarAcceso pasa
 * estado_pago a 'pendiente' en la misma operación, que es lo que
 * requireEmpresaActiva.middleware.js ya usa para bloquear. El middleware
 * también corta un poco antes por su cuenta (mirando acceso_hasta
 * directamente) para no depender de que este job ya haya corrido hoy — ver
 * el comentario ahí. Este job es el que deja todo consistente una vez al día
 * y el que manda el correo.
 */
async function avisarYCortarAcceso() {
  const empresas = await listarEmpresasParaCorteDeAcceso();
  if (empresas.length === 0) {
    console.log('[avisos-trial] Sin cortes de acceso pendientes.');
    return;
  }

  console.log(`[avisos-trial] ${empresas.length} empresas para cortar el acceso...`);
  for (const e of empresas) {
    try {
      const { subject, html } = armarEmailAccesoTerminado({ nombre: e.nombre });
      await enviarEmailAlerta({ to: e.email, subject, html });
      await marcarAvisoAccesoTerminadoYCortarAcceso(e.empresa_id);
    } catch (err) {
      console.error(`[avisos-trial] Error cortando acceso de empresa ${e.empresa_id}:`, err.message);
    }
  }
}

module.exports = { correrAvisosTrial };
