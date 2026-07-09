/**
 * Script de prueba de conexión a la base de datos.
 * Corre con: node test-connection.js
 * Lee la variable DATABASE_URL desde tu archivo .env
 */

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
});

async function probarConexion() {
  console.log('Intentando conectar...\n');

  try {
    const result = await pool.query('SELECT NOW() AS ahora, current_database() AS db');
    console.log('✅ Conexión exitosa');
    console.log('   Base de datos:', result.rows[0].db);
    console.log('   Hora del servidor:', result.rows[0].ahora);

    // Bonus: verifica que las tablas del esquema existan
    const tablas = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    if (tablas.rows.length === 0) {
      console.log('\n⚠️  Conectaste bien, pero no hay tablas todavía.');
      console.log('   Corre el contenido de src/db/schema.sql en el SQL Editor de Supabase.');
    } else {
      console.log('\n📋 Tablas encontradas:');
      tablas.rows.forEach(row => console.log('   -', row.table_name));
    }
  } catch (err) {
    console.error('❌ Error de conexión:', err.message);
    console.log('\nRevisa:');
    console.log('  1. Que reemplazaste [YOUR-PASSWORD] por tu contraseña real en .env');
    console.log('  2. Que el string tenga "://" después de "postgresql" (no solo ":")');
    console.log('  3. Que no haya espacios ni saltos de línea pegados por error al copiar');
  } finally {
    await pool.end();
  }
}

probarConexion();
