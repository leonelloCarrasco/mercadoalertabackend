const pool = require('./pool');
const { obtenerTramo } = require('../utils/tramos-licitacion');
const { ESTADOS_FINALES_LICITACION } = require('../utils/estados-finales');

async function licitacionYaVista(codigoExterno) {
  const result = await pool.query(
    'SELECT 1 FROM licitaciones_vistas WHERE codigo_externo = $1',
    [codigoExterno]
  );
  return result.rowCount > 0;
}

/**
 * Trae el estado actual guardado localmente — usado al crear un seguimiento
 * (sección "Oportunidades") para inicializar ultimo_estado_notificado con el
 * estado que tiene la licitación EN ESE MOMENTO, no null (ver migración 035).
 */
async function obtenerEstadoLicitacion(codigoExterno) {
  const result = await pool.query(
    'SELECT estado FROM licitaciones_vistas WHERE codigo_externo = $1',
    [codigoExterno]
  );
  return result.rows[0]?.estado || null;
}

/**
 * Verifica en una sola consulta cuáles de los códigos dados ya están guardados.
 * Mucho más rápido que consultar de a uno cuando hay miles de licitaciones activas.
 */
async function obtenerCodigosYaVistos(codigosExternos) {
  if (codigosExternos.length === 0) return new Set();

  const result = await pool.query(
    'SELECT codigo_externo FROM licitaciones_vistas WHERE codigo_externo = ANY($1)',
    [codigosExternos]
  );
  return new Set(result.rows.map((r) => r.codigo_externo));
}

async function guardarLicitacion(detalle) {
  const item = detalle.Items?.Listado?.[0];
  const todosLosItems = detalle.Items?.Listado || [];
  const tramo = obtenerTramo(detalle.Tipo);

  // Se guardan TODOS los ítems (una licitación puede tener varios productos de
  // categorías distintas — el campo categoria/codigo_categoria de arriba se
  // mantiene solo por compatibilidad con lo ya guardado, pero el matching real
  // usa este arreglo completo, no solo el primer ítem. También se incluye la
  // adjudicación por ítem por si esta licitación ya llega resuelta desde la
  // primera vez que la vemos (poco común, pero puede pasar).
  const itemsParaGuardar = todosLosItems.map((it) => ({
    codigo_producto: it.CodigoProducto || null,
    codigo_categoria: it.CodigoCategoria || null,
    categoria: it.Categoria || null,
    nombre_producto: it.NombreProducto || null,
    adjudicacion: it.Adjudicacion
      ? {
          rut_proveedor: it.Adjudicacion.RutProveedor || null,
          nombre_proveedor: it.Adjudicacion.NombreProveedor || null,
          cantidad: it.Adjudicacion.Cantidad || null,
          monto_unitario: it.Adjudicacion.MontoUnitario || null,
        }
      : null,
  }));

  // Por si el polling la descubre por primera vez cuando YA está en un estado
  // final (poco común — normalmente solo se capturan licitaciones "Publicada" —
  // pero así queda cubierto el caso igual, sin quedar erróneamente pendiente).
  const resueltaDesdeElInicio = ESTADOS_FINALES_LICITACION.includes(detalle.Estado);

  await pool.query(
    `INSERT INTO licitaciones_vistas
       (codigo_externo, nombre, categoria, codigo_categoria, monto_estimado,
        region, nombre_organismo, codigo_organismo, fecha_publicacion, fecha_cierre,
        tipo_licitacion, monto_utm_min, monto_utm_max, items, estado,
        fecha_adjudicacion, numero_oferentes, url_acta, resuelta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     ON CONFLICT (codigo_externo) DO NOTHING`,
    [
      detalle.CodigoExterno,
      detalle.Nombre,
      item?.Categoria || null,
      item?.CodigoCategoria || null,
      detalle.MontoEstimado || null,
      detalle.Comprador?.RegionUnidad || null,
      detalle.Comprador?.NombreOrganismo || null,
      // CodigoOrganismo: campo documentado de la API (Listado/Comprador/CodigoOrganismo),
      // el mismo que ya usa organismos_compradores (migración 030). Guardarlo acá permite
      // que el matching de alertas compare por código en vez de por nombre de texto (ver
      // matching.service.js) — ver migración 031. Para licitaciones guardadas ANTES de
      // este cambio, se completa vía el backfill 031a_backfill_codigo_organismo.sql.
      detalle.Comprador?.CodigoOrganismo ? String(detalle.Comprador.CodigoOrganismo) : null,
      detalle.Fechas?.FechaPublicacion || null,
      detalle.Fechas?.FechaCierre || null,
      detalle.Tipo || null,
      tramo?.utmMinGarantizado || null,
      tramo?.utmMax || null,
      JSON.stringify(itemsParaGuardar),
      detalle.Estado || null,
      // Fechas.FechaAdjudicacion trae la hora real (ej. "15:57:50"); el campo
      // Adjudicacion.Fecha (separado, a nivel superior) SIEMPRE viene a
      // medianoche en la API — se prioriza el que sí tiene hora, con el otro
      // como respaldo por si alguna vez faltara.
      detalle.Fechas?.FechaAdjudicacion || detalle.Adjudicacion?.Fecha || null,
      detalle.Adjudicacion?.NumeroOferentes || null,
      detalle.Adjudicacion?.UrlActa || null,
      resueltaDesdeElInicio,
    ]
  );
}

async function listarLicitacionesNuevas() {
  const result = await pool.query(
    `SELECT * FROM licitaciones_vistas ORDER BY primera_vez_vista DESC LIMIT 50`
  );
  return result.rows;
}

/**
 * Licitaciones "Publicada" y todavía vigentes (mismo doble chequeo que hace
 * matchLicitacion — estado + fecha, ver matching.service.js) — usada al
 * crear una alerta nueva, para poder avisar también de procesos que ya
 * existían ANTES de la alerta, no solo de los que aparezcan de ahora en
 * adelante (ver procesarBackfillNuevaAlerta en alerting.service.js).
 */
async function listarLicitacionesPublicadasVigentes() {
  const result = await pool.query(
    `SELECT * FROM licitaciones_vistas
     WHERE estado = 'Publicada' AND (fecha_cierre IS NULL OR fecha_cierre > NOW())`
  );
  return result.rows;
}

/**
 * Licitaciones guardadas ANTES de que empezáramos a guardar todos los ítems
 * (migración 016) — solo las que aún no cierran, ya que una vez pasada la
 * fecha de cierre el matching las descarta igual (ver matching.service.js),
 * así que no vale la pena gastar llamadas (con su delay de 3s) en esas.
 */
async function listarLicitacionesSinItems() {
  const result = await pool.query(
    `SELECT codigo_externo FROM licitaciones_vistas
     WHERE items IS NULL AND (fecha_cierre IS NULL OR fecha_cierre > NOW())
     ORDER BY fecha_cierre ASC NULLS LAST`
  );
  return result.rows.map((r) => r.codigo_externo);
}

async function actualizarItemsLicitacion(codigoExterno, items) {
  await pool.query(
    'UPDATE licitaciones_vistas SET items = $1 WHERE codigo_externo = $2',
    [JSON.stringify(items), codigoExterno]
  );
}

/**
 * Licitaciones cerradas que todavía no sabemos si se adjudicaron — candidatas
 * a revisar. Se limita a los últimos 90 días desde el cierre: pasado ese plazo,
 * dejamos de insistir (algunas licitaciones simplemente nunca publican resultado).
 */
async function listarLicitacionesPendientesDeResolucion() {
  const result = await pool.query(
    `SELECT codigo_externo FROM licitaciones_vistas
     WHERE resuelta = false
       AND fecha_cierre IS NOT NULL
       AND fecha_cierre < NOW()
       AND fecha_cierre > NOW() - INTERVAL '90 days'
     ORDER BY fecha_cierre ASC`
  );
  return result.rows.map((r) => r.codigo_externo);
}

/**
 * Guarda el resultado de una revisión de adjudicación. `resuelta=true` cuando
 * el Estado es uno de los que consideramos "final" (ver ESTADOS_FINALES en el
 * job) — de ahí en adelante no se vuelve a revisar esa licitación.
 */
async function actualizarResolucionLicitacion(codigoExterno, {
  items, estado, fechaAdjudicacion, numeroOferentes, urlActa, resuelta,
}) {
  await pool.query(
    `UPDATE licitaciones_vistas
     SET items = $1, estado = $2, fecha_adjudicacion = $3, numero_oferentes = $4,
         url_acta = $5, resuelta = $6, fecha_ultima_revision = NOW()
     WHERE codigo_externo = $7`,
    [JSON.stringify(items), estado, fechaAdjudicacion, numeroOferentes, urlActa, resuelta, codigoExterno]
  );
}

/**
 * Trae la fila completa (todos los campos ya guardados) de una licitación
 * por su código — usada por el análisis con IA para armar la metadata que
 * se le pasa al modelo (nombre, organismo, monto, fecha de cierre).
 */
async function obtenerLicitacionPorCodigo(codigoExterno) {
  const result = await pool.query('SELECT * FROM licitaciones_vistas WHERE codigo_externo = $1', [codigoExterno]);
  return result.rows[0] || null;
}

/**
 * Limpieza de licitaciones viejas — ver src/jobs/limpieza-datos-antiguos.js.
 *
 * Criterio (decidido explícitamente, no todos los "finales"):
 *  - Solo Adjudicada/Desierta/Revocada — 'Cerrada' queda AFUERA a propósito,
 *    porque el propio sistema no la trata como resuelta todavía (puede
 *    cambiar de estado más adelante, ver ESTADOS_FINALES_LICITACION en
 *    estados-finales.js) — borrarla sería perder algo que quizás todavía
 *    hay que revisar.
 *  - COALESCE(fecha_adjudicacion, fecha_ultima_revision): Desierta/Revocada
 *    a veces no traen fecha_adjudicacion real de la API (nunca hubo
 *    adjudicación) — se usa fecha_ultima_revision como respaldo en vez de
 *    dejar esas filas sin límite de antigüedad para siempre.
 *  - NOT EXISTS contra seguimientos/recordatorios/pipeline/análisis IA: no
 *    hay foreign key hacia licitaciones_vistas, así que borrar no falla,
 *    pero dejaría a un usuario con ese ítem guardado viendo datos
 *    incompletos (nombre/organismo/monto en blanco) — se prefiere no
 *    borrar antes que romper algo que alguien todavía tiene activo.
 *
 * RED DE SEGURIDAD DE PRECIOS: antes de borrar cada candidato, se chequea
 * si ya tiene algo en historico_precios (lo normal — ya se archivó en
 * revisar-resoluciones.js, en el momento de la resolución). Si NO tiene
 * nada archivado (se coló por otro camino — ej. algo que se guarda YA
 * resuelto desde el principio, ver guardarLicitacion), se archiva ACÁ,
 * usando los datos que ya están en la propia fila (sin pedirle nada a la
 * API) — recién ahí se borra. Si el archivado falla, esa fila puntual NO
 * se borra esta corrida (mejor una fila vieja de más que perder un precio
 * para siempre) — se reintenta sola en la próxima corrida del cron.
 *
 * Devuelve la cantidad de filas borradas.
 */
async function eliminarLicitacionesAntiguas(mesesAntiguedad = 6) {
  // Import acá adentro (no arriba del archivo) para no crear una dependencia
  // circular entre los dos módulos de queries.
  const { tienePreciosArchivados, archivarPreciosLicitacion } = require('./historico-precios.queries');

  const candidatos = await pool.query(
    `SELECT codigo_externo, nombre, nombre_organismo, fecha_adjudicacion,
            fecha_ultima_revision, numero_oferentes, url_acta, items
     FROM licitaciones_vistas lv
     WHERE lv.estado IN ('Adjudicada', 'Desierta (o art. 3 ó 9 Ley 19.886)', 'Revocada')
       AND COALESCE(lv.fecha_adjudicacion, lv.fecha_ultima_revision) < NOW() - ($1 || ' months')::INTERVAL
       AND NOT EXISTS (SELECT 1 FROM seguimientos_licitacion s WHERE s.codigo_externo = lv.codigo_externo)
       AND NOT EXISTS (SELECT 1 FROM recordatorios_cierre r WHERE r.codigo_externo = lv.codigo_externo AND r.tipo_proceso = 'licitacion')
       AND NOT EXISTS (SELECT 1 FROM pipeline_oportunidades p WHERE p.codigo_externo = lv.codigo_externo AND p.tipo_proceso = 'licitacion')
       AND NOT EXISTS (SELECT 1 FROM analisis_ia a WHERE a.codigo_externo = lv.codigo_externo AND a.tipo_proceso = 'licitacion')`,
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
      const guardadas = await archivarPreciosLicitacion({
        codigoExterno: fila.codigo_externo,
        nombre: fila.nombre,
        organismo: fila.nombre_organismo,
        fechaAdjudicacion: fila.fecha_adjudicacion || fila.fecha_ultima_revision,
        numeroOferentes: fila.numero_oferentes,
        urlActa: fila.url_acta,
        items: fila.items || [],
      });
      if (guardadas > 0) archivadosPorRedDeSeguridad++;
      codigosABorrar.push(fila.codigo_externo);
    } catch (err) {
      console.error(`[limpieza-datos-antiguos] Error en la red de seguridad archivando ${fila.codigo_externo} — esta fila NO se borra esta corrida:`, err.message);
    }
  }

  if (archivadosPorRedDeSeguridad > 0) {
    console.log(`[limpieza-datos-antiguos] Red de seguridad: ${archivadosPorRedDeSeguridad} licitaciones se archivaron recién ahora, antes de borrar (no habían pasado por revisar-resoluciones.js).`);
  }

  if (codigosABorrar.length === 0) return 0;

  const result = await pool.query('DELETE FROM licitaciones_vistas WHERE codigo_externo = ANY($1)', [codigosABorrar]);
  return result.rowCount;
}

module.exports = {
  licitacionYaVista,
  obtenerEstadoLicitacion,
  obtenerLicitacionPorCodigo,
  obtenerCodigosYaVistos,
  guardarLicitacion,
  listarLicitacionesNuevas,
  listarLicitacionesPublicadasVigentes,
  listarLicitacionesSinItems,
  actualizarItemsLicitacion,
  listarLicitacionesPendientesDeResolucion,
  actualizarResolucionLicitacion,
  eliminarLicitacionesAntiguas,
};
