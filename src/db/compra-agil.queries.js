const pool = require('./pool');
const { ESTADOS_FINALES_COMPRA_AGIL } = require('../utils/estados-finales');
const { parsearFechaChile } = require('../utils/fecha-chile');

async function compraAgilYaVista(codigoExterno) {
  const result = await pool.query(
    'SELECT 1 FROM compras_agiles_vistas WHERE codigo_externo = $1',
    [codigoExterno]
  );
  return result.rowCount > 0;
}

async function obtenerCodigosCompraAgilYaVistos(codigosExternos) {
  if (codigosExternos.length === 0) return new Set();

  const result = await pool.query(
    'SELECT codigo_externo FROM compras_agiles_vistas WHERE codigo_externo = ANY($1)',
    [codigosExternos]
  );
  return new Set(result.rows.map((r) => r.codigo_externo));
}

/**
 * Guarda una Compra Ágil a partir del item de listado (resumen) y,
 * opcionalmente, su detalle completo (si ya se consultó, para incluir proveedores_cotizando).
 */
async function guardarCompraAgil(item, detalle = null) {
  // Por si el polling la descubre por primera vez cuando YA está en un estado
  // final (proceso resuelto muy rápido, nunca la vimos "publicada"). OJO: no
  // basta con que el estado ya sea final — si el detalle vino incompleto en
  // ese instante (ej. proveedores_cotizando vacío por un tema puntual de la
  // API), es mejor dejarla como NO resuelta, para que el job de revisión
  // diario la vuelva a intentar más tarde. Si se marca resuelta=true con datos
  // incompletos, queda atascada así para siempre (el job de revisión solo
  // mira registros con resuelta=false).
  const tieneDatosCompletos = (detalle?.proveedores_cotizando?.length || 0) > 0;
  const resueltaDesdeElInicio = ESTADOS_FINALES_COMPRA_AGIL.includes(item.estado?.codigo) && tieneDatosCompletos;

  const resultado = await pool.query(
    `INSERT INTO compras_agiles_vistas
       (codigo_externo, nombre, categoria, monto_estimado, region,
        rut_institucion, nombre_institucion, estado, fecha_publicacion, fecha_cierre,
        proveedores_cotizando, productos_solicitados, resuelta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (codigo_externo) DO NOTHING`,
    [
      item.codigo,
      item.nombre,
      null, // Campo original sin uso real — el detalle de categorías ahora vive en productos_solicitados
      item.montos?.monto_disponible_clp || null,
      item.institucion?.nombre_region || null,
      item.institucion?.rut || null,
      item.institucion?.organismo_comprador || null,
      item.estado?.codigo || null,
      // parsearFechaChile: la API manda estos 2 campos SIN zona horaria
      // (hora de Chile) — se convierte acá, una sola vez, al guardar por
      // primera vez, para que las columnas (TIMESTAMPTZ desde la migración
      // 051) guarden el instante UTC correcto. Ver conversación de agosto
      // 2026 — sin esto, cualquier comparación con NOW() (recordatorios,
      // revisar-resoluciones, limpieza) quedaba corrida 3-4 horas según la
      // época del año, sin que nada tirara error.
      parsearFechaChile(item.fechas?.fecha_publicacion),
      parsearFechaChile(item.fechas?.fecha_cierre),
      detalle ? JSON.stringify(detalle.proveedores_cotizando || []) : null,
      detalle ? JSON.stringify(detalle.productos_solicitados || []) : null,
      resueltaDesdeElInicio,
    ]
  );

  // Archivado inmediato si se guarda YA resuelta — mismo motivo que en
  // guardarLicitacion (ver ese comentario para el detalle completo).
  // resultado.rowCount > 0 confirma que fue un INSERT genuino, evita
  // archivar dos veces si esta función se vuelve a llamar para el mismo
  // código_externo.
  if (resultado.rowCount > 0 && resueltaDesdeElInicio) {
    try {
      // Require local — mismo criterio que ya usa eliminarComprasAgilesAntiguas
      // más abajo en este archivo, para no crear una dependencia circular.
      const { archivarPreciosCompraAgil } = require('./historico-precios.queries');
      const guardadas = await archivarPreciosCompraAgil({
        codigoExterno: item.codigo,
        nombre: item.nombre,
        organismo: item.institucion?.organismo_comprador,
        fechaCierre: parsearFechaChile(item.fechas?.fecha_cierre),
        proveedoresCotizando: detalle.proveedores_cotizando || [],
      });
      if (guardadas > 0) console.log(`[compra-agil.queries] Archivados ${guardadas} precios de ${item.codigo} (resuelta desde el inicio).`);
    } catch (err) {
      console.error(`[compra-agil.queries] Error archivando precios de ${item.codigo} (resuelta desde el inicio, no afecta el guardado):`, err.message);
    }
  }
}

/**
 * Compras Ágiles "publicada" y todavía vigentes — equivalente a
 * listarLicitacionesPublicadasVigentes, usada por el mismo backfill al
 * crear una alerta nueva (ver alerting.service.js).
 */
async function listarComprasAgilesPublicadasVigentes() {
  const result = await pool.query(
    `SELECT * FROM compras_agiles_vistas
     WHERE estado = 'publicada' AND (fecha_cierre IS NULL OR fecha_cierre > NOW())`
  );
  return result.rows;
}

/**
 * Compras Ágiles cerradas que seguían "publicada" la última vez que las vimos —
 * candidatas a revisar. Igual que licitaciones, se limita a los últimos 90 días.
 *
 * OJO: el filtro es solo `resuelta = false`, sin importar qué diga `estado`
 * ahora mismo — si en algún momento se guardó un estado intermedio desconocido
 * (ni "publicada" ni "proveedor_seleccionado"), igual tiene que seguir
 * apareciendo acá para revisarse de nuevo. Filtrar por `estado = 'publicada'`
 * dejaría esos casos invisibles para siempre (bug real que tuvimos y corregimos).
 */
async function listarCompraAgilPendienteDeResolucion() {
  const result = await pool.query(
    `SELECT codigo_externo FROM compras_agiles_vistas
     WHERE resuelta = false
       AND fecha_cierre IS NOT NULL
       AND fecha_cierre < NOW()
       AND fecha_cierre > NOW() - INTERVAL '90 days'
     ORDER BY fecha_cierre ASC`
  );
  return result.rows.map((r) => r.codigo_externo);
}

async function actualizarResolucionCompraAgil(codigoExterno, {
  estado, idOrdenCompra, proveedoresCotizando, productosSolicitados, resuelta,
}) {
  await pool.query(
    `UPDATE compras_agiles_vistas
     SET estado = $1, id_orden_compra = $2, proveedores_cotizando = $3,
         productos_solicitados = COALESCE(NULLIF($4::jsonb, '[]'::jsonb), productos_solicitados),
         resuelta = $5, fecha_ultima_revision = NOW()
     WHERE codigo_externo = $6`,
    [estado, idOrdenCompra, JSON.stringify(proveedoresCotizando || []), JSON.stringify(productosSolicitados || []), resuelta, codigoExterno]
  );
}

/**
 * Trae la fila completa de una Compra Ágil por su código — mismo propósito
 * que obtenerLicitacionPorCodigo en licitaciones.queries.js.
 */
async function obtenerCompraAgilPorCodigo(codigoExterno) {
  const result = await pool.query('SELECT * FROM compras_agiles_vistas WHERE codigo_externo = $1', [codigoExterno]);
  return result.rows[0] || null;
}

/**
 * Limpieza de Compras Ágiles viejas — ver src/jobs/limpieza-datos-antiguos.js.
 *
 * A diferencia de licitaciones, acá es INDEPENDIENTE del estado — se borra
 * igual esté publicada, cerrada, o lo que sea, siempre que sea vieja.
 * COALESCE(fecha_publicacion, primera_vez_vista): por si algún registro
 * viejo se guardó sin fecha_publicacion poblada.
 * NOT EXISTS: mismo criterio que licitaciones — no hay foreign key, pero se
 * prefiere no borrar lo que un usuario todavía tiene referenciado en
 * Portafolio/Recordatorio/Análisis IA (acá no aplica seguimientos_licitacion,
 * esa tabla es exclusiva de licitaciones).
 *
 * RED DE SEGURIDAD DE PRECIOS: mismo criterio que licitaciones (ver el
 * comentario largo en eliminarLicitacionesAntiguas) — se chequea si ya está
 * archivado en historico_precios antes de borrar, y si no, se archiva acá
 * usando los datos que ya están en la propia fila. Si el archivado falla,
 * esa fila NO se borra esta corrida.
 *
 * Devuelve la cantidad de filas borradas.
 */
async function eliminarComprasAgilesAntiguas(mesesAntiguedad = 3) {
  const { tienePreciosArchivados, archivarPreciosCompraAgil } = require('./historico-precios.queries');

  const candidatos = await pool.query(
    `SELECT codigo_externo, nombre, nombre_institucion, fecha_cierre, proveedores_cotizando
     FROM compras_agiles_vistas cav
     WHERE COALESCE(cav.fecha_publicacion, cav.primera_vez_vista) < NOW() - ($1 || ' months')::INTERVAL
       AND NOT EXISTS (SELECT 1 FROM recordatorios_cierre r WHERE r.codigo_externo = cav.codigo_externo AND r.tipo_proceso = 'compra_agil')
       AND NOT EXISTS (SELECT 1 FROM pipeline_oportunidades p WHERE p.codigo_externo = cav.codigo_externo AND p.tipo_proceso = 'compra_agil')
       AND NOT EXISTS (SELECT 1 FROM analisis_ia a WHERE a.codigo_externo = cav.codigo_externo AND a.tipo_proceso = 'compra_agil')`,
    [mesesAntiguedad]
  );

  if (candidatos.rows.length === 0) return 0;

  const codigosABorrar = [];
  let archivadosPorRedDeSeguridad = 0;

  for (const fila of candidatos.rows) {
    const yaArchivado = await tienePreciosArchivados(fila.codigo_externo);
    if (yaArchivado) {
      codigosABorrar.push(fila.codigo_externo);
      continue;
    }

    try {
      const guardadas = await archivarPreciosCompraAgil({
        codigoExterno: fila.codigo_externo,
        nombre: fila.nombre,
        organismo: fila.nombre_institucion,
        fechaCierre: fila.fecha_cierre,
        proveedoresCotizando: fila.proveedores_cotizando || [],
      });
      if (guardadas > 0) archivadosPorRedDeSeguridad++;
      codigosABorrar.push(fila.codigo_externo);
    } catch (err) {
      console.error(`[limpieza-datos-antiguos] Error en la red de seguridad archivando ${fila.codigo_externo} — esta fila NO se borra esta corrida:`, err.message);
    }
  }

  if (archivadosPorRedDeSeguridad > 0) {
    console.log(`[limpieza-datos-antiguos] Red de seguridad: ${archivadosPorRedDeSeguridad} Compras Ágiles se archivaron recién ahora, antes de borrar (no habían pasado por revisar-resoluciones.js).`);
  }

  if (codigosABorrar.length === 0) return 0;

  const result = await pool.query('DELETE FROM compras_agiles_vistas WHERE codigo_externo = ANY($1)', [codigosABorrar]);
  return result.rowCount;
}

/**
 * Agrega códigos a la cola de pendientes de detalle (ver migración 052) —
 * ON CONFLICT DO NOTHING porque un mismo código puede quedar pendiente en
 * más de una corrida seguida sin que eso sea un problema, y porque
 * recuperacion-compra-agil.js puede volver a encontrar el mismo código que
 * ya estaba en cola de una corrida normal anterior.
 */
async function agregarPendientesDetalleCompraAgil(codigos) {
  if (codigos.length === 0) return;
  await pool.query(
    `INSERT INTO compra_agil_pendientes_detalle (codigo_externo)
     SELECT unnest($1::text[])
     ON CONFLICT (codigo_externo) DO NOTHING`,
    [codigos]
  );
}

async function listarPendientesDetalleCompraAgil() {
  const result = await pool.query('SELECT codigo_externo FROM compra_agil_pendientes_detalle ORDER BY agregado_en ASC');
  return result.rows.map((r) => r.codigo_externo);
}

async function quitarPendienteDetalleCompraAgil(codigo) {
  await pool.query('DELETE FROM compra_agil_pendientes_detalle WHERE codigo_externo = $1', [codigo]);
}

module.exports = {
  compraAgilYaVista,
  obtenerCompraAgilPorCodigo,
  obtenerCodigosCompraAgilYaVistos,
  guardarCompraAgil,
  listarComprasAgilesPublicadasVigentes,
  listarCompraAgilPendienteDeResolucion,
  actualizarResolucionCompraAgil,
  eliminarComprasAgilesAntiguas,
  agregarPendientesDetalleCompraAgil,
  listarPendientesDetalleCompraAgil,
  quitarPendienteDetalleCompraAgil,
};
