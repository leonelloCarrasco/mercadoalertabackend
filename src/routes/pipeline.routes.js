const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireEmpresaActiva } = require('../middleware/requireEmpresaActiva.middleware');
const {
  ESTADOS_VALIDOS,
  crearItemPipeline,
  listarPipelineDeUsuario,
  contarPipelineDeUsuario,
  obtenerItemPipeline,
  actualizarEstadoPipeline,
  actualizarNotaPipeline,
  eliminarItemPipeline,
} = require('../db/pipeline.queries');
const {
  obtenerSeguimientoPorUsuarioYCodigo,
  crearSeguimiento,
  eliminarSeguimientoSiOrigen,
} = require('../db/seguimientos.queries');
const { obtenerEstadoLicitacion } = require('../db/licitaciones.queries');
const { asegurarLicitacionLocal, asegurarCompraAgilLocal } = require('../services/oportunidades-helpers.service');
const { obtenerPlan } = require('../utils/planes');

const router = express.Router();
router.use(requireAuth);
router.use(requireEmpresaActiva);

const TIPOS_VALIDOS = ['licitacion', 'compra_agil'];

// GET /api/pipeline — lista el pipeline del usuario
router.get('/', async (req, res) => {
  try {
    const pipeline = await listarPipelineDeUsuario(req.userId);
    res.json({ pipeline });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar el pipeline' });
  }
});

// POST /api/pipeline — agrega algo al pipeline (desde Notificaciones o Búsquedas)
router.post('/', async (req, res) => {
  const { tipoProceso, codigoExterno, estadoPersonal } = req.body;

  if (!tipoProceso || !TIPOS_VALIDOS.includes(tipoProceso)) {
    return res.status(400).json({ error: 'Tipo de proceso inválido.' });
  }
  if (!codigoExterno || !codigoExterno.trim()) {
    return res.status(400).json({ error: 'Falta el código.' });
  }
  if (estadoPersonal && !ESTADOS_VALIDOS.includes(estadoPersonal)) {
    return res.status(400).json({ error: 'Estado inválido.' });
  }

  const codigo = codigoExterno.trim();

  // El pipeline comparte cupo con seguimiento (no hay cuota propia — ver
  // conversación de diseño): cada ítem de Licitación en el pipeline consume
  // un seguimiento por detrás, así que tiene sentido que compartan el límite.
  const limites = obtenerPlan(req.usuarioActual.plan);
  const limitePipeline = limites?.limiteSeguimientos ?? 2;

  try {
    const totalActuales = await contarPipelineDeUsuario(req.userId);
    if (totalActuales >= limitePipeline) {
      return res.status(400).json({
        error: `Tu plan (${req.usuarioActual.plan}) permite hasta ${limitePipeline} ítem${limitePipeline === 1 ? '' : 's'} en el pipeline. Elimina alguno antes de agregar uno nuevo.`,
      });
    }

    const existeLocal = tipoProceso === 'licitacion'
      ? await asegurarLicitacionLocal(codigo)
      : await asegurarCompraAgilLocal(codigo);

    if (!existeLocal) {
      return res.status(404).json({ error: 'No se encontró esa licitación o Compra Ágil en Mercado Público.' });
    }

    // Detección automática de ganado/perdido (migración 036, ver
    // seguimiento-estado.js): solo existe para Licitaciones — Compra Ágil no
    // tiene seguimiento, así que ahí el pipeline queda 100% manual.
    if (tipoProceso === 'licitacion') {
      const seguimientoExistente = await obtenerSeguimientoPorUsuarioYCodigo(req.userId, codigo);
      if (!seguimientoExistente) {
        const estadoActual = await obtenerEstadoLicitacion(codigo);
        await crearSeguimiento(req.userId, codigo, estadoActual || 'Publicada', 'pipeline');
      }
    }

    const item = await crearItemPipeline(req.userId, { tipoProceso, codigoExterno: codigo, estadoPersonal });
    if (!item) {
      return res.status(409).json({ error: 'Ya tienes esto en tu pipeline.' });
    }
    res.status(201).json({ item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al agregar al pipeline' });
  }
});

// PUT /api/pipeline/:id — mueve la tarjeta de estado y/o actualiza la nota
router.put('/:id', async (req, res) => {
  const { estadoPersonal, nota } = req.body;

  if (estadoPersonal === undefined && nota === undefined) {
    return res.status(400).json({ error: 'Nada que actualizar.' });
  }
  if (estadoPersonal !== undefined && !ESTADOS_VALIDOS.includes(estadoPersonal)) {
    return res.status(400).json({ error: 'Estado inválido.' });
  }

  try {
    let item = await obtenerItemPipeline(req.params.id, req.userId);
    if (!item) {
      return res.status(404).json({ error: 'Ítem de pipeline no encontrado' });
    }

    if (estadoPersonal !== undefined) {
      item = await actualizarEstadoPipeline(req.params.id, req.userId, estadoPersonal);
    }
    if (nota !== undefined) {
      item = await actualizarNotaPipeline(req.params.id, req.userId, nota);
    }

    res.json({ item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el pipeline' });
  }
});

// DELETE /api/pipeline/:id
router.delete('/:id', async (req, res) => {
  try {
    const eliminado = await eliminarItemPipeline(req.params.id, req.userId);
    if (!eliminado) {
      return res.status(404).json({ error: 'Ítem de pipeline no encontrado' });
    }

    // Si el seguimiento de atrás lo creó el pipeline ('pipeline'), se limpia
    // junto con el ítem. Si el usuario lo había activado a mano ('manual'),
    // se deja — sigue queriendo el aviso de cambio de estado por separado.
    if (eliminado.tipo_proceso === 'licitacion') {
      await eliminarSeguimientoSiOrigen(req.userId, eliminado.codigo_externo, 'pipeline');
    }

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar del pipeline' });
  }
});

module.exports = router;
