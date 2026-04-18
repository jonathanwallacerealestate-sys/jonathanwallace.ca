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
