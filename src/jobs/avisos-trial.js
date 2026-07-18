const {
  listarEmpresasParaAviso2Dias,
  listarEmpresasParaAvisoVencido,
  marcarAviso2DiasEnviado,
  marcarAvisoVencidoEnviado,
} = require('../db/empresas.queries');
const { enviarEmailAlerta, armarEmailAviso2Dias, armarEmailTrialVencido } = require('../services/email.service');

/**
 * Corre una vez al día. Es el único aviso PROACTIVO de vencimiento de
 * trial — el banner del dashboard (mostrarBannerPlan) solo avisa si el
 * usuario efectivamente abre la app, y el middleware (requireEmpresaActiva)
 * solo bloquea, no notifica. Sin este job, alguien que no vuelve a entrar
 * durante esos días nunca se entera de que su prueba venció.
 */
async function correrAvisosTrial() {
  await avisar2DiasAntes();
  await avisarVencido();
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

module.exports = { correrAvisosTrial };
