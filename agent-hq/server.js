import express from 'express';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// Google OAuth 2.0 Configuration
// ─────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/api/auth/callback`;
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const TOKEN_PATH = path.join(__dirname, '.gcal-tokens.json');

const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);

// ─────────────────────────────────────────────
// Token Storage & Auto-Refresh
// ─────────────────────────────────────────────
let tokens = null;
let tokenError = null;

// Status cache — avoids hammering Google API on every frontend poll
let statusCache = { result: null, timestamp: 0 };
const STATUS_CACHE_TTL = 3 * 60 * 1000; // 3 minutes
let consecutiveFailures = 0;

function loadTokens() {
  // Priority 1: Load from disk (survives restarts within same deploy)
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      oauth2Client.setCredentials(tokens);
      tokenError = null;
      console.log('[GCal] Tokens loaded from disk');
      return true;
    }
  } catch (err) {
    console.error('[GCal] Failed to load tokens from disk:', err.message);
  }

  // Priority 2: Bootstrap from GOOGLE_REFRESH_TOKEN env var (survives deploys)
  const envRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (envRefreshToken) {
    console.log('[GCal] Bootstrapping from GOOGLE_REFRESH_TOKEN env var');
    tokens = { refresh_token: envRefreshToken };
    oauth2Client.setCredentials(tokens);
    tokenError = null;
    // Immediately try to get a fresh access token
    bootstrapFromRefreshToken();
    return true;
  }

  return false;
}

async function bootstrapFromRefreshToken() {
  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    saveTokens(credentials);
    oauth2Client.setCredentials(credentials);
    tokenError = null;
    consecutiveFailures = 0;
    console.log('[GCal] Bootstrap refresh successful — calendar ready');
  } catch (err) {
    console.error('[GCal] Bootstrap refresh failed:', err.message);
    tokenError = err.message;
  }
}

function saveTokens(newTokens) {
  // Merge with existing tokens (preserve refresh_token if new response doesn't include one)
  if (tokens && tokens.refresh_token && !newTokens.refresh_token) {
    newTokens.refresh_token = tokens.refresh_token;
  }
  tokens = newTokens;

  // Save to disk (works within this deploy's lifetime)
  try {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('[GCal] Tokens saved to disk');
  } catch (err) {
    console.error('[GCal] Failed to save tokens to disk:', err.message);
  }

  // Log the refresh token so it can be set as a Railway env var for persistence
  if (tokens.refresh_token && tokens.refresh_token !== process.env.GOOGLE_REFRESH_TOKEN) {
    console.log('[GCal] ──────────────────────────────────────────');
    console.log('[GCal] IMPORTANT: Set this Railway env var to survive deploys:');
    console.log('[GCal] GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('[GCal] ──────────────────────────────────────────');
  }
}

// Listen for automatic token refresh events
oauth2Client.on('tokens', (newTokens) => {
  console.log('[GCal] Token auto-refreshed');
  saveTokens(newTokens);
  tokenError = null;
  consecutiveFailures = 0;
});

// Proactive token refresh — runs every 45 minutes
async function proactiveRefresh() {
  if (!tokens || !tokens.refresh_token) return;

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    saveTokens(credentials);
    oauth2Client.setCredentials(credentials);
    tokenError = null;
    consecutiveFailures = 0;
    console.log('[GCal] Proactive token refresh successful');
  } catch (err) {
    console.error('[GCal] Proactive refresh failed:', err.message);
    tokenError = err.message;
  }
}

// Refresh every 45 min (tokens expire in 60 min)
setInterval(proactiveRefresh, 45 * 60 * 1000);

// Load tokens on startup
loadTokens();

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────
app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, 'dist')));

// ─────────────────────────────────────────────
// API: Auth Routes
// ─────────────────────────────────────────────

// Check if Google OAuth is configured
function isOAuthConfigured() {
  return GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CLIENT_ID !== '';
}

// GET /api/auth/google — Start OAuth flow
app.get('/api/auth/google', (req, res) => {
  if (!isOAuthConfigured()) {
    return res.status(503).json({
      error: 'Google OAuth not configured',
      message: 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in Railway environment variables.'
    });
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to always get refresh_token
    include_granted_scopes: true,
  });

  res.redirect(authUrl);
});

// GET /api/auth/callback — Handle OAuth callback
app.get('/api/auth/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/?gcal=error&reason=' + encodeURIComponent(error));
  }

  if (!code) {
    return res.redirect('/?gcal=error&reason=no_code');
  }

  try {
    const { tokens: newTokens } = await oauth2Client.getToken(code);
    saveTokens(newTokens);
    oauth2Client.setCredentials(newTokens);
    tokenError = null;
    consecutiveFailures = 0;
    statusCache = { result: null, timestamp: 0 }; // Clear cache on fresh auth
    console.log('[GCal] OAuth completed successfully — tokens stored');

    // Redirect back to dashboard with success flag
    res.redirect('/?gcal=connected');
  } catch (err) {
    console.error('[GCal] Token exchange failed:', err.message);
    tokenError = err.message;
    res.redirect('/?gcal=error&reason=' + encodeURIComponent(err.message));
  }
});

// POST /api/auth/disconnect — Clear stored tokens
app.post('/api/auth/disconnect', (req, res) => {
  tokens = null;
  tokenError = null;
  try {
    if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
  } catch (_) {}
  res.json({ status: 'disconnected' });
});

// ─────────────────────────────────────────────
// API: Calendar Status (cached, resilient)
// ─────────────────────────────────────────────
app.get('/api/calendar/status', async (req, res) => {
  const forceCheck = req.query.force === 'true';

  if (!isOAuthConfigured()) {
    return res.json({
      connected: false,
      configured: false,
      reason: 'Google OAuth credentials not configured in Railway.'
    });
  }

  if (!tokens || (!tokens.access_token && !tokens.refresh_token)) {
    return res.json({
      connected: false,
      configured: true,
      reason: 'Not connected — click Reconnect to authorize Google Calendar.'
    });
  }

  // Return cached result if recent enough (unless force-refresh requested)
  const now = Date.now();
  if (!forceCheck && statusCache.result && (now - statusCache.timestamp) < STATUS_CACHE_TTL) {
    return res.json(statusCache.result);
  }

  // If we have a refresh token but no access token, try to get one
  if (tokens.refresh_token && !tokens.access_token) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      saveTokens(credentials);
      oauth2Client.setCredentials(credentials);
      tokenError = null;
      consecutiveFailures = 0;
    } catch (err) {
      console.error('[GCal] Token bootstrap failed:', err.message);
      return res.json({ connected: false, configured: true, reason: 'Refresh token expired — click Reconnect.' });
    }
  }

  // Test the connection with a lightweight API call
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await calendar.calendarList.list({ maxResults: 1 });
    consecutiveFailures = 0;
    const result = {
      connected: true,
      configured: true,
      lastRefresh: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      reason: null
    };
    statusCache = { result, timestamp: now };
    return res.json(result);
  } catch (err) {
    console.error('[GCal] Status check failed:', err.message);
    consecutiveFailures++;

    // Try refreshing the token
    if (tokens.refresh_token) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        saveTokens(credentials);
        oauth2Client.setCredentials(credentials);
        tokenError = null;
        consecutiveFailures = 0;
        const result = { connected: true, configured: true, reason: null };
        statusCache = { result, timestamp: now };
        return res.json(result);
      } catch (refreshErr) {
        console.error('[GCal] Refresh also failed:', refreshErr.message);
        tokenError = refreshErr.message;
        consecutiveFailures++;
      }
    }

    // Grace period: if we had a recent successful check and only 1-2 failures,
    // still report connected (transient network blip)
    if (consecutiveFailures <= 2 && statusCache.result?.connected) {
      console.log(`[GCal] Transient failure #${consecutiveFailures} — still reporting connected`);
      return res.json({ ...statusCache.result, reason: null });
    }

    // Actually disconnected
    const result = {
      connected: false,
      configured: true,
      reason: tokenError || err.message
    };
    statusCache = { result, timestamp: now };
    return res.json(result);
  }
});

// ─────────────────────────────────────────────
// API: Calendar Events
// ─────────────────────────────────────────────
app.get('/api/calendar/events', async (req, res) => {
  if (!tokens || !tokens.access_token) {
    return res.status(401).json({ error: 'Not authenticated', events: [] });
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Default: today's events
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const timeMin = req.query.timeMin || startOfDay.toISOString();
    const timeMax = req.query.timeMax || endOfDay.toISOString();

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      maxResults: 50,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (response.data.items || []).map(ev => ({
      id: ev.id,
      title: ev.summary || '(No title)',
      description: ev.description || '',
      start: ev.start.dateTime || ev.start.date,
      end: ev.end.dateTime || ev.end.date,
      location: ev.location || '',
      allDay: !ev.start.dateTime,
      status: ev.status,
      htmlLink: ev.htmlLink,
      attendees: (ev.attendees || []).map(a => ({ email: a.email, name: a.displayName, status: a.responseStatus })),
      conferenceLink: ev.hangoutLink || (ev.conferenceData?.entryPoints?.[0]?.uri) || null,
    }));

    res.json({ events, count: events.length });
  } catch (err) {
    console.error('[GCal] Failed to fetch events:', err.message);

    // Try refresh once
    if (tokens.refresh_token) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        saveTokens(credentials);
        oauth2Client.setCredentials(credentials);
        // Retry the request
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const response = await calendar.events.list({
          calendarId: 'primary',
          timeMin: req.query.timeMin || startOfDay.toISOString(),
          timeMax: req.query.timeMax || endOfDay.toISOString(),
          maxResults: 50, singleEvents: true, orderBy: 'startTime',
        });
        const events = (response.data.items || []).map(ev => ({
          id: ev.id, title: ev.summary || '(No title)',
          start: ev.start.dateTime || ev.start.date,
          end: ev.end.dateTime || ev.end.date,
          location: ev.location || '', allDay: !ev.start.dateTime,
          status: ev.status, htmlLink: ev.htmlLink,
        }));
        return res.json({ events, count: events.length });
      } catch (_) {}
    }

    res.status(500).json({ error: err.message, events: [] });
  }
});

// ─────────────────────────────────────────────
// API: Upcoming events (next 7 days)
// ─────────────────────────────────────────────
app.get('/api/calendar/upcoming', async (req, res) => {
  if (!tokens || !tokens.access_token) {
    return res.status(401).json({ error: 'Not authenticated', events: [] });
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const now = new Date();
    const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: weekOut.toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (response.data.items || []).map(ev => ({
      id: ev.id,
      title: ev.summary || '(No title)',
      start: ev.start.dateTime || ev.start.date,
      end: ev.end.dateTime || ev.end.date,
      location: ev.location || '',
      allDay: !ev.start.dateTime,
    }));

    res.json({ events, count: events.length });
  } catch (err) {
    res.status(500).json({ error: err.message, events: [] });
  }
});

// ─────────────────────────────────────────────
// API: Task State Persistence
// ─────────────────────────────────────────────
const TASKS_PATH = path.join(__dirname, '.task-state.json');
let taskState = null;

function loadTaskState() {
  try {
    if (fs.existsSync(TASKS_PATH)) {
      taskState = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
      console.log('[Tasks] State loaded from disk');
      return;
    }
  } catch (err) {
    console.error('[Tasks] Failed to load state:', err.message);
  }
  taskState = null;
}

function saveTaskState(state) {
  taskState = state;
  try {
    fs.writeFileSync(TASKS_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[Tasks] Failed to save state:', err.message);
  }
}

loadTaskState();

// GET /api/tasks — load saved task state
app.get('/api/tasks', (req, res) => {
  res.json({ state: taskState });
});

// POST /api/tasks — save task state (priorities, backlog, doneCount, doneIds)
app.post('/api/tasks', (req, res) => {
  const { priorities, backlog, doneCount, doneIds } = req.body;
  saveTaskState({ priorities, backlog, doneCount, doneIds, savedAt: new Date().toISOString() });
  res.json({ status: 'saved' });
});

// ─────────────────────────────────────────────
// SPA Fallback — serve index.html for all other routes
// ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Agent HQ] Server running on port ${PORT}`);
  console.log(`[GCal] OAuth configured: ${isOAuthConfigured()}`);
  console.log(`[GCal] Tokens loaded: ${!!tokens}`);
  if (tokens) {
    console.log(`[GCal] Token expires: ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'unknown'}`);
  }
});
