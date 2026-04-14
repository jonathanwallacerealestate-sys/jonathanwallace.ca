const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

// GET /api/settings — return all settings as a flat object
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value, description, updated_at FROM app_settings ORDER BY key');
    const map = {};
    for (const r of rows) map[r.key] = r;
    res.json({ settings: map, count: rows.length });
  } catch (err) {
    console.error('settings list error:', err);
    res.status(500).json({ error: 'Failed to list settings' });
  }
});

// GET /api/settings/:key
router.get('/:key', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM app_settings WHERE key = $1', [req.params.key]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ setting: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get setting' });
  }
});

// PUT /api/settings/:key — upsert (body: { value, description? })
router.put('/:key', async (req, res) => {
  try {
    const { value, description } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value required' });
    const { rows } = await pool.query(
      `INSERT INTO app_settings (key, value, description, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         description = COALESCE(EXCLUDED.description, app_settings.description),
         updated_at = NOW()
       RETURNING *`,
      [req.params.key, JSON.stringify(value), description || null]
    );
    res.json({ setting: rows[0] });
  } catch (err) {
    console.error('settings update error:', err);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// POST /api/settings/bulk — replace multiple keys at once
// body: { settings: { key1: value1, key2: value2 } }
router.post('/bulk', async (req, res) => {
  try {
    const s = req.body.settings || req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of Object.entries(s)) {
        await client.query(
          `INSERT INTO app_settings (key, value, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [key, JSON.stringify(value)]
        );
      }
      await client.query('COMMIT');
      res.json({ success: true, updated: Object.keys(s).length });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('settings bulk error:', err);
    res.status(500).json({ error: 'Failed to bulk update settings' });
  }
});

// DELETE /api/settings/:key
router.delete('/:key', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM app_settings WHERE key = $1', [req.params.key]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete setting' });
  }
});

module.exports = router;
