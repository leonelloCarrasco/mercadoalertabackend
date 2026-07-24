const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

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

/**
 * A diferencia de los de arriba, este NO limita por IP — limita por
 * usuario (req.userId, ya seteado por requireAuth antes de llegar acá).
 * Tiene sentido acá puntualmente: el riesgo real no es tráfico anónimo
 * (esta ruta ya exige estar logueado), sino un usuario autenticado
 * bombardeando el endpoint con archivos basura — la cuota mensual de
 * análisis NO lo frena, porque un archivo que falla la extracción (ej. PDF
 * escaneado) o que no coincide con el código (mismatch) no gasta cupo, así
 * que sin esto se podría repetir indefinidamente, gastando CPU en cada
 * intento de extracción de texto.
 *
 * El límite es generoso a propósito (20/hora) — deja margen para probar
 * varios archivos de buena fe (ej. el flujo de "¿continuar de todas
 * formas?" ya implica 2 requests) sin frenar a nadie real.
 */
const analisisIaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req.ip),
  handler: mensajeError('Demasiados análisis intentados en poco tiempo. Intenta de nuevo más tarde.'),
});

// Igual que contactoAyudaLimiter: dispara un correo real a una dirección que
// el propio usuario logueado puede elegir libremente (POST /:id/enviar-correo,
// campo `email` del body) — sin límite, un usuario autenticado podría usarlo
// para bombardear repetidamente cualquier casilla ajena con el contenido de
// su análisis. Se limita por usuario (no por IP), mismo criterio que
// analisisIaLimiter.
const enviarCorreoAnalisisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req.ip),
  handler: mensajeError('Demasiados correos enviados. Intenta de nuevo más tarde.'),
});

module.exports = {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  reenviarConfirmacionLimiter,
  contactoAyudaLimiter,
  analisisIaLimiter,
  enviarCorreoAnalisisLimiter,
};
