const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

function computeDerived(body) {
  const sale = Number(body.sale_price) || 0;
  const rate = Number(body.commission_rate) || 0;
  const gross = body.gross_commission != null
    ? Number(body.gross_commission)
    : +(sale * rate / 100).toFixed(2);
  const split = Number(body.brokerage_split) || 0;
  const referral = Number(body.referral_fees) || 0;
  const mkt = Number(body.marketing_expense) || 0;
  const other = Number(body.other_expenses) || 0;
  const net = body.net_profit != null
    ? Number(body.net_profit)
    : +(gross - split - referral - mkt - other).toFixed(2);
  return { gross_commission: gross, net_profit: net };
}

// GET /api/closings — list + rollup P&L
router.get('/', async (req, res) => {
  try {
    const { status, year } = req.query;
    const where = [];
    const params = [];
    let idx = 1;
    if (status && status !== 'all') { where.push(`status = $${idx++}`); params.push(status); }
    if (year) { where.push(`EXTRACT(YEAR FROM closing_date) = $${idx++}`); params.push(parseInt(year)); }

    const sql = `SELECT * FROM closings
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(closing_date, '9999-12-31') ASC, created_at DESC`;
    const { rows } = await pool.query(sql, params);

    const totals = rows.reduce((a, c) => {
      a.sale_volume += Number(c.sale_price) || 0;
      a.gross_commission += Number(c.gross_commission) || 0;
      a.net_profit += Number(c.net_profit) || 0;
      a.marketing_expense += Number(c.marketing_expense) || 0;
      return a;
    }, { sale_volume: 0, gross_commission: 0, net_profit: 0, marketing_expense: 0 });

    const byStatus = rows.reduce((a, c) => {
      a[c.status] = (a[c.status] || 0) + 1;
      return a;
    }, {});

    res.json({ closings: rows, count: rows.length, totals, byStatus });
  } catch (err) {
    console.error('closings list error:', err);
    res.status(500).json({ error: 'Failed to list closings' });
  }
});

// POST /api/closings — create
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    if (!b.property_address) return res.status(400).json({ error: 'property_address required' });
    const d = computeDerived(b);
    const { rows } = await pool.query(
      `INSERT INTO closings
        (property_address, city, client_name, client_type, transaction_side,
         sale_price, commission_rate, gross_commission, brokerage_split,
         referral_fees, marketing_expense, other_expenses, net_profit,
         offer_date, firm_date, closing_date, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,COALESCE($17,'pending'),$18)
       RETURNING *`,
      [b.property_address, b.city || null, b.client_name || null, b.client_type || null,
       b.transaction_side || null, b.sale_price || null, b.commission_rate || null,
       d.gross_commission, b.brokerage_split || null, b.referral_fees || 0,
       b.marketing_expense || 0, b.other_expenses || 0, d.net_profit,
       b.offer_date || null, b.firm_date || null, b.closing_date || null,
       b.status, b.notes || null]
    );
    res.status(201).json({ closing: rows[0] });
  } catch (err) {
    console.error('closings create error:', err);
    res.status(500).json({ error: 'Failed to create closing' });
  }
});

// PATCH /api/closings/:id
router.patch('/:id', async (req, res) => {
  try {
    const b = req.body;
    const allowed = ['property_address','city','client_name','client_type','transaction_side',
      'sale_price','commission_rate','gross_commission','brokerage_split','referral_fees',
      'marketing_expense','other_expenses','net_profit','offer_date','firm_date',
      'closing_date','status','notes'];
    // pull existing record so we can recompute gross/net if pieces changed
    const existing = await pool.query('SELECT * FROM closings WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Not found' });
    const merged = { ...existing.rows[0], ...b };
    const d = computeDerived(merged);
    merged.gross_commission = d.gross_commission;
    merged.net_profit = d.net_profit;

    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in b || f === 'gross_commission' || f === 'net_profit') {
        sets.push(`${f} = $${idx++}`);
        params.push(merged[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE closings SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    res.json({ closing: rows[0] });
  } catch (err) {
    console.error('closings update error:', err);
    res.status(500).json({ error: 'Failed to update closing' });
  }
});

// DELETE /api/closings/:id
router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM closings WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// GET /api/closings/pnl — year-to-date and monthly P&L
router.get('/pnl', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const { rows: monthly } = await pool.query(
      `SELECT TO_CHAR(DATE_TRUNC('month', closing_date), 'YYYY-MM') AS month,
              COUNT(*) AS deals,
              COALESCE(SUM(sale_price),0) AS sale_volume,
              COALESCE(SUM(gross_commission),0) AS gross_commission,
              COALESCE(SUM(net_profit),0) AS net_profit
         FROM closings
        WHERE EXTRACT(YEAR FROM closing_date) = $1
          AND status IN ('closed','firm','pending')
        GROUP BY DATE_TRUNC('month', closing_date)
        ORDER BY 1`,
      [year]
    );
    const { rows: ytd } = await pool.query(
      `SELECT COUNT(*) AS deals,
              COALESCE(SUM(sale_price),0) AS sale_volume,
              COALESCE(SUM(gross_commission),0) AS gross_commission,
              COALESCE(SUM(net_profit),0) AS net_profit
         FROM closings
        WHERE EXTRACT(YEAR FROM closing_date) = $1
          AND status IN ('closed','firm','pending')`,
      [year]
    );
    res.json({ year, ytd: ytd[0], monthly });
  } catch (err) {
    console.error('closings pnl error:', err);
    res.status(500).json({ error: 'Failed to compute P&L' });
  }
});

module.exports = router;
