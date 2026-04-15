/**
 * Scheduled tasks management. CRUD + manual "run now" trigger.
 * The scheduler service polls the table every 60s to dispatch due jobs.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');
const { nextRun, tick } = require('../services/scheduler');

router.use(requireApiKey);

const VALID_KINDS = ['agent_task','briefing','weekly_review','gap_analysis','chrome_workflow',
                     'fub_sync','fub_auto_respond','fub_attribution',
                     'email_sync','email_nudge'];
const VALID_FREQ  = ['hourly','daily','weekly','monthly'];

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, w.name AS workflow_name
         FROM scheduled_tasks s
         LEFT JOIN chrome_workflows w ON w.id = (s.payload->>'workflow_id')::int
         ORDER BY enabled DESC, COALESCE(next_run_at, '9999-12-31'::timestamptz) ASC`
    );
    res.json({ schedules: rows, count: rows.length });
  } catch (err) {
    console.error('schedules list error:', err);
    res.status(500).json({ error: 'Failed to list schedules' });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body;
    if (!b.name) return res.status(400).json({ error: 'name required' });
    if (!VALID_KINDS.includes(b.kind)) return res.status(400).json({ error: 'kind must be one of ' + VALID_KINDS.join(', ') });
    const freq = b.frequency || 'daily';
    if (!VALID_FREQ.includes(freq)) return res.status(400).json({ error: 'frequency invalid' });

    // Compute initial next_run_at using the scheduler
    const next = nextRun({
      frequency: freq,
      run_at_hour: b.run_at_hour ?? 7,
      run_at_minute: b.run_at_minute ?? 0,
      run_at_dow: b.run_at_dow,
      run_at_dom: b.run_at_dom
    });

    const { rows } = await pool.query(
      `INSERT INTO scheduled_tasks
        (name, description, kind, payload, frequency,
         run_at_hour, run_at_minute, run_at_dow, run_at_dom,
         deliver_via, deliver_to, enabled, next_run_at)
       VALUES ($1,$2,$3,COALESCE($4,'{}')::jsonb,$5,$6,$7,$8,$9,
               COALESCE($10,'dashboard'),$11,COALESCE($12,true),$13)
       ON CONFLICT (name) DO UPDATE SET
         description = EXCLUDED.description,
         kind = EXCLUDED.kind,
         payload = EXCLUDED.payload,
         frequency = EXCLUDED.frequency,
         run_at_hour = EXCLUDED.run_at_hour,
         run_at_minute = EXCLUDED.run_at_minute,
         run_at_dow = EXCLUDED.run_at_dow,
         run_at_dom = EXCLUDED.run_at_dom,
         deliver_via = EXCLUDED.deliver_via,
         deliver_to = EXCLUDED.deliver_to,
         enabled = EXCLUDED.enabled,
         next_run_at = EXCLUDED.next_run_at,
         updated_at = NOW()
       RETURNING *`,
      [b.name, b.description || null, b.kind,
       b.payload ? JSON.stringify(b.payload) : null, freq,
       b.run_at_hour ?? 7, b.run_at_minute ?? 0,
       b.run_at_dow ?? null, b.run_at_dom ?? null,
       b.deliver_via, b.deliver_to || null, b.enabled, next]
    );
    res.status(201).json({ schedule: rows[0] });
  } catch (err) {
    console.error('schedules upsert error:', err);
    res.status(500).json({ error: 'Failed to save schedule' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['name','description','kind','payload','frequency',
      'run_at_hour','run_at_minute','run_at_dow','run_at_dom',
      'deliver_via','deliver_to','enabled'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) {
        sets.push(`${f} = $${idx++}`);
        params.push(f === 'payload' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });

    // If timing-related fields changed, recompute next_run_at
    const reschedKeys = ['frequency','run_at_hour','run_at_minute','run_at_dow','run_at_dom','enabled'];
    const needReschedule = reschedKeys.some(k => k in req.body);
    if (needReschedule) {
      const cur = await pool.query('SELECT * FROM scheduled_tasks WHERE id = $1', [req.params.id]);
      if (!cur.rows.length) return res.status(404).json({ error: 'Not found' });
      const merged = { ...cur.rows[0], ...req.body };
      const next = nextRun(merged);
      sets.push(`next_run_at = $${idx++}`);
      params.push(next);
    }

    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ schedule: rows[0] });
  } catch (err) {
    console.error('schedules update error:', err);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM scheduled_tasks WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) { res.status(500).json({ error: 'Failed to delete' }); }
});

// POST /api/schedules/:id/run-now — fire the job immediately. Uses the
// scheduler's tick loop by setting next_run_at to NOW() and waking it.
router.post('/:id/run-now', async (req, res) => {
  try {
    await pool.query('UPDATE scheduled_tasks SET next_run_at = NOW() WHERE id = $1', [req.params.id]);
    // Trigger an immediate tick (don't wait for the 60s poll)
    tick().catch(() => {});
    res.json({ success: true, message: 'Job will run within seconds; check last_result on the schedule.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to enqueue' });
  }
});

module.exports = router;
