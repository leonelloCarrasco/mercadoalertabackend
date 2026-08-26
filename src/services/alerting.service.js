const { listarAlertConfigsActivas } = require('../db/alert-configs.queries');
const { intentarReservarEnvio, liberarReserva } = require('../db/alerts-sent.queries');
const { listarLicitacionesPublicadasVigentes } = require('../db/licitaciones.queries');
const { listarComprasAgilesPublicadasVigentes } = require('../db/compra-agil.queries');
const { matchLicitacion, matchCompraAgil } = require('./matching.service');
const {
  enviarEmailAlerta,
  armarResumenLicitaciones,
  armarResumenCompraAgil,
  formatFechaHoraCL,
  formatMontoLicitacion,
  formatMontoCompraAgil,
  urlFichaLicitacion,
  urlFichaCompraAgil,
  escapeHtml,
} = require('./email.service');
const { enviarTelegramAlerta } = require('./telegram.service');
const { enviarResumenAlertaWhatsapp } = require('./whatsapp.service');
const { puedeRecibirWhatsapp } = require('../utils/planes');
const { parsearFechaChile } = require('../utils/fecha-chile');

/**
 * Arma el texto de la variable {{2}} de la plantilla "alerta_resumen":
 * "una licitación", "2 compras ágiles", "5 licitaciones", etc. — singular
 * sin número ("una X"), plural con número ("N Xs").
 */
function describirCantidadYTipo(cantidad, tipoProceso) {
  const singular = tipoProceso === 'compra_agil' ? 'compra ágil' : 'licitación';
  const plural = tipoProceso === 'compra_agil' ? 'compras ágiles' : 'licitaciones';
  return cantidad === 1 ? `una ${singular}` : `${cantidad} ${plural}`;
}

/**
 * Recorre los items nuevos, hace matching contra las configuraciones activas,
 * y agrupa por usuario + canal los items que le corresponden a cada uno —
 * reservando atómicamente cada (usuario, item, canal) antes de agregarlo al grupo,
 * para no duplicar envíos si esta misma corrida se solapa con otra (ver alerts-sent.queries.js).
 *
 * Devuelve tres Maps: uno por canal (email, telegram, whatsapp), cada uno
 * userId -> { config, items: [...], reservaIds: [...] }
 */
async function agruparPorUsuario(items, matchFn, tipoProceso, extraerCodigo) {
  const configs = await listarAlertConfigsActivas();
  const porUsuarioEmail = new Map();
  const porUsuarioTelegram = new Map();
  const porUsuarioWhatsapp = new Map();

  if (configs.length === 0) {
    console.log('[alerting] No hay ninguna configuración de alerta activa en todo el sistema.');
    return { porUsuarioEmail, porUsuarioTelegram, porUsuarioWhatsapp };
  }

  for (const item of items) {
    const matches = await matchFn(item, configs);
    const codigoExterno = extraerCodigo(item);

    for (const config of matches) {
      const reservaEmailId = await intentarReservarEnvio(config.user_id, codigoExterno, tipoProceso, 'email', config.id);
      if (reservaEmailId) {
        if (!porUsuarioEmail.has(config.user_id)) {
          porUsuarioEmail.set(config.user_id, { config, items: [], reservaIds: [] });
        }
        const bucket = porUsuarioEmail.get(config.user_id);
        bucket.items.push(item);
        bucket.reservaIds.push(reservaEmailId);
      }

      if (config.telegram_chat_id) {
        const reservaTelegramId = await intentarReservarEnvio(config.user_id, codigoExterno, tipoProceso, 'telegram', config.id);
        if (reservaTelegramId) {
          if (!porUsuarioTelegram.has(config.user_id)) {
            porUsuarioTelegram.set(config.user_id, { config, items: [], reservaIds: [] });
          }
          const bucket = porUsuarioTelegram.get(config.user_id);
          bucket.items.push(item);
          bucket.reservaIds.push(reservaTelegramId);
        }
      }

      if (puedeRecibirWhatsapp(config)) {
        const reservaWhatsappId = await intentarReservarEnvio(config.user_id, codigoExterno, tipoProceso, 'whatsapp', config.id);
        if (reservaWhatsappId) {
          if (!porUsuarioWhatsapp.has(config.user_id)) {
            porUsuarioWhatsapp.set(config.user_id, { config, items: [], reservaIds: [] });
          }
          const bucket = porUsuarioWhatsapp.get(config.user_id);
          bucket.items.push(item);
          bucket.reservaIds.push(reservaWhatsappId);
        }
      }
    }
  }

  return { porUsuarioEmail, porUsuarioTelegram, porUsuarioWhatsapp };
}

async function enviarResumenesPorEmail(porUsuarioEmail, armarResumenFn) {
  let enviados = 0;
  for (const [, bucket] of porUsuarioEmail) {
    const { subject, html } = armarResumenFn(bucket.items);
    try {
      await enviarEmailAlerta({ to: bucket.config.email, subject, html });
      enviados++;
    } catch (err) {
      console.error(`[alerting] Error enviando resumen por email a ${bucket.config.email}:`, err.message);
      for (const id of bucket.reservaIds) await liberarReserva(id);
    }
  }
  return enviados;
}

async function enviarResumenesPorTelegram(porUsuarioTelegram, armarTextoFn) {
  let enviados = 0;
  for (const [, bucket] of porUsuarioTelegram) {
    const mensajes = armarTextoFn(bucket.items); // array de uno o más mensajes (ver partirEnMensajesTelegram)
    try {
      await enviarTelegramAlertaMulti(bucket.config.telegram_chat_id, mensajes);
      enviados++;
    } catch (err) {
      console.error(`[alerting] Error enviando resumen por Telegram a user ${bucket.config.user_id}:`, err.message);
      for (const id of bucket.reservaIds) await liberarReserva(id);
    }
  }
  return enviados;
}

/**
 * A diferencia de email/Telegram, WhatsApp no manda el detalle de cada
 * ítem — solo un resumen con nombre + cantidad/tipo (ver
 * enviarResumenAlertaWhatsapp), porque las plantillas de Meta no admiten
 * armar una lista dinámica con links.
 */
async function enviarResumenesPorWhatsapp(porUsuarioWhatsapp, tipoProceso) {
  let enviados = 0;
  for (const [, bucket] of porUsuarioWhatsapp) {
    try {
      const descripcion = describirCantidadYTipo(bucket.items.length, tipoProceso);
      await enviarResumenAlertaWhatsapp(bucket.config.whatsapp_numero, bucket.config.nombre, descripcion, bucket.config.empresa_id, bucket.config.plan);
      enviados++;
    } catch (err) {
      console.error(`[alerting] Error enviando resumen por WhatsApp a user ${bucket.config.user_id}:`, err.message);
      for (const id of bucket.reservaIds) await liberarReserva(id);
    }
  }
  return enviados;
}

// Telegram rechaza cualquier sendMessage de más de 4096 caracteres (HTTP 400
// "message is too long") — con el backfill de una alerta nueva es fácil
// pasarse ese límite si matchean muchos procesos de una sola vez (más aún
// ahora que cada ítem incluye link, código y organismo). En vez de cortar el
// texto a lo bruto (lo que partiría un ítem —o una etiqueta <a> de HTML— a
// la mitad), se arman varios mensajes completos, cada uno con ítems
// enteros — nunca un ítem partido entre dos mensajes.
const TELEGRAM_MAX_CHARS = 4000; // margen bajo el límite real de 4096

/**
 * Arma uno o más mensajes de Telegram a partir de un encabezado, una lista
 * de bloques de texto (uno por ítem, ya formateados) y un pie de página
 * opcional. Devuelve un array — quien llame manda cada elemento como un
 * sendMessage separado.
 */
function partirEnMensajesTelegram(encabezado, bloques, piePagina = '') {
  const mensajes = [];
  let actual = encabezado;

  for (const bloque of bloques) {
    if ((actual + bloque).length > TELEGRAM_MAX_CHARS) {
      mensajes.push(actual);
      actual = '(continuación)';
    }
    actual += bloque;
  }

  if (piePagina) {
    if ((actual + piePagina).length > TELEGRAM_MAX_CHARS) {
      mensajes.push(actual);
      actual = piePagina;
    } else {
      actual += piePagina;
    }
  }

  mensajes.push(actual);
  return mensajes;
}

function armarTextoTelegramLicitaciones(items) {
  const encabezado = items.length === 1
    ? '📋 Nueva licitación que coincide con tus alertas:'
    : `📋 ${items.length} nuevas licitaciones que coinciden con tus alertas:`;

  const bloques = items.map((d) => {
    const link = urlFichaLicitacion(d.CodigoExterno);
    const nombre = `<a href="${escapeHtml(link)}">${escapeHtml(d.Nombre)}</a>`;
    return `\n\n• <b>${nombre}</b>\n✔️ <b>Código:</b> ${escapeHtml(d.CodigoExterno)}\n🏛️ <b>Organismo:</b> ${escapeHtml(d.Comprador?.NombreOrganismo)}\n💲 <b>Monto:</b> ${formatMontoLicitacion(d)}\n⚠️ <b>Cierra:</b> ${formatFechaHoraCL(parsearFechaChile(d.Fechas?.FechaCierre)) || 'N/E'}`;
  });

  return partirEnMensajesTelegram(encabezado, bloques);
}

function armarTextoTelegramCompraAgil(items) {
  const encabezado = items.length === 1
    ? '⚡ Nueva Compra Ágil que coincide con tus alertas:'
    : `⚡ ${items.length} nuevas Compras Ágiles que coinciden con tus alertas:`;

  const bloques = items.map((item) => {
    const link = urlFichaCompraAgil(item.codigo);
    const nombre = `<a href="${escapeHtml(link)}">${escapeHtml(item.nombre)}</a>`;
    return `\n\n• <b>${nombre}</b>\n✔️ <b>Código:</b> ${escapeHtml(item.codigo)}\n🏛️ <b>Organismo:</b> ${escapeHtml(item.institucion?.organismo_comprador)}\n💲 <b>Monto:</b> ${formatMontoCompraAgil(item)}\n⚠️ <b>Cierra:</b> ${formatFechaHoraCL(parsearFechaChile(item.fechas?.fecha_cierre)) || 'N/E'}`;
  });

  return partirEnMensajesTelegram(encabezado, bloques, '\n\n⚠️ Recuerda que las Compras Ágiles pueden cerrar en menos de 24 horas.');
}

/**
 * Envía un texto de Telegram que puede venir como string único (compatibilidad
 * con cualquier caller que arme su propio texto corto) o como array de varios
 * mensajes (armarTextoTelegramLicitaciones/CompraAgil) — manda cada uno en
 * secuencia, en orden, esperando a que termine el anterior.
 */
async function enviarTelegramAlertaMulti(chatId, textoOMensajes) {
  const mensajes = Array.isArray(textoOMensajes) ? textoOMensajes : [textoOMensajes];
  for (const mensaje of mensajes) {
    await enviarTelegramAlerta(chatId, mensaje);
  }
}

/**
 * Recorre las licitaciones nuevas detectadas, hace matching contra las configuraciones
 * activas, y envía UN email resumen (y UN mensaje de Telegram) por usuario, agrupando
 * todas las licitaciones que le hicieron match en esta corrida — en vez de un mensaje
 * por cada licitación, que era poco práctico con corridas grandes.
 */
async function procesarAlertasLicitaciones(licitacionesNuevas) {
  if (licitacionesNuevas.length === 0) return;

  const { porUsuarioEmail, porUsuarioTelegram, porUsuarioWhatsapp } = await agruparPorUsuario(
    licitacionesNuevas,
    matchLicitacion,
    'licitacion',
    (detalle) => detalle.CodigoExterno
  );

  if (porUsuarioEmail.size === 0 && porUsuarioTelegram.size === 0 && porUsuarioWhatsapp.size === 0) {
    console.log('[alerting] Hay configuraciones activas, pero ninguna coincidió con estos items.');
    return;
  }

  const emailsEnviados = await enviarResumenesPorEmail(porUsuarioEmail, armarResumenLicitaciones);
  const telegramsEnviados = await enviarResumenesPorTelegram(porUsuarioTelegram, armarTextoTelegramLicitaciones);
  const whatsappsEnviados = await enviarResumenesPorWhatsapp(porUsuarioWhatsapp, 'licitacion');

  console.log(`[alerting] ${emailsEnviados} emails resumen, ${telegramsEnviados} mensajes de Telegram y ${whatsappsEnviados} mensajes de WhatsApp enviados (licitaciones).`);
}

/**
 * Igual que procesarAlertasLicitaciones, pero para Compras Ágiles.
 * Recibe el array de { item, detalle } que devuelve el job de polling.
 */
async function procesarAlertasCompraAgil(comprasAgilesNuevas) {
  if (comprasAgilesNuevas.length === 0) return;

  // El listado (item) no trae categoría — pero el detalle sí trae productos_solicitados
  // (con codigo_producto por cada ítem pedido), que es lo que matchCompraAgil necesita
  // para el filtro por categoría. Se combinan acá antes de pasar al matching.
  const items = comprasAgilesNuevas.map((entrada) => ({
    ...entrada.item,
    productos_solicitados: entrada.detalle?.productos_solicitados || [],
  }));

  const { porUsuarioEmail, porUsuarioTelegram, porUsuarioWhatsapp } = await agruparPorUsuario(
    items,
    matchCompraAgil,
    'compra_agil',
    (item) => item.codigo
  );

  if (porUsuarioEmail.size === 0 && porUsuarioTelegram.size === 0 && porUsuarioWhatsapp.size === 0) {
    console.log('[alerting] Hay configuraciones activas, pero ninguna coincidió con estos items.');
    return;
  }

  const emailsEnviados = await enviarResumenesPorEmail(porUsuarioEmail, armarResumenCompraAgil);
  const telegramsEnviados = await enviarResumenesPorTelegram(porUsuarioTelegram, armarTextoTelegramCompraAgil);
  const whatsappsEnviados = await enviarResumenesPorWhatsapp(porUsuarioWhatsapp, 'compra_agil');

  console.log(`[alerting] ${emailsEnviados} emails resumen, ${telegramsEnviados} mensajes de Telegram y ${whatsappsEnviados} mensajes de WhatsApp enviados (Compra Ágil).`);
}

/**
 * Adapta una fila de licitaciones_vistas (guardada ya normalizada/aplanada
 * en la base, ver guardarLicitacion) de vuelta al mismo "shape" de la API
 * de Mercado Público que ya esperan matchLicitacion, armarResumenLicitaciones
 * y armarTextoTelegramLicitaciones — así se reusa exactamente la misma
 * lógica de matching y de armado de mensajes que usa el flujo normal (items
 * recién descubiertos por el polling), en vez de duplicarla para este caso.
 */
function filaLicitacionAApiShape(fila) {
  return {
    CodigoExterno: fila.codigo_externo,
    Nombre: fila.nombre,
    MontoEstimado: fila.monto_estimado,
    Estado: fila.estado,
    Tipo: fila.tipo_licitacion,
    Fechas: { FechaCierre: fila.fecha_cierre },
    Items: {
      Listado: (fila.items || []).map((it) => ({
        CodigoProducto: it.codigo_producto,
        CodigoCategoria: it.codigo_categoria,
      })),
    },
    Comprador: {
      RegionUnidad: fila.region,
      NombreOrganismo: fila.nombre_organismo,
      CodigoOrganismo: fila.codigo_organismo,
    },
  };
}

/** Igual que filaLicitacionAApiShape, pero para compras_agiles_vistas. */
function filaCompraAgilAApiShape(fila) {
  return {
    codigo: fila.codigo_externo,
    nombre: fila.nombre,
    estado: { codigo: fila.estado },
    montos: { monto_disponible_clp: fila.monto_estimado },
    fechas: { fecha_publicacion: fila.fecha_publicacion, fecha_cierre: fila.fecha_cierre },
    institucion: { nombre_region: fila.region, organismo_comprador: fila.nombre_institucion },
    productos_solicitados: fila.productos_solicitados || [],
  };
}

/**
 * Al crear una alerta, además de matchear procesos NUEVOS de ahí en adelante
 * (vía el polling normal), busca entre los procesos "Publicada"/"publicada"
 * ya guardados en la base — que existían ANTES de esta alerta y podrían
 * igual ser de interés — y si algo matchea, lo notifica una única vez, igual
 * que si fuera nuevo.
 *
 * Se llama en segundo plano (fire-and-forget) desde POST /api/alerts/config,
 * sin bloquear la respuesta al usuario: recorrer potencialmente cientos de
 * procesos guardados puede tardar unos segundos, y crear la alerta no
 * debería quedar esperando eso.
 *
 * config viene de obtenerAlertConfigConContacto (trae email/telegram_chat_id
 * del usuario ya unidos, a diferencia de lo que devuelve crearAlertConfig).
 */
async function procesarBackfillNuevaAlerta(config) {
  try {
    const [licitacionesVigentes, comprasAgilesVigentes] = await Promise.all([
      listarLicitacionesPublicadasVigentes(),
      listarComprasAgilesPublicadasVigentes(),
    ]);

    const licitacionesMatch = [];
    for (const fila of licitacionesVigentes) {
      const detalle = filaLicitacionAApiShape(fila);
      const matches = await matchLicitacion(detalle, [config]);
      if (matches.length > 0) licitacionesMatch.push(detalle);
    }

    const comprasAgilesMatch = [];
    for (const fila of comprasAgilesVigentes) {
      const item = filaCompraAgilAApiShape(fila);
      const matches = await matchCompraAgil(item, [config]);
      if (matches.length > 0) comprasAgilesMatch.push(item);
    }

    if (licitacionesMatch.length === 0 && comprasAgilesMatch.length === 0) {
      console.log(`[alerting] Backfill de alerta nueva (config ${config.id}): sin coincidencias entre lo ya publicado.`);
      return;
    }

    // Misma reserva atómica que el flujo normal (ver agruparPorUsuario) —
    // evita duplicar el aviso si el polling llega a tocar el mismo item casi
    // al mismo tiempo que este backfill.
    const licitacionesAEnviarEmail = [];
    const licitacionesAEnviarTelegram = [];
    const licitacionesAEnviarWhatsapp = [];
    for (const d of licitacionesMatch) {
      const reservaEmailId = await intentarReservarEnvio(config.user_id, d.CodigoExterno, 'licitacion', 'email', config.id);
      if (reservaEmailId) licitacionesAEnviarEmail.push(d);
      if (config.telegram_chat_id) {
        const reservaTelegramId = await intentarReservarEnvio(config.user_id, d.CodigoExterno, 'licitacion', 'telegram', config.id);
        if (reservaTelegramId) licitacionesAEnviarTelegram.push(d);
      }
      if (puedeRecibirWhatsapp(config)) {
        const reservaWhatsappId = await intentarReservarEnvio(config.user_id, d.CodigoExterno, 'licitacion', 'whatsapp', config.id);
        if (reservaWhatsappId) licitacionesAEnviarWhatsapp.push(d);
      }
    }

    const comprasAgilesAEnviarEmail = [];
    const comprasAgilesAEnviarTelegram = [];
    const comprasAgilesAEnviarWhatsapp = [];
    for (const item of comprasAgilesMatch) {
      const reservaEmailId = await intentarReservarEnvio(config.user_id, item.codigo, 'compra_agil', 'email', config.id);
      if (reservaEmailId) comprasAgilesAEnviarEmail.push(item);
      if (config.telegram_chat_id) {
        const reservaTelegramId = await intentarReservarEnvio(config.user_id, item.codigo, 'compra_agil', 'telegram', config.id);
        if (reservaTelegramId) comprasAgilesAEnviarTelegram.push(item);
      }
      if (puedeRecibirWhatsapp(config)) {
        const reservaWhatsappId = await intentarReservarEnvio(config.user_id, item.codigo, 'compra_agil', 'whatsapp', config.id);
        if (reservaWhatsappId) comprasAgilesAEnviarWhatsapp.push(item);
      }
    }

    if (licitacionesAEnviarEmail.length > 0) {
      const { subject, html } = armarResumenLicitaciones(licitacionesAEnviarEmail);
      await enviarEmailAlerta({ to: config.email, subject: `🆕 ${subject}`, html });
    }
    if (comprasAgilesAEnviarEmail.length > 0) {
      const { subject, html } = armarResumenCompraAgil(comprasAgilesAEnviarEmail);
      await enviarEmailAlerta({ to: config.email, subject: `🆕 ${subject}`, html });
    }
    if (licitacionesAEnviarTelegram.length > 0) {
      await enviarTelegramAlertaMulti(config.telegram_chat_id, armarTextoTelegramLicitaciones(licitacionesAEnviarTelegram));
    }
    if (comprasAgilesAEnviarTelegram.length > 0) {
      await enviarTelegramAlertaMulti(config.telegram_chat_id, armarTextoTelegramCompraAgil(comprasAgilesAEnviarTelegram));
    }
    // A diferencia del resto de canales acá, WhatsApp manda UN mensaje por
    // tipo de proceso (no un total combinado) — porque la plantilla ahora
    // necesita la descripción de tipo ("una licitación", "2 compras
    // ágiles"), que no tendría sentido mezclada si hay de los dos tipos a
    // la vez en el mismo backfill.
    if (licitacionesAEnviarWhatsapp.length > 0) {
      const descripcion = describirCantidadYTipo(licitacionesAEnviarWhatsapp.length, 'licitacion');
      await enviarResumenAlertaWhatsapp(config.whatsapp_numero, config.nombre, descripcion, config.empresa_id, config.plan);
    }
    if (comprasAgilesAEnviarWhatsapp.length > 0) {
      const descripcion = describirCantidadYTipo(comprasAgilesAEnviarWhatsapp.length, 'compra_agil');
      await enviarResumenAlertaWhatsapp(config.whatsapp_numero, config.nombre, descripcion, config.empresa_id, config.plan);
    }

    console.log(`[alerting] Backfill de alerta nueva (config ${config.id}): ${licitacionesMatch.length} licitaciones + ${comprasAgilesMatch.length} Compras Ágiles ya publicadas encontradas y notificadas.`);
  } catch (err) {
    // A propósito NO se propaga — este backfill corre fire-and-forget después
    // de responder la creación de la alerta (ver alerts.routes.js), así que
    // ya no hay ningún request esperando; si algo falla acá, la alerta igual
    // queda creada y va a funcionar normal para procesos futuros.
    console.error(`[alerting] Error en backfill de alerta nueva (config ${config.id}):`, err);
  }
}

module.exports = { procesarAlertasLicitaciones, procesarAlertasCompraAgil, procesarBackfillNuevaAlerta, armarTextoTelegramLicitaciones, armarTextoTelegramCompraAgil };
