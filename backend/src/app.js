'use strict';

const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const { createStore } = require('./store');
const { normalizeSnapshot } = require('./snapshot');
const { torontoDate, isDateString, ZONE } = require('./time');
const { renderDesk, renderGate, iconSvg } = require('./render');
const {
  setSessionCookie,
  secretsOf,
  hasSession,
  presentedSecrets,
  matchesAny,
  safeNext
} = require('./auth');

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const bucket = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (bucket.length >= max) {
      return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
    }
    bucket.push(now);
    hits.set(req.ip, bucket);
    next();
  };
}

function createApp(opts = {}) {
  const ingestToken = opts.ingestToken !== undefined ? opts.ingestToken : (process.env.DESK_INGEST_TOKEN || '');
  const pin = opts.pin !== undefined ? opts.pin : (process.env.DESK_PIN || '');
  const dataDir = opts.dataDir;
  if (!dataDir) throw new Error('createApp requires dataDir');
  const store = opts.store || createStore(dataDir);
  const doSeed = opts.seed !== undefined ? opts.seed : true;
  if (doSeed) store.seedIfEmpty(torontoDate());

  const secrets = secretsOf({ pin, ingestToken });
  const uiLocked = secrets.length > 0;
  const gateMode = pin ? 'pin' : 'token';

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' }
  }));
  app.use(morgan((tokens, req, res) => {
    const url = String(tokens.url(req, res) || '').split('?')[0];
    return [tokens.method(req, res), url, tokens.status(req, res), tokens['response-time'](req, res) + 'ms'].join(' ');
  }));
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));

  const ingestLimit = rateLimit({ windowMs: 60 * 1000, max: 30 });
  const sessionLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 12 });

  function noStore(res) {
    res.set('Cache-Control', 'no-store');
  }

  function authorizedRead(req) {
    if (!uiLocked) return true;
    if (hasSession(req, secrets)) return true;
    const presented = presentedSecrets(req);
    return matchesAny(presented, ingestToken) || matchesAny(presented, pin);
  }

  function unlockSecret(body) {
    const pinTry = body && body.pin != null ? String(body.pin) : '';
    const tokenTry = body && body.token != null ? String(body.token) : '';
    if (pin && pinTry && matchesAny([pinTry], pin)) return pin;
    if (ingestToken && tokenTry && matchesAny([tokenTry], ingestToken)) return ingestToken;
    if (!pin && ingestToken && pinTry && matchesAny([pinTry], ingestToken)) return ingestToken;
    return '';
  }

  function maybeGrant(req, res) {
    if (!uiLocked) return false;
    if (req.query.token == null && req.query.pin == null) return false;
    const qToken = req.query.token != null ? String(req.query.token) : '';
    const qPin = req.query.pin != null ? String(req.query.pin) : '';
    let secret = '';
    if (qToken && ingestToken && matchesAny([qToken], ingestToken)) secret = ingestToken;
    else if (qPin && pin && matchesAny([qPin], pin)) secret = pin;
    else if (qToken && pin && matchesAny([qToken], pin)) secret = pin;
    if (secret) setSessionCookie(res, req, secret);
    const nextUrl = new URL(req.originalUrl, 'http://desk.local');
    nextUrl.searchParams.delete('token');
    nextUrl.searchParams.delete('pin');
    const target = `${nextUrl.pathname}${nextUrl.search}` || '/';
    res.redirect(302, target);
    return true;
  }

  app.get('/api/health', (req, res) => {
    const db = store.health();
    const last = db.ok ? store.lastSnapshot() : null;
    const now = Date.now();
    let ageSeconds = null;
    if (last && last.updatedAt) {
      const t = new Date(last.updatedAt).getTime();
      if (!Number.isNaN(t)) ageSeconds = Math.max(0, Math.round((now - t) / 1000));
    }
    const body = {
      status: db.ok ? 'ok' : 'unhealthy',
      service: 'wallace-desk',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      timezone: ZONE,
      today: torontoDate(),
      database: {
        ok: db.ok,
        driver: db.driver,
        ...(db.ok ? {} : { error: 'snapshot store unreadable' })
      },
      lastSnapshot: last ? {
        date: last.date,
        updatedAt: last.updatedAt,
        ageSeconds,
        seeded: Boolean(last.seeded)
      } : null,
      auth: {
        uiLocked,
        ingestConfigured: Boolean(ingestToken)
      }
    };
    noStore(res);
    res.status(db.ok ? 200 : 503).json(body);
  });

  app.post('/api/desk/snapshot', ingestLimit, (req, res) => {
    if (!ingestToken) {
      return res.status(503).json({ error: 'DESK_INGEST_TOKEN is not configured' });
    }
    if (!matchesAny(presentedSecrets(req), ingestToken)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const snapshot = normalizeSnapshot(req.body, { today: torontoDate() });
      store.upsert(snapshot);
      noStore(res);
      res.json({ ok: true, date: snapshot.date, updatedAt: snapshot.updatedAt });
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message || 'Invalid snapshot' });
    }
  });

  app.get('/api/desk/today', (req, res) => {
    if (!authorizedRead(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const requested = req.query.date ? String(req.query.date) : torontoDate();
    if (!isDateString(requested)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const snapshot = store.get(requested);
    noStore(res);
    if (!snapshot) {
      return res.status(404).json({
        error: 'No snapshot for today',
        date: requested,
        hint: 'Run the weekday desk board or POST /api/desk/snapshot'
      });
    }
    res.json(snapshot);
  });

  app.post('/api/desk/session', sessionLimit, (req, res) => {
    const next = safeNext(req.body && req.body.next);
    if (!uiLocked) return res.redirect(302, next);
    const secret = unlockSecret(req.body || {});
    if (!secret) {
      const join = next.includes('?') ? '&' : '?';
      return res.redirect(302, `${next}${join}locked=1`);
    }
    setSessionCookie(res, req, secret);
    res.redirect(302, next);
  });

  app.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json');
    res.set('Cache-Control', 'public, max-age=86400');
    res.json({
      name: 'Wallace Desk',
      short_name: 'Desk',
      start_url: '/',
      display: 'standalone',
      background_color: '#0c1116',
      theme_color: '#0c1116',
      icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
    });
  });

  app.get('/icon.svg', (req, res) => {
    res.type('image/svg+xml');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(iconSvg());
  });

  app.get('/favicon.ico', (req, res) => {
    res.redirect(302, '/icon.svg');
  });

  app.use('/dashboard', (req, res) => {
    res.redirect(302, '/');
  });

  app.get('/', (req, res) => {
    if (maybeGrant(req, res)) return;
    const today = torontoDate();
    const requested = req.query.date ? String(req.query.date) : today;
    if (req.query.date && !isDateString(requested)) {
      noStore(res);
      return res.status(400).type('html').send(renderDesk({ snapshot: null, today, previous: null }));
    }
    if (!authorizedRead(req)) {
      noStore(res);
      const next = requested === today ? '/' : `/?date=${requested}`;
      return res.status(401).type('html').send(renderGate({
        mode: gateMode,
        error: req.query.locked === '1',
        next
      }));
    }
    const snapshot = store.get(requested);
    noStore(res);
    res.type('html').send(renderDesk({
      snapshot,
      today,
      viewDate: requested,
      previous: store.previous(snapshot ? snapshot.date : today),
      now: new Date()
    }));
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    console.error('[wallace-desk]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
