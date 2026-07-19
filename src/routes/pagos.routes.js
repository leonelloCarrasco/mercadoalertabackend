const express = require('express');
const { consultarSuscripcion, consultarUltimoPagoAutorizado } = require('../services/mercadopago.service');
const { enviarEmailAlerta, armarEmailConfirmacionSuscripcion } = require('../services/email.service');
const {
  buscarEmpresaPorSuscripcion,
  buscarEmpresaPorId,
  activarPagoEmpresa,
} = require('../db/empresas.queries');
const { buscarUsuarioPorEmpresaId, buscarUsuarioPorId } = require('../db/queries');
const { requireAuth } = require('../middleware/auth.middleware');
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
    // MercadoPago manda notificaciones de varios tipos al mismo webhook si
    // se activa más de un evento en el panel (ej. "Pagos" además de "Planes
    // y suscripciones") — acá solo nos importan las de tipo
    // 'subscription_preapproval' (ver ejemplo real del simulador del panel:
    // { type: "subscription_preapproval", entity: "preapproval", data: { id: "..." } }).
    // En cualquier otro tipo (ej. "payment"), data.id es un ID de PAGO, no de
    // suscripción — tratarlo como preapproval_id rompería consultarSuscripcion.
    // Se responde 200 igual para que MercadoPago no reintente de más.
    const tipo = req.body?.type || req.body?.topic;
    if (tipo && tipo !== 'subscription_preapproval') {
      console.log(`[pagos.webhook] Notificación de tipo '${tipo}' ignorada (solo procesamos 'subscription_preapproval').`);
      return res.sendStatus(200);
    }

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

      // El correo no debe tirar abajo la confirmación del webhook si falla
      // (ej. Resend caído) — MercadoPago reintenta el webhook si no
      // devolvemos 200, y no queremos reintentar SOLO porque el correo falló.
      try {
        const usuario = await buscarUsuarioPorEmpresaId(empresa.id);
        const tarjeta = await consultarUltimoPagoAutorizado(preapprovalId);
        const { subject, html } = armarEmailConfirmacionSuscripcion({
          nombre: usuario?.nombre,
          plan: empresa.plan,
          monto: empresa.monto_mensual,
          tarjeta,
        });
        await enviarEmailAlerta({ to: usuario.email, subject, html });
      } catch (errCorreo) {
        console.error(`[pagos.webhook] Empresa ${empresa.id} activada, pero falló el correo de confirmación:`, errCorreo.message);
      }
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

/**
 * GET /api/pagos/mi-suscripcion — usado por pago-confirmado.html para
 * mostrar el detalle real de la transacción (plan, monto, tarjeta) del
 * usuario que la está mirando, en vez del mensaje genérico de antes.
 *
 * A propósito NO depende de ningún parámetro que venga en la URL de vuelta
 * de MercadoPago (ej. ?preapproval_id=...) — la documentación pública no
 * confirma con certeza qué parámetros agrega exactamente el checkout de
 * SUSCRIPCIÓN al back_url (a diferencia de Checkout Pro, que sí lo
 * documenta bien). En cambio, se apoya en la sesión ya iniciada del usuario
 * (mismo token que usa el resto del dashboard) y en
 * empresas.mercadopago_subscription_id, que ya guardamos nosotros mismos al
 * crear la suscripción (ver POST /api/empresas/:id/upgrade) — más simple y
 * más seguro (nadie puede ver el pago de otra empresa adivinando un ID).
 */
router.get('/mi-suscripcion', requireAuth, async (req, res) => {
  try {
    const usuario = await buscarUsuarioPorId(req.userId);
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const empresa = await buscarEmpresaPorId(usuario.empresa_id);
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    let estadoSuscripcion = null;
    let tarjeta = null;
    if (empresa.mercadopago_subscription_id) {
      const suscripcion = await consultarSuscripcion(empresa.mercadopago_subscription_id);
      estadoSuscripcion = suscripcion.status;
      tarjeta = await consultarUltimoPagoAutorizado(empresa.mercadopago_subscription_id);
    }

    res.json({
      plan: empresa.plan,
      monto: empresa.monto_mensual,
      estadoPago: empresa.estado_pago,
      estadoSuscripcion,
      tarjeta,
    });
  } catch (err) {
    console.error('[pagos.mi-suscripcion] Error:', err);
    res.status(500).json({ error: 'Error al consultar el detalle del pago' });
  }
});

module.exports = router;
