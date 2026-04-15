/**
 * Gmail API client — refactored from the inline uses in routes/briefing.js,
 * routes/flaggedEmails.js, and services/claude.js so every Gmail call goes
 * through one auth + one client.
 *
 * Required env vars:
 *   GMAIL_CLIENT_ID
 *   GMAIL_CLIENT_SECRET
 *   GMAIL_REFRESH_TOKEN
 *   GMAIL_USER (optional; defaults to jonathanwallacerealestate@gmail.com)
 *
 * If the refresh token isn't set, isConfigured() returns false and every
 * method throws GMAIL_NOT_CONFIGURED — callers should 503 gracefully.
 */
const { google } = require('googleapis');

let _clientCache = null;
function getClient() {
  if (!process.env.GMAIL_REFRESH_TOKEN) {
    const err = new Error('Gmail not configured. Set GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN env vars.');
    err.code = 'GMAIL_NOT_CONFIGURED';
    throw err;
  }
  if (_clientCache) return _clientCache;
  const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  _clientCache = google.gmail({ version: 'v1', auth: oauth2 });
  return _clientCache;
}

function isConfigured() {
  return !!process.env.GMAIL_REFRESH_TOKEN;
}

/**
 * Self-diagnose Gmail setup. Returns a structured report so the dashboard
 * can tell Jonathan exactly what's wrong.
 */
async function diagnose() {
  const report = {
    env: {
      GMAIL_CLIENT_ID: !!process.env.GMAIL_CLIENT_ID,
      GMAIL_CLIENT_SECRET: !!process.env.GMAIL_CLIENT_SECRET,
      GMAIL_REFRESH_TOKEN: !!process.env.GMAIL_REFRESH_TOKEN,
      GMAIL_USER: process.env.GMAIL_USER || null
    },
    can_auth: false,
    can_list_inbox: false,
    can_read_message: false,
    can_send: false,
    scopes: null,
    messages_count: null,
    sample_message_id: null,
    error: null,
    fix: null
  };

  if (!report.env.GMAIL_CLIENT_ID || !report.env.GMAIL_CLIENT_SECRET || !report.env.GMAIL_REFRESH_TOKEN) {
    report.error = 'Gmail environment variables are missing.';
    report.fix = 'Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in Railway → Variables. See HANDOFF.md §5 for the OAuth playground walkthrough.';
    return report;
  }

  // Try an auth exchange (get the access token info)
  const { google } = require('googleapis');
  const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  try {
    const tok = await oauth2.getAccessToken();
    report.can_auth = !!(tok && tok.token);
    // Fetch token metadata (includes scopes)
    if (tok && tok.token) {
      try {
        const res = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(tok.token));
        if (res.ok) {
          const info = await res.json();
          report.scopes = info.scope || null;
        }
      } catch (e) { /* ignore */ }
    }
  } catch (e) {
    report.error = 'Could not exchange refresh token for access token: ' + e.message;
    report.fix = 'The refresh token is missing or invalid. Re-mint one via developers.google.com/oauthplayground — see HANDOFF.md §5.';
    return report;
  }

  if (!report.can_auth) {
    report.error = 'Gmail refused the refresh token.';
    report.fix = 'Re-mint the refresh token via the OAuth playground with scopes: https://www.googleapis.com/auth/gmail.modify';
    return report;
  }

  // Try listing the inbox
  try {
    const gm = google.gmail({ version: 'v1', auth: oauth2 });
    const list = await gm.users.messages.list({ userId: 'me', q: 'in:inbox', maxResults: 1 });
    report.can_list_inbox = true;
    report.messages_count = list.data.resultSizeEstimate || (list.data.messages || []).length;
    if (list.data.messages && list.data.messages[0]) {
      report.sample_message_id = list.data.messages[0].id;
      // Try reading it
      try {
        await gm.users.messages.get({ userId: 'me', id: list.data.messages[0].id, format: 'metadata' });
        report.can_read_message = true;
      } catch (e) {
        report.error = 'Listed inbox but could not read a message: ' + e.message;
        report.fix = 'Refresh token probably lacks the right scope. Re-mint with https://www.googleapis.com/auth/gmail.modify (or at minimum https://www.googleapis.com/auth/gmail.readonly).';
      }
    }
  } catch (e) {
    const msg = e.message || String(e);
    report.error = 'Could not list Gmail inbox: ' + msg;
    if (/insufficient\s*auth|insufficient\s*permission|access\s*not\s*configured|scope/i.test(msg)) {
      report.fix = 'Your refresh token was minted with SEND/COMPOSE scope only — it cannot read the inbox. Re-mint it via developers.google.com/oauthplayground using scope: https://www.googleapis.com/auth/gmail.modify. Then update GMAIL_REFRESH_TOKEN in Railway Variables and restart the service.';
    } else {
      report.fix = 'Check Railway logs for the full error stack. The most common cause is a missing scope — re-mint the token with gmail.modify.';
    }
    return report;
  }

  // send capability check — we won't actually send, just confirm scope
  if (report.scopes) {
    report.can_send = /gmail\.send|gmail\.modify|mail\.google\.com/i.test(report.scopes);
  }

  if (!report.error && report.can_list_inbox && report.can_read_message) {
    report.fix = 'Gmail is healthy. If the Sync button still shows 0 results, check Railway logs for per-message errors.';
  }

  return report;
}

function fromAddress() {
  return process.env.GMAIL_USER || 'jonathanwallacerealestate@gmail.com';
}

// Gmail web deep-link for a thread
function threadWebLink(threadId) {
  if (!threadId) return null;
  return `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
}

// ---------- Message listing ----------

/**
 * List message IDs matching a Gmail search query.
 * Returns [{ id, threadId }, ...] capped at `maxResults`.
 */
async function listMessageIds({ query = 'in:inbox newer_than:7d', maxResults = 50 } = {}) {
  const gmail = getClient();
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: Math.min(Math.max(maxResults, 1), 500)
  });
  return res.data.messages || [];
}

/**
 * Fetch a single message with full payload parsed into a friendlier shape.
 * Returns { id, threadId, historyId, snippet, labelIds,
 *           headers: { from, to, cc, subject, date, messageId, inReplyTo },
 *           bodyPlain, bodyHtml, attachments: [{ name, mimeType, size }],
 *           internalDate }
 */
async function getMessage(id) {
  const gmail = getClient();
  const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  return parseMessage(res.data);
}

/**
 * Lightweight metadata fetch — faster than full; doesn't parse body.
 * Useful for "does this thread have my reply in it" checks.
 */
async function getMessageMeta(id) {
  const gmail = getClient();
  const res = await gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'metadata',
    metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-Id', 'In-Reply-To']
  });
  return parseMessage(res.data, { metaOnly: true });
}

/**
 * Load all messages in a thread, parsed. Used to detect whether I've replied.
 */
async function getThread(threadId) {
  const gmail = getClient();
  const res = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'metadata',
    metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-Id', 'In-Reply-To'] });
  return {
    id: res.data.id,
    messages: (res.data.messages || []).map(m => parseMessage(m, { metaOnly: true }))
  };
}

// ---------- Message send / draft ----------

function buildRaw({ to, subject, body, isHtml = true, headers = {}, threadId = null }) {
  const from = fromAddress();
  const rawLines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    isHtml ? 'Content-Type: text/html; charset=UTF-8' : 'Content-Type: text/plain; charset=UTF-8'
  ];
  for (const [k, v] of Object.entries(headers)) {
    if (v) rawLines.push(`${k}: ${v}`);
  }
  rawLines.push('', body);
  return Buffer.from(rawLines.join('\r\n')).toString('base64url');
}

async function sendMessage({ to, subject, body, isHtml, headers, threadId } = {}) {
  const gmail = getClient();
  const raw = buildRaw({ to, subject, body, isHtml, headers, threadId });
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId: threadId || undefined }
  });
  return { messageId: res.data.id, threadId: res.data.threadId };
}

async function createDraft({ to, subject, body, isHtml, headers, threadId } = {}) {
  const gmail = getClient();
  const raw = buildRaw({ to, subject, body, isHtml, headers, threadId });
  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw, threadId: threadId || undefined } }
  });
  return { draftId: res.data.id, messageId: res.data.message.id };
}

// ---------- Labels ----------

async function listLabels() {
  const gmail = getClient();
  const res = await gmail.users.labels.list({ userId: 'me' });
  return res.data.labels || [];
}

async function getOrCreateLabel(name) {
  const gmail = getClient();
  const existing = await listLabels();
  const hit = existing.find(l => l.name === name);
  if (hit) return hit;
  const res = await gmail.users.labels.create({
    userId: 'me',
    requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }
  });
  return res.data;
}

async function applyLabel(messageId, labelName) {
  const gmail = getClient();
  const label = await getOrCreateLabel(labelName);
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds: [label.id] }
  });
  return { labelId: label.id, labelName: label.name };
}

async function archiveMessage(messageId) {
  const gmail = getClient();
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { removeLabelIds: ['INBOX'] }
  });
  return { success: true };
}

async function markRead(messageId) {
  const gmail = getClient();
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { removeLabelIds: ['UNREAD'] }
  });
  return { success: true };
}

// ---------- Parsing helpers ----------

function parseMessage(raw, opts = {}) {
  const headers = {};
  const headerList = raw.payload?.headers || [];
  for (const h of headerList) headers[h.name.toLowerCase()] = h.value;

  let bodyPlain = null, bodyHtml = null, attachments = [];
  if (!opts.metaOnly && raw.payload) {
    ({ bodyPlain, bodyHtml, attachments } = walkParts(raw.payload));
  }

  return {
    id: raw.id,
    threadId: raw.threadId,
    historyId: raw.historyId,
    labelIds: raw.labelIds || [],
    snippet: raw.snippet,
    internalDate: raw.internalDate ? new Date(Number(raw.internalDate)) : null,
    headers: {
      from: headers['from'] || null,
      fromAddress: extractAddress(headers['from']),
      fromName: extractName(headers['from']),
      to: headers['to'] || null,
      cc: headers['cc'] || null,
      subject: headers['subject'] || null,
      date: headers['date'] ? new Date(headers['date']) : null,
      messageId: headers['message-id'] || null,
      inReplyTo: headers['in-reply-to'] || null
    },
    bodyPlain,
    bodyHtml,
    attachments
  };
}

function walkParts(part) {
  let bodyPlain = null, bodyHtml = null;
  const attachments = [];
  function walk(p) {
    if (!p) return;
    if (p.filename && p.filename.length && p.body?.attachmentId) {
      attachments.push({
        name: p.filename,
        mimeType: p.mimeType,
        size: p.body.size,
        attachmentId: p.body.attachmentId
      });
    }
    if (p.mimeType === 'text/plain' && !bodyPlain && p.body?.data) {
      bodyPlain = Buffer.from(p.body.data, 'base64').toString('utf8');
    }
    if (p.mimeType === 'text/html' && !bodyHtml && p.body?.data) {
      bodyHtml = Buffer.from(p.body.data, 'base64').toString('utf8');
    }
    for (const child of (p.parts || [])) walk(child);
  }
  walk(part);
  return { bodyPlain, bodyHtml, attachments };
}

function extractAddress(headerValue) {
  if (!headerValue) return null;
  const m = headerValue.match(/<([^>]+)>/);
  if (m) return m[1].trim().toLowerCase();
  return headerValue.trim().toLowerCase();
}
function extractName(headerValue) {
  if (!headerValue) return null;
  const m = headerValue.match(/^"?([^"<]+?)"?\s*<[^>]+>/);
  return m ? m[1].trim() : null;
}

module.exports = {
  isConfigured, diagnose, fromAddress, threadWebLink,
  listMessageIds, getMessage, getMessageMeta, getThread,
  sendMessage, createDraft,
  listLabels, getOrCreateLabel, applyLabel,
  archiveMessage, markRead
};
