const { obtenerTramo } = require('../utils/tramos-licitacion');

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Envía un email de alerta. Si no hay RESEND_API_KEY configurada, imprime
 * el contenido en consola en vez de fallar — así se puede probar el flujo
 * completo de matching sin tener una cuenta de Resend todavía.
 */
async function enviarEmailAlerta({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.log('\n📧 [email.service] RESEND_API_KEY no configurada — modo simulación:');
    console.log(`   Para: ${to}`);
    console.log(`   Asunto: ${subject}`);
    console.log(`   Contenido: ${html.replace(/<[^>]+>/g, ' ').slice(0, 200)}...`);
    return { simulado: true };
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'MercadoAlerta <alertas@mercadoalerta.cl>',
      to,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Error enviando email vía Resend: HTTP ${response.status} — ${errorBody}`);
  }

  return response.json();
}

/**
 * Plantilla de email con la identidad de marca de MercadoAlerta — header con
 * degradé + logo, tarjeta de contenido blanca, caja destacada, botón de
 * acción, footer con disclaimer — con la paleta real del producto (fondo
 * oscuro #12172B, dorado #D4A72C — ver :root en css/dashboard.css) en vez
 * de un genérico celeste. Envuelve TODOS los emails transaccionales del
 * sistema (ver funciones armarEmail... / armarResumen... más abajo), así que
 * cualquier ajuste de estilo de marca se hace en un solo lugar.
 */
function envolverPlantillaEmail({ contenidoHtml }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MercadoAlerta</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f5f9; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
    .header { background: linear-gradient(135deg, #12172B 0%, #1B2140 100%); padding: 40px 30px; text-align: center; }
    .header h1 { color: #EDEEF5; margin: 0; font-size: 24px; font-weight: 700; }
    .header h1 .acento { color: #EDEEF5; font-family: 'IBM Plex Mono', monospace; }
    .content { padding: 40px 30px; }
    .content h2 { color: #12172B; font-size: 20px; margin: 0 0 16px 0; }
    .content p { color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0; }
    .highlight-box { background-color: #D4A72C15; border: 1px solid #D4A72C55; border-radius: 8px; padding: 20px; margin: 24px 0; }
    .highlight-box h3 { color: #92720f; margin: 0 0 8px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
    .highlight-box p { color: #12172B; font-size: 18px; font-weight: 700; margin: 0; }
    .button { display: inline-block; background-color: #D4A72C; color: #12172B !important; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 700; font-size: 14px; margin: 16px 0; }
    .footer { background: linear-gradient(135deg, #12172B 0%, #1B2140 100%); padding: 30px; text-align: center; border-top: 1px solid #e2e8f0; }
    .footer p { color: #94a3b8; font-size: 12px; margin: 0 0 8px 0; }
    .divider { height: 1px; background-color: #e2e8f0; margin: 24px 0; }
    .feature-list { list-style: none; padding: 0; margin: 16px 0; }
    .feature-list li { padding: 8px 0 8px 28px; position: relative; color: #475569; font-size: 14px; }
    .feature-list li::before { content: "✓"; position: absolute; left: 0; color: #3ECF8E; font-weight: bold; }
    .warning-box { background-color: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px 20px; margin: 24px 0; }
    .warning-box p { color: #92400e; margin: 0; font-size: 13px; }
    .item-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin-bottom: 14px; }
    .item-card a.item-title { color: #12172B; text-decoration: none; font-size: 15px; font-weight: 700; }
    .item-card .item-meta { margin: 8px 0 0 0; font-size: 13px; color: #475569; line-height: 1.7; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1><span class="acento">🔔 MercadoAlerta</span></h1>
    </div>
    <div class="content">
      ${contenidoHtml}
    </div>
    <div class="footer">
      <p>MercadoAlerta - Monitor de publicaciones en Mercado Público</p>
      <p>¿Tienes preguntas? No dudes en escribirnos a contacto@mercadoalerta.cl</p>
      <p style="margin-top: 16px; color: #cbd5e1; font-size: 11px;">
        Este correo fue enviado a esta dirección porque estás registrado en MercadoAlerta.
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Tarjeta de un proceso puntual (licitación o Compra Ágil) — mismo bloque
 * visual reutilizado en el resumen de alertas y en el recordatorio de
 * cierre, para no repetir el mismo layout de "nombre + código + organismo +
 * monto + cierre" en tres lugares distintos.
 */
function tarjetaProceso({ nombre, link, codigo, organismo, monto, cierre }) {
  return `
    <div class="item-card">
      <a href="${link}" class="item-title" target="_blank" rel="noopener">${nombre} ↗</a>
      <p class="item-meta">
        Código: ${codigo}<br>
        Organismo: ${organismo || 'No especificado'}<br>
        Monto: ${monto}<br>
        Cierra: ${cierre || 'No especificada'}
      </p>
    </div>
  `;
}

function urlFichaLicitacion(codigoExterno) {
  return `http://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigoExterno)}`;
}

function urlFichaCompraAgil(codigoExterno) {
  return `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(codigoExterno)}`;
}

/**
 * Resumen de licitaciones nuevas que matchearon una o más alertas — se arma
 * a partir del detalle crudo de la API (mismo shape que devuelve
 * mercadopublico.service.js), no del registro ya guardado en licitaciones_vistas.
 */
function armarResumenLicitaciones(items) {
  const subject = items.length === 1
    ? `📋 Nueva licitación: ${items[0].Nombre}`
    : `📋 ${items.length} nuevas licitaciones que coinciden con tus alertas`;

  const tarjetas = items.map((d) => {
    let monto = 'No especificado';
    if (d.MontoEstimado) {
      monto = `$${Number(d.MontoEstimado).toLocaleString('es-CL')}`;
    } else {
      const tramo = obtenerTramo(d.Tipo);
      if (tramo?.utmMinGarantizado) {
        monto = tramo.utmMax
          ? `Entre ${tramo.utmMinGarantizado} y ${tramo.utmMax} UTM`
          : `Desde ${tramo.utmMinGarantizado} UTM`;
      }
    }

    return tarjetaProceso({
      nombre: d.Nombre,
      link: urlFichaLicitacion(d.CodigoExterno),
      codigo: d.CodigoExterno,
      organismo: d.Comprador?.NombreOrganismo,
      monto,
      cierre: d.Fechas?.FechaCierre,
    });
  }).join('');

  const contenidoHtml = `
    <h2>📋 ${items.length} nueva${items.length === 1 ? '' : 's'} licitaci${items.length === 1 ? 'ón' : 'ones'} que coincide${items.length === 1 ? '' : 'n'} con tus alertas</h2>
    ${tarjetas}
    <div class="divider"></div>
    <p style="font-size: 13px; color: #64748b;">Gestiona tus alertas o revisa el detalle completo desde tu dashboard.</p>
  `;

  return { subject, html: envolverPlantillaEmail({ contenidoHtml }) };
}

/**
 * Resumen de Compras Ágiles nuevas que matchearon una o más alertas — a
 * diferencia de Licitaciones, estas pueden cerrar en menos de 24 horas, así
 * que el aviso lleva una caja de advertencia visible.
 */
function armarResumenCompraAgil(items) {
  const subject = items.length === 1
    ? `⚡ Nueva Compra Ágil: ${items[0].nombre}`
    : `⚡ ${items.length} nuevas Compras Ágiles que coinciden con tus alertas`;

  const tarjetas = items.map((item) => {
    const monto = item.montos?.monto_disponible_clp
      ? `$${Number(item.montos.monto_disponible_clp).toLocaleString('es-CL')}`
      : 'No especificado';

    return tarjetaProceso({
      nombre: item.nombre,
      link: urlFichaCompraAgil(item.codigo),
      codigo: item.codigo,
      organismo: item.institucion?.organismo_comprador,
      monto,
      cierre: item.fechas?.fecha_cierre,
    });
  }).join('');

  const contenidoHtml = `
    <h2>⚡ ${items.length} nueva${items.length === 1 ? '' : 's'} Compra${items.length === 1 ? '' : 's'} Ágil${items.length === 1 ? '' : 'es'} que coincide${items.length === 1 ? '' : 'n'} con tus alertas</h2>
    <div class="warning-box">
      <p>⚠️ Recuerda que estas pueden cerrar en menos de 24 horas — conviene revisarlas cuanto antes.</p>
    </div>
    ${tarjetas}
  `;

  return { subject, html: envolverPlantillaEmail({ contenidoHtml }) };
}

/**
 * Recuperación de contraseña, enviado desde POST /auth/olvide-password.
 */
function armarEmailRecuperacion(link) {
  const contenidoHtml = `
    <h2>🔐 Recupera tu contraseña</h2>
    <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en MercadoAlerta.</p>

    <a href="${link}" class="button">Elegir nueva contraseña →</a>

    <div class="warning-box">
      <p>⏰ Este link vence en 1 hora. Si no fuiste tú quien lo solicitó, puedes ignorar este correo — tu contraseña actual sigue funcionando.</p>
    </div>
  `;
  return { subject: '🔐 Recupera tu contraseña — MercadoAlerta', html: envolverPlantillaEmail({ contenidoHtml }) };
}

/**
 * Email de confirmación de cuenta, enviado al terminar POST /auth/register.
 * El link lleva al usuario a confirmar-cuenta.html en el frontend, que a su
 * vez llama a POST /auth/confirmar-cuenta con el token.
 */
function armarEmailConfirmacionCuenta(link, nombre) {
  const contenidoHtml = `
    <h2>¡Bienvenido/a a MercadoAlerta! 🎉</h2>
    <p>Hola${nombre ? ` ${nombre}` : ''}, gracias por registrarte. Con tu cuenta confirmada vas a poder:</p>

    <ul class="feature-list">
      <li>✅ Configurar alertas por rubro, región y organismo comprador</li>
      <li>✅ Recibir avisos por email o Telegram apenas aparezca algo que calza</li>
      <li>✅ Guardar búsquedas y recordatorios de cierre, sin perder ninguna oportunidad</li>
    </ul>

    <a href="${link}" class="button">Confirmar mi cuenta →</a>

    <div class="warning-box">
      <p>⏰ Este link vence en 48 horas. Si no fuiste tú quien se registró, puedes ignorar este correo.</p>
    </div>

    <div class="divider"></div>

    <p style="font-size: 13px; color: #64748b;">
      Si tienes alguna duda, responde a este correo y te ayudaremos con gusto.
    </p>
  `;

  return {
    subject: '🎉 Bienvenido a MercadoAlerta — Confirma tu cuenta',
    html: envolverPlantillaEmail({ contenidoHtml }),
  };
}

/**
 * Recordatorio de cierre (sección "Oportunidades") — una licitación o Compra
 * Ágil puntual, con la cantidad de horas que faltaban cuando se armó.
 */
function armarEmailRecordatorio(r) {
  const monto = r.monto ? `$${Number(r.monto).toLocaleString('es-CL')}` : 'No especificado';
  const emoji = r.tipo_proceso === 'compra_agil' ? '⚡' : '📋';
  const tipoTexto = r.tipo_proceso === 'compra_agil' ? 'Compra Ágil' : 'Licitación';
  const link = r.tipo_proceso === 'compra_agil' ? urlFichaCompraAgil(r.codigo_externo) : urlFichaLicitacion(r.codigo_externo);

  const subject = `⏰ Cierra pronto: ${r.nombre}`;
  const contenidoHtml = `
    <h2>${emoji} Recordatorio de cierre</h2>
    <p>Esta ${tipoTexto.toLowerCase()} que marcaste para recordatorio cierra dentro de las próximas ${r.horas_antes} horas:</p>
    ${tarjetaProceso({ nombre: r.nombre, link, codigo: r.codigo_externo, organismo: r.organismo, monto, cierre: r.fecha_cierre })}
  `;
  return { subject, html: envolverPlantillaEmail({ contenidoHtml }) };
}

/**
 * Cambio de estado de una licitación seguida (sección "Oportunidades") —
 * incluye el detalle de adjudicación cuando el nuevo estado es "Adjudicada"
 * (mismo parseo que usa revisar-resoluciones.js, ver utils/adjudicacion.js).
 */
function armarEmailSeguimiento({ nombre, codigoExterno, estadoAnterior, estadoNuevo, items }) {
  const subject = `📋 ${nombre}: cambió a "${estadoNuevo}"`;
  const link = urlFichaLicitacion(codigoExterno);

  let detalleAdjudicacion = '';
  if (estadoNuevo === 'Adjudicada' && items && items.length > 0) {
    const adjudicados = items.filter((it) => it.adjudicacion);
    if (adjudicados.length > 0) {
      const filas = adjudicados.map((it) => `
        <li style="margin-bottom: 10px;">
          ${it.nombre_producto || it.categoria || 'Ítem'}<br>
          Ganador: ${it.adjudicacion.nombre_proveedor || 'No especificado'} (${it.adjudicacion.rut_proveedor || 'RUT no especificado'})<br>
          Cantidad: ${it.adjudicacion.cantidad ?? '—'} · Monto unitario: ${it.adjudicacion.monto_unitario ? `$${Number(it.adjudicacion.monto_unitario).toLocaleString('es-CL')}` : 'No especificado'}
        </li>
      `).join('');
      detalleAdjudicacion = `
        <p style="font-weight: 700; color: #12172B; margin: 24px 0 8px 0;">Detalle de adjudicación:</p>
        <ul style="padding-left: 20px; margin: 0; color: #475569; font-size: 14px;">${filas}</ul>
      `;
    }
  }

  const contenidoHtml = `
    <h2>📋 Cambio de estado en una licitación que sigues</h2>
    <p><a href="${link}" style="color: #12172B; font-weight: 700; text-decoration: none;" target="_blank" rel="noopener">${nombre} ↗</a><br>
    <span style="font-size: 13px; color: #64748b;">Código: ${codigoExterno}</span></p>

    <div class="highlight-box">
      <h3>Cambio de estado</h3>
      <p>${estadoAnterior} → ${estadoNuevo}</p>
    </div>

    ${detalleAdjudicacion}
  `;
  return { subject, html: envolverPlantillaEmail({ contenidoHtml }) };
}

/**
 * Aviso de trial por vencer — "te quedan ~2 días" (mismo umbral que
 * mostrarBannerPlan en dashboard.js). Enviado por avisos-trial.js.
 */
function armarEmailAviso2Dias({ nombre, fechaExpiracionTrial }) {
  const fechaTexto = new Date(fechaExpiracionTrial).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });
  const contenidoHtml = `
    <h2>⏰ Tu período de prueba está por terminar</h2>
    <p>Hola${nombre ? ` ${nombre}` : ''}, tu prueba gratuita de MercadoAlerta vence el <strong>${fechaTexto}</strong>.</p>
    <p>Si quieres seguir recibiendo tus alertas sin interrupción, elige un plan antes de esa fecha — tus alertas, búsquedas guardadas y todo lo que configuraste durante la prueba se mantienen intactos, no se pierde nada.</p>
    <a href="${process.env.FRONTEND_URL || 'https://mercadoalerta.cl'}/login.html" class="button">Elegir mi plan →</a>
  `;
  return { subject: '⏰ Tu prueba gratuita de MercadoAlerta termina pronto', html: envolverPlantillaEmail({ contenidoHtml }) };
}

/**
 * Aviso de trial YA vencido. Enviado por avisos-trial.js — es el único aviso
 * proactivo de esto: si el usuario no vuelve a abrir la app, este correo es
 * la única forma en que se entera de que venció (ver requireEmpresaActiva.middleware.js,
 * que bloquea el acceso pero no avisa nada por su cuenta).
 */
function armarEmailTrialVencido({ nombre }) {
  const contenidoHtml = `
    <h2>Tu período de prueba terminó</h2>
    <p>Hola${nombre ? ` ${nombre}` : ''}, tus 14 días de prueba gratuita de MercadoAlerta ya terminaron.</p>

    <div class="warning-box">
      <p>⚠️ Tus alertas dejaron de monitorear Mercado Público hasta que elijas un plan — pero no te preocupes, toda tu configuración (alertas, búsquedas guardadas, recordatorios, pipeline) sigue guardada tal cual la dejaste.</p>
    </div>

    <a href="${process.env.FRONTEND_URL || 'https://mercadoalerta.cl'}/login.html" class="button">Elegir mi plan →</a>
  `;
  return { subject: 'Tu prueba gratuita de MercadoAlerta terminó', html: envolverPlantillaEmail({ contenidoHtml }) };
}

/**
 * Confirmación de suscripción activada — enviado desde el webhook
 * (POST /api/pagos/webhook) apenas se confirma el pago. `tarjeta` es
 * opcional (puede venir null si no se pudo conseguir el detalle del pago,
 * ver consultarUltimoPagoAutorizado en mercadopago.service.js) — si no está,
 * simplemente se omite esa línea, no se inventa nada.
 */
function armarEmailConfirmacionSuscripcion({ nombre, plan, monto, tarjeta }) {
  const nombrePlan = plan === 'full' ? 'Full' : 'Básico';
  const montoTexto = monto ? `$${Number(monto).toLocaleString('es-CL')} / mes` : 'No especificado';
  const tarjetaTexto = tarjeta?.ultimosDigitos
    ? `Tarjeta terminada en ${tarjeta.ultimosDigitos}${tarjeta.marca ? ` (${tarjeta.marca})` : ''}`
    : null;

  const contenidoHtml = `
    <h2>✅ Tu suscripción está activa</h2>
    <p>Hola${nombre ? ` ${nombre}` : ''}, confirmamos tu pago — ya puedes seguir usando MercadoAlerta sin interrupciones.</p>

    <div class="highlight-box">
      <h3>Plan ${nombrePlan}</h3>
      <p>${montoTexto}</p>
    </div>

    <p style="font-size: 13px; color: #64748b;">
      Forma de pago: ${tarjetaTexto || 'Tarjeta de crédito (MercadoPago)'}<br>
      El cobro se repite automáticamente cada mes — puedes cancelarlo cuando quieras desde tu cuenta.
    </p>

    <a href="${process.env.FRONTEND_URL || 'https://mercadoalerta.cl'}/login.html" class="button">Ir a mi cuenta →</a>
  `;
  return { subject: `✅ Suscripción activa — Plan ${nombrePlan}`, html: envolverPlantillaEmail({ contenidoHtml }) };
}

module.exports = {
  enviarEmailAlerta,
  armarResumenLicitaciones,
  armarResumenCompraAgil,
  armarEmailRecuperacion,
  armarEmailConfirmacionCuenta,
  armarEmailRecordatorio,
  armarEmailSeguimiento,
  armarEmailAviso2Dias,
  armarEmailTrialVencido,
  armarEmailConfirmacionSuscripcion,
  envolverPlantillaEmail,
};
