/**
 * Carga masiva de licitaciones desde el Excel histórico mensual de
 * ChileCompra ("carga_masiva_licitaciones.xlsx") a licitaciones_vistas.
 *
 * Ese Excel viene UNA FILA POR CADA (ítem × oferta) — si una licitación
 * tiene 3 ítems y cada uno recibió 2 ofertas, son 6 filas para la MISMA
 * licitación. Este script:
 *   1. Agrupa las filas por CodigoExterno (una licitación = un grupo).
 *   2. Dentro de cada grupo, agrupa de nuevo por Correlativo (un ítem = un
 *      sub-grupo) y se queda con la fila marcada "Oferta seleccionada" =
 *      "Seleccionada" como la ganadora de ese ítem (si no hay ninguna
 *      marcada así todavía, el ítem queda con adjudicacion=null, igual que
 *      hace la app con una licitación recién publicada).
 *   3. Arma, por cada licitación, un objeto con la MISMA FORMA que ya
 *      devuelve la API de Mercado Público (Listado[i] de licitaciones.json)
 *      y se lo pasa TAL CUAL a guardarLicitacion() — la misma función que ya
 *      usa el resto de la app (poll-licitaciones.js) — para no duplicar la
 *      lógica de INSERT ni el armado del campo `items` en dos lugares
 *      distintos que se puedan desincronizar con el tiempo.
 *
 * LIMITACIONES REALES del propio archivo Excel (no del script — no hay forma
 * de completar esto sin inventar datos):
 *   - Las fechas vienen solo con el día, sin hora real — se guardan al
 *     mediodía (12:00:00), no a medianoche, a propósito: Postgres interpreta
 *     el valor como hora LOCAL del proceso Node al leerlo (Render corre en
 *     UTC), y medianoche ahí se convierte en medianoche UTC — que al
 *     mostrarse en hora de Chile (siempre detrás de UTC) cruza al día
 *     anterior. Al mediodía esto no pasa nunca (Chile nunca está más de 4
 *     horas detrás de UTC). Aun así, si en algún reporte se necesitara la
 *     hora EXACTA de publicación/cierre/adjudicación, esta carga no la tiene
 *     — solo el polling en vivo contra la API sí trae hora real.
 *   - No trae el link al acta de adjudicación (url_acta) — queda null. Si
 *     más adelante el job nocturno de revisión de resoluciones vuelve a
 *     pasar por esa licitación, ahí sí se completa.
 *   - Los nombres de categoría/producto vienen en MAYÚSCULA en el Excel; se
 *     normalizan a "Primera letra mayúscula, resto minúscula" para que se
 *     vean como el resto de lo que ya está guardado — no es perfecto (un
 *     nombre propio en medio de la frase queda en minúscula), pero es lo
 *     más razonable sin inventar reglas de mayúsculas más complejas.
 *
 * Uso:
 *   node scripts/carga-masiva-licitaciones.js /ruta/a/carga_masiva_licitaciones.xlsx
 *
 * Necesita la librería xlsx (ya agregada a package.json) — si no la tenés
 * instalada: npm install
 */
require('dotenv').config({ quiet: true });
const XLSX = require('xlsx');
const pool = require('../src/db/pool');
const { guardarLicitacion, licitacionYaVista } = require('../src/db/licitaciones.queries');

function numOrNull(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isNaN(n) ? null : n;
}

function strOrNull(valor) {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  return s === '' ? null : s;
}

// "SERVICIOS DE TRANSPORTE" -> "Servicios de transporte" — ver limitación
// explicada arriba (no es una capitalización gramaticalmente perfecta).
function capitalizarPrimera(texto) {
  if (!texto) return texto;
  const limpio = texto.trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1).toLowerCase();
}

let vecesLogueadas = 0;

// El Excel trae fechas como "2026-06-30" (string) o como número de serie de
// Excel, según cómo esté formateada la columna — se soportan los dos casos.
//
// OJO acá: se guarda al MEDIODÍA (12:00:00), no a medianoche. La columna es
// TIMESTAMP sin zona horaria, pero el driver de Postgres (pg) igual arma un
// objeto Date de JS al leerla, interpretando el valor como hora LOCAL del
// proceso Node — que en Render corre en UTC. Una fecha guardada a medianoche
// se convierte en medianoche UTC, y al mostrarla en el navegador (hora de
// Chile, detrás de UTC) el día se corre hacia atrás — "15" termina
// mostrándose como "14" o "13" según cuántas conversiones de por medio haya.
// Al mediodía, Chile nunca está más de 4 horas detrás de UTC, así que la
// resta nunca cruza la medianoche — el día que se ve siempre es el correcto.
function fechaOrNull(valor, etiqueta) {
  if (!valor) return null;

  let resultado;
  if (typeof valor === 'number') {
    // El archivo real trae estas "fechas" con una fracción de hora pegada
    // (ej. 46217.8328125 = 14-jul 19:59), resabio de cómo lo exportó
    // ChileCompra — probablemente por una conversión de zona horaria de su
    // lado, no algo que podamos corregir en el origen. Truncar la parte
    // entera (lo que hacía antes) toma el día ANTERIOR cuando la hora cae
    // tarde — se redondea al día más cercano en su lugar, que es lo que de
    // verdad corresponde (0.83 está mucho más cerca del día siguiente que
    // del inicio del día actual).
    const fecha = XLSX.SSF.parse_date_code(Math.round(valor));
    resultado = fecha ? `${fecha.y}-${String(fecha.m).padStart(2, '0')}-${String(fecha.d).padStart(2, '0')}T12:00:00` : null;
  } else {
    const soloFecha = strOrNull(valor);
    // Si ya viniera con hora incluida (no debería, pero por las dudas), no se
    // le pega un "T12:00:00" encima.
    resultado = /^\d{4}-\d{2}-\d{2}$/.test(soloFecha || '') ? `${soloFecha}T12:00:00` : soloFecha;
  }

  // Traza temporal de diagnóstico — imprime las primeras 5 fechas que
  // procesa, mostrando EXACTAMENTE qué valor crudo vino del Excel (con su
  // tipo de dato), de qué campo, y en qué se transformó. Se puede borrar
  // este bloque una vez confirmado que el mapeo es correcto contra el
  // archivo real.
  if (vecesLogueadas < 5) {
    console.log(`  [debug ${etiqueta || '?'}] crudo=${JSON.stringify(valor)} (tipo: ${typeof valor}) -> ${resultado}`);
    vecesLogueadas++;
  }

  return resultado;
}

/**
 * Arma la "categoría" combinando Rubro1/Rubro2/Rubro3, igual al formato
 * "Segmento / Familia / Clase" que ya trae la API en el campo Categoria.
 */
function armarCategoria(fila) {
  const partes = [fila['Rubro1'], fila['Rubro2'], fila['Rubro3']]
    .map((r) => capitalizarPrimera(strOrNull(r)))
    .filter(Boolean);
  return partes.length > 0 ? partes.join(' / ') : null;
}

// UNSPSC es jerárquico de a pares de dígitos (segmento-familia-clase-
// producto, 2 dígitos cada uno) — la "categoría" es el nivel "clase", que
// se obtiene truncando los últimos 2 dígitos (el nivel "producto") a cero.
// Ej: 78111502 -> 78111500. Verificado contra el CSV real de ejemplo.
function derivarCodigoCategoria(codigoProducto) {
  if (!codigoProducto) return null;
  const str = String(codigoProducto);
  if (str.length !== 8) return null;
  return str.slice(0, 6) + '00';
}

/**
 * Convierte el grupo de filas de UNA licitación (todas sus filas de
 * ítem×oferta) en un objeto con la misma forma que Listado[i] de la API de
 * Mercado Público — así se le puede pasar tal cual a guardarLicitacion().
 */
function filasADetalle(filasLicitacion) {
  const cabecera = filasLicitacion[0];

  // Agrupar por ítem (Correlativo) — cada ítem puede tener varias filas,
  // una por cada oferente que participó en esa línea.
  const filasPorItem = new Map();
  for (const fila of filasLicitacion) {
    const correlativo = fila['Correlativo'];
    if (!filasPorItem.has(correlativo)) filasPorItem.set(correlativo, []);
    filasPorItem.get(correlativo).push(fila);
  }

  const itemsListado = [...filasPorItem.values()].map((filasItem) => {
    const base = filasItem[0];
    const filaGanadora = filasItem.find((f) => strOrNull(f['Oferta seleccionada']) === 'Seleccionada');

    const codigoProducto = numOrNull(base['CodigoProductoONU']);

    const item = {
      CodigoProducto: codigoProducto,
      CodigoCategoria: derivarCodigoCategoria(codigoProducto),
      Categoria: armarCategoria(base),
      NombreProducto: capitalizarPrimera(strOrNull(base['Nombre producto genrico'])),
    };

    if (filaGanadora) {
      item.Adjudicacion = {
        RutProveedor: strOrNull(filaGanadora['RutProveedor']),
        NombreProveedor: strOrNull(filaGanadora['NombreProveedor']),
        Cantidad: numOrNull(filaGanadora['CantidadAdjudicada']),
        MontoUnitario: numOrNull(filaGanadora['MontoUnitarioOferta']),
      };
    }

    return item;
  });

  return {
    CodigoExterno: strOrNull(cabecera['CodigoExterno']),
    Nombre: strOrNull(cabecera['Nombre']),
    Estado: strOrNull(cabecera['Estado']),
    Tipo: strOrNull(cabecera['Tipo']),
    MontoEstimado: numOrNull(cabecera['MontoEstimado']),
    Comprador: {
      RegionUnidad: strOrNull(cabecera['RegionUnidad']),
      NombreOrganismo: strOrNull(cabecera['NombreOrganismo']),
      CodigoOrganismo: strOrNull(cabecera['CodigoOrganismo']),
    },
    Fechas: {
      FechaPublicacion: fechaOrNull(cabecera['FechaPublicacion'], `${cabecera['CodigoExterno']} FechaPublicacion`),
      FechaCierre: fechaOrNull(cabecera['FechaCierre'], `${cabecera['CodigoExterno']} FechaCierre`),
      FechaAdjudicacion: fechaOrNull(cabecera['FechaAdjudicacion'], `${cabecera['CodigoExterno']} FechaAdjudicacion`),
    },
    Adjudicacion: {
      NumeroOferentes: numOrNull(cabecera['NumeroOferentes']),
      UrlActa: null, // el Excel no lo trae — ver limitaciones arriba
    },
    Items: { Listado: itemsListado },
  };
}

async function main() {
  const rutaArchivo = process.argv[2];
  if (!rutaArchivo) {
    console.error('Falta la ruta del Excel. Uso: node scripts/carga-masiva-licitaciones.js /ruta/al/archivo.xlsx');
    process.exit(1);
  }

  console.log(`Leyendo ${rutaArchivo}...`);
  const libro = XLSX.readFile(rutaArchivo, { cellDates: false });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { defval: null });
  console.log(`${filas.length} filas leídas (${libro.SheetNames[0]}).`);

  // Agrupar TODAS las filas del archivo por licitación.
  const filasPorLicitacion = new Map();
  for (const fila of filas) {
    const codigo = strOrNull(fila['CodigoExterno']);
    if (!codigo) continue;
    if (!filasPorLicitacion.has(codigo)) filasPorLicitacion.set(codigo, []);
    filasPorLicitacion.get(codigo).push(fila);
  }

  const totalLicitaciones = filasPorLicitacion.size;
  console.log(`${totalLicitaciones} licitaciones distintas detectadas en el archivo.\n`);

  let insertadas = 0;
  let yaExistian = 0;
  let conError = 0;
  let procesadas = 0;

  for (const [codigo, filasLicitacion] of filasPorLicitacion) {
    procesadas++;
    try {
      if (await licitacionYaVista(codigo)) {
        yaExistian++;
      } else {
        const detalle = filasADetalle(filasLicitacion);
        await guardarLicitacion(detalle);
        insertadas++;
      }
    } catch (err) {
      conError++;
      console.error(`  ❌ ${codigo}: ${err.message}`);
    }

    if (procesadas % 200 === 0) {
      console.log(`  ...${procesadas}/${totalLicitaciones} procesadas (${insertadas} insertadas, ${yaExistian} ya existían, ${conError} con error)`);
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log('Resumen:');
  console.log(`  Licitaciones en el archivo: ${totalLicitaciones}`);
  console.log(`  Insertadas nuevas:          ${insertadas}`);
  console.log(`  Ya existían (se omitieron): ${yaExistian}`);
  console.log(`  Con error:                  ${conError}`);
  console.log('─'.repeat(50));

  await pool.end();
}

// Solo corre main() si el archivo se ejecuta directo (node scripts/carga-masiva-licitaciones.js ...)
// — no si se importa con require(), como hace el script de prueba que no
// necesita ni un archivo real ni conexión a la base.
if (require.main === module) {
  main().catch((err) => {
    console.error('Error general:', err);
    process.exit(1);
  });
}

module.exports = { filasADetalle, derivarCodigoCategoria, capitalizarPrimera, fechaOrNull };
