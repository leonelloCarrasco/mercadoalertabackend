const express = require('express');
const { obtenerPlan } = require('../utils/planes');
const { crearSuscripcion } = require('../services/mercadopago.service');
const {
  buscarEmpresaPorId,
  guardarSuscripcionMercadoPago,
  actualizarPlanEmpresa,
} = require('../db/empresas.queries');
const { buscarUsuarioPorId } = require('../db/queries');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// POST /api/empresas/:id/upgrade — pasa una empresa (típicamente trial,
// vencido o no) a un plan pago. Requiere estar logueado como el usuario de
// esa misma empresa (no se puede hacer upgrade de una empresa ajena).
//
// Este es el único flujo de cambio de plan que queda en este router: el
// registro inicial de empresa+usuario ahora vive todo en POST /auth/register
// (ver auth.routes.js) — ya no existe un pre-registro de empresa separado.
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

    // req.userId es del usuario logueado — confirmamos que pertenece a esta empresa.
    const usuario = await buscarUsuarioPorId(req.userId);
    if (!usuario || usuario.rut_empresa !== empresa.rut) {
      return res.status(403).json({ error: 'No tienes permiso para modificar esta empresa.' });
    }

    const empresaActualizada = await actualizarPlanEmpresa(empresaId, {
      plan,
      montoMensual: configPlan.monto,
    });

    const suscripcion = await crearSuscripcion({
      emailPagador: usuario.email,
      monto: configPlan.monto,
      referenciaExterna: `empresa-${empresa.id}`,
      motivo: `Plan ${plan} — ${empresa.nombre_empresa || empresa.rut}`,
    });

    await guardarSuscripcionMercadoPago(empresa.id, suscripcion.id);

    res.json({ empresa: empresaActualizada, checkoutUrl: suscripcion.init_point });
  } catch (err) {
    console.error('Error en /empresas/:id/upgrade:', err);
    res.status(500).json({ error: 'Error interno al actualizar el plan' });
  }
});

module.exports = router;
