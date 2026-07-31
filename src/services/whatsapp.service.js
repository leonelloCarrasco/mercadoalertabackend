/**
 * Envío de mensajes por WhatsApp Cloud API (Meta), directo — sin BSP
 * intermediario.
 *
 * Hay dos modos de envío, según quién inicia la conversación:
 *
 *  1. El NEGOCIO inicia (ej. el resumen de alertas) — tiene que ser una
 *     plantilla pre-aprobada por Meta en Business Manager, con variables
 *     numeradas ({{1}}, {{2}}...), sin HTML ni links libres. Requiere tener
 *     creada y APROBADA (puede tardar horas/días la primera vez) la
 *     plantilla "resumen de alerta" (nombre configurable via
 *     WHATSAPP_TEMPLATE_ALERTA_RESUMEN, default "alerta_resumen"):
 *     cuerpo sugerido: "Tienes {{1}} nueva(s) oportunidad(es) que coinciden
 *     con tus alertas en MercadoAlerta. Revisa tu panel para ver el detalle."
 *
 *  2. El USUARIO inicia (ej. vincular WhatsApp — ver whatsapp.routes.js) —
 *     eso abre una ventana de 24hs donde SÍ se puede mandar texto libre sin
 *     ninguna plantilla. Se usa para la confirmación de vinculación, en vez
 *     de una plantilla de código de verificación (que Meta termina
 *     rechazando muy seguido por parecer un mensaje de autenticación real,
 *     ver la discusión completa en el historial del proyecto).
 *
 * Si WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID no están configurados
 * (por ejemplo, mientras el número de Meta Business todavía no está
 * verificado), se loguea en consola en vez de mandar — mismo criterio que
 * el resto de los canales (email/Telegram) cuando faltan credenciales.
 */
async function enviarPlantillaWhatsapp(numero, nombrePlantilla, variables = []) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const idioma = process.env.WHATSAPP_TEMPLATE_IDIOMA || 'es';

  if (!token || !phoneNumberId) {
    console.log(`\n🟢 [whatsapp.service] WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID no configurados — modo simulación:`);
    console.log(`   Para: ${numero} | Plantilla: ${nombrePlantilla} | Variables:`, variables);
    return { simulado: true };
  }

  if (!numero) {
    console.log('[whatsapp.service] Usuario sin whatsapp_numero verificado — se omite el envío.');
    return { omitido: true };
  }

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: numero,
      type: 'template',
      template: {
        name: nombrePlantilla,
        language: { code: idioma },
        components: variables.length > 0
          ? [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: String(v) })) }]
          : [],
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    // Errores típicos acá: 132001 (plantilla no existe/no aprobada todavía),
    // 131047 (fuera de la ventana de 24hs — no aplica a plantillas),
    // 131026 (el número no tiene WhatsApp).
    throw new Error(`Error enviando WhatsApp: HTTP ${response.status} — ${errorBody}`);
  }

  return response.json();
}

/**
 * Mensaje resumen (no el detalle de cada oportunidad, a diferencia de
 * Telegram) — decisión tomada a propósito dado que las plantillas de
 * WhatsApp no admiten armar una lista dinámica de N ítems con links.
 */
async function enviarResumenAlertaWhatsapp(numero, cantidadNuevas) {
  const plantilla = process.env.WHATSAPP_TEMPLATE_ALERTA_RESUMEN || 'alerta_resumen';
  return enviarPlantillaWhatsapp(numero, plantilla, [String(cantidadNuevas)]);
}

/**
 * Texto libre, SIN plantilla — solo válido dentro de las 24hs después de
 * que el número de destino le escribió primero a nuestro WhatsApp (por eso
 * se usa únicamente para responder dentro del webhook de vinculación, nunca
 * para iniciar una conversación).
 */
async function enviarMensajeWhatsappCrudo(numero, texto) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.log(`\n🟢 [whatsapp.service] WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID no configurados — modo simulación:`);
    console.log(`   Para: ${numero} | Texto: ${texto}`);
    return { simulado: true };
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: numero, type: 'text', text: { body: texto } }),
    });
    if (!response.ok) {
      console.error('[whatsapp.service] Error mandando texto libre:', await response.text());
    }
  } catch (err) {
    console.error('[whatsapp.service] Error mandando texto libre:', err.message);
  }
}

module.exports = { enviarPlantillaWhatsapp, enviarResumenAlertaWhatsapp, enviarMensajeWhatsappCrudo };
