const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { contactoAyudaLimiter } = require('../middleware/rate-limit.middleware');
const { crearMensajeSoporte } = require('../db/mensajes-soporte.queries');
const { buscarUsuarioPorId } = require('../db/queries');
const { enviarEmailAlerta, envolverPlantillaEmail } = require('../services/email.service');

const router = express.Router();
router.use(requireAuth);

/**
 * POST /api/soporte/contacto — formulario de contacto del panel de Ayuda.
 * Solo para usuarios logueados (a diferencia de forgot-password/register,
 * que son anónimos) — por eso usa requireAuth pero NO requireEmpresaActiva:
 * alguien con el pago pendiente o el trial vencido igual tiene que poder
 * escribir a soporte para resolver justamente eso, así que no se puede
 * bloquear acá con el mismo criterio que el resto del dashboard.
 *
 * El mensaje SIEMPRE se guarda en la base (mensajes_soporte) — el envío de
 * correo es un paso adicional, mejor esfuerzo: si SUPPORT_EMAIL todavía no
 * está configurada (el destino real no estaba definido al momento de
 * construir esto), o si el envío falla por lo que sea, el mensaje de todas
 * formas no se pierde y se puede revisar directo en la base.
 */
router.post('/contacto', contactoAyudaLimiter, async (req, res) => {
  const { asunto, mensaje } = req.body;

  if (!asunto?.trim() || !mensaje?.trim()) {
    return res.status(400).json({ error: 'Completa el asunto y el mensaje.' });
  }

  try {
    const usuario = await buscarUsuarioPorId(req.userId);
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    let emailEnviado = false;
    const supportEmail = process.env.SUPPORT_EMAIL;

    if (supportEmail) {
      try {
        const contenidoHtml = `
          <h2>📩 Nuevo mensaje de contacto</h2>
          <p><strong>De:</strong> ${usuario.nombre || 'Usuario'} (${usuario.email})</p>
          <p><strong>Asunto:</strong> ${asunto.trim()}</p>
          <p>${mensaje.trim().replace(/\n/g, '<br>')}</p>
        `;
        await enviarEmailAlerta({
          to: supportEmail,
          subject: `[Ayuda MercadoAlerta] ${asunto.trim()}`,
          html: envolverPlantillaEmail({ contenidoHtml }),
          replyTo: usuario.email,
        });
        emailEnviado = true;
      } catch (err) {
        // No se corta el flujo por esto — el mensaje igual queda guardado
        // en la base más abajo, aunque el correo haya fallado.
        console.error('[soporte.contacto] Falló el envío de correo (el mensaje se guarda igual):', err.message);
      }
    } else {
      console.log('[soporte.contacto] SUPPORT_EMAIL no configurada todavía — el mensaje queda guardado en la base, sin notificación por correo.');
    }

    await crearMensajeSoporte({
      userId: req.userId,
      email: usuario.email,
      nombre: usuario.nombre,
      asunto: asunto.trim(),
      mensaje: mensaje.trim(),
      emailEnviado,
    });

    res.json({ enviado: true });
  } catch (err) {
    console.error('[soporte.contacto] Error:', err);
    res.status(500).json({ error: 'No pudimos enviar tu mensaje. Intenta de nuevo en un momento.' });
  }
});

module.exports = router;
