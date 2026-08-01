/**
 * Envío de mensajes por WhatsApp vía YCloud (BSP — Business Solution
 * Provider sobre WhatsApp Cloud API). Se usa YCloud en vez de integrar
 * directo con Meta porque:
 *  1. Meta directo trababa mucho la aprobación de plantillas de
 *     autenticación (ver historial del proyecto).
 *  2. Coexistencia (mantener la app de WhatsApp Business del celular activa
 *     junto con la API) requiere que quien conecta el número sea un "Tech
 *     Provider/Solution Partner" de Meta con Embedded Signup implementado —
 *     YCloud ya es ese socio, nosotros no.
 *
 * Dos modos de envío, según quién inicia la conversación (misma regla de
 * WhatsApp de siempre, YCloud no la cambia):
 *
 *  1. El NEGOCIO inicia (ej. el resumen de alertas) — plantilla
 *     pre-aprobada por Meta (la aprobación sigue siendo de Meta por debajo,
 *     YCloud es solo la capa de API/dashboard). Nombre configurable via
 *     WHATSAPP_TEMPLATE_ALERTA_RESUMEN, default "alerta_resumen".
 *
 *  2. El USUARIO inicia (vincular WhatsApp — ver whatsapp.routes.js) — texto
 *     libre sin plantilla, dentro de la ventana de 24hs.
 *
 * Si YCLOUD_API_KEY no está configurada, se loguea en consola en vez de
 * mandar — mismo criterio que el resto de los canales cuando faltan
 * credenciales.
 */
const YCLOUD_API_URL = 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly';

async function enviarPlantillaWhatsapp(numero, nombrePlantilla, variables = []) {
  const apiKey = process.env.YCLOUD_API_KEY;
  const numeroNegocio = process.env.YCLOUD_BUSINESS_NUMBER;
  const idioma = process.env.WHATSAPP_TEMPLATE_IDIOMA || 'es';

  if (!apiKey || !numeroNegocio) {
    console.log(`\n🟢 [whatsapp.service] YCLOUD_API_KEY/YCLOUD_BUSINESS_NUMBER no configurados — modo simulación:`);
    console.log(`   Para: ${numero} | Plantilla: ${nombrePlantilla} | Variables:`, variables);
    return { simulado: true };
  }

  if (!numero) {
    console.log('[whatsapp.service] Usuario sin whatsapp_numero verificado — se omite el envío.');
    return { omitido: true };
  }

  const response = await fetch(YCLOUD_API_URL, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: numeroNegocio,
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
    throw new Error(`Error enviando WhatsApp (YCloud): HTTP ${response.status} — ${await response.text()}`);
  }

  return response.json();
}

/**
 * Mensaje resumen (no el detalle de cada oportunidad) — decisión tomada a
 * propósito dado que las plantillas de WhatsApp no admiten armar una lista
 * dinámica de N ítems con links.
 *
 * La plantilla "alerta_resumen" recibe DOS variables:
 *   {{1}} = nombre de pila del usuario (sin apellido)
 *   {{2}} = cantidad y tipo de proceso ya armado como texto, ej. "una
 *           licitación", "2 compras ágiles", "5 licitaciones" — ver
 *           describirCantidadYTipo() en alerting.service.js, que es quien
 *           arma ese texto antes de llamar a esta función.
 */
async function enviarResumenAlertaWhatsapp(numero, nombre, descripcionCantidadTipo) {
  const plantilla = process.env.WHATSAPP_TEMPLATE_ALERTA_RESUMEN || 'alerta_resumen';
  return enviarPlantillaWhatsapp(numero, plantilla, [nombre, descripcionCantidadTipo]);
}

/**
 * Texto libre, SIN plantilla — solo válido dentro de las 24hs después de
 * que el número de destino le escribió primero a nuestro WhatsApp (por eso
 * se usa únicamente para responder dentro del webhook de vinculación).
 */
async function enviarMensajeWhatsappCrudo(numero, texto) {
  const apiKey = process.env.YCLOUD_API_KEY;
  const numeroNegocio = process.env.YCLOUD_BUSINESS_NUMBER;

  if (!apiKey || !numeroNegocio) {
    console.log(`\n🟢 [whatsapp.service] YCLOUD_API_KEY/YCLOUD_BUSINESS_NUMBER no configurados — modo simulación:`);
    console.log(`   Para: ${numero} | Texto: ${texto}`);
    return { simulado: true };
  }

  try {
    const response = await fetch(YCLOUD_API_URL, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: numeroNegocio, to: numero, type: 'text', text: { body: texto } }),
    });
    if (!response.ok) {
      console.error('[whatsapp.service] Error mandando texto libre (YCloud):', await response.text());
    }
  } catch (err) {
    console.error('[whatsapp.service] Error mandando texto libre (YCloud):', err.message);
  }
}

module.exports = { enviarPlantillaWhatsapp, enviarResumenAlertaWhatsapp, enviarMensajeWhatsappCrudo };
