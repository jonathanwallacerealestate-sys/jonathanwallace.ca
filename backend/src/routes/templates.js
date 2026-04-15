/**
 * Nurture templates — reusable outreach messages Jonathan can apply to
 * individual contacts or whole FUB smart lists.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM nurture_templates
       ORDER BY use_count DESC, name ASC`
    );
    res.json({ templates: rows });
  } catch (e) {
    console.error('templates list error:', e);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, purpose, channel, subject, body, tags } = req.body || {};
    if (!name || !body) return res.status(400).json({ error: 'name and body required' });
    const { rows } = await pool.query(
      `INSERT INTO nurture_templates (name, purpose, channel, subject, body, tags)
       VALUES ($1, $2, COALESCE($3, 'note'), $4, $5, COALESCE($6, '[]'::jsonb))
       RETURNING *`,
      [name, purpose || null, channel || null, subject || null, body,
       tags ? JSON.stringify(tags) : null]
    );
    res.status(201).json({ template: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Template name already exists' });
    console.error('templates create error:', e);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['name','purpose','channel','subject','body','tags'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in (req.body || {})) {
        sets.push(`${f} = $${idx++}`);
        params.push(f === 'tags' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE nurture_templates SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ template: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Template name already exists' });
    res.status(500).json({ error: 'Failed to update template' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM nurture_templates WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// POST /api/templates/:id/touch — bump use_count and last_used_at
router.post('/:id/touch', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE nurture_templates
       SET use_count = use_count + 1, last_used_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ template: rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to touch template' });
  }
});

module.exports = router;
