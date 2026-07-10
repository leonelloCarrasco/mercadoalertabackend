const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireEmpresaActiva } = require('../middleware/requireEmpresaActiva.middleware');
const {
  crearAlertConfig,
  listarAlertConfigsDeUsuario,
  contarConfigsActivasDeUsuario,
  obtenerAlertConfigPorId,
  actualizarAlertConfig,
  eliminarAlertConfig,
} = require('../db/alert-configs.queries');
const { listarHistorialUsuario } = require('../db/alerts-sent.queries');
const { listarRegionesDisponibles } = require('../db/regiones.queries');
const { buscarCategorias, obtenerTitulosPorCodigos } = require('../db/categorias-unspsc.queries');
const { obtenerPlan } = require('../utils/planes');

const router = express.Router();
router.use(requireAuth);
router.use(requireEmpresaActiva); // deja disponible req.usuarioActual (incluye .plan)

// GET /api/alerts/regiones — regiones reales existentes en los datos, para poblar el <select>
router.get('/regiones', async (req, res) => {
  try {
    const regiones = await listarRegionesDisponibles();
    res.json({ regiones });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las regiones' });
  }
});

// GET /api/alerts/categorias/buscar?q=texto — buscador para el picker de categorías
router.get('/categorias/buscar', async (req, res) => {
  const texto = (req.query.q || '').trim();

  if (texto.length < 2) {
    return res.json({ resultados: [] });
  }

  try {
    const resultados = await buscarCategorias(texto);
    res.json({ resultados });
  } catch (err) {
    console.error('Error en /categorias/buscar:', err);
    res.status(500).json({ error: 'Error al buscar categorías' });
  }
});

// GET /api/alerts/categorias/detalle?codigos=72131500,43211500 — resuelve
// códigos a sus títulos, para mostrar la descripción en el listado de alertas.
router.get('/categorias/detalle', async (req, res) => {
  const codigos = (req.query.codigos || '').split(',').map((c) => c.trim()).filter(Boolean);

  try {
    const categorias = await obtenerTitulosPorCodigos(codigos);
    res.json({ categorias });
  } catch (err) {
    console.error('Error en /categorias/detalle:', err);
    res.status(500).json({ error: 'Error al resolver categorías' });
  }
});

// GET /api/alerts/history — historial de alertas ya enviadas a este usuario
router.get('/history', async (req, res) => {
  try {
    const historial = await listarHistorialUsuario(req.userId);
    res.json({ historial });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el historial' });
  }
});

// GET /api/alerts/config — lista las configuraciones del usuario logueado
router.get('/config', async (req, res) => {
  try {
    const configs = await listarAlertConfigsDeUsuario(req.userId);
    res.json({ configs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar configuraciones' });
  }
});

// POST /api/alerts/config — crea una nueva configuración
router.post('/config', async (req, res) => {
  const { categorias, montoMinimo, region } = req.body;

  if (!categorias && !montoMinimo && !region) {
    return res.status(400).json({ error: 'Debes especificar al menos un criterio: categorias, montoMinimo o region' });
  }

  const nuevasCategorias = categorias || [];
  const limites = obtenerPlan(req.usuarioActual.plan);
  const limiteCategorias = limites?.limiteCategorias ?? 1;
  const limiteAlertas = limites?.limiteAlertas ?? 3;

  if (nuevasCategorias.length > limiteCategorias) {
    return res.status(400).json({
      error: `Tu plan (${req.usuarioActual.plan}) permite hasta ${limiteCategorias} categoría${limiteCategorias === 1 ? '' : 's'} por alerta. Enviaste ${nuevasCategorias.length}.`,
    });
  }

  try {
    const activasActuales = await contarConfigsActivasDeUsuario(req.userId);
    if (activasActuales >= limiteAlertas) {
      return res.status(400).json({
        error: `Tu plan (${req.usuarioActual.plan}) permite hasta ${limiteAlertas} alertas activas. Pausa o elimina alguna antes de crear una nueva.`,
      });
    }

    const config = await crearAlertConfig(req.userId, { categorias, montoMinimo, region });
    res.status(201).json({ config });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear la configuración' });
  }
});

// PUT /api/alerts/config/:id — actualiza una configuración existente
router.put('/config/:id', async (req, res) => {
  const { categorias, montoMinimo, region, activo } = req.body;

  try {
    const existente = await obtenerAlertConfigPorId(req.params.id, req.userId);
    if (!existente) {
      return res.status(404).json({ error: 'Configuración no encontrada' });
    }

    const categoriasEfectivas = categorias !== undefined ? categorias : existente.categorias;
    const activoEfectivo = activo !== undefined ? activo : existente.activo;

    const limites = obtenerPlan(req.usuarioActual.plan);
    const limiteCategorias = limites?.limiteCategorias ?? 1;
    const limiteAlertas = limites?.limiteAlertas ?? 3;

    if (categoriasEfectivas && categoriasEfectivas.length > limiteCategorias) {
      return res.status(400).json({
        error: `Tu plan (${req.usuarioActual.plan}) permite hasta ${limiteCategorias} categoría${limiteCategorias === 1 ? '' : 's'} por alerta. Enviaste ${categoriasEfectivas.length}.`,
      });
    }

    // Si se está activando (o ya estaba activa y sigue así), validar que no supere el cupo,
    // excluyendo esta misma config del conteo para no contarla contra sí misma.
    if (activoEfectivo) {
      const otrasActivas = await contarConfigsActivasDeUsuario(req.userId, req.params.id);
      if (otrasActivas >= limiteAlertas) {
        return res.status(400).json({
          error: `Tu plan (${req.usuarioActual.plan}) permite hasta ${limiteAlertas} alertas activas. Pausa otra antes de activar esta.`,
        });
      }
    }

    const config = await actualizarAlertConfig(req.params.id, req.userId, { categorias, montoMinimo, region, activo });
    res.json({ config });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar la configuración' });
  }
});

// DELETE /api/alerts/config/:id
router.delete('/config/:id', async (req, res) => {
  try {
    const eliminado = await eliminarAlertConfig(req.params.id, req.userId);
    if (!eliminado) {
      return res.status(404).json({ error: 'Configuración no encontrada' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la configuración' });
  }
});

module.exports = router;
