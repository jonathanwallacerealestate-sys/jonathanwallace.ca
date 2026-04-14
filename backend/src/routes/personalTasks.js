const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

// GET /api/personal-tasks — list (optional ?status, ?category, ?due=today|week|overdue)
router.get('/', async (req, res) => {
  try {
    const { status, category, due } = req.query;
    const where = [];
    const params = [];
    let idx = 1;
    if (status) { where.push(`status = $${idx++}`); params.push(status); }
    if (category) { where.push(`category = $${idx++}`); params.push(category); }
    if (due === 'today') where.push(`due_date = CURRENT_DATE`);
    if (due === 'week') where.push(`due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`);
    if (due === 'overdue') where.push(`due_date < CURRENT_DATE AND status != 'done'`);

    const sql = `SELECT * FROM personal_tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY
      CASE status WHEN 'done' THEN 1 ELSE 0 END,
      COALESCE(due_date, '9999-12-31') ASC,
      priority DESC,
      created_at DESC`;
    const { rows } = await pool.query(sql, params);
    res.json({ tasks: rows, count: rows.length });
  } catch (err) {
    console.error('personal_tasks list error:', err);
    res.status(500).json({ error: 'Failed to list personal tasks' });
  }
});

// POST /api/personal-tasks — create
router.post('/', async (req, res) => {
  try {
    const { title, notes, category, priority, due_date, source, external_id } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const { rows } = await pool.query(
      `INSERT INTO personal_tasks (title, notes, category, priority, due_date, source, external_id)
       VALUES ($1, $2, COALESCE($3,'personal'), COALESCE($4,3), $5, COALESCE($6,'manual'), $7)
       RETURNING *`,
      [title, notes || null, category || null, priority || null, due_date || null, source || null, external_id || null]
    );
    res.status(201).json({ task: rows[0] });
  } catch (err) {
    console.error('personal_tasks create error:', err);
    res.status(500).json({ error: 'Failed to create personal task' });
  }
});

// PATCH /api/personal-tasks/:id
router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['title','notes','category','priority','status','due_date'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) { sets.push(`${f} = $${idx++}`); params.push(req.body[f]); }
    }
    if (req.body.status === 'done') sets.push(`completed_at = NOW()`);
    if (req.body.status && req.body.status !== 'done') sets.push(`completed_at = NULL`);
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });
    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE personal_tasks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ task: rows[0] });
  } catch (err) {
    console.error('personal_tasks update error:', err);
    res.status(500).json({ error: 'Failed to update personal task' });
  }
});

// DELETE /api/personal-tasks/:id
router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM personal_tasks WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;
