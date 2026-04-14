const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

// GET /api/emails — list flagged emails (default: needs_reply)
router.get('/', async (req, res) => {
  try {
    const { status = 'needs_reply', limit = 50 } = req.query;
    const { rows } = await pool.query(
      `SELECT * FROM flagged_emails
       WHERE ($1 = 'all' OR status = $1)
       ORDER BY
         CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         received_at DESC NULLS LAST
       LIMIT $2`,
      [status, Math.min(parseInt(limit) || 50, 200)]
    );
    res.json({ emails: rows, count: rows.length });
  } catch (err) {
    console.error('flagged_emails list error:', err);
    res.status(500).json({ error: 'Failed to list emails' });
  }
});

// POST /api/emails — create or upsert a flagged email (called by Make.com when an important email arrives)
router.post('/', async (req, res) => {
  try {
    const {
      gmail_message_id, thread_id, from_address, from_name,
      subject, snippet, received_at, priority, status, labels, tag
    } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO flagged_emails
        (gmail_message_id, thread_id, from_address, from_name, subject, snippet, received_at, priority, status, labels, tag)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8,'normal'), COALESCE($9,'needs_reply'), COALESCE($10,'[]')::jsonb, $11)
       ON CONFLICT (gmail_message_id) DO UPDATE SET
         subject = EXCLUDED.subject,
         snippet = EXCLUDED.snippet,
         priority = EXCLUDED.priority,
         status = EXCLUDED.status,
         labels = EXCLUDED.labels,
         tag = EXCLUDED.tag
       RETURNING *`,
      [gmail_message_id || null, thread_id || null, from_address || null, from_name || null,
       subject || null, snippet || null, received_at || null, priority, status,
       labels ? JSON.stringify(labels) : null, tag || null]
    );
    res.status(201).json({ email: rows[0] });
  } catch (err) {
    console.error('flagged_emails create error:', err);
    res.status(500).json({ error: 'Failed to flag email' });
  }
});

// PATCH /api/emails/:id — mark as handled, snooze, re-prioritize
router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['priority','status','tag','assigned_to'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) { sets.push(`${f} = $${idx++}`); params.push(req.body[f]); }
    }
    if (req.body.status === 'handled') sets.push(`handled_at = NOW()`);
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE flagged_emails SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ email: rows[0] });
  } catch (err) {
    console.error('flagged_emails update error:', err);
    res.status(500).json({ error: 'Failed to update email' });
  }
});

// DELETE /api/emails/:id
router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM flagged_emails WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;
