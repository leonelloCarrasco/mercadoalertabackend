const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const alertsRoutes = require('./routes/alerts.routes');
const empresasRoutes = require('./routes/empresas.routes');
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/empresas', empresasRoutes);
app.use('/api/pagos', pagosRoutes);

module.exports = app;
