const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const {
  crearUsuario,
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  actualizarPasswordUsuario,
  actualizarNombreApellido,
  obtenerPasswordHash,
} = require('../db/queries');
const { buscarEmpresaPorRut, contarUsuariosDeEmpresa } = require('../db/empresas.queries');
const { obtenerPlan } = require('../utils/planes');
const {
  crearTokenReset,
  buscarTokenResetVigente,
  marcarTokenResetUsado,
  invalidarTokensResetDeUsuario,
} = require('../db/password-reset.queries');
const { enviarEmailAlerta, armarEmailRecuperacion } = require('../services/email.service');
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
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://dashboard.mercadoalerta.cl';

function generarTokenReset() {
  return crypto.randomBytes(32).toString('hex');
}

function hashearToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Los límites por plan ahora viven en src/utils/planes.js (fuente única,
// compartida con empresas.routes.js).

function generarToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// POST /auth/register
router.post('/register', registerLimiter, async (req, res) => {
  const { email, password, nombre, apellido, rutEmpresa } = req.body;

  if (!email || !password || !nombre || !apellido || !rutEmpresa) {
    return res.status(400).json({ error: 'email, password, nombre, apellido y rutEmpresa son obligatorios' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  if (!validarRut(rutEmpresa)) {
    return res.status(400).json({ error: 'El RUT ingresado no es válido. Verifica el formato (ej. 12.345.678-9).' });
  }

  // Normalizamos el email para que "Test@Empresa.cl" y "test@empresa.cl" sean
  // tratados como la misma cuenta — evita duplicados y problemas de login por
  // diferencias de mayúsculas/minúsculas o espacios accidentales.
  const emailNormalizado = email.trim().toLowerCase();
  const rutNormalizado = normalizarRut(rutEmpresa);

  try {
    const existente = await buscarUsuarioPorEmail(emailNormalizado);
    if (existente) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });
    }

    // La empresa ya debe existir (pre-registrada y validada contra Mercado Público
    // vía POST /api/empresas/pre-registro) — acá NO se vuelve a validar el RUT,
    // eso pasa una sola vez al pre-registrar la empresa.
    const empresa = await buscarEmpresaPorRut(rutNormalizado);
    if (!empresa) {
      return res.status(404).json({
        error: 'Esta empresa todavía no está registrada. Primero debes pre-registrarla con su RUT antes de crear tu cuenta.',
      });
    }

    if (empresa.estado_pago !== 'activo') {
      return res.status(402).json({
        error: 'Esta empresa tiene un pago pendiente. Completa el pago para poder crear usuarios.',
      });
    }

    if (empresa.plan === 'trial' && empresa.fecha_expiracion_trial && new Date(empresa.fecha_expiracion_trial) < new Date()) {
      return res.status(402).json({
        error: 'El período de prueba de esta empresa ya terminó. Debe actualizar a un plan pago antes de crear más usuarios.',
      });
    }

    const usuariosDeEstaEmpresa = await contarUsuariosDeEmpresa(empresa.id);
    const limiteDelPlan = obtenerPlan(empresa.plan)?.limiteUsuarios ?? 1;

    if (usuariosDeEstaEmpresa >= limiteDelPlan) {
      return res.status(409).json({
        error: `Esta empresa ya alcanzó el máximo de ${limiteDelPlan} usuario${limiteDelPlan > 1 ? 's' : ''} para su plan actual.`,
      });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const usuario = await crearUsuario({
      email: emailNormalizado,
      passwordHash,
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      empresaId: empresa.id,
    });

    const token = generarToken(usuario.id);

    res.status(201).json({ usuario, token });
  } catch (err) {
    if (err.code === 'P0001') {
      // Respaldo atómico del trigger de Postgres (migración 007), por si hubo
      // una condición de carrera entre el chequeo de arriba y el INSERT real
      // (dos registros casi simultáneos para la misma empresa).
      return res.status(409).json({ error: 'Esta empresa ya alcanzó el máximo de usuarios para su plan actual.' });
    }
    console.error('Error en /register:', err);
    res.status(500).json({ error: 'Error interno al registrar el usuario' });
  }
});

// POST /auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email y password son obligatorios' });
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

    const token = generarTokenReset();
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
    return res.status(400).json({ error: 'token y password son obligatorios' });
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

// PUT /auth/me — actualizar nombre y apellido (el email queda fijo, no editable)
router.put('/me', requireAuth, async (req, res) => {
  const { nombre, apellido } = req.body;

  if (!nombre || !apellido) {
    return res.status(400).json({ error: 'nombre y apellido son obligatorios' });
  }

  try {
    const usuario = await actualizarNombreApellido(req.userId, nombre.trim(), apellido.trim());
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
    return res.status(400).json({ error: 'passwordActual y passwordNueva son obligatorias' });
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
