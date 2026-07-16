const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireEmpresaActiva } = require('../middleware/requireEmpresaActiva.middleware');
const {
  crearBusqueda,
  listarBusquedasDeUsuario,
  contarBusquedasDeUsuario,
  obtenerBusquedaPorId,
  eliminarBusqueda,
} = require('../db/busquedas.queries');
const { traducirOrganismosACodigos, adjuntarNombresOrganismos } = require('../db/organismos.queries');
const { ejecutarBusqueda } = require('../services/busqueda-ejecutor.service');
const { obtenerPlan } = require('../utils/planes');
const { ESTADOS_BUSQUEDA_VALIDOS } = require('../utils/estados-licitacion');

const router = express.Router();
router.use(requireAuth);
router.use(requireEmpresaActiva);

const TIPOS_VALIDOS = ['licitacion', 'compra_agil'];
const MODOS_LICITACION_VALIDOS = ['codigo', 'estado_fecha', 'proveedor', 'organismo'];
const MODOS_COMPRA_AGIL_VALIDOS = ['codigo', 'listado'];
const RUT_REGEX = /^\d{1,2}(\.\d{3}){2}-[\dkK]$/;

// OJO: la API v2 de Compra Ágil no documenta públicamente el listado cerrado
// de valores de "estado" (a diferencia de Licitaciones, que sí lo documenta
// con códigos numéricos) — esta lista sale de las guías de usuario de
// Compra Ágil (Publicada, Cerrada, Adjudicada, Desierta, Cancelada). Si la
// API rechaza alguno o falta un valor real, hay que ajustarla acá.
const ESTADOS_COMPRA_AGIL_VALIDOS = ['publicada', 'cerrada', 'desierta', 'cancelada', 'proveedor_seleccionado'];

/**
 * Cada modo de Licitaciones solo llena las columnas que le corresponden (ver
 * migración 033); Compra Ágil tiene solo 2 modos (migración 034), porque su
 * API sí deja combinar texto/región/estado libremente entre sí — no hace
 * falta un modo por cada combinación documentada, a diferencia de Licitaciones.
 */
function validarCampos(body) {
  const { nombre, tipo } = body;

  if (!nombre || !nombre.trim()) {
    return 'Debes ponerle un nombre a la búsqueda.';
  }
  if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
    return 'Debes elegir qué buscar: Licitaciones o Compras Ágiles.';
  }

  if (tipo === 'licitacion') {
    const { modo, codigoExterno, estado, rutProveedor, organismos } = body;
    if (!modo || !MODOS_LICITACION_VALIDOS.includes(modo)) {
      return 'Debes elegir cómo quieres buscar la licitación.';
    }
    if (modo === 'codigo' && !codigoExterno?.trim()) {
      return 'Debes ingresar el código de la licitación.';
    }
    if (modo === 'estado_fecha' && estado && !ESTADOS_BUSQUEDA_VALIDOS.includes(estado)) {
      return `Estado inválido: ${estado}`;
    }
    if (modo === 'proveedor' && !RUT_REGEX.test(rutProveedor || '')) {
      return 'Ingresa el RUT del proveedor con puntos y guión (ej. 70.017.820-k).';
    }
    if (modo === 'organismo' && (!organismos || organismos.length === 0)) {
      return 'Debes elegir un organismo comprador.';
    }
  } else {
    const { modo, codigoExterno, estados } = body;
    if (!modo || !MODOS_COMPRA_AGIL_VALIDOS.includes(modo)) {
      return 'Debes elegir cómo quieres buscar la Compra Ágil.';
    }
    if (modo === 'codigo' && !codigoExterno?.trim()) {
      return 'Debes ingresar el código de la Compra Ágil.';
    }
    if (modo === 'listado' && estados && estados.length > 0) {
      const invalido = estados.find((e) => !ESTADOS_COMPRA_AGIL_VALIDOS.includes(e));
      if (invalido) return `Estado inválido: ${invalido}`;
    }
  }

  return null;
}

// GET /api/busquedas — lista las búsquedas guardadas del usuario
router.get('/', async (req, res) => {
  try {
    const busquedas = await listarBusquedasDeUsuario(req.userId);
    res.json({ busquedas: await adjuntarNombresOrganismos(busquedas) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar las búsquedas guardadas' });
  }
});

// POST /api/busquedas — crea una nueva búsqueda guardada
router.post('/', async (req, res) => {
  const {
    nombre, tipo, modo, codigoExterno, estado, fecha, rutProveedor,
    textoLibre, estados, horasRecientes, regiones, organismos: organismosNombres,
  } = req.body;

  const errorCampos = validarCampos(req.body);
  if (errorCampos) {
    return res.status(400).json({ error: errorCampos });
  }

  const limites = obtenerPlan(req.usuarioActual.plan);
  const limiteBusquedas = limites?.limiteBusquedas ?? 5;

  try {
    const totalActuales = await contarBusquedasDeUsuario(req.userId);
    if (totalActuales >= limiteBusquedas) {
      return res.status(400).json({
        error: `Tu plan (${req.usuarioActual.plan}) permite guardar hasta ${limiteBusquedas} búsqueda${limiteBusquedas === 1 ? '' : 's'}. Elimina alguna antes de crear una nueva.`,
      });
    }

    // El picker manda NOMBRES (no cambia el frontend) — se traducen a código,
    // mismo criterio que alert_configs.organismos (migración 032). Solo aplica
    // al modo 'organismo' de Licitaciones (Compra Ágil ya no filtra por
    // organismo, ver migración 034).
    const organismos = (modo === 'organismo')
      ? await traducirOrganismosACodigos(organismosNombres)
      : null;

    const busqueda = await crearBusqueda(req.userId, {
      nombre: nombre.trim(),
      tipo,
      modo,
      codigoExterno: modo === 'codigo' ? codigoExterno.trim() : null,
      estado: (tipo === 'licitacion' && modo === 'estado_fecha') ? (estado || 'todos') : null,
      fecha: (tipo === 'licitacion' && modo !== 'codigo') ? (fecha || null) : null,
      rutProveedor: modo === 'proveedor' ? rutProveedor : null,
      textoLibre: (tipo === 'compra_agil' && modo === 'listado') ? (textoLibre || null) : null,
      estados: (tipo === 'compra_agil' && modo === 'listado') ? estados : null,
      horasRecientes: (tipo === 'compra_agil' && modo === 'listado') ? (horasRecientes || null) : null,
      regiones: (tipo === 'compra_agil' && modo === 'listado') ? regiones : null,
      organismos,
    });
    res.status(201).json({ busqueda: await adjuntarNombresOrganismos(busqueda) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear la búsqueda' });
  }
});

// DELETE /api/busquedas/:id
router.delete('/:id', async (req, res) => {
  try {
    const eliminada = await eliminarBusqueda(req.params.id, req.userId);
    if (!eliminada) {
      return res.status(404).json({ error: 'Búsqueda no encontrada' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la búsqueda' });
  }
});

// POST /api/busquedas/:id/ejecutar — corre la búsqueda contra la API en vivo
// que corresponda (ver busqueda-ejecutor.service.js). `numeroPagina` es
// opcional (default 1) — solo Compra Ágil en modo 'listado' pagina de verdad;
// el frontend lo manda cuando el usuario avanza el paginador de resultados.
router.post('/:id/ejecutar', async (req, res) => {
  try {
    const busqueda = await obtenerBusquedaPorId(req.params.id, req.userId);
    if (!busqueda) {
      return res.status(404).json({ error: 'Búsqueda no encontrada' });
    }

    const numeroPagina = Number(req.body?.numeroPagina) || 1;
    const resultado = await ejecutarBusqueda(busqueda, { numeroPagina });

    res.json({
      busqueda: await adjuntarNombresOrganismos(busqueda),
      ...resultado,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al ejecutar la búsqueda' });
  }
});

module.exports = router;
