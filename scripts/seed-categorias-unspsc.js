/**
 * Importa las categorías UNSPSC (nivel Commodity) a la base de datos.
 * Correr UNA VEZ después de la migración 014:
 *
 *   node scripts/seed-categorias-unspsc.js
 *
 * Usa ON CONFLICT DO UPDATE, así que se puede correr de nuevo sin problema
 * si más adelante se actualiza el archivo de datos (ej. con una fuente
 * mejor traducida al español).
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
    mapaPorCodigo.set(cat.codigo, { titulo: cat.titulo, nivel: cat.nivel || null });
  }
  const categorias = Array.from(mapaPorCodigo, ([codigo, { titulo, nivel }]) => ({ codigo, titulo, nivel }));

  console.log(`Importando ${categorias.length} categorías/productos (de ${categoriasRaw.length} filas originales, tras deduplicar)...`);

  for (let i = 0; i < categorias.length; i += LOTE) {
    const lote = categorias.slice(i, i + LOTE);

    const valores = [];
    const placeholders = lote.map((cat, idx) => {
      valores.push(cat.codigo, cat.titulo, cat.nivel);
      return `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3})`;
    }).join(', ');

    await pool.query(
      `INSERT INTO categorias_unspsc (codigo, titulo, nivel)
       VALUES ${placeholders}
       ON CONFLICT (codigo) DO UPDATE SET titulo = EXCLUDED.titulo, nivel = EXCLUDED.nivel`,
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
