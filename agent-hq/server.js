import express from 'express';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const pdfParse = _require('pdf-parse');

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
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.labels',
];
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

// ─── Gmail Connection State Tracking ───
// Tracks when Gmail was last connected/disconnected so we can backfill missed emails on reconnect
const GMAIL_STATE_PATH = path.join(__dirname, '.gmail-connection-state.json');
let gmailConnectionState = { lastConnected: null, lastDisconnected: null, wasConnected: false };

function loadGmailState() {
  try {
    if (fs.existsSync(GMAIL_STATE_PATH)) {
      gmailConnectionState = JSON.parse(fs.readFileSync(GMAIL_STATE_PATH, 'utf8'));
      console.log('[Gmail] Connection state loaded — last connected:', gmailConnectionState.lastConnected, ', last disconnected:', gmailConnectionState.lastDisconnected);
    }
  } catch (err) {
    console.error('[Gmail] Failed to load connection state:', err.message);
  }
}

function saveGmailState() {
  try {
    fs.writeFileSync(GMAIL_STATE_PATH, JSON.stringify(gmailConnectionState, null, 2));
  } catch (err) {
    console.error('[Gmail] Failed to save connection state:', err.message);
  }
}

function markGmailConnected() {
  const now = new Date().toISOString();
  const wasDisconnected = gmailConnectionState.lastDisconnected && !gmailConnectionState.wasConnected;
  gmailConnectionState.lastConnected = now;
  gmailConnectionState.wasConnected = true;
  saveGmailState();
  if (wasDisconnected) {
    console.log(`[Gmail] Reconnected after downtime. Was offline since: ${gmailConnectionState.lastDisconnected}. Triggering backfill...`);
    // Auto-trigger backfill in background
    triggerMissedEmailBackfill().catch(err => console.error('[Gmail] Auto-backfill error:', err.message));
  }
}

function markGmailDisconnected() {
  const now = new Date().toISOString();
  if (gmailConnectionState.wasConnected) {
    gmailConnectionState.lastDisconnected = now;
    gmailConnectionState.wasConnected = false;
    saveGmailState();
    console.log(`[Gmail] Marked as disconnected at ${now}`);
  }
}

loadGmailState();

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

    // Track Gmail reconnection — triggers missed email backfill if there was downtime
    markGmailConnected();

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
  markGmailDisconnected(); // Track the disconnect timestamp for backfill
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
    // Track successful connection (triggers backfill if was disconnected)
    if (!gmailConnectionState.wasConnected) markGmailConnected();
    const result = {
      connected: true,
      configured: true,
      lastRefresh: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      hasMissedEmails: missedEmailsCache.emails?.length > 0 && !missedEmailsCache.dismissed,
      missedEmailCount: missedEmailsCache.totalCount || 0,
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
    markGmailDisconnected(); // Track for missed email backfill
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

// Helper: fetch events from ALL calendars (primary + imported Outlook, etc.)
async function fetchAllCalendarEvents(calendarApi, timeMin, timeMax, maxResults = 50) {
  // Get all calendar IDs the user has access to
  const calListRes = await calendarApi.calendarList.list({ maxResults: 100 });
  const calendars = calListRes.data.items || [];
  console.log(`[GCal] Found ${calendars.length} calendars: ${calendars.map(c => c.summary || c.id).join(', ')}`);

  // Fetch events from each calendar in parallel
  const allEvents = [];
  const results = await Promise.allSettled(
    calendars.map(async (cal) => {
      try {
        const evRes = await calendarApi.events.list({
          calendarId: cal.id,
          timeMin,
          timeMax,
          maxResults,
          singleEvents: true,
          orderBy: 'startTime',
        });
        return (evRes.data.items || []).map(ev => ({
          ...ev,
          _calendarName: cal.summary || cal.id,
          _calendarId: cal.id,
        }));
      } catch (e) {
        console.warn(`[GCal] Failed to fetch from calendar "${cal.summary || cal.id}": ${e.message}`);
        return [];
      }
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled') allEvents.push(...r.value);
  }

  // Sort merged events by start time
  allEvents.sort((a, b) => {
    const aStart = new Date(a.start?.dateTime || a.start?.date || 0).getTime();
    const bStart = new Date(b.start?.dateTime || b.start?.date || 0).getTime();
    return aStart - bStart;
  });

  return allEvents;
}

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

    const allEvents = await fetchAllCalendarEvents(calendar, timeMin, timeMax, 50);

    const events = allEvents.map(ev => ({
      id: ev.id,
      title: ev.summary || '(No title)',
      description: ev.description || '',
      start: ev.start.dateTime || ev.start.date,
      end: ev.end.dateTime || ev.end.date,
      location: ev.location || '',
      allDay: !ev.start.dateTime,
      status: ev.status,
      htmlLink: ev.htmlLink,
      calendarName: ev._calendarName,
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
        // Retry the request — fetch from all calendars
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const retryEvents = await fetchAllCalendarEvents(calendar,
          req.query.timeMin || startOfDay.toISOString(),
          req.query.timeMax || endOfDay.toISOString(), 50);
        const events = retryEvents.map(ev => ({
          id: ev.id, title: ev.summary || '(No title)',
          start: ev.start.dateTime || ev.start.date,
          end: ev.end.dateTime || ev.end.date,
          location: ev.location || '', allDay: !ev.start.dateTime,
          status: ev.status, htmlLink: ev.htmlLink, calendarName: ev._calendarName,
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

    const allEvents = await fetchAllCalendarEvents(calendar, now.toISOString(), weekOut.toISOString(), 100);

    const events = allEvents.map(ev => ({
      id: ev.id,
      title: ev.summary || '(No title)',
      start: ev.start.dateTime || ev.start.date,
      end: ev.end.dateTime || ev.end.date,
      location: ev.location || '',
      allDay: !ev.start.dateTime,
      calendarName: ev._calendarName,
    }));

    res.json({ events, count: events.length });
  } catch (err) {
    res.status(500).json({ error: err.message, events: [] });
  }
});

// ─────────────────────────────────────────────
// API: List all connected calendars (for debugging & Syncs page)
app.get('/api/calendar/list', async (req, res) => {
  if (!tokens || !tokens.access_token) {
    return res.status(401).json({ error: 'Not authenticated', calendars: [] });
  }
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calListRes = await calendar.calendarList.list({ maxResults: 100 });
    const calendars = (calListRes.data.items || []).map(c => ({
      id: c.id,
      name: c.summary || c.id,
      description: c.description || '',
      primary: c.primary || false,
      accessRole: c.accessRole,
      backgroundColor: c.backgroundColor,
    }));
    res.json({ calendars, count: calendars.length });
  } catch (err) {
    res.status(500).json({ error: err.message, calendars: [] });
  }
});

// ─────────────────────────────────────────────
// QUICK LINKS — Self-healing URL registry
// Server-managed links with automatic health checks.
// Dead links get removed, updated paths get corrected.
// ─────────────────────────────────────────────
const QUICKLINKS_PATH = path.join(__dirname, '.quicklinks.json');

const DEFAULT_QUICKLINKS = [
  { id: 'cal-list', group: 'Calendar', label: 'All Calendars', url: '/api/calendar/list', desc: 'See every calendar being pulled (primary + Outlook)' },
  { id: 'cal-events', group: 'Calendar', label: "Today's Events", url: '/api/calendar/events', desc: 'All events from all calendars for today' },
  { id: 'cal-upcoming', group: 'Calendar', label: 'Upcoming 7 Days', url: '/api/calendar/upcoming', desc: 'Next week of events across all calendars' },
  { id: 'cal-status', group: 'Calendar', label: 'Connection Status', url: '/api/calendar/status', desc: 'Google OAuth connection health check' },
  { id: 'ea-triage', group: 'Email EA', label: 'EA Triage', url: '/api/ea/triage', desc: 'Full email thread state dashboard (live sweep)' },
  { id: 'ea-sweep', group: 'Email EA', label: 'Sweep Status', url: '/api/ea/sweep-status', desc: 'Hourly auto-sweep schedule and recent logs' },
  { id: 'ea-outlook', group: 'Email EA', label: 'Outlook Sent Data', url: '/api/ea/outlook-sent', desc: 'Scraped Outlook sent emails and corrections' },
  { id: 'ea-stuck', group: 'Email EA', label: 'Stuck Queue', url: '/api/ea/stuck', desc: 'Pending "Claude stuck, needs answer" items' },
  { id: 'ea-fub-diag', group: 'Email EA', label: 'FUB Sent Diagnostic', url: '/api/ea/fub-sent-diagnostic', desc: 'Tests all FUB email tracking API paths' },
  { id: 'gmail-status', group: 'Gmail', label: 'Gmail Status', url: '/api/gmail/status', desc: 'Gmail connection and token status' },
  { id: 'gmail-inbox', group: 'Gmail', label: 'Inbox', url: '/api/gmail/inbox', desc: 'Recent inbox emails with AI categorization' },
  { id: 'gmail-sent', group: 'Gmail', label: 'Sent', url: '/api/gmail/sent', desc: 'Recent sent emails for follow-up tracking' },
  { id: 'gmail-bb', group: 'Gmail', label: 'BrokerBay Emails', url: '/api/gmail/brokerbay', desc: 'All BrokerBay emails: showings, feedback, confirmations' },
  { id: 'gmail-activity', group: 'Gmail', label: 'Activity Timeline', url: '/api/gmail/activity', desc: 'Combined email activity timeline' },
  { id: 'gmail-labels', group: 'Gmail', label: 'Labels', url: '/api/gmail/labels', desc: 'All Gmail labels (debug)' },
  { id: 'fub-status', group: 'Follow Up Boss', label: 'FUB Status', url: '/api/fub/status', desc: 'FUB API connection check' },
  { id: 'fub-calls', group: 'Follow Up Boss', label: 'Call List', url: '/api/fub/calllist', desc: 'Daily scored call list' },
  { id: 'fub-stages', group: 'Follow Up Boss', label: 'Stages', url: '/api/fub/stages', desc: 'All FUB pipeline stages' },
  { id: 'fub-leadscan', group: 'Follow Up Boss', label: 'Lead Scan', url: '/api/fub/leads/scan', desc: 'Scan Gmail for new FUB lead emails' },
  { id: 'fub-processed', group: 'Follow Up Boss', label: 'Processed Leads', url: '/api/fub/leads/processed', desc: 'Already-imported lead history' },
  { id: 'fub-listings', group: 'Follow Up Boss', label: 'Listing Appointments', url: '/api/fub/listing-appointments', desc: 'Contacts tagged "Listing Appointment"' },
  { id: 'tj-setup', group: 'Team Jordan Import', label: 'TJ Setup', url: '/api/tj/setup', desc: 'Create stage + find Gmail label' },
  { id: 'tj-status', group: 'Team Jordan Import', label: 'TJ Status', url: '/api/tj/status', desc: 'Import progress and stats' },
  { id: 'lf-list', group: 'Listing Form', label: 'All Listings', url: '/api/listing-form/list', desc: 'All saved listing forms' },
  { id: 'sys-tasks', group: 'System', label: 'Tasks State', url: '/api/tasks', desc: 'Saved priorities and backlog state' },
  { id: 'sys-auth', group: 'System', label: 'Google Auth', url: '/api/auth/google', desc: 'Start Google OAuth flow (reconnect)' },
];

let quickLinks = [];
let quickLinksHealth = { lastCheck: null, deadRemoved: 0, totalChecks: 0 };

function loadQuickLinks() {
  try {
    if (fs.existsSync(QUICKLINKS_PATH)) {
      const saved = JSON.parse(fs.readFileSync(QUICKLINKS_PATH, 'utf8'));
      quickLinks = saved.links || [];
      quickLinksHealth = saved.health || quickLinksHealth;
      // Merge any new defaults that don't exist yet
      for (const def of DEFAULT_QUICKLINKS) {
        if (!quickLinks.find(l => l.id === def.id)) {
          quickLinks.push({ ...def, status: 'unknown', lastChecked: null });
        }
      }
    } else {
      quickLinks = DEFAULT_QUICKLINKS.map(l => ({ ...l, status: 'unknown', lastChecked: null }));
    }
  } catch {
    quickLinks = DEFAULT_QUICKLINKS.map(l => ({ ...l, status: 'unknown', lastChecked: null }));
  }
}

function saveQuickLinks() {
  try {
    fs.writeFileSync(QUICKLINKS_PATH, JSON.stringify({ links: quickLinks, health: quickLinksHealth }, null, 2));
  } catch {}
}

loadQuickLinks();

// Health check: hit each internal URL, mark alive/dead, remove dead after 3 consecutive failures
async function checkQuickLinksHealth() {
  console.log(`[QuickLinks] Running health check on ${quickLinks.length} links...`);
  let removed = 0;
  const survivors = [];

  for (const link of quickLinks) {
    // Skip external URLs and auth URLs (they redirect)
    if (link.url.startsWith('http') || link.url === '/api/auth/google') {
      link.status = 'alive';
      link.lastChecked = new Date().toISOString();
      link.failCount = 0;
      survivors.push(link);
      continue;
    }

    try {
      // Use Express's built-in routing to test — make a local HTTP request
      const testUrl = `http://localhost:${PORT}${link.url}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(testUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (resp.ok || resp.status === 401) {
        // 401 is fine — means the route exists but needs auth (e.g., Gmail when disconnected)
        link.status = 'alive';
        link.failCount = 0;
        link.lastChecked = new Date().toISOString();
        survivors.push(link);
      } else if (resp.status === 404) {
        // Route doesn't exist
        link.failCount = (link.failCount || 0) + 1;
        link.status = 'dead';
        link.lastChecked = new Date().toISOString();
        if (link.failCount >= 3) {
          console.log(`[QuickLinks] Removing dead link: ${link.label} (${link.url}) — failed ${link.failCount} times`);
          removed++;
        } else {
          survivors.push(link);
        }
      } else {
        // Other errors (500, etc.) — keep but mark as unhealthy
        link.status = 'error';
        link.failCount = (link.failCount || 0) + 1;
        link.lastChecked = new Date().toISOString();
        if (link.failCount >= 5) {
          console.log(`[QuickLinks] Removing persistently erroring link: ${link.label} (${link.url})`);
          removed++;
        } else {
          survivors.push(link);
        }
      }
    } catch (e) {
      // Network error or timeout — mark but don't remove immediately
      link.status = 'error';
      link.failCount = (link.failCount || 0) + 1;
      link.lastChecked = new Date().toISOString();
      survivors.push(link);
    }
  }

  quickLinks = survivors;
  quickLinksHealth.lastCheck = new Date().toISOString();
  quickLinksHealth.deadRemoved += removed;
  quickLinksHealth.totalChecks++;
  saveQuickLinks();
  console.log(`[QuickLinks] Health check complete: ${survivors.length} alive, ${removed} removed`);
  return { alive: survivors.length, removed };
}

// Run health check on startup (after server is listening) and every 6 hours
setTimeout(() => checkQuickLinksHealth(), 30 * 1000);
setInterval(() => checkQuickLinksHealth(), 6 * 60 * 60 * 1000);

// GET /api/quicklinks — Return all active links grouped
app.get('/api/quicklinks', (req, res) => {
  // Group by category
  const groups = {};
  for (const link of quickLinks) {
    if (!groups[link.group]) groups[link.group] = [];
    groups[link.group].push({
      id: link.id,
      label: link.label,
      url: link.url,
      desc: link.desc,
      status: link.status,
      lastChecked: link.lastChecked,
    });
  }
  res.json({
    groups,
    health: quickLinksHealth,
    totalLinks: quickLinks.length,
  });
});

// POST /api/quicklinks — Add or update a link
app.post('/api/quicklinks', (req, res) => {
  const { id, group, label, url, desc } = req.body;
  if (!id || !url || !label) return res.json({ success: false, error: 'id, url, and label required' });

  const existing = quickLinks.find(l => l.id === id);
  if (existing) {
    // Update existing
    if (group) existing.group = group;
    existing.label = label;
    existing.url = url;
    if (desc) existing.desc = desc;
    existing.status = 'unknown';
    existing.failCount = 0;
    existing.lastChecked = null;
  } else {
    // Add new
    quickLinks.push({ id, group: group || 'Custom', label, url, desc: desc || '', status: 'unknown', lastChecked: null, failCount: 0 });
  }
  saveQuickLinks();
  res.json({ success: true, totalLinks: quickLinks.length });
});

// DELETE /api/quicklinks/:id — Manually remove a link
app.delete('/api/quicklinks/:id', (req, res) => {
  const before = quickLinks.length;
  quickLinks = quickLinks.filter(l => l.id !== req.params.id);
  saveQuickLinks();
  res.json({ success: true, removed: before - quickLinks.length, totalLinks: quickLinks.length });
});

// POST /api/quicklinks/health-check — Manually trigger health check
app.post('/api/quicklinks/health-check', async (req, res) => {
  const result = await checkQuickLinksHealth();
  res.json({ success: true, ...result, health: quickLinksHealth });
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
// Feedback Submitted State Persistence
// ─────────────────────────────────────────────
const FEEDBACK_STATE_PATH = path.join(__dirname, '.feedback-submitted.json');

let submittedFeedbackIds = [];
try {
  if (fs.existsSync(FEEDBACK_STATE_PATH)) {
    submittedFeedbackIds = JSON.parse(fs.readFileSync(FEEDBACK_STATE_PATH, 'utf8'));
  }
} catch { submittedFeedbackIds = []; }

app.get('/api/feedback/submitted', (req, res) => {
  res.json({ ids: submittedFeedbackIds });
});

app.post('/api/feedback/submitted', (req, res) => {
  const { ids } = req.body;
  if (Array.isArray(ids)) {
    submittedFeedbackIds = ids;
    try {
      fs.writeFileSync(FEEDBACK_STATE_PATH, JSON.stringify(ids, null, 2));
    } catch (err) {
      console.error('[Feedback] Save error:', err.message);
    }
  }
  res.json({ status: 'saved' });
});

// ─────────────────────────────────────────────
// AI Feedback Formatter — Sandwich Format
// Positives → Constructive notes → Questions
// ─────────────────────────────────────────────
app.post('/api/feedback/format', (req, res) => {
  const { raw, address, listingAgent } = req.body;
  if (!raw?.trim()) {
    return res.json({ formatted: '' });
  }

  // Parse raw dictation into structured sandwich format
  const formatted = buildSandwichFeedback(raw.trim(), address, listingAgent);
  res.json({ formatted });
});

function buildSandwichFeedback(raw, address, listingAgent) {
  // Extract sentences/thoughts
  const thoughts = raw.split(/[.!?\n]+/).map(s => s.trim()).filter(Boolean);

  const positives = [];
  const concerns = [];
  const questions = [];

  // Simple NLP classification
  const positiveWords = ['interest', 'love', 'great', 'nice', 'beautiful', 'well', 'good', 'excellent', 'opportunity', 'potential', 'contender', 'impressed', 'pretty', 'spacious', 'bright', 'clean', 'location', 'convenient', 'charming'];
  const negativeWords = ['rough', 'work', 'unfinished', 'outdated', 'dated', 'small', 'concern', 'issue', 'problem', 'stain', 'damage', 'needs', 'lacking', 'tight', 'narrow', 'noisy', 'old'];
  const questionWords = ['when', 'what', 'why', 'how', 'where', 'who', 'is there', 'do you know', 'question', 'wondering', 'curious'];

  for (const t of thoughts) {
    const lower = t.toLowerCase();

    // Check if it's a question
    if (questionWords.some(q => lower.includes(q)) || raw.includes(t + '?')) {
      questions.push(t);
      continue;
    }

    // Score positive vs negative
    const posScore = positiveWords.filter(w => lower.includes(w)).length;
    const negScore = negativeWords.filter(w => lower.includes(w)).length;

    if (negScore > posScore) {
      concerns.push(t);
    } else if (posScore > 0) {
      positives.push(t);
    } else {
      // Neutral goes to positives if it's general, concerns if it mentions work needed
      if (lower.includes('but') || lower.includes('however') || lower.includes('although')) {
        concerns.push(t);
      } else {
        positives.push(t);
      }
    }
  }

  // Build the sandwich
  const agentFirst = listingAgent ? listingAgent.split('/')[0].trim().split(' ')[0] : 'there';
  let output = `Hi ${agentFirst},\n\nThank you for the opportunity to show ${address || 'the property'}.`;

  if (positives.length > 0) {
    output += '\n\n';
    output += positives.map(p => {
      // Capitalize first letter and ensure proper ending
      let s = p.charAt(0).toUpperCase() + p.slice(1);
      if (!s.endsWith('.') && !s.endsWith('!')) s += '.';
      return s;
    }).join(' ');
  }

  if (concerns.length > 0) {
    output += '\n\n';
    output += concerns.map(c => {
      let s = c.charAt(0).toUpperCase() + c.slice(1);
      if (!s.endsWith('.') && !s.endsWith('!')) s += '.';
      return s;
    }).join(' ');
  }

  if (questions.length > 0) {
    output += '\n\nA couple of questions if you don\'t mind:\n';
    output += questions.map(q => {
      let s = q.charAt(0).toUpperCase() + q.slice(1);
      if (!s.endsWith('?')) s += '?';
      return `• ${s}`;
    }).join('\n');
  }

  output += '\n\nPlease don\'t hesitate to reach out if you need anything further.\n\nBest regards,\nJonathan Wallace';

  return output;
}

// ─────────────────────────────────────────────
// BrokerBay Feedback Email Scanner
// Scans Gmail for "Showing Feedback" emails from BrokerBay,
// extracts the feedback URLs, and returns them with address info
// ─────────────────────────────────────────────
app.get('/api/feedback/pending', async (req, res) => {
  if (!tokens) {
    return res.json({ status: 'disconnected', feedbacks: [] });
  }
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Search for BrokerBay feedback request emails (last 14 days)
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'from:noreply@brokerbay.com subject:"Showing Feedback" newer_than:14d',
      maxResults: 20,
    });

    const messages = listRes.data.messages || [];
    const feedbacks = [];

    for (const msg of messages) {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        });

        const headers = detail.data.payload.headers || [];
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const dateHeader = headers.find(h => h.name === 'Date')?.value || '';

        // Extract address from subject: "Showing Feedback - 45 Brule Street"
        const addressMatch = subject.match(/Showing Feedback\s*[-–—]\s*(.+)/i);
        const address = addressMatch ? addressMatch[1].trim() : subject;

        // Extract feedback URL from email body
        let feedbackUrl = '';
        const body = getEmailBody(detail.data.payload);
        if (body) {
          // Look for BrokerBay feedback link pattern
          const urlMatch = body.match(/https:\/\/edge\.brokerbay\.com\/#\/my_business\/showing\/[a-f0-9]+\?redirectTo=calendar/i);
          if (urlMatch) {
            feedbackUrl = urlMatch[0];
          } else {
            // Try alternative pattern — just the showing ID URL
            const altMatch = body.match(/https:\/\/edge\.brokerbay\.com[^\s"'<>]+showing\/[a-f0-9]+[^\s"'<>]*/i);
            if (altMatch) {
              feedbackUrl = altMatch[0];
            }
          }
        }

        if (feedbackUrl) {
          // Extract showing ID from URL
          const idMatch = feedbackUrl.match(/showing\/([a-f0-9]+)/);
          const showingId = idMatch ? idMatch[1] : '';

          feedbacks.push({
            messageId: msg.id,
            address,
            subject,
            date: dateHeader,
            feedbackUrl,
            showingId,
          });
        }
      } catch (msgErr) {
        console.error(`[Feedback] Error processing message ${msg.id}:`, msgErr.message);
      }
    }

    res.json({ status: 'ok', feedbacks });
  } catch (err) {
    console.error('[Feedback] Gmail scan error:', err.message);
    res.json({ status: 'error', error: err.message, feedbacks: [] });
  }
});

// Helper: extract plain text body from Gmail message payload
function getEmailBody(payload) {
  if (!payload) return '';

  // Direct body
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  // Multipart — search parts recursively
  if (payload.parts) {
    for (const part of payload.parts) {
      // Prefer text/html for URL extraction
      if (part.mimeType === 'text/html' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
      // Recurse into multipart
      if (part.parts) {
        const nested = getEmailBody(part);
        if (nested) return nested;
      }
    }
    // Fall back to text/plain
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
    }
  }

  return '';
}

// ─────────────────────────────────────────────
// GMAIL INTEGRATION — Full Email Intelligence
// Scans inbox, sent mail, BrokerBay showings, cancellations
// Cross-references everything for the dashboard
// ─────────────────────────────────────────────

// Cache for Gmail data (refresh every 5 minutes)
let gmailCache = { data: null, timestamp: 0 };
const GMAIL_CACHE_TTL = 5 * 60 * 1000;

// GET /api/gmail/status — Check Gmail connection
app.get('/api/gmail/status', (req, res) => {
  if (!tokens) {
    return res.json({ connected: false, reason: 'Not authenticated. Connect Google account first.' });
  }
  res.json({ connected: true, scopes: SCOPES });
});

// GET /api/gmail/labels — Debug: list all Gmail labels
app.get('/api/gmail/labels', async (req, res) => {
  if (!tokens) return res.json({ error: 'Not connected' });
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const labelsResp = await gmail.users.labels.list({ userId: 'me' });
    const labels = labelsResp.data.labels || [];
    res.json({
      count: labels.length,
      labels: labels.map(l => ({ id: l.id, name: l.name, type: l.type })),
    });
  } catch (err) {
    res.json({ error: err.message, code: err.code, details: err.errors });
  }
});

// GET /api/gmail/inbox — Recent inbox emails with AI categorization
app.get('/api/gmail/inbox', async (req, res) => {
  if (!tokens) return res.json({ status: 'disconnected', emails: [] });

  const maxResults = parseInt(req.query.max) || 25;
  const q = req.query.q || 'in:inbox newer_than:7d';

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const listRes = await gmail.users.messages.list({ userId: 'me', q, maxResults });
    const messages = listRes.data.messages || [];
    const emails = [];

    for (const msg of messages) {
      try {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Reply-To'],
        });
        const headers = detail.data.payload.headers || [];
        const from = headers.find(h => h.name === 'From')?.value || '';
        const to = headers.find(h => h.name === 'To')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        const snippet = detail.data.snippet || '';
        const labelIds = detail.data.labelIds || [];

        // Categorize the email
        const category = categorizeEmail(from, subject, snippet, labelIds);

        emails.push({
          id: msg.id,
          threadId: detail.data.threadId,
          from: parseEmailSender(from),
          fromEmail: extractEmail(from),
          to,
          subject,
          snippet,
          date,
          timestamp: parseInt(detail.data.internalDate),
          labels: labelIds,
          category,
          isRead: !labelIds.includes('UNREAD'),
          isStarred: labelIds.includes('STARRED'),
        });
      } catch (e) {
        console.error(`[Gmail] Error fetching message ${msg.id}:`, e.message);
      }
    }

    res.json({ status: 'ok', count: emails.length, emails });
  } catch (err) {
    console.error('[Gmail] Inbox scan error:', err.message);
    res.json({ status: 'error', error: err.message, emails: [] });
  }
});

// GET /api/gmail/sent — Recent sent emails for tracking follow-ups
app.get('/api/gmail/sent', async (req, res) => {
  if (!tokens) return res.json({ status: 'disconnected', emails: [] });

  const maxResults = parseInt(req.query.max) || 30;
  const days = parseInt(req.query.days) || 14;

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `in:sent newer_than:${days}d`,
      maxResults,
    });
    const messages = listRes.data.messages || [];
    const emails = [];

    for (const msg of messages) {
      try {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Cc', 'Bcc'],
        });
        const headers = detail.data.payload.headers || [];
        const to = headers.find(h => h.name === 'To')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        const cc = headers.find(h => h.name === 'Cc')?.value || '';
        const snippet = detail.data.snippet || '';

        // Determine what type of sent email this is
        const sentType = categorizeSentEmail(to, subject, snippet);

        emails.push({
          id: msg.id,
          threadId: detail.data.threadId,
          to: parseEmailSender(to),
          toEmail: extractEmail(to),
          cc,
          subject,
          snippet,
          date,
          timestamp: parseInt(detail.data.internalDate),
          sentType,
        });
      } catch (e) {
        console.error(`[Gmail] Error fetching sent message ${msg.id}:`, e.message);
      }
    }

    res.json({ status: 'ok', count: emails.length, emails });
  } catch (err) {
    console.error('[Gmail] Sent mail scan error:', err.message);
    res.json({ status: 'error', error: err.message, emails: [] });
  }
});

// GET /api/gmail/brokerbay — All BrokerBay emails: showings, confirmations, cancellations, feedback
app.get('/api/gmail/brokerbay', async (req, res) => {
  if (!tokens) return res.json({ status: 'disconnected', data: {} });

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const days = parseInt(req.query.days) || 30;

    // Search for all BrokerBay emails
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `from:brokerbay.com newer_than:${days}d`,
      maxResults: 50,
    });
    const messages = listRes.data.messages || [];

    const showings = { confirmed: [], cancelled: [], requested: [], modified: [] };
    const feedbackRequests = [];
    const other = [];

    for (const msg of messages) {
      try {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
        const headers = detail.data.payload.headers || [];
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        const body = getEmailBody(detail.data.payload);

        const emailData = { messageId: msg.id, subject, date, timestamp: parseInt(detail.data.internalDate) };

        // Classify BrokerBay email type
        const subjectLower = subject.toLowerCase();

        if (subjectLower.includes('showing confirmed') || subjectLower.includes('showing accepted')) {
          const addr = extractAddressFromSubject(subject, 'Showing Confirmed');
          const showingDetails = parseBrokerBayShowingEmail(body, subject);
          showings.confirmed.push({ ...emailData, address: addr, ...showingDetails });
        }
        else if (subjectLower.includes('showing cancelled') || subjectLower.includes('showing canceled') || subjectLower.includes('cancellation')) {
          const addr = extractAddressFromSubject(subject, 'Showing Cancel');
          const showingDetails = parseBrokerBayShowingEmail(body, subject);
          showings.cancelled.push({ ...emailData, address: addr, ...showingDetails });
        }
        else if (subjectLower.includes('showing request') || subjectLower.includes('new showing')) {
          const addr = extractAddressFromSubject(subject, 'Showing Request');
          const showingDetails = parseBrokerBayShowingEmail(body, subject);
          showings.requested.push({ ...emailData, address: addr, ...showingDetails });
        }
        else if (subjectLower.includes('showing modified') || subjectLower.includes('time change') || subjectLower.includes('reschedule')) {
          const addr = extractAddressFromSubject(subject, 'Showing Modified');
          const showingDetails = parseBrokerBayShowingEmail(body, subject);
          showings.modified.push({ ...emailData, address: addr, ...showingDetails });
        }
        else if (subjectLower.includes('showing feedback') || subjectLower.includes('feedback request')) {
          const addr = extractAddressFromSubject(subject, 'Showing Feedback');
          let feedbackUrl = '';
          if (body) {
            const urlMatch = body.match(/https:\/\/edge\.brokerbay\.com[^\s"'<>]*showing\/[a-f0-9]+[^\s"'<>]*/i);
            if (urlMatch) feedbackUrl = urlMatch[0];
          }
          feedbackRequests.push({ ...emailData, address: addr, feedbackUrl });
        }
        else {
          other.push(emailData);
        }
      } catch (e) {
        console.error(`[BrokerBay] Error processing message ${msg.id}:`, e.message);
      }
    }

    // ── CROSS-REFERENCE ──
    // Match confirmations/cancellations against requests using:
    //   address (normalized) + showingTime + agentName
    // Requests that have a matching confirmation → resolved
    // Requests that have a matching cancellation → cancelled
    const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const makeKey = (entry) => {
      const addr = normalize(entry.address);
      const time = normalize(entry.showingTime || entry.showingDate || '');
      const agent = normalize(entry.agentName || '');
      return `${addr}|${time}|${agent}`;
    };

    // Build lookup sets from confirmations and cancellations
    const confirmedKeys = new Set(showings.confirmed.map(makeKey));
    const cancelledKeys = new Set(showings.cancelled.map(makeKey));

    // Also match by address + agent (in case time format differs between emails)
    const makeLooseKey = (entry) => {
      const addr = normalize(entry.address);
      const agent = normalize(entry.agentName || '');
      return `${addr}|${agent}`;
    };
    const confirmedLooseKeys = new Set(showings.confirmed.map(makeLooseKey));
    const cancelledLooseKeys = new Set(showings.cancelled.map(makeLooseKey));

    // Tag requests with their resolution status
    const resolvedRequests = [];
    const activeRequests = [];
    for (const req of showings.requested) {
      const key = makeKey(req);
      const looseKey = makeLooseKey(req);
      if (cancelledKeys.has(key) || cancelledLooseKeys.has(looseKey)) {
        resolvedRequests.push({ ...req, resolution: 'cancelled', matchedBy: 'address+time+agent' });
      } else if (confirmedKeys.has(key) || confirmedLooseKeys.has(looseKey)) {
        resolvedRequests.push({ ...req, resolution: 'confirmed', matchedBy: 'address+time+agent' });
      } else {
        activeRequests.push(req);
      }
    }

    res.json({
      status: 'ok',
      summary: {
        totalEmails: messages.length,
        confirmedShowings: showings.confirmed.length,
        cancelledShowings: showings.cancelled.length,
        requestedShowings: activeRequests.length,
        resolvedRequests: resolvedRequests.length,
        modifiedShowings: showings.modified.length,
        feedbackRequests: feedbackRequests.length,
      },
      showings: {
        ...showings,
        requested: activeRequests,
        resolved: resolvedRequests,
      },
      feedbackRequests,
      other,
    });
  } catch (err) {
    console.error('[BrokerBay] Scan error:', err.message);
    res.json({ status: 'error', error: err.message, data: {} });
  }
});

// GET /api/gmail/thread/:threadId — Get full thread for cross-referencing
app.get('/api/gmail/thread/:threadId', async (req, res) => {
  if (!tokens) return res.json({ status: 'disconnected' });

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: req.params.threadId,
      format: 'metadata',
      metadataHeaders: ['From', 'To', 'Subject', 'Date'],
    });

    const messages = (thread.data.messages || []).map(msg => {
      const headers = msg.payload.headers || [];
      return {
        id: msg.id,
        from: parseEmailSender(headers.find(h => h.name === 'From')?.value || ''),
        to: headers.find(h => h.name === 'To')?.value || '',
        subject: headers.find(h => h.name === 'Subject')?.value || '',
        date: headers.find(h => h.name === 'Date')?.value || '',
        snippet: msg.snippet,
        timestamp: parseInt(msg.internalDate),
        labels: msg.labelIds || [],
      };
    });

    res.json({ status: 'ok', threadId: req.params.threadId, messageCount: messages.length, messages });
  } catch (err) {
    console.error('[Gmail] Thread fetch error:', err.message);
    res.json({ status: 'error', error: err.message });
  }
});

// GET /api/gmail/activity — Combined email activity timeline
// Cross-references inbox + sent to show a full communication picture
app.get('/api/gmail/activity', async (req, res) => {
  if (!tokens) return res.json({ status: 'disconnected', activity: [] });

  const days = parseInt(req.query.days) || 7;

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Fetch inbox and sent in parallel
    const [inboxRes, sentRes] = await Promise.all([
      gmail.users.messages.list({ userId: 'me', q: `in:inbox newer_than:${days}d`, maxResults: 30 }),
      gmail.users.messages.list({ userId: 'me', q: `in:sent newer_than:${days}d`, maxResults: 30 }),
    ]);

    const allMsgIds = [
      ...(inboxRes.data.messages || []).map(m => ({ ...m, direction: 'received' })),
      ...(sentRes.data.messages || []).map(m => ({ ...m, direction: 'sent' })),
    ];

    const activity = [];
    for (const msg of allMsgIds) {
      try {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        });
        const headers = detail.data.payload.headers || [];
        const from = headers.find(h => h.name === 'From')?.value || '';
        const to = headers.find(h => h.name === 'To')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';

        activity.push({
          id: msg.id,
          threadId: detail.data.threadId,
          direction: msg.direction,
          from: parseEmailSender(from),
          fromEmail: extractEmail(from),
          to: parseEmailSender(to),
          toEmail: extractEmail(to),
          subject,
          snippet: detail.data.snippet,
          date,
          timestamp: parseInt(detail.data.internalDate),
          labels: detail.data.labelIds || [],
        });
      } catch (e) { /* skip failed messages */ }
    }

    // Sort by timestamp descending
    activity.sort((a, b) => b.timestamp - a.timestamp);

    // Deduplicate by threadId — group into conversations
    const threads = {};
    for (const a of activity) {
      if (!threads[a.threadId]) {
        threads[a.threadId] = { threadId: a.threadId, subject: a.subject, messages: [], lastTimestamp: a.timestamp };
      }
      threads[a.threadId].messages.push(a);
      if (a.timestamp > threads[a.threadId].lastTimestamp) {
        threads[a.threadId].lastTimestamp = a.timestamp;
      }
    }

    // Build cross-reference: who have you been emailing and who owes you a reply?
    const contacts = {};
    for (const a of activity) {
      const contactEmail = a.direction === 'sent' ? a.toEmail : a.fromEmail;
      const contactName = a.direction === 'sent' ? a.to : a.from;
      if (!contactEmail || contactEmail.includes('noreply') || contactEmail.includes('notification')) continue;

      if (!contacts[contactEmail]) {
        contacts[contactEmail] = { name: contactName, email: contactEmail, lastSent: null, lastReceived: null, threadIds: new Set() };
      }
      if (a.direction === 'sent' && (!contacts[contactEmail].lastSent || a.timestamp > contacts[contactEmail].lastSent)) {
        contacts[contactEmail].lastSent = a.timestamp;
      }
      if (a.direction === 'received' && (!contacts[contactEmail].lastReceived || a.timestamp > contacts[contactEmail].lastReceived)) {
        contacts[contactEmail].lastReceived = a.timestamp;
      }
      contacts[contactEmail].threadIds.add(a.threadId);
    }

    // Find contacts awaiting reply (you received but haven't replied)
    const awaitingReply = Object.values(contacts)
      .filter(c => c.lastReceived && (!c.lastSent || c.lastReceived > c.lastSent))
      .map(c => ({ name: c.name, email: c.email, lastReceived: c.lastReceived, threads: c.threadIds.size }))
      .sort((a, b) => b.lastReceived - a.lastReceived);

    // Find contacts you've emailed but haven't heard back from
    const waitingOn = Object.values(contacts)
      .filter(c => c.lastSent && (!c.lastReceived || c.lastSent > c.lastReceived))
      .map(c => ({ name: c.name, email: c.email, lastSent: c.lastSent, threads: c.threadIds.size }))
      .sort((a, b) => b.lastSent - a.lastSent);

    res.json({
      status: 'ok',
      totalActivity: activity.length,
      uniqueThreads: Object.keys(threads).length,
      awaitingReply: awaitingReply.slice(0, 15),
      waitingOn: waitingOn.slice(0, 15),
      recentActivity: activity.slice(0, 50),
    });
  } catch (err) {
    console.error('[Gmail] Activity scan error:', err.message);
    res.json({ status: 'error', error: err.message, activity: [] });
  }
});

// ─────────────────────────────────────────────
// EA EMAIL ENGINE — Thread State Model + Live Triage
// Per Wallace Agent HQ Framework §3: turns inbox from a chase into a resolved-state dashboard
// States: awaiting_you | draft_ready | awaiting_them | closed | snoozed
// ─────────────────────────────────────────────

const EA_THREADS_PATH = path.join(__dirname, '.ea-thread-state.json');
const EA_STUCK_PATH = path.join(__dirname, '.ea-stuck-queue.json');
let eaThreadCache = { threads: {}, lastSweep: null, sweepCount: 0 };
let eaStuckQueue = [];

function loadEaState() {
  try {
    if (fs.existsSync(EA_THREADS_PATH)) eaThreadCache = JSON.parse(fs.readFileSync(EA_THREADS_PATH, 'utf8'));
    if (fs.existsSync(EA_STUCK_PATH)) eaStuckQueue = JSON.parse(fs.readFileSync(EA_STUCK_PATH, 'utf8'));
  } catch (err) { console.error('[EA] Failed to load state:', err.message); }
}
loadEaState();

function saveEaThreads() {
  try { fs.writeFileSync(EA_THREADS_PATH, JSON.stringify(eaThreadCache, null, 2)); } catch {}
}
function saveEaStuck() {
  try { fs.writeFileSync(EA_STUCK_PATH, JSON.stringify(eaStuckQueue, null, 2)); } catch {}
}

// Jonathan's known emails — used to detect "last sender = Jonathan" for thread state
const JONATHAN_EMAILS = [
  'jonathanwallacerealestate@gmail.com',
  'jonathan@faristeam.ca',
];

// Auto-archive patterns from framework §3.7
const AUTO_ARCHIVE_PATTERNS = [
  { from: 'info@mg.brokerbay.com', subject: /showing confirmed/i, action: 'archive_file', label: 'property' },
  { from: 'noreply@sisu.co', subject: null, action: 'archive_extract', label: 'sisu' },
  { from: 'noreply@realtor.ca', subject: null, action: 'archive', label: null },
  { from: 'sso@ampre.ca', subject: null, action: 'archive', label: null },
  { from: 'hello@notify.railway.app', subject: null, action: 'archive', label: null },
  { from: 'noreply@github.com', subject: null, action: 'archive', label: null },
  { from: 'notifications@em.realmmlp.ca', subject: null, action: 'archive', label: null },
  { from: 'offers@faristeam.ca', subject: null, action: 'archive', label: null },
];

// Priority classification from framework §3.4 + §12.3
function classifyThreadPriority(fromEmail, subject, category) {
  const sub = (subject || '').toLowerCase();
  const from = (fromEmail || '').toLowerCase();

  // P0: Offers, lawyer/client urgent with financial impact
  if (sub.includes('offer') || sub.includes('accepted') || sub.includes('counter') || sub.includes('aps')) return 'p0';
  if (sub.includes('amendment') || sub.includes('waiver') || sub.includes('notice of fulfillment')) return 'p0';

  // P1: Lead reassignment, new lead first-touch, InterFace form
  if (from.includes('followupboss') && (sub.includes('reassign') || sub.includes('reach out'))) return 'p1';
  if (from.includes('followupboss') && sub.includes('lead assigned')) return 'p1';
  if (from.includes('interface.re') && sub.includes('not submitted')) return 'p1';

  // Client-facing = high priority
  if (category === 'transaction' || category === 'showing') return 'p1';

  return 'p2';
}

// Determine sender type from email address
function classifySenderType(email) {
  const e = (email || '').toLowerCase();
  if (JONATHAN_EMAILS.some(j => e.includes(j))) return 'jonathan';
  if (e.includes('brokerbay') || e.includes('sisu') || e.includes('realtor.ca') || e.includes('railway') || e.includes('github') || e.includes('ampre') || e.includes('realm')) return 'auto-notif';
  if (e.includes('faristeam.ca')) return 'internal';
  if (e.includes('followupboss')) return 'auto-notif';
  // Known lawyers from preferences.md
  if (e.includes('playtiscameron') || e.includes('hgrgraham') || e.includes('peggyhill')) return 'lawyer';
  // Known lenders
  if (e.includes('erieshores')) return 'lender';
  return 'client'; // Default — agents and clients
}

// Check if an email matches auto-archive patterns
function shouldAutoArchive(fromEmail, subject) {
  const from = (fromEmail || '').toLowerCase();
  const sub = (subject || '').toLowerCase();
  for (const pattern of AUTO_ARCHIVE_PATTERNS) {
    if (from.includes(pattern.from.toLowerCase())) {
      if (!pattern.subject || pattern.subject.test(subject)) {
        return pattern;
      }
    }
  }
  return null;
}

// GET /api/ea/triage — The main EA email sweep endpoint
// Scans Gmail threads, classifies state, returns the full thread state dashboard
app.get('/api/ea/triage', async (req, res) => {
  if (!tokens) {
    // Return cached data as fallback when disconnected
    const threads = Object.values(eaThreadCache.threads);
    if (threads.length > 0) {
      return res.json({
        status: 'offline_cached',
        lastSweep: eaThreadCache.lastSweep,
        threads: threads,
        counts: countThreadStates(threads),
      });
    }
    return res.json({ status: 'disconnected', threads: [], counts: { awaiting_you: 0, draft_ready: 0, awaiting_them: 0, closed: 0, snoozed: 0 } });
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const days = parseInt(req.query.days) || 14;

    // Step 1: Fetch inbox threads (not individual messages)
    const inboxRes = await gmail.users.threads.list({
      userId: 'me',
      q: `in:inbox newer_than:${days}d`,
      maxResults: 80,
    });
    const inboxThreads = inboxRes.data.threads || [];

    // Step 2: Fetch sent threads to detect "awaiting them" state
    const sentRes = await gmail.users.threads.list({
      userId: 'me',
      q: `in:sent newer_than:${days}d`,
      maxResults: 50,
    });
    const sentThreadIds = new Set((sentRes.data.threads || []).map(t => t.id));

    // Step 2b: Fetch forwarded CC copies from Outlook (jonathan@faristeam.ca → Gmail forwarding)
    // These arrive as inbound messages FROM jonathan@faristeam.ca when he CCs himself on Outlook replies
    const ccForwardRes = await gmail.users.messages.list({
      userId: 'me',
      q: `from:jonathan@faristeam.ca newer_than:${days}d`,
      maxResults: 100,
    });
    const ccForwardMsgIds = new Set((ccForwardRes.data.messages || []).map(m => m.id));
    const ccForwardCount = ccForwardMsgIds.size;
    console.log(`[EA] Found ${ccForwardCount} CC-forwarded Outlook replies in Gmail`);

    // Step 3: Process each thread
    const processedThreads = {};

    for (const thread of inboxThreads) {
      try {
        const detail = await gmail.users.threads.get({
          userId: 'me',
          id: thread.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Cc'],
        });

        const messages = detail.data.messages || [];
        if (messages.length === 0) continue;

        // Get the first message for subject, and last message for state
        const firstMsg = messages[0];
        const lastMsg = messages[messages.length - 1];

        const firstHeaders = firstMsg.payload?.headers || [];
        const lastHeaders = lastMsg.payload?.headers || [];

        const subject = firstHeaders.find(h => h.name === 'Subject')?.value || '(no subject)';
        const lastFrom = lastHeaders.find(h => h.name === 'From')?.value || '';
        const lastDate = lastHeaders.find(h => h.name === 'Date')?.value || '';
        const lastFromEmail = extractEmail(lastFrom);
        const lastSenderType = classifySenderType(lastFromEmail);

        // First message sender info (for display)
        const firstFrom = firstHeaders.find(h => h.name === 'From')?.value || '';

        // Classify the email category
        const lastSnippet = lastMsg.snippet || '';
        const lastLabels = lastMsg.labelIds || [];
        const category = categorizeEmail(lastFrom, subject, lastSnippet, lastLabels);
        const priority = classifyThreadPriority(lastFromEmail, subject, category);

        // Check if auto-archive applies
        const archiveRule = shouldAutoArchive(lastFromEmail, subject);

        // Determine thread state per framework §3.5
        let state = 'awaiting_you';
        const isFromJonathan = JONATHAN_EMAILS.some(j => lastFromEmail.includes(j));
        const existingState = eaThreadCache.threads[thread.id];

        // Also check: did Jonathan send ANY recent message in this thread?
        // This catches CC-forwarded Outlook replies that may not be the "last" message
        // (e.g., if the forwarded CC arrives slightly after the original)
        const jonathanSentInThread = messages.some(msg => {
          const msgFrom = (msg.payload?.headers || []).find(h => h.name === 'From')?.value || '';
          const msgFromEmail = extractEmail(msgFrom);
          return JONATHAN_EMAILS.some(j => msgFromEmail.includes(j));
        });
        // Check if this thread also appears in sent folder
        const inSentFolder = sentThreadIds.has(thread.id);
        // Combined: Jonathan has replied if last msg is from him, OR he sent in thread, OR thread is in sent
        const jonathanHasReplied = isFromJonathan || (jonathanSentInThread && !isFromJonathan);

        if (existingState?.state === 'snoozed') {
          // Respect snooze — check if snooze has expired
          const snoozeUntil = existingState.snoozeUntil ? new Date(existingState.snoozeUntil) : null;
          if (snoozeUntil && snoozeUntil > new Date()) {
            state = 'snoozed';
          } else {
            state = 'awaiting_you'; // Snooze expired
          }
        } else if (existingState?.state === 'closed' && !lastLabels.includes('UNREAD')) {
          state = 'closed'; // Respect manual close
        } else if (archiveRule) {
          state = 'closed'; // Auto-archive rule
        } else if (isFromJonathan || jonathanHasReplied || inSentFolder) {
          // Jonathan sent last, OR CC'd reply detected, OR thread is in sent folder
          // Determine if it's a closing reply or still awaiting their response
          const lastSnippetLower = lastSnippet.toLowerCase();
          if (isFromJonathan && (lastSnippetLower.includes('thank') || lastSnippetLower.includes('confirmed') ||
              lastSnippetLower.includes('sounds good') || lastSnippetLower.includes('all set'))) {
            state = 'closed';
          } else {
            state = 'awaiting_them';
          }
        } else if (existingState?.state === 'draft_ready') {
          state = 'draft_ready'; // Preserve draft_ready
        } else {
          state = 'awaiting_you';
        }

        // Determine who we're waiting on / who needs reply
        const participants = new Set();
        for (const msg of messages) {
          const from = (msg.payload?.headers || []).find(h => h.name === 'From')?.value || '';
          const to = (msg.payload?.headers || []).find(h => h.name === 'To')?.value || '';
          if (from) participants.add(extractEmail(from));
          if (to) participants.add(extractEmail(to));
        }

        processedThreads[thread.id] = {
          threadId: thread.id,
          subject,
          from: parseEmailSender(lastFrom),
          fromEmail: lastFromEmail,
          firstFrom: parseEmailSender(firstFrom),
          firstFromEmail: extractEmail(firstFrom),
          lastDate,
          timestamp: parseInt(lastMsg.internalDate),
          messageCount: messages.length,
          state,
          priority,
          category,
          senderType: lastSenderType,
          isRead: !lastLabels.includes('UNREAD'),
          isStarred: lastLabels.includes('STARRED'),
          snippet: lastSnippet,
          participants: [...participants],
          autoArchiveRule: archiveRule ? archiveRule.action : null,
          linkedProperty: null, // Will be populated by property-matching logic
          outlookCcDetected: jonathanSentInThread && !isFromJonathan, // CC-forwarded reply detected
          inSentFolder: inSentFolder,
        };
      } catch (e) {
        console.error(`[EA] Error processing thread ${thread.id}:`, e.message);
      }
    }

    // Also check FUB for sent-email activity (solves Outlook sent-folder visibility gap)
    let fubSentActivity = [];
    if (FUB_API_KEY) {
      try {
        // FUB tracks email events — we can see what Jonathan has sent
        const fubResp = await fetch(`${FUB_BASE}/events?type=email&limit=50&sort=created&order=desc`, {
          headers: fubHeaders(),
        });
        if (fubResp.ok) {
          const fubData = await fubResp.json();
          fubSentActivity = (fubData.events || []).filter(e =>
            e.type === 'email' && e.isIncoming === false
          ).map(e => ({
            personId: e.personId,
            personName: e.person ? [e.person.firstName, e.person.lastName].filter(Boolean).join(' ') : '',
            subject: e.description || '',
            date: e.created,
            source: 'fub',
          }));
          console.log(`[EA] FUB sent activity: ${fubSentActivity.length} outbound emails found`);
        }
      } catch (e) {
        console.log('[EA] FUB events check (non-critical):', e.message);
      }
    }

    // Cross-reference FUB sent emails to update thread states
    // If we see a FUB sent email that matches a thread's subject/contact, mark it awaiting_them
    for (const fubSent of fubSentActivity) {
      // Try to match by subject similarity
      for (const [tid, thread] of Object.entries(processedThreads)) {
        if (thread.state === 'awaiting_you') {
          const fubSubLower = (fubSent.subject || '').toLowerCase();
          const threadSubLower = (thread.subject || '').toLowerCase();
          // Match if subjects overlap or if the FUB person name matches the thread sender
          const nameLower = (fubSent.personName || '').toLowerCase();
          const threadFrom = (thread.from || '').toLowerCase();
          if ((fubSubLower && threadSubLower.includes(fubSubLower.slice(0, 20))) ||
              (nameLower && threadFrom.includes(nameLower.split(' ')[0]))) {
            // Check if FUB sent date is after last thread message
            const fubDate = new Date(fubSent.date).getTime();
            if (fubDate > (thread.timestamp || 0)) {
              processedThreads[tid].state = 'awaiting_them';
              processedThreads[tid].fubSentMatch = true;
            }
          }
        }
      }
    }

    // Save thread cache
    eaThreadCache = {
      threads: processedThreads,
      lastSweep: new Date().toISOString(),
      sweepCount: (eaThreadCache.sweepCount || 0) + 1,
      fubSentCount: fubSentActivity.length,
    };
    saveEaThreads();

    const threads = Object.values(processedThreads);
    const counts = countThreadStates(threads);

    // Sort: P0 first, then P1, then by unread, then by timestamp
    threads.sort((a, b) => {
      const po = { p0: 0, p1: 1, p2: 2 };
      const pd = (po[a.priority] || 2) - (po[b.priority] || 2);
      if (pd !== 0) return pd;
      if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
      return (b.timestamp || 0) - (a.timestamp || 0);
    });

    res.json({
      status: 'ok',
      lastSweep: eaThreadCache.lastSweep,
      sweepCount: eaThreadCache.sweepCount,
      fubSentTracked: fubSentActivity.length,
      outlookCcForwards: ccForwardCount,
      threads,
      counts,
    });
  } catch (err) {
    console.error('[EA] Triage error:', err.message);
    // Fallback to cached data
    const threads = Object.values(eaThreadCache.threads);
    res.json({
      status: 'error_cached',
      error: err.message,
      lastSweep: eaThreadCache.lastSweep,
      threads,
      counts: countThreadStates(threads),
    });
  }
});

function countThreadStates(threads) {
  const counts = { awaiting_you: 0, draft_ready: 0, awaiting_them: 0, closed: 0, snoozed: 0 };
  for (const t of threads) {
    if (counts[t.state] !== undefined) counts[t.state]++;
  }
  return counts;
}

// ─────────────────────────────────────────────
// SCHEDULED EA SWEEP — 7AM & 5PM EST daily
// Automatic background sweep that re-runs the full EA triage to catch
// CC-forwarded Outlook replies, reconcile thread states, and keep
// Agent HQ accurate even when the dashboard isn't open.
// ─────────────────────────────────────────────
let scheduledSweepLog = [];
const MAX_SWEEP_LOG = 50;

async function runScheduledSweep(trigger = 'scheduled') {
  const startTime = Date.now();
  console.log(`[EA Sweep] Starting ${trigger} sweep at ${new Date().toISOString()}`);

  if (!tokens) {
    const entry = { time: new Date().toISOString(), trigger, status: 'skipped', reason: 'no_tokens', duration: 0 };
    scheduledSweepLog.unshift(entry);
    if (scheduledSweepLog.length > MAX_SWEEP_LOG) scheduledSweepLog.pop();
    console.log(`[EA Sweep] Skipped — no Google tokens`);
    return entry;
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const days = 14;

    // Step 1: Fetch inbox threads
    const inboxRes = await gmail.users.threads.list({
      userId: 'me',
      q: `in:inbox newer_than:${days}d`,
      maxResults: 80,
    });
    const inboxThreads = inboxRes.data.threads || [];

    // Step 2: Fetch sent threads
    const sentRes = await gmail.users.threads.list({
      userId: 'me',
      q: `in:sent newer_than:${days}d`,
      maxResults: 50,
    });
    const sentThreadIds = new Set((sentRes.data.threads || []).map(t => t.id));

    // Step 2b: CC-forwarded Outlook replies
    const ccForwardRes = await gmail.users.messages.list({
      userId: 'me',
      q: `from:jonathan@faristeam.ca newer_than:${days}d`,
      maxResults: 100,
    });
    const ccForwardCount = (ccForwardRes.data.messages || []).length;

    // Step 3: Process threads (same logic as /api/ea/triage)
    const processedThreads = {};
    let stateChanges = 0;
    const prevThreads = { ...eaThreadCache.threads };

    for (const thread of inboxThreads) {
      try {
        const detail = await gmail.users.threads.get({
          userId: 'me',
          id: thread.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Cc'],
        });

        const messages = detail.data.messages || [];
        if (messages.length === 0) continue;

        const firstMsg = messages[0];
        const lastMsg = messages[messages.length - 1];
        const firstHeaders = firstMsg.payload?.headers || [];
        const lastHeaders = lastMsg.payload?.headers || [];

        const subject = firstHeaders.find(h => h.name === 'Subject')?.value || '(no subject)';
        const lastFrom = lastHeaders.find(h => h.name === 'From')?.value || '';
        const lastDate = lastHeaders.find(h => h.name === 'Date')?.value || '';
        const lastFromEmail = extractEmail(lastFrom);
        const lastSenderType = classifySenderType(lastFromEmail);
        const firstFrom = firstHeaders.find(h => h.name === 'From')?.value || '';
        const lastSnippet = lastMsg.snippet || '';
        const lastLabels = lastMsg.labelIds || [];
        const category = categorizeEmail(lastFrom, subject, lastSnippet, lastLabels);
        const priority = classifyThreadPriority(lastFromEmail, subject, category);
        const archiveRule = shouldAutoArchive(lastFromEmail, subject);

        let state = 'awaiting_you';
        const isFromJonathan = JONATHAN_EMAILS.some(j => lastFromEmail.includes(j));
        const existingState = eaThreadCache.threads[thread.id];

        const jonathanSentInThread = messages.some(msg => {
          const msgFrom = (msg.payload?.headers || []).find(h => h.name === 'From')?.value || '';
          const msgFromEmail = extractEmail(msgFrom);
          return JONATHAN_EMAILS.some(j => msgFromEmail.includes(j));
        });
        const inSentFolder = sentThreadIds.has(thread.id);
        const jonathanHasReplied = isFromJonathan || (jonathanSentInThread && !isFromJonathan);

        if (existingState?.state === 'snoozed') {
          const snoozeUntil = existingState.snoozeUntil ? new Date(existingState.snoozeUntil) : null;
          if (snoozeUntil && snoozeUntil <= new Date()) {
            state = 'awaiting_you';
          } else {
            state = 'snoozed';
          }
        } else if (existingState?.state === 'closed' && !existingState?.autoArchiveRule) {
          state = 'closed';
        } else if (archiveRule) {
          state = 'closed';
        } else if (isFromJonathan || jonathanHasReplied || inSentFolder) {
          const lastSnippetLower = lastSnippet.toLowerCase();
          if (isFromJonathan && (lastSnippetLower.includes('thank') || lastSnippetLower.includes('confirmed') ||
              lastSnippetLower.includes('sounds good') || lastSnippetLower.includes('all set'))) {
            state = 'closed';
          } else {
            state = 'awaiting_them';
          }
        } else {
          state = 'awaiting_you';
        }

        // Track state changes from previous sweep
        const prevState = prevThreads[thread.id]?.state;
        if (prevState && prevState !== state) {
          stateChanges++;
          console.log(`[EA Sweep] Thread ${thread.id} state changed: ${prevState} → ${state} (${subject.substring(0, 40)})`);
        }

        const participants = new Set();
        messages.forEach(msg => {
          const from = (msg.payload?.headers || []).find(h => h.name === 'From')?.value || '';
          const to = (msg.payload?.headers || []).find(h => h.name === 'To')?.value || '';
          if (from) participants.add(extractEmail(from));
          if (to) to.split(',').forEach(e => participants.add(extractEmail(e.trim())));
        });

        processedThreads[thread.id] = {
          id: thread.id,
          subject,
          from: firstFrom,
          lastFrom,
          lastFromEmail,
          lastSenderType,
          lastSnippet,
          lastDate,
          timestamp: lastDate ? new Date(lastDate).getTime() : 0,
          messageCount: messages.length,
          state,
          priority,
          category,
          isRead: !lastLabels.includes('UNREAD'),
          participants: [...participants],
          autoArchiveRule: archiveRule ? archiveRule.action : null,
          linkedProperty: null,
          outlookCcDetected: jonathanSentInThread && !isFromJonathan,
          inSentFolder: inSentFolder,
        };
      } catch (e) {
        console.error(`[EA Sweep] Error processing thread ${thread.id}:`, e.message);
      }
    }

    // Save updated cache
    eaThreadCache = {
      threads: processedThreads,
      lastSweep: new Date().toISOString(),
      sweepCount: (eaThreadCache.sweepCount || 0) + 1,
    };
    saveEaThreads();

    const duration = Date.now() - startTime;
    const counts = countThreadStates(Object.values(processedThreads));
    const entry = {
      time: new Date().toISOString(),
      trigger,
      status: 'success',
      duration,
      threadsProcessed: Object.keys(processedThreads).length,
      ccForwardsFound: ccForwardCount,
      stateChanges,
      counts,
    };
    scheduledSweepLog.unshift(entry);
    if (scheduledSweepLog.length > MAX_SWEEP_LOG) scheduledSweepLog.pop();
    console.log(`[EA Sweep] Complete: ${entry.threadsProcessed} threads, ${ccForwardCount} CC forwards, ${stateChanges} state changes, ${duration}ms`);
    return entry;
  } catch (err) {
    const duration = Date.now() - startTime;
    const entry = { time: new Date().toISOString(), trigger, status: 'error', error: err.message, duration };
    scheduledSweepLog.unshift(entry);
    if (scheduledSweepLog.length > MAX_SWEEP_LOG) scheduledSweepLog.pop();
    console.error(`[EA Sweep] Error:`, err.message);
    return entry;
  }
}

// Hourly sweep — runs every 60 minutes, lightweight and always-on
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
setInterval(() => {
  const now = new Date();
  const estString = now.toLocaleString('en-US', { timeZone: 'America/Toronto', hour: 'numeric', minute: 'numeric', hour12: true });
  console.log(`[EA Sweep] Hourly sweep firing (${estString} EST)`);
  runScheduledSweep(`hourly_${estString.replace(/[:\s]/g, '')}`);
}, SWEEP_INTERVAL_MS);

// Also run a sweep on startup (after a short delay for tokens to load)
setTimeout(() => {
  console.log('[EA Sweep] Running startup sweep...');
  runScheduledSweep('startup');
}, 15 * 1000);

// GET /api/ea/sweep-status — View scheduled sweep status and logs
app.get('/api/ea/sweep-status', (req, res) => {
  const now = new Date();
  const estString = now.toLocaleString('en-US', { timeZone: 'America/Toronto' });
  res.json({
    currentTimeEST: estString,
    schedule: 'Every hour (24/7 on Railway)',
    lastSweep: scheduledSweepLog[0] || null,
    totalSweeps: scheduledSweepLog.length,
    recentLogs: scheduledSweepLog.slice(0, 10),
  });
});

// POST /api/ea/sweep-now — Manually trigger a sweep
app.post('/api/ea/sweep-now', async (req, res) => {
  const result = await runScheduledSweep('manual');
  res.json(result);
});

// ─────────────────────────────────────────────
// OUTLOOK SENT FOLDER SCRAPER
// Receives scraped sent emails from Chrome extension, stores them,
// and cross-references against EA thread cache to fix missed states.
// ─────────────────────────────────────────────
const OUTLOOK_SCRAPE_PATH = path.join(__dirname, '.outlook-sent-scrape.json');
let outlookSentCache = { emails: [], lastScrape: null, scrapeCount: 0, corrections: [] };

function loadOutlookSent() {
  try {
    if (fs.existsSync(OUTLOOK_SCRAPE_PATH)) outlookSentCache = JSON.parse(fs.readFileSync(OUTLOOK_SCRAPE_PATH, 'utf8'));
  } catch {}
}
function saveOutlookSent() {
  try { fs.writeFileSync(OUTLOOK_SCRAPE_PATH, JSON.stringify(outlookSentCache, null, 2)); } catch {}
}
loadOutlookSent();

// POST /api/ea/outlook-sent — Receive scraped sent emails from Chrome extension
app.post('/api/ea/outlook-sent', (req, res) => {
  const { emails } = req.body;
  if (!emails || !Array.isArray(emails)) {
    return res.json({ success: false, error: 'Expected { emails: [...] }' });
  }

  console.log(`[Outlook Scrape] Received ${emails.length} sent emails`);

  // Deduplicate by subject+date combo
  const existingKeys = new Set(outlookSentCache.emails.map(e => `${e.subject}|${e.date}`));
  let newCount = 0;
  for (const email of emails) {
    const key = `${email.subject}|${email.date}`;
    if (!existingKeys.has(key)) {
      outlookSentCache.emails.push({
        subject: email.subject || '',
        to: email.to || '',
        date: email.date || '',
        snippet: email.snippet || '',
        scrapedAt: new Date().toISOString(),
      });
      existingKeys.add(key);
      newCount++;
    }
  }

  // Trim to last 500 emails
  if (outlookSentCache.emails.length > 500) {
    outlookSentCache.emails = outlookSentCache.emails.slice(-500);
  }

  outlookSentCache.lastScrape = new Date().toISOString();
  outlookSentCache.scrapeCount = (outlookSentCache.scrapeCount || 0) + 1;

  // Cross-reference: check if any scraped sent emails match "awaiting_you" threads
  const corrections = [];
  const threads = Object.values(eaThreadCache.threads);
  for (const thread of threads) {
    if (thread.state !== 'awaiting_you') continue;

    // Match by subject (fuzzy: strip Re:/Fwd: prefixes)
    const cleanSubject = (s) => (s || '').replace(/^(re|fwd|fw):\s*/gi, '').trim().toLowerCase();
    const threadSubjectClean = cleanSubject(thread.subject);

    for (const sent of emails) {
      const sentSubjectClean = cleanSubject(sent.subject);
      if (threadSubjectClean && sentSubjectClean && threadSubjectClean === sentSubjectClean) {
        // Check if the sent email is more recent than the thread's last message
        const sentDate = new Date(sent.date).getTime();
        if (sentDate > (thread.timestamp || 0) - 300000) { // 5 min tolerance
          // Jonathan replied via Outlook — correct the state
          console.log(`[Outlook Scrape] Correcting thread "${thread.subject}" from awaiting_you → awaiting_them (matched sent email from ${sent.date})`);
          eaThreadCache.threads[thread.id].state = 'awaiting_them';
          eaThreadCache.threads[thread.id].outlookScrapeMatch = true;
          corrections.push({
            threadId: thread.id,
            subject: thread.subject,
            oldState: 'awaiting_you',
            newState: 'awaiting_them',
            matchedSentDate: sent.date,
            correctedAt: new Date().toISOString(),
          });
          break;
        }
      }
    }
  }

  if (corrections.length > 0) {
    outlookSentCache.corrections.push(...corrections);
    // Trim corrections log
    if (outlookSentCache.corrections.length > 200) {
      outlookSentCache.corrections = outlookSentCache.corrections.slice(-200);
    }
    saveEaThreads();
  }
  saveOutlookSent();

  res.json({
    success: true,
    received: emails.length,
    newEmails: newCount,
    corrections: corrections.length,
    correctionDetails: corrections,
    totalStored: outlookSentCache.emails.length,
  });
});

// GET /api/ea/outlook-sent — View stored Outlook sent data and correction history
app.get('/api/ea/outlook-sent', (req, res) => {
  res.json({
    lastScrape: outlookSentCache.lastScrape,
    scrapeCount: outlookSentCache.scrapeCount,
    totalStored: outlookSentCache.emails.length,
    recentEmails: outlookSentCache.emails.slice(-20),
    recentCorrections: outlookSentCache.corrections.slice(-20),
  });
});

// POST /api/ea/thread/:threadId/state — Manually update thread state (snooze, close, etc.)
app.post('/api/ea/thread/:threadId/state', (req, res) => {
  const { threadId } = req.params;
  const { state, snoozeUntil } = req.body;
  if (!eaThreadCache.threads[threadId]) {
    return res.json({ success: false, error: 'Thread not found' });
  }
  const validStates = ['awaiting_you', 'draft_ready', 'awaiting_them', 'closed', 'snoozed'];
  if (!validStates.includes(state)) {
    return res.json({ success: false, error: 'Invalid state' });
  }
  eaThreadCache.threads[threadId].state = state;
  if (state === 'snoozed' && snoozeUntil) {
    eaThreadCache.threads[threadId].snoozeUntil = snoozeUntil;
  }
  saveEaThreads();
  res.json({ success: true, threadId, state });
});

// ─────────────────────────────────────────────
// "CLAUDE STUCK, NEEDS ANSWER" TICKER
// Per framework §12.4 + §13.2: dashboard widget for blocked decisions
// ─────────────────────────────────────────────

// GET /api/ea/stuck — Get all pending stuck questions
app.get('/api/ea/stuck', (req, res) => {
  const pending = eaStuckQueue.filter(q => !q.resolved);
  res.json({ questions: pending, total: pending.length });
});

// POST /api/ea/stuck — Add a new stuck question
app.post('/api/ea/stuck', (req, res) => {
  const { summary, context, options, priority, workflow } = req.body;
  if (!summary || !options || !Array.isArray(options) || options.length < 2) {
    return res.json({ success: false, error: 'Need summary + at least 2 options' });
  }
  const question = {
    id: `stuck-${Date.now()}`,
    summary,
    context: context || '',
    options, // Array of { label, description }
    priority: priority || 'p2',
    workflow: workflow || 'general',
    createdAt: new Date().toISOString(),
    resolved: false,
    resolvedAt: null,
    answer: null,
  };
  eaStuckQueue.push(question);
  saveEaStuck();
  console.log(`[EA] Stuck question added: "${summary}" (${options.length} options)`);
  res.json({ success: true, question });
});

// POST /api/ea/stuck/:id/resolve — Answer a stuck question
app.post('/api/ea/stuck/:id/resolve', (req, res) => {
  const { id } = req.params;
  const { answer } = req.body;
  const question = eaStuckQueue.find(q => q.id === id);
  if (!question) return res.json({ success: false, error: 'Question not found' });
  question.resolved = true;
  question.resolvedAt = new Date().toISOString();
  question.answer = answer;
  saveEaStuck();
  console.log(`[EA] Stuck question resolved: "${question.summary}" → "${answer}"`);
  res.json({ success: true, question });
});

// POST /api/ea/stuck/:id/dismiss — Dismiss without answering
app.post('/api/ea/stuck/:id/dismiss', (req, res) => {
  const { id } = req.params;
  const question = eaStuckQueue.find(q => q.id === id);
  if (!question) return res.json({ success: false, error: 'Question not found' });
  question.resolved = true;
  question.resolvedAt = new Date().toISOString();
  question.answer = '__dismissed__';
  saveEaStuck();
  res.json({ success: true });
});

// ─── Helper Functions ───

function parseEmailSender(from) {
  // "Jonathan Wallace <jonathan@example.com>" → "Jonathan Wallace"
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  // Just an email address
  return from.split('@')[0];
}

function extractEmail(from) {
  const match = from.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase();
  if (from.includes('@')) return from.trim().toLowerCase();
  return '';
}

function categorizeEmail(from, subject, snippet, labels) {
  const fromLower = from.toLowerCase();
  const subjectLower = subject.toLowerCase();

  if (fromLower.includes('brokerbay')) return 'brokerbay';
  if (fromLower.includes('followupboss') || fromLower.includes('fub')) return 'crm_lead';
  if (fromLower.includes('sisu')) return 'deal_tracker';
  if (fromLower.includes('realm')) return 'listing_alert';
  if (fromLower.includes('make.com')) return 'automation';
  if (fromLower.includes('faristeam') || fromLower.includes('faris')) return 'team';
  if (subjectLower.includes('offer') || subjectLower.includes('agreement')) return 'transaction';
  if (subjectLower.includes('showing')) return 'showing';
  if (subjectLower.includes('listing') || subjectLower.includes('mls')) return 'listing';
  if (labels.includes('IMPORTANT')) return 'important';
  return 'general';
}

function categorizeSentEmail(to, subject, snippet) {
  const subjectLower = subject.toLowerCase();
  const toLower = to.toLowerCase();

  if (subjectLower.includes('showing') || subjectLower.includes('feedback')) return 'showing_related';
  if (subjectLower.includes('offer') || subjectLower.includes('agreement') || subjectLower.includes('deal')) return 'transaction';
  if (subjectLower.includes('listing') || subjectLower.includes('mls') || subjectLower.includes('market')) return 'listing';
  if (subjectLower.includes('follow up') || subjectLower.includes('checking in') || subjectLower.includes('touching base')) return 'follow_up';
  if (toLower.includes('client') || subjectLower.includes('buyer') || subjectLower.includes('seller')) return 'client';
  return 'general';
}

function extractAddressFromSubject(subject, prefix) {
  // "Showing Confirmed - 45 Brule Street" → "45 Brule Street"
  const patterns = [
    new RegExp(prefix + '\\s*[-–—:]\\s*(.+)', 'i'),
    /[-–—:]\s*(.+)/,
  ];
  for (const p of patterns) {
    const m = subject.match(p);
    if (m) return m[1].trim();
  }
  return subject;
}

function parseBrokerBayShowingEmail(body, subject) {
  if (!body) return {};
  const info = {};

  // Try to extract showing date/time
  const dateMatch = body.match(/Date:\s*([^\n<]+)/i);
  if (dateMatch) info.showingDate = dateMatch[1].trim();

  const timeMatch = body.match(/Time:\s*([^\n<]+)/i);
  if (timeMatch) info.showingTime = timeMatch[1].trim();

  // Agent name
  const agentMatch = body.match(/Agent:\s*([^\n<]+)/i) || body.match(/requested by\s*([^\n<]+)/i);
  if (agentMatch) info.agentName = agentMatch[1].trim();

  // Brokerage
  const brokerageMatch = body.match(/Brokerage:\s*([^\n<]+)/i) || body.match(/from\s+([\w\s]+(?:Realty|Real Estate|RE\/MAX|Keller|Century|Royal|Sutton)[^\n<]*)/i);
  if (brokerageMatch) info.brokerage = brokerageMatch[1].trim();

  // Type (regular, home inspection, etc.)
  const typeMatch = body.match(/Type:\s*([^\n<]+)/i);
  if (typeMatch) info.showingType = typeMatch[1].trim();

  return info;
}

// ─────────────────────────────────────────────
// GMAIL RECONNECTION BACKFILL — Missed Emails Recovery
// When Gmail disconnects and reconnects, this scans for
// everything that came in while offline so nothing slips through.
// ─────────────────────────────────────────────

const MISSED_EMAILS_PATH = path.join(__dirname, '.gmail-missed-emails.json');
let missedEmailsCache = { emails: [], backfillTimestamp: null, fromDate: null, toDate: null, dismissed: false };

function loadMissedEmails() {
  try {
    if (fs.existsSync(MISSED_EMAILS_PATH)) {
      missedEmailsCache = JSON.parse(fs.readFileSync(MISSED_EMAILS_PATH, 'utf8'));
    }
  } catch {}
}
loadMissedEmails();

function saveMissedEmails() {
  try {
    fs.writeFileSync(MISSED_EMAILS_PATH, JSON.stringify(missedEmailsCache, null, 2));
  } catch (err) {
    console.error('[Gmail] Failed to save missed emails:', err.message);
  }
}

// Core backfill function — scans Gmail for emails received during the offline window
async function triggerMissedEmailBackfill() {
  if (!tokens || !tokens.access_token) {
    console.log('[Gmail Backfill] No tokens — skipping backfill');
    return { success: false, reason: 'No tokens' };
  }

  const disconnectedAt = gmailConnectionState.lastDisconnected;
  const reconnectedAt = gmailConnectionState.lastConnected;

  if (!disconnectedAt) {
    console.log('[Gmail Backfill] No disconnect timestamp — nothing to backfill');
    return { success: false, reason: 'No disconnect timestamp recorded' };
  }

  // Calculate the offline window
  const offlineStart = new Date(disconnectedAt);
  const offlineEnd = reconnectedAt ? new Date(reconnectedAt) : new Date();

  // Safety cap: don't backfill more than 30 days
  const maxBackfillMs = 30 * 24 * 60 * 60 * 1000;
  if (offlineEnd - offlineStart > maxBackfillMs) {
    offlineStart.setTime(offlineEnd.getTime() - maxBackfillMs);
    console.log('[Gmail Backfill] Capping backfill to 30 days');
  }

  // Convert to Gmail search format (epoch seconds)
  const afterEpoch = Math.floor(offlineStart.getTime() / 1000);
  const beforeEpoch = Math.floor(offlineEnd.getTime() / 1000);

  console.log(`[Gmail Backfill] Scanning emails from ${offlineStart.toISOString()} to ${offlineEnd.toISOString()}`);

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Search for all inbox emails in the offline window
    const query = `in:inbox after:${afterEpoch} before:${beforeEpoch}`;
    let allMessages = [];
    let pageToken = null;

    do {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
        pageToken: pageToken || undefined,
      });
      const messages = listRes.data.messages || [];
      allMessages = allMessages.concat(messages);
      pageToken = listRes.data.nextPageToken;
      if (allMessages.length > 500) break; // Safety cap
    } while (pageToken);

    console.log(`[Gmail Backfill] Found ${allMessages.length} messages in offline window`);

    // Fetch metadata for each message
    const emails = [];
    for (const msg of allMessages) {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Reply-To'],
        });
        const headers = detail.data.payload.headers || [];
        const from = headers.find(h => h.name === 'From')?.value || '';
        const to = headers.find(h => h.name === 'To')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        const snippet = detail.data.snippet || '';
        const labelIds = detail.data.labelIds || [];

        const category = categorizeEmail(from, subject, snippet, labelIds);

        // Determine priority based on category
        let priority = 'low';
        if (category === 'transaction' || category === 'showing') priority = 'high';
        else if (category === 'crm_lead' || category === 'important' || category === 'brokerbay') priority = 'medium';
        else if (category === 'team' || category === 'automation') priority = 'low';

        emails.push({
          id: msg.id,
          threadId: detail.data.threadId,
          from: parseEmailSender(from),
          fromEmail: extractEmail(from),
          to,
          subject,
          snippet,
          date,
          timestamp: parseInt(detail.data.internalDate),
          labels: labelIds,
          category,
          priority,
          isRead: !labelIds.includes('UNREAD'),
          isStarred: labelIds.includes('STARRED'),
          missedDuring: 'offline',
        });
      } catch (e) {
        console.error(`[Gmail Backfill] Error fetching message ${msg.id}:`, e.message);
      }
    }

    // Sort by priority (high first) then by timestamp (newest first)
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    emails.sort((a, b) => {
      const pd = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
      if (pd !== 0) return pd;
      return (b.timestamp || 0) - (a.timestamp || 0);
    });

    // Store the missed emails
    missedEmailsCache = {
      emails,
      backfillTimestamp: new Date().toISOString(),
      fromDate: offlineStart.toISOString(),
      toDate: offlineEnd.toISOString(),
      offlineHours: Math.round((offlineEnd - offlineStart) / (1000 * 60 * 60) * 10) / 10,
      totalCount: emails.length,
      highPriority: emails.filter(e => e.priority === 'high').length,
      mediumPriority: emails.filter(e => e.priority === 'medium').length,
      dismissed: false,
    };
    saveMissedEmails();

    console.log(`[Gmail Backfill] Complete — ${emails.length} emails recovered (${missedEmailsCache.highPriority} high priority, ${missedEmailsCache.mediumPriority} medium)`);

    return { success: true, count: emails.length, highPriority: missedEmailsCache.highPriority };
  } catch (err) {
    console.error('[Gmail Backfill] Error:', err.message);
    return { success: false, reason: err.message };
  }
}

// GET /api/gmail/missed — Get missed emails from the last offline period
app.get('/api/gmail/missed', (req, res) => {
  if (!missedEmailsCache.emails || missedEmailsCache.emails.length === 0 || missedEmailsCache.dismissed) {
    return res.json({ hasMissed: false, emails: [], dismissed: missedEmailsCache.dismissed });
  }
  res.json({
    hasMissed: true,
    emails: missedEmailsCache.emails,
    fromDate: missedEmailsCache.fromDate,
    toDate: missedEmailsCache.toDate,
    offlineHours: missedEmailsCache.offlineHours,
    totalCount: missedEmailsCache.totalCount,
    highPriority: missedEmailsCache.highPriority,
    mediumPriority: missedEmailsCache.mediumPriority,
    backfillTimestamp: missedEmailsCache.backfillTimestamp,
  });
});

// POST /api/gmail/missed/dismiss — Mark missed emails as reviewed / dismiss the banner
app.post('/api/gmail/missed/dismiss', (req, res) => {
  missedEmailsCache.dismissed = true;
  saveMissedEmails();
  res.json({ success: true });
});

// POST /api/gmail/missed/backfill — Manually trigger a backfill (e.g. if auto didn't run)
app.post('/api/gmail/missed/backfill', async (req, res) => {
  if (!tokens) return res.json({ error: 'Gmail not connected', success: false });
  try {
    const result = await triggerMissedEmailBackfill();
    res.json(result);
  } catch (err) {
    res.json({ error: err.message, success: false });
  }
});

// GET /api/gmail/connection-state — Expose connection tracking state for debugging
app.get('/api/gmail/connection-state', (req, res) => {
  res.json({
    ...gmailConnectionState,
    hasMissedEmails: missedEmailsCache.emails?.length > 0 && !missedEmailsCache.dismissed,
    missedCount: missedEmailsCache.totalCount || 0,
  });
});

// ─────────────────────────────────────────────
// FOLLOW UP BOSS INTEGRATION
// ─────────────────────────────────────────────
const FUB_API_KEY = process.env.FUB_API_KEY || '';
const FUB_BASE = 'https://api.followupboss.com/v1';

function fubHeaders() {
  return {
    'Authorization': 'Basic ' + Buffer.from(FUB_API_KEY + ':').toString('base64'),
    'Content-Type': 'application/json',
    'X-System': 'AgentHQ',
    'X-System-Key': 'agenthq-v1',
  };
}

// Stage → bucket mapping (matched to actual FUB stage names)
const STAGE_BUCKET_MAP = {
  'a - hot 1-3 months': 'hot',
  'a - hot': 'hot',
  'a-hot': 'hot',
  'hot': 'hot',
  'b - warm 3-6 months': 'warm',
  'b - warm': 'warm',
  'b-warm': 'warm',
  'warm': 'warm',
  'c - cold 6+ months': 'cold',
  'active client': 'active',
  'active clients': 'active',
  'under contract': 'active',
  'firm': 'active',
  'listing appointment': 'active',
  'active buyer': 'active',
  'active seller': 'active',
  'past client': 'past',
  'past clients': 'past',
  'lead': 'cold',
  'all leads - uncategorized': 'cold',
  'uncategorized': 'cold',
  'sphere': 'sphere',
  'new lead': 'cold',
  'unqualified': 'cold',
  'renter - future buyer': 'warm',
  'real estate agent': 'sphere',
};

function classifyBucket(stage) {
  if (!stage) return 'cold';
  const key = stage.toLowerCase().trim();
  return STAGE_BUCKET_MAP[key] || 'cold';
}

// Scoring algorithm — higher = should be called sooner
function scoreContact(contact) {
  let score = 0;
  const now = Date.now();
  const bucket = classifyBucket(contact.stage);

  // 1) Stage weight — hot/active contacts get priority
  const stageWeights = { hot: 50, active: 45, warm: 30, past: 20, sphere: 15, cold: 10 };
  score += stageWeights[bucket] || 10;

  // 2) Last contact recency — the longer since contact, the higher the urgency
  if (contact.lastActivity) {
    const lastMs = new Date(contact.lastActivity).getTime();
    const daysSince = Math.max(0, (now - lastMs) / (1000 * 60 * 60 * 24));
    // Hot leads neglected for even 2 days = big bump
    // Cold leads need much longer gaps to surface
    if (bucket === 'hot' || bucket === 'active') {
      score += Math.min(daysSince * 5, 40);  // caps at 40 for 8+ days
    } else if (bucket === 'warm') {
      score += Math.min(daysSince * 2, 30);  // caps at 30 for 15+ days
    } else if (bucket === 'past' || bucket === 'sphere') {
      score += Math.min(daysSince * 0.3, 25); // caps at 25 for 83+ days
    } else {
      score += Math.min(daysSince * 0.2, 20); // cold leads cap at 20
    }
  } else {
    // Never contacted — bump up significantly
    score += 35;
  }

  // 3) Creation date — older contacts we've never reached out to get a nudge
  if (contact.created) {
    const createdMs = new Date(contact.created).getTime();
    const ageInDays = (now - createdMs) / (1000 * 60 * 60 * 24);
    if (ageInDays > 180 && bucket === 'cold') {
      score += 5; // aging cold leads get a small bump
    }
  }

  // 4) Has phone number bonus — can't call without one
  if (contact.phones && contact.phones.length > 0) {
    score += 5;
  } else {
    score -= 100; // effectively exclude contacts without phone numbers
  }

  return score;
}

// Format last activity as relative string
function formatLastActivity(dateStr) {
  if (!dateStr) return 'Never';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const days = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) > 1 ? 's' : ''} ago`;
}

// Bucket style config
const BUCKET_STYLES = {
  hot:    { tag: 'Hot Lead',       tagColor: '#ef4444', tagBg: '#fef2f2' },
  warm:   { tag: 'Warm Lead',      tagColor: '#f59e0b', tagBg: '#fffbeb' },
  active: { tag: 'Active Client',  tagColor: '#2563eb', tagBg: '#eff6ff' },
  past:   { tag: 'Past Client',    tagColor: '#8b5cf6', tagBg: '#f5f3ff' },
  sphere: { tag: 'Sphere',         tagColor: '#06b6d4', tagBg: '#ecfeff' },
  cold:   { tag: 'Cold Lead',      tagColor: '#6b7280', tagBg: '#f3f4f6' },
};

// Build the daily call list with zero bias
// Allocation: 3 hot, 3 cold/warm, 2 past/sphere, 2 active = 10 total
function buildCallList(scoredContacts) {
  const buckets = { hot: [], warm: [], active: [], past: [], sphere: [], cold: [] };

  for (const c of scoredContacts) {
    const bucket = classifyBucket(c.stage);
    buckets[bucket].push(c);
  }

  // Sort each bucket by score descending
  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => (b._score || 0) - (a._score || 0));
  }

  const selected = [];
  let idCounter = 1;

  const pick = (pool, count) => {
    const picked = pool.splice(0, count);
    for (const c of picked) {
      const bucket = classifyBucket(c.stage);
      const style = BUCKET_STYLES[bucket] || BUCKET_STYLES.cold;
      const phone = (c.phones && c.phones.length > 0) ? c.phones[0].value : '—';
      selected.push({
        id: idCounter++,
        fubId: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown',
        phone,
        bucket,
        tag: style.tag,
        tagColor: style.tagColor,
        tagBg: style.tagBg,
        lastContact: formatLastActivity(c.lastActivity),
        context: c.lastNote || `Stage: ${c.stage || 'Unknown'}. Score: ${c._score || 0}.`,
        fubStage: c.stage || 'Unknown',
        priority: idCounter - 1,
        score: c._score || 0,
        email: c.emails && c.emails[0] ? c.emails[0].value : null,
        source: 'followupboss',
        live: true,
      });
    }
  };

  // Allocation with zero call bias:
  // 3 from hot (fall back to warm if not enough hot)
  const hotPool = [...buckets.hot];
  pick(hotPool, 3);
  // If we didn't get 3 from hot, fill from warm
  if (selected.length < 3) {
    pick([...buckets.warm], 3 - selected.length);
  }

  // 3 from cold/warm mix
  const coldWarmPool = [...buckets.cold, ...buckets.warm].sort((a, b) => (b._score || 0) - (a._score || 0));
  pick(coldWarmPool, 3);

  // 2 from past/sphere
  const pastSpherePool = [...buckets.past, ...buckets.sphere].sort((a, b) => (b._score || 0) - (a._score || 0));
  pick(pastSpherePool, 2);

  // 2 from active
  pick([...buckets.active], 2);

  // De-duplicate (a contact could appear in multiple picks if bucket classification overlaps)
  const seen = new Set();
  const deduped = [];
  for (const c of selected) {
    if (!seen.has(c.fubId)) {
      seen.add(c.fubId);
      deduped.push(c);
    }
  }

  // Backfill to 10 if we didn't get enough from the target buckets
  if (deduped.length < 10) {
    const allRemaining = scoredContacts
      .filter(c => !seen.has(c.id) && c._score > 0)
      .sort((a, b) => (b._score || 0) - (a._score || 0));
    for (const c of allRemaining) {
      if (deduped.length >= 10) break;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const bucket = classifyBucket(c.stage);
      const style = BUCKET_STYLES[bucket] || BUCKET_STYLES.cold;
      const phone = (c.phones && c.phones.length > 0) ? c.phones[0].value : '—';
      deduped.push({
        id: deduped.length + 1,
        fubId: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown',
        phone,
        bucket,
        tag: style.tag,
        tagColor: style.tagColor,
        tagBg: style.tagBg,
        lastContact: formatLastActivity(c.lastActivity),
        context: `Stage: ${c.stage || 'Unknown'}. Score: ${c._score || 0}.`,
        fubStage: c.stage || 'Unknown',
        priority: deduped.length + 1,
        score: c._score || 0,
        email: c.emails && c.emails[0] ? c.emails[0].value : null,
        source: 'followupboss',
        live: true,
      });
    }
  }

  return deduped;
}

// Cache the call list so we don't hammer FUB API on every page load
let callListCache = { list: null, generatedAt: null, dateKey: null };

// GET /api/fub/status — check connection
app.get('/api/fub/status', (req, res) => {
  res.json({
    connected: !!FUB_API_KEY,
    configured: FUB_API_KEY.length > 0,
    cacheDate: callListCache.dateKey,
  });
});

// GET /api/fub/calllist — the daily scored call list
app.get('/api/fub/calllist', async (req, res) => {
  if (!FUB_API_KEY) {
    return res.json({ error: 'FUB_API_KEY not configured', callList: [], connected: false });
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  const forceRefresh = req.query.refresh === 'true';

  // Return cache if it's from today and not forced
  if (!forceRefresh && callListCache.list && callListCache.dateKey === todayKey) {
    return res.json({ callList: callListCache.list, cached: true, generatedAt: callListCache.generatedAt, connected: true });
  }

  try {
    // Fetch contacts from all relevant stages
    // FUB API uses stage name filter
    const stages = ['Active Client', 'A - Hot 1-3 Months', 'B - Warm 3-6 Months', 'C - Cold 6+ Months', 'Past Client', 'Lead', 'Sphere', 'Firm'];
    let allContacts = [];

    for (const stage of stages) {
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const url = `${FUB_BASE}/people?stage=${encodeURIComponent(stage)}&limit=100&offset=${offset}&sort=lastActivity&order=desc`;
        const resp = await fetch(url, { headers: fubHeaders() });

        if (!resp.ok) {
          console.error(`[FUB] Error fetching stage "${stage}": ${resp.status} ${resp.statusText}`);
          break;
        }

        const data = await resp.json();
        const people = data.people || [];
        allContacts.push(...people);

        // Check if there are more pages
        if (people.length < 100) {
          hasMore = false;
        } else {
          offset += 100;
          // Safety: cap at 500 per stage to avoid runaway
          if (offset >= 500) hasMore = false;
        }
      }
    }

    console.log(`[FUB] Fetched ${allContacts.length} total contacts across ${stages.length} stages`);

    // Score every contact
    for (const c of allContacts) {
      c._score = scoreContact(c);
    }

    // Also fetch recent notes for top candidates to add context
    // (We'll do this for the final selected list to save API calls)
    const callList = buildCallList(allContacts);

    // Try to fetch last note for each selected contact
    for (const item of callList) {
      try {
        const noteResp = await fetch(`${FUB_BASE}/notes?personId=${item.fubId}&limit=1&sort=created&order=desc`, {
          headers: fubHeaders(),
        });
        if (noteResp.ok) {
          const noteData = await noteResp.json();
          const notes = noteData.notes || [];
          if (notes.length > 0 && notes[0].body) {
            // Clean HTML from note body
            const cleanNote = notes[0].body.replace(/<[^>]*>/g, '').trim();
            if (cleanNote.length > 0) {
              item.context = cleanNote.length > 120 ? cleanNote.slice(0, 117) + '...' : cleanNote;
            }
          }
        }
      } catch (e) {
        // Notes are bonus context — don't fail if they error
      }
    }

    // Cache it
    callListCache = {
      list: callList,
      generatedAt: new Date().toISOString(),
      dateKey: todayKey,
    };

    res.json({ callList, cached: false, generatedAt: callListCache.generatedAt, connected: true, totalContacts: allContacts.length });
  } catch (err) {
    console.error('[FUB] Call list error:', err);
    res.json({ error: err.message, callList: callListCache.list || [], connected: true });
  }
});

// GET /api/fub/stages — list all stages in FUB for reference
app.get('/api/fub/stages', async (req, res) => {
  if (!FUB_API_KEY) return res.json({ error: 'FUB_API_KEY not configured' });
  try {
    const resp = await fetch(`${FUB_BASE}/stages`, { headers: fubHeaders() });
    if (!resp.ok) return res.json({ error: `FUB returned ${resp.status}` });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// GET /api/fub/people/:id — get single contact detail
app.get('/api/fub/people/:id', async (req, res) => {
  if (!FUB_API_KEY) return res.json({ error: 'FUB_API_KEY not configured' });
  try {
    const resp = await fetch(`${FUB_BASE}/people/${req.params.id}`, { headers: fubHeaders() });
    if (!resp.ok) return res.json({ error: `FUB returned ${resp.status}` });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// FUB LEAD AUTO-IMPORT FROM GMAIL
// ─────────────────────────────────────────────

// Parse "Lead assigned" email — extract name, phone, email, source
function parseLeadAssignedEmail(subject, body) {
  const result = { name: null, firstName: null, lastName: null, phone: null, email: null, source: null };

  // Name from subject: "Lead assigned – Dennis McMaster" or "Lead assigned - Dennis McMaster"
  const subjMatch = subject.match(/Lead assigned\s*[–\-]\s*(.+)/i);
  if (subjMatch) {
    result.name = subjMatch[1].trim();
    const parts = result.name.split(/\s+/);
    result.firstName = parts[0] || '';
    result.lastName = parts.slice(1).join(' ') || '';
  }

  // Also try "You've received a new lead named X from Y"
  const bodyNameMatch = body.match(/new lead named\s+([A-Za-z\s'-]+?)\s+from/i);
  if (bodyNameMatch && !result.name) {
    result.name = bodyNameMatch[1].trim();
    const parts = result.name.split(/\s+/);
    result.firstName = parts[0] || '';
    result.lastName = parts.slice(1).join(' ') || '';
  }

  // Source from body: "from SP: Networking" or "from Team: Brokerage Call-In"
  const sourceMatch = body.match(/from\s+((?:SP|Team|Source|Lead Source)[:\s]+[^\n<]+)/i);
  if (sourceMatch) result.source = sourceMatch[1].trim();

  // Phone: look for phone number patterns
  const phoneMatch = body.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  if (phoneMatch) result.phone = phoneMatch[0];

  // Email: look for email in body (not the FUB system emails)
  const emailMatches = body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (emailMatches) {
    // Filter out FUB system emails
    const filtered = emailMatches.filter(e =>
      !e.includes('followupboss.com') && !e.includes('faristeam.ca') && !e.includes('noreply')
    );
    if (filtered.length > 0) result.email = filtered[0];
  }

  return result;
}

// Parse "mentioned you in a note" email — extract the note content and contact details
function parseNoteEmail(subject, body) {
  const result = { contactName: null, noteSender: null, noteBody: '', emails: [], phone: null };

  // Contact name from subject: "Aidan Hurban mentioned you in a note about Dennis McMaster"
  const nameMatch = subject.match(/note about\s+(.+)/i);
  if (nameMatch) result.contactName = nameMatch[1].trim();

  // Note sender from subject
  const senderMatch = subject.match(/^(.+?)\s+mentioned you/i);
  if (senderMatch) result.noteSender = senderMatch[1].trim();

  // Extract note body — everything between "— Note —" and "Click here to open"
  const noteStart = body.indexOf('— Note —');
  const noteAlt = body.indexOf('-- Note --');
  const start = noteStart !== -1 ? noteStart + 8 : (noteAlt !== -1 ? noteAlt + 10 : -1);
  const clickEnd = body.indexOf('Click here to open');
  const contactEnd = body.indexOf('Contact details');

  if (start !== -1) {
    const end = contactEnd !== -1 ? contactEnd : (clickEnd !== -1 ? clickEnd : body.length);
    result.noteBody = body.slice(start, end)
      .replace(/<[^>]*>/g, '')
      .replace(/\r\n/g, '\n')
      .trim();
  } else {
    // Fallback: try to get the main body content
    result.noteBody = body
      .replace(/<[^>]*>/g, '')
      .replace(/Change your notification settings.*/s, '')
      .replace(/Click here to open.*/s, '')
      .trim();
  }

  // Extract contact details section
  const detailsMatch = body.match(/Contact details[:\s]*([\s\S]*?)(?:Change your|$)/i);
  if (detailsMatch) {
    const details = detailsMatch[1];
    // All emails
    const emailMatches = details.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emailMatches) result.emails = emailMatches.filter(e => !e.includes('followupboss') && !e.includes('faristeam'));
    // Phone
    const phoneMatch = details.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    if (phoneMatch) result.phone = phoneMatch[0];
    // Name from details
    const detailNameMatch = details.match(/Name:\s*(.+)/i);
    if (detailNameMatch && !result.contactName) result.contactName = detailNameMatch[1].trim();
  }

  return result;
}

// GET /api/fub/leads/scan — Scan Gmail for new FUB lead emails and auto-import
app.get('/api/fub/leads/scan', async (req, res) => {
  if (!FUB_API_KEY) return res.json({ error: 'FUB_API_KEY not configured', success: false });
  if (!tokens) return res.json({ error: 'Gmail not connected', success: false });

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const results = { leadsCreated: [], notesAdded: [], errors: [], scanned: 0 };

    // Load already-processed email IDs from file (or memory)
    let processedIds = [];
    const processedPath = path.join(__dirname, '.fub-processed-leads.json');
    try {
      if (fs.existsSync(processedPath)) {
        processedIds = JSON.parse(fs.readFileSync(processedPath, 'utf8'));
      }
    } catch {}

    // 1) Scan for "Lead assigned" emails from Follow Up Boss (last 7 days)
    const leadQuery = 'from:leads@followupboss.com subject:"Lead assigned" newer_than:7d';
    const leadMsgs = await gmail.users.messages.list({ userId: 'me', q: leadQuery, maxResults: 20 });
    const leadMessages = leadMsgs.data.messages || [];

    for (const msg of leadMessages) {
      if (processedIds.includes(msg.id)) continue;
      results.scanned++;

      try {
        const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
        const headers = full.data.payload.headers;
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
        const body = getEmailBody(full.data.payload);

        const lead = parseLeadAssignedEmail(subject, body);
        if (!lead.name) {
          results.errors.push({ emailId: msg.id, error: 'Could not parse lead name', subject });
          continue;
        }

        // Check if contact already exists in FUB by name or email
        let existingId = null;
        if (lead.email) {
          try {
            const searchResp = await fetch(`${FUB_BASE}/people?email=${encodeURIComponent(lead.email)}&limit=1`, { headers: fubHeaders() });
            if (searchResp.ok) {
              const searchData = await searchResp.json();
              if (searchData.people && searchData.people.length > 0) {
                existingId = searchData.people[0].id;
              }
            }
          } catch {}
        }

        if (existingId) {
          // Contact already exists — just mark as processed
          processedIds.push(msg.id);
          results.leadsCreated.push({ name: lead.name, fubId: existingId, status: 'already_exists', emailId: msg.id });
          continue;
        }

        // Create new contact in FUB
        const newPerson = {
          firstName: lead.firstName,
          lastName: lead.lastName,
          stage: 'Lead',
          source: lead.source || 'Email Lead',
          phones: lead.phone ? [{ value: lead.phone, type: 'Mobile' }] : [],
          emails: lead.email ? [{ value: lead.email }] : [],
          tags: ['Agent HQ Import'],
        };

        const createResp = await fetch(`${FUB_BASE}/people`, {
          method: 'POST',
          headers: fubHeaders(),
          body: JSON.stringify(newPerson),
        });

        if (createResp.ok) {
          const created = await createResp.json();
          processedIds.push(msg.id);
          results.leadsCreated.push({
            name: lead.name,
            fubId: created.id,
            phone: lead.phone,
            email: lead.email,
            source: lead.source,
            status: 'created',
            emailId: msg.id,
          });
          console.log(`[FUB] Created lead: ${lead.name} (ID: ${created.id})`);
        } else {
          const errText = await createResp.text();
          results.errors.push({ name: lead.name, error: `Create failed: ${createResp.status} — ${errText}`, emailId: msg.id });
        }
      } catch (err) {
        results.errors.push({ emailId: msg.id, error: err.message });
      }
    }

    // 2) Scan for "mentioned you in a note about" emails (follow-up notes)
    const noteQuery = 'from:notifications@followupboss.com subject:"mentioned you in a note" newer_than:7d';
    const noteMsgs = await gmail.users.messages.list({ userId: 'me', q: noteQuery, maxResults: 20 });
    const noteMessages = noteMsgs.data.messages || [];

    for (const msg of noteMessages) {
      if (processedIds.includes(msg.id)) continue;
      results.scanned++;

      try {
        const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
        const headers = full.data.payload.headers;
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
        const body = getEmailBody(full.data.payload);

        const noteData = parseNoteEmail(subject, body);
        if (!noteData.contactName || !noteData.noteBody) {
          results.errors.push({ emailId: msg.id, error: 'Could not parse note', subject });
          continue;
        }

        // Find the contact in FUB by name
        let personId = null;
        const nameParts = noteData.contactName.split(/\s+/);
        const searchName = encodeURIComponent(noteData.contactName);
        try {
          const searchResp = await fetch(`${FUB_BASE}/people?name=${searchName}&limit=5`, { headers: fubHeaders() });
          if (searchResp.ok) {
            const searchData = await searchResp.json();
            if (searchData.people && searchData.people.length > 0) {
              // Find best match
              personId = searchData.people[0].id;
            }
          }
        } catch {}

        // If no match by name, try by email from the note's contact details
        if (!personId && noteData.emails.length > 0) {
          for (const em of noteData.emails) {
            try {
              const resp = await fetch(`${FUB_BASE}/people?email=${encodeURIComponent(em)}&limit=1`, { headers: fubHeaders() });
              if (resp.ok) {
                const data = await resp.json();
                if (data.people && data.people.length > 0) {
                  personId = data.people[0].id;
                  break;
                }
              }
            } catch {}
          }
        }

        if (!personId) {
          results.errors.push({ contactName: noteData.contactName, error: 'Contact not found in FUB', emailId: msg.id });
          continue;
        }

        // Add the note to the contact
        const noteHtml = `<p><strong>Note from ${noteData.noteSender || 'Team'}:</strong></p>` +
          noteData.noteBody.split('\n').filter(l => l.trim()).map(l => `<p>${l}</p>`).join('') +
          (noteData.emails.length > 1 ? `<p><em>Additional emails: ${noteData.emails.join(', ')}</em></p>` : '');

        const noteResp = await fetch(`${FUB_BASE}/notes`, {
          method: 'POST',
          headers: fubHeaders(),
          body: JSON.stringify({
            personId,
            body: noteHtml,
            subject: `Note from ${noteData.noteSender || 'Team'} — imported by Agent HQ`,
            isHtml: true,
          }),
        });

        if (noteResp.ok) {
          processedIds.push(msg.id);
          results.notesAdded.push({
            contactName: noteData.contactName,
            personId,
            noteSender: noteData.noteSender,
            notePreview: noteData.noteBody.slice(0, 100) + (noteData.noteBody.length > 100 ? '...' : ''),
            status: 'added',
            emailId: msg.id,
          });
          console.log(`[FUB] Note added for ${noteData.contactName} (ID: ${personId})`);
        } else {
          const errText = await noteResp.text();
          results.errors.push({ contactName: noteData.contactName, error: `Note failed: ${noteResp.status} — ${errText}`, emailId: msg.id });
        }
      } catch (err) {
        results.errors.push({ emailId: msg.id, error: err.message });
      }
    }

    // Save processed IDs (keep last 200 to avoid file growing forever)
    try {
      fs.writeFileSync(processedPath, JSON.stringify(processedIds.slice(-200)));
    } catch {}

    // Also persist to localStorage-compatible backup endpoint
    res.json({
      success: true,
      ...results,
      summary: `${results.leadsCreated.filter(l => l.status === 'created').length} leads created, ${results.notesAdded.length} notes added, ${results.errors.length} errors`,
    });
  } catch (err) {
    console.error('[FUB] Lead scan error:', err);
    res.json({ error: err.message, success: false });
  }
});

// GET /api/fub/leads/processed — check what's already been imported
app.get('/api/fub/leads/processed', (req, res) => {
  const processedPath = path.join(__dirname, '.fub-processed-leads.json');
  try {
    if (fs.existsSync(processedPath)) {
      const ids = JSON.parse(fs.readFileSync(processedPath, 'utf8'));
      return res.json({ count: ids.length, ids });
    }
  } catch {}
  res.json({ count: 0, ids: [] });
});

// ─────────────────────────────────────────────
// TEAM JORDAN BATCH IMPORT — 38K emails → FUB
// ─────────────────────────────────────────────

const TJ_STATE_PATH = path.join(__dirname, '.tj-import-state.json');
const TJ_BATCH_SIZE = 1000;

// Load/save import state
function loadTjState() {
  try {
    if (fs.existsSync(TJ_STATE_PATH)) return JSON.parse(fs.readFileSync(TJ_STATE_PATH, 'utf8'));
  } catch {}
  return {
    status: 'idle', // idle | ready | processing | paused | complete
    labelId: null,
    labelName: null,
    totalMessages: 0,
    messageIds: [],       // legacy — no longer pre-scanned
    nextPageToken: null,  // Gmail pagination token for next batch
    processedCount: 0,
    currentBatch: 0,
    leadsCreated: 0,
    realtorsCreated: 0,
    lawyersCreated: 0,
    leadsSkippedExisting: 0,
    notesAdded: 0,
    emailsSkipped: 0,
    errors: [],
    lastProcessedAt: null,
    stageId: null,        // FUB stage ID for "Old Team Jordan Leads"
    processedEmailIds: {}, // email ID → result ('created'|'existing'|'skipped'|'error')
    knownContactKeys: [], // all emails, phones, and normalized names from processed contacts — for cross-batch dedup
    recentActivity: [],   // last 20 actions for the dashboard
  };
}

function saveTjState(state) {
  try { fs.writeFileSync(TJ_STATE_PATH, JSON.stringify(state)); } catch (e) { console.error('[TJ] Save state error:', e); }
}

// Parse any email for lead-like contact info
function parseEmailForContact(headers, body) {
  const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
  const to = headers.find(h => h.name.toLowerCase() === 'to')?.value || '';
  const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
  const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';

  const result = {
    fromName: null, fromEmail: null,
    toName: null, toEmail: null,
    subject, date,
    phones: [],
    emails: [],
    names: [],
    yspAmount: null,
    closingDate: null,
    propertyAddress: null,
    mlsNumber: null,
    dealValue: null,
    noteWorthy: [],
  };

  // Parse From
  const fromMatch = from.match(/^"?([^"<]+)"?\s*<?([^>]+@[^>]+)>?/);
  if (fromMatch) {
    result.fromName = fromMatch[1].trim().replace(/"/g, '');
    result.fromEmail = fromMatch[2].trim();
  } else {
    const emailOnly = from.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailOnly) result.fromEmail = emailOnly[1];
  }

  // Parse To
  const toMatch = to.match(/^"?([^"<]+)"?\s*<?([^>]+@[^>]+)>?/);
  if (toMatch) {
    result.toName = toMatch[1].trim().replace(/"/g, '');
    result.toEmail = toMatch[2].trim();
  }

  // Extract all emails from body
  const bodyEmails = body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  const systemEmails = ['followupboss.com', 'faristeam.ca', 'teamjordan.ca', 'noreply', 'mailer-daemon', 'postmaster', 'google.com', 'googleapis.com'];
  result.emails = [...new Set(bodyEmails)].filter(e => !systemEmails.some(s => e.toLowerCase().includes(s)));

  // Add from/to emails
  if (result.fromEmail && !systemEmails.some(s => result.fromEmail.toLowerCase().includes(s))) {
    result.emails = [result.fromEmail, ...result.emails.filter(e => e !== result.fromEmail)];
  }

  // Extract phone numbers (filter out owner's number)
  const ownerPhones = ['7054332525'];
  const phones = (body.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || [])
    .filter(p => !ownerPhones.includes(p.replace(/\D/g, '')));
  result.phones = [...new Set(phones)];

  // YSP amount
  const yspMatch = body.match(/YSP[:\s]*\$?([\d,]+\.?\d*)/i) || body.match(/yield spread[:\s]*\$?([\d,]+\.?\d*)/i);
  if (yspMatch) result.yspAmount = yspMatch[1].replace(/,/g, '');

  // Closing date
  const closingMatch = body.match(/clos(?:ing|e)\s*date[:\s]*([A-Za-z]+\s+\d{1,2},?\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (closingMatch) result.closingDate = closingMatch[1].trim();

  // Property address patterns
  const addrMatch = body.match(/(?:property|address|listing|home|house)[:\s]*(\d+\s+[A-Za-z\s]+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Cres|Crescent|Blvd|Boulevard|Lane|Ln|Way|Court|Ct|Place|Pl|Trail|Tr)[.,]?\s*[A-Za-z\s]*)/i);
  if (addrMatch) result.propertyAddress = addrMatch[1].trim().slice(0, 100);

  // MLS number
  const mlsMatch = body.match(/MLS[#:\s]*([A-Z0-9]{6,12})/i);
  if (mlsMatch) result.mlsNumber = mlsMatch[1];

  // Deal value / purchase price / sale price
  const priceMatch = body.match(/(?:purchase|sale|list|asking)\s*price[:\s]*\$?([\d,]+)/i) || body.match(/\$([\d,]{6,})/);
  if (priceMatch) result.dealValue = priceMatch[1].replace(/,/g, '');

  // Names (look for "Client:", "Buyer:", "Seller:", etc.)
  const namePatterns = [
    /(?:client|buyer|seller|purchaser|vendor)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/g,
    /(?:Dear|Hi|Hello)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
  ];
  for (const pat of namePatterns) {
    let m;
    while ((m = pat.exec(body)) !== null) {
      const name = m[1].trim();
      if (name.length > 2 && name.length < 50 && !result.names.includes(name)) {
        result.names.push(name);
      }
    }
  }

  // Detect if this is a lawyer
  result.isLawyer = false;
  result.lawFirm = null;
  result.workAddress = null;
  const lawyerKeywords = /\b(lawyer|attorney|barrister|solicitor|counsel|law\s+(?:firm|office|offices|clerk|corporation)|legal\s+(?:counsel|services|assistant)|LLB|J\.?D\.?|LL\.?M\.?|notary\s+public|paralegal)\b/i;
  const lawFirmPatterns = /\b(law\s+(?:firm|office|offices|corporation|professional\s+corporation)|LLP|barristers?\s+(?:and|&)\s+solicitors?|professional\s+corporation|legal\s+services)\b/i;
  if (lawyerKeywords.test(body) || lawyerKeywords.test(subject)) {
    result.isLawyer = true;
    // Try to extract law firm name
    const firmMatch = body.match(/(?:firm|office|law\s+offices?\s+of)[:\s]*([^\n<]{5,80})/i);
    if (firmMatch) result.lawFirm = firmMatch[1].trim().replace(/[|,].*$/, '').trim();
    if (!result.lawFirm) {
      const llpMatch = body.match(/([A-Z][A-Za-z&,.\s]+(?:LLP|Law|Legal|Barristers|Professional Corporation))/);
      if (llpMatch) result.lawFirm = llpMatch[1].trim();
    }
  }
  // Also flag if from address contains law-related domains
  if (result.fromEmail && /law|legal|barrister|solicitor|counsel/i.test(result.fromEmail)) {
    result.isLawyer = true;
  }

  // Extract work/office address from signature (used for lawyers)
  const workAddrMatch = body.match(/(\d+[\s\w]*(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Highway|Hwy|Suite|Ste|Unit|Floor)[.,]?\s*(?:#?\s*\d+[.,]?\s*)?[A-Za-z\s]*(?:,\s*(?:ON|Ontario))?(?:[,\s]*[A-Z]\d[A-Z]\s*\d[A-Z]\d)?)/i);
  if (workAddrMatch) result.workAddress = workAddrMatch[1].trim().slice(0, 150);

  // Detect if this is a realtor/agent
  result.isRealtor = false;
  result.brokerage = null;
  result.isShowingRequest = false;
  result.isBrokerBuyRequest = false;
  const realtorKeywords = /\b(realtor|real estate agent|sales representative|broker|salesperson|realty|brokerage|keller williams|re\/max|remax|royal lepage|century 21|coldwell banker|sutton|right at home|homelife|exp realty|real broker|ipro realty|chestnut park|sotheby|faris team|lpt realty|harvey kalles|bosley|forest hill|engel|volkers|homeward|mcgee|justo|sage|peerage|spring|fair square|peak|macdonald)\b/i;
  const brokerageMatch = body.match(/(?:brokerage|office|company)[:\s]*([^\n<]{5,60})/i);
  if (brokerageMatch) result.brokerage = brokerageMatch[1].trim();

  // Detect showing requests — strongest realtor signal
  const showingPatterns = /\b(showing request|request(?:ing|ed)?\s+(?:a\s+)?showing|schedule\s+(?:a\s+)?showing|book\s+(?:a\s+)?showing|showing\s+confirmation|showing\s+time|showing\s+appointment|would like to (?:view|show)|buyer.*(?:wants?|would like)\s+to\s+(?:see|view|visit))\b/i;
  if (showingPatterns.test(body) || showingPatterns.test(subject)) {
    result.isShowingRequest = true;
    result.isRealtor = true;
  }

  // Detect broker buy requests — also strong realtor signal
  const brokerBuyPatterns = /\b(broker(?:age)?\s+buy\s+request|buyer\s+agent|buying\s+agent|cooperating\s+(?:agent|broker(?:age)?)|buyer(?:'s|s)?\s+(?:rep|representative|agent)|co-op(?:erating)?\s+commission|buyer\s+(?:side|end)\s+(?:commission|fee)|BCS|co-op\s+%|commission\s+offered)\b/i;
  if (brokerBuyPatterns.test(body) || brokerBuyPatterns.test(subject)) {
    result.isBrokerBuyRequest = true;
    result.isRealtor = true;
  }

  // Extract agent cell phone from showing requests / broker buy requests (often listed inline)
  if (result.isShowingRequest || result.isBrokerBuyRequest) {
    // Look for "Cell:" or "Mobile:" or "Phone:" patterns near the agent info
    const cellMatch = body.match(/(?:cell|mobile|direct|phone)[:\s]*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/i);
    if (cellMatch) {
      const cellNum = cellMatch[0].match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
      if (cellNum && !result.phones.includes(cellNum[0])) {
        result.phones.unshift(cellNum[0]); // put cell first
      }
    }
  }

  // Check email signature area and subject for realtor indicators
  if (realtorKeywords.test(body) || realtorKeywords.test(subject)) {
    result.isRealtor = true;
    // Try to extract brokerage name more aggressively
    if (!result.brokerage) {
      const brokerNames = body.match(/(Keller Williams[^,\n<]*|RE\/MAX[^,\n<]*|Royal LePage[^,\n<]*|Century 21[^,\n<]*|Coldwell Banker[^,\n<]*|Sutton[^,\n<]*|Right At Home[^,\n<]*|HomeLife[^,\n<]*|eXp Realty[^,\n<]*|Real Broker[^,\n<]*|iPro Realty[^,\n<]*|Chestnut Park[^,\n<]*|Sotheby[^,\n<]*|LPT Realty[^,\n<]*|Harvey Kalles[^,\n<]*|Bosley[^,\n<]*|Forest Hill[^,\n<]*|Engel[^,\n<]*|Sage[^,\n<]*|Peak[^,\n<]*|MacDonald[^,\n<]*)/i);
      if (brokerNames) result.brokerage = brokerNames[1].trim();
    }
  }
  // Also flag if from address contains realty-like domains
  if (result.fromEmail && /realty|realestate|realtor|remax|royallepage|century21|coldwell|sutton|kw\.com|kwrealty|chestnutpark|sotheby|harveykalles|bosley|foresthillre/i.test(result.fromEmail)) {
    result.isRealtor = true;
  }

  // Build noteworthy items
  if (result.yspAmount) result.noteWorthy.push(`YSP: $${result.yspAmount}`);
  if (result.closingDate) result.noteWorthy.push(`Closing: ${result.closingDate}`);
  if (result.propertyAddress) result.noteWorthy.push(`Property: ${result.propertyAddress}`);
  if (result.mlsNumber) result.noteWorthy.push(`MLS#: ${result.mlsNumber}`);
  if (result.dealValue) result.noteWorthy.push(`Deal Value: $${result.dealValue}`);
  if (result.brokerage) result.noteWorthy.push(`Brokerage: ${result.brokerage}`);

  return result;
}

// Check if an email/name already exists in FUB, return the person if found
async function findPersonInFub(email, name) {
  // Try email first (most reliable)
  if (email) {
    try {
      const resp = await fetch(`${FUB_BASE}/people?email=${encodeURIComponent(email)}&limit=1`, { headers: fubHeaders() });
      if (resp.ok) {
        const data = await resp.json();
        if (data.people && data.people.length > 0) return data.people[0];
      }
    } catch {}
  }
  // Try name search as fallback
  if (name && name.includes(' ')) {
    try {
      const resp = await fetch(`${FUB_BASE}/people?name=${encodeURIComponent(name)}&limit=3`, { headers: fubHeaders() });
      if (resp.ok) {
        const data = await resp.json();
        if (data.people && data.people.length > 0) {
          // Exact name match only
          const exact = data.people.find(p =>
            `${p.firstName} ${p.lastName}`.toLowerCase() === name.toLowerCase()
          );
          if (exact) return exact;
        }
      }
    } catch {}
  }
  return null;
}

// STEP 1: GET /api/tj/setup — Create the stage + find the label (fast, no scanning)
app.get('/api/tj/setup', async (req, res) => {
  if (!FUB_API_KEY) return res.json({ error: 'FUB_API_KEY not configured' });
  if (!tokens) return res.json({ error: 'Gmail not connected' });

  const state = loadTjState();
  const results = { stageCreated: false, labelFound: false };

  // If already set up, just return current state
  if (state.labelId && state.status !== 'idle') {
    results.labelFound = true;
    return res.json({ success: true, ready: true, state: { ...state, messageIds: undefined, processedEmailIds: undefined }, ...results });
  }

  // 1) Create "Old Team Jordan Leads" stage in FUB if needed
  if (!state.stageId) {
    try {
      const stagesResp = await fetch(`${FUB_BASE}/stages?limit=50`, { headers: fubHeaders() });
      if (stagesResp.ok) {
        const stagesData = await stagesResp.json();
        const existing = (stagesData.stages || []).find(s => s.name.toLowerCase().includes('old team jordan'));
        if (existing) {
          state.stageId = existing.id;
          console.log(`[TJ] Found existing stage: ${existing.name} (ID: ${existing.id})`);
        }
      }

      if (!state.stageId) {
        const createResp = await fetch(`${FUB_BASE}/stages`, {
          method: 'POST',
          headers: fubHeaders(),
          body: JSON.stringify({ name: 'Old Team Jordan Leads', description: 'Legacy leads imported from jonathan@teamjordan.ca email archive' }),
        });
        if (createResp.ok) {
          const created = await createResp.json();
          state.stageId = created.id;
          results.stageCreated = true;
          console.log(`[TJ] Created stage: Old Team Jordan Leads (ID: ${created.id})`);
        } else {
          const errText = await createResp.text();
          console.error(`[TJ] Stage create failed: ${errText}`);
          results.stageError = errText;
        }
      }
    } catch (err) {
      console.error('[TJ] Stage setup error:', err);
    }
  }

  // 2) Find the Gmail label
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    let labelsResp;
    try {
      labelsResp = await gmail.users.labels.list({ userId: 'me' });
    } catch (labelErr) {
      console.error('[TJ] Gmail labels API error:', labelErr.message, labelErr.code, labelErr.errors);
      // If we get a 403/401, the token likely doesn't have Gmail scope
      if (labelErr.code === 403 || labelErr.code === 401) {
        return res.json({
          error: `Gmail access denied (${labelErr.code}). Your Google token needs re-authorization with Gmail permissions. Go to Calendar section → Disconnect → Reconnect Google to fix this.`,
          needsReauth: true,
        });
      }
      return res.json({ error: `Gmail API error: ${labelErr.message}` });
    }
    const labels = labelsResp.data.labels || [];

    // Log all labels for debugging
    console.log(`[TJ] All Gmail labels (${labels.length}):`, labels.map(l => l.name).join(' | '));

    // Broad matching — the label could be named differently than expected
    const targetLabel = labels.find(l =>
      l.name.includes('jonathan@teamjordan.ca') && l.name.toLowerCase().includes('all mail')
    ) || labels.find(l =>
      l.name.toLowerCase().includes('teamjordan') && l.name.toLowerCase().includes('all mail')
    ) || labels.find(l =>
      l.name.includes('jonathan@teamjordan.ca')
    ) || labels.find(l =>
      l.name.toLowerCase().includes('teamjordan')
    ) || labels.find(l =>
      l.name.toLowerCase().includes('team jordan')
    );

    if (targetLabel) {
      state.labelId = targetLabel.id;
      state.labelName = targetLabel.name;
      state.status = 'ready';
      results.labelFound = true;
      results.labelName = targetLabel.name;
      console.log(`[TJ] Found label: ${targetLabel.name} (ID: ${targetLabel.id})`);
    } else {
      results.labelFound = false;
      // Return ALL labels so we can debug
      results.availableLabels = labels.map(l => l.name).filter(n => !n.startsWith('CATEGORY_') && n !== 'CHAT' && n !== 'SPAM' && n !== 'TRASH' && n !== 'DRAFT' && n !== 'SENT' && n !== 'INBOX' && n !== 'STARRED' && n !== 'UNREAD' && n !== 'IMPORTANT');
    }
  } catch (err) {
    console.error('[TJ] Gmail label scan error:', err);
    results.gmailError = err.message;
  }

  saveTjState(state);
  res.json({ success: true, ready: !!state.labelId, state: { ...state, messageIds: undefined, processedEmailIds: undefined }, ...results });
});

// STEP 2: POST /api/tj/scan — Fetch next batch from Gmail, parse & categorize, return candidates for review
app.post('/api/tj/scan', async (req, res) => {
  if (!FUB_API_KEY || !tokens) return res.json({ error: 'Not configured' });

  const state = loadTjState();
  if (!state.labelId) {
    return res.json({ error: 'Run setup first — no Gmail label found.', success: false });
  }

  state.status = 'scanning';
  saveTjState(state);

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // 1) Fetch message IDs from Gmail — paginate up to TJ_BATCH_SIZE (Gmail caps at 500 per request)
  let batchIds = [];
  let hasMore = false;
  let pageToken = state.nextPageToken || null;

  try {
    while (batchIds.length < TJ_BATCH_SIZE) {
      const listParams = { userId: 'me', labelIds: [state.labelId], maxResults: Math.min(500, TJ_BATCH_SIZE - batchIds.length) };
      if (pageToken) listParams.pageToken = pageToken;
      const listResp = await gmail.users.messages.list(listParams);
      const ids = (listResp.data.messages || []).map(m => m.id);
      batchIds = batchIds.concat(ids);
      pageToken = listResp.data.nextPageToken || null;
      if (listResp.data.resultSizeEstimate && state.totalMessages === 0) {
        state.totalMessages = listResp.data.resultSizeEstimate;
      }
      if (!pageToken || ids.length === 0) break; // no more pages
    }
    state.nextPageToken = pageToken;
    hasMore = !!pageToken;
    console.log(`[TJ] Scan batch ${state.currentBatch + 1}: fetched ${batchIds.length} message IDs (hasMore: ${hasMore})`);
  } catch (err) {
    console.error('[TJ] Gmail list error:', err.message);
    state.status = 'paused';
    saveTjState(state);
    return res.json({ error: `Gmail error: ${err.message}`, success: false });
  }

  if (batchIds.length === 0) {
    state.status = 'complete';
    saveTjState(state);
    return res.json({ success: true, candidates: [], skipped: [], complete: true, hasMore: false, progress: buildTjProgress(state) });
  }

  // 2) Parse each email and categorize
  const candidates = []; // contacts ready for approval
  const skipped = [];    // auto-filtered out (with reason)
  const knownKeys = new Set(); // deduplicate by email, phone, and normalized name
  // Seed with all keys from previously processed contacts
  for (const key of (state.knownContactKeys || state.approvedContacts || [])) { knownKeys.add(key); }

  // Helper: normalize a name for fuzzy matching (lowercase, remove middle initials, trim)
  const normalizeName = (first, last) => {
    if (!first || !last) return null;
    return `${first.toLowerCase().trim()} ${last.toLowerCase().trim()}`.replace(/\s+/g, ' ');
  };

  // Helper: check if any key from a contact matches known keys
  const isKnownContact = (emails, phones, firstName, lastName) => {
    for (const e of emails) { if (e && knownKeys.has(e.toLowerCase())) return 'email'; }
    for (const p of phones) { if (p && knownKeys.has(p.replace(/\D/g, ''))) return 'phone'; }
    const nameKey = normalizeName(firstName, lastName);
    if (nameKey && knownKeys.has(nameKey)) return 'name';
    return false;
  };

  // Helper: add all keys from a contact to the known set
  const trackContact = (emails, phones, firstName, lastName) => {
    for (const e of emails) { if (e) knownKeys.add(e.toLowerCase()); }
    for (const p of phones) { if (p) knownKeys.add(p.replace(/\D/g, '')); }
    const nameKey = normalizeName(firstName, lastName);
    if (nameKey) knownKeys.add(nameKey);
  };

  let scannedCount = 0;
  const scanStartTime = Date.now();
  const SCAN_TIMEOUT_MS = 4 * 60 * 1000; // 4 minute safety limit — return what we have before Railway kills the request
  let timedOut = false;

  for (const msgId of batchIds) {
    // Safety: if we're approaching timeout, stop scanning and return what we have
    if (Date.now() - scanStartTime > SCAN_TIMEOUT_MS) {
      console.log(`[TJ] Scan timeout after ${scannedCount} emails (${Math.round((Date.now() - scanStartTime) / 1000)}s). Returning partial results.`);
      timedOut = true;
      break;
    }

    if (state.processedEmailIds[msgId]) {
      scannedCount++;
      continue;
    }

    try {
      const full = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'full' });
      const headers = full.data.payload.headers;
      const body = getEmailBody(full.data.payload);
      const parsed = parseEmailForContact(headers, body);

      // --- DETERMINE CONTACT: if sender is internal (Jonathan), the contact is the recipient ---
      const internalDomains = ['teamjordan.ca', 'faristeam.ca'];
      const senderIsInternal = parsed.fromEmail && internalDomains.some(d => parsed.fromEmail.toLowerCase().includes(d));

      let contactEmail, contactName;
      if (senderIsInternal) {
        // Jonathan sent this — the contact is whoever he sent it TO
        // Use To field first, fall back to first non-internal email in body
        const toEmail = parsed.toEmail && !internalDomains.some(d => parsed.toEmail.toLowerCase().includes(d)) ? parsed.toEmail : null;
        const toName = toEmail ? parsed.toName : null;
        const bodyEmailNonInternal = parsed.emails.find(e => !internalDomains.some(d => e.toLowerCase().includes(d)) && e !== parsed.fromEmail);
        contactEmail = toEmail || bodyEmailNonInternal || null;
        contactName = toName || (parsed.names.length > 0 ? parsed.names[0] : null);
      } else {
        // External sender — they are the contact
        contactEmail = parsed.emails[0] || null;
        contactName = parsed.fromName || (parsed.names.length > 0 ? parsed.names[0] : null);
      }

      // --- EXCLUSION FILTERS (auto-skip with reason) ---
      // For internal senders: we already flipped to use the recipient as contact above.
      // Only skip if the CONTACT email is also internal (internal-to-internal email).
      if (contactEmail && internalDomains.some(d => contactEmail.toLowerCase().includes(d))) {
        const internalRealtorCheck = /\b(realtor|sales\s+representative)\b/i;
        if (!internalRealtorCheck.test(body)) {
          skipped.push({ msgId, name: contactName, email: contactEmail, reason: 'Internal team (no Realtor/Sales Rep in signature)' });
          state.processedEmailIds[msgId] = 'skipped';
          state.emailsSkipped++;
          scannedCount++;
          continue;
        }
      }

      // Skip if the resolved contact is still Jonathan (self-emails, drafts, etc.)
      const ownerEmails = ['jonathan@teamjordan.ca', 'jonathanwallacerealestate@gmail.com'];
      if (contactEmail && ownerEmails.some(e => contactEmail.toLowerCase() === e)) {
        skipped.push({ msgId, name: contactName, email: contactEmail, reason: 'Owner email (self)' });
        state.processedEmailIds[msgId] = 'skipped';
        state.emailsSkipped++;
        scannedCount++;
        continue;
      }

      const systemSenders = [
        'zapier', 'noreply', 'no-reply', 'mailer-daemon', 'postmaster',
        'notifications', 'notification', 'alerts', 'alert', 'donotreply',
        'do-not-reply', 'automated', 'auto-', 'system', 'admin@',
        'support@', 'info@', 'hello@', 'contact@', 'feedback@',
        'newsletter', 'marketing@', 'sales@', 'billing@',
        'followupboss', 'google.com', 'googleapis.com',
        'mailchimp', 'sendgrid', 'hubspot', 'salesforce',
        'realtor.ca', 'mls.ca', 'crea.ca',
      ];
      const fromLower = (parsed.fromEmail || '').toLowerCase() + ' ' + (parsed.fromName || '').toLowerCase();
      if (systemSenders.some(s => fromLower.includes(s))) {
        skipped.push({ msgId, name: contactName, email: contactEmail, reason: 'System/automation sender' });
        state.processedEmailIds[msgId] = 'skipped';
        state.emailsSkipped++;
        scannedCount++;
        continue;
      }

      const nonPersonPatterns = /\b(coordinator|office|brokerage|admin|administrator|listings?\s+(?:coordinator|dept|department)|deals?\s+(?:coordinator|dept|department)|media\s+coordinator|team\s+jordan|reception|front\s+desk|accounting|bookkeep|operations|marketing\s+(?:dept|team|coordinator)|support\s+team|customer\s+service|it\s+(?:dept|department))\b/i;
      if (contactName && nonPersonPatterns.test(contactName)) {
        skipped.push({ msgId, name: contactName, email: contactEmail, reason: 'Non-person name (role/office)' });
        state.processedEmailIds[msgId] = 'skipped';
        state.emailsSkipped++;
        scannedCount++;
        continue;
      }

      // Only skip if there's truly nothing — no email, no phone, no name
      const hasPhone = parsed.phones.length > 0;
      if (!contactEmail && !hasPhone && !contactName) {
        skipped.push({ msgId, reason: 'No contact info at all' });
        state.processedEmailIds[msgId] = 'skipped';
        state.emailsSkipped++;
        scannedCount++;
        continue;
      }
      if (!contactEmail && !hasPhone) {
        skipped.push({ msgId, name: contactName, reason: 'Name only — no email or phone' });
        state.processedEmailIds[msgId] = 'skipped';
        state.emailsSkipped++;
        scannedCount++;
        continue;
      }

      // Cross-reference against FUB — skip contacts that already exist
      if (contactEmail || parsed.phones[0]) {
        try {
          let existing = contactEmail ? await findPersonInFub(contactEmail, contactName) : null;
          if (!existing && parsed.phones[0]) {
            try {
              const phoneClean = parsed.phones[0].replace(/\D/g, '');
              const phoneResp = await fetch(`${FUB_BASE}/people?phone=${encodeURIComponent(phoneClean)}&limit=1`, { headers: fubHeaders() });
              if (phoneResp.ok) {
                const phoneData = await phoneResp.json();
                if (phoneData.people && phoneData.people.length > 0) existing = phoneData.people[0];
              }
            } catch {}
          }
          if (existing) {
            skipped.push({ msgId, name: contactName, email: contactEmail, reason: 'Already in FUB', fubId: existing.id });
            // Track all their info so future emails from them are caught
            if (!state.knownContactKeys) state.knownContactKeys = [];
            const allE = parsed.emails || []; const allP = parsed.phones || [];
            for (const e of allE) { if (e) { knownKeys.add(e.toLowerCase()); state.knownContactKeys.push(e.toLowerCase()); } }
            for (const p of allP) { const pk = p.replace(/\D/g, ''); if (pk) { knownKeys.add(pk); state.knownContactKeys.push(pk); } }
            if (contactName) { const parts = contactName.split(/\s+/).filter(Boolean); const nk = normalizeName(parts[0], parts.slice(1).join(' ')); if (nk) { knownKeys.add(nk); state.knownContactKeys.push(nk); } }
            state.processedEmailIds[msgId] = 'existing';
            state.leadsSkippedExisting++;
            scannedCount++;
            continue;
          }
        } catch (err) {
          console.error('[TJ] FUB lookup error during scan:', err.message);
        }
      }

      // --- BUILD CANDIDATE FOR REVIEW ---
      const nameParts = (contactName || '').split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      // Require a real first AND last name — skip junk names
      const badNames = /^(unknown|docusign|admin|info|noreply|test|null|none|n\/a|na|notification|alert|system|automated|mailer)$/i;
      const isRealName = (n) => n && n.length >= 2 && !badNames.test(n) && /[a-zA-Z]{2,}/.test(n);
      if (!isRealName(firstName) || !isRealName(lastName)) {
        skipped.push({ msgId, name: contactName || '(empty)', email: contactEmail, reason: `Missing real name (got: "${firstName} ${lastName}".trim())`, phone: parsed.phones[0] || null });
        state.processedEmailIds[msgId] = 'skipped';
        state.emailsSkipped++;
        scannedCount++;
        continue;
      }

      const isRealtor = parsed.isRealtor;
      const isLawyer = parsed.isLawyer && !isRealtor;

      let contactType = 'lead';
      let realtorSource = null;
      if (isRealtor) {
        contactType = 'realtor';
        if (parsed.isShowingRequest) realtorSource = 'Showing Request';
        else if (parsed.isBrokerBuyRequest) realtorSource = 'Broker Buy Request';
        else if (parsed.brokerage) realtorSource = 'Brokerage Signature';
        else realtorSource = 'Email Correspondence';
      } else if (isLawyer) {
        contactType = 'lawyer';
      }

      // Deduplicate: check ALL emails, phones, and name against known contacts
      const allEmails = parsed.emails || [];
      const allPhones = parsed.phones || [];
      const matchType = isKnownContact(allEmails, allPhones, firstName, lastName);
      if (matchType) {
        skipped.push({ msgId, name: `${firstName} ${lastName}`, email: contactEmail, reason: `Duplicate (matched by ${matchType})` });
        state.processedEmailIds[msgId] = 'skipped';
        state.emailsSkipped++;
        scannedCount++;
        continue;
      }
      // Track this contact's keys so future emails from them are caught
      trackContact(allEmails, allPhones, firstName, lastName);

      candidates.push({
        msgId,
        firstName, lastName,
        email: contactEmail,
        phone: parsed.phones[0] || null,
        type: contactType,
        realtorSource,
        brokerage: parsed.brokerage || null,
        lawFirm: parsed.lawFirm || null,
        workAddress: parsed.workAddress || null,
        subject: parsed.subject,
        date: parsed.date,
        noteWorthy: parsed.noteWorthy,
        additionalEmails: parsed.emails.slice(1),
        additionalPhones: parsed.phones.slice(1),
        names: parsed.names,
        approved: true,
      });

      scannedCount++;

    } catch (err) {
      skipped.push({ msgId, reason: `Error: ${err.message}` });
      scannedCount++;
    }
  }

  // Store pending candidates and updated known keys
  state.pendingCandidates = candidates;
  state.knownContactKeys = [...knownKeys]; // persist all tracked keys including this batch
  state.currentBatch++;
  state.lastProcessedAt = new Date().toISOString();
  state.status = 'review'; // waiting for approval
  saveTjState(state);

  const scanDuration = Math.round((Date.now() - scanStartTime) / 1000);
  console.log(`[TJ] Scan complete: ${candidates.length} candidates, ${skipped.length} skipped, ${scannedCount} processed in ${scanDuration}s${timedOut ? ' (TIMED OUT)' : ''}`);

  res.json({
    success: true,
    batch: state.currentBatch,
    candidates,
    skipped,
    skippedCount: skipped.length,
    hasMore: hasMore || timedOut, // if timed out, there are still unscanned emails
    timedOut,
    scannedCount,
    totalInBatch: batchIds.length,
    scanDuration,
    progress: buildTjProgress(state),
  });
});

// STEP 3: POST /api/tj/approve — Import approved candidates into FUB
app.post('/api/tj/approve', async (req, res) => {
  if (!FUB_API_KEY) return res.json({ error: 'FUB not configured' });

  const state = loadTjState();
  const { approved } = req.body; // array of { msgId, type } objects

  if (!approved || !Array.isArray(approved)) {
    return res.json({ error: 'Missing approved array', success: false });
  }

  const approvedMap = {};
  for (const a of approved) { approvedMap[a.msgId] = { type: a.type, firstName: a.firstName, lastName: a.lastName }; }

  const candidates = state.pendingCandidates || [];
  if (candidates.length === 0) {
    return res.json({ error: 'No pending candidates. Run a scan first.', success: false });
  }

  state.status = 'importing';
  saveTjState(state);

  const results = { imported: 0, rejected: 0, errors: 0 };

  for (const candidate of candidates) {
    const approvedData = approvedMap[candidate.msgId];

    if (!approvedData) {
      // User rejected this one — mark as skipped
      state.processedEmailIds[candidate.msgId] = 'rejected';
      state.emailsSkipped++;
      state.processedCount++;
      results.rejected++;
      continue;
    }

    // Use edited names from the user (they may have corrected them in the UI)
    const firstName = approvedData.firstName || candidate.firstName;
    const lastName = approvedData.lastName || candidate.lastName;
    const { email, phone, realtorSource, brokerage, lawFirm, workAddress, noteWorthy, additionalEmails, additionalPhones, names } = candidate;
    const type = approvedData.type; // from the user's dropdown selection
    const isRealtor = type === 'realtor';
    const isLawyer = type === 'lawyer';

    // Quick safety check — in case contact was added to FUB between scan and approve
    try {
      const existing = email ? await findPersonInFub(email, `${firstName} ${lastName}`.trim()) : null;
      if (existing) {
        state.processedEmailIds[candidate.msgId] = 'existing';
        if (!state.knownContactKeys) state.knownContactKeys = [];
        if (email) state.knownContactKeys.push(email.toLowerCase());
        if (phone) state.knownContactKeys.push(phone.replace(/\D/g, ''));
        const nk = `${firstName} ${lastName}`.trim().toLowerCase();
        if (nk.includes(' ')) state.knownContactKeys.push(nk);
        state.leadsSkippedExisting++;
        state.processedCount++;
        results.skippedExisting = (results.skippedExisting || 0) + 1;
        continue;
      }
    } catch (err) {
      console.error('[TJ] FUB safety check error:', err.message);
    }

    // Map type to FUB stage and tags
    const typeConfig = {
      lawyer:        { stage: 'Lawyer',              tags: ['Lawyer', 'Team Jordan Import', 'Agent HQ Import'] },
      realtor:       { stage: 'Real Estate Agent',   tags: ['Realtor', 'Agent', 'Team Jordan Import', 'Agent HQ Import'] },
      active_client: { stage: 'Active Client',       tags: ['Active Client', 'Team Jordan Import', 'Agent HQ Import'] },
      past_client:   { stage: 'Past Client',         tags: ['Past Client', 'Team Jordan Import', 'Agent HQ Import'] },
      lead:          { stage: 'Old Team Jordan Leads', tags: ['Team Jordan Import', 'Agent HQ Import'] },
    };
    const config = typeConfig[type] || typeConfig.lead;

    let newPerson = {
      firstName, lastName,
      stage: config.stage,
      source: 'Team Jordan Email Archive',
      emails: email ? [{ value: email }] : [],
      phones: phone ? [{ value: phone, type: isLawyer ? 'Work' : 'Mobile' }] : [],
      tags: config.tags,
    };
    if (isLawyer && lawFirm) newPerson.company = lawFirm;
    if (isLawyer && workAddress) newPerson.addresses = [{ value: workAddress, type: 'Work' }];
    if (isRealtor && brokerage) newPerson.company = brokerage;

    try {
      const createResp = await fetch(`${FUB_BASE}/people`, {
        method: 'POST', headers: fubHeaders(),
        body: JSON.stringify(newPerson),
      });

      if (createResp.ok) {
        const created = await createResp.json();

        // Add notes (except for lawyers)
        if (!isLawyer) {
          const noteWorthyFiltered = isRealtor
            ? noteWorthy.filter(n => !n.startsWith('Property:') && !n.startsWith('MLS#:') && !n.startsWith('Deal Value:') && !n.startsWith('Closing:') && !n.startsWith('YSP:'))
            : noteWorthy;

          const noteLines = [`<p><strong>Imported from Team Jordan Email Archive</strong></p>`];
          if (isRealtor && realtorSource) noteLines.push(`<p><strong>Source:</strong> ${realtorSource}</p>`);
          noteLines.push(`<p>Original email: "${candidate.subject}" (${candidate.date})</p>`);
          if (noteWorthyFiltered.length > 0) noteLines.push(`<p><strong>${isRealtor ? 'Agent Info' : 'Deal Info'}:</strong> ${noteWorthyFiltered.join(' | ')}</p>`);
          if (additionalEmails.length > 0) noteLines.push(`<p>Additional emails: ${additionalEmails.join(', ')}</p>`);
          if (additionalPhones.length > 0) noteLines.push(`<p>Additional phones: ${additionalPhones.join(', ')}</p>`);
          if (!isRealtor && names.length > 0) noteLines.push(`<p>Names referenced: ${names.join(', ')}</p>`);

          try {
            await fetch(`${FUB_BASE}/notes`, {
              method: 'POST', headers: fubHeaders(),
              body: JSON.stringify({ personId: created.id, body: noteLines.join(''), subject: 'Team Jordan Import — Agent HQ', isHtml: true }),
            });
            state.notesAdded++;
          } catch {}
        }

        state.processedEmailIds[candidate.msgId] = 'created';
        // Track ALL contact info so they don't appear in future batches
        if (!state.knownContactKeys) state.knownContactKeys = [];
        if (email) state.knownContactKeys.push(email.toLowerCase());
        if (phone) state.knownContactKeys.push(phone.replace(/\D/g, ''));
        const nameKey = `${firstName} ${lastName}`.trim().toLowerCase();
        if (nameKey.includes(' ')) state.knownContactKeys.push(nameKey);
        // Also track additional emails/phones from the email body
        for (const ae of (additionalEmails || [])) { if (ae) state.knownContactKeys.push(ae.toLowerCase()); }
        for (const ap of (additionalPhones || [])) { if (ap) state.knownContactKeys.push(ap.replace(/\D/g, '')); }

        if (isRealtor) { state.realtorsCreated++; }
        else if (isLawyer) { state.lawyersCreated = (state.lawyersCreated || 0) + 1; }
        else { state.leadsCreated++; }
        results.imported++;

        state.recentActivity.unshift({
          action: 'created', type, isRealtor, isLawyer,
          name: `${firstName} ${lastName}`.trim(), email,
          fubId: created.id, brokerage, lawFirm,
          at: new Date().toISOString(), noteWorthy: isLawyer ? [] : noteWorthy,
        });
        if (state.recentActivity.length > 20) state.recentActivity = state.recentActivity.slice(0, 20);
      } else {
        const errText = await createResp.text();
        state.processedEmailIds[candidate.msgId] = 'error';
        state.errors.push({ msgId: candidate.msgId, error: errText.slice(0, 200) });
        results.errors++;
      }
    } catch (err) {
      state.processedEmailIds[candidate.msgId] = 'error';
      state.errors.push({ msgId: candidate.msgId, error: err.message });
      results.errors++;
    }

    state.processedCount++;
    await new Promise(r => setTimeout(r, 200)); // rate limit FUB
  }

  // Clear pending candidates
  state.pendingCandidates = [];
  state.status = 'paused';
  if (state.errors.length > 100) state.errors = state.errors.slice(-100);
  saveTjState(state);

  res.json({
    success: true,
    results,
    progress: buildTjProgress(state),
  });
});

// Helper: build progress object from state
function buildTjProgress(state) {
  return {
    processed: state.processedCount,
    total: state.totalMessages || state.processedCount,
    percent: state.totalMessages > 0 ? Math.min(Math.round((state.processedCount / state.totalMessages) * 100), 99) : 0,
    leadsCreated: state.leadsCreated,
    realtorsCreated: state.realtorsCreated || 0,
    lawyersCreated: state.lawyersCreated || 0,
    leadsSkippedExisting: state.leadsSkippedExisting,
    notesAdded: state.notesAdded,
    emailsSkipped: state.emailsSkipped,
    errors: state.errors.length,
    status: state.status,
  };
}

// GET /api/tj/status — check import progress
app.get('/api/tj/status', (req, res) => {
  const state = loadTjState();
  res.json({
    status: state.status,
    progress: buildTjProgress(state),
    recentActivity: state.recentActivity,
    lastProcessedAt: state.lastProcessedAt,
    currentBatch: state.currentBatch,
    hasMore: !!state.nextPageToken,
    stageId: state.stageId,
    labelName: state.labelName,
    pendingCandidates: state.pendingCandidates || [],
  });
});

// POST /api/tj/reset — reset the import (start over)
app.post('/api/tj/reset', (req, res) => {
  try { fs.unlinkSync(TJ_STATE_PATH); } catch {}
  res.json({ success: true, message: 'Import state reset' });
});

// POST /api/tj/cleanup — delete bad imports from FUB by name
app.post('/api/tj/cleanup', async (req, res) => {
  if (!FUB_API_KEY) return res.json({ error: 'FUB_API_KEY not configured' });
  const badNames = [
    'Team Jordan Listings Coordinator',
    'Team Jordan Deals Coordinator',
    'Team Jordan Brokerage Office',
    'Tara Go May',
    'Zapier',
  ];
  const results = [];
  for (const name of badNames) {
    try {
      const searchResp = await fetch(`${FUB_BASE}/people?q=${encodeURIComponent(name)}&limit=10`, {
        headers: fubHeaders(),
      });
      if (!searchResp.ok) { results.push({ name, status: 'search_failed' }); continue; }
      const data = await searchResp.json();
      const matches = (data.people || []).filter(p => {
        const tags = (p.tags || []).map(t => t.tag || t);
        return tags.includes('Team Jordan Import') || tags.includes('Agent HQ Import');
      });
      for (const person of matches) {
        const delResp = await fetch(`${FUB_BASE}/people/${person.id}`, {
          method: 'DELETE', headers: fubHeaders(),
        });
        results.push({ name, id: person.id, deleted: delResp.ok });
        await new Promise(r => setTimeout(r, 300));
      }
      if (matches.length === 0) results.push({ name, status: 'not_found' });
    } catch (err) {
      results.push({ name, error: err.message });
    }
  }
  res.json({ success: true, results });
});

// POST /api/fub/log-call — log a call + note in Follow Up Boss
app.post('/api/fub/log-call', async (req, res) => {
  if (!FUB_API_KEY) return res.json({ error: 'FUB_API_KEY not configured', success: false });

  const { personId, outcome, notes, contactName } = req.body;
  if (!personId) return res.json({ error: 'personId is required', success: false });

  try {
    const results = { note: null, event: null };

    // 1) Create a note on the contact
    const noteBody = outcome === 'no_answer'
      ? `<p><strong>Call — No Answer, Left Voicemail</strong></p><p>Called from Agent HQ. No answer — voicemail left.</p>${notes ? `<p>${notes}</p>` : ''}`
      : `<p><strong>Call Logged from Agent HQ</strong></p><p>${notes || 'Call completed.'}</p>`;

    try {
      const noteResp = await fetch(`${FUB_BASE}/notes`, {
        method: 'POST',
        headers: fubHeaders(),
        body: JSON.stringify({
          personId: Number(personId),
          body: noteBody,
          subject: outcome === 'no_answer' ? 'No Answer — Left Voicemail' : 'Call Logged',
          isHtml: true,
        }),
      });
      if (noteResp.ok) {
        results.note = await noteResp.json();
        console.log(`[FUB] Note created for person ${personId}`);
      } else {
        const errText = await noteResp.text();
        console.error(`[FUB] Note creation failed: ${noteResp.status} — ${errText}`);
        results.note = { error: `${noteResp.status}: ${errText}` };
      }
    } catch (err) {
      console.error(`[FUB] Note creation error:`, err);
      results.note = { error: err.message };
    }

    // 2) Log a call event on the contact
    try {
      const eventResp = await fetch(`${FUB_BASE}/events`, {
        method: 'POST',
        headers: fubHeaders(),
        body: JSON.stringify({
          personId: Number(personId),
          type: 'Call',
          description: outcome === 'no_answer'
            ? 'No answer — left voicemail. Logged from Agent HQ.'
            : (notes || 'Call completed. Logged from Agent HQ.'),
          outcome: outcome === 'no_answer' ? 'No Answer' : 'Connected',
        }),
      });
      if (eventResp.ok) {
        results.event = await eventResp.json();
        console.log(`[FUB] Call event logged for person ${personId}`);
      } else {
        const errText = await eventResp.text();
        console.error(`[FUB] Event creation failed: ${eventResp.status} — ${errText}`);
        results.event = { error: `${eventResp.status}: ${errText}` };
      }
    } catch (err) {
      console.error(`[FUB] Event creation error:`, err);
      results.event = { error: err.message };
    }

    // 3) Update lastActivity by touching the contact (FUB auto-updates on note/event)
    // No extra call needed — creating a note/event already updates lastActivity

    // 4) Remove this contact from today's cached call list
    if (callListCache.list) {
      callListCache.list = callListCache.list.filter(c => c.fubId !== Number(personId));
    }

    res.json({
      success: true,
      personId,
      contactName: contactName || 'Unknown',
      outcome,
      results,
    });
  } catch (err) {
    console.error('[FUB] Log call error:', err);
    res.json({ error: err.message, success: false });
  }
});

// ─────────────────────────────────────────────
// FUB LISTING APPOINTMENTS — Auto-populate from tag
// ─────────────────────────────────────────────

// GET /api/fub/listing-appointments — Fetch contacts tagged "Listing Appointment" in FUB
app.get('/api/fub/listing-appointments', async (req, res) => {
  if (!FUB_API_KEY) return res.json({ error: 'FUB_API_KEY not configured', appointments: [] });
  try {
    // FUB API: search people by tag
    const tag = 'Listing Appointment';
    let allContacts = [];
    let offset = 0;
    const limit = 100;

    // Paginate through all contacts with this tag
    while (true) {
      const url = `${FUB_BASE}/people?tag=${encodeURIComponent(tag)}&limit=${limit}&offset=${offset}&sort=created&order=desc`;
      const resp = await fetch(url, { headers: fubHeaders() });
      if (!resp.ok) {
        console.error(`[FUB] Listing appointments fetch error: ${resp.status}`);
        break;
      }
      const data = await resp.json();
      const people = data.people || [];
      allContacts = allContacts.concat(people);
      if (people.length < limit) break;
      offset += limit;
      if (offset > 500) break; // safety cap
    }

    // Also try searching by stage name "Listing Appointment" as fallback
    try {
      const stageUrl = `${FUB_BASE}/people?stage=${encodeURIComponent(tag)}&limit=100&sort=created&order=desc`;
      const stageResp = await fetch(stageUrl, { headers: fubHeaders() });
      if (stageResp.ok) {
        const stageData = await stageResp.json();
        const stagePeople = stageData.people || [];
        // Merge without duplicates
        const existingIds = new Set(allContacts.map(c => c.id));
        for (const p of stagePeople) {
          if (!existingIds.has(p.id)) {
            allContacts.push(p);
            existingIds.add(p.id);
          }
        }
      }
    } catch {}

    // Map to clean appointment objects
    const appointments = allContacts.map(c => {
      // Extract primary address from FUB contact
      const addr = (c.addresses && c.addresses.length > 0) ? c.addresses[0] : {};
      const emails = (c.emails || []).map(e => e.value).filter(Boolean);
      const phones = (c.phones || []).map(p => p.value).filter(Boolean);

      return {
        fubId: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(' '),
        firstName: c.firstName || '',
        lastName: c.lastName || '',
        email: emails[0] || '',
        phone: phones[0] || '',
        address: [addr.street, addr.street2].filter(Boolean).join(' ').trim(),
        city: addr.city || '',
        postalCode: addr.code || '',
        province: addr.state || 'ON',
        stage: c.stage || '',
        tags: (c.tags || []).map(t => typeof t === 'string' ? t : t.tag || t.name || ''),
        created: c.created || '',
        lastActivity: c.lastActivity || '',
        source: c.source || '',
      };
    });

    // Check which ones already have listing forms created
    const LISTING_FORMS_DIR_CHECK = path.join(__dirname, '.listing-forms');
    const existingForms = new Set();
    try {
      const files = fs.readdirSync(LISTING_FORMS_DIR_CHECK).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(LISTING_FORMS_DIR_CHECK, f), 'utf8'));
          if (data.fubId) existingForms.add(Number(data.fubId));
        } catch {}
      }
    } catch {}

    // Mark which appointments already have forms
    for (const appt of appointments) {
      appt.hasListingForm = existingForms.has(appt.fubId);
    }

    console.log(`[FUB] Found ${appointments.length} listing appointments (${appointments.filter(a => !a.hasListingForm).length} new)`);
    res.json({ success: true, appointments, total: appointments.length });
  } catch (err) {
    console.error('[FUB] Listing appointments error:', err);
    res.json({ error: err.message, appointments: [] });
  }
});

// POST /api/fub/listing-appointments/import/:fubId — Create a listing form from a FUB contact
app.post('/api/fub/listing-appointments/import/:fubId', async (req, res) => {
  if (!FUB_API_KEY) return res.json({ error: 'FUB_API_KEY not configured', success: false });
  try {
    const fubId = req.params.fubId;

    // Fetch the full contact from FUB
    const resp = await fetch(`${FUB_BASE}/people/${fubId}`, { headers: fubHeaders() });
    if (!resp.ok) return res.json({ error: `FUB returned ${resp.status}`, success: false });
    const contact = await resp.json();

    const addr = (contact.addresses && contact.addresses.length > 0) ? contact.addresses[0] : {};
    const emails = (contact.emails || []).map(e => e.value).filter(Boolean);
    const phones = (contact.phones || []).map(p => p.value).filter(Boolean);

    const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
    const street = [addr.street, addr.street2].filter(Boolean).join(' ').trim();
    const city = addr.city || '';

    // Generate propertyId from address or name
    const slugBase = street || name || `fub-${fubId}`;
    const slugCity = city || 'listing';
    const propertyId = slugBase.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
      + '-' + slugCity.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    // Check if form already exists
    const LISTING_FORMS_DIR_IMPORT = path.join(__dirname, '.listing-forms');
    if (!fs.existsSync(LISTING_FORMS_DIR_IMPORT)) fs.mkdirSync(LISTING_FORMS_DIR_IMPORT, { recursive: true });
    const filePath = path.join(LISTING_FORMS_DIR_IMPORT, `${propertyId}.json`);

    if (fs.existsSync(filePath)) {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return res.json({ success: true, propertyId: existing.propertyId, alreadyExists: true });
    }

    // Create new listing form pre-populated from FUB contact
    const formData = {
      propertyId,
      address: street,
      city: city,
      postalCode: addr.code || '',
      sellerName: name,
      sellerPhone: phones[0] || '',
      sellerEmail: emails[0] || '',
      sellerName2: '',
      sellerPhone2: '',
      sellerEmail2: '',
      fubId: Number(fubId),
      fubSource: 'listing-appointment',
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // If contact has a second person associated (co-seller), try to get from notes
    // For now, just save the primary seller info

    fs.writeFileSync(filePath, JSON.stringify(formData, null, 2));
    console.log(`[FUB] Created listing form for ${name} at ${street || '(no address)'} (FUB ID: ${fubId})`);

    res.json({ success: true, propertyId, formData });
  } catch (err) {
    console.error('[FUB] Import listing appointment error:', err);
    res.json({ error: err.message, success: false });
  }
});

// GET /api/ea/fub-sent-diagnostic — Comprehensive check of all FUB email tracking paths
app.get('/api/ea/fub-sent-diagnostic', async (req, res) => {
  if (!FUB_API_KEY) {
    return res.json({ success: false, error: 'FUB_API_KEY not configured' });
  }

  const results = { success: true, checks: {} };

  // Helper
  const fubGet = async (path) => {
    const resp = await fetch(`${FUB_BASE}${path}`, { headers: fubHeaders() });
    return { status: resp.status, ok: resp.ok, data: resp.ok ? await resp.json() : null };
  };

  try {
    // 1) Events API — type=email
    try {
      const r = await fubGet('/events?type=email&limit=20&sort=created&order=desc');
      const events = r.data?.events || [];
      const outbound = events.filter(e => e.isIncoming === false);
      const inbound = events.filter(e => e.isIncoming === true);
      results.checks.eventsEmailType = {
        httpStatus: r.status,
        total: events.length,
        outbound: outbound.length,
        inbound: inbound.length,
        sample: events[0] || null,
      };
    } catch (e) { results.checks.eventsEmailType = { error: e.message }; }

    // 2) Events API — no type filter (all events)
    try {
      const r = await fubGet('/events?limit=30&sort=created&order=desc');
      const events = r.data?.events || [];
      const types = {};
      events.forEach(e => { types[e.type || 'unknown'] = (types[e.type || 'unknown'] || 0) + 1; });
      const emailEvents = events.filter(e => e.type === 'email' || (e.description || '').toLowerCase().includes('email'));
      results.checks.eventsAllTypes = {
        httpStatus: r.status,
        total: events.length,
        typeBreakdown: types,
        emailRelated: emailEvents.length,
        sampleTypes: events.slice(0, 5).map(e => ({ type: e.type, desc: (e.description || '').slice(0, 80), created: e.created })),
      };
    } catch (e) { results.checks.eventsAllTypes = { error: e.message }; }

    // 3) Email Messages API (FUB's dedicated email endpoint)
    try {
      const r = await fubGet('/emailMessages?limit=10&sort=created&order=desc');
      const msgs = r.data?.emailMessages || r.data?.messages || [];
      results.checks.emailMessages = {
        httpStatus: r.status,
        total: msgs.length,
        available: r.ok,
        sample: msgs[0] ? {
          id: msgs[0].id,
          subject: msgs[0].subject,
          from: msgs[0].from,
          to: msgs[0].to,
          direction: msgs[0].direction || msgs[0].isIncoming,
          created: msgs[0].created || msgs[0].createdAt,
        } : null,
        rawKeys: msgs[0] ? Object.keys(msgs[0]) : [],
      };
    } catch (e) { results.checks.emailMessages = { error: e.message }; }

    // 4) Textual Messages / Notes (sometimes email shows here)
    try {
      const r = await fubGet('/textMessages?limit=5&sort=created&order=desc');
      results.checks.textMessages = {
        httpStatus: r.status,
        available: r.ok,
        total: (r.data?.textMessages || []).length,
      };
    } catch (e) { results.checks.textMessages = { error: e.message }; }

    // 5) Grab a recent contact and check their timeline for email activity
    try {
      const r = await fubGet('/people?sort=lastActivity&limit=3');
      const people = r.data?.people || [];
      if (people.length > 0) {
        const personId = people[0].id;
        const name = [people[0].firstName, people[0].lastName].filter(Boolean).join(' ');

        // Check this person's notes/activity
        const notesR = await fubGet(`/notes?personId=${personId}&limit=10&sort=created&order=desc`);
        const notes = notesR.data?.notes || [];
        const emailNotes = notes.filter(n =>
          (n.subject || '').toLowerCase().includes('email') ||
          (n.body || '').toLowerCase().includes('from:') ||
          (n.body || '').toLowerCase().includes('sent') ||
          (n.isEmailMessage)
        );

        // Check this person's events
        const eventsR = await fubGet(`/events?personId=${personId}&limit=10&sort=created&order=desc`);
        const personEvents = eventsR.data?.events || [];

        results.checks.recentContactTimeline = {
          person: { id: personId, name },
          totalNotes: notes.length,
          emailRelatedNotes: emailNotes.length,
          totalEvents: personEvents.length,
          eventTypes: personEvents.map(e => e.type),
          sampleNote: notes[0] ? { subject: notes[0].subject, bodyPreview: (notes[0].body || '').slice(0, 120), isEmail: notes[0].isEmailMessage || false, created: notes[0].created } : null,
          sampleEvent: personEvents[0] || null,
        };
      }
    } catch (e) { results.checks.recentContactTimeline = { error: e.message }; }

    // 6) Check available API endpoints
    results.checks.apiInfo = {
      note: 'FUB email sync via Office 365 OAuth stores emails on contact timelines. The Events API (type=email) may not capture synced emails. Check emailMessages and notes endpoints for synced data.',
      outlookConnected: true,
      outlookEmail: 'jonathan@faristeam.ca',
      syncType: 'Office 365 OAuth',
    };

  } catch (err) {
    results.success = false;
    results.error = err.message;
  }

  res.json(results);
});

// ─────────────────────────────────────────────
// LISTING FORM — Pre-Listing Data Management
// ─────────────────────────────────────────────

const LISTING_FORMS_DIR = path.join(__dirname, '.listing-forms');
if (!fs.existsSync(LISTING_FORMS_DIR)) fs.mkdirSync(LISTING_FORMS_DIR, { recursive: true });

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

// List all saved listing forms
app.get('/api/listing-form/list', (req, res) => {
  try {
    const files = fs.readdirSync(LISTING_FORMS_DIR).filter(f => f.endsWith('.json'));
    const listings = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(LISTING_FORMS_DIR, f), 'utf8'));
        return {
          propertyId: data.propertyId,
          address: data.address || '',
          city: data.city || '',
          sellerName: data.sellerName || '',
          listPrice: data.listPrice || '',
          status: data.status || 'draft',
          updatedAt: data.updatedAt || data.createdAt || '',
          createdAt: data.createdAt || '',
        };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    res.json({ success: true, listings });
  } catch (err) {
    console.error('[ListingForm] List error:', err.message);
    res.json({ success: false, error: err.message, listings: [] });
  }
});

// Load a specific listing form
app.get('/api/listing-form/load/:propertyId', (req, res) => {
  const filePath = path.join(LISTING_FORMS_DIR, `${req.params.propertyId}.json`);
  if (!fs.existsSync(filePath)) {
    return res.json({ success: false, error: 'Not found' });
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Save listing form
app.post('/api/listing-form/save', (req, res) => {
  try {
    const data = req.body;
    if (!data.propertyId) {
      // Auto-generate propertyId from address + city
      if (!data.address) return res.json({ success: false, error: 'Address or propertyId required' });
      data.propertyId = slugify(`${data.address} ${data.city || 'midland'}`);
    }
    if (!data.createdAt) data.createdAt = new Date().toISOString();
    data.updatedAt = new Date().toISOString();

    const filePath = path.join(LISTING_FORMS_DIR, `${data.propertyId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // Also forward to Make.com webhook if configured (async, non-blocking)
    const MAKE_SAVE_WEBHOOK = 'https://hook.us2.make.com/95nk30o9mrpff5rfrz31l1tnxgf3ydf7';
    fetch(MAKE_SAVE_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(data),
    }).catch(err => console.log('[ListingForm] Make.com sync (non-critical):', err.message));

    console.log(`[ListingForm] Saved: ${data.propertyId} (${data.address})`);
    res.json({ success: true, propertyId: data.propertyId });
  } catch (err) {
    console.error('[ListingForm] Save error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// Delete a listing form
app.delete('/api/listing-form/:propertyId', (req, res) => {
  const filePath = path.join(LISTING_FORMS_DIR, `${req.params.propertyId}.json`);
  if (!fs.existsSync(filePath)) return res.json({ success: false, error: 'Not found' });
  try {
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// PDF IMPORT — GeoWarehouse & Old MLS Listings
// ─────────────────────────────────────────────

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Parse GeoWarehouse PDF into structured fields
function parseGeoWarehouseText(text) {
  const fields = { _source: 'geowarehouse' };
  const t = text.replace(/\r\n/g, '\n');

  // --- Address & City ---
  // pdf-parse extracts GeoWarehouse text with labels on one line and values on the next.
  // The Property Details section looks like:
  //   GeoWarehouse Address:
  //   PIN:
  //   Land Registry Office:
  //   ...
  //   115  COUNTY 6 RD S
  //   TINY
  //   L0L2J0
  //   583980026
  //   SIMCOE (51)
  // So labels come first in a block, then values follow in order.
  // Best approach: grab address from the cover page header which appears as:
  //   "115  COUNTY 6 RD S, TINY"  (with comma separating address and municipality)
  // or from the Property Address line in the assessment section.
  const headerMatch = t.match(/Property Address:\s*\n\s*(.+?)\n/i);
  if (headerMatch) {
    const fullAddr = headerMatch[1].trim();
    // Format: "115 COUNTY ROAD 6 S TINY ON\nL0L2J0" or "115 COUNTY ROAD 6 S TINY ON"
    // Try to split off municipality + province
    const addrParts = fullAddr.match(/^(.+?)\s+(TINY|MIDLAND|PENETANGUISHENE|TAY|WASAGA BEACH|COLLINGWOOD|SPRINGWATER|ORO-MEDONTE|SEVERN|RAMARA|ORILLIA|BARRIE|INNISFIL|BRADFORD|ESSA|CLEARVIEW|ADJALA-TOSORONTIO|NEW TECUMSETH|GEORGIAN BAY)\s*/i);
    if (addrParts) {
      fields.address = addrParts[1].trim();
      fields.city = addrParts[2].trim();
    } else {
      fields.address = fullAddr.replace(/\s+(ON|ONTARIO)\s*$/i, '').trim();
    }
  }
  // Fallback: use the cover page format "115  COUNTY 6 RD S, TINY"
  if (!fields.address) {
    const coverMatch = t.match(/\n(\d+\s+[A-Z][A-Z0-9\s]+(?:RD|ROAD|ST|STREET|AVE|AVENUE|DR|DRIVE|BLVD|CRES|COURT|CT|WAY|LANE|LN|PL|PLACE|CIRCLE|CIR)\s*\w*)\s*,\s*([A-Z]+)\n/i);
    if (coverMatch) {
      fields.address = coverMatch[1].replace(/\s+/g, ' ').trim();
      fields.city = coverMatch[2].trim();
    }
  }
  // Fallback city from cover page (first line after address before PIN)
  if (!fields.city) {
    const cityMatch = t.match(/\n(TINY|MIDLAND|PENETANGUISHENE|TAY|WASAGA BEACH|COLLINGWOOD|SPRINGWATER|ORO-MEDONTE|SEVERN|RAMARA|ORILLIA|BARRIE|INNISFIL)\n/i);
    if (cityMatch) fields.city = cityMatch[1].trim();
  }

  // --- PIN ---
  const pinMatch = t.match(/PIN\s+(\d{9,})/);
  if (pinMatch) fields.pin = pinMatch[1];

  // --- Legal Description ---
  const legalMatch = t.match(/Legal Description\s*\n\s*(.+?)(?:\nReport Generated)/is);
  if (legalMatch) fields.legalDescription = legalMatch[1].trim().replace(/\n/g, ' ');

  // --- Ownership ---
  const ownerMatch = t.match(/Owner Name:\s*\n\s*(.+?)(?:\n\s*Legal Description|\n\n)/is);
  if (ownerMatch) {
    const names = ownerMatch[1].trim().split(/[;\n]/).map(n => n.trim()).filter(Boolean);
    if (names.length > 0) {
      const parseName = (n) => { const parts = n.split(',').map(p => p.trim()); return parts.length >= 2 ? `${parts[1]} ${parts[0]}` : n; };
      fields.sellerName = parseName(names[0]);
      if (names.length > 1) fields.sellerName2 = parseName(names[1]);
    }
  }

  // --- Ownership Type ---
  // In the text, labels and values are separate. Look for Freehold/Condominium after "Ownership Type:"
  const ownerTypeMatch = t.match(/(?:Certified \(Land Titles\)|Land Titles Absolute Plus)\s*\n\s*(Freehold|Condominium|Leasehold)/i);
  if (ownerTypeMatch) fields.ownershipType = ownerTypeMatch[1].trim();

  // --- Lot Size ---
  // "Area:\nPerimeter:\nMeasurements:\n115873.38 sq.ft (2.66 ac)"
  // Values appear after the label block. Match the area value directly.
  const areaMatch = t.match(/([\d,.]+)\s*sq\.?ft\.?\s*\(([\d.]+)\s*ac\)/i);
  if (areaMatch) {
    fields.lotSize = `${areaMatch[2]} acres`;
  }

  // --- Frontage & Depth ---
  const frontMatch = t.match(/Frontage:\s*([\d.]+)\s*ft/i);
  if (frontMatch) {
    fields.lotFrontage = frontMatch[1];
  }
  const depthMatch = t.match(/Depth:\s*([\d.]+)\s*ft/i);
  if (depthMatch) {
    fields.lotDepth = depthMatch[1];
  }

  // --- Lot Dimensions from Measurements ---
  // The measurements line looks like: "521.82ft. x 155.95ft. x 207.93ft. x ..."
  const measMatch = t.match(/([\d.]+ft\.\s*x\s*[\d.]+ft\.[\s\S]*?)(?:\nLot Measurement|\n\n)/i);
  if (measMatch) {
    fields.lotDimensions = measMatch[1].replace(/\n/g, ' ').trim();
  } else if (fields.lotFrontage && fields.lotDepth) {
    fields.lotDimensions = `${fields.lotFrontage} x ${fields.lotDepth}`;
  } else if (fields.lotFrontage) {
    fields.lotDimensions = `Frontage: ${fields.lotFrontage} ft`;
  }

  // --- ARN ---
  const arnMatch = t.match(/ARN\s*\n\s*(\d{15,})/i);
  if (arnMatch) fields.arn = arnMatch[1];
  if (!fields.arn) {
    const arnInline = t.match(/(\d{15})/);
    if (arnInline) fields.arn = arnInline[1];
  }

  // --- Assessed Value ---
  // Current Assessment section: "$328,000" appears after "Current Assessment* :"
  const assessMatch = t.match(/Current Assessment\s*\*?\s*:\s*\n?\s*\$([\d,]+)/i);
  if (assessMatch) fields.assessedValue = assessMatch[1].replace(/,/g, '');

  // --- Property Taxes ---
  // "Residential Property Tax Details" section has rows like "2025$2,898"
  // Grab the most recent (last) year's tax — this is the most current data
  const taxSection = t.match(/Residential Property Tax Details\s*\n([\s\S]*?)(?:\nReport Generated|$)/i);
  if (taxSection) {
    const taxRows = [...taxSection[1].matchAll(/(\d{4})\s*\$\s*([\d,]+)/g)];
    if (taxRows.length > 0) {
      const lastRow = taxRows[taxRows.length - 1];
      fields.taxes = lastRow[2].replace(/,/g, '');
      fields.taxYear = lastRow[1]; // Tax year matches the tax amount
    }
  }

  // --- Fallback Taxation Year (from assessment section) ---
  if (!fields.taxYear) {
    const taxBlock = t.match(/Taxation Year\s*Phased-In Assessment[\s\S]*?\n(\d{4})\n/i);
    if (taxBlock) fields.taxYear = taxBlock[1];
  }

  // --- Year Built, Bedrooms, Bathrooms ---
  // Structure table row: "301 1994 3 2 N/A 1"
  // Format: code yearBuilt bedrooms fullBaths halfBaths stories
  const structMatch = t.match(/(\d{3})\s*(\d{4})\s*(\d+)\s*(\d+)\s*(N\/A|\d+)\s*(\d+)/);
  if (structMatch) {
    fields.yearBuilt = structMatch[2];
    fields.bedrooms = structMatch[3];
    const fullBaths = parseInt(structMatch[4]) || 0;
    const halfStr = structMatch[5];
    const halfBaths = halfStr === 'N/A' ? 0 : (parseInt(halfStr) || 0);
    fields.bathrooms = halfBaths > 0 ? `${fullBaths}.${halfBaths}` : String(fullBaths);
  }

  // --- Description / Property Type ---
  // Match the MPAC description line like "Single-family detached (not on water)"
  // Be specific to avoid matching "Assessment Roll Legal Description:"
  const descMatch = t.match(/(?:^|\n)\s*(?:Frontage:[\s\S]*?)Description:\s*(.+)/im)
    || t.match(/(?:Property Code:[\s\S]*?)Description:\s*(.+)/im);
  if (descMatch) {
    const desc = descMatch[1].trim().toLowerCase();
    if (desc.includes('detach')) fields.propertyType = 'Detached';
    else if (desc.includes('semi')) fields.propertyType = 'Semi-Detached';
    else if (desc.includes('town') || desc.includes('row')) fields.propertyType = 'Townhouse';
    else if (desc.includes('condo')) fields.propertyType = 'Condo';
    if (desc.includes('on water') && !desc.includes('not on water')) fields.isWaterfront = true;
  }

  // --- Water & Sewers (GeoWarehouse only knows well/septic vs municipal) ---
  const waterMatch = t.match(/Water Service Type:\s*(.+)/i);
  if (waterMatch) {
    const wt = waterMatch[1].trim().toLowerCase();
    if (wt.includes('well') || wt.includes('private')) fields.waterSource = 'Drilled Well';
    else if (wt.includes('municipal') || wt.includes('public')) fields.waterSource = 'Municipal';
  }
  const sewerMatch = t.match(/Sanitation Type:\s*(.+)/i);
  if (sewerMatch) {
    const st = sewerMatch[1].trim().toLowerCase();
    if (st.includes('septic')) fields.sewerType = 'Septic Tank';
    else if (st.includes('municipal') || st.includes('public')) fields.sewerType = 'Municipal Sewer';
  }
  // Note: garage, exterior, and mechanicals all come from REALM/MLS listing

  // --- Zoning (GeoWarehouse is the authoritative source for zoning) ---
  const zoningMatch = t.match(/Zoning:\s*(.+)/i);
  if (zoningMatch) fields.zoning = zoningMatch[1].trim();

  // --- Site Area (acreage from Enhanced section) ---
  const siteAreaMatch = t.match(/Site Area:\s*(.+)/i);
  if (siteAreaMatch && !fields.lotSize) {
    fields.lotSize = siteAreaMatch[1].trim();
  }

  // --- Postal Code ---
  const postalMatch = t.match(/([A-Z]\d[A-Z]\s*\d[A-Z]\d)/i);
  if (postalMatch) fields.postalCode = postalMatch[1].replace(/\s/g, '').toUpperCase();

  // --- Sales History (most recent sale) ---
  const saleMatch = t.match(/Sales History[\s\S]*?(\w+\s+\d+,\s*\d{4})\s*\$([\d,]+)\s*Transfer/i);
  if (saleMatch) {
    fields.lastSaleDate = saleMatch[1].trim();
    fields.lastSalePrice = saleMatch[2].replace(/,/g, '');
  }

  return fields;
}

// Parse old MLS listing PDF into structured fields
function parseMLSListingText(text) {
  const fields = { _source: 'mls_listing' };
  const t = text.replace(/\r\n/g, '\n');

  // ─── REALM/PropTx two-column layout ───
  // pdf-parse extracts the two-column PROPERTY INFORMATION section as two separate blocks:
  //   [values block]    then    [labels block]
  // Positional matching is fragile because value counts can vary.
  // Instead, we extract the values block and parse by known patterns.

  // Find the values block — appears on page 2, between the footer and PROPERTY INFORMATION
  const propInfoIdx = t.indexOf('PROPERTY INFORMATION');
  let valuesBlock = '';
  if (propInfoIdx > 0) {
    const beforePropInfo = t.substring(0, propInfoIdx);
    const prepByIdx = beforePropInfo.lastIndexOf('Prepared By:');
    if (prepByIdx > 0) {
      const afterPrepBy = beforePropInfo.substring(prepByIdx);
      const copyrightEnd = afterPrepBy.indexOf('\n\n');
      if (copyrightEnd > 0) valuesBlock = beforePropInfo.substring(prepByIdx + copyrightEnd + 2).trim();
    }
  }
  const vLines = valuesBlock.split('\n').map(l => l.trim()).filter(Boolean);

  // Helper: find a value in the values block by line pattern
  const findVal = (pattern) => {
    for (const line of vLines) {
      if (pattern instanceof RegExp ? pattern.test(line) : line === pattern) return line;
    }
    return null;
  };

  // ─── ADDRESS (header: "115 County 6 Rd S, Tiny") ───
  const headerAddr = t.match(/\n(\d+\s+[A-Za-z][A-Za-z0-9\s.]+(?:Rd|Road|St|Street|Ave|Avenue|Dr|Drive|Blvd|Cres|Ct|Court|Way|Lane|Ln|Pl|Place|Circle|Cir|Terr|Line|Hwy|Beach)\s*\w*),\s*([A-Za-z\s]+?)(?:\n)/i);
  if (headerAddr) {
    fields.address = headerAddr[1].trim();
    fields.city = headerAddr[2].trim();
  }

  // MLS Number — not imported into form (agent doesn't need it)

  // Taxes & Tax Year from header stats: "TAXES$3,246 (2021)"
  const taxMatch = t.match(/TAXES\s*\$\s*([\d,]+)\s*\((\d{4})\)/i);
  if (taxMatch) {
    fields.taxes = taxMatch[1].replace(/,/g, '');
    fields.taxYear = taxMatch[2];
  }

  // Assessment — value appears as "$335,000 / 2016" in listing info values
  const assessMatch = t.match(/\$([\d,]+)\s*\/\s*(\d{4})/);
  if (assessMatch) {
    fields.assessedValue = assessMatch[1].replace(/,/g, '');
  }

  // Header stats: "3\nBEDS\n3\nBATHS\n6+2\nROOMS\n11\nTOT PRK SPCS\n1100-1500\nSQFT"
  const bedsMatch = t.match(/(\d+)\s*\nBEDS/i);
  if (bedsMatch) fields.bedrooms = bedsMatch[1];
  const bathsMatch = t.match(/(\d+)\s*\nBATHS/i);
  if (bathsMatch) fields.bathrooms = bathsMatch[1];
  const sqftMatch = t.match(/([\d-]+)\s*\nSQFT/i);
  if (sqftMatch) fields.sqftAboveGrade = sqftMatch[1];

  // Legal Description
  const legalMatch = t.match(/LEGAL DESCRIPTION\s*\n\s*(.+?)(?:\n\s*STATUS|\n\s*POSSESSION)/is);
  if (legalMatch) fields.legalDescription = legalMatch[1].replace(/\n/g, ' ').trim();

  // ─── Extract fields from values block using anchor-based positioning ───
  // The values appear in a consistent REALM label order. We anchor off the lot dimension line
  // ("NNN x NNN Feet" pattern) which is unique, then use known offsets to find other values.

  // PIN (9-digit number)
  const pinLine = findVal(/^\d{9}$/);
  if (pinLine) fields.pin = pinLine;

  // ARN (15-digit number)
  const arnLine = findVal(/^\d{15}$/);
  if (arnLine) fields.arn = arnLine;

  // Find the lot dimensions anchor — "NNN x NNN Feet" is unique in the values
  let lotAnchor = -1;
  for (let i = 0; i < vLines.length; i++) {
    if (/^\d+\s*x\s*[\d.]+\s*Feet$/i.test(vLines[i])) { lotAnchor = i; break; }
  }

  // Helper: get value at offset from lot anchor
  const atOffset = (offset) => {
    const idx = lotAnchor + offset;
    return idx >= 0 && idx < vLines.length ? vLines[idx] : null;
  };

  if (lotAnchor >= 0) {
    // Lot dimensions at anchor (offset 0 = LOT SIZE)
    fields.lotDimensions = vLines[lotAnchor];

    // Known offsets from LOT SIZE in REALM property info column:
    // LOT SIZE(0), ACREAGE(+1), SQUARE FEET(+2), DIR/CROSS ST(+3), POOL(+4),
    // A/C(+5), ZONING(+6), UTILITIES-GAS(+7), HEATING TYPE(+8), HEATING SOURCE(+9),
    // WATER(+10), SEWERS(+11), LAUNDRY LEVEL(+12), AREA(+13), MUNICIPALITY(+14),
    // COMMUNITY(+15), ROOMS(+16), BEDROOMS(+17), WASHROOMS(+18), KITCHENS(+19),
    // EXTERIOR(+20), GARAGE TYPE(+21), GARAGE PARKING SPACES(+22), DRIVE(+23),
    // PARKING DRIVE SPACES(+24), TOTAL PARKING SPACES(+25), OTHER STRUCTURES(+26),
    // BASEMENT(+27), UTILITIES-HYDRO(+28)

    // Lot dimensions → parse frontage x depth
    const lotDimLine = vLines[lotAnchor];
    if (lotDimLine) {
      const lotParts = lotDimLine.match(/([\d.]+)\s*x\s*([\d.]+)/);
      if (lotParts) {
        fields.lotFrontage = lotParts[1];
        fields.lotDepth = lotParts[2];
      }
    }

    const acreage = atOffset(1);
    if (acreage) fields.lotSize = acreage + ' acres';

    const sqft = atOffset(2);
    if (sqft && !fields.sqftAboveGrade) fields.sqftAboveGrade = sqft;

    // Pool at offset +4
    const pool = atOffset(4);
    if (pool && !/none/i.test(pool)) {
      fields.hasPool = true;
      if (/salt/i.test(pool)) fields.poolType = 'Saltwater';
      else fields.poolType = 'Chlorine';
    }

    const ac = atOffset(5);
    if (ac) {
      if (/central/i.test(ac)) fields.acTypes = ['Central Air'];
      else if (/ductless|mini/i.test(ac)) fields.acTypes = ['Ductless Mini-Split'];
      else if (/window/i.test(ac)) fields.acTypes = ['Window Units'];
    }

    const zoning = atOffset(6);
    if (zoning) fields.zoning = zoning;

    const heatType = atOffset(8);
    const heatSrc = atOffset(9);
    if (heatType || heatSrc) {
      const h = ((heatType || '') + ' ' + (heatSrc || '')).toLowerCase();
      const types = [];
      if (h.includes('forced air') && h.includes('gas')) types.push('Forced Air Gas');
      else if (h.includes('forced air') && h.includes('propane')) { types.push('Forced Air Propane'); fields.rentalItems = (fields.rentalItems ? fields.rentalItems + ', ' : '') + 'Propane Tank'; }
      else if (h.includes('forced air') && h.includes('oil')) types.push('Oil Furnace');
      else if (h.includes('forced air') && h.includes('electric')) types.push('Electric Baseboard');
      else if (h.includes('forced air')) types.push('Forced Air Gas');
      if (h.includes('propane') && !h.includes('forced air')) { types.push('Forced Air Propane'); fields.rentalItems = (fields.rentalItems ? fields.rentalItems + ', ' : '') + 'Propane Tank'; }
      if (h.includes('baseboard')) types.push('Electric Baseboard');
      if (h.includes('radiant') || h.includes('in-floor')) types.push('Radiant In-Floor');
      if (h.includes('wood') && h.includes('stove')) types.push('Wood Stove');
      if (h.includes('pellet')) types.push('Pellet Stove');
      if (h.includes('mini-split') || h.includes('ductless')) types.push('Mini-Split');
      if (h.includes('boiler') || h.includes('radiator')) types.push('Boiler / Radiator');
      if (h.includes('geothermal')) types.push('Geothermal');
      if (types.length > 0) fields.heatingTypes = types;
    }

    const water = atOffset(10);
    if (water) {
      const w = water.toLowerCase();
      if (w.includes('municipal') || w.includes('city')) fields.waterSource = 'Municipal';
      else if (w.includes('drilled')) fields.waterSource = 'Drilled Well';
      else if (w.includes('dug')) fields.waterSource = 'Dug Well';
      else if (w.includes('well') || w.includes('private')) fields.waterSource = 'Drilled Well';
      else if (w.includes('lake')) fields.waterSource = 'Lake';
      else fields.waterSource = water;
    }

    const sewer = atOffset(11);
    if (sewer) {
      const s = sewer.toLowerCase();
      if (s.includes('municipal') || s === 'sewer') fields.sewerType = 'Municipal Sewer';
      else if (s.includes('septic bed')) fields.sewerType = 'Septic Bed';
      else if (s.includes('septic')) fields.sewerType = 'Septic Tank';
      else if (s.includes('holding')) fields.sewerType = 'Holding Tank';
    }

    const municipality = atOffset(14);
    if (municipality && !fields.city) fields.city = municipality;

    const exterior = atOffset(20);
    if (exterior) fields.exteriorMaterial = exterior;

    const garType = atOffset(21);
    if (garType) {
      if (/attach/i.test(garType)) fields.garageType = 'Attached';
      else if (/detach/i.test(garType)) fields.garageType = 'Detached';
      else if (/built/i.test(garType)) fields.garageType = 'Built-In';
      else if (/carport/i.test(garType)) fields.garageType = 'Carport';
      else if (/none/i.test(garType)) fields.garageType = 'None';
      else fields.garageType = garType;
    }

    const garSpaces = atOffset(22);
    if (garSpaces && /^\d+$/.test(garSpaces)) fields.garageSpaces = garSpaces;

    // Driveway — REALM has "Private Double", "Mutual", etc.
    const driveway = atOffset(23);
    if (driveway) {
      // Extract size from driveway description (e.g. "Private Double" → "Double")
      if (/single/i.test(driveway)) fields.drivewaySize = 'Single';
      else if (/double/i.test(driveway)) fields.drivewaySize = 'Double';
      else if (/triple/i.test(driveway)) fields.drivewaySize = 'Triple';
      else fields.drivewaySize = driveway;
    }

    // Driveway parking spaces (offset +24 = PARKING DRIVE SPACES)
    const driveSpaces = atOffset(24);
    if (driveSpaces && /^\d+$/.test(driveSpaces)) fields.drivewaySpaces = driveSpaces;

    const basement = atOffset(27);
    if (basement) {
      const b = basement.toLowerCase();
      if (b.includes('full')) fields.basementType = 'Full';
      else if (b.includes('partial')) fields.basementType = 'Partial';
      else if (b.includes('crawl')) fields.basementType = 'Crawl Space';
      else if (b.includes('none')) fields.basementType = 'None';
      if (b.includes('finished') && !b.includes('un')) fields.basementFinish = 'Finished';
      else if (b.includes('unfinished')) fields.basementFinish = 'Unfinished';
    }
  }

  // Seller — after ARN line in values block
  if (arnLine) {
    const arnIdx = vLines.indexOf(arnLine);
    if (arnIdx >= 0 && arnIdx + 1 < vLines.length) {
      const sellerLine = vLines[arnIdx + 1];
      if (sellerLine && /[a-zA-Z]/.test(sellerLine) && !/^\d+$/.test(sellerLine)) {
        const parseName = (n) => { const p = n.trim().split(',').map(s => s.trim()); return p.length >= 2 ? `${p[1]} ${p[0]}` : n.trim(); };
        const names = sellerLine.split(/[;]/).map(n => n.trim()).filter(Boolean);
        if (names[0]) fields.sellerName = parseName(names[0]);
        if (names[1]) fields.sellerName2 = parseName(names[1]);
      }
    }
  }

  // Occupancy — find "Owner", "Tenant", "Vacant" in values
  for (const line of vLines) {
    if (/^Owner$/i.test(line)) { fields.occupancy = 'Owner Occupied'; break; }
    if (/^Tenant$/i.test(line)) { fields.occupancy = 'Tenant Occupied'; break; }
    if (/^Vacant$/i.test(line)) { fields.occupancy = 'Vacant'; break; }
  }

  // ─── Property Type (from header: "Detached Bungalow") ───
  const styleMatch = t.match(/(Detached|Semi-Detached|Townhouse|Condo|Bungalow|Cottage)\s*([\w-]*)/i);
  if (styleMatch) {
    const s = styleMatch[1].toLowerCase();
    if (s === 'detached') fields.propertyType = 'Detached';
    else if (s.includes('semi')) fields.propertyType = 'Semi-Detached';
    else if (s.includes('town')) fields.propertyType = 'Townhouse';
    else if (s.includes('condo')) fields.propertyType = 'Condo';
    else if (s.includes('bung')) fields.propertyType = 'Bungalow';
    else if (s.includes('cottage')) fields.propertyType = 'Cottage / Waterfront';
    if (styleMatch[2]) fields.style = `${styleMatch[1]} ${styleMatch[2]}`.trim();
  }

  // ─── WATERFRONT ───
  if (/waterfront/i.test(t.match(/FEATURES[\s\S]*?(?=PROPERTY INFORMATION|SPECIAL|$)/i)?.[0] || '')) {
    fields.isWaterfront = true;
  }
  // Also detect waterfront from property type header
  if (/cottage|waterfront|lakefront|riverfr/i.test(t.substring(0, 500))) {
    fields.isWaterfront = true;
  }

  // ─── FIREPLACE ───
  const fpMatch = t.match(/FIREPLACE[S]?\s*\n\s*(.+?)(?:\n)/i);
  if (fpMatch && !/none/i.test(fpMatch[1])) {
    fields.hasFireplace = true;
    const fpType = fpMatch[1].trim().toLowerCase();
    if (fpType.includes('wood')) fields.fireplaceType = 'Wood';
    else if (fpType.includes('propane')) fields.fireplaceType = 'Propane';
    else if (fpType.includes('gas')) fields.fireplaceType = 'Gas';
    else if (fpType.includes('electric')) fields.fireplaceType = 'Electric';
  }
  // Count fireplaces if mentioned
  const fpCountMatch = t.match(/(\d+)\s*(?:fireplace|f\/p)/i);
  if (fpCountMatch && fields.hasFireplace) fields.numberOfFireplaces = fpCountMatch[1];

  // ─── ROOM INFO table ───
  const roomSection = t.match(/ROOMLEVELDIMENSIONSNOTES\s*\n([\s\S]*?)(?:\nWASHROOM INFO|\n\s*$)/i)
    || t.match(/ROOM\s+LEVEL\s+DIMENSIONS\s+NOTES\s*\n([\s\S]*?)(?:\n\s*WASHROOM|\n\s*$)/i);
  if (roomSection) {
    const rooms = [];
    const lines = roomSection[1].split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const rm = line.match(/^(.+?)(Main|2nd|3rd|Bsmt|Lower|Upper|Basement)([\d.]+\s*m\s*x\s*[\d.]+\s*m\s*\([\d.]+\s*ft\s*x\s*[\d.]+\s*ft\))(.*)/i);
      if (rm) {
        const ftMatch = rm[3].match(/([\d.]+)\s*ft\s*x\s*([\d.]+)\s*ft/);
        const dims = ftMatch ? `${ftMatch[1]} x ${ftMatch[2]}` : rm[3].trim();
        const notes = rm[4].trim();
        let flooring = '';
        if (/hardwood/i.test(notes)) flooring = 'Hardwood';
        else if (/laminate/i.test(notes)) flooring = 'Laminate';
        else if (/tile|ceramic/i.test(notes)) flooring = 'Tile';
        else if (/carpet/i.test(notes)) flooring = 'Carpet';
        else if (/vinyl/i.test(notes)) flooring = 'Vinyl Plank';
        const level = rm[2] === '2nd' || rm[2] === '3rd' ? 'Upper' : rm[2] === 'Bsmt' ? 'Basement' : rm[2];
        // Auto-detect room details from notes
        const details = [];
        if (/crown\s*mould/i.test(notes)) details.push('Crown Moulding');
        if (/pot\s*light/i.test(notes)) details.push('Pot Lights');
        if (/walk.?in\s*closet|w\/i\s*closet/i.test(notes)) details.push('Walk-in Closet');
        else if (/closet/i.test(notes)) details.push('Closet');
        if (/large\s*window|picture\s*window|bay\s*window/i.test(notes)) details.push('Large Window');
        if (/upgraded\s*light/i.test(notes)) details.push('Upgraded Lighting');
        rooms.push({ name: rm[1].trim(), level, dimensions: dims, flooring, features: notes, details });
      }
    }
    if (rooms.length > 0) fields.rooms = rooms;
  }


  // ─── Foundation (optional field in REALM, search by label or value pattern) ───
  // Some REALM listings include FOUNDATION in the property info column
  const foundInLabels = t.match(/FOUNDATION\b/i);
  if (foundInLabels) {
    // Find foundation value in the values block by known terms
    for (const line of vLines) {
      const fl = line.toLowerCase();
      if (/poured|concrete|block|stone|slab|crawl|pier|post/i.test(fl) && line.length < 30) {
        if (fl.includes('poured') || fl.includes('concrete')) fields.foundationType = 'Poured Concrete';
        else if (fl.includes('block')) fields.foundationType = 'Block';
        else if (fl.includes('stone')) fields.foundationType = 'Stone';
        else if (fl.includes('slab')) fields.foundationType = 'Slab';
        else if (fl.includes('crawl')) fields.foundationType = 'Crawl Space';
        else if (fl.includes('pier') || fl.includes('post')) fields.foundationType = 'Pier / Post';
        else fields.foundationType = line;
        break;
      }
    }
  }

  // ─── EXTRAS (Inclusions only — never transfer exclusions) ───
  const extrasMatch = t.match(/EXTRAS\s*\n\s*(.+?)(?:\n\s*PROPERTY HISTORY|\n\n)/is);
  if (extrasMatch) {
    const extras = extrasMatch[1].trim();
    const inclPart = extras.match(/Incl:\s*(.+?)(?:\.\s*Excl:|$)/is);
    if (inclPart) {
      const appliances = inclPart[1].split(',').map(a => a.trim()).filter(Boolean);
      const applianceMap = {
        'dishwasher': 'Dishwasher', 'dryer': 'Dryer', 'refrigerator': 'Fridge', 'fridge': 'Fridge',
        'stove': 'Stove', 'washer': 'Washer', 'microwave': 'Microwave', 'range hood': 'Range Hood',
        'garburator': 'Garburator', 'water softener': 'Water Softener', 'central vac': 'Central Vac',
        'wine fridge': 'Wine Fridge', 'chest freezer': 'Chest Freezer'
      };
      const matched = [];
      for (const a of appliances) {
        const key = a.toLowerCase();
        if (applianceMap[key]) matched.push(applianceMap[key]);
      }
      if (matched.length > 0) fields.appliancesIncluded = matched;
    }
    // Never transfer exclusions from MLS listing — agent fills these in fresh
  }

  // ─── CLIENT REMARKS as MLS description ───
  const remarksMatch = t.match(/CLIENT REMARKS\s*\n\s*([\s\S]+?)(?:\nBROKERAGE REMARKS|\n\$)/i);
  if (remarksMatch) fields.mlsDescription = remarksMatch[1].trim();

  return fields;
}

app.post('/api/listing-form/import-pdf', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.json({ success: false, error: 'No file uploaded' });

  const importType = req.body.type || 'auto'; // 'geowarehouse', 'listing', or 'auto'

  try {
    const pdfData = await pdfParse(req.file.buffer);
    const text = pdfData.text || '';

    if (!text || text.length < 50) {
      return res.json({ success: false, error: 'Could not extract text from PDF. The file may be image-only or corrupted.' });
    }

    // Auto-detect type
    let detectedType = importType;
    if (importType === 'auto') {
      detectedType = /geowarehouse|teranet|property report|PIN\s+\d{9}/i.test(text) ? 'geowarehouse' : 'listing';
    }

    let fields;
    if (detectedType === 'geowarehouse') {
      fields = parseGeoWarehouseText(text);
    } else {
      fields = parseMLSListingText(text);
    }

    // Count how many fields we actually extracted
    const fieldCount = Object.keys(fields).filter(k => k !== '_source' && fields[k] && (typeof fields[k] !== 'object' || (Array.isArray(fields[k]) && fields[k].length > 0))).length;

    console.log(`[ListingForm] PDF import (${detectedType}): extracted ${fieldCount} fields from ${req.file.originalname}`);

    res.json({
      success: true,
      type: detectedType,
      fields,
      fieldCount,
      textLength: text.length,
    });

  } catch (err) {
    console.error('[ListingForm] PDF parse error:', err.message);
    res.json({ success: false, error: `Failed to parse PDF: ${err.message}` });
  }
});

// ─────────────────────────────────────────────
// SISU EXPORT — Generate field mapping for Chrome automation
// ─────────────────────────────────────────────
app.get('/api/listing-form/:id/sisu-export', async (req, res) => {
  try {
    const filePath = path.join(DATA_DIR, 'listing-forms', `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) return res.json({ success: false, error: 'Property not found' });
    const form = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Build Sisu field mapping: { sisuLabel: value }
    // These map to the exact label text on the Sisu Draft 100a form
    const fields = {};
    const set = (label, val) => { if (val && val.toString().trim()) fields[label] = val.toString().trim(); };

    // ─── Basic Info ───
    set('Address Line 1', form.address);
    set('City', form.city);
    set('Province', 'Ontario');
    set('Postal Code', form.postalCode);
    set('Year Built', form.yearBuilt);
    set('Zoning', form.zoning);
    set('PIN #', form.pin);
    set('Assessment Roll Number (ARN)', form.arn);
    set('Legal Description', form.legalDescription);
    set('Property Tax', form.taxes);
    set('Tax Year', form.taxYear);
    set('MPAC Assessment', form.assessedValue);

    // ─── Lot ───
    set('Lot Front in Feet', form.lotFrontage);
    set('Lot Depth in Feet', form.lotDepth);
    set('Acreage', form.lotSize ? form.lotSize.replace(/\s*acres?\s*/i, '').trim() : '');
    set('Square Footage Above Grade', form.sqftAboveGrade);
    set('Total Finished Sq Ft', form.totalFinishedSqFt);

    // ─── Beds & Baths ───
    set('Number of Total Bedrooms', form.bedrooms);
    set('Number of Full Bathrooms', form.bathrooms);
    set('Number of Above Grade Bedrooms', form.bedrooms);

    // ─── Structure ───
    set('Style', form.style);
    set('Foundation Detail', form.foundationType);
    set('Exterior Finish', form.exteriorMaterial);
    set('Roof Type', form.roofType);
    set('Age of Roof', form.roofAge);

    // ─── Plumbing & Electrical ───
    set('Plumbing', form.plumbing);
    set('AMP Service', form.electricalAmps);

    // ─── Garage & Parking ───
    if (form.garageType && form.garageType !== 'None') {
      set('Garage (Yes or No)', 'Yes');
      set('Garage Type', form.garageType);
    } else {
      set('Garage (Yes or No)', 'No');
    }
    set('Number of Garage Parking Spaces', form.garageSpaces);
    set('Driveway/Parking', form.drivewaySize);
    set('Driveway Type', form.drivewayMaterial);
    set('Number of Driveway Parking Spaces', form.drivewaySpaces);

    // ─── Water & Sewer ───
    set('Water Type', form.waterSource);
    set('Sewer', form.sewerType);

    // ─── Basement ───
    set('Basement Finish', form.basementFinish);
    set('Basement Size', form.basementType);

    // ─── Heating ───
    if (form.heatingTypes && form.heatingTypes.length > 0) {
      const ht = form.heatingTypes[0] || '';
      if (ht.includes('Forced Air')) set('Heat Type', 'Forced Air');
      else if (ht.includes('Baseboard')) set('Heat Type', 'Baseboard');
      else if (ht.includes('Radiant')) set('Heat Type', 'Radiant');
      else if (ht.includes('Boiler')) set('Heat Type', 'Boiler');
      else set('Heat Type', ht);

      if (ht.includes('Gas')) set('Heat Source', 'Gas');
      else if (ht.includes('Propane')) set('Heat Source', 'Propane');
      else if (ht.includes('Electric')) set('Heat Source', 'Electric');
      else if (ht.includes('Oil')) set('Heat Source', 'Oil');
      else if (ht.includes('Wood')) set('Heat Source', 'Wood');
    }
    set('Age of Furnace', form.furnaceAge);
    if (form.furnaceAge || (form.heatingTypes && form.heatingTypes.length > 0)) set('Furnace?', 'Yes');

    // ─── Air Conditioning ───
    if (form.acTypes && form.acTypes.length > 0 && !form.acTypes.includes('None')) {
      set('Air Conditioning?', form.acTypes.join(', '));
    }

    // ─── Fireplace ───
    if (form.hasFireplace) {
      set('Fireplace', 'Yes');
      set('Number of Fireplaces', form.numberOfFireplaces);
      if (form.fireplaceType === 'Wood') set('Number of Wood F/P', form.numberOfFireplaces || '1');
      else if (form.fireplaceType === 'Gas' || form.fireplaceType === 'Propane') set('Number of Gas FP', form.numberOfFireplaces || '1');
      if (form.fireplaceType === 'Electric') set('Electric Fireplace Included?', 'Yes');
    }

    // ─── Hot Water ───
    set('Water Heater', form.hotWaterType);

    // ─── Inclusions / Exclusions ───
    const inclParts = [];
    if (form.appliancesIncluded && form.appliancesIncluded.length > 0) inclParts.push(form.appliancesIncluded.join(', '));
    if (form.otherInclusions && form.otherInclusions.length > 0) inclParts.push(form.otherInclusions.join(', '));
    if (form.hasPool) inclParts.push(`Pool (${form.poolType || 'Chlorine'})`);
    if (form.hasHotTub) inclParts.push('Hot Tub');
    if (form.inclusionsNotes) inclParts.push(form.inclusionsNotes);
    set('Inclusions', inclParts.join(', '));
    set('Exclusions', form.exclusions);
    set('Rental Items or Under Contract', form.rentalItems);

    // ─── Occupancy ───
    set('Occupancy', form.occupancy);

    // ─── Pool ───
    if (form.hasPool) {
      set('Pool', form.poolType === 'Saltwater' ? 'In Ground - Salt' : 'In Ground');
    }

    // ─── Hot Tub ───
    if (form.hasHotTub) set('Hot Tub', 'Yes');

    // ─── Waterfront ───
    if (form.isWaterfront) {
      set('Waterfront (Yes or No)', 'Yes');
      set('Waterfront Type', form.waterfrontType);
      set('Water Body Type', form.waterBodyType);
      set('Body of Water Name', form.waterBody);
      set('Waterfront Footage (ft)', form.waterfrontFootage);
      set('Shoreline', form.shoreline);
      set('Shoreline Exposure', form.shorelineExposure);
      set('Docking Type', form.dock);
    }

    // ─── Showing ───
    set('Lockbox Code', form.lockboxCode);
    set('Special Showing Instructions', [form.accessNotes, form.showingRestrictions, form.showingInstructions].filter(Boolean).join('. '));

    // ─── Staging & Photography ───
    set('Notes for Staging', form.stagingNotes);
    set('Notes for Photography', form.photographyNotes);

    // ─── Marketing ───
    set('Top 5 Reasons Someone Would Want to Buy', form.top5Reasons);
    set('TRREB Extras', form.mlsDescription);

    // ─── Rooms (up to 24 in Sisu) ───
    const roomExport = [];
    const rooms = form.rooms || [];
    rooms.forEach((room, idx) => {
      const num = idx + 1;
      if (num > 24) return;
      const roomData = {};
      roomData[`Room ${num} Type`] = room.name || '';

      // Map level
      let level = room.level || 'Main';
      if (level === 'Upper') level = '2nd';
      else if (level === 'Basement') level = 'Bsmt';
      roomData[`Room ${num} Level`] = level;

      // Build details string from chips + flooring + notes
      const detailParts = [];
      if (room.flooring) detailParts.push(room.flooring);
      if (room.details && room.details.length > 0) detailParts.push(...room.details);
      roomData[`Room ${num} Details`] = detailParts.join(', ');

      if (room.features) roomData[`Additional Notes for Room ${num}`] = room.features;

      roomExport.push(roomData);
      // Merge into main fields
      Object.assign(fields, roomData);
    });

    const fieldCount = Object.keys(fields).length;
    console.log(`[Sisu Export] Property ${req.params.id}: ${fieldCount} fields mapped, ${rooms.length} rooms`);

    res.json({
      success: true,
      fieldCount,
      roomCount: rooms.length,
      sisuUrl: form.sisuTransactionUrl || '',
      fields,
      rooms: roomExport,
    });

  } catch (err) {
    console.error('[Sisu Export] Error:', err.message);
    res.json({ success: false, error: err.message });
  }
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
