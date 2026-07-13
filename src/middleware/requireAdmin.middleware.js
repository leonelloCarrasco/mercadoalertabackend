const { buscarUsuarioPorId } = require('../db/queries');

/**
 * Debe usarse DESPUÉS de requireAuth (necesita req.userId ya seteado). A
 * diferencia de requireEmpresaActiva, NO bloquea por trial vencido o pago
 * pendiente — el panel de administrador tiene que seguir accesible aunque la
 * propia cuenta del admin esté en ese estado.
 *
 * No confundir con admin.middleware.js (requireAdminKey) — ese protege las
 * rutas /api/admin/* de triggers de cron con una API key compartida; este
 * protege el panel de administrador humano (/api/admin-panel/*) con el login
 * normal de usuario, exigiendo además el flag users.es_admin = true
 * (migración 028, se activa a mano en la base de datos).
 */
async function requireAdmin(req, res, next) {
  try {
    const usuario = await buscarUsuarioPorId(req.userId);
    if (!usuario) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    if (!usuario.es_admin) {
      return res.status(403).json({ error: 'No tienes acceso al panel de administrador' });
    }
    req.usuarioActual = usuario;
    next();
  } catch (err) {
    console.error('Error en requireAdmin:', err);
    res.status(500).json({ error: 'Error interno' });
  }
}

module.exports = { requireAdmin };
