const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const {
  crearUsuario,
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  buscarUsuarioPorEmpresaId,
  actualizarPasswordUsuario,
  actualizarDatosUsuario,
  actualizarEstadoUsuario,
  eliminarUsuario,
  obtenerPasswordHash,
} = require('../db/queries');
const {
  crearEmpresa,
  buscarEmpresaPorRut,
  eliminarEmpresa,
  guardarSuscripcionMercadoPago,
} = require('../db/empresas.queries');
const { obtenerPlan } = require('../utils/planes');
const {
  crearTokenReset,
  buscarTokenResetVigente,
  marcarTokenResetUsado,
  invalidarTokensResetDeUsuario,
  crearTokenConfirmacionCuenta,
  buscarTokenConfirmacionVigente,
} = require('../db/password-reset.queries');
const { enviarEmailAlerta, armarEmailRecuperacion, armarEmailConfirmacionCuenta } = require('../services/email.service');
const { validarProveedor } = require('../services/validacion-proveedor.service');
const { crearSuscripcion } = require('../services/mercadopago.service');
const { verificarCaptcha } = require('../utils/captcha');
const { requireAuth } = require('../middleware/auth.middleware');
const { validarRut, normalizarRut } = require('../utils/rut');
const {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
} = require('../middleware/rate-limit.middleware');

const router = express.Router();
const SALT_ROUNDS = 10;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora
const CONFIRMACION_TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 horas
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mercadoalerta.cl';

function generarTokenAleatorio() {
  return crypto.randomBytes(32).toString('hex');
}

function hashearToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generarToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

/**
 * Si ya existe una empresa/usuario con el mismo RUT o el mismo email, pero
 * ese usuario nunca llegó a estado 'activo' (registro abandonado a mitad de
 * camino: nunca confirmó el correo, o nunca completó el pago), se elimina
 * para dejar el RUT/email libres y permitir un nuevo intento. Si el usuario
 * SÍ está activo, devuelve un mensaje de conflicto para que el caller responda 409.
 */
async function liberarRegistroAbandonadoSiCorresponde({ empresaExistente, usuarioPorEmail }) {
  const candidatos = [];

  if (empresaExistente) {
    const usuarioDeEmpresa = await buscarUsuarioPorEmpresaId(empresaExistente.id);
    if (usuarioDeEmpresa) candidatos.push(usuarioDeEmpresa);
  }
  if (usuarioPorEmail) candidatos.push(usuarioPorEmail);

  for (const usuario of candidatos) {
    if (usuario.estado === 'activo') {
      return { conflicto: true };
    }
  }

  // Ninguno está activo: son intentos abandonados, se limpian (usuario primero,
  // por la FK NOT NULL de users.empresa_id, y solo la empresa si nadie más la usa).
  const empresaIdsEliminadas = new Set();
  for (const usuario of candidatos) {
    await eliminarUsuario(usuario.id);
    if (!empresaIdsEliminadas.has(usuario.empresa_id)) {
      await eliminarEmpresa(usuario.empresa_id);
      empresaIdsEliminadas.add(usuario.empresa_id);
    }
  }

  return { conflicto: false };
}

// POST /auth/register
router.post('/register', registerLimiter, async (req, res) => {
  const {
    nombre, apellido, email, telefono, rutEmpresa,
    password, passwordConfirm, aceptaTerminos, plan, captchaToken,
  } = req.body;

  if (!nombre || !apellido || !email || !telefono || !rutEmpresa || !password || !passwordConfirm) {
    return res.status(400).json({
      error: 'Nombre, Apellido, Email, Teléfono, RUT de Empresa, Contraseña y Confirmación de Contraseña son obligatorios',
    });
  }

  if (password !== passwordConfirm) {
    return res.status(400).json({ error: 'Las contraseñas no coinciden' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  if (!aceptaTerminos) {
    return res.status(400).json({ error: 'Debes aceptar los Términos y Condiciones para crear tu cuenta' });
  }

  if (!validarRut(rutEmpresa)) {
    return res.status(400).json({ error: 'El RUT ingresado no es válido. Verifica el formato (ej. 12.345.678-9).' });
  }

  const configPlan = obtenerPlan(plan);
  if (!configPlan) {
    return res.status(400).json({ error: 'Plan inválido. Debe ser trial, basico o full.' });
  }

  const captchaOk = await verificarCaptcha(captchaToken, req.ip);
  if (!captchaOk) {
    return res.status(400).json({ error: 'No pudimos verificar que eres una persona. Intenta nuevamente.' });
  }

  // Normalizamos el email para que "Test@Empresa.cl" y "test@empresa.cl" sean
  // tratados como la misma cuenta — evita duplicados y problemas de login por
  // diferencias de mayúsculas/minúsculas o espacios accidentales.
  const emailNormalizado = email.trim().toLowerCase();
  const rutNormalizado = normalizarRut(rutEmpresa);

  try {
    const empresaExistente = await buscarEmpresaPorRut(rutNormalizado);
    const usuarioPorEmail = await buscarUsuarioPorEmail(emailNormalizado);

    if (empresaExistente || usuarioPorEmail) {
      const { conflicto } = await liberarRegistroAbandonadoSiCorresponde({ empresaExistente, usuarioPorEmail });
      if (conflicto) {
        return res.status(409).json({
          error: 'Ya existe una cuenta activa con ese RUT de empresa o ese email.',
        });
      }
    }

    // Validamos el RUT contra Mercado Público UNA vez, acá mismo, y de ahí
    // sacamos el nombre oficial de la empresa (ya no hay pre-registro separado).
    const validacion = await validarProveedor(rutEmpresa);

    if (validacion.valido !== true) {
      if (validacion.valido === false) {
        return res.status(400).json({
          error: 'No encontramos este RUT como proveedor inscrito en Mercado Público. Verifica que esté bien escrito, o inscríbete primero en mercadopublico.cl.',
        });
      }
      return res.status(503).json({
        error: 'No pudimos validar el RUT en este momento porque Mercado Público no respondió. Intenta nuevamente en unos minutos.',
      });
    }

    const fechaExpiracionTrial = configPlan.diasTrial
      ? new Date(Date.now() + configPlan.diasTrial * 24 * 60 * 60 * 1000)
      : null;

    const empresa = await crearEmpresa({
      rut: rutNormalizado,
      nombreEmpresa: validacion.nombreEmpresa,
      plan,
      montoMensual: configPlan.monto,
      fechaExpiracionTrial,
      estadoPago: configPlan.requierePago ? 'pendiente' : 'activo',
    });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const usuario = await crearUsuario({
      email: emailNormalizado,
      passwordHash,
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      telefono: telefono.trim(),
      empresaId: empresa.id,
      aceptaTerminos: true,
    });

    const token = generarTokenAleatorio();
    const tokenHash = hashearToken(token);
    const expiresAt = new Date(Date.now() + CONFIRMACION_TOKEN_TTL_MS);
    await crearTokenConfirmacionCuenta(usuario.id, tokenHash, expiresAt);

    const link = `${FRONTEND_URL}/confirmar-cuenta.html?token=${token}`;
    const { subject, html } = armarEmailConfirmacionCuenta(link, usuario.nombre);
    await enviarEmailAlerta({ to: usuario.email, subject, html });

    res.status(201).json({
      mensaje: 'Te enviamos un correo para confirmar tu cuenta. Revisa tu bandeja de entrada (y spam).',
    });
  } catch (err) {
    if (err.code === 'P0001') {
      // Respaldo atómico del trigger de Postgres (migración 023), por si hubo
      // una condición de carrera entre el chequeo de arriba y el INSERT real.
      return res.status(409).json({ error: 'Ya existe una cuenta registrada para esta empresa.' });
    }
    console.error('Error en /register:', err);
    res.status(500).json({ error: 'Error interno al registrar el usuario' });
  }
});

// POST /auth/confirmar-cuenta — canjea el token del email de bienvenida.
// Trial: activa la cuenta de inmediato. Basic/Full: pasa a 'pendiente_pago'
// y devuelve la URL de checkout de MercadoPago para continuar el pago.
router.post('/confirmar-cuenta', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'token es obligatorio' });
  }

  try {
    const tokenHash = hashearToken(token);
    const tokenValido = await buscarTokenConfirmacionVigente(tokenHash);

    if (!tokenValido) {
      return res.status(400).json({ error: 'El link de confirmación es inválido o ya venció.' });
    }

    await marcarTokenResetUsado(tokenValido.id);

    const usuario = await buscarUsuarioPorId(tokenValido.user_id);
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const configPlan = obtenerPlan(usuario.plan);

    if (!configPlan?.requierePago) {
      await actualizarEstadoUsuario(usuario.id, 'activo');
      return res.json({
        plan: usuario.plan,
        mensaje: 'Tu cuenta fue confirmada correctamente.',
      });
    }

    await actualizarEstadoUsuario(usuario.id, 'pendiente_pago');

    const suscripcion = await crearSuscripcion({
      emailPagador: usuario.email,
      monto: configPlan.monto,
      referenciaExterna: `empresa-${usuario.empresa_id}`,
      motivo: `MercadoAlerta — Plan ${usuario.plan} (${usuario.nombre_empresa || usuario.rut_empresa})`,
    });

    await guardarSuscripcionMercadoPago(usuario.empresa_id, suscripcion.id);

    res.json({
      plan: usuario.plan,
      mensaje: 'Tu correo fue confirmado. Ahora completa el pago para activar tu cuenta.',
      checkoutUrl: suscripcion.init_point,
    });
  } catch (err) {
    console.error('Error en /confirmar-cuenta:', err);
    res.status(500).json({ error: 'Error interno al confirmar la cuenta' });
  }
});

// POST /auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password, captchaToken } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y Contraseña son obligatorios' });
  }

  const captchaOk = await verificarCaptcha(captchaToken, req.ip);
  if (!captchaOk) {
    return res.status(400).json({ error: 'No pudimos verificar que eres una persona. Intenta nuevamente.' });
  }

  const emailNormalizado = email.trim().toLowerCase();

  try {
    const usuario = await buscarUsuarioPorEmail(emailNormalizado);
    if (!usuario) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const passwordOk = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    if (usuario.estado === 'pendiente_email') {
      return res.status(403).json({
        error: 'Todavía no confirmas tu cuenta. Revisa el correo que te enviamos al registrarte.',
        estado: 'pendiente_email',
      });
    }

    if (usuario.estado === 'pendiente_pago') {
      return res.status(402).json({
        error: 'Tu pago está pendiente. Completa el pago para activar tu cuenta.',
        estado: 'pendiente_pago',
      });
    }

    const token = generarToken(usuario.id);
    res.json({ token });
  } catch (err) {
    console.error('Error en /login:', err);
    res.status(500).json({ error: 'Error interno al iniciar sesión' });
  }
});

// POST /auth/forgot-password
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'email es obligatorio' });
  }

  const emailNormalizado = email.trim().toLowerCase();
  // Respuesta genérica siempre igual, exista o no la cuenta — evita que alguien
  // use este endpoint para averiguar qué emails están registrados.
  const respuestaGenerica = {
    mensaje: 'Si el email está registrado, te enviamos un link para recuperar tu contraseña.',
  };

  try {
    const usuario = await buscarUsuarioPorEmail(emailNormalizado);
    if (!usuario) {
      return res.json(respuestaGenerica);
    }

    await invalidarTokensResetDeUsuario(usuario.id);

    const token = generarTokenAleatorio();
    const tokenHash = hashearToken(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await crearTokenReset(usuario.id, tokenHash, expiresAt);

    const link = `${FRONTEND_URL}/reset-password.html?token=${token}`;
    const { subject, html } = armarEmailRecuperacion(link);
    await enviarEmailAlerta({ to: usuario.email, subject, html });

    res.json(respuestaGenerica);
  } catch (err) {
    console.error('Error en /forgot-password:', err);
    res.status(500).json({ error: 'Error interno al procesar la solicitud' });
  }
});

// POST /auth/reset-password
router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Token y Contraseña son obligatorios' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  try {
    const tokenHash = hashearToken(token);
    const tokenReset = await buscarTokenResetVigente(tokenHash);

    if (!tokenReset) {
      return res.status(400).json({ error: 'El link de recuperación es inválido o ya expiró' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await actualizarPasswordUsuario(tokenReset.user_id, passwordHash);
    await marcarTokenResetUsado(tokenReset.id);

    res.json({ mensaje: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('Error en /reset-password:', err);
    res.status(500).json({ error: 'Error interno al restablecer la contraseña' });
  }
});

// GET /auth/me (ruta protegida, requiere JWT)
router.get('/me', requireAuth, async (req, res) => {
  try {
    const usuario = await buscarUsuarioPorId(req.userId);
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json({ usuario });
  } catch (err) {
    console.error('Error en /me:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// PUT /auth/me — actualizar nombre, apellido y telefono (el email queda fijo, no editable)
router.put('/me', requireAuth, async (req, res) => {
  const { nombre, apellido, telefono } = req.body;

  if (!nombre || !apellido || !telefono) {
    return res.status(400).json({ error: 'Nombre, Apellido y Teléfono son obligatorios' });
  }

  try {
    const usuario = await actualizarDatosUsuario(req.userId, nombre.trim(), apellido.trim(), telefono.trim());
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json({ usuario });
  } catch (err) {
    console.error('Error en PUT /me:', err);
    res.status(500).json({ error: 'Error interno al actualizar el perfil' });
  }
});

// PUT /auth/me/password — cambiar contraseña, pidiendo la actual como confirmación
router.put('/me/password', requireAuth, async (req, res) => {
  const { passwordActual, passwordNueva } = req.body;

  if (!passwordActual || !passwordNueva) {
    return res.status(400).json({ error: 'Contraseñas actual y nueva son obligatorias' });
  }

  if (passwordNueva.length < 8) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
  }

  try {
    const hashActual = await obtenerPasswordHash(req.userId);
    if (!hashActual) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const passwordOk = await bcrypt.compare(passwordActual, hashActual);
    if (!passwordOk) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    }

    const nuevoHash = await bcrypt.hash(passwordNueva, SALT_ROUNDS);
    await actualizarPasswordUsuario(req.userId, nuevoHash);
    res.json({ mensaje: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('Error en PUT /me/password:', err);
    res.status(500).json({ error: 'Error interno al cambiar la contraseña' });
  }
});

module.exports = router;
