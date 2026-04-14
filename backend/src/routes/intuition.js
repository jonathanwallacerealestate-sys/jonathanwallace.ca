const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');
const intuition = require('../services/intuition');

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

module.exports = router;
