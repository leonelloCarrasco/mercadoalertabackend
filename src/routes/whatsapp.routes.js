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

const CODIGO_TTL_MS = 15 * 60 * 1000; // 15 min — igual que el link de Telegram, solo para el ida y vuelta de mandar el WhatsApp

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

// POST /api/whatsapp/generar-codigo — el usuario NO manda su número acá (a
// diferencia del diseño anterior): lo vamos a aprender directo del mensaje
// de WhatsApp que nos mande, que es la fuente de verdad real de "a qué
// número tiene acceso esta persona".
router.post('/generar-codigo', requireAuth, requireEmpresaActiva, whatsappCodigoLimiter, async (req, res) => {
  try {
    if (!tieneWhatsappEnElPlan(req)) {
      return res.status(403).json({ error: 'WhatsApp está disponible en los planes Básico y Full.' });
    }

    const numeroNegocio = process.env.WHATSAPP_NUMERO_NEGOCIO;
    if (!numeroNegocio) {
      console.error('⚠️  WHATSAPP_NUMERO_NEGOCIO no configurada en .env — no se puede armar el link de vinculación.');
      return res.status(503).json({ error: 'La vinculación con WhatsApp no está disponible en este momento.' });
    }

    await invalidarTokensWhatsappVerificacionDeUsuario(req.userId);

    const codigo = generarCodigoNumerico();
    const codigoHash = hashearCodigo(codigo);
    const expiresAt = new Date(Date.now() + CODIGO_TTL_MS);
    await crearTokenWhatsappVerificacion(req.userId, codigoHash, expiresAt);

    const textoPrecargado = encodeURIComponent(`VINCULAR ${codigo}`);
    res.json({
      link: `https://wa.me/${numeroNegocio}?text=${textoPrecargado}`,
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

// GET /api/whatsapp/webhook — Meta llama a esto UNA VEZ, al dar de alta la
// URL del webhook en el dashboard de la app, para confirmar que la URL es
// tuya (le mandás de vuelta el mismo hub.challenge que te pasó, solo si el
// hub.verify_token coincide con el que vos mismo configuraste).
router.get('/webhook', (req, res) => {
  const modo = req.query['hub.mode'];
  const tokenRecibido = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (modo === 'subscribe' && tokenRecibido === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

/**
 * Verifica que el POST realmente venga de Meta — a diferencia de Telegram
 * (un header simple con un secreto fijo), WhatsApp firma el body completo
 * con HMAC-SHA256 usando el App Secret, mandado en el header
 * X-Hub-Signature-256 como "sha256=<hex>". Sin WHATSAPP_APP_SECRET
 * configurado, el webhook rechaza todo en vez de aceptar sin verificar
 * (mismo criterio que Telegram con su secret_token).
 */
function firmaValida(req) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const firmaRecibida = req.headers['x-hub-signature-256'];
  if (!appSecret || !firmaRecibida || !req.rawBody) return false;

  const firmaEsperada = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
  const bufRecibido = Buffer.from(firmaRecibida);
  const bufEsperado = Buffer.from(firmaEsperada);
  if (bufRecibido.length !== bufEsperado.length) return false;
  return crypto.timingSafeEqual(bufRecibido, bufEsperado);
}

// POST /api/whatsapp/webhook — Meta le pega a esto cada vez que alguien le
// escribe a nuestro número de WhatsApp. Acá es donde se completa la
// vinculación: si el mensaje entrante es "VINCULAR <código>" y ese código
// coincide con uno vigente, se vincula ese número al usuario dueño del
// código — el número queda registrado tal como lo manda Meta (el remitente
// real), no algo que el usuario tipeó a mano en el dashboard.
router.post('/webhook', async (req, res) => {
  if (!process.env.WHATSAPP_APP_SECRET) {
    console.error('⚠️  WHATSAPP_APP_SECRET no configurada — el webhook de WhatsApp queda deshabilitado por seguridad.');
    return res.status(503).end();
  }
  if (!firmaValida(req)) {
    return res.status(401).end();
  }

  // Siempre 200 de acá en adelante — Meta reintenta agresivamente si no
  // confirmás con 200, y un error nuestro no debería generar reintentos
  // infinitos de un mensaje que de todas formas no vamos a poder procesar
  // mejor la segunda vez.
  try {
    const mensaje = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const numero = mensaje?.from;
    const texto = mensaje?.text?.body || '';
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
  } catch (err) {
    console.error('[whatsapp.webhook] Error procesando mensaje:', err);
  }

  res.status(200).end();
});

module.exports = router;
