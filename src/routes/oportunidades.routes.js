const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireEmpresaActiva } = require('../middleware/requireEmpresaActiva.middleware');
const {
  crearRecordatorio,
  listarRecordatoriosDeUsuario,
  contarRecordatoriosDeUsuario,
  eliminarRecordatorio,
} = require('../db/recordatorios.queries');
const {
  crearSeguimiento,
  listarSeguimientosDeUsuario,
  contarSeguimientosDeUsuario,
  eliminarSeguimiento,
} = require('../db/seguimientos.queries');
const { obtenerEstadoLicitacion } = require('../db/licitaciones.queries');
const { asegurarLicitacionLocal, asegurarCompraAgilLocal } = require('../services/oportunidades-helpers.service');
const { obtenerPlan } = require('../utils/planes');

const router = express.Router();
router.use(requireAuth);
router.use(requireEmpresaActiva);

const TIPOS_VALIDOS = ['licitacion', 'compra_agil'];
// Horas ofrecidas en el formulario — Licitación: 1 día/3 días/1 semana;
// Compra Ágil: ventanas cortas, su cierre suele ser cuestión de horas.
const HORAS_VALIDAS_LICITACION = [24, 72, 168];
const HORAS_VALIDAS_COMPRA_AGIL = [2, 6, 12];

// ============================================================
// --- Recordatorios de cierre ---
// ============================================================

router.get('/recordatorios', async (req, res) => {
  try {
    const recordatorios = await listarRecordatoriosDeUsuario(req.userId);
    res.json({ recordatorios });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar los recordatorios' });
  }
});

router.post('/recordatorios', async (req, res) => {
  const { tipoProceso, codigoExterno, horasAntes } = req.body;

  if (!tipoProceso || !TIPOS_VALIDOS.includes(tipoProceso)) {
    return res.status(400).json({ error: 'Tipo de proceso inválido.' });
  }
  if (!codigoExterno || !codigoExterno.trim()) {
    return res.status(400).json({ error: 'Falta el código de la licitación o Compra Ágil.' });
  }
  const horasValidas = tipoProceso === 'licitacion' ? HORAS_VALIDAS_LICITACION : HORAS_VALIDAS_COMPRA_AGIL;
  if (!horasValidas.includes(Number(horasAntes))) {
    return res.status(400).json({ error: `Elige una de las ventanas disponibles: ${horasValidas.join(', ')} horas.` });
  }

  const limites = obtenerPlan(req.usuarioActual.plan);
  const limiteRecordatorios = limites?.limiteRecordatorios ?? 3;

  try {
    const totalActuales = await contarRecordatoriosDeUsuario(req.userId);
    if (totalActuales >= limiteRecordatorios) {
      return res.status(400).json({
        error: `Tu plan (${req.usuarioActual.plan}) permite hasta ${limiteRecordatorios} recordatorio${limiteRecordatorios === 1 ? '' : 's'} de cierre. Elimina alguno antes de agregar uno nuevo.`,
      });
    }

    const existeLocal = tipoProceso === 'licitacion'
      ? await asegurarLicitacionLocal(codigoExterno.trim())
      : await asegurarCompraAgilLocal(codigoExterno.trim());

    if (!existeLocal) {
      return res.status(404).json({ error: 'No se encontró esa licitación o Compra Ágil en Mercado Público.' });
    }

    const recordatorio = await crearRecordatorio(req.userId, {
      tipoProceso, codigoExterno: codigoExterno.trim(), horasAntes: Number(horasAntes),
    });
    res.status(201).json({ recordatorio });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el recordatorio' });
  }
});

router.delete('/recordatorios/:id', async (req, res) => {
  try {
    const eliminado = await eliminarRecordatorio(req.params.id, req.userId);
    if (!eliminado) {
      return res.status(404).json({ error: 'Recordatorio no encontrado' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el recordatorio' });
  }
});

// ============================================================
// --- Seguimiento de cambio de estado (solo Licitaciones) ---
// ============================================================

router.get('/seguimientos', async (req, res) => {
  try {
    const seguimientos = await listarSeguimientosDeUsuario(req.userId);
    res.json({ seguimientos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar los seguimientos' });
  }
});

router.post('/seguimientos', async (req, res) => {
  const { codigoExterno } = req.body;

  if (!codigoExterno || !codigoExterno.trim()) {
    return res.status(400).json({ error: 'Falta el código de la licitación.' });
  }

  const limites = obtenerPlan(req.usuarioActual.plan);
  const limiteSeguimientos = limites?.limiteSeguimientos ?? 2;

  try {
    const totalActuales = await contarSeguimientosDeUsuario(req.userId);
    if (totalActuales >= limiteSeguimientos) {
      return res.status(400).json({
        error: `Tu plan (${req.usuarioActual.plan}) permite seguir hasta ${limiteSeguimientos} licitaci${limiteSeguimientos === 1 ? 'ón' : 'ones'} a la vez. Deja de seguir alguna antes de agregar una nueva.`,
      });
    }

    const codigo = codigoExterno.trim();
    const existeLocal = await asegurarLicitacionLocal(codigo);
    if (!existeLocal) {
      return res.status(404).json({ error: 'No se encontró esa licitación en Mercado Público.' });
    }

    const estadoActual = await obtenerEstadoLicitacion(codigo);
    const seguimiento = await crearSeguimiento(req.userId, codigo, estadoActual || 'Publicada');
    if (!seguimiento) {
      return res.status(409).json({ error: 'Ya estás siguiendo esta licitación.' });
    }
    res.status(201).json({ seguimiento });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el seguimiento' });
  }
});

router.delete('/seguimientos/:id', async (req, res) => {
  try {
    const eliminado = await eliminarSeguimiento(req.params.id, req.userId);
    if (!eliminado) {
      return res.status(404).json({ error: 'Seguimiento no encontrado' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el seguimiento' });
  }
});

module.exports = router;
