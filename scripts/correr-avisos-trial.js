/**
 * Corre el job de avisos de trial (avisos-trial.js) a mano, sin esperar a
 * las 08:00 del cron. Útil para probar después de usar expirar-trial.js.
 *
 * Corre con: node scripts/correr-avisos-trial.js
 */
require('dotenv').config({ quiet: true });
const { correrAvisosTrial } = require('../src/jobs/avisos-trial');
const pool = require('../src/db/pool');

correrAvisosTrial()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Error corriendo el job:', err.message);
    process.exit(1);
  });
