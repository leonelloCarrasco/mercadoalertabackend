/**
 * Protege rutas internas/administrativas con una API key compartida (no un JWT
 * de usuario). Pensado para endpoints que solo tú vas a usar (disparar polling
 * manualmente, etc.), no para usuarios finales de la app.
 *
 * Se espera el header: x-admin-key: <valor de ADMIN_API_KEY en tu .env>
 */
function requireAdminKey(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY;

  if (!adminKey) {
    console.error('⚠️  ADMIN_API_KEY no está configurada en .env — las rutas de admin quedan bloqueadas por seguridad.');
    return res.status(503).json({ error: 'Rutas de administración no disponibles: falta configuración del servidor.' });
  }

  const keyRecibida = req.headers['x-admin-key'];

  if (!keyRecibida || keyRecibida !== adminKey) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  next();
}

module.exports = { requireAdminKey };
