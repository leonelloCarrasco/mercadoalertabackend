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
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://dashboard.mercadoalerta.cl';
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
      reason: motivo,
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

module.exports = { crearSuscripcion, consultarSuscripcion };
