const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const Anthropic = require('@anthropic-ai/sdk');
const { requireApiKey } = require('../middleware/apiKey');
const intuition = require('../services/intuition');

const anthropic = new Anthropic();

router.use(requireApiKey);

// ------- Vocabulary -------
router.get('/vocabulary', async (req, res) => {
  try {
    const { category } = req.query;
    const where = ['enabled = TRUE'];
    const params = [];
    if (category) { params.push(category); where.push(`category = $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT * FROM agent_vocabulary
       WHERE ${where.join(' AND ')}
       ORDER BY weight DESC, term ASC`,
      params
    );
    res.json({ vocabulary: rows, count: rows.length });
  } catch (err) {
    console.error('vocabulary list error:', err);
    res.status(500).json({ error: 'Failed to list vocabulary' });
  }
});

router.post('/vocabulary', async (req, res) => {
  try {
    const { term, expansion, category, weight } = req.body;
    if (!term || !expansion) return res.status(400).json({ error: 'term and expansion required' });
    const { rows } = await pool.query(
      `INSERT INTO agent_vocabulary (term, expansion, category, weight)
       VALUES ($1, $2, COALESCE($3,'real_estate'), COALESCE($4,5))
       ON CONFLICT (term) DO UPDATE
         SET expansion = EXCLUDED.expansion,
             category = EXCLUDED.category,
             weight = EXCLUDED.weight,
             updated_at = NOW()
       RETURNING *`,
      [term, expansion, category || null, weight || null]
    );
    intuition.invalidate();
    res.json({ term: rows[0] });
  } catch (err) {
    console.error('vocabulary upsert error:', err);
    res.status(500).json({ error: 'Failed to save term' });
  }
});

router.patch('/vocabulary/:id', async (req, res) => {
  try {
    const allowed = ['term','expansion','category','weight','enabled'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) { sets.push(`${f} = $${idx++}`); params.push(req.body[f]); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE agent_vocabulary SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    intuition.invalidate();
    res.json({ term: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update term' });
  }
});

router.delete('/vocabulary/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM agent_vocabulary WHERE id = $1', [req.params.id]);
    intuition.invalidate();
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete term' });
  }
});

// ------- Memory -------
router.get('/memory', async (req, res) => {
  try {
    const { category } = req.query;
    const where = [];
    const params = [];
    if (category) { params.push(category); where.push(`category = $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT * FROM agent_memory
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY importance DESC, updated_at DESC`,
      params
    );
    res.json({ memory: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list memory' });
  }
});

router.post('/memory', async (req, res) => {
  try {
    const { key, value, category, importance, source } = req.body;
    if (!key || !value) return res.status(400).json({ error: 'key and value required' });
    const { rows } = await pool.query(
      `INSERT INTO agent_memory (key, value, category, importance, source)
       VALUES ($1, $2, COALESCE($3,'preference'), COALESCE($4,5), COALESCE($5,'manual'))
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             category = EXCLUDED.category,
             importance = EXCLUDED.importance,
             source = EXCLUDED.source,
             updated_at = NOW()
       RETURNING *`,
      [key, value, category || null, importance || null, source || null]
    );
    intuition.invalidate();
    res.json({ memory: rows[0] });
  } catch (err) {
    console.error('memory upsert error:', err);
    res.status(500).json({ error: 'Failed to save memory' });
  }
});

router.patch('/memory/:id', async (req, res) => {
  try {
    const allowed = ['key','value','category','importance'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) { sets.push(`${f} = $${idx++}`); params.push(req.body[f]); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE agent_memory SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    intuition.invalidate();
    res.json({ memory: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update memory' });
  }
});

router.delete('/memory/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM agent_memory WHERE id = $1', [req.params.id]);
    intuition.invalidate();
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

/**
 * POST /api/intuition/learn-from-task/:id
 * Reads a finished agent task (instruction + result) and asks Claude to
 * propose 0-3 vocabulary or memory entries that would help future tasks.
 * If body.apply === true, the suggestions are saved immediately.
 * Otherwise we just return them so the dashboard can show them for review.
 */
router.post('/learn-from-task/:id', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Claude not configured' });
    }
    const { rows } = await pool.query(
      'SELECT id, type, instruction, result FROM tasks WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    const t = rows[0];

    const ctx = await intuition.buildContextBlock();
    const sys = `You are auditing a finished interaction with Jonathan Wallace's agent.
Your job is to extract durable knowledge that should be remembered for future tasks.

Return JSON ONLY (no commentary). Schema:
{
  "vocabulary": [{ "term": "...", "expansion": "...", "category": "real_estate|tools|geography|brand|operations|finance", "weight": 1-10 }],
  "memory":     [{ "key": "...", "value": "...", "category": "preference|voice|operations|client|brand|tools", "importance": 1-10 }]
}

Rules:
- Only include items that are clearly NEW and useful for future requests.
- Do NOT propose entries that look already-known given the existing context.
- 0 items in either list is fine. Cap each list at 3 items.
- Phrase memory values as durable facts ("Jonathan prefers..." / "Jonathan's X is..."), not single-use observations.${ctx ? '\n\n' + ctx : ''}`;

    const userMsg = `Instruction:\n${t.instruction}\n\nResult:\n${(t.result && t.result.content) ? t.result.content : '(no result)'}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: sys,
      messages: [{ role: 'user', content: userMsg }]
    });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    let suggestions = { vocabulary: [], memory: [] };
    try {
      const m = text.match(/\{[\s\S]*\}/);
      suggestions = JSON.parse(m ? m[0] : text);
    } catch (e) {
      return res.status(500).json({ error: 'Could not parse suggestions', raw: text });
    }

    const applied = { vocabulary: [], memory: [] };
    if (req.body && req.body.apply === true) {
      for (const v of (suggestions.vocabulary || [])) {
        if (!v.term || !v.expansion) continue;
        const r = await pool.query(
          `INSERT INTO agent_vocabulary (term, expansion, category, weight)
           VALUES ($1,$2,COALESCE($3,'real_estate'),COALESCE($4,5))
           ON CONFLICT (term) DO NOTHING RETURNING id, term`,
          [v.term, v.expansion, v.category || null, v.weight || null]
        );
        if (r.rows.length) applied.vocabulary.push(r.rows[0]);
      }
      for (const m of (suggestions.memory || [])) {
        if (!m.key || !m.value) continue;
        const r = await pool.query(
          `INSERT INTO agent_memory (key, value, category, importance, source)
           VALUES ($1,$2,COALESCE($3,'preference'),COALESCE($4,5),'auto_learn')
           ON CONFLICT (key) DO NOTHING RETURNING id, key`,
          [m.key, m.value, m.category || null, m.importance || null]
        );
        if (r.rows.length) applied.memory.push(r.rows[0]);
      }
      if (applied.vocabulary.length || applied.memory.length) intuition.invalidate();
    }

    res.json({ suggestions, applied, tokens: response.usage });
  } catch (err) {
    console.error('learn-from-task error:', err);
    res.status(500).json({ error: 'Failed to learn from task', message: err.message });
  }
});

module.exports = router;
