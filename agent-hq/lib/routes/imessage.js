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
// Fire-and-forget. Looks up the phone in FUB, POSTs a Note.
// Audit-hardened: skips already-synced events (dedup), respects Do-Not-Contact,
// resolves multi-match conflicts by preferring most-recent activity, and uses
// a sphere-flavored Note for tier-tagged contacts so the cadence engine sees it.
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
  // Dedup — if this event has already been synced, skip
  if (event.fubSynced) return { skipped: 'already synced' };

  try {
    // Search FUB across all phone variants, collect ALL matches (limit 10 per variant)
    const phoneVariants = [
      event.sender_phone,                              // +15551234567
      event.sender_phone.replace(/^\+1/, ''),          // 5551234567
      event.sender_phone.replace(/^\+/, ''),           // 15551234567
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

    // Multi-match resolution: prefer most-recent lastActivity
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

    // Do-Not-Contact / Do-Not-Text check
    const stage = String(person.stage || '').toLowerCase();
    const tagsRaw = Array.isArray(person.tags) ? person.tags : [];
    const tagsLower = tagsRaw.map(t => String(t).toLowerCase());
    const dnc = stage.includes('do not contact')
      || tagsLower.some(t => DNC_RE.test(t));
    if (dnc) {
      console.warn(`[iMessage] DNC — skipping FUB Note for ${event.sender_phone} (person ${person.id})`);
      event.fubSynced = true; // mark anyway so we don't keep re-checking
      return { skipped: 'Do Not Contact', personId: person.id };
    }

    // Tier-tag awareness — surface as a sphere touch when applicable
    const tier = detectTierFromTags(tagsRaw);
    const directionLabel = event.direction === 'inbound' ? 'Received' : 'Sent';
    const replyLabel = event.draft_label ? ` [${event.draft_label}]` : '';

    let subject, body;
    if (tier && event.direction === 'outbound') {
      // Outbound to a tier-tagged Sphere contact — log as a sphere touch.
      // This Note advances `lastTouchAt` in the sphere cadence engine.
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

    // Mark synced so future re-ingests of this event don't create duplicate Notes
    event.fubSynced = true;

    // If this advanced sphere cadence, invalidate cache so next refresh shows it
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
    // Auth — require X-Ingest-Secret header to match IMESSAGE_INGEST_SECRET env var.
    // If env var is unset, log a loud warning but allow (so an initial deploy doesn't
    // break the TEB before the secret is rotated in). Once configured on Railway,
    // missing/wrong secret = 401.
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
      const incoming = Array.isArray(req.body?.events) ? req.body.events : [];
      if (!incoming.length) return res.json({ ok: false, error: 'no events in payload' });

      const validated = incoming.map(validateEvent).filter(Boolean);
      if (!validated.length) return res.json({ ok: false, error: 'all events failed validation' });

      // Dedup by id — new events overwrite old (allows correcting drafts/names),
      // but PRESERVE the fubSynced flag from a prior successful sync so a re-ingest
      // doesn't create duplicate FUB Notes.
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
      saveState(filePath);

      // Fire-and-forget FUB sync for each event that hasn't been synced yet.
      // We check the CURRENT in-memory state (which now contains the merged event)
      // rather than the pre-merge map, since the new event might bring fresh data.
      const stateById = new Map(state.events.map(e => [e.id, e]));
      const syncCandidates = validated.filter(e => !stateById.get(e.id)?.fubSynced);
      Promise.allSettled(
        syncCandidates.map(e => syncToFub(e, deps))
      ).then(results => {
        const synced = results.filter(r => r.status === 'fulfilled' && r.value?.synced).length;
        const sphereTouches = results.filter(r => r.status === 'fulfilled' && r.value?.sphereTouch).length;
        const errors = results.filter(r => r.status === 'fulfilled' && r.value?.error).length;
        const skipped = results.length - synced - errors;
        if (synced || errors || sphereTouches) {
          console.log(`[iMessage] FUB sync: ${synced} ok (${sphereTouches} sphere touch${sphereTouches === 1 ? '' : 'es'}), ${errors} err, ${skipped} skipped`);
        }
        // Persist fubSynced flags now that sync has completed.
        // syncToFub mutates event.fubSynced on the same object refs held in state.events.
        if (synced || skipped) saveState(filePath);
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
