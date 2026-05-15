// lib/routes/imessage.js
//
// Phase 1 of the Text Execution Board integration: Agent HQ becomes the
// source-of-truth log for all iMessage activity (inbound + outbound +
// auto-skipped) so the user can audit at end-of-day and never miss a reply.
//
// Endpoints:
//   POST /api/imessage/activity        — Ingest a batch of events (dedup by id)
//   GET  /api/imessage/activity        — Read events (filter: since, phone, limit)
//   GET  /api/imessage/missed          — Threads where last inbound > last outbound
//                                        and the inbound wasn't auto-skipped
//   GET  /api/imessage/stats           — Quick counters for the dashboard widget
//
// Programmatic export (added 2026-05-14 PM for TEB rebuild):
//   ingestEventCore({events}, deps)   — same logic as POST handler, no HTTP.
//                                       teb.js calls this after a successful
//                                       Bridge send to atomically audit + FUB-sync.
//
// Storage: <DATA_DIR>/.imessages.json with shape:
//   { events: [...], lastUpdatedAt: ISO }
//
// Each event:
//   {
//     id:            "<phone>_<unix_ts>_<direction>",
//     direction:     "inbound" | "outbound" | "auto_skipped",
//     sender_phone:  "+15551234567",
//     sender_name:   "Jane Smith (Faris Team)" | null,
//     body:          "...",
//     date:          ISO 8601,
//     reply_to:      "<inbound id>" | null,
//     draft_label:   "direct" | "warm" | "question_back" | "custom" | "voice" | "compose"
//     auto_skip_reason: "tapback" | "closer"  // only when direction === "auto_skipped"
//     ingested_at:   ISO 8601                 // set server-side
//   }
//
// Created 2026-05-14 for the Text Execution Board / "no missed texts" milestone.
// Refactored 2026-05-14 PM to expose ingestEventCore for in-process callers.

import fs from 'fs';
import path from 'path';

const FILENAME = '.imessages.json';

// Module-scoped state — shared between register() and ingestEventCore()
let state = { events: [], lastUpdatedAt: null };
let stateInitialized = false;
let stateFilePath = null;
let registeredDeps = null;

function loadState(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.events)) {
        state = parsed;
      }
    }
  } catch (e) {
    console.error('[iMessage] load error:', e.message);
  }
  stateInitialized = true;
}

function saveState(filePath) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[iMessage] save error:', e.message);
  }
}

// ─── Phone normalization (mirrors stage_drafts_prompt.md + casing.js) ──
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

function validateEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const direction = String(raw.direction || '').toLowerCase();
  if (!['inbound', 'outbound', 'auto_skipped'].includes(direction)) return null;

  const phone = normalizePhone(raw.sender_phone);
  if (!phone) return null;

  const date = raw.date || new Date().toISOString();
  let id = String(raw.id || '').trim();
  if (!id) {
    const ts = Math.floor(new Date(date).getTime() / 1000);
    id = `${phone}_${ts}_${direction}`;
  }

  return {
    id,
    direction,
    sender_phone: phone,
    sender_name: raw.sender_name || null,
    body: String(raw.body || '').slice(0, 4000),
    date: new Date(date).toISOString(),
    reply_to: raw.reply_to || null,
    draft_label: raw.draft_label || null,
    auto_skip_reason: raw.auto_skip_reason || null,
    ingested_at: new Date().toISOString(),
  };
}

// ─── FUB Note sync ────────────────────────────────────────────────────
const TIER_TAGS = new Set(['advocate', 'a', 'b', 'c']);
const DNC_RE = /do.?not.?(contact|text|message|disturb)|^dnc$|no.?text|no.?contact/i;

function detectTierFromTags(tags) {
  for (const tag of tags || []) {
    const first = String(tag).trim().toLowerCase().split(/[\s\-_]/)[0];
    if (TIER_TAGS.has(first)) return first;
  }
  return null;
}

async function syncToFub(event, deps) {
  const { FUB_API_KEY, FUB_BASE, fubHeaders, onSphereTouch } = deps;
  if (!FUB_API_KEY) return { skipped: 'no FUB_API_KEY' };
  if (event.direction === 'auto_skipped') return { skipped: 'auto-skipped event' };
  if (event.fubSynced) return { skipped: 'already synced' };

  try {
    const phoneVariants = [
      event.sender_phone,
      event.sender_phone.replace(/^\+1/, ''),
      event.sender_phone.replace(/^\+/, ''),
    ];
    const seen = new Set();
    const allMatches = [];
    for (const variant of phoneVariants) {
      if (!variant || seen.has(variant)) continue;
      seen.add(variant);
      const resp = await fetch(
        `${FUB_BASE}/people?phone=${encodeURIComponent(variant)}&limit=10`,
        { headers: fubHeaders() }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      if (Array.isArray(data.people)) {
        for (const p of data.people) {
          if (!allMatches.some(m => m.id === p.id)) allMatches.push(p);
        }
      }
    }

    if (allMatches.length === 0) return { skipped: 'no FUB match' };

    let person;
    if (allMatches.length === 1) {
      person = allMatches[0];
    } else {
      person = allMatches.slice().sort((a, b) => {
        const aD = new Date(a.lastActivity || 0).getTime();
        const bD = new Date(b.lastActivity || 0).getTime();
        return bD - aD;
      })[0];
      console.warn(`[iMessage] multi-FUB-match for ${event.sender_phone}: ${allMatches.length} contacts; chose person ${person.id} (most recent activity)`);
    }

    const stage = String(person.stage || '').toLowerCase();
    const tagsRaw = Array.isArray(person.tags) ? person.tags : [];
    const tagsLower = tagsRaw.map(t => String(t).toLowerCase());
    const dnc = stage.includes('do not contact')
      || tagsLower.some(t => DNC_RE.test(t));
    if (dnc) {
      console.warn(`[iMessage] DNC — skipping FUB Note for ${event.sender_phone} (person ${person.id})`);
      event.fubSynced = true;
      return { skipped: 'Do Not Contact', personId: person.id };
    }

    const tier = detectTierFromTags(tagsRaw);
    const directionLabel = event.direction === 'inbound' ? 'Received' : 'Sent';
    const replyLabel = event.draft_label ? ` [${event.draft_label}]` : '';

    let subject, body;
    if (tier && event.direction === 'outbound') {
      subject = `Text (Agent HQ — iMessage, tier ${tier.toUpperCase()})`;
      body = `Outbound iMessage at ${event.date}\n\n${event.body}`;
    } else {
      subject = `iMessage ${directionLabel.toLowerCase()}`;
      body = `${directionLabel}${replyLabel} via iMessage at ${event.date}\n\n${event.body}`;
    }

    const noteResp = await fetch(`${FUB_BASE}/notes`, {
      method: 'POST',
      headers: fubHeaders(),
      body: JSON.stringify({
        personId: person.id,
        subject,
        body,
      }),
    });
    if (!noteResp.ok) {
      const txt = await noteResp.text().catch(() => '');
      return { error: `FUB note POST ${noteResp.status}: ${txt.slice(0, 200)}` };
    }

    event.fubSynced = true;

    if (tier && event.direction === 'outbound' && typeof onSphereTouch === 'function') {
      try { onSphereTouch(); } catch (e) { console.warn('[iMessage] onSphereTouch callback error:', e.message); }
    }

    return {
      synced: true,
      personId: person.id,
      tier: tier || null,
      sphereTouch: !!(tier && event.direction === 'outbound'),
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Missed-threads logic ─────────────────────────────────────────────
function computeMissed(events, sinceISO) {
  const since = sinceISO ? new Date(sinceISO).getTime() : 0;
  const filtered = events.filter(e => new Date(e.date).getTime() >= since);

  const byPhone = new Map();
  for (const e of filtered) {
    const slot = byPhone.get(e.sender_phone) || { lastInbound: null, lastOutbound: null, lastInboundSkipped: null };
    const ts = new Date(e.date).getTime();
    if (e.direction === 'inbound' && (!slot.lastInbound || ts > new Date(slot.lastInbound.date).getTime())) {
      slot.lastInbound = e;
    }
    if (e.direction === 'outbound' && (!slot.lastOutbound || ts > new Date(slot.lastOutbound.date).getTime())) {
      slot.lastOutbound = e;
    }
    if (e.direction === 'auto_skipped' && (!slot.lastInboundSkipped || ts > new Date(slot.lastInboundSkipped.date).getTime())) {
      slot.lastInboundSkipped = e;
    }
    byPhone.set(e.sender_phone, slot);
  }

  const missed = [];
  for (const [phone, slot] of byPhone.entries()) {
    if (!slot.lastInbound) continue;
    const lastIn = slot.lastInbound;
    const lastOut = slot.lastOutbound;
    const lastSkip = slot.lastInboundSkipped;

    if (lastSkip && new Date(lastSkip.date).getTime() > new Date(lastIn.date).getTime()) continue;
    if (lastOut && new Date(lastOut.date).getTime() >= new Date(lastIn.date).getTime()) continue;

    missed.push({
      sender_phone: phone,
      sender_name: lastIn.sender_name,
      last_inbound_body: lastIn.body,
      last_inbound_date: lastIn.date,
      hours_since: Math.round((Date.now() - new Date(lastIn.date).getTime()) / (1000 * 60 * 60) * 10) / 10,
    });
  }

  missed.sort((a, b) => new Date(a.last_inbound_date).getTime() - new Date(b.last_inbound_date).getTime());
  return missed;
}

// ─── Stats for the dashboard widget ───────────────────────────────────
function computeStats(events, sinceISO) {
  const since = sinceISO ? new Date(sinceISO).getTime() : 0;
  let inbound = 0, outbound = 0, skipped = 0;
  const phonesInbound = new Set();
  for (const e of events) {
    if (new Date(e.date).getTime() < since) continue;
    if (e.direction === 'inbound')       { inbound++;  phonesInbound.add(e.sender_phone); }
    else if (e.direction === 'outbound') { outbound++; }
    else if (e.direction === 'auto_skipped') { skipped++; }
  }
  return {
    since: sinceISO || null,
    inbound,
    outbound,
    auto_skipped: skipped,
    unique_inbound_phones: phonesInbound.size,
  };
}

// ─── Core ingest function — usable from HTTP handler AND from teb.js ──
//
// Validates, dedups, persists, and fires FUB sync. Returns synchronously after
// disk persist; FUB sync is fire-and-forget on the returned promise's
// "background" property if the caller cares (otherwise it just runs).

export async function ingestEventCore(payload, deps) {
  if (!stateInitialized) {
    // If called before register() ran, init from deps.DATA_DIR
    if (!stateFilePath) {
      if (!deps || !deps.DATA_DIR) {
        throw new Error('ingestEventCore: not initialized (call register first) and no DATA_DIR in deps');
      }
      stateFilePath = path.join(deps.DATA_DIR, FILENAME);
    }
    loadState(stateFilePath);
  }
  const effectiveDeps = deps || registeredDeps || {};

  const incoming = Array.isArray(payload?.events) ? payload.events : [];
  if (!incoming.length) return { ok: false, error: 'no events in payload' };

  const validated = incoming.map(validateEvent).filter(Boolean);
  if (!validated.length) return { ok: false, error: 'all events failed validation' };

  const existingById = new Map(state.events.map(e => [e.id, e]));
  let added = 0, updated = 0;
  for (const e of validated) {
    const prev = existingById.get(e.id);
    if (prev) {
      updated++;
      if (prev.fubSynced) e.fubSynced = true;
    } else {
      added++;
    }
    existingById.set(e.id, e);
  }
  state.events = Array.from(existingById.values()).sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  state.lastUpdatedAt = new Date().toISOString();
  saveState(stateFilePath);

  // Fire-and-forget FUB sync
  const stateById = new Map(state.events.map(e => [e.id, e]));
  const syncCandidates = validated.filter(e => !stateById.get(e.id)?.fubSynced);

  const syncPromise = Promise.allSettled(
    syncCandidates.map(e => syncToFub(e, effectiveDeps))
  ).then(results => {
    const synced = results.filter(r => r.status === 'fulfilled' && r.value?.synced).length;
    const sphereTouches = results.filter(r => r.status === 'fulfilled' && r.value?.sphereTouch).length;
    const errors = results.filter(r => r.status === 'fulfilled' && r.value?.error).length;
    const skipped = results.length - synced - errors;
    if (synced || errors || sphereTouches) {
      console.log(`[iMessage] FUB sync: ${synced} ok (${sphereTouches} sphere touch${sphereTouches === 1 ? '' : 'es'}), ${errors} err, ${skipped} skipped`);
    }
    if (synced || skipped) saveState(stateFilePath);
    return { synced, sphereTouches, errors, skipped };
  }).catch(err => {
    console.error('[iMessage] FUB sync batch error:', err.message);
  });

  console.log(`[iMessage] ingest: +${added} new, ~${updated} updated, total=${state.events.length}`);
  return {
    ok: true,
    added,
    updated,
    total: state.events.length,
    fubSyncQueued: syncCandidates.length,
    // Caller can `await result.background` if it wants to wait for FUB sync
    background: syncPromise,
  };
}

// ─── Register routes ──────────────────────────────────────────────────
export function register(app, deps) {
  const { DATA_DIR } = deps;
  stateFilePath = path.join(DATA_DIR, FILENAME);
  registeredDeps = deps;
  if (!stateInitialized) loadState(stateFilePath);

  // POST /api/imessage/activity — ingest a batch of events
  app.post('/api/imessage/activity', async (req, res) => {
    if (deps.INGEST_SECRET) {
      const provided = req.get('x-ingest-secret') || req.get('X-Ingest-Secret') || '';
      if (provided !== deps.INGEST_SECRET) {
        return res.status(401).json({ ok: false, error: 'invalid ingest secret' });
      }
    } else if (!deps._warnedNoSecret) {
      console.warn('[iMessage] WARNING: IMESSAGE_INGEST_SECRET not configured — /api/imessage/activity is currently UNAUTHENTICATED');
      deps._warnedNoSecret = true;
    }
    try {
      const result = await ingestEventCore(req.body, deps);
      if (!result.ok) return res.json(result);
      // Don't expose the background promise over JSON
      const { background, ...rest } = result;
      res.json(rest);
    } catch (e) {
      console.error('[iMessage] ingest error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/imessage/activity?since=ISO&phone=...&limit=N
  app.get('/api/imessage/activity', (req, res) => {
    try {
      const since = req.query.since ? new Date(String(req.query.since)).getTime() : 0;
      const phone = req.query.phone ? normalizePhone(String(req.query.phone)) : null;
      const limit = req.query.limit ? Math.max(1, Math.min(2000, parseInt(req.query.limit, 10))) : 500;
      const direction = req.query.direction ? String(req.query.direction).toLowerCase() : null;

      let filtered = state.events;
      if (since)     filtered = filtered.filter(e => new Date(e.date).getTime() >= since);
      if (phone)     filtered = filtered.filter(e => e.sender_phone === phone);
      if (direction) filtered = filtered.filter(e => e.direction === direction);

      filtered = filtered
        .slice()
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, limit);

      res.json({
        ok: true,
        events: filtered,
        total: state.events.length,
        lastUpdatedAt: state.lastUpdatedAt,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/imessage/missed?since=ISO — threads needing a reply
  app.get('/api/imessage/missed', (req, res) => {
    try {
      const since = req.query.since ? String(req.query.since) : null;
      const missed = computeMissed(state.events, since);
      res.json({
        ok: true,
        count: missed.length,
        since: since,
        missed,
        lastUpdatedAt: state.lastUpdatedAt,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/imessage/stats?since=ISO — counters for the dashboard widget
  app.get('/api/imessage/stats', (req, res) => {
    try {
      const since = req.query.since ? String(req.query.since) : null;
      const stats = computeStats(state.events, since);
      res.json({ ok: true, stats, lastUpdatedAt: state.lastUpdatedAt });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}
