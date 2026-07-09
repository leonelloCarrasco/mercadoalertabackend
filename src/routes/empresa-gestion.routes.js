const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { buscarEmpresaPorRut, buscarEmpresaPorId, actualizarContactoEmpresa } = require('../db/empresas.queries');
const {
  crearTokenAccesoEmpresa,
  buscarTokenAccesoEmpresaVigente,
  marcarTokenResetUsado,
  invalidarTokensAccesoDeEmpresa,
} = require('../db/password-reset.queries');
const { enviarEmailAlerta, armarEmailAccesoEmpresa } = require('../services/email.service');
const { requireEmpresaSession } = require('../middleware/requireEmpresaSession.middleware');
const { normalizarRut, validarRut } = require('../utils/rut');
const { forgotPasswordLimiter } = require('../middleware/rate-limit.middleware');

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mercadoalerta.cl';
const ACCESO_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutos
const EMPRESA_SESSION_TTL = '2h';

function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashearToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// POST /api/empresas/solicitar-acceso — magic link, sin password.
// Requiere email + RUT porque el RUT no es secreto (queda en el pre-registro
// público), así que el email actuando como segundo factor es lo que realmente
// protege el acceso — por eso se exige que coincida con el email_contacto guardado.
router.post('/solicitar-acceso', forgotPasswordLimiter, async (req, res) => {
  const { email, rut } = req.body;

  if (!email || !rut) {
    return res.status(400).json({ error: 'email y rut son obligatorios' });
  }

  if (!validarRut(rut)) {
    return res.status(400).json({ error: 'El RUT ingresado no es válido. Verifica el formato (ej. 12.345.678-9).' });
  }

  // Respuesta genérica siempre igual, exista o no la combinación — mismo
  // criterio anti-enumeración que /auth/forgot-password.
  const respuestaGenerica = {
    mensaje: 'Si los datos coinciden con una empresa registrada, te enviamos un link de acceso a tu email.',
  };

  try {
    const rutNormalizado = normalizarRut(rut);
    const empresa = await buscarEmpresaPorRut(rutNormalizado);

    if (!empresa || empresa.email_contacto?.toLowerCase() !== email.trim().toLowerCase()) {
      return res.json(respuestaGenerica);
    }

    await invalidarTokensAccesoDeEmpresa(empresa.id);

    const token = generarToken();
    const tokenHash = hashearToken(token);
    const expiresAt = new Date(Date.now() + ACCESO_TOKEN_TTL_MS);
    await crearTokenAccesoEmpresa(empresa.id, tokenHash, expiresAt);

    const link = `${FRONTEND_URL}/gestion-empresa.html?token=${token}`;
    const { subject, html } = armarEmailAccesoEmpresa(link, empresa.nombre_empresa);
    await enviarEmailAlerta({ to: empresa.email_contacto, subject, html });

    res.json(respuestaGenerica);
  } catch (err) {
    console.error('Error en /empresas/solicitar-acceso:', err);
    res.status(500).json({ error: 'Error interno al procesar la solicitud' });
  }
});

// POST /api/empresas/verificar-acceso — canjea el token del email por una
// sesión de gestión de empresa (JWT propio, independiente del de usuarios).
router.post('/verificar-acceso', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'token es obligatorio' });
  }

  try {
    const tokenHash = hashearToken(token);
    const tokenValido = await buscarTokenAccesoEmpresaVigente(tokenHash);

    if (!tokenValido) {
      return res.status(400).json({ error: 'El link es inválido o ya venció. Solicita uno nuevo.' });
    }

    await marcarTokenResetUsado(tokenValido.id);

    const empresaJwt = jwt.sign(
      { empresaId: tokenValido.empresa_id, tipo: 'empresa_session' },
      process.env.JWT_SECRET,
      { expiresIn: EMPRESA_SESSION_TTL }
    );

    res.json({ token: empresaJwt });
  } catch (err) {
    console.error('Error en /empresas/verificar-acceso:', err);
    res.status(500).json({ error: 'Error interno al verificar el acceso' });
  }
});

// GET /api/empresas/gestion/me — datos de la empresa para el panel de gestión.
router.get('/gestion/me', requireEmpresaSession, async (req, res) => {
  try {
    const empresa = await buscarEmpresaPorId(req.empresaId);
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }
    res.json({ empresa });
  } catch (err) {
    console.error('Error en /empresas/gestion/me:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// PUT /api/empresas/gestion/contacto — edita nombre/apellido/email/teléfono
// del responsable. RUT y nombre de la empresa NO son editables acá (son datos
// validados contra Mercado Público, cambiarlos requeriría re-validar).
router.put('/gestion/contacto', requireEmpresaSession, async (req, res) => {
  const { responsableNombre, responsableApellido, emailContacto, telefonoContacto } = req.body;

  if (!responsableNombre || !responsableApellido || !emailContacto || !telefonoContacto) {
    return res.status(400).json({ error: 'Todos los campos de contacto son obligatorios' });
  }

  try {
    const empresa = await actualizarContactoEmpresa(req.empresaId, {
      responsableNombre: responsableNombre.trim(),
      responsableApellido: responsableApellido.trim(),
      emailContacto: emailContacto.trim().toLowerCase(),
      telefonoContacto: telefonoContacto.trim(),
    });
    res.json({ empresa });
  } catch (err) {
    console.error('Error en PUT /empresas/gestion/contacto:', err);
    res.status(500).json({ error: 'Error interno al actualizar el contacto' });
  }
});

module.exports = router;
