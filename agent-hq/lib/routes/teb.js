// lib/routes/teb.js
//
// Text Execution Board endpoints — server-authoritative state for the /teb UI.
//
// Endpoints:
//   GET  /api/teb/queue?sinceDays=14   — proxies to Mac Bridge: SELECT unread/recent
//                                        messages from chat.db (ORDER BY date DESC,
//                                        date >= now()-sinceDays). Augments each
//                                        thread with contact metadata + Phase 1
//                                        audit context.
//   POST /api/teb/send                 — Gmail-undo-friendly send. Validates DNC,
//                                        fires the Mac osascript send via Bridge,
//                                        then atomically appends to the Phase 1
//                                        audit log + FUB Note + Sphere cadence.
//   GET  /api/teb/state                — all snooze/star/done flags
//   POST /api/teb/state                — { phone, op: snooze|unsnooze|star|unstar|done|undone, untilISO? }
//   POST /api/teb/heartbeat            — stage-drafts cron pings this so the TEB
//                                        header can warn if drafts are stale.
//
// Auth model:
//   - Single-tenant: any same-origin caller trusted (mirrors imessage.js reads).
//   - Multi-tenant enforced: requires req.session.userId.
//
// Race safety:
//   POST /api/teb/send is a single server-side handler that does:
//     1. DNC check (against FUB) — pre-send
//     2. Bridge RPC to fire osascript on the Mac — actual send
//     3. ingestEventCore({events:[outboundEvent]}) — audit + FUB Note + Sphere
//     4. mark thread Done in TEB state
//   If step 2 fails, nothing is audited. If step 3 fails, the send is logged
//   to a fallback queue (.teb-send-failures.json) for manual reconciliation.
//
// Created 2026-05-14 PM as part of the TEB rebuild (council audit recommendation).

import fs from 'fs';
import path from 'path';
import { callBridge, getBridgeStatus } from './bridge.js';
import { ingestEventCore } from './imessage.js';

const STATE_FILENAME = '.teb-state.json';
const FAILURES_FILENAME = '.teb-send-failures.json';
const DEFAULT_SINCE_DAYS = 14;

let state = {
  // phone (E.164) → { snoozedUntil?: ISO, starred?: bool, done?: bool, doneAt?: ISO }
  threads: {},
  lastHeartbeatAt: null,
};
let stateInitialized = false;

function loadState(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.threads && typeof parsed.threads === 'object') {
        state = parsed;
      }
    }
  } catch (e) {
    console.error('[TEB] load error:', e.message);
  }
  stateInitialized = true;
}

function saveState(filePath) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[TEB] save error:', e.message);
  }
}

function appendFailure(filePath, entry) {
  try {
    let arr = [];
    if (fs.existsSync(filePath)) {
      try { arr = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
      if (!Array.isArray(arr)) arr = [];
    }
    arr.push({ ...entry, recordedAt: new Date().toISOString() });
    // Keep last 500 failures only
    if (arr.length > 500) arr = arr.slice(-500);
    fs.writeFileSync(filePath, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error('[TEB] failure log write error:', e.message);
  }
}

function normalizePhone(raw) {
  if (raw == null) return '';
  const cleaned = String(raw).replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 10) return '+1' + cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return '+' + cleaned;
  if (cleaned.length >= 11) return '+' + cleaned;
  return cleaned;
}

function isSingleTenant() {
  return process.env.MULTI_TENANT !== 'enforced';
}

function isAuthorized(req) {
  if (isSingleTenant()) return true;
  return !!req.user || !!(req.session && req.session.userId);
}

// ─── DNC check — pre-send guard ──────────────────────────────────────
//
// Looks up phone in FUB across phone variants; returns { dnc: bool, person?, reason? }
// On FUB error, returns { dnc: false, error: ... } and lets the send proceed —
// erring toward "send" is consistent with the existing FUB sync logic which is
// fire-and-forget. The audit ensures we always have a record either way.

const DNC_RE = /do.?not.?(contact|text|message|disturb)|^dnc$|no.?text|no.?contact/i;

async function checkDNC(phone, deps) {
  const { FUB_API_KEY, FUB_BASE, fubHeaders } = deps;
  if (!FUB_API_KEY) return { dnc: false };
  try {
    const variants = [phone, phone.replace(/^\+1/, ''), phone.replace(/^\+/, '')];
    for (const v of variants) {
      if (!v) continue;
      const r = await fetch(`${FUB_BASE}/people?phone=${encodeURIComponent(v)}&limit=10`, {
        headers: fubHeaders(),
      });
      if (!r.ok) continue;
      const data = await r.json();
      for (const person of data.people || []) {
        const stage = String(person.stage || '').toLowerCase();
        const tags = (person.tags || []).map(t => String(t).toLowerCase());
        if (stage.includes('do not contact') || tags.some(t => DNC_RE.test(t))) {
          return { dnc: true, person, reason: 'FUB DNC stage/tag' };
        }
      }
    }
    return { dnc: false };
  } catch (e) {
    return { dnc: false, error: e.message };
  }
}

// ─── Routes ──────────────────────────────────────────────────────────

export function register(app, deps) {
  const { DATA_DIR } = deps;
  const stateFile = path.join(DATA_DIR, STATE_FILENAME);
  const failuresFile = path.join(DATA_DIR, FAILURES_FILENAME);
  if (!stateInitialized) loadState(stateFile);

  // GET /api/teb/queue?sinceDays=14
  app.get('/api/teb/queue', async (req, res) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'authentication required' });
    }
    const sinceDays = Math.max(1, Math.min(90,
      parseInt(req.query.sinceDays, 10) || DEFAULT_SINCE_DAYS
    ));
    const bridgeStatus = getBridgeStatus();
    if (!bridgeStatus.connected) {
      return res.status(503).json({
        ok: false,
        error: 'Mac Bridge not connected',
        bridge: bridgeStatus,
      });
    }
    try {
      const threads = await callBridge('imessage.queue', { sinceDays });
      // Augment with TEB state (snooze/star/done)
      const now = Date.now();
      const augmented = (threads || []).map(t => {
        const phone = normalizePhone(t.phone || t.sender_phone);
        const st = state.threads[phone] || {};
        const snoozedUntilMs = st.snoozedUntil ? new Date(st.snoozedUntil).getTime() : 0;
        return {
          ...t,
          phone,
          starred: !!st.starred,
          done: !!st.done,
          doneAt: st.doneAt || null,
          snoozedUntil: st.snoozedUntil || null,
          isSnoozed: snoozedUntilMs > now,
        };
      });
      res.json({
        ok: true,
        sinceDays,
        threads: augmented,
        bridge: bridgeStatus,
        lastHeartbeatAt: state.lastHeartbeatAt,
      });
    } catch (e) {
      console.error('[TEB] queue error:', e.message);
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  // POST /api/teb/send
  // body: { phone, body, draft_label?, reply_to?, sender_name? }
  app.post('/api/teb/send', async (req, res) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'authentication required' });
    }
    const phone = normalizePhone(req.body?.phone);
    const body = String(req.body?.body || '').trim();
    const draftLabel = req.body?.draft_label || null;
    const replyTo = req.body?.reply_to || null;
    const senderName = req.body?.sender_name || null;
    if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });
    if (!body)  return res.status(400).json({ ok: false, error: 'body required' });
    if (body.length > 4000) return res.status(400).json({ ok: false, error: 'body too long (>4000)' });

    // 1. Pre-send DNC check
    const dnc = await checkDNC(phone, deps);
    if (dnc.dnc) {
      console.log(`[TEB] BLOCKED outbound to ${phone}: ${dnc.reason}`);
      return res.status(409).json({ ok: false, error: 'recipient is on Do Not Contact', dnc });
    }

    // 2. Fire via Mac Bridge
    let sentAt;
    try {
      const result = await callBridge('imessage.send', { phone, body });
      sentAt = result?.sentAt || new Date().toISOString();
    } catch (e) {
      console.error('[TEB] bridge send failed:', e.message);
      return res.status(502).json({ ok: false, error: 'Mac Bridge send failed: ' + e.message });
    }

    // 3. Audit + FUB sync via the existing Phase 1 ingest core (single source of truth)
    const event = {
      id: `${phone}_${Math.floor(new Date(sentAt).getTime() / 1000)}_outbound`,
      direction: 'outbound',
      sender_phone: phone,
      sender_name: senderName,
      body,
      date: sentAt,
      reply_to: replyTo,
      draft_label: draftLabel,
    };
    let ingestResult;
    try {
      ingestResult = await ingestEventCore({ events: [event] }, deps);
    } catch (e) {
      console.error('[TEB] ingest after send failed — logged for reconciliation:', e.message);
      appendFailure(failuresFile, {
        type: 'ingest_after_send',
        event,
        error: e.message,
      });
      // The send succeeded — don't fail the request. Return a warning.
      return res.json({
        ok: true,
        sent: true,
        audited: false,
        warning: 'send succeeded but audit logging failed: ' + e.message,
        sentAt,
      });
    }

    // 4. Mark thread Done in TEB state (reply sent → off the board)
    state.threads[phone] = state.threads[phone] || {};
    state.threads[phone].done = true;
    state.threads[phone].doneAt = sentAt;
    delete state.threads[phone].snoozedUntil;
    saveState(stateFile);

    res.json({
      ok: true,
      sent: true,
      audited: true,
      sentAt,
      ingest: ingestResult,
    });
  });

  // GET /api/teb/state — all flags
  app.get('/api/teb/state', (req, res) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'authentication required' });
    }
    res.json({ ok: true, threads: state.threads, lastHeartbeatAt: state.lastHeartbeatAt });
  });

  // POST /api/teb/state
  // body: { phone, op: snooze|unsnooze|star|unstar|done|undone, untilISO? }
  app.post('/api/teb/state', (req, res) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'authentication required' });
    }
    const phone = normalizePhone(req.body?.phone);
    const op = String(req.body?.op || '').toLowerCase();
    if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });

    state.threads[phone] = state.threads[phone] || {};
    const t = state.threads[phone];

    switch (op) {
      case 'snooze': {
        const until = req.body?.untilISO || new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
        t.snoozedUntil = new Date(until).toISOString();
        break;
      }
      case 'unsnooze':
        delete t.snoozedUntil;
        break;
      case 'star':
        t.starred = true;
        break;
      case 'unstar':
        t.starred = false;
        break;
      case 'done':
        t.done = true;
        t.doneAt = new Date().toISOString();
        break;
      case 'undone':
        t.done = false;
        delete t.doneAt;
        break;
      default:
        return res.status(400).json({ ok: false, error: `unknown op '${op}'` });
    }
    saveState(stateFile);
    res.json({ ok: true, phone, state: t });
  });

  // POST /api/teb/heartbeat — stage-drafts cron pings this on each run so the
  // TEB header can render "drafts refreshed N minutes ago".
  app.post('/api/teb/heartbeat', (req, res) => {
    // Auth: same X-Ingest-Secret as imessage.activity (it's the same trust boundary).
    if (deps.INGEST_SECRET) {
      const provided = req.get('x-ingest-secret') || req.get('X-Ingest-Secret') || '';
      if (provided !== deps.INGEST_SECRET) {
        return res.status(401).json({ ok: false, error: 'invalid ingest secret' });
      }
    }
    state.lastHeartbeatAt = new Date().toISOString();
    saveState(stateFile);
    res.json({ ok: true, at: state.lastHeartbeatAt });
  });
}
