const express = require('express');
const { consultarSuscripcion } = require('../services/mercadopago.service');
const {
  buscarEmpresaPorSuscripcion,
  buscarEmpresaPorId,
  activarPagoEmpresa,
} = require('../db/empresas.queries');
const { requireAdminKey } = require('../middleware/admin.middleware');

const router = express.Router();

/**
 * POST /api/pagos/webhook — MercadoPago llama acá cuando cambia el estado
 * de una suscripción. NUNCA confiamos ciegamente en el contenido de la
 * notificación (podría ser falsificada) — siempre volvemos a consultar el
 * estado real contra la API de MercadoPago antes de activar nada.
 *
 * NOTA: esto requiere una URL pública (no localhost) para que MercadoPago
 * pueda alcanzarla — no se puede probar de punta a punta hasta desplegar
 * el backend a un dominio real, o usar un túnel tipo ngrok mientras tanto.
 */
router.post('/webhook', async (req, res) => {
  try {
    const preapprovalId = req.body?.data?.id || req.query?.id;

    if (!preapprovalId) {
      return res.sendStatus(400);
    }

    const suscripcion = await consultarSuscripcion(preapprovalId);
    const empresa = await buscarEmpresaPorSuscripcion(preapprovalId);

    if (!empresa) {
      console.warn(`[pagos.webhook] No se encontró empresa para la suscripción ${preapprovalId}`);
      return res.sendStatus(200); // igual respondemos 200 para que MP no reintente indefinidamente
    }

    if (suscripcion.status === 'authorized') {
      await activarPagoEmpresa(empresa.id);
      console.log(`[pagos.webhook] Empresa ${empresa.id} activada tras confirmar pago.`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[pagos.webhook] Error procesando notificación:', err);
    res.sendStatus(500);
  }
});

/**
 * POST /api/pagos/simular/:empresaId — SOLO PARA DESARROLLO LOCAL.
 * Activa el pago de una empresa a mano, sin pasar por MercadoPago —
 * necesario porque el webhook real no puede alcanzarnos en localhost.
 * Protegido igual que /api/admin/*, con la misma API key.
 */
router.post('/simular/:empresaId', requireAdminKey, async (req, res) => {
  try {
    const empresa = await buscarEmpresaPorId(req.params.empresaId);
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    await activarPagoEmpresa(empresa.id);
    res.json({ mensaje: `Pago simulado: empresa ${empresa.id} (${empresa.nombre_empresa}) activada.` });
  } catch (err) {
    console.error('Error en /pagos/simular:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
