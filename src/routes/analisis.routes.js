const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireEmpresaActiva } = require('../middleware/requireEmpresaActiva.middleware');

const router = express.Router();
router.use(requireAuth);
router.use(requireEmpresaActiva); // deja disponible req.usuarioActual

// Mismo criterio temporal que en el frontend (dashboard.js) — sacar 'trial' de
// acá antes de lanzar a producción, es solo para poder probar durante desarrollo.
const PLANES_CON_ANALISIS = ['full', 'trial'];

router.use((req, res, next) => {
  if (!PLANES_CON_ANALISIS.includes(req.usuarioActual.plan)) {
    return res.status(403).json({ error: 'El análisis de datos está disponible en el plan Full.' });
  }
  next();
});

/**
 * GET /api/analisis/precios?codigo=XXXXXXXX
 *
 * Historial de precios de adjudicación para una categoría o producto (mismo
 * código que se usa en las alertas). Usa el MISMO criterio que el matching de
 * alertas (ver algunCodigoCoincide en matching.service.js): si el código
 * termina en "00" es de categoría → coincide por PREFIJO de 6 dígitos (varios
 * productos relacionados). Si no, es un producto específico → coincide EXACTO,
 * para no mezclar precios de productos distintos aunque compartan categoría
 * (ej. "Aspiradoras" vs "Aspiradores combinados para húmedo o seco" comparten
 * los primeros 6 dígitos, pero no tiene sentido comparar sus precios entre sí).
 *
 * Combina dos fuentes:
 * - Licitaciones adjudicadas (licitaciones_vistas.items[].adjudicacion)
 * - Compras Ágiles resueltas (compras_agiles_vistas.proveedores_cotizando[].productos_cotizados[])
 *   — acá se incluyen TODAS las cotizaciones, no solo la ganadora, para poder
 *   comparar qué precio ganó vs. cuáles quedaron afuera.
 */
router.get('/precios', async (req, res) => {
  const codigo = (req.query.codigo || '').trim();

  if (!/^\d{6,8}$/.test(codigo)) {
    return res.status(400).json({ error: 'codigo inválido. Debe ser un código UNSPSC de 6 a 8 dígitos.' });
  }

  const esCategoria = codigo.endsWith('00');
  const condicionCodigo = esCategoria ? "LIKE $1" : "= $1";
  const valorCodigo = esCategoria ? codigo.slice(0, 6) + '%' : codigo;

  try {
    const licitacionesResult = await pool.query(
      `SELECT
         l.codigo_externo,
         l.nombre AS proceso_nombre,
         l.nombre_organismo AS organismo,
         l.fecha_adjudicacion,
         l.numero_oferentes,
         l.url_acta,
         item->>'codigo_producto' AS codigo_producto,
         item->>'nombre_producto' AS nombre_producto,
         item->'adjudicacion'->>'nombre_proveedor' AS proveedor,
         item->'adjudicacion'->>'rut_proveedor' AS rut_proveedor,
         (item->'adjudicacion'->>'monto_unitario')::numeric AS precio_unitario,
         (item->'adjudicacion'->>'cantidad')::numeric AS cantidad
       FROM licitaciones_vistas l, jsonb_array_elements(l.items) AS item
       WHERE l.resuelta = true
         AND item->'adjudicacion'->>'monto_unitario' IS NOT NULL
         AND item->>'codigo_producto' ${condicionCodigo}
       ORDER BY l.fecha_adjudicacion DESC
       LIMIT 200`,
      [valorCodigo]
    );

    const compraAgilResult = await pool.query(
      `SELECT
         c.codigo_externo,
         c.nombre AS proceso_nombre,
         c.nombre_institucion AS organismo,
         c.fecha_cierre AS fecha_adjudicacion,
         prod->>'codigo_producto' AS codigo_producto,
         prod->>'nombre_producto' AS nombre_producto,
         prov->>'razon_social' AS proveedor,
         prov->>'rut_proveedor' AS rut_proveedor,
         (prod->>'precio_unitario')::numeric AS precio_unitario,
         (prod->>'cantidad')::numeric AS cantidad,
         COALESCE((prov->>'proveedor_seleccionado')::int, 0) = 1 AS gano
       FROM compras_agiles_vistas c,
         jsonb_array_elements(c.proveedores_cotizando) AS prov,
         jsonb_array_elements(prov->'productos_cotizados') AS prod
       WHERE c.resuelta = true
         AND prod->>'precio_unitario' IS NOT NULL
         AND prod->>'codigo_producto' ${condicionCodigo}
       ORDER BY c.fecha_cierre DESC
       LIMIT 200`,
      [valorCodigo]
    );

    const registros = [
      ...licitacionesResult.rows.map((r) => ({ ...r, fuente: 'licitacion' })),
      ...compraAgilResult.rows.map((r) => ({ ...r, fuente: 'compra_agil' })),
    ].sort((a, b) => new Date(b.fecha_adjudicacion) - new Date(a.fecha_adjudicacion));

    const precios = registros
      .map((r) => r.precio_unitario)
      .filter((p) => p !== null && p !== undefined)
      .map((p) => Number(p))
      .filter((p) => !Number.isNaN(p));
    const resumen = precios.length > 0 ? {
      cantidadRegistros: precios.length,
      precioMinimo: Math.min(...precios),
      precioMaximo: Math.max(...precios),
      precioPromedio: Math.round(precios.reduce((a, b) => a + b, 0) / precios.length),
    } : null;

    res.json({ resumen, registros });
  } catch (err) {
    console.error('Error en /analisis/precios:', err);
    res.status(500).json({ error: 'Error al consultar el historial de precios' });
  }
});

module.exports = router;
