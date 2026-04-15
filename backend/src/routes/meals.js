const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

// GET /api/meals — list meals (default today)
router.get('/', async (req, res) => {
  try {
    const { date, range } = req.query;
    let sql = 'SELECT * FROM meal_plan';
    const params = [];
    const where = [];
    let idx = 1;
    if (date === 'today' || !date) where.push('meal_date = CURRENT_DATE');
    else if (date === 'week') where.push("meal_date >= CURRENT_DATE AND meal_date < CURRENT_DATE + INTERVAL '7 days'");
    else { where.push(`meal_date = $${idx++}`); params.push(date); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ` ORDER BY meal_date ASC,
             CASE meal_type
               WHEN 'breakfast' THEN 1
               WHEN 'snack_morning' THEN 2
               WHEN 'lunch' THEN 3
               WHEN 'snack_afternoon' THEN 4
               WHEN 'dinner' THEN 5
               WHEN 'snack_evening' THEN 6
               ELSE 99 END`;
    const { rows } = await pool.query(sql, params);
    // Nutrition rollup by date
    const totals = rows.reduce((a, m) => {
      a.calories += Number(m.calories) || 0;
      a.protein_g += Number(m.protein_g) || 0;
      a.carbs_g += Number(m.carbs_g) || 0;
      a.fat_g += Number(m.fat_g) || 0;
      return a;
    }, { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
    res.json({ meals: rows, count: rows.length, totals });
  } catch (err) {
    console.error('meals list error:', err);
    res.status(500).json({ error: 'Failed to list meals' });
  }
});

// POST /api/meals
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    if (!b.meal_date || !b.meal_type) {
      return res.status(400).json({ error: 'meal_date and meal_type required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO meal_plan (meal_date, meal_type, name, ingredients,
         calories, protein_g, carbs_g, fat_g, prep_notes, prepped)
       VALUES ($1,$2,$3, COALESCE($4,'[]')::jsonb, $5,$6,$7,$8,$9, COALESCE($10,false))
       RETURNING *`,
      [b.meal_date, b.meal_type, b.name || null,
       b.ingredients ? JSON.stringify(b.ingredients) : null,
       b.calories || null, b.protein_g || null, b.carbs_g || null, b.fat_g || null,
       b.prep_notes || null, b.prepped]
    );
    res.status(201).json({ meal: rows[0] });
  } catch (err) {
    console.error('meals create error:', err);
    res.status(500).json({ error: 'Failed to create meal' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['meal_date','meal_type','name','ingredients','calories','protein_g',
      'carbs_g','fat_g','prep_notes','prepped'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) {
        sets.push(`${f} = $${idx++}`);
        params.push(f === 'ingredients' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE meal_plan SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ meal: rows[0] });
  } catch (err) {
    console.error('meals update error:', err);
    res.status(500).json({ error: 'Failed to update meal' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM meal_plan WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;
