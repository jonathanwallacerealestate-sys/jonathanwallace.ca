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

// Static assets (CSS + JS). Safe because we hard-code the allowed filenames.
const ALLOWED_ASSETS = {
  'dashboard.css': 'text/css; charset=utf-8',
  'dashboard.js': 'application/javascript; charset=utf-8',
  'dashboard.render.js': 'application/javascript; charset=utf-8',
  'dashboard.actions.js': 'application/javascript; charset=utf-8'
};

router.get('/assets/:name', (req, res) => {
  const name = req.params.name;
  const mime = ALLOWED_ASSETS[name];
  if (!mime) return res.status(404).send('Not found');
  try {
    res.type(mime).send(readView(name));
  } catch (e) {
    res.status(500).send('/* asset load error */');
  }
});

module.exports = router;
