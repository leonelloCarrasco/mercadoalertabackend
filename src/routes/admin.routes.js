const express = require('express');
const { correrPollingLicitaciones } = require('../jobs/poll-licitaciones');
const { correrPollingCompraAgil } = require('../jobs/poll-compra-agil');
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

module.exports = router;
