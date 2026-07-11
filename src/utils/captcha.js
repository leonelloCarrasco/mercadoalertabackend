/**
 * Verifica el token de Cloudflare Turnstile ("soy humano") contra el endpoint
 * oficial de siteverify. Se eligió Turnstile por ser el más simple de integrar:
 * no requiere cuenta de Google, un solo <script> + un <div> en el HTML, y el
 * checkeo del lado del servidor es un único POST.
 *
 * Mismo patrón que email.service.js / mercadopago.service.js: si no hay
 * secret key configurada, se omite la verificación (deja pasar) para poder
 * probar el resto del flujo en local sin depender de credenciales de Cloudflare.
 */
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verificarCaptcha(token, remoteIp) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    console.warn('⚠️  TURNSTILE_SECRET_KEY no configurada en .env — se omite la verificación de "soy humano".');
    return true;
  }

  if (!token) {
    return false;
  }

  try {
    const body = new URLSearchParams({ secret: secretKey, response: token });
    if (remoteIp) body.append('remoteip', remoteIp);

    const response = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body });
    const data = await response.json();
    return data.success === true;
  } catch (err) {
    console.error('Error verificando captcha en Turnstile:', err.message);
    // Ante un error de red, fallamos "cerrado" (rechazar) — al contrario que
    // la validación de RUT, acá preferimos bloquear antes que dejar pasar
    // un posible bot si Cloudflare no responde.
    return false;
  }
}

module.exports = { verificarCaptcha };
