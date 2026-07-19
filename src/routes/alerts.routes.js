const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireEmpresaActiva } = require('../middleware/requireEmpresaActiva.middleware');
const {
  crearAlertConfig,
  listarAlertConfigsDeUsuario,
  obtenerAlertConfigPorId,
  actualizarAlertConfig,
  eliminarAlertConfig,
} = require('../db/alert-configs.queries');
const { listarHistorialUsuario, eliminarDelHistorial } = require('../db/alerts-sent.queries');
const { listarRegionesDisponibles } = require('../db/regiones.queries');
const { buscarOrganismos, traducirOrganismosACodigos, adjuntarNombresOrganismos } = require('../db/organismos.queries');
const { buscarCategorias, obtenerTitulosPorCodigos, obtenerArbolRubros } = require('../db/categorias-unspsc.queries');
const { obtenerPlan } = require('../utils/planes');
const { TRAMOS_LICITACION } = require('../utils/tramos-licitacion');

const router = express.Router();
router.use(requireAuth);
router.use(requireEmpresaActiva); // deja disponible req.usuarioActual (incluye .plan)

const TIPOS_PROCESO_VALIDOS = ['licitacion', 'compra_agil'];
const TRAMOS_VALIDOS = Object.keys(TRAMOS_LICITACION);

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

// GET /api/alerts/tramos — tramos de monto UTM (L1, LE, LP, ...) para el
// desplegable de checkboxes de "Tipo de licitación" del formulario de alertas.
// Solo aplican a Licitaciones (Compra Ágil no tiene este concepto).
router.get('/tramos', (req, res) => {
  const tramos = Object.entries(TRAMOS_LICITACION).map(([codigo, info]) => ({
    codigo,
    descripcion: info.descripcion,
  }));
  res.json({ tramos });
});

// GET /api/alerts/organismos/buscar?q=texto — buscador con autocompletado de
// organismos compradores, para el picker del formulario de alertas.
router.get('/organismos/buscar', async (req, res) => {
  const texto = (req.query.q || '').trim();

  if (texto.length < 2) {
    return res.json({ resultados: [] });
  }

  try {
    const resultados = await buscarOrganismos(texto);
    res.json({ resultados });
  } catch (err) {
    console.error('Error en /organismos/buscar:', err);
    res.status(500).json({ error: 'Error al buscar organismos' });
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

// DELETE /api/alerts/history/:id — saca una notificación del historial. No
// toca recordatorios/seguimientos/pipeline (tablas independientes, ver
// eliminarDelHistorial en alerts-sent.queries.js).
router.delete('/history/:id', async (req, res) => {
  try {
    const eliminado = await eliminarDelHistorial(req.params.id, req.userId);
    if (!eliminado) {
      return res.status(404).json({ error: 'Notificación no encontrada' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la notificación' });
  }
});

// GET /api/alerts/config — lista las configuraciones del usuario logueado
router.get('/config', async (req, res) => {
  try {
    const configs = await listarAlertConfigsDeUsuario(req.userId);
    res.json({ configs: await adjuntarNombresOrganismos(configs) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar configuraciones' });
  }
});

/**
 * El único campo obligatorio es el producto/rubro (categorias, máximo 1).
 * Monto mínimo/máximo, regiones, tipos de proceso, tramo de licitación y
 * organismo comprador son todos opcionales — "no elegir nada" en cualquiera
 * de ellos significa "no filtrar por eso" (ver matching.service.js).
 */
function validarCamposObligatorios({ categorias }) {
  if (!categorias || categorias.length === 0) {
    return 'Debes elegir un producto o rubro para la alerta.';
  }
  if (categorias.length > 1) {
    return 'Solo puedes elegir un producto o rubro por alerta.';
  }
  return null;
}

/**
 * Valida los criterios opcionales que sí tienen un conjunto de valores válidos
 * conocido (a diferencia de regiones/organismos, que aceptan cualquier string
 * que exista en los datos reales). Devuelve un mensaje de error o null.
 */
function validarCriteriosOpcionales({ tiposProceso, tramosLicitacion, montoMinimo, montoMaximo }) {
  if (tiposProceso && tiposProceso.length > 0) {
    const invalido = tiposProceso.find((t) => !TIPOS_PROCESO_VALIDOS.includes(t));
    if (invalido) return `Tipo de proceso inválido: ${invalido}`;
  }
  if (tramosLicitacion && tramosLicitacion.length > 0) {
    const invalido = tramosLicitacion.find((t) => !TRAMOS_VALIDOS.includes(t));
    if (invalido) return `Tramo de licitación inválido: ${invalido}`;
  }
  if (montoMinimo && montoMaximo && Number(montoMaximo) < Number(montoMinimo)) {
    return 'El monto máximo no puede ser menor que el monto mínimo.';
  }
  return null;
}

// Compara dos conjuntos (arrays) sin importar el orden — [] y null se tratan
// como equivalentes (ambos significan "sin filtrar por este criterio").
function mismoConjunto(a, b) {
  const normA = [...new Set((a || []).map((v) => String(v).trim()))].sort();
  const normB = [...new Set((b || []).map((v) => String(v).trim()))].sort();
  return JSON.stringify(normA) === JSON.stringify(normB);
}

/**
 * Una alerta es "duplicada" de otra si tiene EXACTAMENTE los mismos criterios
 * en todos los campos (producto/rubro, monto mínimo/máximo, y los 4 conjuntos
 * opcionales). No importa si la otra está activa o pausada — no tiene sentido
 * dejar crear dos alertas idénticas aunque una esté en pausa.
 */
function buscarDuplicada(configsExistentes, { categorias, montoMinimo, montoMaximo, regiones, tiposProceso, tramosLicitacion, organismos }, excludeId = null) {
  const categoriaNueva = (categorias || [])[0];
  const montoMinNuevo = montoMinimo ? Number(montoMinimo) : null;
  const montoMaxNuevo = montoMaximo ? Number(montoMaximo) : null;

  return configsExistentes.find((existente) => {
    if (excludeId && String(existente.id) === String(excludeId)) return false;
    const categoriaExistente = (existente.categorias || [])[0];
    if (categoriaExistente !== categoriaNueva) return false;
    const montoMinExistente = existente.monto_minimo ? Number(existente.monto_minimo) : null;
    if (montoMinExistente !== montoMinNuevo) return false;
    const montoMaxExistente = existente.monto_maximo ? Number(existente.monto_maximo) : null;
    if (montoMaxExistente !== montoMaxNuevo) return false;
    if (!mismoConjunto(existente.regiones, regiones)) return false;
    if (!mismoConjunto(existente.tipos_proceso, tiposProceso)) return false;
    if (!mismoConjunto(existente.tramos_licitacion, tramosLicitacion)) return false;
    if (!mismoConjunto(existente.organismos, organismos)) return false;
    return true;
  });
}

// POST /api/alerts/config — crea una nueva configuración
router.post('/config', async (req, res) => {
  const { categorias, montoMinimo, montoMaximo, regiones, tiposProceso, tramosLicitacion, organismos: organismosNombres } = req.body;

  const errorCampos = validarCamposObligatorios({ categorias });
  if (errorCampos) {
    return res.status(400).json({ error: errorCampos });
  }

  const errorOpcionales = validarCriteriosOpcionales({ tiposProceso, tramosLicitacion, montoMinimo, montoMaximo });
  if (errorOpcionales) {
    return res.status(400).json({ error: errorOpcionales });
  }

  const limites = obtenerPlan(req.usuarioActual.plan);
  const limiteAlertas = limites?.limiteAlertas ?? 1;

  try {
    // El picker manda NOMBRES (no cambia el frontend) — se traducen a código acá,
    // porque alert_configs.organismos guarda código (migración 032).
    const organismos = await traducirOrganismosACodigos(organismosNombres);

    const configsExistentes = await listarAlertConfigsDeUsuario(req.userId);

    if (buscarDuplicada(configsExistentes, { categorias, montoMinimo, montoMaximo, regiones, tiposProceso, tramosLicitacion, organismos })) {
      return res.status(409).json({
        error: 'Ya tienes una alerta configurada con estos mismos criterios.',
      });
    }

    const activasActuales = configsExistentes.filter((c) => c.activo).length;
    if (activasActuales >= limiteAlertas) {
      return res.status(400).json({
        error: `Tu plan (${req.usuarioActual.plan}) permite hasta ${limiteAlertas} alerta${limiteAlertas === 1 ? '' : 's'} activa${limiteAlertas === 1 ? '' : 's'}. Pausa o elimina alguna antes de crear una nueva.`,
      });
    }

    const config = await crearAlertConfig(req.userId, { categorias, montoMinimo, montoMaximo, regiones, tiposProceso, tramosLicitacion, organismos });
    res.status(201).json({ config: await adjuntarNombresOrganismos(config) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear la configuración' });
  }
});

// PUT /api/alerts/config/:id — actualiza una configuración existente
router.put('/config/:id', async (req, res) => {
  const { categorias, montoMinimo, montoMaximo, regiones, tiposProceso, tramosLicitacion, organismos: organismosNombres, activo } = req.body;

  try {
    const existente = await obtenerAlertConfigPorId(req.params.id, req.userId);
    if (!existente) {
      return res.status(404).json({ error: 'Configuración no encontrada' });
    }

    // El picker manda NOMBRES (no cambia el frontend) — se traducen a código acá,
    // porque alert_configs.organismos guarda código (migración 032). existente.organismos
    // ya viene en código desde la base, así que no hace falta traducirlo de nuevo.
    const organismos = await traducirOrganismosACodigos(organismosNombres);

    // Si se está tocando categorías, se valida de nuevo con el valor efectivo
    // (el nuevo si viene, si no el que ya tenía) — no se puede dejar una
    // alerta existente sin producto/rubro a través de un PUT parcial.
    const categoriasEfectivas = categorias !== undefined ? categorias : existente.categorias;
    const activoEfectivo = activo !== undefined ? activo : existente.activo;
    const montoEfectivo = montoMinimo !== undefined ? montoMinimo : existente.monto_minimo;
    const montoMaxEfectivo = montoMaximo !== undefined ? montoMaximo : existente.monto_maximo;

    const errorCampos = validarCamposObligatorios({ categorias: categoriasEfectivas });
    if (errorCampos) {
      return res.status(400).json({ error: errorCampos });
    }

    const errorOpcionales = validarCriteriosOpcionales({ tiposProceso, tramosLicitacion, montoMinimo: montoEfectivo, montoMaximo: montoMaxEfectivo });
    if (errorOpcionales) {
      return res.status(400).json({ error: errorOpcionales });
    }

    const regionesEfectivas = regiones !== undefined ? regiones : existente.regiones;
    const tiposProcesoEfectivos = tiposProceso !== undefined ? tiposProceso : existente.tipos_proceso;
    const tramosLicitacionEfectivos = tramosLicitacion !== undefined ? tramosLicitacion : existente.tramos_licitacion;
    const organismosEfectivos = organismos !== undefined ? organismos : existente.organismos;

    const configsExistentes = await listarAlertConfigsDeUsuario(req.userId);
    if (buscarDuplicada(configsExistentes, {
      categorias: categoriasEfectivas, montoMinimo: montoEfectivo, montoMaximo: montoMaxEfectivo, regiones: regionesEfectivas,
      tiposProceso: tiposProcesoEfectivos, tramosLicitacion: tramosLicitacionEfectivos, organismos: organismosEfectivos,
    }, req.params.id)) {
      return res.status(409).json({
        error: 'Ya tienes otra alerta con estos mismos criterios.',
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

    const config = await actualizarAlertConfig(req.params.id, req.userId, { categorias, montoMinimo, montoMaximo, regiones, tiposProceso, tramosLicitacion, organismos, activo });
    res.json({ config: await adjuntarNombresOrganismos(config) });
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
