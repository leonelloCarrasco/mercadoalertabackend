/**
 * Carga masiva de Compras Ágiles desde un CSV exportado de Mercado Público
 * — reemplaza a carga-compras-agiles-por-fecha.js para volúmenes grandes,
 * donde llamar a la API una por una (con el delay de rate-limit) sale
 * demasiado caro en tiempo. Acá NO se llama a la API en absoluto: toda la
 * información sale del archivo.
 *
 * El CSV viene "aplanado": una fila por cada combinación (producto ×
 * proveedor cotizando) dentro de una misma cotización — hay que agrupar
 * filas por CodigoCotizacion antes de poder guardar nada. Formato esperado:
 * separado por ";", codificación Windows-1252/ISO-8859-1 (el export estándar
 * de Mercado Público, no UTF-8).
 *
 * Limitaciones conocidas y confirmadas con el negocio (no son bugs, son
 * decisiones explícitas por lo que el CSV puede y no puede dar):
 *  - El estado se mapea desde la glosa del CSV ("Publicada", "Proveedor
 *    seleccionado", etc.) contra una lista fija confirmada — si aparece un
 *    estado no contemplado, esa fila se reporta como error y se salta, no
 *    se adivina el código.
 *  - Las fechas de publicación/cierre en el CSV no traen hora — se completan
 *    con 12:00:00 fijo.
 *  - unidad_medida de cada producto no está en el CSV — queda null (confirmado
 *    que no se usa en ningún lado del sistema).
 *  - El CSV no trae precio_unitario/monto_total_producto por producto dentro
 *    de cada cotización de proveedor (el detalle de la API sí, pero llamarla
 *    es justo lo que se quiere evitar acá). MontoTotal (columna del CSV) es
 *    el total de TODA la cotización de ese proveedor, no de un producto en
 *    particular — así que solo se puede calcular el precio real cuando ese
 *    proveedor cotizó UN SOLO producto (ahí MontoTotal = el monto de ese
 *    producto, sin ambigüedad). Con 2+ productos por proveedor, se deja
 *    precio_unitario/monto_total_producto en null — el análisis de precios
 *    históricos (analisis.routes.js) ya filtra esos casos con
 *    "IS NOT NULL", así que no rompe nada, solo no aporta datos ahí.
 *
 * Uso:
 *   node scripts/carga-compras-agiles-desde-csv.js {ruta-al-csv}
 *   node scripts/carga-compras-agiles-desde-csv.js ./carga_masiva_compras_agiles.csv
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const { parse } = require('csv-parse');
const { obtenerCodigosCompraAgilYaVistos, guardarCompraAgil } = require('../src/db/compra-agil.queries');
const pool = require('../src/db/pool');

// Lista CONFIRMADA (no adivinada) de glosa del CSV -> código interno que usa
// el resto del sistema (matching de alertas, filtros del dashboard, etc.).
const ESTADO_GLOSA_A_CODIGO = {
  'Publicada': 'publicada',
  'Cerrada': 'cerrada',
  'Desierta': 'desierta',
  'Cancelada': 'cancelada',
  'Proveedor seleccionado': 'proveedor_seleccionado',
};

/** "1.234.567" o "1234567" -> 1234567. Devuelve null si no es un número válido. */
function parsearMonto(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const limpio = String(valor).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** "30/06/2026" -> "2026-06-30 12:00:00" — hora fija a mediodía (el CSV solo trae fecha, no hora). */
function parsearFechaConHoraFija(ddmmaaaa) {
  if (!ddmmaaaa) return null;
  const partes = String(ddmmaaaa).trim().split('/');
  if (partes.length !== 3) return null;
  const [dd, mm, aaaa] = partes;
  return `${aaaa}-${mm}-${dd} 12:00:00`;
}

/**
 * Generador que va entregando fila por fila, vía streaming — a propósito NO
 * se hace `buffer.toString('latin1')` sobre el archivo entero: con un CSV
 * grande de verdad (cientos de MB o más, que es justo el caso de uso de
 * este script), eso revienta con "Cannot create a string longer than
 * 0x1fffffe8 characters" (el límite de ~536M caracteres que tiene cualquier
 * string de JS/V8, sin importar cuánta RAM haya disponible). Streameando,
 * el archivo se va decodificando y parseando de a pedazos chicos — nunca
 * existe "un string" con el archivo entero adentro.
 *
 * Tampoco se junta nunca un array con TODAS las filas en memoria (eso fue
 * el segundo problema, real, encontrado al probar con un archivo de más de
 * 1 millón de filas: igual revienta, esta vez por RAM, "JavaScript heap out
 * of memory") — quien consuma este generador decide cuánto guarda en
 * memoria a la vez.
 */
async function* leerFilasCsv(rutaArchivo) {
  const parser = fs.createReadStream(rutaArchivo, { encoding: 'latin1' }).pipe(parse({
    delimiter: ';',
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  }));
  for await (const fila of parser) {
    yield fila;
  }
}

/**
 * PASADA 1 (liviana): recorre el archivo entero solo para juntar los
 * códigos de cotización únicos, sin guardar las filas completas — un Set de
 * strings cortos no pesa nada en memoria incluso con millones de filas
 * (a diferencia de guardar el objeto completo de cada fila).
 */
async function contarFilasYCodigosUnicos(rutaArchivo) {
  const codigos = new Set();
  let totalFilas = 0;
  for await (const fila of leerFilasCsv(rutaArchivo)) {
    totalFilas++;
    const codigo = (fila.CodigoCotizacion || '').trim();
    if (codigo) codigos.add(codigo);
  }
  return { totalFilas, codigos };
}

/**
 * PASADA 2 (la que realmente guarda): vuelve a recorrer el archivo, pero
 * esta vez agrupando filas CONTIGUAS del mismo CodigoCotizacion — apenas
 * cambia el código (o se termina el archivo), se considera cerrado ese
 * grupo y se llama a `procesarGrupo` con esas filas, sin retenerlas después.
 *
 * ⚠️ Esto asume que todas las filas de una misma cotización vienen SEGUIDAS
 * en el archivo (como en la muestra real que se usó para armar este script,
 * donde las 48 filas de la única cotización de ejemplo estaban una atrás de
 * la otra) — no que el archivo esté "ordenado por código" en sentido
 * alfabético/numérico, solo que no se intercalen filas de otra cotización
 * en el medio. Si el mismo código reaparece más adelante después de haberse
 * visto otro código distinto en el medio, se detecta y se avisa (ver
 * `codigosYaCerrados` más abajo) en vez de fallar en silencio con un grupo
 * incompleto.
 */
async function procesarCsvPorGrupos(rutaArchivo, procesarGrupo) {
  let codigoActual = null;
  let filasDelGrupoActual = [];
  const codigosYaCerrados = new Set();
  let gruposConFilasNoContiguas = 0;

  async function cerrarGrupoActual() {
    if (codigoActual === null) return;
    codigosYaCerrados.add(codigoActual);
    await procesarGrupo(codigoActual, filasDelGrupoActual);
    filasDelGrupoActual = [];
  }

  for await (const fila of leerFilasCsv(rutaArchivo)) {
    const codigo = (fila.CodigoCotizacion || '').trim();
    if (!codigo) continue;

    if (codigo !== codigoActual) {
      await cerrarGrupoActual();
      if (codigosYaCerrados.has(codigo)) {
        // El mismo código reapareció después de haberse cerrado su grupo —
        // el archivo NO estaba contiguo para este caso. Se procesa igual
        // (como un segundo grupo separado, que va a pisar/complementar al
        // primero según haga guardarCompraAgil), pero se cuenta para avisar
        // al final — esto no debería pasar si el export viene como se espera.
        gruposConFilasNoContiguas++;
      }
      codigoActual = codigo;
    }
    filasDelGrupoActual.push(fila);
  }
  await cerrarGrupoActual();

  return { gruposConFilasNoContiguas };
}



/**
 * Arma { item, detalle } en el mismo shape que espera guardarCompraAgil()
 * (ver compra-agil.queries.js) a partir de todas las filas del CSV que
 * pertenecen a UNA cotización.
 */
function filasACompraAgil(codigo, filas) {
  const primera = filas[0];

  const estadoGlosa = (primera.Estado || '').trim();
  const estadoCodigo = ESTADO_GLOSA_A_CODIGO[estadoGlosa];
  if (!estadoCodigo) {
    throw new Error(`Estado "${estadoGlosa}" no está en la lista confirmada (publicada/cerrada/desierta/cancelada/proveedor_seleccionado) — se salta esta fila para no guardar un estado inventado.`);
  }

  // --- productos_solicitados: uno por CodigoProducto distinto ---
  const productosPorCodigo = new Map();
  for (const f of filas) {
    const codigoProducto = (f.CodigoProducto || '').trim();
    if (!codigoProducto || productosPorCodigo.has(codigoProducto)) continue;
    productosPorCodigo.set(codigoProducto, {
      codigo_producto: Number(codigoProducto),
      nombre: f.NombreProductoGenerico || null,
      descripcion: f.ProductoCotizado || null,
      cantidad: Number(f.CantidadSolicitada) || null,
      unidad_medida: null, // no viene en el CSV masivo — confirmado que no se usa en el sistema
    });
  }
  const productosSolicitados = [...productosPorCodigo.values()];

  // --- proveedores_cotizando: uno por RUTProveedor distinto, con sus
  // productos_cotizados anidados. precio_unitario/monto_total_producto
  // derivados de MontoTotal/CantidadSolicitada (aproximación confirmada,
  // ver comentario al inicio del archivo).
  const proveedoresPorRut = new Map();
  for (const f of filas) {
    const rut = (f.RUTProveedor || '').trim();
    const codigoProducto = (f.CodigoProducto || '').trim();
    if (!rut || !codigoProducto) continue;

    if (!proveedoresPorRut.has(rut)) {
      proveedoresPorRut.set(rut, {
        razon_social: f.RazonSocialProveedor || null,
        rut_proveedor: rut,
        proveedor_seleccionado: (f.ProveedorSeleccionado || '').trim().toLowerCase() === 'si' ? 1 : 0,
        monto_total: parsearMonto(f.MontoTotal),
        descripcion: f.DetalleCotizacion || null,
        id_oc: f.CodigoOC || null,
        productos_cotizados: [],
        _codigosYaAgregados: new Set(),
      });
    }

    const proveedor = proveedoresPorRut.get(rut);
    // El CSV trae filas duplicadas para el mismo (producto, proveedor) en
    // algunos casos (visto en la muestra real) — no duplicar en el array.
    if (proveedor._codigosYaAgregados.has(codigoProducto)) continue;
    proveedor._codigosYaAgregados.add(codigoProducto);

    proveedor.productos_cotizados.push({
      codigo_producto: Number(codigoProducto),
      nombre_producto: f.NombreProductoGenerico || null,
      descripcion: f.ProductoCotizado || null,
      cantidad: Number(f.CantidadSolicitada) || null,
      // precio_unitario/monto_total_producto se completan DESPUÉS de haber
      // agrupado todo (ver más abajo) — acá no se puede saber todavía si
      // este proveedor cotizó 1 solo producto (caso exacto) o varios (caso
      // aproximado, que se descarta).
      precio_unitario: null,
      monto_total_producto: null,
    });
  }

  // MontoTotal es el total ofertado por el proveedor para TODA la
  // cotización, no el monto de un producto individual — así que
  // MontoTotal/CantidadSolicitada solo da el precio unitario REAL cuando ese
  // proveedor cotizó un único producto (ahí MontoTotal es, por definición,
  // el monto de ESE producto). Con 2 o más productos por proveedor, esa
  // cuenta no tiene forma de saber cómo se repartió el total entre cada uno
  // — mejor dejarlo en null (el resto del sistema ya lo maneja bien, ver
  // "IS NOT NULL" en analisis.routes.js) que guardar un número inventado.
  for (const proveedor of proveedoresPorRut.values()) {
    if (proveedor.productos_cotizados.length === 1) {
      const [unico] = proveedor.productos_cotizados;
      const montoTotalProveedor = proveedor.monto_total;
      unico.monto_total_producto = montoTotalProveedor;
      unico.precio_unitario = (montoTotalProveedor != null && unico.cantidad)
        ? Math.round(montoTotalProveedor / unico.cantidad)
        : null;
    }
  }
  const proveedoresCotizando = [...proveedoresPorRut.values()].map(({ _codigosYaAgregados, ...resto }) => resto);

  const item = {
    codigo,
    nombre: primera.NombreCotizacion || null,
    estado: { codigo: estadoCodigo },
    montos: { monto_disponible_clp: parsearMonto(primera.MontoTotalDisponble) },
    fechas: {
      fecha_publicacion: parsearFechaConHoraFija(primera.FechaPublicacionParaCotizar),
      fecha_cierre: parsearFechaConHoraFija(primera.FechaCierreParaCotizar),
    },
    institucion: {
      nombre_region: primera.Region || null,
      rut: primera.RUTUnidaddeCompra || null,
      organismo_comprador: primera.NombreOOPP || null,
    },
  };

  const detalle = {
    proveedores_cotizando: proveedoresCotizando,
    productos_solicitados: productosSolicitados,
  };

  return { item, detalle };
}

/** obtenerCodigosCompraAgilYaVistos en bloques — mandar millones de códigos en un solo `= ANY($1)` es innecesariamente pesado para Postgres. */
async function obtenerYaVistosEnBloques(codigos, tamanoBloque = 5000) {
  const yaVistos = new Set();
  const lista = [...codigos];
  for (let i = 0; i < lista.length; i += tamanoBloque) {
    const bloque = lista.slice(i, i + tamanoBloque);
    const encontrados = await obtenerCodigosCompraAgilYaVistos(bloque);
    for (const c of encontrados) yaVistos.add(c);
  }
  return yaVistos;
}

async function main() {
  const rutaArchivo = process.argv[2];
  if (!rutaArchivo) {
    console.error('Falta la ruta del archivo CSV.');
    console.error('Uso: node scripts/carga-compras-agiles-desde-csv.js {ruta-al-csv}');
    process.exit(1);
  }
  if (!fs.existsSync(rutaArchivo)) {
    console.error(`No se encontró el archivo: ${rutaArchivo}`);
    process.exit(1);
  }

  // PASADA 1: solo códigos (liviano en memoria incluso con millones de filas).
  console.log(`Leyendo ${rutaArchivo} (pasada 1/2 — contando cotizaciones únicas)...`);
  const { totalFilas, codigos } = await contarFilasYCodigosUnicos(rutaArchivo);
  console.log(`${totalFilas} filas, ${codigos.size} cotizaciones distintas (CodigoCotizacion) detectadas.\n`);

  console.log('Consultando cuáles ya existen en la base...');
  const yaVistos = await obtenerYaVistosEnBloques(codigos);
  const totalYaExistian = yaVistos.size;
  const totalNuevosAProcesar = codigos.size - totalYaExistian;
  console.log(`${totalYaExistian} ya existían en la base, ${totalNuevosAProcesar} nuevas a procesar.\n`);

  let totalGuardados = 0;
  let totalConError = 0;
  let procesados = 0;

  // PASADA 2: agrupa filas CONTIGUAS del mismo código y guarda cada
  // cotización nueva de inmediato al cerrarse su grupo — nunca se retiene
  // más que las filas de LA cotización que se está armando en ese momento,
  // sin importar cuán grande sea el archivo entero.
  console.log(`Leyendo ${rutaArchivo} (pasada 2/2 — guardando las nuevas)...`);
  const { gruposConFilasNoContiguas } = await procesarCsvPorGrupos(rutaArchivo, async (codigo, filasDelGrupo) => {
    if (yaVistos.has(codigo)) return;
    procesados++;
    try {
      const { item, detalle } = filasACompraAgil(codigo, filasDelGrupo);
      await guardarCompraAgil(item, detalle);
      totalGuardados++;
    } catch (err) {
      totalConError++;
      console.error(`  ❌ ${codigo}: ${err.message}`);
    }
    if (procesados % 500 === 0) {
      console.log(`  ...${procesados}/${totalNuevosAProcesar} procesadas.`);
    }
  });

  console.log('\n' + '─'.repeat(50));
  console.log('Resumen:');
  console.log(`  Archivo:                       ${rutaArchivo}`);
  console.log(`  Filas leídas:                  ${totalFilas}`);
  console.log(`  Cotizaciones distintas:        ${codigos.size}`);
  console.log(`  Ya existían (se omitieron):    ${totalYaExistian}`);
  console.log(`  Nuevas procesadas:             ${procesados}`);
  console.log(`  Guardadas en la base:          ${totalGuardados}`);
  console.log(`  Con error (estado desconocido u otro): ${totalConError}`);
  if (gruposConFilasNoContiguas > 0) {
    console.log(`  ⚠️  ${gruposConFilasNoContiguas} código(s) tenían filas NO contiguas en el archivo (se procesaron igual, como grupos separados) — revisar si el export vino ordenado distinto a lo esperado.`);
  }
  console.log('─'.repeat(50));

  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error general:', err);
    process.exit(1);
  });
}

module.exports = { main, filasACompraAgil, ESTADO_GLOSA_A_CODIGO, parsearFechaConHoraFija, parsearMonto, leerFilasCsv, contarFilasYCodigosUnicos, procesarCsvPorGrupos };
