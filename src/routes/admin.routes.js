const express = require('express');
const { correrPollingLicitaciones } = require('../jobs/poll-licitaciones');
const { correrPollingCompraAgil } = require('../jobs/poll-compra-agil');
const { correrRevisionResoluciones } = require('../jobs/revisar-resoluciones');
const { correrCargaHistoricaCompraAgil } = require('../jobs/carga-historica-compra-agil');
const { requireAdminKey } = require('../middleware/admin.middleware');

const router = express.Router();
router.use(requireAdminKey);

router.post('/poll-licitaciones', async (req, res) => {
  try {
    const limite = req.query.limite ? parseInt(req.query.limite, 10) : undefined;
    const nuevas = await correrPollingLicitaciones({ limite });
    res.json({ nuevasEncontradas: nuevas.length, detalle: nuevas.map(n => n.CodigoExterno) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/poll-compra-agil', async (req, res) => {
  try {
    const ttlMs = req.query.ttlMs ? parseInt(req.query.ttlMs, 10) : undefined;
    const nuevas = await correrPollingCompraAgil({ ttlMs });
    res.json({ nuevasEncontradas: nuevas.length, detalle: nuevas.map(n => n.item.codigo) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Dispara manualmente la revisión de licitaciones/Compras Ágiles cerradas
// pendientes de adjudicación, sin esperar al cron de las 03:00. Puede tardar
// varios minutos si hay muchas licitaciones pendientes (delay de 3s c/u).
router.post('/revisar-resoluciones', async (req, res) => {
  try {
    const limiteLicitaciones = req.query.limite ? parseInt(req.query.limite, 10) : undefined;
    await correrRevisionResoluciones({ limiteLicitaciones });
    res.json({ mensaje: 'Revisión completada. Ver logs del servidor para el detalle.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Carga histórica de Compras Ágiles — recorre día por día desde el
// 01/05/2026 hasta hoy (ver FECHA_INICIO_CARGA_HISTORICA en el job),
// cargando el DETALLE completo de lo que todavía no esté en la base.
// Pensado para completar lo que quedó a medias de una carga masiva anterior
// por archivo (que no traía toda la información).
//
// A diferencia de los otros 3 endpoints de acá arriba, este NO espera a que
// termine — responde al toque y sigue corriendo en segundo plano. Puede
// tardar mucho más que cualquier timeout razonable de un request HTTP
// (recorre potencialmente cientos de días). Ver el progreso real en los
// logs del servidor. Se corta solo al agotar la cuota diaria de la API —
// hay que volver a llamar este mismo endpoint al día siguiente para seguir
// (arranca del mismo día siempre, pero los días ya completos pasan rápido
// porque no tienen nada nuevo que cargar).
router.post('/carga-historica-compra-agil', (req, res) => {
  res.json({ mensaje: 'Carga histórica iniciada en segundo plano. Revisa los logs del servidor para ver el progreso.' });
  correrCargaHistoricaCompraAgil().catch((err) => {
    console.error('[carga-historica] Error no manejado:', err);
  });
});

module.exports = router;
