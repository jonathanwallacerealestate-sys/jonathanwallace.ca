/**
 * Learning Capture — universal pipeline for everything Jonathan consumes
 * (Spotify episodes, Audible chapters, YouTube videos, articles, voice memos,
 * mentor conversations). Claude turns raw notes into structured insights and
 * action items, which can be one-click promoted to personal_tasks, follow-ups,
 * vocabulary, or memory.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const Anthropic = require('@anthropic-ai/sdk');
const { requireApiKey } = require('../middleware/apiKey');
const { publish } = require('../services/events');
const intuition = require('../services/intuition');

const anthropic = new Anthropic();

router.use(requireApiKey);

const VALID_KINDS = ['spotify_episode','audible_chapter','youtube_video','article','voice_memo','conversation','course_lesson','manual'];

// ---------- Sources ----------
router.get('/sources', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM learning_sources ORDER BY name ASC');
    res.json({ sources: rows });
  } catch (err) { res.status(500).json({ error: 'Failed to list sources' }); }
});

router.post('/sources', async (req, res) => {
  try {
    const b = req.body;
    if (!b.kind || !b.name) return res.status(400).json({ error: 'kind and name required' });
    const { rows } = await pool.query(
      `INSERT INTO learning_sources (kind, name, external_id, author, url, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (kind, external_id) DO UPDATE
         SET name = EXCLUDED.name, author = EXCLUDED.author,
             url = EXCLUDED.url, notes = EXCLUDED.notes
       RETURNING *`,
      [b.kind, b.name, b.external_id || null, b.author || null, b.url || null, b.notes || null]
    );
    res.status(201).json({ source: rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to save source' }); }
});

// ---------- Log entries ----------
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 200);
    const range = req.query.range;
    let where = '1=1';
    if (range === 'week') where = "consumed_at >= NOW() - INTERVAL '7 days'";
    if (range === 'month') where = "consumed_at >= NOW() - INTERVAL '30 days'";
    const { rows } = await pool.query(
      `SELECT l.*, s.name AS source_name, s.kind AS source_kind
         FROM learning_log l
         LEFT JOIN learning_sources s ON s.id = l.source_id
         WHERE ${where}
         ORDER BY consumed_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ items: rows, count: rows.length });
  } catch (err) {
    console.error('learning list error:', err);
    res.status(500).json({ error: 'Failed to list learning items' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*, s.name AS source_name FROM learning_log l
         LEFT JOIN learning_sources s ON s.id = l.source_id
         WHERE l.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ item: rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to load item' }); }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body;
    if (!b.kind || !VALID_KINDS.includes(b.kind)) {
      return res.status(400).json({ error: 'kind must be one of ' + VALID_KINDS.join(', ') });
    }
    const { rows } = await pool.query(
      `INSERT INTO learning_log
        (source_id, kind, title, author, external_id, url, consumed_at,
         duration_seconds, raw_notes, tags)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, NOW()), $8, $9, COALESCE($10,'[]')::jsonb)
       RETURNING *`,
      [b.source_id || null, b.kind, b.title || null, b.author || null,
       b.external_id || null, b.url || null, b.consumed_at || null,
       b.duration_seconds || null, b.raw_notes || null,
       b.tags ? JSON.stringify(b.tags) : null]
    );
    publish({ type: 'learning', event: 'created', id: rows[0].id });
    res.status(201).json({ item: rows[0] });
  } catch (err) {
    console.error('learning create error:', err);
    res.status(500).json({ error: 'Failed to log learning item' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['source_id','kind','title','author','external_id','url','consumed_at','duration_seconds','raw_notes','summary','key_concepts','action_items','suggested_vocabulary','suggested_memory','tags'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) {
        sets.push(`${f} = $${idx++}`);
        const v = req.body[f];
        if (['key_concepts','action_items','suggested_vocabulary','suggested_memory','tags'].includes(f)) {
          params.push(JSON.stringify(v));
        } else {
          params.push(v);
        }
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE learning_log SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ item: rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to update item' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM learning_log WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) { res.status(500).json({ error: 'Failed to delete' }); }
});

// POST /api/learning/voice-capture — quick voice memo, optionally tagged to
// the most recent learning item (e.g. while a podcast is playing).
router.post('/voice-capture', async (req, res) => {
  try {
    const { transcript, attach_to_recent } = req.body;
    if (!transcript) return res.status(400).json({ error: 'transcript required' });

    if (attach_to_recent) {
      // Find the most recent listening item from the last 4 hours and append
      const recent = await pool.query(
        `SELECT id, raw_notes FROM learning_log
         WHERE kind IN ('spotify_episode','audible_chapter','youtube_video')
           AND consumed_at >= NOW() - INTERVAL '4 hours'
         ORDER BY consumed_at DESC LIMIT 1`
      );
      if (recent.rows.length) {
        const id = recent.rows[0].id;
        const merged = (recent.rows[0].raw_notes || '') + '\n\n[voice memo @ ' + new Date().toLocaleTimeString('en-CA') + ']\n' + transcript;
        const { rows } = await pool.query(
          `UPDATE learning_log SET raw_notes = $1, updated_at = NOW(),
             analyzed_at = NULL  -- mark for re-analysis
           WHERE id = $2 RETURNING *`,
          [merged, id]
        );
        return res.json({ item: rows[0], attached: true });
      }
    }

    // Otherwise create a standalone voice_memo entry
    const { rows } = await pool.query(
      `INSERT INTO learning_log (kind, title, raw_notes, consumed_at)
       VALUES ('voice_memo', $1, $2, NOW()) RETURNING *`,
      [transcript.split('.').slice(0, 1).join('').slice(0, 100), transcript]
    );
    res.status(201).json({ item: rows[0], attached: false });
  } catch (err) {
    console.error('voice-capture error:', err);
    res.status(500).json({ error: 'Failed to capture voice memo' });
  }
});

// ---------- Claude extraction ----------

const EXTRACT_PROMPT = `You are processing a piece of content Jonathan Wallace consumed
(podcast episode, audiobook chapter, video, article, or voice memo).
Pull out everything that is durable + actionable for his real estate
business and personal performance.

Return JSON ONLY with this exact schema:
{
  "summary": "<2-4 sentence neutral summary of what was discussed>",
  "key_concepts": ["<concept 1>", "<concept 2>", "..."],
  "action_items": [
    { "title": "<concrete action Jonathan should take>",
      "category": "lead_gen|marketing|operations|mindset|client_service|skill_building|personal",
      "due_in_days": 1,
      "notes": "<context: why this, where it came from in the source>"
    }
  ],
  "suggested_vocabulary": [
    { "term": "<term/jargon worth Claude knowing>", "expansion": "<plain-English definition>", "category": "real_estate|tools|finance|operations", "weight": 1-10 }
  ],
  "suggested_memory": [
    { "key": "<short slug>", "value": "<durable fact / preference Jonathan should follow going forward>", "category": "preference|voice|operations|tactic", "importance": 1-10 }
  ]
}

Rules:
- Action items must be specific. "Follow up with leads" is bad. "Send a 'who do
  you know' text to the 5 newest FUB contacts by Friday" is good.
- Cap each list at 5 items. Skip categories where nothing is genuinely useful.
- Don't invent — only extract what the content actually said.
- Vocabulary suggestions are ONLY for terms Jonathan would use professionally.
- Memory suggestions are durable: tactics he wants to keep using, voice rules,
  preferences. Not single-use observations.
- due_in_days defaults to 7 if unclear; 1 for urgent prompts; 30 for habit
  building.`;

router.post('/:id/analyze', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Claude not configured' });
    const { rows } = await pool.query(
      `SELECT l.*, s.name AS source_name FROM learning_log l
         LEFT JOIN learning_sources s ON s.id = l.source_id
         WHERE l.id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const item = rows[0];
    if (!item.raw_notes || item.raw_notes.trim().length < 30) {
      return res.status(400).json({ error: 'No raw_notes to analyze (need at least 30 chars)' });
    }

    const ctx = await intuition.buildContextBlock();
    const userMsg = `Source: ${item.source_name || item.author || '(unknown)'}\nKind: ${item.kind}\nTitle: ${item.title || '(no title)'}\n\nContent:\n${item.raw_notes}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: ctx ? `${EXTRACT_PROMPT}\n\n${ctx}` : EXTRACT_PROMPT,
      messages: [{ role: 'user', content: userMsg }]
    });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    let parsed;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : text);
    } catch (e) {
      return res.status(500).json({ error: 'Could not parse extraction', raw: text });
    }

    await pool.query(
      `UPDATE learning_log SET
         summary = $1,
         key_concepts = $2::jsonb,
         action_items = $3::jsonb,
         suggested_vocabulary = $4::jsonb,
         suggested_memory = $5::jsonb,
         analyzed_at = NOW(),
         updated_at = NOW()
       WHERE id = $6`,
      [parsed.summary || null,
       JSON.stringify(parsed.key_concepts || []),
       JSON.stringify(parsed.action_items || []),
       JSON.stringify(parsed.suggested_vocabulary || []),
       JSON.stringify(parsed.suggested_memory || []),
       item.id]
    );

    res.json({ extraction: parsed, tokens: response.usage });
  } catch (err) {
    console.error('learning analyze error:', err);
    res.status(500).json({ error: 'Failed to analyze', message: err.message });
  }
});

// POST /api/learning/:id/apply
// Body: { action_item_indexes?: [0,2], vocabulary_indexes?: [0], memory_indexes?: [1] }
// Promotes selected items into personal_tasks / agent_vocabulary / agent_memory.
router.post('/:id/apply', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM learning_log WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const item = rows[0];

    const aIdx = req.body.action_item_indexes;
    const vIdx = req.body.vocabulary_indexes;
    const mIdx = req.body.memory_indexes;

    const actionItems = item.action_items || [];
    const vocab       = item.suggested_vocabulary || [];
    const memory      = item.suggested_memory || [];

    const created = { tasks: [], vocab: [], memory: [] };

    const wantedActions = Array.isArray(aIdx) ? aIdx : actionItems.map((_, i) => i);
    for (const i of wantedActions) {
      const a = actionItems[i];
      if (!a || !a.title) continue;
      const due = a.due_in_days != null
        ? new Date(Date.now() + Number(a.due_in_days) * 86400000).toISOString().slice(0, 10)
        : null;
      const r = await pool.query(
        `INSERT INTO personal_tasks (title, notes, category, priority, due_date, source, external_id)
         VALUES ($1, $2, $3, 4, $4, 'learning', $5)
         RETURNING id, title`,
        [a.title, a.notes ? `${a.notes} (from ${item.title || 'learning'})` : null,
         a.category || 'learning', due, 'learning_log:' + item.id + ':' + i]
      );
      created.tasks.push(r.rows[0]);
    }

    const wantedVocab = Array.isArray(vIdx) ? vIdx : vocab.map((_, i) => i);
    for (const i of wantedVocab) {
      const v = vocab[i];
      if (!v || !v.term || !v.expansion) continue;
      const r = await pool.query(
        `INSERT INTO agent_vocabulary (term, expansion, category, weight)
         VALUES ($1,$2,COALESCE($3,'real_estate'),COALESCE($4,5))
         ON CONFLICT (term) DO NOTHING RETURNING id, term`,
        [v.term, v.expansion, v.category, v.weight]
      );
      if (r.rows.length) created.vocab.push(r.rows[0]);
    }

    const wantedMem = Array.isArray(mIdx) ? mIdx : memory.map((_, i) => i);
    for (const i of wantedMem) {
      const m = memory[i];
      if (!m || !m.key || !m.value) continue;
      const r = await pool.query(
        `INSERT INTO agent_memory (key, value, category, importance, source)
         VALUES ($1,$2,COALESCE($3,'tactic'),COALESCE($4,5),'learning')
         ON CONFLICT (key) DO NOTHING RETURNING id, key`,
        [m.key, m.value, m.category, m.importance]
      );
      if (r.rows.length) created.memory.push(r.rows[0]);
    }

    if (created.tasks.length) {
      const ids = created.tasks.map(t => t.id);
      await pool.query(
        `UPDATE learning_log SET applied_action_item_ids =
           COALESCE(applied_action_item_ids,'[]'::jsonb) || $1::jsonb,
           updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(ids), item.id]
      );
    }
    if (created.vocab.length || created.memory.length) intuition.invalidate();

    res.json({ created });
  } catch (err) {
    console.error('learning apply error:', err);
    res.status(500).json({ error: 'Failed to apply', message: err.message });
  }
});

module.exports = router;
