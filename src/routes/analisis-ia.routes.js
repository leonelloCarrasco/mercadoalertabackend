const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireEmpresaActiva } = require('../middleware/requireEmpresaActiva.middleware');
const {
  buscarMiAnalisis,
  buscarAnalisisPorHash,
  buscarAnalisisSinAdjuntos,
  guardarAnalisis,
  listarMisAnalisis,
  obtenerCicloVigente,
  contarConsumosDelCiclo,
  registrarConsumo,
} = require('../db/analisis-ia.queries');
const { obtenerLicitacionPorCodigo } = require('../db/licitaciones.queries');
const { obtenerCompraAgilPorCodigo } = require('../db/compra-agil.queries');
const { asegurarLicitacionLocal, asegurarCompraAgilLocal } = require('../services/oportunidades-helpers.service');
const { obtenerFichaLicitacionHTML } = require('../services/mercadopublico.service');
const { extraerTextoFicha } = require('../utils/extraer-ficha-texto');
const { extraerTextoArchivo } = require('../services/documento-extractor.service');
const { analizarProceso } = require('../services/analisis-ia.service');
const { enviarEmailAlerta, envolverPlantillaEmail } = require('../services/email.service');
const { obtenerPlan } = require('../utils/planes');
const pool = require('../db/pool');

const router = express.Router();
router.use(requireAuth);
router.use(requireEmpresaActiva);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB, mismo tope que exige ChileCompra para sus propios adjuntos
});

const TIPOS_VALIDOS = ['licitacion', 'compra_agil'];

function calcularHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Arma el texto "sin adjuntos" — para Licitaciones usa la ficha pública
 * (HTML, ver mercadopublico.service.js); para Compra Ágil no hay una ficha
 * pública equivalente confirmada, así que se arma un texto legible a partir
 * de lo que ya tenemos guardado localmente.
 */
async function armarTextoSinAdjuntos(tipoProceso, codigoExterno, filaLocal) {
  if (tipoProceso === 'licitacion') {
    const html = await obtenerFichaLicitacionHTML(codigoExterno);
    if (!html) return null;
    return extraerTextoFicha(html);
  }

  const productos = (filaLocal?.productos_solicitados || [])
    .map((p) => `- ${p.nombre_producto || p.descripcion || 'Producto'} (cantidad: ${p.cantidad || '?'})`)
    .join('\n');

  return `
Compra Ágil: ${filaLocal?.nombre || ''}
Código: ${codigoExterno}
Organismo comprador: ${filaLocal?.nombre_institucion || 'No especificado'}
Región: ${filaLocal?.region || 'No especificada'}
Monto disponible: ${filaLocal?.monto_estimado ? `$${Number(filaLocal.monto_estimado).toLocaleString('es-CL')}` : 'No especificado'}
Fecha de publicación: ${filaLocal?.fecha_publicacion || 'No especificada'}
Fecha de cierre: ${filaLocal?.fecha_cierre || 'No especificada'}

Productos/servicios solicitados:
${productos || 'No especificados'}
  `.trim();
}

function armarMetadata(tipoProceso, filaLocal) {
  if (tipoProceso === 'licitacion') {
    return {
      nombre: filaLocal?.nombre,
      organismo: filaLocal?.nombre_organismo,
      region: filaLocal?.region,
      montoEstimado: filaLocal?.monto_estimado,
      fechaCierre: filaLocal?.fecha_cierre,
    };
  }
  return {
    nombre: filaLocal?.nombre,
    organismo: filaLocal?.nombre_institucion,
    region: filaLocal?.region,
    montoEstimado: filaLocal?.monto_estimado,
    fechaCierre: filaLocal?.fecha_cierre,
  };
}

// GET /api/analisis-ia/buscar?tipoProceso=X&codigo=Y — ¿YO (usuario logueado)
// ya analicé este proceso? (regla C — no es un caché compartido entre
// usuarios, cada uno tiene el suyo).
router.get('/buscar', async (req, res) => {
  const { tipoProceso, codigo } = req.query;

  if (!tipoProceso || !TIPOS_VALIDOS.includes(tipoProceso) || !codigo) {
    return res.status(400).json({ error: 'Faltan parámetros (tipoProceso, codigo).' });
  }

  try {
    const mio = await buscarMiAnalisis(req.userId, tipoProceso, codigo.trim());
    if (!mio) {
      return res.json({ encontrado: false });
    }

    const filaLocal = tipoProceso === 'licitacion'
      ? await obtenerLicitacionPorCodigo(codigo.trim())
      : await obtenerCompraAgilPorCodigo(codigo.trim());

    const fechaCierreActual = filaLocal?.fecha_cierre ? new Date(filaLocal.fecha_cierre).getTime() : null;
    const fechaCierreSnapshot = mio.fecha_cierre_snapshot ? new Date(mio.fecha_cierre_snapshot).getTime() : null;
    const posiblementeDesactualizado = !!(fechaCierreActual && fechaCierreSnapshot && fechaCierreActual !== fechaCierreSnapshot);

    res.json({ encontrado: true, analisis: mio, posiblementeDesactualizado });
  } catch (err) {
    console.error('[analisis-ia.buscar] Error:', err);
    res.status(500).json({ error: 'Error al buscar el análisis' });
  }
});

// GET /api/analisis-ia/mios — lista completa de análisis del usuario logueado.
router.get('/mios', async (req, res) => {
  try {
    const analisis = await listarMisAnalisis(req.userId);
    res.json({ analisis });
  } catch (err) {
    console.error('[analisis-ia.mios] Error:', err);
    res.status(500).json({ error: 'Error al listar tus análisis' });
  }
});

// POST /api/analisis-ia — ejecuta un análisis NUEVO (o rehecho) PARA EL
// USUARIO LOGUEADO. Siempre gasta cupo si termina con éxito y se guarda
// (regla B) — sea porque se llamó a la IA de verdad, o porque se copió de
// otro análisis con el mismo archivo (regla C + optimización de costo).
router.post('/', upload.single('archivo'), async (req, res) => {
  const { tipoProceso, codigo, sinAdjuntos, forzarContinuar } = req.body;
  const archivo = req.file;

  if (!tipoProceso || !TIPOS_VALIDOS.includes(tipoProceso) || !codigo?.trim()) {
    return res.status(400).json({ error: 'Faltan parámetros (tipoProceso, codigo).' });
  }
  if (!archivo && sinAdjuntos !== 'true') {
    return res.status(400).json({ error: 'Sube un archivo de bases, o marca "No tengo o no existen archivos".' });
  }

  const codigoExterno = codigo.trim();
  const esSinAdjuntos = !archivo;

  try {
    // Cupo: ciclo rotativo (regla A), no mes calendario — ver
    // obtenerCicloVigente/contarConsumosDelCiclo en analisis-ia.queries.js.
    const limites = obtenerPlan(req.usuarioActual.plan);
    const limiteAnalisis = limites?.limiteAnalisisIA ?? 1;
    const cicloVigente = await obtenerCicloVigente(req.userId);
    const consumosDelCiclo = await contarConsumosDelCiclo(req.userId, cicloVigente);
    if (consumosDelCiclo >= limiteAnalisis) {
      return res.status(400).json({
        error: `Tu plan (${req.usuarioActual.plan}) permite ${limiteAnalisis} análisis de IA por ciclo mensual, y ya los usaste todos. Vuelve a intentarlo cuando termine tu ciclo actual, o mejora tu plan.`,
      });
    }

    const existeLocal = tipoProceso === 'licitacion'
      ? await asegurarLicitacionLocal(codigoExterno)
      : await asegurarCompraAgilLocal(codigoExterno);
    if (!existeLocal) {
      return res.status(404).json({ error: 'No se encontró esa licitación o Compra Ágil en Mercado Público.' });
    }

    const filaLocal = tipoProceso === 'licitacion'
      ? await obtenerLicitacionPorCodigo(codigoExterno)
      : await obtenerCompraAgilPorCodigo(codigoExterno);

    let resultado;
    let archivoHash = null;

    if (!esSinAdjuntos) {
      // Modo con archivo: si es BYTE POR BYTE igual a uno que otro usuario ya
      // analizó para este mismo proceso, se copia — no hace falta ni
      // extraer texto ni llamar a la IA de nuevo sobre contenido idéntico.
      archivoHash = calcularHash(archivo.buffer);
      const existente = await buscarAnalisisPorHash(tipoProceso, codigoExterno, archivoHash);

      if (existente) {
        resultado = existente.contenido;
      } else {
        const extraccion = await extraerTextoArchivo(archivo.buffer, archivo.mimetype, archivo.originalname);
        if (!extraccion.extraible) {
          // Falla de extracción (ej. PDF escaneado) — NO gasta cupo, ni
          // siquiera se llegó a llamar a la IA.
          return res.status(422).json({ error: extraccion.motivo });
        }

        const metadataPrevia = armarMetadata(tipoProceso, filaLocal);
        resultado = await analizarProceso({ tipoProceso, codigoExterno, metadata: metadataPrevia, textoBases: extraccion.texto, sinAdjuntos: false });

        if (resultado.coincide === false && forzarContinuar !== 'true') {
          // No se guarda ni se gasta cupo — el usuario tiene que confirmar
          // explícitamente que quiere continuar igual (ver diseño acordado).
          return res.json({
            requiereConfirmacion: true,
            razonNoCoincide: resultado.razonNoCoincide,
            vistaPrevia: resultado,
          });
        }
      }
    } else {
      // Modo sin adjuntos: la fuente es siempre la misma ficha pública, así
      // que cualquier análisis "sin adjuntos" ya hecho por CUALQUIER usuario
      // para este proceso sirve de copia — EXCEPTO si la fecha de cierre
      // cambió desde entonces (señal de que las bases se modificaron).
      const existente = await buscarAnalisisSinAdjuntos(tipoProceso, codigoExterno);
      const fechaCierreActual = filaLocal?.fecha_cierre ? new Date(filaLocal.fecha_cierre).getTime() : null;
      const fechaCierreExistente = existente?.fecha_cierre_snapshot ? new Date(existente.fecha_cierre_snapshot).getTime() : null;
      const sigueVigente = existente && (!fechaCierreActual || fechaCierreActual === fechaCierreExistente);

      if (sigueVigente) {
        resultado = existente.contenido;
      } else {
        const textoBases = await armarTextoSinAdjuntos(tipoProceso, codigoExterno, filaLocal);
        if (!textoBases) {
          return res.status(502).json({ error: 'No pudimos traer la información pública de este proceso. Intenta de nuevo más tarde.' });
        }
        const metadataPrevia = armarMetadata(tipoProceso, filaLocal);
        resultado = await analizarProceso({ tipoProceso, codigoExterno, metadata: metadataPrevia, textoBases, sinAdjuntos: true });
        // No se valida "coincide" acá — sin adjuntos, la única fuente ES la
        // ficha del código que el usuario mismo ingresó, no hay nada
        // externo que pudiera no corresponder.
      }
    }

    const metadata = armarMetadata(tipoProceso, filaLocal);
    const analisisGuardado = await guardarAnalisis({
      userId: req.userId,
      tipoProceso,
      codigoExterno,
      nombre: metadata.nombre,
      contenido: resultado,
      sinAdjuntos: esSinAdjuntos,
      archivoHash,
      fechaCierreSnapshot: filaLocal?.fecha_cierre || null,
    });

    await registrarConsumo(req.userId, analisisGuardado.id, cicloVigente);

    res.json({
      analisis: analisisGuardado,
      cupoRestante: Math.max(0, limiteAnalisis - (consumosDelCiclo + 1)),
    });
  } catch (err) {
    console.error('[analisis-ia.crear] Error:', err);
    // Falla técnica — no se gastó cupo (nunca se llegó a registrarConsumo).
    res.status(500).json({ error: err.message || 'Error al analizar el proceso. No se descontó tu cupo.' });
  }
});

// POST /api/analisis-ia/:id/enviar-correo — manda el análisis por correo. Si
// no se manda `email` en el body, usa el del usuario logueado por defecto.
// Solo puede mandarlo el DUEÑO del análisis (regla C).
router.post('/:id/enviar-correo', async (req, res) => {
  try {
    const destinatario = req.body.email?.trim() || req.usuarioActual.email;

    const { rows } = await pool.query(
      'SELECT * FROM analisis_ia WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    const analisis = rows[0];
    if (!analisis) {
      return res.status(404).json({ error: 'Análisis no encontrado' });
    }

    const c = analisis.contenido;
    const checklistHtml = (c.checklistDocumentos || []).map((d) => `
      <li style="margin-bottom: 8px;">
        ${d.obligatorio ? '✅' : '➖'} ${d.documento}${d.notas ? `<br><span style="color:#64748b; font-size:12px;">${d.notas}</span>` : ''}
      </li>
    `).join('');

    const puntosHtml = (c.puntosDeAtencion || []).map((p) => `<li style="margin-bottom: 6px;">${p}</li>`).join('');

    const contenidoHtml = `
      <h2>📋 Análisis: ${analisis.nombre || analisis.codigo_externo}</h2>
      ${analisis.sin_adjuntos ? '<div class="warning-box"><p>⚠️ Este análisis se hizo sin las bases completas — puede faltar información relevante.</p></div>' : ''}
      <p>${(c.resumen || '').replace(/\n/g, '<br>')}</p>
      <h3 style="font-size: 14px; margin-top: 24px;">Checklist de documentos</h3>
      <ul style="padding-left: 20px;">${checklistHtml || '<li>No se identificaron documentos exigidos.</li>'}</ul>
      <h3 style="font-size: 14px; margin-top: 24px;">Puntos de atención</h3>
      <ul style="padding-left: 20px;">${puntosHtml || '<li>Sin puntos de atención identificados.</li>'}</ul>
    `;

    await enviarEmailAlerta({
      to: destinatario,
      subject: `📋 Análisis de proceso: ${analisis.nombre || analisis.codigo_externo}`,
      html: envolverPlantillaEmail({ contenidoHtml }),
    });

    res.json({ enviado: true, destinatario });
  } catch (err) {
    console.error('[analisis-ia.enviar-correo] Error:', err);
    res.status(500).json({ error: 'Error al enviar el correo' });
  }
});

module.exports = router;
