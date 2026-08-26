const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireEmpresaActiva } = require('../middleware/requireEmpresaActiva.middleware');
const { obtenerPlan } = require('../utils/planes');

const router = express.Router();
router.use(requireAuth);
router.use(requireEmpresaActiva); // deja disponible req.usuarioActual

// Análisis de precios de Mercado Público — disponible en Basic y Full,
// pero con distinto nivel de detalle (ver detalleAnalisisPrecios en
// planes.js): Basic ('resumen') solo ve el rango de precios en /precios,
// sin los registros individuales ni acceso a /proveedores, /rechazos,
// /organismos — esos cuatro son la "inteligencia competitiva" reservada
// para Full ('completo'). Lee de planes.js (fuente única de verdad) en vez
// de mantener una lista aparte que se puede desincronizar si algún día
// cambian los planes.
router.use((req, res, next) => {
  const plan = obtenerPlan(req.usuarioActual.plan);
  if (!plan?.accesoAnalisisPrecios) {
    return res.status(403).json({ error: 'El análisis de precios de Mercado Público está disponible en los planes Basic y Full.' });
  }
  req.detalleAnalisisPrecios = plan.detalleAnalisisPrecios || 'resumen';
  next();
});

// Los cuatro endpoints de acá abajo (/proveedores, /rechazos, /organismos, y
// los registros detallados de /precios) requieren detalle 'completo' — se
// aplica ANTES de cada ruta que lo necesite, no acá arriba, porque /precios
// sigue respondiendo (con menos detalle) en nivel 'resumen'.
function requiereDetalleCompleto(req, res, next) {
  if (req.detalleAnalisisPrecios !== 'completo') {
    return res.status(403).json({ error: 'Este nivel de detalle del análisis de precios está disponible en el plan Full.' });
  }
  next();
}

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
 * Historial de precios para una categoría o producto (mismo código que se
 * usa en las alertas). Mismo criterio que el matching de alertas (ver
 * algunCodigoCoincide en matching.service.js): si el código termina en "00"
 * es de categoría → coincide por PREFIJO de 6 dígitos. Si no, es un
 * producto específico → coincide EXACTO.
 *
 * Lee de historico_precios (agosto 2026 — antes leía directo de
 * licitaciones_vistas/compras_agiles_vistas con jsonb_array_elements, lo
 * que dejaba afuera cualquier proceso ya borrado por antigüedad, aunque su
 * precio siguiera archivado a salvo acá). Incluye TODAS las cotizaciones de
 * Compra Ágil, no solo la ganadora (gano=false también), para poder
 * comparar qué precio ganó vs. cuáles quedaron afuera — las de licitación
 * siempre son gano=true, porque licitaciones nunca expone ofertas perdedoras.
 */
router.get('/precios', async (req, res) => {
  const codigo = (req.query.codigo || '').trim();

  const prep = prepararCondicionCodigo(codigo);
  if (!prep) {
    return res.status(400).json({ error: 'codigo inválido. Debe ser un código de 6 a 9 dígitos.' });
  }
  const { condicionCodigo, valorCodigo } = prep;

  try {
    const result = await pool.query(
      `SELECT
         codigo_externo,
         fuente,
         proceso_nombre,
         organismo,
         fecha_adjudicacion,
         numero_oferentes,
         url_acta,
         codigo_producto,
         nombre_producto,
         nombre_proveedor AS proveedor,
         rut_proveedor,
         precio_unitario,
         cantidad,
         gano,
         motivo_rechazo
       FROM historico_precios
       WHERE precio_unitario IS NOT NULL
         AND codigo_producto ${condicionCodigo}
       ORDER BY fecha_adjudicacion DESC
       LIMIT 200`,
      [valorCodigo]
    );

    const registros = result.rows;

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

    // Nivel 'resumen' (Basic): se calcula el resumen con TODOS los registros
    // (el rango de precios tiene que ser real, no solo de una muestra), pero
    // no se devuelven los registros individuales — ahí es donde está el
    // detalle competitivo (qué proveedor, qué organismo, precio exacto por
    // contrato) que se reserva para 'completo' (Full).
    res.json({
      resumen,
      registros: req.detalleAnalisisPrecios === 'completo' ? registros : undefined,
    });
  } catch (err) {
    console.error('Error en /analisis/precios:', err);
    res.status(500).json({ error: 'Error al consultar el historial de precios' });
  }
});

/**
 * GET /api/analisis/proveedores?codigo=XXXXXXXX
 *
 * Ranking de proveedores que MÁS GANAN en una categoría/producto — solo
 * ganadores (gano = true). Se agrupa por RUT (no por nombre — el nombre
 * puede variar en mayúsculas o espacios entre registros, el RUT es el
 * identificador confiable).
 */
router.get('/proveedores', requiereDetalleCompleto, async (req, res) => {
  const codigo = (req.query.codigo || '').trim();

  const prep = prepararCondicionCodigo(codigo);
  if (!prep) {
    return res.status(400).json({ error: 'codigo inválido. Debe ser un código de 6 a 9 dígitos.' });
  }
  const { condicionCodigo, valorCodigo } = prep;

  try {
    const result = await pool.query(
      `SELECT rut_proveedor, nombre_proveedor, precio_unitario, fuente
       FROM historico_precios
       WHERE gano = true
         AND precio_unitario IS NOT NULL
         AND codigo_producto ${condicionCodigo}`,
      [valorCodigo]
    );

    const ganadores = result.rows.filter((r) => r.rut_proveedor);

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
 * licitaciones nunca exponen a los oferentes que perdieron, solo al
 * ganador — por eso no hay filas fuente='licitacion' con gano=false en
 * historico_precios). Agrupa por motivo_rechazo para responder "¿por qué
 * pierde la gente en esta categoría?".
 */
router.get('/rechazos', requiereDetalleCompleto, async (req, res) => {
  const codigo = (req.query.codigo || '').trim();

  const prep = prepararCondicionCodigo(codigo);
  if (!prep) {
    return res.status(400).json({ error: 'codigo inválido. Debe ser un código de 6 a 9 dígitos.' });
  }
  const { condicionCodigo, valorCodigo } = prep;

  try {
    const result = await pool.query(
      `SELECT motivo_rechazo
       FROM historico_precios
       WHERE fuente = 'compra_agil'
         AND gano = false
         AND codigo_producto ${condicionCodigo}`,
      [valorCodigo]
    );

    const totalRechazadas = result.rows.length;
    const conRazon = result.rows.filter((r) => r.motivo_rechazo);

    const porRazon = {};
    for (const r of conRazon) {
      porRazon[r.motivo_rechazo] = (porRazon[r.motivo_rechazo] || 0) + 1;
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
 * proveedor ganador (gano = true).
 *
 * Se agrupa por NOMBRE (no por RUT — no se archiva el RUT del organismo
 * comprador, solo el nombre). El nombre se normaliza (trim + mayúsculas)
 * solo para agrupar, pero se muestra con su formato original.
 */
router.get('/organismos', requiereDetalleCompleto, async (req, res) => {
  const codigo = (req.query.codigo || '').trim();

  const prep = prepararCondicionCodigo(codigo);
  if (!prep) {
    return res.status(400).json({ error: 'codigo inválido. Debe ser un código de 6 a 9 dígitos.' });
  }
  const { condicionCodigo, valorCodigo } = prep;

  try {
    const result = await pool.query(
      `SELECT organismo, precio_unitario, fuente
       FROM historico_precios
       WHERE gano = true
         AND precio_unitario IS NOT NULL
         AND codigo_producto ${condicionCodigo}`,
      [valorCodigo]
    );

    const registros = result.rows.filter((r) => r.organismo);

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
