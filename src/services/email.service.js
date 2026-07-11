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

function armarResumenLicitaciones(items) {
  const subject = items.length === 1
    ? `Nueva licitación: ${items[0].Nombre}`
    : `${items.length} nuevas licitaciones que coinciden con tus alertas`;

  const filas = items.map((d) => {
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

    return `
      <li style="margin-bottom: 18px;">
        <strong>${d.Nombre}</strong><br>
        Código: ${d.CodigoExterno}<br>
        Organismo: ${d.Comprador?.NombreOrganismo || 'No especificado'}<br>
        Monto estimado: ${monto}<br>
        Cierra: ${d.Fechas?.FechaCierre || 'No especificada'}
      </li>
    `;
  }).join('');

  const html = `
    <h2>${items.length} nueva${items.length === 1 ? '' : 's'} licitaci${items.length === 1 ? 'ón' : 'ones'} que coincide${items.length === 1 ? '' : 'n'} con tus alertas</h2>
    <ul style="padding-left: 20px;">${filas}</ul>
  `;

  return { subject, html };
}

function armarResumenCompraAgil(items) {
  const subject = items.length === 1
    ? `Nueva Compra Ágil: ${items[0].nombre}`
    : `${items.length} nuevas Compras Ágiles que coinciden con tus alertas`;

  const filas = items.map((item) => {
    const monto = item.montos?.monto_disponible_clp
      ? `$${Number(item.montos.monto_disponible_clp).toLocaleString('es-CL')}`
      : 'No especificado';

    return `
      <li style="margin-bottom: 18px;">
        <strong>${item.nombre}</strong><br>
        Código: ${item.codigo}<br>
        Organismo: ${item.institucion?.organismo_comprador || 'No especificado'}<br>
        Monto disponible: ${monto}<br>
        ⚠️ Cierra: ${item.fechas?.fecha_cierre || 'No especificada'}
      </li>
    `;
  }).join('');

  const html = `
    <h2>${items.length} nueva${items.length === 1 ? '' : 's'} Compra${items.length === 1 ? '' : 's'} Ágil${items.length === 1 ? '' : 'es'} que coincide${items.length === 1 ? '' : 'n'} con tus alertas</h2>
    <p>⚠️ Recuerda que estas pueden cerrar en menos de 24 horas.</p>
    <ul style="padding-left: 20px;">${filas}</ul>
  `;

  return { subject, html };
}

function armarEmailRecuperacion(link) {
  const html = `
    <h2>Recupera tu contraseña</h2>
    <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en MercadoAlerta.</p>
    <p><a href="${link}">Haz clic aquí para elegir una nueva contraseña</a></p>
    <p>Este link vence en 1 hora. Si no fuiste tú quien lo solicitó, puedes ignorar este correo.</p>
  `;
  return { subject: 'Recupera tu contraseña — MercadoAlerta', html };
}

/**
 * Email de confirmación de cuenta, enviado al terminar POST /auth/register.
 * El link lleva al usuario a confirmar-cuenta.html en el frontend, que a su
 * vez llama a POST /auth/confirmar-cuenta con el token.
 */
function armarEmailConfirmacionCuenta(link, nombre) {
  const html = `
    <h2>Confirma tu cuenta</h2>
    <p>Hola${nombre ? ` ${nombre}` : ''}, gracias por registrarte en MercadoAlerta.</p>
    <p><a href="${link}">Haz clic aquí para confirmar tu cuenta</a></p>
    <p>Este link vence en 48 horas. Si no fuiste tú quien se registró, puedes ignorar este correo.</p>
  `;
  return { subject: 'Confirma tu cuenta — MercadoAlerta', html };
}

module.exports = {
  enviarEmailAlerta,
  armarResumenLicitaciones,
  armarResumenCompraAgil,
  armarEmailRecuperacion,
  armarEmailConfirmacionCuenta,
};
