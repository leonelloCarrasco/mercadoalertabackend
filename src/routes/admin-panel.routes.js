const express = require('express');
const bcrypt = require('bcrypt');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireAdmin } = require('../middleware/requireAdmin.middleware');
const { listarTodosLosUsuarios, actualizarUsuarioCompleto, actualizarPasswordDesdeAdmin } = require('../db/admin-panel.queries');
const { buscarLicitaciones, buscarComprasAgiles, construirItemDesdeDetalleCompraAgil } = require('../services/busqueda-admin.service');
const { obtenerDetallesConDelay } = require('../services/mercadopublico.service');
const { obtenerDetalleCompraAgil, CuotaAgotadaError } = require('../services/compraagil.service');
const { guardarLicitacion } = require('../db/licitaciones.queries');
const { guardarCompraAgil } = require('../db/compra-agil.queries');
const { procesarAlertasLicitaciones, procesarAlertasCompraAgil } = require('../services/alerting.service');

const router = express.Router();

// Panel de administrador humano (login normal + flag users.es_admin), distinto
// de /api/admin/* (esas se protegen con una API key compartida para triggers
// de cron — ver admin.middleware.js). A propósito NO pasa por
// requireEmpresaActiva: el panel tiene que seguir accesible aunque la propia
// cuenta del admin esté en trial vencido o con pago pendiente.
router.use(requireAuth);
router.use(requireAdmin);

const SALT_ROUNDS = 10;

// ---------- Usuarios ----------

router.get('/usuarios', async (req, res) => {
  try {
    const usuarios = await listarTodosLosUsuarios();
    res.json({ usuarios });
  } catch (err) {
    console.error('Error en GET /admin-panel/usuarios:', err);
    res.status(500).json({ error: 'Error al listar usuarios' });
  }
});

/**
 * Actualiza TODOS los campos editables de un usuario (y su empresa). El
 * frontend ya pide confirmación por modal antes de llamar a esto — acá no se
 * vuelve a confirmar nada, se aplica directo.
 *
 * `passwordNueva` es opcional: si viene, resetea la contraseña del usuario
 * (ej. usuario bloqueado que no puede recuperarla solo). El resto de los
 * campos usa COALESCE en la query, así que enviar solo lo que cambió es seguro.
 */
router.put('/usuarios/:id', async (req, res) => {
  const {
    nombre, apellido, email, telefono, estado, esAdmin, aceptaTerminos,
    rutEmpresa, nombreEmpresa, rutValidado, declaraEmt, plan, montoMensual,
    fechaExpiracionTrial, estadoPago, passwordNueva,
  } = req.body;

  try {
    const usuarios = await listarTodosLosUsuarios();
    const usuario = usuarios.find((u) => String(u.id) === String(req.params.id));
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    await actualizarUsuarioCompleto(req.params.id, usuario.empresa_id, {
      nombre, apellido, email, telefono, estado, esAdmin, aceptaTerminos,
      rutEmpresa, nombreEmpresa, rutValidado, declaraEmt, plan, montoMensual,
      fechaExpiracionTrial, estadoPago,
    });

    if (passwordNueva) {
      if (passwordNueva.length < 8) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
      }
      const hash = await bcrypt.hash(passwordNueva, SALT_ROUNDS);
      await actualizarPasswordDesdeAdmin(req.params.id, hash);
    }

    const usuariosActualizados = await listarTodosLosUsuarios();
    const usuarioActualizado = usuariosActualizados.find((u) => String(u.id) === String(req.params.id));
    res.json({ usuario: usuarioActualizado });
  } catch (err) {
    console.error('Error en PUT /admin-panel/usuarios/:id:', err);
    res.status(500).json({ error: 'Error al actualizar el usuario' });
  }
});

// ---------- Buscar e importar Licitaciones ----------

// GET /api/admin-panel/buscar/licitaciones?fecha=DDMMYYYY&codigo=XXX&producto=XXXXXXXX
router.get('/buscar/licitaciones', async (req, res) => {
  const { fecha, codigo, producto } = req.query;

  try {
    const resultado = await buscarLicitaciones({ fecha, codigo, producto });
    res.json(resultado);
  } catch (err) {
    console.error('Error en /admin-panel/buscar/licitaciones:', err);
    res.status(500).json({ error: err.message || 'Error al buscar licitaciones en Mercado Público' });
  }
});

/**
 * POST /api/admin-panel/importar/licitaciones { codigos: ['1234-5-L26', ...] }
 *
 * Trae el detalle fresco de cada código seleccionado (con el delay de 3s que
 * exige la API — puede tardar), lo guarda en licitaciones_vistas, y dispara el
 * matching de alertas configuradas para notificar a los usuarios que corresponda
 * — mismo camino que sigue el polling automático (poll-licitaciones.js), solo
 * que disparado a mano por el admin en vez de por el cron.
 */
router.post('/importar/licitaciones', async (req, res) => {
  const { codigos } = req.body;

  if (!Array.isArray(codigos) || codigos.length === 0) {
    return res.status(400).json({ error: 'codigos debe ser un array con al menos un código' });
  }

  try {
    const detalles = await obtenerDetallesConDelay(codigos);

    for (const detalle of detalles) {
      await guardarLicitacion(detalle);
    }

    await procesarAlertasLicitaciones(detalles);

    const codigosImportados = detalles.map((d) => d.CodigoExterno);
    const fallidos = codigos.filter((c) => !codigosImportados.includes(c));

    res.json({
      importadas: codigosImportados.length,
      codigosImportados,
      codigosFallidos: fallidos,
    });
  } catch (err) {
    console.error('Error en /admin-panel/importar/licitaciones:', err);
    res.status(500).json({ error: err.message || 'Error al importar licitaciones' });
  }
});

// ---------- Buscar e importar Compras Ágiles ----------

// GET /api/admin-panel/buscar/compras-agiles?ventanaDias=N&codigo=XXX&producto=XXXXXXXX
router.get('/buscar/compras-agiles', async (req, res) => {
  const { codigo, producto } = req.query;
  const ventanaDias = req.query.ventanaDias ? parseInt(req.query.ventanaDias, 10) : undefined;

  try {
    const resultado = await buscarComprasAgiles({ ventanaDias, codigo, producto });
    res.json(resultado);
  } catch (err) {
    if (err instanceof CuotaAgotadaError) {
      return res.status(429).json({ error: err.message });
    }
    console.error('Error en /admin-panel/buscar/compras-agiles:', err);
    res.status(500).json({ error: err.message || 'Error al buscar Compras Ágiles en Mercado Público' });
  }
});

/**
 * POST /api/admin-panel/importar/compras-agiles { codigos: ['12345', ...] }
 * Mismo criterio que importar/licitaciones, pero para Compra Ágil — sigue el
 * mismo camino que poll-compra-agil.js (guardarCompraAgil + procesarAlertasCompraAgil).
 */
router.post('/importar/compras-agiles', async (req, res) => {
  const { codigos } = req.body;

  if (!Array.isArray(codigos) || codigos.length === 0) {
    return res.status(400).json({ error: 'codigos debe ser un array con al menos un código' });
  }

  const guardadas = [];
  const fallidos = [];

  try {
    for (const codigo of codigos) {
      try {
        const detalle = await obtenerDetalleCompraAgil(codigo);
        const item = construirItemDesdeDetalleCompraAgil(codigo, detalle);
        await guardarCompraAgil(item, detalle);
        guardadas.push({ item, detalle });
      } catch (err) {
        if (err instanceof CuotaAgotadaError) {
          fallidos.push(...codigos.slice(codigos.indexOf(codigo)));
          break; // se agotó la cuota, no tiene sentido seguir intentando el resto
        }
        console.error(`Error importando Compra Ágil ${codigo}:`, err.message);
        fallidos.push(codigo);
      }
    }

    await procesarAlertasCompraAgil(guardadas);

    res.json({
      importadas: guardadas.length,
      codigosImportados: guardadas.map((g) => g.item.codigo),
      codigosFallidos: fallidos,
    });
  } catch (err) {
    console.error('Error en /admin-panel/importar/compras-agiles:', err);
    res.status(500).json({ error: err.message || 'Error al importar Compras Ágiles' });
  }
});

module.exports = router;
