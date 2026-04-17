import express from 'express';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// âââââââââââââââââââââââââââââââââââââââââââââ
// Google OAuth 2.0 Configuration
// âââââââââââââââââââââââââââââââââââââââââââââ
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/api/auth/callback`;
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const TOKEN_PATH = path.join(__dirname, '.gcal-tokens.json');

const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);

// âââââââââââââââââââââââââââââââââââââââââââââ
// Token Storage & Auto-Refresh
// âââââââââââââââââââââââââââââââââââââââââââââ
let tokens = null;
let tokenError = null;

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      oauth2Client.setCredentials(tokens);
      tokenError = null;
      console.log('[GCal] Tokens loaded from disk');
      return true;
    }
  } catch (err) {
    console.error('[GCal] Failed to load tokens:', err.message);
    tokenError = err.message;
  }
  return false;
}

function saveTokens(newTokens) {
  if (tokens && tokens.refresh_token && !newTokens.refresh_token) {
    newTokens.refresh_token = tokens.refresh_token;
  }
  tokens = newTokens;
  try {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('[GCal] Tokens saved to disk');
  } catch (err) {
    console.error('[GCal] Failed to save tokens:', err.message);
  }
}

oauth2Client.on('tokens', (newTokens) => {
  console.log('[GCal] Token auto-refreshed');
  saveTokens(newTokens);
  tokenError = null;
});

async function proactiveRefresh() {
  if (!tokens || !tokens.refresh_token) return;
  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    saveTokens(credentials);
    oauth2Client.setCredentials(credentials);
    tokenError = null;
    console.log('[GCal] Proactive token refresh successful');
  } catch (err) {
    console.error('[GCal] Proactive refresh failed:', err.message);
    tokenError = err.message;
  }
}

setInterval(proactiveRefresh, 45 * 60 * 1000);

loadTokens();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

function isOAuthConfigured() {
  return GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CLIENT_ID !== '';
}

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
    prompt: 'consent',
    include_granted_scopes: true,
  });
  res.redirect(authUrl);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?gcal=error&reason=' + encodeURIComponent(error));
  if (!code) return res.redirect('/?gcal=error&reason=no_code');
  try {
    const { tokens: newTokens } = await oauth2Client.getToken(code);
    saveTokens(newTokens);
    oauth2Client.setCredentials(newTokens);
    tokenError = null;
    console.log('[GCal] OAuth completed successfully');
    res.redirect('/?gcal=connected');
  } catch (err) {
    console.error('[GCal] Token exchange failed:', err.message);
    tokenError = err.message;
    res.redirect('/?gcal=error&reason=' + encodeURIComponent(err.message));
  }
});

app.post('/api/auth/disconnect', (req, res) => {
  tokens = null;
  tokenError = null;
  try { if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH); } catch (_) {}
  res.json({ status: 'disconnected' });
});

app.get('/api/calendar/status', async (req, res) => {
  if (!isOAuthConfigured()) return res.json({ connected: false, configured: false, reason: 'Google OAuth credentials not configured in Railway.' });
  if (!tokens || !tokens.access_token) return res.json({ connected: false, configured: true, reason: 'Not connected - click Reconnect to authorize Google Calendar.' });
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await calendar.calendarList.list({ maxResults: 1 });
    return res.json({ connected: true, configured: true, lastRefresh: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null, reason: null });
  } catch (err) {
    console.error('[GCal] Status check failed:', err.message);
    if (tokens.refresh_token) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        saveTokens(credentials);
        oauth2Client.setCredentials(credentials);
        tokenError = null;
        return res.json({ connected: true, configured: true, reason: null });
      } catch (refreshErr) { tokenError = refreshErr.message; }
    }
    return res.json({ connected: false, configured: true, reason: tokenError || err.message });
  }
});

app.get('/api/calendar/events', async (req, res) => {
  if (!tokens || !tokens.access_token) return res.status(401).json({ error: 'Not authenticated', events: [] });
  try {
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
      id: ev.id, title: ev.summary || '(No title)', description: ev.description || '',
      start: ev.start.dateTime || ev.start.date, end: ev.end.dateTime || ev.end.date,
      location: ev.location || '', allDay: !ev.start.dateTime, status: ev.status,
      htmlLink: ev.htmlLink,
      attendees: (ev.attendees || []).map(a => ({ email: a.email, name: a.displayName, status: a.responseStatus })),
      conferenceLink: ev.hangoutLink || (ev?.conferenceData?.entryPoints?.[0]?.uri) || null,
    }));
    res.json({ events, count: events.length });
  } catch (err) {
    console.error('[GCal] Failed to fetch events:', err.message);
    if (tokens.refresh_token) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        saveTokens(credentials);
        oauth2Client.setCredentials(credentials);
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const response = await calendar.events.list({ calendarId: 'primary', timeMin: req.query.timeMin || startOfDay.toISOString(), timeMax: req.query.timeMax || endOfDay.toISOString(), maxResults: 50, singleEvents: true, orderBy: 'startTime' });
        const events = (response.data.items || []).map(ev => ({ id: ev.id, title: ev.summary || '(No title)', start: ev.start.dateTime || ev.start.date, end: ev.end.dateTime || ev.end.date, location: ev.location || '', allDay: !ev.start.dateTime, status: ev.status, htmlLink: ev.htmlLink }));
        return res.json({ events, count: events.length });
      } catch (_) {}
    }
    res.status(500).json({ error: err.message, events: [] });
  }
});

app.get('/api/calendar/upcoming', async (req, res) => {
  if (!tokens || !tokens.access_token) return res.status(401).json({ error: 'Not authenticated', events: [] });
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const now = new Date();
    const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const response = await calendar.events.list({ calendarId: 'primary', timeMin: now.toISOString(), timeMax: weekOut.toISOString(), maxResults: 100, singleEvents: true, orderBy: 'startTime' });
    const events = (response.data.items || []).map(ev => ({ id: ev.id, title: ev.summary || '(No title)', start: ev.start.dateTime || ev.start.date, end: ev.end.dateTime || ev.end.date, location: ev.location || '', allDay: !ev.start.dateTime }));
    res.json({ events, count: events.length });
  } catch (err) {
    res.status(500).json({ error: err.message, events: [] });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Agent HQ] Server running on port ${PORT}`);
  console.log(`[GCal] OAuth configured: ${isOAuthConfigured()}`);
  console.log(`[GCal] Tokens loaded: ${!!tokens}`);
  if (tokens) console.log(`[GCal] Token expires: ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'unknown'}`);
});
