const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

// GET /api/follow-ups — list open CRM follow-ups (optionally ?due=today|overdue|week)
router.get('/', async (req, res) => {
  try {
    const { due, status = 'open', limit = 100 } = req.query;
    const where = [];
    const params = [];
    let idx = 1;
    if (status && status !== 'all') { where.push(`status = $${idx++}`); params.push(status); }
    if (due === 'today') where.push(`due_date = CURRENT_DATE`);
    if (due === 'overdue') where.push(`due_date < CURRENT_DATE`);
    if (due === 'week') where.push(`due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`);
    params.push(Math.min(parseInt(limit) || 100, 500));
    const sql = `SELECT * FROM crm_followups
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(due_date, '9999-12-31') ASC, last_activity_at DESC NULLS LAST
      LIMIT $${idx}`;
    const { rows } = await pool.query(sql, params);
    res.json({ followups: rows, count: rows.length });
  } catch (err) {
    console.error('crm_followups list error:', err);
    res.status(500).json({ error: 'Failed to list follow-ups' });
  }
});

// POST /api/follow-ups — create or upsert (from Follow-Up Boss via Make.com)
router.post('/', async (req, res) => {
  try {
    const {
      fub_person_id, fub_event_id, contact_name, contact_email, contact_phone,
      stage, lead_source, follow_up_type, due_date, notes, status,
      last_activity_at
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO crm_followups
        (fub_person_id, fub_event_id, contact_name, contact_email, contact_phone,
         stage, lead_source, follow_up_type, due_date, notes, status, last_activity_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11,'open'), $12)
       ON CONFLICT (fub_event_id) DO UPDATE SET
         contact_name = EXCLUDED.contact_name,
         contact_email = EXCLUDED.contact_email,
         contact_phone = EXCLUDED.contact_phone,
         stage = EXCLUDED.stage,
         lead_source = EXCLUDED.lead_source,
         follow_up_type = EXCLUDED.follow_up_type,
         due_date = EXCLUDED.due_date,
         notes = EXCLUDED.notes,
         status = EXCLUDED.status,
         last_activity_at = EXCLUDED.last_activity_at,
         updated_at = NOW()
       RETURNING *`,
      [fub_person_id || null, fub_event_id || null, contact_name || null,
       contact_email || null, contact_phone || null, stage || null,
       lead_source || null, follow_up_type || null, due_date || null,
       notes || null, status, last_activity_at || null]
    );
    res.status(201).json({ followup: rows[0] });
  } catch (err) {
    console.error('crm_followups create error:', err);
    res.status(500).json({ error: 'Failed to save follow-up' });
  }
});

// PATCH /api/follow-ups/:id — mark complete, snooze, reassign
router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['stage','follow_up_type','due_date','notes','status','last_activity_at'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) { sets.push(`${f} = $${idx++}`); params.push(req.body[f]); }
    }
    if (req.body.status === 'done') sets.push(`completed_at = NOW()`);
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE crm_followups SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    // Two-way FUB sync: if this follow-up is linked to a FUB task
    // (fub_event_id) and we just marked it done, complete the FUB task too
    let fub_synced = false;
    if (req.body.status === 'done' && rows[0].fub_event_id) {
      try {
        const fub = require('../services/fub');
        if (await fub.getApiKey()) {
          await fub.completeTask(rows[0].fub_event_id, { notes: req.body.notes || undefined });
          fub_synced = true;
        }
      } catch (e) {
        console.error('[CRM→FUB] completeTask failed:', e.message);
        // Non-fatal — local update succeeded, just log the FUB side failure
      }
    }
    res.json({ followup: rows[0], fub_synced });
  } catch (err) {
    console.error('crm_followups update error:', err);
    res.status(500).json({ error: 'Failed to update follow-up' });
  }
});

// DELETE /api/follow-ups/:id
router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM crm_followups WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;
