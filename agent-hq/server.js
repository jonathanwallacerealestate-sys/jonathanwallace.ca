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
const TJ_BATCH_SIZE = 100;

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
    leadsSkippedExisting: 0,
    notesAdded: 0,
    emailsSkipped: 0,
    errors: [],
    lastProcessedAt: null,
    stageId: null,        // FUB stage ID for "Old Team Jordan Leads"
    processedEmailIds: {}, // email ID → result ('created'|'existing'|'skipped'|'error')
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

  // Extract phone numbers
  const phones = body.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || [];
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

// STEP 2: POST /api/tj/process — Fetch next 100 message IDs from Gmail, process them against FUB
app.post('/api/tj/process', async (req, res) => {
  if (!FUB_API_KEY || !tokens) return res.json({ error: 'Not configured' });

  const state = loadTjState();
  if (!state.labelId) {
    return res.json({ error: 'Run setup first — no Gmail label found.', success: false });
  }

  state.status = 'processing';
  saveTjState(state);

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const batchResults = { processed: 0, created: 0, skippedExisting: 0, skippedNoContact: 0, notesAdded: 0, errors: 0 };

  // 1) Fetch next page of message IDs from Gmail (100 per batch)
  const listParams = { userId: 'me', labelIds: [state.labelId], maxResults: TJ_BATCH_SIZE };
  if (state.nextPageToken) listParams.pageToken = state.nextPageToken;

  let batchIds = [];
  let hasMore = false;

  try {
    const listResp = await gmail.users.messages.list(listParams);
    batchIds = (listResp.data.messages || []).map(m => m.id);
    state.nextPageToken = listResp.data.nextPageToken || null;
    hasMore = !!state.nextPageToken;

    // Update total estimate from Gmail's resultSizeEstimate
    if (listResp.data.resultSizeEstimate && state.totalMessages === 0) {
      state.totalMessages = listResp.data.resultSizeEstimate;
    }
    console.log(`[TJ] Batch ${state.currentBatch + 1}: fetched ${batchIds.length} message IDs (hasMore: ${hasMore})`);
  } catch (err) {
    console.error('[TJ] Gmail list error:', err.message);
    state.status = 'paused';
    saveTjState(state);
    return res.json({ error: `Gmail error: ${err.message}`, success: false });
  }

  if (batchIds.length === 0) {
    state.status = 'complete';
    saveTjState(state);
    return res.json({ success: true, batch: state.currentBatch, batchResults, complete: true, progress: buildTjProgress(state) });
  }

  // 2) Process each email in this batch
  for (const msgId of batchIds) {
    if (state.processedEmailIds[msgId]) {
      batchResults.processed++;
      state.processedCount++;
      continue;
    }

    try {
      const full = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'full' });
      const headers = full.data.payload.headers;
      const body = getEmailBody(full.data.payload);
      const parsed = parseEmailForContact(headers, body);

      const contactEmail = parsed.emails[0] || null;
      const contactName = parsed.fromName || (parsed.names.length > 0 ? parsed.names[0] : null);

      if (!contactEmail && !contactName) {
        state.processedEmailIds[msgId] = 'skipped';
        state.emailsSkipped++;
        batchResults.skippedNoContact++;
        batchResults.processed++;
        state.processedCount++;
        continue;
      }

      // Cross-reference against FUB
      const existing = await findPersonInFub(contactEmail, contactName);

      if (existing) {
        if (parsed.noteWorthy.length > 0) {
          try {
            await fetch(`${FUB_BASE}/notes`, {
              method: 'POST',
              headers: fubHeaders(),
              body: JSON.stringify({
                personId: existing.id,
                body: `<p><strong>Team Jordan Archive:</strong></p><p>${parsed.noteWorthy.join(' | ')}</p><p><em>Email: ${parsed.subject} (${parsed.date})</em></p>`,
                isHtml: true,
              }),
            });
            state.notesAdded++;
            batchResults.notesAdded++;
          } catch {}
        }
        state.processedEmailIds[msgId] = 'existing';
        state.leadsSkippedExisting++;
        batchResults.skippedExisting++;
        batchResults.processed++;
        state.processedCount++;
        continue;
      }

      // New contact — create in FUB
      const nameParts = (contactName || 'Unknown').split(/\s+/);
      const firstName = nameParts[0] || 'Unknown';
      const lastName = nameParts.slice(1).join(' ') || '';
      const isRealtor = parsed.isRealtor;

      // For realtors: determine source type and strip property-specific data
      let realtorSource = null;
      if (isRealtor) {
        if (parsed.isShowingRequest) realtorSource = 'Showing Request';
        else if (parsed.isBrokerBuyRequest) realtorSource = 'Broker Buy Request';
        else if (parsed.brokerage) realtorSource = 'Brokerage Signature';
        else realtorSource = 'Email Correspondence';
      }

      // Filter noteWorthy: realtors should NOT get property address, MLS, deal value, closing date
      const noteWorthyForContact = isRealtor
        ? parsed.noteWorthy.filter(n => !n.startsWith('Property:') && !n.startsWith('MLS#:') && !n.startsWith('Deal Value:') && !n.startsWith('Closing:') && !n.startsWith('YSP:'))
        : parsed.noteWorthy;

      const newPerson = {
        firstName, lastName,
        stage: isRealtor ? 'Real Estate Agent' : 'Old Team Jordan Leads',
        source: 'Team Jordan Email Archive',
        emails: contactEmail ? [{ value: contactEmail }] : [],
        phones: parsed.phones.length > 0 ? [{ value: parsed.phones[0], type: 'Mobile' }] : [],
        tags: isRealtor
          ? ['Realtor', 'Agent', 'Team Jordan Import', 'Agent HQ Import']
          : ['Team Jordan Import', 'Agent HQ Import'],
      };
      if (isRealtor && parsed.brokerage) newPerson.company = parsed.brokerage;

      try {
        const createResp = await fetch(`${FUB_BASE}/people`, {
          method: 'POST',
          headers: fubHeaders(),
          body: JSON.stringify(newPerson),
        });

        if (createResp.ok) {
          const created = await createResp.json();

          const noteLines = [
            `<p><strong>Imported from Team Jordan Email Archive</strong></p>`,
          ];
          if (isRealtor && realtorSource) noteLines.push(`<p><strong>Source:</strong> ${realtorSource}</p>`);
          noteLines.push(`<p>Original email: "${parsed.subject}" (${parsed.date})</p>`);
          if (noteWorthyForContact.length > 0) noteLines.push(`<p><strong>${isRealtor ? 'Agent Info' : 'Deal Info'}:</strong> ${noteWorthyForContact.join(' | ')}</p>`);
          if (parsed.emails.length > 1) noteLines.push(`<p>Additional emails: ${parsed.emails.slice(1).join(', ')}</p>`);
          if (parsed.phones.length > 1) noteLines.push(`<p>Additional phones: ${parsed.phones.slice(1).join(', ')}</p>`);
          if (!isRealtor && parsed.names.length > 0) noteLines.push(`<p>Names referenced: ${parsed.names.join(', ')}</p>`);

          try {
            await fetch(`${FUB_BASE}/notes`, {
              method: 'POST', headers: fubHeaders(),
              body: JSON.stringify({ personId: created.id, body: noteLines.join(''), subject: 'Team Jordan Import — Agent HQ', isHtml: true }),
            });
            state.notesAdded++;
            batchResults.notesAdded++;
          } catch {}

          state.processedEmailIds[msgId] = 'created';
          if (isRealtor) { state.realtorsCreated++; } else { state.leadsCreated++; }
          batchResults.created++;

          state.recentActivity.unshift({
            action: 'created', type: isRealtor ? 'realtor' : 'lead', isRealtor,
            name: `${firstName} ${lastName}`.trim(), email: contactEmail,
            fubId: created.id, brokerage: parsed.brokerage,
            at: new Date().toISOString(), noteWorthy: parsed.noteWorthy,
          });
          if (state.recentActivity.length > 20) state.recentActivity = state.recentActivity.slice(0, 20);
        } else {
          const errText = await createResp.text();
          state.processedEmailIds[msgId] = 'error';
          state.errors.push({ msgId, error: errText.slice(0, 200) });
          batchResults.errors++;
        }
      } catch (err) {
        state.processedEmailIds[msgId] = 'error';
        state.errors.push({ msgId, error: err.message });
        batchResults.errors++;
      }

      batchResults.processed++;
      state.processedCount++;

      // Rate limit: 200ms delay between FUB creates
      await new Promise(r => setTimeout(r, 200));

    } catch (err) {
      state.processedEmailIds[msgId] = 'error';
      state.errors.push({ msgId, error: err.message });
      batchResults.errors++;
      state.processedCount++;
      batchResults.processed++;
    }
  }

  state.currentBatch++;
  state.lastProcessedAt = new Date().toISOString();
  state.status = hasMore ? 'paused' : 'complete';

  if (state.errors.length > 100) state.errors = state.errors.slice(-100);
  // Update total with running count if we haven't finished
  if (hasMore && state.processedCount > state.totalMessages) {
    state.totalMessages = state.processedCount; // floor estimate
  }

  saveTjState(state);

  res.json({
    success: true,
    batch: state.currentBatch,
    batchResults,
    hasMore,
    complete: !hasMore && batchIds.length === 0,
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
  });
});

// POST /api/tj/reset — reset the import (start over)
app.post('/api/tj/reset', (req, res) => {
  try { fs.unlinkSync(TJ_STATE_PATH); } catch {}
  res.json({ success: true, message: 'Import state reset' });
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
