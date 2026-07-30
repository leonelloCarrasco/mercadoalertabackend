const express = require('express');
const { PLANES } = require('../utils/planes');

const router = express.Router();

/**
 * GET /api/planes — endpoint público (sin requireAuth a propósito): el
 * landing necesita mostrar precios y cuotas ANTES de que alguien tenga
 * sesión, y el dashboard también lo consume para no volver a hardcodear
 * los mismos números ahí. planes.js sigue siendo la única fuente de verdad
 * — esto es solo una vidriera de lectura sobre esos datos, no hay ningún
 * campo interno/sensible en PLANES que no debería ser público (son
 * precios y cuotas, información que de todas formas ya se muestra en el
 * sitio).
 */
router.get('/', (req, res) => {
  res.json({ planes: PLANES });
});

module.exports = router;
