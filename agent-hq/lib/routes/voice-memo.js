// lib/routes/voice-memo.js
//
// Voice Memo → Structured Action (Sprint 1 #2 of 2026-05-17 council audit)
//
// Mobile-friendly capture: open /voice on phone, tap mic, talk, release.
// Transcription happens IN THE BROWSER via webkitSpeechRecognition (audio
// never leaves your device). The transcribed TEXT is sent to /api/voice/ingest
// where Haiku classifies + routes into one of three destinations:
//
//   fub_note — search FUB by extracted contact name, post a note to that contact
//   task     — append to voice-memos.jsonl tagged 'task' (productivity skill
//              reads this and surfaces in TASKS.md)
//   cma_note — append to voice-memos.jsonl tagged 'cma' (CMA UI integration
//              follow-up; the memo is captured + queryable today)
//
// Every memo is also logged to DATA_DIR/voice-memos.jsonl with full plan +
// action results so nothing is ever lost.
//
// Created 2026-05-17.

import fs from 'fs';
import path from 'path';
import { pickModel } from '../jacqui/model-router.js';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
  ));
}

// Robust JSON extraction — Haiku usually returns clean JSON, but strip code
// fences just in case.
function parsePlan(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  // Find first { and matching last } in case there's prose around it
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t);
}

async function classifyMemo({ anthropic, text }) {
  if (!anthropic) {
    return {
      intent: 'other', summary: text.slice(0, 80),
      contact_name: null, property_address: null,
      priority: 'normal', due_date: null,
      _note: 'anthropic not configured — captured but not classified',
    };
  }
  const completion = await anthropic.messages.create({
    model: pickModel('quick'),
    max_tokens: 500,
    messages: [{
      role: 'user',
      content:
`You are routing a voice memo from Jonathan Wallace, a real estate agent in Georgian Bay, Ontario (Midland, Penetanguishene, Tay, Tiny, Wasaga Beach). Classify and structure it.

Memo: """${text}"""

Return ONLY a JSON object with this exact shape (no prose, no markdown fence):
{
  "intent": "fub_note" | "task" | "cma_note" | "other",
  "summary": "<1-line summary, max 80 chars>",
  "contact_name": "<extracted person name, or null>",
  "property_address": "<extracted street address, or null>",
  "priority": "high" | "normal" | "low",
  "due_date": "<ISO 8601 date if a date is mentioned, or null>"
}

Heuristics:
- Mentions a person/lead/client by name AND is about communication, follow-up, status, or notes → fub_note
- To-do / action item / errand / "remind me" / "I need to" / "don't forget" → task
- About a property, valuation, comp, listing, square footage, condition → cma_note
- Otherwise → other`,
    }],
  });
  const raw = completion.content?.[0]?.text || '{}';
  return parsePlan(raw);
}

export function register(app, deps) {
  const {
    anthropic,
    fubApiKey, fubBase, fubHeaders,
    dataDir,
  } = deps;
  // server.js already mounts app.use(express.json({ limit: '25mb' })) globally,
  // so route handlers can read req.body directly without per-route middleware.

  const VOICE_LOG_PATH = path.join(dataDir, 'voice-memos.jsonl');

  function appendMemo(entry) {
    try {
      fs.appendFileSync(VOICE_LOG_PATH, JSON.stringify(entry) + '\n');
    } catch (err) {
      console.error('[VoiceMemo] append failed:', err.message);
    }
  }

  // ──────────────────────────────────────────
  // POST /api/voice/ingest — text → classify → route → log
  // ──────────────────────────────────────────
  app.post('/api/voice/ingest', async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'text required' });
    if (text.length > 4000) return res.status(400).json({ ok: false, error: 'text too long (>4000 chars)' });

    const memoId = `vm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date().toISOString();

    // ── Classify ──
    let plan;
    try {
      plan = await classifyMemo({ anthropic, text });
    } catch (err) {
      console.error('[VoiceMemo] classify failed:', err.message);
      plan = {
        intent: 'other', summary: text.slice(0, 80),
        contact_name: null, property_address: null,
        priority: 'normal', due_date: null,
        _classifyError: err.message,
      };
    }

    const actions = [];

    // ── Route: fub_note ──
    if (plan.intent === 'fub_note' && plan.contact_name && fubApiKey) {
      try {
        const searchResp = await fetch(
          `${fubBase}/people?q=${encodeURIComponent(plan.contact_name)}&limit=5`,
          { headers: fubHeaders() }
        );
        if (!searchResp.ok) throw new Error(`FUB search ${searchResp.status}`);
        const search = await searchResp.json();
        const person = (search.people || [])[0];
        if (!person) {
          actions.push({
            type: 'fub_note', status: 'no_match',
            contactName: plan.contact_name,
            detail: 'No FUB contact found — memo still saved in voice-memos.jsonl',
          });
        } else {
          const noteBody =
            `<p><strong>Voice memo (from Agent HQ /voice):</strong></p>` +
            `<p>${escapeHtml(text)}</p>` +
            (plan.summary ? `<p style="color:#666"><em>${escapeHtml(plan.summary)}</em></p>` : '') +
            `<p style="color:#999;font-size:11px">Captured ${createdAt}</p>`;
          const noteResp = await fetch(`${fubBase}/notes`, {
            method: 'POST',
            headers: fubHeaders(),
            body: JSON.stringify({
              personId: person.id,
              subject: 'Voice Memo',
              body: noteBody,
            }),
          });
          if (!noteResp.ok) {
            const errBody = await noteResp.text().catch(() => '');
            throw new Error(`FUB notes ${noteResp.status}: ${errBody.slice(0, 200)}`);
          }
          const note = await noteResp.json();
          actions.push({
            type: 'fub_note', status: 'success',
            personId: person.id,
            personName: `${person.firstName || ''} ${person.lastName || ''}`.trim(),
            noteId: note.id,
          });
        }
      } catch (err) {
        actions.push({ type: 'fub_note', status: 'error', error: err.message });
      }
    }

    // ── Route: task ──
    if (plan.intent === 'task') {
      actions.push({
        type: 'task', status: 'logged',
        priority: plan.priority || 'normal',
        due: plan.due_date || null,
        detail: 'Captured to voice-memos.jsonl — productivity skill picks these up',
      });
    }

    // ── Route: cma_note ──
    if (plan.intent === 'cma_note') {
      actions.push({
        type: 'cma_note', status: 'logged',
        property: plan.property_address || null,
        detail: 'Captured to voice-memos.jsonl — surfaces in CMA when address is referenced',
      });
    }

    // ── Route: other / fallthrough ──
    if (actions.length === 0) {
      actions.push({ type: 'other', status: 'logged', detail: 'Memo captured (no specific routing)' });
    }

    // ── Always log to JSONL ──
    const entry = { memoId, createdAt, text, plan, actions };
    appendMemo(entry);

    res.json({ ok: true, ...entry });
  });

  // ──────────────────────────────────────────
  // GET /api/voice/recent — last N memos
  // ──────────────────────────────────────────
  app.get('/api/voice/recent', (req, res) => {
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
    try {
      if (!fs.existsSync(VOICE_LOG_PATH)) return res.json({ ok: true, memos: [] });
      const lines = fs.readFileSync(VOICE_LOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
      const memos = lines.slice(-limit).reverse()
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
      res.json({ ok: true, memos });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ──────────────────────────────────────────
  // GET /voice — the capture page
  // ──────────────────────────────────────────
  app.get('/voice', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(VOICE_HTML);
  });

  console.log('[VoiceMemo] registered /voice + /api/voice/{ingest,recent}');
}

const VOICE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Voice Memo — Agent HQ</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="apple-touch-icon" href="/agent-hq-logo.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>
  :root {
    --bg: #0e1118; --panel: #161b23; --line: #232b38;
    --text: #e5e7eb; --muted: #8b94a7;
    --accent: #6ea8ff; --ok: #22c55e; --err: #ef4444; --rec: #ef4444;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    background: var(--bg); color: var(--text);
    min-height: 100vh; padding: 16px;
    padding-top: env(safe-area-inset-top, 16px);
    padding-bottom: env(safe-area-inset-bottom, 16px);
  }
  .wrap { max-width: 560px; margin: 0 auto; }
  header { text-align: center; margin-bottom: 18px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { font-size: 13px; color: var(--muted); }
  .mic-wrap { display: flex; flex-direction: column; align-items: center; padding: 12px 0 16px; }
  .mic {
    width: 120px; height: 120px; border-radius: 50%;
    background: linear-gradient(135deg, #ef4444, #b91c1c);
    border: 0; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 8px 30px rgba(239,68,68,.35), inset 0 -4px 12px rgba(0,0,0,.2);
    transition: transform .1s ease, box-shadow .2s ease;
  }
  .mic:active { transform: scale(.96); }
  .mic.recording {
    background: linear-gradient(135deg, #dc2626, #7f1d1d);
    box-shadow: 0 0 0 14px rgba(239,68,68,.18), 0 8px 30px rgba(239,68,68,.55);
    animation: rec-pulse 1.6s ease-in-out infinite;
  }
  @keyframes rec-pulse {
    0%,100% { box-shadow: 0 0 0 14px rgba(239,68,68,.18), 0 8px 30px rgba(239,68,68,.55); }
    50%     { box-shadow: 0 0 0 24px rgba(239,68,68,.06), 0 8px 30px rgba(239,68,68,.55); }
  }
  .mic svg { width: 56px; height: 56px; fill: #fff; }
  .mic-label { margin-top: 12px; font-size: 13px; color: var(--muted); height: 18px; }
  textarea {
    width: 100%; min-height: 140px; padding: 12px 14px;
    background: var(--panel); color: var(--text);
    border: 1px solid var(--line); border-radius: 10px;
    font: 15px/1.5 -apple-system, system-ui, sans-serif;
    resize: vertical;
  }
  textarea:focus { outline: none; border-color: var(--accent); }
  .row { display: flex; gap: 10px; margin-top: 10px; }
  .row button { flex: 1; padding: 12px; font-size: 15px; border-radius: 10px; border: 1px solid var(--line);
                background: var(--panel); color: var(--text); cursor: pointer; }
  .row button.primary { background: var(--accent); border-color: var(--accent); color: #0e1118; font-weight: 600; }
  .row button.primary:disabled { opacity: .5; }
  .result {
    margin-top: 16px; padding: 12px 14px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    font-size: 14px; display: none;
  }
  .result.show { display: block; }
  .result.ok { border-color: rgba(34,197,94,.4); }
  .result.err { border-color: rgba(239,68,68,.4); }
  .result h3 { margin: 0 0 6px; font-size: 14px; }
  .result .meta { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px;
           background: rgba(110,168,255,.15); color: var(--accent); margin-right: 6px; }
  .badge.fub { background: rgba(34,197,94,.15); color: var(--ok); }
  .badge.task { background: rgba(245,158,11,.18); color: #f59e0b; }
  .badge.cma { background: rgba(168,85,247,.18); color: #c084fc; }
  .recent { margin-top: 28px; }
  .recent h2 { font-size: 14px; color: var(--muted); margin: 0 0 10px; text-transform: uppercase; letter-spacing: .06em; }
  .recent .item { padding: 10px 12px; background: var(--panel); border: 1px solid var(--line);
                  border-radius: 8px; margin-bottom: 8px; font-size: 13px; }
  .recent .item .when { font-size: 11px; color: var(--muted); }
  .recent .item .summary { margin-top: 4px; }
  .err-msg { color: var(--err); font-size: 13px; margin-top: 8px; }
  .hint { font-size: 12px; color: var(--muted); text-align: center; margin-top: 6px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Voice Memo</h1>
    <div class="sub">Talk · we'll route it to FUB, Tasks, or CMA notes.</div>
  </header>

  <div class="mic-wrap">
    <button id="mic" class="mic" aria-label="Record">
      <svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>
    </button>
    <div id="mic-label" class="mic-label">Tap to start</div>
  </div>

  <textarea id="text" placeholder="Speak or type your memo here…"></textarea>
  <div class="row">
    <button id="clear">Clear</button>
    <button id="send" class="primary" disabled>Send to HQ</button>
  </div>
  <div class="hint" id="hint">Tip: Web Speech works best in Safari/Chrome. If it's unavailable on your device, just type the memo and tap Send.</div>

  <div id="result" class="result"></div>

  <div class="recent" id="recent"></div>
</div>

<script>
const $ = id => document.getElementById(id);
const textEl = $('text'), micEl = $('mic'), labelEl = $('mic-label'), sendEl = $('send'), clearEl = $('clear'), resultEl = $('result');

// ── Web Speech setup (with prefix fallback) ──
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recording = false;

function updateSend() { sendEl.disabled = !textEl.value.trim() || recording; }
textEl.addEventListener('input', updateSend);
clearEl.addEventListener('click', () => { textEl.value=''; updateSend(); resultEl.classList.remove('show'); });

if (SR) {
  rec = new SR();
  rec.continuous = true; rec.interimResults = true; rec.lang = 'en-CA';
  let finalBuffer = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalBuffer += t + ' ';
      else interim += t;
    }
    textEl.value = (finalBuffer + interim).trim();
    updateSend();
  };
  rec.onerror = (e) => {
    labelEl.textContent = 'Mic error: ' + e.error + ' — type instead';
    stopRec();
  };
  rec.onend = () => {
    if (recording) {
      // Auto-restart for continuous (some browsers stop after ~30s)
      try { rec.start(); } catch {}
    }
  };
} else {
  micEl.style.opacity = '.4';
  labelEl.textContent = 'Voice unavailable on this browser — type below';
}

function startRec() {
  if (!rec) return;
  try {
    rec.start();
    recording = true;
    micEl.classList.add('recording');
    labelEl.textContent = 'Listening… tap again to stop';
    sendEl.disabled = true;
  } catch (err) {
    labelEl.textContent = 'Could not start: ' + err.message;
  }
}
function stopRec() {
  if (!rec) return;
  recording = false;
  try { rec.stop(); } catch {}
  micEl.classList.remove('recording');
  labelEl.textContent = textEl.value.trim() ? 'Got it — review and send' : 'Tap to start';
  updateSend();
}

micEl.addEventListener('click', () => recording ? stopRec() : startRec());

sendEl.addEventListener('click', async () => {
  const text = textEl.value.trim();
  if (!text) return;
  sendEl.disabled = true;
  sendEl.textContent = 'Sending…';
  resultEl.classList.remove('show', 'ok', 'err');
  try {
    const res = await fetch('/api/voice/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.classList.add('show', 'ok');
      resultEl.innerHTML = renderResult(data);
      textEl.value = '';
      loadRecent();
    } else {
      resultEl.classList.add('show', 'err');
      resultEl.innerHTML = '<h3>Send failed</h3><div class="err-msg">' + (data.error || 'unknown') + '</div>';
    }
  } catch (err) {
    resultEl.classList.add('show', 'err');
    resultEl.innerHTML = '<h3>Send failed</h3><div class="err-msg">' + err.message + '</div>';
  } finally {
    sendEl.disabled = false;
    sendEl.textContent = 'Send to HQ';
    updateSend();
  }
});

function renderResult(d) {
  const intent = (d.plan?.intent || 'other');
  const badge = '<span class="badge ' + (intent==='fub_note'?'fub':intent==='task'?'task':intent==='cma_note'?'cma':'') + '">' + intent.replace('_', ' ') + '</span>';
  const summary = d.plan?.summary || d.text.slice(0, 80);
  const actionsHtml = (d.actions || []).map(a => {
    const ok = a.status === 'success' || a.status === 'logged';
    const color = ok ? 'var(--ok)' : (a.status === 'no_match' ? '#f59e0b' : 'var(--err)');
    let line = '<div style="color:' + color + ';font-size:12px;margin-top:4px">';
    if (a.type === 'fub_note' && a.status === 'success')
      line += '✓ Note added to <strong>' + (a.personName || 'contact') + '</strong> in FUB';
    else if (a.type === 'fub_note' && a.status === 'no_match')
      line += '⚠ No FUB contact found for "' + (a.contactName || '') + '" — memo saved';
    else if (a.type === 'fub_note' && a.status === 'error')
      line += '✗ FUB error: ' + a.error;
    else if (a.type === 'task')
      line += '✓ Logged as task (' + (a.priority || 'normal') + (a.due ? ', due ' + a.due : '') + ')';
    else if (a.type === 'cma_note')
      line += '✓ Logged as CMA note' + (a.property ? ' for ' + a.property : '');
    else
      line += '✓ ' + (a.detail || a.status);
    line += '</div>';
    return line;
  }).join('');
  return '<h3>' + badge + ' ' + summary + '</h3>' +
         '<div class="meta">' + new Date(d.createdAt).toLocaleString() + '</div>' +
         actionsHtml;
}

async function loadRecent() {
  try {
    const res = await fetch('/api/voice/recent?limit=10');
    const data = await res.json();
    const memos = data.memos || [];
    if (memos.length === 0) { $('recent').innerHTML = ''; return; }
    $('recent').innerHTML = '<h2>Recent memos</h2>' + memos.map(m => {
      const intent = m.plan?.intent || 'other';
      const badge = '<span class="badge ' + (intent==='fub_note'?'fub':intent==='task'?'task':intent==='cma_note'?'cma':'') + '">' + intent.replace('_',' ') + '</span>';
      return '<div class="item"><div class="when">' + new Date(m.createdAt).toLocaleString() + '</div>' +
             '<div class="summary">' + badge + ' ' + (m.plan?.summary || m.text.slice(0, 100)) + '</div></div>';
    }).join('');
  } catch {}
}
loadRecent();
updateSend();
</script>
</body>
</html>`;
