const express = require('express');
const cors = require('cors');
const pool = require('./db/pool');

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const alertsRoutes = require('./routes/alerts.routes');
const empresasRoutes = require('./routes/empresas.routes');
const empresaGestionRoutes = require('./routes/empresa-gestion.routes');
const analisisRoutes = require('./routes/analisis.routes');
const pagosRoutes = require('./routes/pagos.routes');

const app = express();

const ORIGENES_PERMITIDOS = [
  'https://mercadoalerta.cl',
  'https://www.mercadoalerta.cl',
  'https://dashboard.mercadoalerta.cl',
  'http://localhost:3000',
  'http://127.0.0.1:5500',  // Live Server (VS Code)
  'http://127.0.0.1:5501',   // Live Server (VS Code)
  'http://localhost:5500',
  'http://localhost:8000',   // python -m http.server
  'http://127.0.0.1:8000',
];

app.use(cors({
  origin: (origin, callback) => {
    // Permite requests sin 'origin' (ej. curl, Postman) y los dominios de la lista.
    if (!origin || ORIGENES_PERMITIDOS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No autorizado por CORS'));
    }
  },
}));
app.use(express.json());
app.use(express.static('public'));

// Este endpoint tiene doble propósito:
// 1. Confirmar que el servidor Y la base de datos están realmente conectados
//    (no solo que el proceso de Node responde).
// 2. Servir de "ping" para servicios de uptime (ej. UptimeRobot) que mantienen
//    el servicio despierto en hostings gratuitos que duermen por inactividad
//    (ver README para el detalle de esa estrategia).
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[health] Error de conexión a la base de datos:', err.message);
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/empresas', empresasRoutes);
app.use('/api/empresas', empresaGestionRoutes);
app.use('/api/pagos', pagosRoutes);
app.use('/api/analisis', analisisRoutes);

module.exports = app;
