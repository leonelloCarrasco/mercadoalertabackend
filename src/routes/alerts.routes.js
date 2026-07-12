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
const { buscarCategorias, obtenerTitulosPorCodigos, obtenerArbolRubros } = require('../db/categorias-unspsc.queries');
const { obtenerPlan } = require('../utils/planes');

const router = express.Router();
router.use(requireAuth);
router.use(requireEmpresaActiva); // deja disponible req.usuarioActual (incluye .plan)

// GET /api/alerts/regiones — regiones reales existentes en los datos, para poblar
// el desplegable de checkboxes del formulario de alertas.
router.get('/regiones', async (req, res) => {
  try {
    const regiones = await listarRegionesDisponibles();
    res.json({ regiones });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las regiones' });
  }
});

// GET /api/alerts/categorias/buscar?q=texto&nivel=producto — buscador para el
// picker de categorías. `nivel` es opcional ('categoria' o 'producto'): el modo
// "Producto" del buscador lo manda para no mezclar rubros en los resultados
// (el modo "Rubro" usa el árbol, ver /categorias/arbol más abajo).
router.get('/categorias/buscar', async (req, res) => {
  const texto = (req.query.q || '').trim();
  const nivel = ['categoria', 'producto'].includes(req.query.nivel) ? req.query.nivel : undefined;

  if (texto.length < 2) {
    return res.json({ resultados: [] });
  }

  try {
    const resultados = await buscarCategorias(texto, { nivel });
    res.json({ resultados });
  } catch (err) {
    console.error('Error en /categorias/buscar:', err);
    res.status(500).json({ error: 'Error al buscar categorías' });
  }
});

// GET /api/alerts/categorias/arbol — árbol Segmento -> Familia -> Rubro, para
// el modo "Rubro" del buscador: el usuario navega hasta el nivel 3 y lo elige
// directamente, sin tener que saber cómo se llama exactamente el rubro.
router.get('/categorias/arbol', async (req, res) => {
  try {
    const arbol = await obtenerArbolRubros();
    res.json({ arbol });
  } catch (err) {
    console.error('Error en /categorias/arbol:', err);
    res.status(500).json({ error: 'Error al obtener el árbol de rubros' });
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

// Valida los campos ahora obligatorios de una alerta: monto mínimo y
// exactamente una categoría/producto. Se usa tanto en creación como en
// edición (cuando el campo correspondiente viene en el body).
function validarCamposObligatorios({ montoMinimo, categorias }) {
  if (montoMinimo === undefined || montoMinimo === null || Number(montoMinimo) <= 0) {
    return 'El monto mínimo es obligatorio y debe ser mayor a 0.';
  }
  if (!categorias || categorias.length === 0) {
    return 'Debes elegir una categoría o producto para la alerta.';
  }
  if (categorias.length > 1) {
    return 'Solo puedes elegir una categoría o producto por alerta.';
  }
  return null;
}

// Compara dos conjuntos de regiones sin importar el orden — [] y null se
// tratan como equivalentes (ambos significan "todas las regiones").
function mismasRegiones(a, b) {
  const normA = [...new Set((a || []).map((r) => r.trim()))].sort();
  const normB = [...new Set((b || []).map((r) => r.trim()))].sort();
  return JSON.stringify(normA) === JSON.stringify(normB);
}

/**
 * Una alerta es "duplicada" de otra si tiene exactamente los mismos criterios:
 * misma categoría/producto (siempre hay como máximo 1), mismo monto mínimo y
 * el mismo conjunto de regiones. No importa si la otra está activa o pausada —
 * no tiene sentido dejar crear dos alertas idénticas aunque una esté en pausa.
 */
function buscarDuplicada(configsExistentes, { categorias, montoMinimo, regiones }, excludeId = null) {
  const categoriaNueva = (categorias || [])[0];
  const montoNuevo = Number(montoMinimo);

  return configsExistentes.find((existente) => {
    if (excludeId && String(existente.id) === String(excludeId)) return false;
    const categoriaExistente = (existente.categorias || [])[0];
    if (categoriaExistente !== categoriaNueva) return false;
    if (Number(existente.monto_minimo) !== montoNuevo) return false;
    if (!mismasRegiones(existente.regiones, regiones)) return false;
    return true;
  });
}

// POST /api/alerts/config — crea una nueva configuración
router.post('/config', async (req, res) => {
  const { categorias, montoMinimo, regiones } = req.body;

  const errorCampos = validarCamposObligatorios({ montoMinimo, categorias });
  if (errorCampos) {
    return res.status(400).json({ error: errorCampos });
  }

  const limites = obtenerPlan(req.usuarioActual.plan);
  const limiteAlertas = limites?.limiteAlertas ?? 1;

  try {
    const configsExistentes = await listarAlertConfigsDeUsuario(req.userId);

    if (buscarDuplicada(configsExistentes, { categorias, montoMinimo, regiones })) {
      return res.status(409).json({
        error: 'Ya tienes una alerta configurada con estos datos.',
      });
    }

    const activasActuales = configsExistentes.filter((c) => c.activo).length;
    if (activasActuales >= limiteAlertas) {
      return res.status(400).json({
        error: `Tu plan (${req.usuarioActual.plan}) permite hasta ${limiteAlertas} alerta${limiteAlertas === 1 ? '' : 's'} activa${limiteAlertas === 1 ? '' : 's'}. Pausa o elimina alguna antes de crear una nueva.`,
      });
    }

    const config = await crearAlertConfig(req.userId, { categorias, montoMinimo, regiones });
    res.status(201).json({ config });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear la configuración' });
  }
});

// PUT /api/alerts/config/:id — actualiza una configuración existente
router.put('/config/:id', async (req, res) => {
  const { categorias, montoMinimo, regiones, activo } = req.body;

  try {
    const existente = await obtenerAlertConfigPorId(req.params.id, req.userId);
    if (!existente) {
      return res.status(404).json({ error: 'Configuración no encontrada' });
    }

    // Si se está tocando monto o categorías, se validan de nuevo con el valor
    // efectivo (el nuevo si viene, si no el que ya tenía) — no se puede dejar
    // una alerta existente sin monto o sin categoría a través de un PUT parcial.
    const montoEfectivo = montoMinimo !== undefined ? montoMinimo : existente.monto_minimo;
    const categoriasEfectivas = categorias !== undefined ? categorias : existente.categorias;
    const activoEfectivo = activo !== undefined ? activo : existente.activo;

    const errorCampos = validarCamposObligatorios({ montoMinimo: montoEfectivo, categorias: categoriasEfectivas });
    if (errorCampos) {
      return res.status(400).json({ error: errorCampos });
    }

    const regionesEfectivas = regiones !== undefined ? regiones : existente.regiones;
    const configsExistentes = await listarAlertConfigsDeUsuario(req.userId);
    if (buscarDuplicada(configsExistentes, { categorias: categoriasEfectivas, montoMinimo: montoEfectivo, regiones: regionesEfectivas }, req.params.id)) {
      return res.status(409).json({
        error: 'Ya tienes otra alerta con la misma categoría, monto mínimo y regiones.',
      });
    }

    const limites = obtenerPlan(req.usuarioActual.plan);
    const limiteAlertas = limites?.limiteAlertas ?? 1;

    // Si se está activando (o ya estaba activa y sigue así), validar que no supere el cupo,
    // excluyendo esta misma config del conteo para no contarla contra sí misma.
    if (activoEfectivo) {
      const otrasActivas = configsExistentes.filter((c) => c.activo && String(c.id) !== String(req.params.id)).length;
      if (otrasActivas >= limiteAlertas) {
        return res.status(400).json({
          error: `Tu plan (${req.usuarioActual.plan}) permite hasta ${limiteAlertas} alerta${limiteAlertas === 1 ? '' : 's'} activa${limiteAlertas === 1 ? '' : 's'}. Pausa otra antes de activar esta.`,
        });
      }
    }

    const config = await actualizarAlertConfig(req.params.id, req.userId, { categorias, montoMinimo, regiones, activo });
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
