const express = require('express');
const { validarRut, normalizarRut } = require('../utils/rut');
const { validarProveedor } = require('../services/validacion-proveedor.service');
const { obtenerPlan } = require('../utils/planes');
const { crearSuscripcion } = require('../services/mercadopago.service');
const {
  crearEmpresa,
  buscarEmpresaPorRut,
  buscarEmpresaPorId,
  guardarSuscripcionMercadoPago,
  actualizarPlanEmpresa,
} = require('../db/empresas.queries');
const { registerLimiter } = require('../middleware/rate-limit.middleware');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// POST /api/empresas/pre-registro — autoservicio: cualquiera puede pre-registrar
// su empresa dando el RUT. Se valida UNA vez contra Mercado Público acá; los
// usuarios que se registren después bajo esta empresa no vuelven a validar.
//
// Trial: queda activa de inmediato, por 14 días (ver fecha_expiracion_trial).
// Pasado ese plazo, la empresa se bloquea hasta hacer upgrade a un plan pago
// (ver POST /:id/upgrade y el middleware requireEmpresaActiva).
//
// Basic/Full: queda en estado_pago='pendiente' y se devuelve un checkoutUrl
// al que hay que redirigir para completar el pago.
router.post('/pre-registro', registerLimiter, async (req, res) => {
  const {
    rut, plan, declaraEmt,
    responsableNombre, responsableApellido, emailContacto, telefonoContacto,
  } = req.body;

  if (!rut) {
    return res.status(400).json({ error: 'rut es obligatorio' });
  }

  const configPlan = obtenerPlan(plan);
  if (!configPlan) {
    return res.status(400).json({ error: 'Plan inválido. Debe ser trial, basico o full.' });
  }

  if (!responsableNombre || !responsableApellido || !emailContacto || !telefonoContacto) {
    return res.status(400).json({
      error: 'Nombre, apellido, email y teléfono del responsable son obligatorios.',
    });
  }

  if (!declaraEmt) {
    return res.status(400).json({
      error: 'Debes declarar que tu empresa es EMT (Empresa de Menor Tamaño) para registrarte.',
    });
  }

  if (!validarRut(rut)) {
    return res.status(400).json({ error: 'El RUT ingresado no es válido. Verifica el formato (ej. 12.345.678-9).' });
  }

  const rutNormalizado = normalizarRut(rut);

  try {
    const existente = await buscarEmpresaPorRut(rutNormalizado);
    if (existente) {
      return res.status(409).json({
        error: 'Esta empresa ya está registrada. Si eres parte de ella, pide a un usuario existente que te sume, o crea tu cuenta directamente si ya tienes cupo.',
      });
    }

    // Igual criterio estricto que definimos para el registro de usuario:
    // se bloquea tanto si el RUT no aparece como proveedor, como si Mercado
    // Público no responde en este momento (ver auth.routes.js para la misma lógica).
    const validacion = await validarProveedor(rut);

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
      rutValidado: true,
      declaraEmt: Boolean(declaraEmt),
      responsableNombre: responsableNombre.trim(),
      responsableApellido: responsableApellido.trim(),
      emailContacto: emailContacto.trim().toLowerCase(),
      telefonoContacto: telefonoContacto.trim(),
      plan,
      montoMensual: configPlan.monto,
      fechaExpiracionTrial,
      estadoPago: configPlan.requierePago ? 'pendiente' : 'activo',
    });

    // Plan trial: no requiere pago, la empresa ya quedó activa por 14 días.
    if (!configPlan.requierePago) {
      return res.status(201).json({ empresa });
    }

    // Plan pago: crear la suscripción en MercadoPago (o simulada si no hay
    // credenciales todavía) y devolver la URL de checkout.
    const suscripcion = await crearSuscripcion({
      emailPagador: emailContacto.trim().toLowerCase(),
      monto: configPlan.monto,
      referenciaExterna: `empresa-${empresa.id}`,
      motivo: `MercadoAlerta — Plan ${plan} (${empresa.nombre_empresa || empresa.rut})`,
    });

    await guardarSuscripcionMercadoPago(empresa.id, suscripcion.id);

    res.status(201).json({ empresa, checkoutUrl: suscripcion.init_point });
  } catch (err) {
    console.error('Error en /empresas/pre-registro:', err);
    res.status(500).json({ error: 'Error interno al pre-registrar la empresa' });
  }
});

// POST /api/empresas/:id/upgrade — pasa una empresa (típicamente trial,
// vencido o no) a un plan pago. Requiere estar logueado como parte de esa
// misma empresa (no se puede hacer upgrade de una empresa ajena).
router.post('/:id/upgrade', requireAuth, async (req, res) => {
  const { plan } = req.body;
  const empresaId = req.params.id;

  const configPlan = obtenerPlan(plan);
  if (!configPlan || !configPlan.requierePago) {
    return res.status(400).json({ error: 'Plan inválido. Debe ser basico o full.' });
  }

  try {
    const empresa = await buscarEmpresaPorId(empresaId);
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    // req.userId es del usuario logueado — confirmamos que pertenece a esta empresa
    // (esto requiere traer el empresa_id del usuario; se hace vía el propio JWT
    // más una consulta rápida, para no permitir upgrades de empresas ajenas).
    const { buscarUsuarioPorId } = require('../db/queries');
    const usuario = await buscarUsuarioPorId(req.userId);
    if (!usuario || usuario.rut_empresa !== empresa.rut) {
      return res.status(403).json({ error: 'No tienes permiso para modificar esta empresa.' });
    }

    const empresaActualizada = await actualizarPlanEmpresa(empresaId, {
      plan,
      montoMensual: configPlan.monto,
    });

    const suscripcion = await crearSuscripcion({
      emailPagador: empresa.email_contacto,
      monto: configPlan.monto,
      referenciaExterna: `empresa-${empresa.id}`,
      motivo: `MercadoAlerta — Plan ${plan} (${empresa.nombre_empresa || empresa.rut})`,
    });

    await guardarSuscripcionMercadoPago(empresa.id, suscripcion.id);

    res.json({ empresa: empresaActualizada, checkoutUrl: suscripcion.init_point });
  } catch (err) {
    console.error('Error en /empresas/:id/upgrade:', err);
    res.status(500).json({ error: 'Error interno al actualizar el plan' });
  }
});

module.exports = router;
