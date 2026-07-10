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
 * Valida el código recibido y arma la condición SQL correcta según su formato:
 * - UNSPSC (8 dígitos): categoría (termina en "00") → prefijo de 6 dígitos.
 *   Producto específico → exacto.
 * - Obras (9 dígitos, ver migración 022): siempre exacto — no tiene
 *   sub-jerarquía real, son solo 3 categorías administrativas conocidas.
 * Devuelve null si el código no es válido.
 */
function prepararCondicionCodigo(codigo) {
  if (!/^\d{6,9}$/.test(codigo)) return null;

  if (codigo.length === 9) {
    return { condicionCodigo: '= $1', valorCodigo: codigo };
  }

  const esCategoria = codigo.endsWith('00');
  return {
    condicionCodigo: esCategoria ? 'LIKE $1' : '= $1',
    valorCodigo: esCategoria ? codigo.slice(0, 6) + '%' : codigo,
  };
}

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

  const prep = prepararCondicionCodigo(codigo);
  if (!prep) {
    return res.status(400).json({ error: 'codigo inválido. Debe ser un código de 6 a 9 dígitos.' });
  }
  const { condicionCodigo, valorCodigo } = prep;

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
         COALESCE((prov->>'proveedor_seleccionado')::int, 0) = 1 AS gano,
         prov->>'justificacion_inadmisibilidad' AS motivo_rechazo
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

/**
 * GET /api/analisis/proveedores?codigo=XXXXXXXX
 *
 * Ranking de proveedores que MÁS GANAN en una categoría/producto — solo
 * ganadores (en licitaciones, todo lo que guardamos ya es ganador por
 * definición; en Compra Ágil, se filtra proveedor_seleccionado = 1).
 * Se agrupa por RUT (no por nombre — el nombre puede variar en mayúsculas o
 * espacios entre registros, el RUT es el identificador confiable).
 */
router.get('/proveedores', async (req, res) => {
  const codigo = (req.query.codigo || '').trim();

  const prep = prepararCondicionCodigo(codigo);
  if (!prep) {
    return res.status(400).json({ error: 'codigo inválido. Debe ser un código de 6 a 9 dígitos.' });
  }
  const { condicionCodigo, valorCodigo } = prep;

  try {
    const licitacionesResult = await pool.query(
      `SELECT
         item->'adjudicacion'->>'rut_proveedor' AS rut_proveedor,
         item->'adjudicacion'->>'nombre_proveedor' AS nombre_proveedor,
         (item->'adjudicacion'->>'monto_unitario')::numeric AS precio_unitario,
         'licitacion' AS fuente
       FROM licitaciones_vistas l, jsonb_array_elements(l.items) AS item
       WHERE l.resuelta = true
         AND item->'adjudicacion'->>'monto_unitario' IS NOT NULL
         AND item->>'codigo_producto' ${condicionCodigo}`,
      [valorCodigo]
    );

    const compraAgilResult = await pool.query(
      `SELECT
         prov->>'rut_proveedor' AS rut_proveedor,
         prov->>'razon_social' AS nombre_proveedor,
         (prod->>'precio_unitario')::numeric AS precio_unitario,
         'compra_agil' AS fuente
       FROM compras_agiles_vistas c,
         jsonb_array_elements(c.proveedores_cotizando) AS prov,
         jsonb_array_elements(prov->'productos_cotizados') AS prod
       WHERE c.resuelta = true
         AND COALESCE((prov->>'proveedor_seleccionado')::int, 0) = 1
         AND prod->>'precio_unitario' IS NOT NULL
         AND prod->>'codigo_producto' ${condicionCodigo}`,
      [valorCodigo]
    );

    const ganadores = [...licitacionesResult.rows, ...compraAgilResult.rows]
      .filter((r) => r.rut_proveedor);

    const porRut = {};
    for (const g of ganadores) {
      if (!porRut[g.rut_proveedor]) {
        porRut[g.rut_proveedor] = {
          rutProveedor: g.rut_proveedor,
          nombreProveedor: g.nombre_proveedor,
          vecesGanadas: 0,
          licitaciones: 0,
          compraAgil: 0,
          precios: [],
        };
      }
      const entrada = porRut[g.rut_proveedor];
      entrada.vecesGanadas++;
      entrada[g.fuente === 'licitacion' ? 'licitaciones' : 'compraAgil']++;
      const precio = Number(g.precio_unitario);
      if (!Number.isNaN(precio)) entrada.precios.push(precio);
    }

    const ranking = Object.values(porRut)
      .map((e) => ({
        rutProveedor: e.rutProveedor,
        nombreProveedor: e.nombreProveedor,
        vecesGanadas: e.vecesGanadas,
        licitaciones: e.licitaciones,
        compraAgil: e.compraAgil,
        precioPromedio: e.precios.length > 0
          ? Math.round(e.precios.reduce((a, b) => a + b, 0) / e.precios.length)
          : null,
      }))
      .sort((a, b) => b.vecesGanadas - a.vecesGanadas)
      .slice(0, 50);

    res.json({ ranking });
  } catch (err) {
    console.error('Error en /analisis/proveedores:', err);
    res.status(500).json({ error: 'Error al consultar el ranking de proveedores' });
  }
});

/**
 * GET /api/analisis/rechazos?codigo=XXXXXXXX
 *
 * Razones de rechazo de cotizaciones en Compra Ágil (solo Compra Ágil —
 * licitaciones nunca exponen a los oferentes que perdieron, solo al ganador).
 * Agrupa por el texto de justificacion_inadmisibilidad para responder
 * "¿por qué pierde la gente en esta categoría?".
 */
router.get('/rechazos', async (req, res) => {
  const codigo = (req.query.codigo || '').trim();

  const prep = prepararCondicionCodigo(codigo);
  if (!prep) {
    return res.status(400).json({ error: 'codigo inválido. Debe ser un código de 6 a 9 dígitos.' });
  }
  const { condicionCodigo, valorCodigo } = prep;

  try {
    const result = await pool.query(
      `SELECT DISTINCT prov->>'id_cotizacion' AS id_cotizacion, prov->>'justificacion_inadmisibilidad' AS razon
       FROM compras_agiles_vistas c,
         jsonb_array_elements(c.proveedores_cotizando) AS prov,
         jsonb_array_elements(prov->'productos_cotizados') AS prod
       WHERE c.resuelta = true
         AND COALESCE((prov->>'proveedor_seleccionado')::int, 0) != 1
         AND prod->>'codigo_producto' ${condicionCodigo}`,
      [valorCodigo]
    );

    const totalRechazadas = result.rows.length;
    const conRazon = result.rows.filter((r) => r.razon);

    const porRazon = {};
    for (const r of conRazon) {
      porRazon[r.razon] = (porRazon[r.razon] || 0) + 1;
    }

    const razones = Object.entries(porRazon)
      .map(([razon, cantidad]) => ({ razon, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    res.json({ totalRechazadas, sinRazonEspecificada: totalRechazadas - conRazon.length, razones });
  } catch (err) {
    console.error('Error en /analisis/rechazos:', err);
    res.status(500).json({ error: 'Error al consultar las razones de rechazo' });
  }
});

/**
 * GET /api/analisis/organismos?codigo=XXXXXXXX
 *
 * Ranking de organismos que MÁS COMPRAN en una categoría/producto — mismo
 * patrón que /proveedores, pero agrupado por organismo comprador en vez de
 * proveedor ganador. Solo usa procesos ya resueltos (mismo criterio que el
 * resto del análisis), ya que necesitamos el precio pagado, no solo que se
 * haya publicado un llamado.
 *
 * Se agrupa por NOMBRE (no por RUT — licitaciones_vistas no guarda el RUT del
 * organismo comprador, solo el nombre, así que no hay una clave más confiable
 * disponible para unificar ambas fuentes). El nombre se normaliza (trim +
 * mayúsculas) solo para agrupar, pero se muestra con su formato original.
 */
router.get('/organismos', async (req, res) => {
  const codigo = (req.query.codigo || '').trim();

  const prep = prepararCondicionCodigo(codigo);
  if (!prep) {
    return res.status(400).json({ error: 'codigo inválido. Debe ser un código de 6 a 9 dígitos.' });
  }
  const { condicionCodigo, valorCodigo } = prep;

  try {
    const licitacionesResult = await pool.query(
      `SELECT
         l.nombre_organismo AS organismo,
         (item->'adjudicacion'->>'monto_unitario')::numeric AS precio_unitario,
         'licitacion' AS fuente
       FROM licitaciones_vistas l, jsonb_array_elements(l.items) AS item
       WHERE l.resuelta = true
         AND item->'adjudicacion'->>'monto_unitario' IS NOT NULL
         AND item->>'codigo_producto' ${condicionCodigo}`,
      [valorCodigo]
    );

    const compraAgilResult = await pool.query(
      `SELECT
         c.nombre_institucion AS organismo,
         (prod->>'precio_unitario')::numeric AS precio_unitario,
         'compra_agil' AS fuente
       FROM compras_agiles_vistas c,
         jsonb_array_elements(c.proveedores_cotizando) AS prov,
         jsonb_array_elements(prov->'productos_cotizados') AS prod
       WHERE c.resuelta = true
         AND COALESCE((prov->>'proveedor_seleccionado')::int, 0) = 1
         AND prod->>'precio_unitario' IS NOT NULL
         AND prod->>'codigo_producto' ${condicionCodigo}`,
      [valorCodigo]
    );

    const registros = [...licitacionesResult.rows, ...compraAgilResult.rows]
      .filter((r) => r.organismo);

    const porOrganismo = {};
    for (const r of registros) {
      const clave = r.organismo.trim().toUpperCase();
      if (!porOrganismo[clave]) {
        porOrganismo[clave] = {
          organismo: r.organismo.trim(),
          vecesComprado: 0,
          licitaciones: 0,
          compraAgil: 0,
          precios: [],
        };
      }
      const entrada = porOrganismo[clave];
      entrada.vecesComprado++;
      entrada[r.fuente === 'licitacion' ? 'licitaciones' : 'compraAgil']++;
      const precio = Number(r.precio_unitario);
      if (!Number.isNaN(precio)) entrada.precios.push(precio);
    }

    const ranking = Object.values(porOrganismo)
      .map((e) => ({
        organismo: e.organismo,
        vecesComprado: e.vecesComprado,
        licitaciones: e.licitaciones,
        compraAgil: e.compraAgil,
        montoPromedio: e.precios.length > 0
          ? Math.round(e.precios.reduce((a, b) => a + b, 0) / e.precios.length)
          : null,
      }))
      .sort((a, b) => b.vecesComprado - a.vecesComprado)
      .slice(0, 50);

    res.json({ ranking });
  } catch (err) {
    console.error('Error en /analisis/organismos:', err);
    res.status(500).json({ error: 'Error al consultar el ranking de organismos' });
  }
});

module.exports = router;
