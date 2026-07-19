/**
 * Cliente para la API de Suscripciones (Preapproval) de MercadoPago.
 * Si no hay MERCADOPAGO_ACCESS_TOKEN configurado, simula la respuesta —
 * mismo patrón que email.service.js / telegram.service.js — para poder
 * probar el flujo completo en local sin tener cuenta de MercadoPago todavía.
 *
 * IMPORTANTE: la forma exacta del payload de /preapproval está armada según
 * la documentación pública de MercadoPago, pero no la hemos probado contra
 * una cuenta real todavía — es muy probable que haya que ajustar algún campo
 * la primera vez que se pruebe con credenciales de verdad (sandbox).
 */
const MP_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mercadoalerta.cl';
const PREAPPROVAL_URL = 'https://api.mercadopago.com/preapproval';

/**
 * Crea una suscripción (cobro recurrente mensual). Devuelve { id, init_point },
 * donde init_point es la URL de checkout a la que hay que redirigir al usuario
 * para que autorice el cargo con su tarjeta.
 */
async function crearSuscripcion({ emailPagador, monto, referenciaExterna, motivo }) {
  if (!MP_ACCESS_TOKEN) {
    console.log('\n💳 [mercadopago.service] MERCADOPAGO_ACCESS_TOKEN no configurado — modo simulación:');
    console.log(`   Referencia: ${referenciaExterna}`);
    console.log(`   Monto: $${monto}`);
    console.log(`   Email pagador: ${emailPagador}`);
    return {
      simulado: true,
      id: `simulado-${referenciaExterna}`,
      init_point: `${FRONTEND_URL}/simular-pago.html?referencia=${referenciaExterna}`,
    };
  }

  const response = await fetch(PREAPPROVAL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // MercadoPago exige reason <= 60 caracteres — con nombre de empresa
      // largo, el motivo armado en empresas.routes.js/auth.routes.js
      // (que incluye el nombre) fácilmente se pasa. Se trunca acá, en un
      // solo lugar, para que ningún llamador tenga que preocuparse de esto.
      reason: motivo.length > 60 ? `${motivo.slice(0, 57)}...` : motivo,
      external_reference: referenciaExterna,
      payer_email: emailPagador,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: monto,
        currency_id: 'CLP',
      },
      back_url: `${FRONTEND_URL}/pago-confirmado.html`,
      status: 'pending',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Error creando suscripción en MercadoPago: HTTP ${response.status} — ${errorBody}`);
  }

  return response.json();
}

/**
 * Consulta el estado real de una suscripción — se usa desde el webhook
 * para confirmar el pago antes de activar la empresa (nunca confiar
 * ciegamente en el contenido de la notificación del webhook).
 */
async function consultarSuscripcion(preapprovalId) {
  if (!MP_ACCESS_TOKEN) {
    return { status: 'authorized', simulado: true };
  }

  const response = await fetch(`${PREAPPROVAL_URL}/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });

  if (!response.ok) {
    throw new Error(`Error consultando suscripción ${preapprovalId}: HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Cancela una suscripción — PUT al mismo endpoint que consultarSuscripcion,
 * cambiando el status a 'cancelled'. Documentado en:
 * https://www.mercadopago.com.ar/developers/en/reference/online-payments/subscriptions/update-preapproval/put
 *
 * OJO: según la documentación de soporte al usuario final de MercadoPago,
 * cancelar NO corta el acceso al instante — el pagador sigue "activo" hasta
 * la fecha ya pagada, y recién después deja de renovar. Acá solo se informa
 * el cambio de estado a MercadoPago; la lógica de cuándo bloquear el acceso
 * en nuestro lado (empresas.estado_pago) es responsabilidad de quien llame
 * a esta función — no se toca sola.
 *
 * No se usa todavía en ningún flujo (el trabajo actual es sobre expiración
 * de trial, no cancelación) — queda lista para cuando se construya esa
 * pantalla en el dashboard ("cancelar mi suscripción").
 */
async function cancelarSuscripcion(preapprovalId) {
  if (!MP_ACCESS_TOKEN) {
    console.log(`\n💳 [mercadopago.service] MERCADOPAGO_ACCESS_TOKEN no configurado — modo simulación: se "cancelaría" ${preapprovalId}`);
    return { id: preapprovalId, status: 'cancelled', simulado: true };
  }

  const response = await fetch(`${PREAPPROVAL_URL}/${preapprovalId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'cancelled' }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Error cancelando suscripción ${preapprovalId}: HTTP ${response.status} — ${errorBody}`);
  }

  return response.json();
}

/**
 * Últimos 4 dígitos + marca de la tarjeta del cobro más reciente de una
 * suscripción — para mostrar "Tarjeta terminada en 1234" en la pantalla y el
 * correo de confirmación. Encadena DOS llamadas porque el objeto de
 * suscripción (preapproval) no trae esto — solo el objeto de PAGO sí:
 *
 *   1. GET /preapproval/{id}/authorized_payments — trae los cobros ya
 *      hechos de esta suscripción (el "historial de facturas"), tomamos el
 *      más reciente.
 *   2. GET /v1/payments/{payment_id} — ESE sí trae card.last_four_digits.
 *
 * Devuelve null si cualquiera de los dos pasos falla o no trae datos — se
 * prioriza no romper la pantalla de confirmación por esto: "solo si es
 * posible" mostrar la tarjeta, si no, se omite esa línea.
 */
async function consultarUltimoPagoAutorizado(preapprovalId) {
  if (!MP_ACCESS_TOKEN) {
    return { simulado: true, ultimosDigitos: '4242', marca: 'visa' };
  }

  try {
    const responsePagos = await fetch(`${PREAPPROVAL_URL}/${preapprovalId}/authorized_payments`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    if (!responsePagos.ok) return null;

    const pagos = await responsePagos.json();
    const lista = Array.isArray(pagos) ? pagos : pagos.results;
    const ultimoPago = lista && lista.length > 0 ? lista[lista.length - 1] : null;
    if (!ultimoPago?.id) return null;

    const responseDetalle = await fetch(`https://api.mercadopago.com/v1/payments/${ultimoPago.id}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    if (!responseDetalle.ok) return null;

    const detalle = await responseDetalle.json();
    if (!detalle.card?.last_four_digits) return null;

    return {
      simulado: false,
      ultimosDigitos: detalle.card.last_four_digits,
      marca: detalle.payment_method_id || null,
    };
  } catch (err) {
    console.error(`[mercadopago.service] No se pudo obtener la tarjeta del último pago de ${preapprovalId}:`, err.message);
    return null;
  }
}

module.exports = { crearSuscripcion, consultarSuscripcion, cancelarSuscripcion, consultarUltimoPagoAutorizado };
