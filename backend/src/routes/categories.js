const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 100);
}

// GET /api/categories — list all dashboard categories (builtin + custom)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM dashboard_categories
       WHERE ($1::boolean IS NULL OR enabled = $1::boolean)
       ORDER BY sort_order ASC, name ASC`,
      [req.query.enabled === undefined ? null : req.query.enabled === 'true']
    );
    res.json({ categories: rows });
  } catch (err) {
    console.error('categories list error:', err);
    res.status(500).json({ error: 'Failed to list categories' });
  }
});

// POST /api/categories — add a new custom category
router.post('/', async (req, res) => {
  try {
    const { name, icon, color, sort_order, config } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const slug = req.body.slug ? slugify(req.body.slug) : slugify(name);
    const { rows } = await pool.query(
      `INSERT INTO dashboard_categories (slug, name, icon, color, sort_order, is_builtin, config)
       VALUES ($1,$2,$3,$4, COALESCE($5,100), FALSE, COALESCE($6,'{}')::jsonb)
       RETURNING *`,
      [slug, name, icon || 'star', color || '#64748b', sort_order || null,
       config ? JSON.stringify(config) : null]
    );
    res.status(201).json({ category: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
    console.error('categories create error:', err);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// PATCH /api/categories/:slug — rename, recolor, reorder, enable/disable
router.patch('/:slug', async (req, res) => {
  try {
    const allowed = ['name','icon','color','sort_order','enabled','config'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) {
        sets.push(`${f} = $${idx++}`);
        params.push(f === 'config' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    params.push(req.params.slug);
    const { rows } = await pool.query(
      `UPDATE dashboard_categories SET ${sets.join(', ')} WHERE slug = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ category: rows[0] });
  } catch (err) {
    console.error('categories update error:', err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// DELETE /api/categories/:slug — disable a custom category (builtin cannot be deleted)
router.delete('/:slug', async (req, res) => {
  try {
    const { rows: existing } = await pool.query(
      'SELECT is_builtin FROM dashboard_categories WHERE slug = $1',
      [req.params.slug]
    );
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    if (existing[0].is_builtin) {
      return res.status(400).json({ error: 'Cannot delete built-in category; disable it instead via PATCH enabled=false' });
    }
    await pool.query('DELETE FROM dashboard_categories WHERE slug = $1', [req.params.slug]);
    res.json({ success: true });
  } catch (err) {
    console.error('categories delete error:', err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ------ Items attached to a category (for custom sections) ------

// GET /api/categories/:slug/items
router.get('/:slug/items', async (req, res) => {
  try {
    const { status } = req.query;
    const where = ['category_slug = $1'];
    const params = [req.params.slug];
    if (status && status !== 'all') { params.push(status); where.push(`status = $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT * FROM custom_items WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(due_date,'9999-12-31') ASC, created_at DESC`,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('category items list error:', err);
    res.status(500).json({ error: 'Failed to list items' });
  }
});

// POST /api/categories/:slug/items
router.post('/:slug/items', async (req, res) => {
  try {
    const { title, details, data, status, due_date } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    // verify the category exists
    const cat = await pool.query('SELECT slug FROM dashboard_categories WHERE slug = $1', [req.params.slug]);
    if (!cat.rows.length) return res.status(404).json({ error: 'Category not found' });
    const { rows } = await pool.query(
      `INSERT INTO custom_items (category_slug, title, details, data, status, due_date)
       VALUES ($1,$2,$3, COALESCE($4,'{}')::jsonb, COALESCE($5,'open'), $6)
       RETURNING *`,
      [req.params.slug, title, details || null, data ? JSON.stringify(data) : null, status, due_date || null]
    );
    res.status(201).json({ item: rows[0] });
  } catch (err) {
    console.error('category item create error:', err);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

// PATCH /api/categories/:slug/items/:id
router.patch('/:slug/items/:id', async (req, res) => {
  try {
    const allowed = ['title','details','data','status','due_date'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) {
        sets.push(`${f} = $${idx++}`);
        params.push(f === 'data' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (req.body.status === 'done') sets.push('completed_at = NOW()');
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    params.push(req.params.slug);
    const { rows } = await pool.query(
      `UPDATE custom_items SET ${sets.join(', ')}
       WHERE id = $${idx} AND category_slug = $${idx+1} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ item: rows[0] });
  } catch (err) {
    console.error('category item update error:', err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

router.delete('/:slug/items/:id', async (req, res) => {
  try {
    const r = await pool.query(
      'DELETE FROM custom_items WHERE id = $1 AND category_slug = $2',
      [req.params.id, req.params.slug]
    );
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;
