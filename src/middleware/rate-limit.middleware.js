const rateLimit = require('express-rate-limit');

/**
 * Límites por IP para las rutas de autenticación. Los valores buscan un
 * balance entre proteger contra abuso (fuerza bruta, spam de emails) y no
 * molestar a un usuario real que se equivoca un par de veces.
 */

const mensajeError = (mensaje) => (req, res) => {
  res.status(429).json({ error: mensaje });
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: mensajeError('Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos.'),
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: mensajeError('Demasiados intentos de registro desde esta conexión. Intenta de nuevo más tarde.'),
});

// Más estricto que los demás: cada solicitud dispara un email real, así que
// hay que evitar que alguien lo use para spamear la bandeja de un usuario.
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: mensajeError('Demasiadas solicitudes de recuperación. Intenta de nuevo más tarde.'),
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: mensajeError('Demasiados intentos. Intenta de nuevo en unos minutos.'),
});

// Mismo criterio que forgotPasswordLimiter: dispara un email real, hay que
// evitar que sirva para spamear la bandeja de alguien.
const reenviarConfirmacionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: mensajeError('Demasiadas solicitudes de reenvío. Intenta de nuevo más tarde.'),
});

// Es un usuario ya logueado (no anónimo como los de arriba), pero igual
// dispara un correo — un límite más generoso alcanza para frenar un posible
// loop/bug del front sin molestar a alguien que de verdad necesita escribir
// varias veces.
const contactoAyudaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: mensajeError('Demasiados mensajes enviados. Intenta de nuevo más tarde.'),
});

module.exports = {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  reenviarConfirmacionLimiter,
  contactoAyudaLimiter,
};
