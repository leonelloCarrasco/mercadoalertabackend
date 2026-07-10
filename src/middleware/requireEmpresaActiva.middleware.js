const { buscarUsuarioPorId } = require('../db/queries');

/**
 * Debe usarse DESPUÉS de requireAuth (necesita req.userId ya seteado).
 * Bloquea el acceso si:
 * - La empresa está en un plan pago pero el pago no está 'activo' (pendiente,
 *   o cualquier otro estado que no sea "ya confirmado").
 * - La empresa está en trial y su fecha_expiracion_trial ya pasó.
 */
async function requireEmpresaActiva(req, res, next) {
  try {
    const usuario = await buscarUsuarioPorId(req.userId);
    if (!usuario) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    if (usuario.estado_pago !== 'activo') {
      return res.status(402).json({
        error: 'Tu empresa tiene un pago pendiente. Completa el pago para seguir usando MercadoAlerta.',
      });
    }

    if (usuario.plan === 'trial' && usuario.fecha_expiracion_trial && new Date(usuario.fecha_expiracion_trial) < new Date()) {
      return res.status(402).json({
        error: 'Tu período de prueba de 14 días terminó. Actualiza tu plan para seguir usando MercadoAlerta.',
        trialVencido: true,
      });
    }

    // Dejamos el usuario ya consultado disponible para las rutas siguientes
    // (ej. alerts.routes.js lo usa para saber los límites de su plan),
    // evitando una segunda consulta idéntica a la base de datos.
    req.usuarioActual = usuario;

    next();
  } catch (err) {
    console.error('Error en requireEmpresaActiva:', err);
    res.status(500).json({ error: 'Error interno' });
  }
}

module.exports = { requireEmpresaActiva };
