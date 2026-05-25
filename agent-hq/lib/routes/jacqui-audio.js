// lib/routes/jacqui-audio.js
//
// Phase 2: audio & transcript ingest for Jacqui.
//
// Endpoints:
//   POST  /api/jacqui/memory/audio
//         multipart upload (file=m4a/mp3/wav/webm).
//         Transcribes via OpenAI Whisper, stores audio + transcript on disk,
//         registers as a document in jacqui memory, optionally fires Layer 2
//         decompose immediately.
//
//   POST  /api/jacqui/memory/transcript
//         JSON body: { text, title?, source?, tags?[], decompose? }
//         For Otter/Fireflies/manual paste paths. Skips Whisper.
//
//   GET   /api/jacqui/memory/audio/list
//         Lists ingested audio items (id, title, duration, size, transcript_len).
//
// All three filter through Jonathan: decompose runs in PREVIEW mode by default
// (commit=false). He reviews the extracted items, then commits.
//
// Whisper config:
//   OPENAI_API_KEY env var required. Whisper model = 'whisper-1' via
//   https://api.openai.com/v1/audio/transcriptions
//
// Created 2026-05-25.

import fs from 'fs';
import path from 'path';
import { pickModel } from '../jacqui/model-router.js';

const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100 MB — OpenAI Whisper API cap is 25MB, we'll chunk above that in v2

function makeId(prefix) {
  const d = new Date().toISOString().slice(0, 10);
  return `${prefix}_${d}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function appendJsonl(filePath, entry) {
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
}

function readJsonl(filePath, limit = Infinity) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    const items = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return items.slice(-limit);
  } catch { return []; }
}

async function transcribeWithWhisper({ audioPath, mimetype, originalName }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { ok: false, error: 'OPENAI_API_KEY not configured on Railway — set it and redeploy' };
  }
  try {
    const buf = fs.readFileSync(audioPath);
    // Build multipart manually to keep deps tight
    const boundary = '----jacqui' + Math.random().toString(36).slice(2);
    const filename = originalName || 'audio' + path.extname(audioPath);
    const ct = mimetype || 'application/octet-stream';

    const parts = [];
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${ct}\r\n\r\n`));
    parts.push(buf);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    const text = await resp.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    if (!resp.ok) {
      return { ok: false, status: resp.status, error: parsed?.error?.message || text.slice(0, 300) };
    }
    return {
      ok: true,
      text: parsed.text || '',
      duration: parsed.duration || null,
      language: parsed.language || null,
      segments: parsed.segments || [],
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Summarize a transcript using the model router. Mirrors summarizeWithHaiku in
// jacqui-memory.js but for audio context.
async function summarizeTranscript({ anthropic, text, title }) {
  if (!anthropic) return { summary: '(no anthropic configured)', tags: [], title: title || 'transcript' };
  const trimmed = String(text || '').slice(0, 30000);
  const completion = await anthropic.messages.create({
    model: pickModel('quick'),
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Summarize this transcript in 2-3 sentences for Jonathan Wallace (real estate agent, Georgian Bay Ontario). Then propose 5-8 short lowercase-hyphenated tags. Return JSON only: {"title": "...", "summary": "...", "tags": ["tag1", "tag2"]}.

Transcript (truncated):
"""
${trimmed}
"""`,
    }],
  });
  const raw = completion.content?.[0]?.text || '';
  try {
    let t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const f = t.indexOf('{'), l = t.lastIndexOf('}');
    if (f >= 0 && l > f) t = t.slice(f, l + 1);
    const parsed = JSON.parse(t);
    return {
      title: parsed.title || title || 'transcript',
      summary: parsed.summary || '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch {
    return { title: title || 'transcript', summary: raw.slice(0, 300), tags: [] };
  }
}

export function register(app, deps) {
  const { jacquiDir, JACQUI_DIR, anthropic, multer } = deps;
  const dir = jacquiDir || JACQUI_DIR;
  if (!dir) throw new Error('jacqui-audio: jacquiDir required');

  const MEM_DIR = path.join(dir, 'memory');
  const DOCS_DIR = path.join(MEM_DIR, 'documents');
  const AUDIO_DIR = path.join(MEM_DIR, 'audio');
  const PATH_DOCS = path.join(MEM_DIR, 'documents.jsonl');
  ensureDir(MEM_DIR); ensureDir(DOCS_DIR); ensureDir(AUDIO_DIR);

  const upload = multer
    ? multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES } })
    : null;

  // ── POST /api/jacqui/memory/audio ─────────────────────────────────────
  if (upload) {
    app.post('/api/jacqui/memory/audio', upload.single('file'), async (req, res) => {
      if (!req.file) return res.status(400).json({ ok: false, error: 'no file uploaded (field name: file)' });
      const id = makeId('aud');
      const ext = path.extname(req.file.originalname || '') || '.m4a';
      const audioPath = path.join(AUDIO_DIR, `${id}${ext}`);
      try {
        fs.writeFileSync(audioPath, req.file.buffer);
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'audio save failed: ' + e.message });
      }

      // Transcribe
      const tr = await transcribeWithWhisper({
        audioPath,
        mimetype: req.file.mimetype,
        originalName: req.file.originalname,
      });
      if (!tr.ok) {
        return res.status(500).json({ ok: false, error: 'transcription failed: ' + tr.error, audioId: id });
      }
      const transcript = tr.text;
      const textPath = path.join(AUDIO_DIR, `${id}.txt`);
      fs.writeFileSync(textPath, transcript);

      // Summarize + tag
      const meta = await summarizeTranscript({ anthropic, text: transcript, title: req.file.originalname });

      // Register as a document so the existing decompose endpoint can act on it
      const docId = makeId('doc');
      const docEntry = {
        id: docId,
        createdAt: new Date().toISOString(),
        uploadedAt: new Date().toISOString(),
        title: meta.title,
        category: 'audio',
        source_filename: req.file.originalname || `audio${ext}`,
        summary: meta.summary,
        tags: [...meta.tags, 'audio', 'transcript'],
        pageCount: null,
        textLength: transcript.length,
        textPath,
        audioPath,
        duration: tr.duration,
        language: tr.language,
        text: transcript,
        audio_id: id,
      };
      appendJsonl(PATH_DOCS, docEntry);

      res.json({
        ok: true,
        audio_id: id,
        doc_id: docId,
        title: meta.title,
        summary: meta.summary,
        tags: meta.tags,
        duration: tr.duration,
        language: tr.language,
        transcript_length: transcript.length,
        decompose_url: `/api/jacqui/memory/documents/${docId}/decompose`,
        next_step: 'POST to decompose_url (commit=false) to preview structured extraction, then commit=true to write to memory',
      });
    });
  } else {
    app.post('/api/jacqui/memory/audio', (req, res) => {
      res.status(503).json({ ok: false, error: 'multer not available — audio upload disabled' });
    });
  }

  // ── POST /api/jacqui/memory/transcript ────────────────────────────────
  // Paste a transcript directly. Same downstream path as audio (creates a
  // document → decompose available).
  app.post('/api/jacqui/memory/transcript', async (req, res) => {
    const b = req.body || {};
    const text = String(b.text || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'text required' });

    const meta = await summarizeTranscript({
      anthropic,
      text,
      title: b.title || 'transcript',
    });
    const docId = makeId('doc');
    const docEntry = {
      id: docId,
      createdAt: new Date().toISOString(),
      uploadedAt: new Date().toISOString(),
      title: b.title || meta.title,
      category: 'transcript',
      source_filename: b.source || 'pasted-transcript',
      summary: meta.summary,
      tags: [...(Array.isArray(b.tags) ? b.tags : []), ...meta.tags, 'transcript'],
      pageCount: null,
      textLength: text.length,
      text,
    };
    appendJsonl(PATH_DOCS, docEntry);

    res.json({
      ok: true,
      doc_id: docId,
      title: docEntry.title,
      summary: docEntry.summary,
      tags: docEntry.tags,
      transcript_length: text.length,
      decompose_url: `/api/jacqui/memory/documents/${docId}/decompose`,
      next_step: 'POST to decompose_url (commit=false) to preview, then commit=true to write to memory',
    });
  });

  // ── GET /api/jacqui/memory/audio/list ─────────────────────────────────
  app.get('/api/jacqui/memory/audio/list', (req, res) => {
    const docs = readJsonl(PATH_DOCS);
    const audio = docs.filter(d => d.category === 'audio' || d.category === 'transcript');
    res.json({
      ok: true,
      count: audio.length,
      items: audio.map(d => ({
        doc_id: d.id,
        audio_id: d.audio_id || null,
        title: d.title,
        category: d.category,
        source: d.source_filename,
        duration: d.duration || null,
        language: d.language || null,
        transcript_length: d.textLength || (d.text ? d.text.length : 0),
        tags: d.tags || [],
        summary: d.summary || '',
        uploadedAt: d.uploadedAt || d.createdAt,
      })),
    });
  });

  console.log('[JacquiAudio] registered v1 — /api/jacqui/memory/{audio,transcript,audio/list}');
}
