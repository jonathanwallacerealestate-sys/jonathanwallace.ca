const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

// GET /api/marketing — list marketing items (?status, ?platform, ?upcoming)
router.get('/', async (req, res) => {
  try {
    const { status, platform, upcoming } = req.query;
    const where = [];
    const params = [];
    let idx = 1;
    if (status && status !== 'all') { where.push(`status = $${idx++}`); params.push(status); }
    if (platform) { where.push(`platform = $${idx++}`); params.push(platform); }
    if (upcoming === 'true') where.push(`scheduled_for >= NOW()`);

    const sql = `SELECT m.*, l.address AS listing_address
       FROM marketing_items m
       LEFT JOIN listings l ON l.id = m.listing_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY COALESCE(scheduled_for, '9999-12-31'::timestamptz) ASC, m.created_at DESC
       LIMIT 200`;
    const { rows } = await pool.query(sql, params);
    res.json({ items: rows, count: rows.length });
  } catch (err) {
    console.error('marketing list error:', err);
    res.status(500).json({ error: 'Failed to list marketing items' });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body;
    if (!b.title) return res.status(400).json({ error: 'title required' });
    const { rows } = await pool.query(
      `INSERT INTO marketing_items (title, platform, campaign_type, content, media_urls,
         scheduled_for, status, listing_id, metrics, external_id)
       VALUES ($1,$2,$3,$4, COALESCE($5,'[]')::jsonb, $6, COALESCE($7,'draft'), $8,
               COALESCE($9,'{}')::jsonb, $10)
       RETURNING *`,
      [b.title, b.platform || null, b.campaign_type || null, b.content || null,
       b.media_urls ? JSON.stringify(b.media_urls) : null,
       b.scheduled_for || null, b.status, b.listing_id || null,
       b.metrics ? JSON.stringify(b.metrics) : null, b.external_id || null]
    );
    res.status(201).json({ item: rows[0] });
  } catch (err) {
    console.error('marketing create error:', err);
    res.status(500).json({ error: 'Failed to create marketing item' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['title','platform','campaign_type','content','media_urls','scheduled_for',
      'status','listing_id','metrics','external_id'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) {
        sets.push(`${f} = $${idx++}`);
        const v = req.body[f];
        if (f === 'media_urls' || f === 'metrics') params.push(JSON.stringify(v));
        else params.push(v);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE marketing_items SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ item: rows[0] });
  } catch (err) {
    console.error('marketing update error:', err);
    res.status(500).json({ error: 'Failed to update marketing item' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM marketing_items WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;
