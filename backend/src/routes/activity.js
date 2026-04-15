/**
 * Activity tracking — calls, emails, texts, meetings, drop-bys.
 * Drives the daily lead-gen counters and goals.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');
const { publish } = require('../services/events');

router.use(requireApiKey);

const VALID_TYPES = ['call','email','text','meeting','drop_by','social_dm','voicemail'];

// GET /api/activity?date=today|YYYY-MM-DD
router.get('/', async (req, res) => {
  try {
    const { date, range } = req.query;
    let where = 'activity_date = CURRENT_DATE';
    const params = [];
    if (date && date !== 'today') {
      params.push(date);
      where = `activity_date = $${params.length}`;
    }
    if (range === 'week') where = `activity_date >= CURRENT_DATE - INTERVAL '7 days'`;

    const { rows } = await pool.query(
      `SELECT * FROM activity_log WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json({ activities: rows, count: rows.length });
  } catch (err) {
    console.error('activity list error:', err);
    res.status(500).json({ error: 'Failed to list activities' });
  }
});

// GET /api/activity/counts?range=today|week
router.get('/counts', async (req, res) => {
  try {
    const range = req.query.range === 'week' ? 'week' : 'today';
    const interval = range === 'week' ? "CURRENT_DATE - INTERVAL '7 days'" : 'CURRENT_DATE';
    const op = range === 'week' ? '>=' : '=';
    const { rows } = await pool.query(
      `SELECT activity_type,
              COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE outcome = 'connected')::int AS connected
       FROM activity_log
       WHERE activity_date ${op} ${interval}
       GROUP BY activity_type`
    );
    const map = {};
    for (const r of rows) map[r.activity_type] = { count: r.count, connected: r.connected };
    res.json({ range, counts: map, raw: rows });
  } catch (err) {
    console.error('activity counts error:', err);
    res.status(500).json({ error: 'Failed to count activities' });
  }
});

// POST /api/activity — log a single activity
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    if (!b.activity_type || !VALID_TYPES.includes(b.activity_type)) {
      return res.status(400).json({ error: 'activity_type must be one of ' + VALID_TYPES.join(', ') });
    }
    const { rows } = await pool.query(
      `INSERT INTO activity_log
        (activity_type, contact_name, contact_phone, contact_email, crm_followup_id,
         duration_seconds, outcome, notes, source, related_session_id, related_call_id, activity_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9,'manual'), $10, $11, COALESCE($12,CURRENT_DATE))
       RETURNING *`,
      [b.activity_type, b.contact_name || null, b.contact_phone || null, b.contact_email || null,
       b.crm_followup_id || null, b.duration_seconds || null, b.outcome || null, b.notes || null,
       b.source, b.related_session_id || null, b.related_call_id || null, b.activity_date || null]
    );
    publish({ type: 'activity', activity_id: rows[0].id, activity_type: rows[0].activity_type });
    res.status(201).json({ activity: rows[0] });
  } catch (err) {
    console.error('activity create error:', err);
    res.status(500).json({ error: 'Failed to log activity' });
  }
});

// PATCH /api/activity/:id
router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['contact_name','contact_phone','contact_email','duration_seconds','outcome','notes'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) { sets.push(`${f} = $${idx++}`); params.push(req.body[f]); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE activity_log SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ activity: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update activity' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM activity_log WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) { res.status(500).json({ error: 'Failed to delete' }); }
});

// ---------- Goals ----------

router.get('/goals', async (req, res) => {
  try {
    const { rows: goals } = await pool.query(
      `SELECT * FROM lead_gen_goals WHERE enabled = TRUE ORDER BY goal_type`
    );

    // Compute today's actuals across all goal types in one pass
    const today = await pool.query(
      `SELECT activity_type,
              COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE outcome = 'connected')::int AS connected
       FROM activity_log
       WHERE activity_date = CURRENT_DATE
       GROUP BY activity_type`
    );
    const week = await pool.query(
      `SELECT activity_type,
              COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE outcome = 'connected')::int AS connected
       FROM activity_log
       WHERE activity_date >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY activity_type`
    );
    const followUpsToday = await pool.query(
      `SELECT COUNT(*)::int AS c FROM crm_followups
       WHERE status = 'done' AND completed_at::date = CURRENT_DATE`
    );
    const followUpsWeek = await pool.query(
      `SELECT COUNT(*)::int AS c FROM crm_followups
       WHERE status = 'done' AND completed_at >= CURRENT_DATE - INTERVAL '7 days'`
    );

    const todayMap = Object.fromEntries(today.rows.map(r => [r.activity_type, r]));
    const weekMap  = Object.fromEntries(week.rows.map(r => [r.activity_type, r]));

    const progress = goals.map(g => {
      let dActual = 0, wActual = 0;
      if (g.goal_type === 'calls') {
        dActual = todayMap.call?.count || 0;
        wActual = weekMap.call?.count || 0;
      } else if (g.goal_type === 'connected_calls') {
        dActual = todayMap.call?.connected || 0;
        wActual = weekMap.call?.connected || 0;
      } else if (g.goal_type === 'emails') {
        dActual = todayMap.email?.count || 0;
        wActual = weekMap.email?.count || 0;
      } else if (g.goal_type === 'contacts_added') {
        dActual = (todayMap.text?.count || 0) + (todayMap.drop_by?.count || 0) + (todayMap.social_dm?.count || 0) + (todayMap.meeting?.count || 0);
        wActual = (weekMap.text?.count  || 0) + (weekMap.drop_by?.count  || 0) + (weekMap.social_dm?.count  || 0) + (weekMap.meeting?.count  || 0);
      } else if (g.goal_type === 'follow_ups_completed') {
        dActual = followUpsToday.rows[0]?.c || 0;
        wActual = followUpsWeek.rows[0]?.c || 0;
      }
      return {
        ...g,
        daily_actual: dActual,
        weekly_actual: wActual,
        daily_pct: g.daily_target ? Math.min(100, Math.round((dActual / g.daily_target) * 100)) : 0,
        weekly_pct: g.weekly_target ? Math.min(100, Math.round((wActual / g.weekly_target) * 100)) : 0
      };
    });

    res.json({ goals: progress });
  } catch (err) {
    console.error('goals list error:', err);
    res.status(500).json({ error: 'Failed to list goals' });
  }
});

router.post('/goals', async (req, res) => {
  try {
    const { goal_type, daily_target, weekly_target, enabled } = req.body;
    if (!goal_type) return res.status(400).json({ error: 'goal_type required' });
    const { rows } = await pool.query(
      `INSERT INTO lead_gen_goals (goal_type, daily_target, weekly_target, enabled)
       VALUES ($1, COALESCE($2,0), COALESCE($3,0), COALESCE($4,true))
       ON CONFLICT (goal_type) DO UPDATE SET
         daily_target = EXCLUDED.daily_target,
         weekly_target = EXCLUDED.weekly_target,
         enabled = EXCLUDED.enabled,
         updated_at = NOW()
       RETURNING *`,
      [goal_type, daily_target, weekly_target, enabled]
    );
    res.json({ goal: rows[0] });
  } catch (err) {
    console.error('goals upsert error:', err);
    res.status(500).json({ error: 'Failed to save goal' });
  }
});

module.exports = router;
