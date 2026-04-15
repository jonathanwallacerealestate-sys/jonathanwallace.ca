const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const VIEW_DIR = path.join(__dirname, '..', 'views');

// Cache views at startup for speed; set NODE_ENV=development to disable caching
const CACHE_ENABLED = process.env.NODE_ENV !== 'development';
const cache = {};

function readView(name) {
  if (CACHE_ENABLED && cache[name]) return cache[name];
  const content = fs.readFileSync(path.join(VIEW_DIR, name), 'utf8');
  if (CACHE_ENABLED) cache[name] = content;
  return content;
}

function renderWithKey(html, apiKey) {
  return html.replace(/__API_KEY__/g, apiKey || '');
}

// Main dashboard HTML — API-key-gated
router.get('/', (req, res) => {
  const key = req.query.key;
  if (process.env.API_KEY && key !== process.env.API_KEY) {
    return res.status(401).send(readView('login.html'));
  }
  res.type('html').send(renderWithKey(readView('dashboard.html'), key || process.env.API_KEY));
});

// Static assets (CSS + JS + icons). Hard-coded allowlist for safety.
const ALLOWED_ASSETS = {
  'dashboard.css': 'text/css; charset=utf-8',
  'dashboard.js': 'application/javascript; charset=utf-8',
  'dashboard.render.js': 'application/javascript; charset=utf-8',
  'dashboard.actions.js': 'application/javascript; charset=utf-8',
  'dashboard.settings.js': 'application/javascript; charset=utf-8',
  'dashboard.briefing.js': 'application/javascript; charset=utf-8',
  'dashboard.tools.js': 'application/javascript; charset=utf-8',
  'dashboard.chart.js': 'application/javascript; charset=utf-8',
  'dashboard.voice.js': 'application/javascript; charset=utf-8',
  'dashboard.letters.js': 'application/javascript; charset=utf-8',
  'dashboard.intuition.js': 'application/javascript; charset=utf-8',
  'dashboard.chrome.js': 'application/javascript; charset=utf-8',
  'dashboard.schedules.js': 'application/javascript; charset=utf-8',
  'dashboard.leadgen.js': 'application/javascript; charset=utf-8',
  'icon-192.svg': 'image/svg+xml; charset=utf-8',
  'icon-512.svg': 'image/svg+xml; charset=utf-8'
};

router.get('/assets/:name', (req, res) => {
  const name = req.params.name;
  const mime = ALLOWED_ASSETS[name];
  if (!mime) return res.status(404).send('Not found');
  try {
    res.set('Cache-Control', 'public, max-age=600').type(mime).send(readView(name));
  } catch (e) {
    res.status(500).send('/* asset load error */');
  }
});

// PWA manifest + service worker (public, no API key needed to install)
router.get('/manifest.json', (req, res) => {
  res.type('application/manifest+json').send(readView('manifest.json'));
});
router.get('/sw.js', (req, res) => {
  res.type('application/javascript').send(readView('sw.js'));
});

module.exports = router;
