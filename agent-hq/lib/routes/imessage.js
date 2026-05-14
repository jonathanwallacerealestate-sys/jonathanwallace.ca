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
// Storage: <DATA_DIR>/.imessages.json with shape:
//   { events: [...], lastUpdatedAt: ISO }
//
// Each event:
//   {
//     id:            "<phone>_<unix_ts>",     // dedup key
//     direction:     "inbound" | "outbound" | "auto_skipped",
//     sender_phone:  "+15551234567",          // E.164
//     sender_name:   "Jane Smith (Faris Team)" | null,
//     body:          "...",
//     date:          ISO 8601 (when the message was sent/received),
//     reply_to:      "<inbound id>"           // optional, when outbound replies to a known inbound
//     draft_label:   "direct" | "warm" | "question_back" | "custom" | "voice" | "compose"
//     auto_skip_reason: "tapback" | "closer"  // only when direction === "auto_skipped"
//     ingested_at:   ISO 8601                 // set server-side
//   }
//
// FUB sync: when an event lands and FUB_API_KEY is configured, the route
// looks up the phone in FUB and POSTs a Note tagged "iMessage". Fire-and-forget;
// failures don't block ingest. This makes every text part of the CRM record
// and sets up Phase 2 (lead-gen analytics over notes).
//
// Created 2026-05-14 for the Text Execution Board / "no missed texts" milestone.

import fs from 'fs';
import path from 'path';

const FILENAME = '.imessages.json';

// In-memory cache so we don't re-read disk on every request. Saved to disk
// after every mutation.
let state = { events: [], lastUpdatedAt: null };
let stateInitialized = false;

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
// Fire-and-forget. Looks up the phone in FUB, POSTs a Note. Skip if either
// FUB isn't configured or the phone isn't matched.
async function syncToFub(event, deps) {
  const { FUB_API_KEY, FUB_BASE, fubHeaders } = deps;
  if (!FUB_API_KEY) return { skipped: 'no FUB_API_KEY' };
  if (event.direction === 'auto_skipped') return { skipped: 'auto-skipped event' };

  try {
    // Search FUB for a person by phone — exact match first, then fuzzy
    const phoneVariants = [
      event.sender_phone,                              // +15551234567
      event.sender_phone.replace(/^\+1/, ''),          // 5551234567
      event.sender_phone.replace(/^\+/, ''),           // 15551234567
    ];
    let person = null;
    for (const variant of phoneVariants) {
      if (person) break;
      const resp = await fetch(
        `${FUB_BASE}/people?phone=${encodeURIComponent(variant)}&limit=1`,
        { headers: fubHeaders() }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.people && data.people.length > 0) person = data.people[0];
    }

    if (!person) return { skipped: 'no FUB match' };

    const directionLabel = event.direction === 'inbound' ? 'Received' : 'Sent';
    const replyLabel = event.draft_label ? ` [${event.draft_label}]` : '';
    const noteBody = `${directionLabel}${replyLabel} via iMessage at ${event.date}\n\n${event.body}`;

    const noteResp = await fetch(`${FUB_BASE}/notes`, {
      method: 'POST',
      headers: fubHeaders(),
      body: JSON.stringify({
        personId: person.id,
        subject: `iMessage ${directionLabel.toLowerCase()}`,
        body: noteBody,
      }),
    });
    if (!noteResp.ok) {
      const txt = await noteResp.text().catch(() => '');
      return { error: `FUB note POST ${noteResp.status}: ${txt.slice(0, 200)}` };
    }
    return { synced: true, personId: person.id };
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Missed-threads logic ─────────────────────────────────────────────
// A phone is "missed" if its most recent INBOUND (that isn't auto-skipped)
// has no OUTBOUND with a later timestamp. Auto-skipped messages count as
// implicitly handled (tapbacks/closers don't need replies).
function computeMissed(events, sinceISO) {
  const since = sinceISO ? new Date(sinceISO).getTime() : 0;
  const filtered = events.filter(e => new Date(e.date).getTime() >= since);

  // Group by phone, get most recent of each direction
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
    if (!slot.lastInbound) continue; // never inbound = nothing to miss
    const lastIn = slot.lastInbound;
    const lastOut = slot.lastOutbound;
    const lastSkip = slot.lastInboundSkipped;

    // If most recent activity for this phone is a more-recent auto-skip
    // (closer/tapback), treat the thread as handled.
    if (lastSkip && new Date(lastSkip.date).getTime() > new Date(lastIn.date).getTime()) continue;

    // Already replied after the latest inbound?
    if (lastOut && new Date(lastOut.date).getTime() >= new Date(lastIn.date).getTime()) continue;

    missed.push({
      sender_phone: phone,
      sender_name: lastIn.sender_name,
      last_inbound_body: lastIn.body,
      last_inbound_date: lastIn.date,
      hours_since: Math.round((Date.now() - new Date(lastIn.date).getTime()) / (1000 * 60 * 60) * 10) / 10,
    });
  }

  // Sort oldest first — those are the most "stale" and need attention
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

// ─── Register routes ──────────────────────────────────────────────────
export function register(app, deps) {
  const { DATA_DIR, FUB_API_KEY, FUB_BASE, fubHeaders } = deps;
  const filePath = path.join(DATA_DIR, FILENAME);

  if (!stateInitialized) loadState(filePath);

  // POST /api/imessage/activity — ingest a batch of events
  app.post('/api/imessage/activity', async (req, res) => {
    try {
      const incoming = Array.isArray(req.body?.events) ? req.body.events : [];
      if (!incoming.length) return res.json({ ok: false, error: 'no events in payload' });

      const validated = incoming.map(validateEvent).filter(Boolean);
      if (!validated.length) return res.json({ ok: false, error: 'all events failed validation' });

      // Dedup by id — new events overwrite old (allows correcting drafts/names)
      const existingById = new Map(state.events.map(e => [e.id, e]));
      let added = 0, updated = 0;
      for (const e of validated) {
        if (existingById.has(e.id)) updated++; else added++;
        existingById.set(e.id, e);
      }
      state.events = Array.from(existingById.values()).sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      state.lastUpdatedAt = new Date().toISOString();
      saveState(filePath);

      // Fire-and-forget FUB sync for each NEW event (don't block response)
      const syncCandidates = validated.filter(e => !existingById.get(e.id)?.fubSynced);
      Promise.allSettled(
        syncCandidates.map(e => syncToFub(e, { FUB_API_KEY, FUB_BASE, fubHeaders }))
      ).then(results => {
        const synced = results.filter(r => r.status === 'fulfilled' && r.value?.synced).length;
        const errors = results.filter(r => r.status === 'fulfilled' && r.value?.error).length;
        if (synced || errors) {
          console.log(`[iMessage] FUB sync: ${synced} ok, ${errors} err, ${results.length - synced - errors} skipped`);
        }
      }).catch(err => console.error('[iMessage] FUB sync batch error:', err.message));

      console.log(`[iMessage] ingest: +${added} new, ~${updated} updated, total=${state.events.length}`);
      res.json({
        ok: true,
        added,
        updated,
        total: state.events.length,
        fubSyncQueued: syncCandidates.length,
      });
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

      // Most recent first
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
