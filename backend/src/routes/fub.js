/**
 * Follow Up Boss direct API routes.
 *
 * Exposes FUB as a first-class citizen in the dashboard (the Make.com sync
 * route at /api/sync/follow-up-boss still exists as a fallback / for
 * event-based pushes, but these routes let the dashboard + agent pull and
 * push directly).
 *
 * All routes require the dashboard's own X-API-Key header.
 * Gracefully 503 with a helpful error if fub_api_key isn't configured.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const fub = require('../services/fub');
const { publish } = require('../services/events');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

function handleFubError(res, err) {
  if (err.code === 'FUB_NOT_CONFIGURED') {
    return res.status(503).json({
      error: 'Follow Up Boss not configured',
      message: 'Enter your FUB API key in dashboard Settings → Integrations → FUB.',
      how_to_get_key: 'In Follow Up Boss, go to Admin → API. Click "Create API Key". Name it "JW Dashboard". Copy the key.'
    });
  }
  console.error('FUB error:', err.message);
  return res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 500).json({
    error: 'Follow Up Boss request failed',
    message: err.message,
    response: err.response || null
  });
}

// GET /api/fub/status — configured? connected? who is it?
router.get('/status', async (req, res) => {
  try {
    const key = await fub.getApiKey();
    if (!key) return res.json({ configured: false, connected: false });
    try {
      const who = await fub.whoami();
      res.json({ configured: true, connected: true, whoami: who });
    } catch (e) {
      res.json({ configured: true, connected: false, error: e.message });
    }
  } catch (e) { handleFubError(res, e); }
});

// POST /api/fub/test — explicit "does my key work?" check (doesn't cache)
router.post('/test', async (req, res) => {
  try {
    const who = await fub.whoami();
    res.json({ success: true, whoami: who });
  } catch (e) { handleFubError(res, e); }
});

// ---------- People ----------

router.get('/people', async (req, res) => {
  try {
    const data = await fub.listPeople({
      limit: Math.min(parseInt(req.query.limit) || 50, 250),
      offset: parseInt(req.query.offset) || 0,
      sort: req.query.sort,
      stage: req.query.stage,
      assignedTo: req.query.assignedTo,
      search: req.query.search
    });
    res.json(data);
  } catch (e) { handleFubError(res, e); }
});

router.get('/people/:id', async (req, res) => {
  try {
    const [person, events, notes, tasks] = await Promise.all([
      fub.getPerson(req.params.id),
      fub.personEvents(req.params.id).catch(() => ({ events: [] })),
      fub.personNotes(req.params.id).catch(() => ({ notes: [] })),
      fub.personTasks(req.params.id).catch(() => ({ tasks: [] }))
    ]);
    res.json({
      person,
      events: events.events || [],
      notes: notes.notes || [],
      tasks: tasks.tasks || []
    });
  } catch (e) { handleFubError(res, e); }
});

router.post('/people', async (req, res) => {
  try {
    const person = await fub.createPerson(req.body);
    res.status(201).json({ person });
  } catch (e) { handleFubError(res, e); }
});

router.patch('/people/:id', async (req, res) => {
  try {
    const person = await fub.updatePerson(req.params.id, req.body);
    res.json({ person });
  } catch (e) { handleFubError(res, e); }
});

// ---------- Tasks ----------

router.get('/tasks', async (req, res) => {
  try {
    const data = await fub.listTasks({
      limit: Math.min(parseInt(req.query.limit) || 100, 250),
      offset: parseInt(req.query.offset) || 0,
      status: req.query.status,
      assignedTo: req.query.assignedTo,
      dueAfter: req.query.dueAfter,
      dueBefore: req.query.dueBefore
    });
    res.json(data);
  } catch (e) { handleFubError(res, e); }
});

router.post('/tasks', async (req, res) => {
  try {
    const task = await fub.createTask(req.body);
    publish({ type: 'fub', event: 'task_created', task_id: task.id });
    res.status(201).json({ task });
  } catch (e) { handleFubError(res, e); }
});

router.patch('/tasks/:id', async (req, res) => {
  try {
    const task = await fub.updateTask(req.params.id, req.body);
    res.json({ task });
  } catch (e) { handleFubError(res, e); }
});

router.post('/tasks/:id/complete', async (req, res) => {
  try {
    const task = await fub.completeTask(req.params.id, { notes: req.body.notes });
    // Mirror the completion in local crm_followups if present
    await pool.query(
      `UPDATE crm_followups
       SET status='done', completed_at=NOW(), updated_at=NOW()
       WHERE fub_event_id = $1 OR fub_person_id = $2`,
      [String(req.params.id), String(task.personId || '')]
    ).catch(() => {});
    publish({ type: 'fub', event: 'task_completed', task_id: req.params.id });
    res.json({ task });
  } catch (e) { handleFubError(res, e); }
});

// ---------- Notes ----------

router.post('/notes', async (req, res) => {
  try {
    const { personId, subject, body, isHtml } = req.body;
    if (!personId || !body) return res.status(400).json({ error: 'personId and body required' });
    const note = await fub.createNote({ personId, subject: subject || null, body, isHtml: !!isHtml });
    publish({ type: 'fub', event: 'note_created', person_id: personId });
    res.status(201).json({ note });
  } catch (e) { handleFubError(res, e); }
});

// ---------- Stages / Users / Deals / Pipelines / Smart Lists ----------

router.get('/stages', async (req, res) => {
  try { res.json(await fub.listStages()); }
  catch (e) { handleFubError(res, e); }
});

router.get('/users', async (req, res) => {
  try { res.json(await fub.listUsers()); }
  catch (e) { handleFubError(res, e); }
});

router.get('/deals', async (req, res) => {
  try {
    res.json(await fub.listDeals({
      limit: Math.min(parseInt(req.query.limit) || 50, 250),
      offset: parseInt(req.query.offset) || 0,
      status: req.query.status,
      stage: req.query.stage
    }));
  } catch (e) { handleFubError(res, e); }
});

router.post('/deals', async (req, res) => {
  try {
    const deal = await fub.createDeal(req.body);
    res.status(201).json({ deal });
  } catch (e) { handleFubError(res, e); }
});

router.get('/pipelines', async (req, res) => {
  try { res.json(await fub.listPipelines()); }
  catch (e) { handleFubError(res, e); }
});

router.get('/smart-lists', async (req, res) => {
  try { res.json(await fub.listSmartLists()); }
  catch (e) { handleFubError(res, e); }
});

// ---------- Ingest: pull FUB tasks into local crm_followups ----------

/**
 * POST /api/fub/sync
 * Pulls open + recently-updated tasks from FUB and upserts into crm_followups.
 * This is what the scheduler calls every 15 minutes to keep the dashboard in sync.
 * Safe to run manually as often as you want (idempotent via upsert).
 */
router.post('/sync', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.body?.limit) || 100, 250);
    const tasksResp = await fub.listTasks({ limit, status: 'Active' });
    const tasks = tasksResp.tasks || [];

    let upserted = 0;
    for (const t of tasks) {
      const personId = t.personId ? String(t.personId) : null;
      let person = null;
      if (personId) {
        try { person = await fub.getPerson(personId); } catch (e) { /* ignore */ }
      }
      const email = person?.emails?.[0]?.value || null;
      const phone = person?.phones?.[0]?.value || null;
      const name = person?.name || [person?.firstName, person?.lastName].filter(Boolean).join(' ') || null;
      const stage = person?.stage || null;
      const source = person?.source || null;

      await pool.query(
        `INSERT INTO crm_followups
          (fub_person_id, fub_event_id, contact_name, contact_email, contact_phone,
           stage, lead_source, follow_up_type, due_date, notes, status, last_activity_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 COALESCE($11, 'open'), $12)
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
           updated_at = NOW()`,
        [personId, String(t.id), name, email, phone,
         stage, source, t.type || null, t.dueDate ? t.dueDate.slice(0, 10) : null,
         t.name || t.description || null,
         t.status === 'Completed' ? 'done' : 'open',
         t.updated || null]
      );
      upserted++;
    }

    // Also mark locally-tracked follow-ups as done when FUB shows them completed.
    // (Done-sync covered by /sync — the upsert above handles state transitions.)

    publish({ type: 'fub', event: 'sync_complete', upserted });
    res.json({ success: true, upserted, fetched: tasks.length });
  } catch (e) { handleFubError(res, e); }
});

module.exports = router;
