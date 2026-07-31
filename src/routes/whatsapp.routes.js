const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireEmpresaActiva } = require('../middleware/requireEmpresaActiva.middleware');
const { whatsappCodigoLimiter } = require('../middleware/rate-limit.middleware');
const {
  crearTokenWhatsappVerificacion,
  buscarTokenWhatsappVerificacionVigente,
  marcarTokenResetUsado,
  invalidarTokensWhatsappVerificacionDeUsuario,
} = require('../db/password-reset.queries');
const { vincularWhatsapp, desvincularWhatsapp, obtenerEstadoWhatsapp } = require('../db/queries');
const { enviarMensajeWhatsappCrudo } = require('../services/whatsapp.service');
const { obtenerPlan } = require('../utils/planes');

const router = express.Router();

const CODIGO_TTL_MS = 15 * 60 * 1000; // 15 min — igual que el link de Telegram

// WhatsApp es exclusivo de los planes cuya "mensajeria" lo incluye (hoy
// Básico y Full, ver planes.js).
function tieneWhatsappEnElPlan(req) {
  const plan = obtenerPlan(req.usuarioActual.plan);
  return Boolean(plan?.mensajeria?.includes('WhatsApp'));
}

function generarCodigoNumerico() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashearCodigo(codigo) {
  return crypto.createHash('sha256').update(codigo).digest('hex');
}

/** YCloud manda los números con "+" (ej. "+56912345678") — se guarda sin el "+", mismo formato que se usa en el resto del proyecto. */
function normalizarNumero(numero) {
  return String(numero || '').replace(/[^\d]/g, '');
}

// POST /api/whatsapp/generar-codigo — el usuario NO manda su número acá: lo
// aprendemos directo del mensaje de WhatsApp que nos mande, que es la
// fuente de verdad real de "a qué número tiene acceso esta persona".
router.post('/generar-codigo', requireAuth, requireEmpresaActiva, whatsappCodigoLimiter, async (req, res) => {
  try {
    if (!tieneWhatsappEnElPlan(req)) {
      return res.status(403).json({ error: 'WhatsApp está disponible en los planes Básico y Full.' });
    }

    const numeroNegocio = process.env.YCLOUD_BUSINESS_NUMBER;
    if (!numeroNegocio) {
      console.error('⚠️  YCLOUD_BUSINESS_NUMBER no configurada en .env — no se puede armar el link de vinculación.');
      return res.status(503).json({ error: 'La vinculación con WhatsApp no está disponible en este momento.' });
    }

    await invalidarTokensWhatsappVerificacionDeUsuario(req.userId);

    const codigo = generarCodigoNumerico();
    const codigoHash = hashearCodigo(codigo);
    const expiresAt = new Date(Date.now() + CODIGO_TTL_MS);
    await crearTokenWhatsappVerificacion(req.userId, codigoHash, expiresAt);

    const textoPrecargado = encodeURIComponent(`VINCULAR ${codigo}`);
    const numeroParaLink = numeroNegocio.replace(/[^\d]/g, ''); // wa.me no acepta el "+", aunque YCLOUD_BUSINESS_NUMBER sí lo lleva (lo necesita la API al mandar mensajes)
    res.json({
      link: `https://wa.me/${numeroParaLink}?text=${textoPrecargado}`,
      codigo,
      expiraEn: CODIGO_TTL_MS / 1000,
    });
  } catch (err) {
    console.error('[whatsapp.generar-codigo] Error:', err);
    res.status(500).json({ error: 'Error al generar el link de vinculación' });
  }
});

router.get('/estado', requireAuth, async (req, res) => {
  try {
    const estado = await obtenerEstadoWhatsapp(req.userId);
    res.json(estado);
  } catch (err) {
    console.error('[whatsapp.estado] Error:', err);
    res.status(500).json({ error: 'Error al consultar el estado de WhatsApp' });
  }
});

router.delete('/vincular', requireAuth, async (req, res) => {
  try {
    await desvincularWhatsapp(req.userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[whatsapp.desvincular] Error:', err);
    res.status(500).json({ error: 'Error al desvincular WhatsApp' });
  }
});

/**
 * Verifica que el POST realmente venga de YCloud — formato de firma propio
 * de YCloud (distinto al de Meta directo):
 *   Header: YCloud-Signature: t={timestamp},s={signature}
 *   signed_payload = "{timestamp}.{body_crudo}."
 *   firma_esperada = HMAC-SHA256(signed_payload, YCLOUD_WEBHOOK_SECRET)
 * Sin YCLOUD_WEBHOOK_SECRET configurado, el webhook rechaza todo en vez de
 * aceptar sin verificar.
 */
function firmaValida(req) {
  const secret = process.env.YCLOUD_WEBHOOK_SECRET;
  const header = req.headers['ycloud-signature'];
  if (!secret) {
    console.error('[whatsapp.webhook] YCLOUD_WEBHOOK_SECRET no está configurada.');
    return false;
  }
  if (!header) {
    console.error('[whatsapp.webhook] Falta el header YCloud-Signature en el request.');
    return false;
  }
  if (!req.rawBody) {
    console.error('[whatsapp.webhook] req.rawBody no está disponible — revisar que express.json() tenga el "verify" configurado en app.js.');
    return false;
  }

  // .trim() en cada parte — YCloud puede mandar "t=123, s=abc" (con espacio
  // después de la coma), y sin el trim el key quedaba " s" en vez de "s",
  // haciendo que partes.s diera undefined siempre.
  const partes = Object.fromEntries(
    header.split(',').map((p) => p.split('=').map((x) => x.trim()))
  );
  const timestamp = partes.t;
  const firmaRecibida = partes.s;
  if (!timestamp || !firmaRecibida) {
    console.error('[whatsapp.webhook] No se pudo extraer t/s del header. Header recibido:', header);
    return false;
  }

  const signedPayload = `${timestamp}.${req.rawBody.toString('utf8')}.`;
  const firmaEsperada = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  const bufRecibido = Buffer.from(firmaRecibida);
  const bufEsperado = Buffer.from(firmaEsperada);
  if (bufRecibido.length !== bufEsperado.length) {
    console.error(`[whatsapp.webhook] Largo de firma no coincide. Recibida: ${bufRecibido.length} caracteres, esperada: ${bufEsperado.length} caracteres.`);
    console.error('[whatsapp.webhook] Firma recibida:', firmaRecibida);
    console.error('[whatsapp.webhook] Firma esperada:', firmaEsperada);
    return false;
  }
  const coincide = crypto.timingSafeEqual(bufRecibido, bufEsperado);
  if (!coincide) {
    console.error('[whatsapp.webhook] Las firmas no coinciden.');
    console.error('[whatsapp.webhook] Firma recibida:', firmaRecibida);
    console.error('[whatsapp.webhook] Firma esperada:', firmaEsperada);
  }
  return coincide;
}

// POST /api/whatsapp/webhook — YCloud le pega a esto cada vez que alguien le
// escribe a nuestro número de WhatsApp (evento whatsapp.inbound_message.received).
// Acá es donde se completa la vinculación: si el mensaje entrante es
// "VINCULAR <código>" y ese código coincide con uno vigente, se vincula ese
// número al usuario dueño del código — el número queda registrado tal como
// lo manda YCloud (el remitente real), no algo que el usuario tipeó a mano.
router.post('/webhook', async (req, res) => {
  if (!process.env.YCLOUD_WEBHOOK_SECRET) {
    console.error('⚠️  YCLOUD_WEBHOOK_SECRET no configurada — el webhook de WhatsApp queda deshabilitado por seguridad.');
    return res.status(503).end();
  }
  if (!firmaValida(req)) {
    return res.status(401).end();
  }

  // Siempre 2xx de acá en adelante — YCloud reintenta agresivamente si no
  // confirmás con 2xx, y un error nuestro no debería generar reintentos
  // infinitos de un mensaje que de todas formas no vamos a poder procesar
  // mejor la segunda vez.
  try {
    if (req.body?.type === 'whatsapp.inbound_message.received') {
      const inbound = req.body.whatsappInboundMessage;
      const numero = normalizarNumero(inbound?.from);
      const texto = inbound?.text?.body || '';
      const match = texto.trim().match(/^vincular\s+(\d{6})$/i);

      if (match && numero) {
        const codigo = match[1];
        const codigoHash = hashearCodigo(codigo);
        const tokenInfo = await buscarTokenWhatsappVerificacionVigente(codigoHash);

        if (tokenInfo) {
          await marcarTokenResetUsado(tokenInfo.id);
          await vincularWhatsapp(tokenInfo.user_id, numero);
          await enviarMensajeWhatsappCrudo(numero, '✅ ¡Listo! Tu cuenta de MercadoAlerta quedó vinculada a este número. Ya vas a empezar a recibir tus alertas por acá.');
        } else {
          await enviarMensajeWhatsappCrudo(numero, '⚠️ Este código de vinculación venció o ya fue usado. Volvé a MercadoAlerta y generá uno nuevo desde Mi Perfil.');
        }
      }
    }
  } catch (err) {
    console.error('[whatsapp.webhook] Error procesando mensaje:', err);
  }

  res.status(200).end();
});

module.exports = router;
