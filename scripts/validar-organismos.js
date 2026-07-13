/**
 * Valida qué tan bien calza el catálogo nuevo (organismos_compradores, del
 * listado oficial) contra los nombres de organismo que YA aparecen en tus
 * datos reales (licitaciones_vistas.nombre_organismo y
 * compras_agiles_vistas.nombre_institucion).
 *
 * Por qué importa: el matching de alertas compara por NOMBRE EXACTO. Si el
 * catálogo nuevo tiene un nombre con formato distinto al que realmente
 * reporta Mercado Público en cada proceso (mayúsculas, espacios, acentos,
 * abreviaciones), un usuario podría elegir ese organismo en su alerta y
 * nunca recibir notificaciones — sin ningún error visible.
 *
 * Corre esto DESPUÉS de sembrar el catálogo (seed-organismos-compradores.js):
 *
 *   node scripts/validar-organismos.js
 *
 * No modifica nada, solo imprime un reporte.
 */
require('dotenv').config();
const pool = require('../src/db/pool');

async function main() {
  console.log('Comparando organismos_compradores contra los nombres reales ya vistos...\n');

  const { rows: reales } = await pool.query(`
    SELECT DISTINCT TRIM(organismo) AS organismo FROM (
      SELECT nombre_organismo AS organismo FROM licitaciones_vistas WHERE nombre_organismo IS NOT NULL
      UNION
      SELECT nombre_institucion AS organismo FROM compras_agiles_vistas WHERE nombre_institucion IS NOT NULL
    ) t
    WHERE TRIM(organismo) != ''
  `);

  const { rows: catalogo } = await pool.query('SELECT nombre FROM organismos_compradores');

  const nombresReales = reales.map((r) => r.organismo);
  const setCatalogoExacto = new Set(catalogo.map((c) => c.nombre));
  const setCatalogoNorm = new Set(catalogo.map((c) => c.nombre.trim().toUpperCase()));

  let exactos = 0;
  let soloNormalizado = 0;
  const sinMatch = [];

  for (const nombre of nombresReales) {
    if (setCatalogoExacto.has(nombre)) {
      exactos++;
    } else if (setCatalogoNorm.has(nombre.trim().toUpperCase())) {
      soloNormalizado++;
    } else {
      sinMatch.push(nombre);
    }
  }

  console.log(`Nombres reales distintos ya vistos en tus datos: ${nombresReales.length}`);
  console.log(`  ✅ Coinciden EXACTO con el catálogo:              ${exactos}`);
  console.log(`  ⚠️  Coinciden solo normalizando mayúsculas/espacios: ${soloNormalizado} (esto puede ser peligroso, ver abajo)`);
  console.log(`  ❌ No aparecen en el catálogo en absoluto:          ${sinMatch.length}`);

  if (soloNormalizado > 0) {
    console.log('\n⚠️  Los que solo calzan "normalizando" son el caso riesgoso: si un usuario elige');
    console.log('   ese organismo desde el picker (con el texto EXACTO del catálogo), su alerta NO');
    console.log('   va a matchear contra el nombre real que reporta Mercado Público, porque el');
    console.log('   matching compara por igualdad exacta, no normalizada. Si esta lista es larga,');
    console.log('   avísame y puedo cambiar matching.service.js para comparar de forma normalizada');
    console.log('   (mayúsculas/espacios), no exacta.');
  }

  if (sinMatch.length > 0) {
    console.log(`\n❌ Nombres reales que NO están en el catálogo (primeros 30 de ${sinMatch.length}):`);
    sinMatch.slice(0, 30).forEach((n) => console.log('   -', n));
    console.log('\n   Puede ser que: (a) el listado oficial no incluya ese organismo (raro, pero pasa');
    console.log('   con instituciones nuevas), o (b) el nombre real viene con algo distinto (typo,');
    console.log('   sufijo, etc.) — conviene revisar algunos casos a mano.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Error validando organismos:', err);
  process.exit(1);
});
