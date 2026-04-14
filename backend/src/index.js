require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const contactRoutes = require('./routes/contact');
const sellerFormRoutes = require('./routes/sellerForm');
const listingsRoutes = require('./routes/listings');
const healthRoutes = require('./routes/health');
const tasksRoutes = require('./routes/tasks');
const { initDb } = require('./db/init');
const { startWorker } = require('./services/worker');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------
// Middleware
// ---------------------

app.use(helmet());

app.use(cors({
  origin: [
    'https://jonathanwallace.ca',
    'https://www.jonathanwallace.ca',
    'https://seller-form-jonathan-wallace.netlify.app',
    /\.make\.com$/,
    /\.integromat\.com$/
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ---------------------
// Routes
// ---------------------
app.use('/api/health', healthRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/seller-form', sellerFormRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/tasks', tasksRoutes);

app.get('/', (req, res) => {
  res.json({
    name: 'The Official Realty Group API',
    version: '1.0.0',
    status: 'running',
    docs: '/api/health'
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ---------------------
// Start
// ---------------------
async function start() {
  try {
    await initDb();
    console.log('Database initialized');

    if (process.env.ANTHROPIC_API_KEY) {
      startWorker();
      console.log('Task worker started — agent is ready for instructions');
    } else {
      console.warn('WARNING: No ANTHROPIC_API_KEY set — task worker disabled');
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log('API server running on port ' + PORT);
      console.log('Environment: ' + (process.env.NODE_ENV || 'development'));
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
