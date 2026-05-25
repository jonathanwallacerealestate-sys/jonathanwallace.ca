// lib/routes/jacqui-memory.js
//
// Jacqui's persistent learning store + reference library + handoff-ingest.
//
// Three append-only logs + one versioned singleton + a documents library:
//   - decisions.jsonl   — architectural/product decisions + why
//   - patterns.jsonl    — observed patterns in clients, workflows, etc.
//   - retros.jsonl      — what worked / what didn't, lessons captured
//   - north_star.json   — current top priorities + tradeoffs (versioned)
//   - documents.jsonl   — index of uploaded reference docs (PDFs, etc.)
//   - documents/{id}.txt — full extracted text of each document
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
//   GET  /api/jacqui/memory/query     — filter by type/tag/text/date
//   POST /api/jacqui/memory/document  — upload PDF (multipart) → indexed + parsed
//   GET  /api/jacqui/memory/documents — list documents w/ summaries
//   GET  /api/jacqui/memory/documents/:id — full extracted text
//   POST /api/jacqui/memory/ingest-handoff — accept markdown of a handoff,
//          use Haiku to extract decisions/patterns/retros, post each
//   GET  /admin/jacqui-library — HTML UI for uploading + browsing docs
//
// Storage is plain JSONL — restore-from-Drive-backup-friendly. No DB.
//
// Created 2026-05-17, extended same day with documents + ingest-handoff.

import fs from 'fs';
import path from 'path';

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function readJsonl(filePath, limit = Infinity) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  const tail = Number.isFinite(limit) ? lines.slice(-limit) : lines;
  return tail.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function appendJsonl(filePath, entry) { fs.appendFileSync(filePath, JSON.stringify(entry) + '\n'); }
function makeId(prefix) {
  const stamp = new Date().toISOString().slice(0, 10);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${r}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

export function buildContext({ decisions, patterns, retros, northStar, documents }) {
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
      northStar.priorities.forEach((p, i) => lines.push(`${i + 1}. **${p.name}** — ${p.context || ''}`));
      lines.push('');
    }
    if (northStar.tradeoffs && typeof northStar.tradeoffs === 'object') {
      lines.push('### Trade-offs (explicit positions)');
      lines.push('');
      Object.entries(northStar.tradeoffs).forEach(([k, v]) => lines.push(`- **${k}**: ${v}`));
      lines.push('');
    }
  }
  lines.push('## Recent Decisions (most recent first)');
  lines.push('');
  const decBlock = (decisions || []).slice(-30).reverse().map((d) =>
    `- **${d.topic || '(untitled)'}** (${d.date}) — ${d.decision}\n  why: ${d.why || '—'}` +
    (d.alternatives && d.alternatives.length ? `\n  considered: ${d.alternatives.join('; ')}` : '') +
    (d.tags && d.tags.length ? `\n  tags: ${d.tags.join(', ')}` : '')
  ).join('\n\n');
  lines.push(decBlock || '(none yet)');
  lines.push('');
  lines.push('## Patterns Observed');
  lines.push('');
  lines.push(((patterns || []).slice(-20).map((p) =>
    `- **${p.pattern}** (${p.date}) — observed in: ${p.observed_in || '—'}`
  ).join('\n')) || '(none yet)');
  lines.push('');
  lines.push('## Retrospectives');
  lines.push('');
  lines.push(((retros || []).slice(-20).map((r) =>
    `- (${r.date}) Worked: ${r.what_worked || '—'} · Didn\'t: ${r.what_didnt || '—'} · Lesson: ${r.lesson || '—'}`
  ).join('\n')) || '(none yet)');
  lines.push('');
  if (Array.isArray(documents) && documents.length) {
    lines.push('## Reference Library (uploaded documents)');
    lines.push('');
    lines.push('Jacqui can request full text via GET /api/jacqui/memory/documents/:id when relevant.');
    lines.push('');
    documents.slice(-20).reverse().forEach((doc) => {
      lines.push(`- **${doc.title}** (id: \`${doc.id}\`, ${doc.category || 'general'}, ${doc.pageCount || '?'}pp)`);
      if (doc.summary) lines.push(`  ${doc.summary}`);
    });
    lines.push('');
  }
  lines.push('---');
  lines.push('When in doubt, ask Jonathan rather than guess. Decisions logged here are durable — reference them, do not contradict them, unless he explicitly revises.');
  return lines.join('\n');
}

// Server-side helper for in-process callers (e.g. /api/jacqui/chat).
// Returns the same markdown string that GET /api/jacqui/memory/context serves.
export function loadMemoryContext(jacquiDir) {
  const MEM_DIR = path.join(jacquiDir, 'memory');
  const PATH_DEC  = path.join(MEM_DIR, 'decisions.jsonl');
  const PATH_PAT  = path.join(MEM_DIR, 'patterns.jsonl');
  const PATH_RET  = path.join(MEM_DIR, 'retros.jsonl');
  const PATH_NS   = path.join(MEM_DIR, 'north_star.json');
  const PATH_DOCS = path.join(MEM_DIR, 'documents.jsonl');
  const decisions = readJsonl(PATH_DEC);
  const patterns  = readJsonl(PATH_PAT);
  const retros    = readJsonl(PATH_RET);
  const documents = readJsonl(PATH_DOCS);
  let northStar = null;
  try { northStar = JSON.parse(fs.readFileSync(PATH_NS, 'utf8')); } catch {}
  return buildContext({ decisions, patterns, retros, northStar, documents });
}


async function summarizeWithHaiku({ anthropic, text, kind, hint }) {
  if (!anthropic) return { summary: text.slice(0, 240), title: hint || 'Document' };
  const completion = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{ role: 'user', content:
`Summarize the following ${kind} for a real estate agent's working memory. Return ONLY JSON (no fence, no prose):
{ "title": "<short title, max 60 chars>", "summary": "<2-3 sentence summary>", "tags": ["<tag1>", "..."] }

${kind === 'document' ? 'Document text (may be truncated):' : 'Markdown:'} """${text.slice(0, 8000)}"""`
    }],
  });
  let raw = (completion.content?.[0]?.text || '{}').trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const first = raw.indexOf('{'); const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) raw = raw.slice(first, last + 1);
  try { return JSON.parse(raw); } catch { return { title: hint || 'Document', summary: text.slice(0, 240), tags: [] }; }
}


// ── decomposeDocumentWithHaiku ────────────────────────────────────────
// Given a document's text, ask Haiku to break it into structured memory
// items: procedures (SOPs with steps + triggers), decisions (forward-looking
// rules), facts (atomic data points), retros (lessons / case studies).
// Used by POST /api/jacqui/memory/documents/:id/decompose.
async function decomposeDocumentWithHaiku({ anthropic, title, summary, text, tags }) {
  if (!anthropic) return { error: 'anthropic not configured', items: { procedures: [], decisions: [], facts: [], retros: [] } };

  // Bound input. Haiku 4.5 handles 200k context but we keep cost reasonable.
  const trimmed = String(text || '').slice(0, 80000);

  const prompt = `You are decomposing a real-estate document for Jonathan Wallace's Jacqui memory system. He works in Georgian Bay / Simcoe County Ontario.

Document title: ${title || '(untitled)'}
Document summary: ${summary || '(no summary)'}
Document tags: ${(tags || []).join(', ') || '(no tags)'}

Document text (truncated to 80k chars):
"""
${trimmed}
"""

Extract every actionable, retainable item into one of FOUR memory categories. Be generous — capture anything Jonathan would benefit from recalling. Return ONLY valid JSON with this exact shape:

{
  "doc_kind": "sop|playbook|policy|reference|case_study|mixed",
  "procedures": [
    {
      "name": "short procedure name (3-7 words)",
      "trigger_when": "the situation that should invoke this procedure",
      "steps": ["step 1...", "step 2...", "..."],
      "tags": ["domain", "tags"]
    }
  ],
  "decisions": [
    {
      "topic": "short topic",
      "decision": "the forward-looking rule, in one sentence under 200 chars",
      "why": "the reasoning",
      "tags": ["domain", "tags"]
    }
  ],
  "facts": [
    {
      "topic": "short topic",
      "decision": "the atomic fact, e.g. 'Realtor.com leads cost $8-12 each in 2023'",
      "why": "context",
      "tags": ["fact", ...other tags]
    }
  ],
  "retros": [
    {
      "what_worked": "...or null",
      "what_didnt": "...or null",
      "lesson": "the takeaway",
      "tags": ["domain", "tags"]
    }
  ]
}

Rules:
- Only include items genuinely present in the document. Don't fabricate.
- For each procedure, steps should be 3-12 concrete numbered actions.
- Facts go in the decisions array but with topic prefixed by "fact:".
- Tags should be lowercase, hyphenated, max 5 per item.
- If a category has nothing, return an empty array.
- Return JSON only — no markdown fences, no commentary.`;

  const completion = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = completion.content?.[0]?.text || '';
  let parsed = { procedures: [], decisions: [], facts: [], retros: [] };
  try {
    let t = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const f = t.indexOf('{'), l = t.lastIndexOf('}');
    if (f >= 0 && l > f) t = t.slice(f, l + 1);
    parsed = JSON.parse(t);
  } catch (e) {
    return { error: 'JSON parse failed: ' + e.message, raw: raw.slice(0, 500), items: parsed };
  }
  // Normalize — guarantee arrays exist
  return {
    doc_kind: parsed.doc_kind || 'mixed',
    items: {
      procedures: Array.isArray(parsed.procedures) ? parsed.procedures : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      retros: Array.isArray(parsed.retros) ? parsed.retros : [],
    },
    usage: completion.usage || null,
  };
}

async function extractHandoffWithHaiku({ anthropic, markdown }) {
  if (!anthropic) return { decisions: [], patterns: [], retros: [] };
  const completion = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    messages: [{ role: 'user', content:
`You are extracting structured memory from a session handoff document for Jonathan Wallace's real estate operations dashboard Agent HQ. Identify discrete decisions (what was decided + why + alternatives), observed patterns (recurring approaches), and retrospectives (what worked / what didn't / lessons).

Return ONLY a JSON object (no fence, no prose):
{
  "decisions": [
    { "date": "YYYY-MM-DD", "topic": "...", "decision": "...", "why": "...", "alternatives": [], "tags": [] }
  ],
  "patterns": [
    { "date": "YYYY-MM-DD", "pattern": "...", "observed_in": "...", "tags": [] }
  ],
  "retros": [
    { "date": "YYYY-MM-DD", "what_worked": "...", "what_didnt": "...", "lesson": "...", "tags": [] }
  ]
}

Be conservative: only extract things that are clearly decisions/patterns/retros, not narration. Skip status reports, deploy details, or commit lists. If a date isn't explicit, infer from context or use today's date.

Handoff document:
"""${markdown.slice(0, 20000)}"""`
    }],
  });
  let raw = (completion.content?.[0]?.text || '{}').trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const first = raw.indexOf('{'); const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) raw = raw.slice(first, last + 1);
  try { return JSON.parse(raw); } catch { return { decisions: [], patterns: [], retros: [] }; }
}

const LIBRARY_HTML = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><title>Jacqui's Library — Agent HQ</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --bg:#0e1118; --panel:#161b23; --line:#232b38; --text:#e5e7eb; --muted:#8b94a7; --accent:#6ea8ff; --ok:#22c55e; --err:#ef4444; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 24px; }
  .wrap { max-width: 920px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 22px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px; margin-bottom: 16px; }
  .panel h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 12px; }
  input[type=file], input[type=text], select { width: 100%; padding: 10px 12px; background: #0e1118; border: 1px solid var(--line); border-radius: 8px; color: var(--text); font: inherit; margin-bottom: 10px; }
  button { padding: 10px 14px; background: var(--accent); border: 0; border-radius: 8px; color: #0e1118; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; }
  .doc { padding: 12px; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 8px; }
  .doc .meta { font-size: 11px; color: var(--muted); margin-top: 4px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; background: rgba(110,168,255,.16); color: var(--accent); margin-right: 6px; }
  .result { padding: 10px; border-radius: 8px; margin-top: 10px; font-size: 13px; display: none; }
  .result.show { display: block; }
  .result.ok { background: rgba(34,197,94,.1); border: 1px solid rgba(34,197,94,.3); color: var(--ok); }
  .result.err { background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.3); color: var(--err); }
</style></head>
<body><div class="wrap">
<h1>Jacqui's Library</h1>
<div class="sub">Upload PDFs to teach Jacqui. Scripts, CMAs, training material, brokerage docs — all retained and searchable.</div>

<div class="panel">
  <h2>Upload a PDF</h2>
  <form id="uploadForm">
    <input type="file" id="file" accept="application/pdf,application/x-pdf,.pdf" required>
    <input type="text" id="title" placeholder="Optional title (auto-detected if blank)">
    <select id="category">
      <option value="general">General</option>
      <option value="scripts">Scripts / Dialogue</option>
      <option value="cma">CMA / Valuation</option>
      <option value="contracts">Contracts / Forms</option>
      <option value="marketing">Marketing</option>
      <option value="training">Training / Coaching</option>
      <option value="brokerage">Brokerage / Faris</option>
    </select>
    <button type="submit" id="submitBtn">Upload & teach Jacqui</button>
  </form>
  <div id="result" class="result"></div>
</div>

<div class="panel">
  <h2>Existing Documents</h2>
  <div id="list">Loading…</div>
</div>
</div>
<script>
const $ = id => document.getElementById(id);
async function loadDocs() {
  const r = await fetch('/api/jacqui/memory/documents');
  const d = await r.json();
  const docs = d.documents || [];
  if (!docs.length) { $('list').innerHTML = '<div style="color:var(--muted);font-size:13px">No documents yet — upload your first above.</div>'; return; }
  $('list').innerHTML = docs.reverse().map(doc =>
    '<div class="doc"><div><span class="badge">' + (doc.category||'general') + '</span><strong>' + escapeHtml(doc.title) + '</strong></div>' +
    (doc.summary ? '<div style="margin-top:6px">' + escapeHtml(doc.summary) + '</div>' : '') +
    '<div class="meta">' + (doc.pageCount||'?') + ' pages · uploaded ' + new Date(doc.uploadedAt).toLocaleString() + ' · ID: <code>' + doc.id + '</code></div></div>'
  ).join('');
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
$('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = $('file').files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  fd.append('title', $('title').value);
  fd.append('category', $('category').value);
  const btn = $('submitBtn'); btn.disabled = true; btn.textContent = 'Reading & summarizing…';
  const res = $('result'); res.classList.remove('show','ok','err');
  try {
    const r = await fetch('/api/jacqui/memory/document', { method: 'POST', body: fd });
    const d = await r.json();
    if (d.ok) {
      res.classList.add('show','ok');
      res.innerHTML = '✓ Uploaded — Jacqui now knows about <strong>' + escapeHtml(d.document.title) + '</strong>' +
        (d.document.summary ? '<br><span style="color:var(--muted);font-size:12px">' + escapeHtml(d.document.summary) + '</span>' : '');
      $('file').value = ''; $('title').value = '';
      loadDocs();
    } else {
      res.classList.add('show','err');
      res.textContent = '✗ ' + (d.error || 'unknown error');
    }
  } catch (err) {
    res.classList.add('show','err');
    res.textContent = '✗ ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Upload & teach Jacqui';
  }
});
loadDocs();
</script>
</body></html>`;

export function register(app, deps) {
  const { jacquiDir, anthropic, pdfParse, multer } = deps;
  const MEM_DIR = path.join(jacquiDir, 'memory');
  const DOCS_DIR = path.join(MEM_DIR, 'documents');
  ensureDir(MEM_DIR); ensureDir(DOCS_DIR);
  const PATH_DEC = path.join(MEM_DIR, 'decisions.jsonl');
  const PATH_PAT = path.join(MEM_DIR, 'patterns.jsonl');
  const PATH_RET = path.join(MEM_DIR, 'retros.jsonl');
  const PATH_NS  = path.join(MEM_DIR, 'north_star.json');
  const PATH_DOCS = path.join(MEM_DIR, 'documents.jsonl');

  const upload = multer
    ? multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })
    : null;

  // ── Decision/pattern/retro/north-star (unchanged from v1) ──
  app.post('/api/jacqui/memory/decision', (req, res) => {
    const b = req.body || {};
    if (!b.decision) return res.status(400).json({ ok: false, error: 'decision required' });
    const entry = {
      id: b.id || makeId('dec'),
      date: b.date || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      topic: b.topic || null, decision: b.decision, why: b.why || null,
      alternatives: Array.isArray(b.alternatives) ? b.alternatives : [],
      trade_offs: b.trade_offs || null, context: b.context || null,
      tags: Array.isArray(b.tags) ? b.tags : [], session_id: b.session_id || null,
    };
    appendJsonl(PATH_DEC, entry);
    res.json({ ok: true, entry });
  });

  app.post('/api/jacqui/memory/pattern', (req, res) => {
    const b = req.body || {};
    if (!b.pattern) return res.status(400).json({ ok: false, error: 'pattern required' });
    const entry = {
      id: b.id || makeId('pat'),
      date: b.date || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      pattern: b.pattern, observed_in: b.observed_in || null,
      client_type: b.client_type || null, example: b.example || null,
      tags: Array.isArray(b.tags) ? b.tags : [],
    };
    appendJsonl(PATH_PAT, entry);
    res.json({ ok: true, entry });
  });

  app.post('/api/jacqui/memory/retro', (req, res) => {
    const b = req.body || {};
    if (!b.what_worked && !b.what_didnt && !b.lesson) {
      return res.status(400).json({ ok: false, error: 'at least one of what_worked, what_didnt, lesson required' });
    }
    const entry = {
      id: b.id || makeId('ret'),
      date: b.date || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      what_worked: b.what_worked || null, what_didnt: b.what_didnt || null,
      lesson: b.lesson || null, tags: Array.isArray(b.tags) ? b.tags : [],
      session_id: b.session_id || null,
    };
    appendJsonl(PATH_RET, entry);
    res.json({ ok: true, entry });
  });

  app.put('/api/jacqui/memory/north-star', (req, res) => {
    const b = req.body || {};
    if (!b.primary) return res.status(400).json({ ok: false, error: 'primary required' });
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(PATH_NS, 'utf8')); } catch {}
    const entry = {
      primary: b.primary, tagline: b.tagline || null, outcome_60d: b.outcome_60d || null,
      priorities: Array.isArray(b.priorities) ? b.priorities : [],
      tradeoffs: b.tradeoffs && typeof b.tradeoffs === 'object' ? b.tradeoffs : {},
      version: (prev?.version || 0) + 1,
      updated_at: new Date().toISOString(),
      previous_version_id: prev?.updated_at || null,
    };
    fs.writeFileSync(PATH_NS, JSON.stringify(entry, null, 2));
    res.json({ ok: true, entry });
  });

  app.get('/api/jacqui/memory/north-star', (req, res) => {
    try { res.json({ ok: true, northStar: JSON.parse(fs.readFileSync(PATH_NS, 'utf8')) }); }
    catch { res.json({ ok: true, northStar: null }); }
  });

  app.get('/api/jacqui/memory/recent', (req, res) => {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
    res.json({
      ok: true,
      counts: {
        decisions: readJsonl(PATH_DEC).length,
        patterns: readJsonl(PATH_PAT).length,
        retros: readJsonl(PATH_RET).length,
        documents: readJsonl(PATH_DOCS).length,
      },
      decisions: readJsonl(PATH_DEC, limit),
      patterns: readJsonl(PATH_PAT, limit),
      retros: readJsonl(PATH_RET, limit),
    });
  });

  app.get('/api/jacqui/memory/all', (req, res) => {
    res.json({
      ok: true,
      decisions: readJsonl(PATH_DEC),
      patterns: readJsonl(PATH_PAT),
      retros: readJsonl(PATH_RET),
      documents: readJsonl(PATH_DOCS),
      northStar: (() => { try { return JSON.parse(fs.readFileSync(PATH_NS, 'utf8')); } catch { return null; } })(),
    });
  });

  app.get('/api/jacqui/memory/context', (req, res) => {
    const decisions = readJsonl(PATH_DEC);
    const patterns = readJsonl(PATH_PAT);
    const retros = readJsonl(PATH_RET);
    const documents = readJsonl(PATH_DOCS);
    let northStar = null;
    try { northStar = JSON.parse(fs.readFileSync(PATH_NS, 'utf8')); } catch {}
    const ctx = buildContext({ decisions, patterns, retros, northStar, documents });
    if (req.query.format === 'json') {
      res.json({ ok: true, context: ctx, decisions, patterns, retros, northStar, documents });
    } else {
      res.set('Content-Type', 'text/markdown; charset=utf-8');
      res.send(ctx);
    }
  });

  app.get('/api/jacqui/memory/query', (req, res) => {
    const type = String(req.query.type || 'decision').toLowerCase();
    const tag = req.query.tag ? String(req.query.tag).toLowerCase() : null;
    const q = req.query.q ? String(req.query.q).toLowerCase() : null;
    const since = req.query.since || null;
    const file = ({ decision: PATH_DEC, pattern: PATH_PAT, retro: PATH_RET, document: PATH_DOCS })[type];
    if (!file) return res.status(400).json({ ok: false, error: 'type must be decision|pattern|retro|document' });
    let entries = readJsonl(file);
    if (tag) entries = entries.filter((e) => (e.tags || []).some((t) => String(t).toLowerCase() === tag));
    if (since) entries = entries.filter((e) => e.date && e.date >= since);
    if (q) entries = entries.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
    res.json({ ok: true, type, count: entries.length, entries });
  });

  // ── POST /api/jacqui/memory/document — upload PDF ──
  if (upload && pdfParse) {
    app.post('/api/jacqui/memory/document', upload.single('file'), async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ ok: false, error: 'file required (multipart field "file")' });
        const buf = req.file.buffer;
        const filename = req.file.originalname || 'document.pdf';

        // Parse PDF
        const parsed = await pdfParse(buf);
        const text = (parsed.text || '').trim();
        const pageCount = parsed.numpages || null;
        if (!text) return res.status(400).json({ ok: false, error: 'PDF parsed but produced no text — may be image-only' });

        // Summarize with Haiku
        const summary = await summarizeWithHaiku({
          anthropic, text, kind: 'document',
          hint: req.body?.title || filename.replace(/\.pdf$/i, ''),
        });

        const id = makeId('doc');
        const docPath = path.join(DOCS_DIR, `${id}.txt`);
        fs.writeFileSync(docPath, text);

        const entry = {
          id, createdAt: new Date().toISOString(), uploadedAt: new Date().toISOString(),
          title: (req.body?.title || summary.title || filename.replace(/\.pdf$/i, '')).slice(0, 120),
          category: req.body?.category || 'general',
          source_filename: filename,
          summary: summary.summary || null,
          tags: summary.tags || [],
          pageCount,
          textLength: text.length,
          textPath: docPath,
        };
        appendJsonl(PATH_DOCS, entry);
        res.json({ ok: true, document: entry });
      } catch (err) {
        console.error('[JacquiMemory.document] error:', err);
        res.status(500).json({ ok: false, error: err.message });
      }
    });
  } else {
    app.post('/api/jacqui/memory/document', (req, res) => {
      res.status(503).json({ ok: false, error: 'document upload not configured (missing multer or pdfParse)' });
    });
  }

  app.get('/api/jacqui/memory/documents', (req, res) => {
    const docs = readJsonl(PATH_DOCS);
    // Strip full text path from list view
    res.json({ ok: true, documents: docs.map(({ textPath, ...rest }) => rest) });
  });

  app.get('/api/jacqui/memory/documents/:id', (req, res) => {
    const docs = readJsonl(PATH_DOCS);
    const doc = docs.find((d) => d.id === req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: 'not found' });
    let text = '';
    try { text = fs.readFileSync(doc.textPath, 'utf8'); } catch (err) { text = `(text unavailable: ${err.message})`; }
    res.json({ ok: true, document: { ...doc, text } });
  });

  // ── POST /api/jacqui/memory/ingest-handoff ──
  // Accepts { markdown: "...", source: "filename or drive id" }
  // Uses Haiku to extract decisions/patterns/retros and POSTs each.
  app.post('/api/jacqui/memory/ingest-handoff', async (req, res) => {
    const b = req.body || {};
    const markdown = String(b.markdown || '').trim();
    const source = String(b.source || 'unknown').slice(0, 200);
    if (!markdown) return res.status(400).json({ ok: false, error: 'markdown required' });
    if (markdown.length > 100000) return res.status(400).json({ ok: false, error: 'markdown too long (>100k chars)' });

    let extracted;
    try {
      extracted = await extractHandoffWithHaiku({ anthropic, markdown });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'extraction failed: ' + err.message });
    }

    const today = new Date().toISOString().slice(0, 10);
    const session_id = `handoff_${today}_${Math.random().toString(36).slice(2, 8)}`;
    let added = { decisions: 0, patterns: 0, retros: 0 };

    (extracted.decisions || []).forEach((d) => {
      const entry = {
        id: makeId('dec'),
        date: d.date || today,
        createdAt: new Date().toISOString(),
        topic: d.topic || null, decision: d.decision || null,
        why: d.why || null,
        alternatives: Array.isArray(d.alternatives) ? d.alternatives : [],
        trade_offs: d.trade_offs || null, context: d.context || null,
        tags: Array.isArray(d.tags) ? [...d.tags, 'from-handoff'] : ['from-handoff'],
        session_id, ingest_source: source,
      };
      if (entry.decision) { appendJsonl(PATH_DEC, entry); added.decisions++; }
    });
    (extracted.patterns || []).forEach((p) => {
      const entry = {
        id: makeId('pat'),
        date: p.date || today,
        createdAt: new Date().toISOString(),
        pattern: p.pattern || null,
        observed_in: p.observed_in || source,
        client_type: p.client_type || null,
        tags: Array.isArray(p.tags) ? [...p.tags, 'from-handoff'] : ['from-handoff'],
      };
      if (entry.pattern) { appendJsonl(PATH_PAT, entry); added.patterns++; }
    });
    (extracted.retros || []).forEach((r) => {
      const entry = {
        id: makeId('ret'),
        date: r.date || today,
        createdAt: new Date().toISOString(),
        what_worked: r.what_worked || null, what_didnt: r.what_didnt || null,
        lesson: r.lesson || null,
        tags: Array.isArray(r.tags) ? [...r.tags, 'from-handoff'] : ['from-handoff'],
        session_id, ingest_source: source,
      };
      if (entry.what_worked || entry.what_didnt || entry.lesson) {
        appendJsonl(PATH_RET, entry); added.retros++;
      }
    });

    res.json({ ok: true, source, added, extracted });
  });


  // ── POST /api/jacqui/memory/documents/:id/decompose ──
  // Layer 2 teaching: take an already-uploaded document and decompose it into
  // structured memory items (procedures, decisions, facts, retros). Two modes:
  //   ?commit=false (default) → return preview only, do not write
  //   ?commit=true           → write extracted items to memory stores
  app.post('/api/jacqui/memory/documents/:id/decompose', async (req, res) => {
    const id = req.params.id;
    const docs = readJsonl(PATH_DOCS);
    const doc = docs.find(d => d.id === id);
    if (!doc) return res.status(404).json({ ok: false, error: 'document not found' });

    let text = doc.text;
    if (!text && doc.textPath && fs.existsSync(doc.textPath)) {
      try { text = fs.readFileSync(doc.textPath, 'utf8'); } catch {}
    }
    if (!text) return res.status(400).json({ ok: false, error: 'document has no text' });

    const result = await decomposeDocumentWithHaiku({
      anthropic,
      title: doc.title || doc.source_filename || id,
      summary: doc.summary || '',
      text,
      tags: doc.tags || [],
    });
    if (result.error) {
      return res.status(500).json({ ok: false, error: result.error, raw: result.raw });
    }

    const commit = req.query.commit === 'true' || req.body?.commit === true;
    const added = { procedures: 0, decisions: 0, facts: 0, retros: 0 };

    if (commit) {
      const sourceTag = `doc:${doc.source_filename || doc.title || id}`;
      const today = new Date().toISOString().slice(0, 10);
      const extraTags = ['from-document', 'jacqui-auto', sourceTag];

      for (const p of result.items.procedures) {
        const entry = {
          id: makeId('pat'),
          date: today,
          createdAt: new Date().toISOString(),
          pattern: p.name || 'procedure',
          trigger_when: p.trigger_when || null,
          steps: Array.isArray(p.steps) ? p.steps : [],
          example: null,
          tags: [...(Array.isArray(p.tags) ? p.tags : []), 'procedure', ...extraTags],
          source_doc_id: id,
        };
        appendJsonl(PATH_PAT, entry);
        added.procedures++;
      }
      for (const d of result.items.decisions) {
        if (!d.decision) continue;
        const entry = {
          id: makeId('dec'),
          date: today,
          createdAt: new Date().toISOString(),
          topic: d.topic || null,
          decision: d.decision,
          why: d.why || null,
          alternatives: [],
          tags: [...(Array.isArray(d.tags) ? d.tags : []), ...extraTags],
          source_doc_id: id,
        };
        appendJsonl(PATH_DEC, entry);
        added.decisions++;
      }
      for (const f of result.items.facts) {
        if (!f.decision) continue;
        const entry = {
          id: makeId('fact'),
          date: today,
          createdAt: new Date().toISOString(),
          topic: f.topic ? (f.topic.startsWith('fact:') ? f.topic : 'fact: ' + f.topic) : 'fact',
          decision: f.decision,
          why: f.why || null,
          alternatives: [],
          tags: [...(Array.isArray(f.tags) ? f.tags : ['fact']), ...extraTags],
          source_doc_id: id,
        };
        appendJsonl(PATH_DEC, entry);
        added.facts++;
      }
      for (const r of result.items.retros) {
        if (!r.what_worked && !r.what_didnt && !r.lesson) continue;
        const entry = {
          id: makeId('ret'),
          date: today,
          createdAt: new Date().toISOString(),
          what_worked: r.what_worked || null,
          what_didnt: r.what_didnt || null,
          lesson: r.lesson || null,
          tags: [...(Array.isArray(r.tags) ? r.tags : []), ...extraTags],
          source_doc_id: id,
        };
        appendJsonl(PATH_RET, entry);
        added.retros++;
      }
    }

    res.json({
      ok: true,
      doc_id: id,
      doc_title: doc.title || doc.source_filename || id,
      doc_kind: result.doc_kind,
      committed: commit,
      counts: {
        procedures: result.items.procedures.length,
        decisions: result.items.decisions.length,
        facts: result.items.facts.length,
        retros: result.items.retros.length,
      },
      added,
      items: result.items,
      usage: result.usage,
    });
  });

  // ── GET /admin/jacqui-library — HTML UI ──
  app.get('/admin/jacqui-library', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(LIBRARY_HTML);
  });

  console.log('[JacquiMemory] registered v2 — decisions/patterns/retros/north-star + documents + ingest-handoff + /admin/jacqui-library');
}

