// lib/routes/jacqui-memory.js
//
// Jacqui's persistent learning store.
//
// Three append-only logs + one versioned singleton, all on disk at
// ${JACQUI_DIR}/memory/:
//   - decisions.jsonl   — every architectural/product decision + why
//   - patterns.jsonl    — observed patterns in clients, workflows, etc.
//   - retros.jsonl      — what worked / what didn't, lessons captured
//   - north_star.json   — current top priorities + tradeoffs (versioned)
//
// Endpoints:
//   POST /api/jacqui/memory/decision  — log a decision
//   POST /api/jacqui/memory/pattern   — log an observed pattern
//   POST /api/jacqui/memory/retro     — log a retrospective entry
//   PUT  /api/jacqui/memory/north-star — replace the singleton (bumps version)
//   GET  /api/jacqui/memory/recent    — last N entries across logs
//   GET  /api/jacqui/memory/all       — full dump for replay
//   GET  /api/jacqui/memory/north-star — current north star
//   GET  /api/jacqui/memory/context   — synthesized prompt context for Jacqui
//   GET  /api/jacqui/memory/query     — filter by tags, type, date range, text
//
// Storage is plain JSONL — restore-from-Drive-backup-friendly and trivially
// human-readable. No DB required.
//
// Created 2026-05-17 — Jacqui starts learning.

import fs from 'fs';
import path from 'path';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonl(filePath, limit = Infinity) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  const tail = Number.isFinite(limit) ? lines.slice(-limit) : lines;
  return tail.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function appendJsonl(filePath, entry) {
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
}

function makeId(prefix) {
  const stamp = new Date().toISOString().slice(0, 10);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${r}`;
}

// Build a prompt-ready context blob — what Jacqui injects into her system
// prompt so she knows Jonathan's business by the time she replies.
function buildContext({ decisions, patterns, retros, northStar }) {
  const fmt = (a) => a && a.length ? a.map((x) => `- ${x}`).join('\n') : '(none yet)';
  const lines = [];
  lines.push('# Jacqui — Working Memory');
  lines.push('');
  lines.push('You are the assistant to Jonathan Wallace, a high-producing real estate agent at Faris Team brokerage, serving Georgian Bay / Simcoe County (Midland, Penetanguishene, Tay, Tiny, Wasaga Beach, Barrie, Orillia) in Ontario, Canada.');
  lines.push('');
  if (northStar) {
    lines.push('## North Star');
    lines.push('');
    lines.push(`**${northStar.primary}**`);
    if (northStar.tagline) lines.push(`*${northStar.tagline}*`);
    if (northStar.outcome_60d) lines.push(`60-day outcome: **${northStar.outcome_60d}**`);
    lines.push('');
    if (Array.isArray(northStar.priorities) && northStar.priorities.length) {
      lines.push('### Priorities (ranked)');
      lines.push('');
      northStar.priorities.forEach((p, i) => {
        lines.push(`${i + 1}. **${p.name}** — ${p.context || ''}`);
      });
      lines.push('');
    }
    if (northStar.tradeoffs && typeof northStar.tradeoffs === 'object') {
      lines.push('### Trade-offs (where the team has explicit positions)');
      lines.push('');
      Object.entries(northStar.tradeoffs).forEach(([k, v]) => {
        lines.push(`- **${k}**: ${v}`);
      });
      lines.push('');
    }
  }
  lines.push('## Recent Decisions (most recent first)');
  lines.push('');
  lines.push((decisions || []).slice(-30).reverse().map((d) =>
    `- **${d.topic || '(untitled)'}** (${d.date}) — ${d.decision}\n  why: ${d.why || '—'}` +
    (d.alternatives && d.alternatives.length ? `\n  considered: ${d.alternatives.join('; ')}` : '') +
    (d.tags && d.tags.length ? `\n  tags: ${d.tags.join(', ')}` : '')
  ).join('\n\n') || '(none yet)');
  lines.push('');
  lines.push('## Patterns Observed');
  lines.push('');
  lines.push(fmt((patterns || []).slice(-20).map((p) =>
    `**${p.pattern}** (${p.date}) — observed in: ${p.observed_in || '—'}`
  )));
  lines.push('');
  lines.push('## Retrospectives — what worked, what didn\'t');
  lines.push('');
  lines.push(fmt((retros || []).slice(-20).map((r) =>
    `(${r.date}) **What worked:** ${r.what_worked || '—'} · **What didn\'t:** ${r.what_didnt || '—'} · **Lesson:** ${r.lesson || '—'}`
  )));
  lines.push('');
  lines.push('---');
  lines.push('When in doubt, Jacqui should ask Jonathan rather than guess. Decisions added here are durable; she should reference them, not contradict them, unless he explicitly revises one.');
  return lines.join('\n');
}

export function register(app, deps) {
  const { jacquiDir } = deps;
  const MEM_DIR = path.join(jacquiDir, 'memory');
  ensureDir(MEM_DIR);
  const PATH_DEC = path.join(MEM_DIR, 'decisions.jsonl');
  const PATH_PAT = path.join(MEM_DIR, 'patterns.jsonl');
  const PATH_RET = path.join(MEM_DIR, 'retros.jsonl');
  const PATH_NS  = path.join(MEM_DIR, 'north_star.json');

  // ── POST /api/jacqui/memory/decision ──
  app.post('/api/jacqui/memory/decision', (req, res) => {
    const b = req.body || {};
    if (!b.decision) return res.status(400).json({ ok: false, error: 'decision required' });
    const entry = {
      id: b.id || makeId('dec'),
      date: b.date || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      topic: b.topic || null,
      decision: b.decision,
      why: b.why || null,
      alternatives: Array.isArray(b.alternatives) ? b.alternatives : [],
      trade_offs: b.trade_offs || null,
      context: b.context || null,
      tags: Array.isArray(b.tags) ? b.tags : [],
      session_id: b.session_id || null,
    };
    appendJsonl(PATH_DEC, entry);
    res.json({ ok: true, entry });
  });

  // ── POST /api/jacqui/memory/pattern ──
  app.post('/api/jacqui/memory/pattern', (req, res) => {
    const b = req.body || {};
    if (!b.pattern) return res.status(400).json({ ok: false, error: 'pattern required' });
    const entry = {
      id: b.id || makeId('pat'),
      date: b.date || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      pattern: b.pattern,
      observed_in: b.observed_in || null,
      client_type: b.client_type || null,
      example: b.example || null,
      tags: Array.isArray(b.tags) ? b.tags : [],
    };
    appendJsonl(PATH_PAT, entry);
    res.json({ ok: true, entry });
  });

  // ── POST /api/jacqui/memory/retro ──
  app.post('/api/jacqui/memory/retro', (req, res) => {
    const b = req.body || {};
    if (!b.what_worked && !b.what_didnt && !b.lesson) {
      return res.status(400).json({ ok: false, error: 'at least one of what_worked, what_didnt, lesson required' });
    }
    const entry = {
      id: b.id || makeId('ret'),
      date: b.date || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      what_worked: b.what_worked || null,
      what_didnt: b.what_didnt || null,
      lesson: b.lesson || null,
      tags: Array.isArray(b.tags) ? b.tags : [],
      session_id: b.session_id || null,
    };
    appendJsonl(PATH_RET, entry);
    res.json({ ok: true, entry });
  });

  // ── PUT /api/jacqui/memory/north-star ──
  app.put('/api/jacqui/memory/north-star', (req, res) => {
    const b = req.body || {};
    if (!b.primary) return res.status(400).json({ ok: false, error: 'primary required' });
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(PATH_NS, 'utf8')); } catch {}
    const entry = {
      primary: b.primary,
      tagline: b.tagline || null,
      outcome_60d: b.outcome_60d || null,
      priorities: Array.isArray(b.priorities) ? b.priorities : [],
      tradeoffs: b.tradeoffs && typeof b.tradeoffs === 'object' ? b.tradeoffs : {},
      version: ((prev?.version || 0) + 1),
      updated_at: new Date().toISOString(),
      previous_version_id: prev?.updated_at || null,
    };
    fs.writeFileSync(PATH_NS, JSON.stringify(entry, null, 2));
    res.json({ ok: true, entry });
  });

  // ── GET /api/jacqui/memory/north-star ──
  app.get('/api/jacqui/memory/north-star', (req, res) => {
    try {
      const ns = JSON.parse(fs.readFileSync(PATH_NS, 'utf8'));
      res.json({ ok: true, northStar: ns });
    } catch {
      res.json({ ok: true, northStar: null });
    }
  });

  // ── GET /api/jacqui/memory/recent?limit=N ──
  app.get('/api/jacqui/memory/recent', (req, res) => {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
    const decisions = readJsonl(PATH_DEC, limit);
    const patterns = readJsonl(PATH_PAT, limit);
    const retros = readJsonl(PATH_RET, limit);
    res.json({
      ok: true,
      counts: { decisions: decisions.length, patterns: patterns.length, retros: retros.length },
      decisions, patterns, retros,
    });
  });

  // ── GET /api/jacqui/memory/all ──
  app.get('/api/jacqui/memory/all', (req, res) => {
    res.json({
      ok: true,
      decisions: readJsonl(PATH_DEC),
      patterns: readJsonl(PATH_PAT),
      retros: readJsonl(PATH_RET),
      northStar: (() => { try { return JSON.parse(fs.readFileSync(PATH_NS, 'utf8')); } catch { return null; } })(),
    });
  });

  // ── GET /api/jacqui/memory/context — prompt-ready markdown ──
  app.get('/api/jacqui/memory/context', (req, res) => {
    const decisions = readJsonl(PATH_DEC);
    const patterns = readJsonl(PATH_PAT);
    const retros = readJsonl(PATH_RET);
    let northStar = null;
    try { northStar = JSON.parse(fs.readFileSync(PATH_NS, 'utf8')); } catch {}
    const ctx = buildContext({ decisions, patterns, retros, northStar });
    if (req.query.format === 'json') {
      res.json({ ok: true, context: ctx, decisions, patterns, retros, northStar });
    } else {
      res.set('Content-Type', 'text/markdown; charset=utf-8');
      res.send(ctx);
    }
  });

  // ── GET /api/jacqui/memory/query?type=decision&tag=voice&q=foo ──
  app.get('/api/jacqui/memory/query', (req, res) => {
    const type = String(req.query.type || 'decision').toLowerCase();
    const tag = req.query.tag ? String(req.query.tag).toLowerCase() : null;
    const q = req.query.q ? String(req.query.q).toLowerCase() : null;
    const since = req.query.since || null;
    const file = ({ decision: PATH_DEC, pattern: PATH_PAT, retro: PATH_RET })[type];
    if (!file) return res.status(400).json({ ok: false, error: 'type must be decision|pattern|retro' });
    let entries = readJsonl(file);
    if (tag) entries = entries.filter((e) => (e.tags || []).some((t) => String(t).toLowerCase() === tag));
    if (since) entries = entries.filter((e) => e.date && e.date >= since);
    if (q) entries = entries.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
    res.json({ ok: true, type, count: entries.length, entries });
  });

  console.log('[JacquiMemory] registered /api/jacqui/memory/{decision,pattern,retro,north-star,recent,all,context,query}');
}
