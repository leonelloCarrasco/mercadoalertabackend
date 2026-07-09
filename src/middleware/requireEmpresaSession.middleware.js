const jwt = require('jsonwebtoken');

/**
 * Valida el JWT de sesión del sitio de gestión de empresa. Es un token
 * completamente distinto al de usuarios (auth.middleware.js): lleva
 * { empresaId, tipo: 'empresa_session' } en vez de { userId }, así que
 * un token de usuario nunca sirve acá y viceversa — se verifica explícitamente
 * el claim `tipo` para blindar esa separación, no solo confiar en la firma.
 */
function requireEmpresaSession(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Falta el token de autorización' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.tipo !== 'empresa_session' || !payload.empresaId) {
      return res.status(401).json({ error: 'Token inválido para esta sesión' });
    }

    req.empresaId = payload.empresaId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = { requireEmpresaSession };
