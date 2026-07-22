const crypto = require('crypto');

/**
 * Verifica que una notificación de webhook realmente venga de MercadoPago,
 * y no de cualquiera que le pegue a la URL adivinándola (ver conversación
 * de seguridad — el código YA no confía ciegamente en el payload, siempre
 * re-consulta el estado real antes de activar nada, pero esto agrega una
 * capa más: rechazar de entrada lo que ni siquiera tiene la firma correcta,
 * en vez de dejar que llegue a gastar una consulta a la API/base).
 *
 * Mecanismo documentado por MercadoPago: el header `x-signature` trae
 * `ts=<timestamp>,v1=<firma>` — se arma un texto con el id del recurso, el
 * x-request-id, y el ts, se calcula HMAC-SHA256 de ese texto con la clave
 * secreta (la que se revela en el panel: Tus integraciones → Webhooks →
 * Configurar notificación — es DISTINTA del Access Token), y se compara
 * contra el v1 recibido.
 *
 * Devuelve:
 *  - null  → no se pudo validar porque MERCADOPAGO_WEBHOOK_SECRET no está
 *            configurada todavía (no bloquea nada, mismo criterio que el
 *            resto de las integraciones de esta app cuando falta una config
 *            opcional — no romper lo que ya funciona).
 *  - true  → firma válida.
 *  - false → firma inválida, o faltan los headers que debería traer una
 *            notificación real.
 */
function verificarFirmaWebhook(req) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return null;

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  if (!xSignature) return false;

  const partes = {};
  xSignature.split(',').forEach((parte) => {
    const [clave, valor] = parte.split('=');
    if (clave && valor !== undefined) partes[clave.trim()] = valor.trim();
  });

  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) return false;

  // El id del recurso viene en la URL como query param `data.id` (así lo
  // manda MercadoPago en la URL del webhook) — con fallback al body, por si
  // acaso, aunque el documentado es el de la URL.
  const dataId = req.query?.['data.id'] || req.query?.id || req.body?.data?.id || '';

  // El manifest se arma SOLO con las partes presentes, en este orden exacto
  // (documentado) — si faltara x-request-id, esa parte se omite entera, no
  // se deja vacía.
  let manifest = `id:${dataId};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  manifest += `ts:${ts};`;

  const firmaCalculada = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  try {
    // Comparación a tiempo constante — no se usa === directo para no filtrar
    // por timing cuánto de la firma coincide.
    return crypto.timingSafeEqual(Buffer.from(firmaCalculada, 'hex'), Buffer.from(v1, 'hex'));
  } catch {
    // Buffer.from falla si v1 no es hex válido, o si el largo no calza —
    // en cualquiera de esos casos, la firma es inválida.
    return false;
  }
}

module.exports = { verificarFirmaWebhook };
