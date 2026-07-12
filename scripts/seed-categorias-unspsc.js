/**
 * Importa las categorías/rubros y productos UNSPSC a la base de datos, con su
 * jerarquía (nivel1 = segmento, nivel2 = familia) para poder armar el árbol
 * de navegación por rubro (migración 025). Correr UNA VEZ después de esa
 * migración:
 *
 *   node scripts/seed-categorias-unspsc.js
 *
 * Usa ON CONFLICT DO UPDATE, así que se puede correr de nuevo sin problema
 * si más adelante se actualiza el archivo de datos (ej. una versión más
 * completa o mejor traducida del Excel de origen).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool');

const LOTE = 500;

async function main() {
  const dataPath = path.join(__dirname, '..', 'src', 'data', 'categorias-unspsc.json');
  const categoriasRaw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // Deduplicar por código (el Excel de origen puede repetir códigos).
  const mapaPorCodigo = new Map();
  for (const cat of categoriasRaw) {
    mapaPorCodigo.set(cat.codigo, {
      titulo: cat.titulo,
      nivel: cat.nivel || null,
      nivel1: cat.nivel1 || null,
      nivel2: cat.nivel2 || null,
      hijos: cat.hijos || null,
    });
  }
  const categorias = Array.from(mapaPorCodigo, ([codigo, v]) => ({ codigo, ...v }));

  console.log(`Importando ${categorias.length} categorías/productos (de ${categoriasRaw.length} filas originales, tras deduplicar)...`);

  for (let i = 0; i < categorias.length; i += LOTE) {
    const lote = categorias.slice(i, i + LOTE);

    const valores = [];
    const placeholders = lote.map((cat, idx) => {
      valores.push(cat.codigo, cat.titulo, cat.nivel, cat.nivel1, cat.nivel2, cat.hijos);
      return `($${idx * 6 + 1}, $${idx * 6 + 2}, $${idx * 6 + 3}, $${idx * 6 + 4}, $${idx * 6 + 5}, $${idx * 6 + 6})`;
    }).join(', ');

    await pool.query(
      `INSERT INTO categorias_unspsc (codigo, titulo, nivel, nivel1, nivel2, hijos)
       VALUES ${placeholders}
       ON CONFLICT (codigo) DO UPDATE SET
         titulo = EXCLUDED.titulo,
         nivel = EXCLUDED.nivel,
         nivel1 = EXCLUDED.nivel1,
         nivel2 = EXCLUDED.nivel2,
         hijos = EXCLUDED.hijos`,
      valores
    );

    console.log(`  ${Math.min(i + LOTE, categorias.length)} / ${categorias.length}`);
  }

  console.log('Listo.');
  await pool.end();
}

main().catch((err) => {
  console.error('Error importando categorías:', err);
  process.exit(1);
});
