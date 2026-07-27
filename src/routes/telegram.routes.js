const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth.middleware');
const { telegramLinkLimiter } = require('../middleware/rate-limit.middleware');
const {
  crearTokenTelegramLink,
  buscarTokenTelegramLinkVigente,
  marcarTokenResetUsado,
  invalidarTokensTelegramLinkDeUsuario,
} = require('../db/password-reset.queries');
const { vincularTelegram, desvincularTelegram, obtenerEstadoTelegram } = require('../db/queries');

const router = express.Router();

const TELEGRAM_LINK_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 min — es solo para el ida y vuelta de abrir Telegram y tocar "Iniciar"

function generarTokenAleatorio() {
  return crypto.randomBytes(32).toString('hex');
}

function hashearToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// POST /api/telegram/generar-link — usuario logueado pide su link de
// vinculación. Invalida cualquier link anterior sin usar (mismo criterio que
// el reset de contraseña) para que no queden varios "vivos" en simultáneo.
router.post('/generar-link', requireAuth, telegramLinkLimiter, async (req, res) => {
  try {
    await invalidarTokensTelegramLinkDeUsuario(req.userId);

    const token = generarTokenAleatorio();
    const tokenHash = hashearToken(token);
    const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TOKEN_TTL_MS);
    await crearTokenTelegramLink(req.userId, tokenHash, expiresAt);

    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    if (!botUsername) {
      console.error('⚠️  TELEGRAM_BOT_USERNAME no configurada en .env — no se puede armar el link de vinculación.');
      return res.status(503).json({ error: 'La vinculación con Telegram no está disponible en este momento.' });
    }

    res.json({
      link: `https://t.me/${botUsername}?start=${token}`,
      expiraEn: TELEGRAM_LINK_TOKEN_TTL_MS / 1000,
    });
  } catch (err) {
    console.error('[telegram.generar-link] Error:', err);
    res.status(500).json({ error: 'Error al generar el link de vinculación' });
  }
});

// GET /api/telegram/estado — para que el frontend sepa si ya está vinculado
// (usado tanto al cargar Mi Perfil como para hacer polling después de abrir
// el link, ya que la vinculación la completa Telegram llamando al webhook,
// no el propio navegador del usuario).
router.get('/estado', requireAuth, async (req, res) => {
  try {
    const estado = await obtenerEstadoTelegram(req.userId);
    res.json(estado);
  } catch (err) {
    console.error('[telegram.estado] Error:', err);
    res.status(500).json({ error: 'Error al consultar el estado de Telegram' });
  }
});

// DELETE /api/telegram/vincular — desvincular.
router.delete('/vincular', requireAuth, async (req, res) => {
  try {
    await desvincularTelegram(req.userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[telegram.desvincular] Error:', err);
    res.status(500).json({ error: 'Error al desvincular Telegram' });
  }
});

// POST /api/telegram/webhook — Telegram le pega a esto cada vez que el bot
// recibe un mensaje. NO tiene requireAuth (quien llama es Telegram, no un
// usuario logueado de la app) — la protección acá es el secret_token que
// Telegram reenvía en un header propio, configurado una sola vez al dar de
// alta el webhook (ver setup en el README / notas de despliegue). Sin ese
// secret configurado, cualquiera que adivine la URL podría mandar updates
// falsos y vincular chat_ids arbitrarios a tokens robados — por eso, si
// TELEGRAM_WEBHOOK_SECRET no está configurado, el webhook rechaza todo en
// vez de aceptar sin verificar.
router.post('/webhook', async (req, res) => {
  const secretEsperado = process.env.TELEGRAM_WEBHOOK_SECRET;
  const secretRecibido = req.headers['x-telegram-bot-api-secret-token'];

  if (!secretEsperado) {
    console.error('⚠️  TELEGRAM_WEBHOOK_SECRET no configurada — el webhook de Telegram queda deshabilitado por seguridad.');
    return res.status(503).end();
  }
  if (secretRecibido !== secretEsperado) {
    return res.status(401).end();
  }

  // Siempre 200 de acá en adelante — Telegram reintenta agresivamente updates
  // que no confirmes con 200, y un error nuestro no debería generar reintentos
  // infinitos de un mensaje que de todas formas no vamos a poder procesar mejor
  // la segunda vez.
  try {
    const texto = req.body?.message?.text || '';
    const chatId = req.body?.message?.chat?.id;
    const match = texto.match(/^\/start\s+([a-f0-9]{64})$/);

    if (match && chatId) {
      const token = match[1];
      const tokenHash = hashearToken(token);
      const tokenInfo = await buscarTokenTelegramLinkVigente(tokenHash);

      if (tokenInfo) {
        await marcarTokenResetUsado(tokenInfo.id);
        await vincularTelegram(tokenInfo.user_id, String(chatId));
        await enviarMensajeTelegramCrudo(chatId, '✅ ¡Listo! Tu cuenta de MercadoAlerta quedó vinculada a este chat. Ya vas a empezar a recibir tus alertas por acá.');
      } else {
        await enviarMensajeTelegramCrudo(chatId, '⚠️ Este link de vinculación venció o ya fue usado. Volvé a MercadoAlerta y generá uno nuevo desde Mi Perfil.');
      }
    }
  } catch (err) {
    console.error('[telegram.webhook] Error procesando update:', err);
  }

  res.status(200).end();
});

/**
 * Respuesta directa del bot (confirmación/error de vinculación) — no es una
 * "alerta" (eso vive en telegram.service.js / enviarTelegramAlerta), así que
 * se mantiene separado acá en vez de mezclar responsabilidades.
 */
async function enviarMensajeTelegramCrudo(chatId, texto) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto }),
    });
  } catch (err) {
    console.error('[telegram.webhook] Error mandando confirmación:', err);
  }
}

module.exports = router;
