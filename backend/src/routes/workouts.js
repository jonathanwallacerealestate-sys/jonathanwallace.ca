const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

// GET /api/workouts — list workouts (optional ?date=today or date range)
router.get('/', async (req, res) => {
  try {
    const { date, from, to } = req.query;
    let sql = 'SELECT * FROM workouts';
    const params = [];
    const where = [];
    let idx = 1;
    if (date === 'today') where.push('workout_date = CURRENT_DATE');
    else if (date === 'week') where.push("workout_date >= CURRENT_DATE - INTERVAL '7 days'");
    else if (date) { where.push(`workout_date = $${idx++}`); params.push(date); }
    if (from) { where.push(`workout_date >= $${idx++}`); params.push(from); }
    if (to) { where.push(`workout_date <= $${idx++}`); params.push(to); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY workout_date DESC, created_at DESC LIMIT 100';
    const { rows } = await pool.query(sql, params);
    res.json({ workouts: rows, count: rows.length });
  } catch (err) {
    console.error('workouts list error:', err);
    res.status(500).json({ error: 'Failed to list workouts' });
  }
});

// POST /api/workouts — add a workout or plan
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    if (!b.workout_date) return res.status(400).json({ error: 'workout_date required' });
    const { rows } = await pool.query(
      `INSERT INTO workouts (workout_date, workout_type, title, exercises, duration_minutes,
        intensity, calories_burned, notes, completed)
       VALUES ($1,$2,$3, COALESCE($4,'[]')::jsonb, $5, $6, $7, $8, COALESCE($9,false))
       RETURNING *`,
      [b.workout_date, b.workout_type || null, b.title || null,
       b.exercises ? JSON.stringify(b.exercises) : null, b.duration_minutes || null,
       b.intensity || null, b.calories_burned || null, b.notes || null, b.completed]
    );
    res.status(201).json({ workout: rows[0] });
  } catch (err) {
    console.error('workouts create error:', err);
    res.status(500).json({ error: 'Failed to create workout' });
  }
});

// PATCH /api/workouts/:id
router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['workout_type','title','exercises','duration_minutes','intensity',
      'calories_burned','notes','completed','workout_date'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) {
        sets.push(`${f} = $${idx++}`);
        params.push(f === 'exercises' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE workouts SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ workout: rows[0] });
  } catch (err) {
    console.error('workouts update error:', err);
    res.status(500).json({ error: 'Failed to update workout' });
  }
});

// DELETE /api/workouts/:id
router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM workouts WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;
