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
const dashboardRoutes = require('./routes/dashboard');
const personalTasksRoutes = require('./routes/personalTasks');
const flaggedEmailsRoutes = require('./routes/flaggedEmails');
const crmFollowupsRoutes = require('./routes/crmFollowups');
const calendarRoutes = require('./routes/calendar');
const closingsRoutes = require('./routes/closings');
const workoutsRoutes = require('./routes/workouts');
const mealsRoutes = require('./routes/meals');
const marketingRoutes = require('./routes/marketing');
const categoriesRoutes = require('./routes/categories');
const syncRoutes = require('./routes/sync');
const dailyBriefRoutes = require('./routes/dailyBrief');
const settingsRoutes = require('./routes/settings');
const briefingRoutes = require('./routes/briefing');
const eventsRoutes = require('./routes/events');
const intuitionRoutes = require('./routes/intuition');
const lettersRoutes = require('./routes/letters');
const chromeRoutes = require('./routes/chrome');
const toolsRoutes = require('./routes/tools');
const schedulesRoutes = require('./routes/schedules');
const activityRoutes = require('./routes/activity');
const powerHourRoutes = require('./routes/powerHour');
const learningRoutes = require('./routes/learning');
const spotifyRoutes = require('./routes/spotify');
const fubRoutes = require('./routes/fub');
const templatesRoutes = require('./routes/templates');
const checklistsRoutes = require('./routes/checklists');
const { initDb } = require('./db/init');
const { startWorker } = require('./services/worker');
const { start: startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));

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

app.use('/api/health', healthRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/seller-form', sellerFormRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/personal-tasks', personalTasksRoutes);
app.use('/api/emails', flaggedEmailsRoutes);
app.use('/api/follow-ups', crmFollowupsRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/closings', closingsRoutes);
app.use('/api/workouts', workoutsRoutes);
app.use('/api/meals', mealsRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/daily-brief', dailyBriefRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/brief', briefingRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/intuition', intuitionRoutes);
app.use('/api/letters', lettersRoutes);
app.use('/api/chrome', chromeRoutes);
app.use('/api/tools', toolsRoutes);
app.use('/api/schedules', schedulesRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/power-hour', powerHourRoutes);
app.use('/api/learning', learningRoutes);
app.use('/api/spotify', spotifyRoutes);
app.use('/api/fub', fubRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/checklists', checklistsRoutes);
app.use('/dashboard', dashboardRoutes);

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

async function start() {
  try {
    await initDb();
    console.log('Database initialized');

    if (process.env.ANTHROPIC_API_KEY) {
      startWorker();
      console.log('Task worker started');
    } else {
      console.warn('WARNING: No ANTHROPIC_API_KEY set — task worker disabled');
    }

    startScheduler();
    console.log('Scheduler started');

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
