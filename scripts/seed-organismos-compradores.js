/**
 * Importa el catálogo de organismos compradores (Listado oficial de
 * ChileCompra) a la base de datos. Correr UNA VEZ después de la migración 030:
 *
 *   node scripts/seed-organismos-compradores.js
 *
 * Usa ON CONFLICT DO UPDATE, así que se puede correr de nuevo sin problema si
 * más adelante se actualiza el archivo de datos (ej. una versión más reciente
 * del listado con organismos nuevos).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool');

const LOTE = 500;

async function main() {
  const dataPath = path.join(__dirname, '..', 'src', 'data', 'organismos-compradores.json');
  const organismos = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  console.log(`Importando ${organismos.length} organismos compradores...`);

  for (let i = 0; i < organismos.length; i += LOTE) {
    const lote = organismos.slice(i, i + LOTE);

    const valores = [];
    const placeholders = lote.map((o, idx) => {
      valores.push(o.codigo, o.nombre, o.sector);
      return `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3})`;
    }).join(', ');

    await pool.query(
      `INSERT INTO organismos_compradores (codigo, nombre, sector)
       VALUES ${placeholders}
       ON CONFLICT (codigo) DO UPDATE SET
         nombre = EXCLUDED.nombre,
         sector = EXCLUDED.sector`,
      valores
    );

    console.log(`  ${Math.min(i + LOTE, organismos.length)} / ${organismos.length}`);
  }

  console.log('Listo.');
  await pool.end();
}

main().catch((err) => {
  console.error('Error importando organismos compradores:', err);
  process.exit(1);
});
