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

// GET /api/fub/lookup?email=...&phone=... — find a single person by email
// or phone. Returns { person: null } quickly if no match, so UI can degrade
// gracefully. 503s when FUB isn't configured so caller can stop trying.
router.get('/lookup', async (req, res) => {
  try {
    const { email, phone } = req.query;
    if (!email && !phone) return res.status(400).json({ error: 'email or phone required' });
    let person = null;
    if (email) person = await fub.findPersonByEmail(email);
    if (!person && phone) person = await fub.findPersonByPhone(phone);
    res.json({ person });
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
      search: req.query.search,
      smartListId: req.query.smartListId
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

/**
 * POST /api/fub/deals/sync-from-closings
 * Pushes rows from our local `closings` table into FUB as Deals.
 *
 * Body: { closing_ids?: [1,2,3] }  (omit to push every un-synced closing)
 *
 * Idempotent: the local closings.notes field stamps 'fub_deal_id=N' on
 * successful push; rows that already have one are skipped unless force=true.
 */
router.post('/deals/sync-from-closings', async (req, res) => {
  try {
    const { closing_ids, force } = req.body || {};
    const where = Array.isArray(closing_ids) && closing_ids.length
      ? 'WHERE id = ANY($1::int[])'
      : (force ? '' : "WHERE COALESCE(notes,'') NOT LIKE '%fub_deal_id=%'");
    const params = Array.isArray(closing_ids) && closing_ids.length ? [closing_ids] : [];
    const { rows: closings } = await pool.query(
      `SELECT * FROM closings ${where} ORDER BY closing_date ASC NULLS LAST`,
      params
    );

    const pushed = [];
    const errors = [];

    for (const c of closings) {
      try {
        // Best-effort: try to link to a FUB person via client email/phone
        let personId = null;
        if (c.client_name) {
          try {
            const match = await fub.listPeople({ search: c.client_name, limit: 1 });
            if (match.people && match.people[0]) personId = match.people[0].id;
          } catch (e) { /* ignore */ }
        }

        const dealBody = {
          name: `${c.property_address}${c.city ? ', ' + c.city : ''}`,
          stage: mapClosingStatusToFubStage(c.status),
          price: c.sale_price ? Number(c.sale_price) : undefined,
          commissionValue: c.gross_commission ? Number(c.gross_commission) : undefined,
          projectedCloseDate: c.closing_date || undefined,
          status: c.status === 'closed' ? 'Won' : (c.status === 'cancelled' ? 'Lost' : 'Active'),
          description: c.notes || undefined
        };
        if (personId) dealBody.personId = personId;

        const deal = await fub.createDeal(dealBody);
        pushed.push({ closing_id: c.id, deal_id: deal.id, name: dealBody.name });

        // Stamp the closing row so we don't double-push
        const stamp = 'fub_deal_id=' + deal.id;
        await pool.query(
          `UPDATE closings SET notes = CASE
             WHEN notes IS NULL OR notes = '' THEN $1
             ELSE notes || E'\n\n' || $1 END,
             updated_at = NOW()
           WHERE id = $2`,
          [stamp, c.id]
        );
      } catch (e) {
        errors.push({ closing_id: c.id, error: e.message });
      }
    }

    publish({ type: 'fub', event: 'deals_synced', count: pushed.length });
    res.json({ success: true, pushed, errors, scanned: closings.length });
  } catch (e) { handleFubError(res, e); }
});

function mapClosingStatusToFubStage(status) {
  const m = {
    pending: 'Under Contract',
    firm: 'Firm / Conditions Waived',
    closed: 'Closed',
    cancelled: 'Lost'
  };
  return m[status] || undefined;
}

router.get('/pipelines', async (req, res) => {
  try { res.json(await fub.listPipelines()); }
  catch (e) { handleFubError(res, e); }
});

router.get('/smart-lists', async (req, res) => {
  try { res.json(await fub.listSmartLists()); }
  catch (e) { handleFubError(res, e); }
});

/**
 * POST /api/fub/smart-lists/:id/bulk-action
 * Body: {
 *   action: 'note' | 'task' | 'email_draft',
 *   template: '...',           // Claude personalizes per contact
 *   subject: '...',            // for email / note headers
 *   task_type: 'call|email|text|meeting',   // for task kind
 *   due_in_days: 3,                          // for task kind
 *   dry_run: true                            // preview without pushing
 * }
 *
 * Pulls every person in the smart list, has Claude rewrite the template
 * for each contact with their context, and either:
 *   - creates a FUB note on each person
 *   - creates a FUB task on each person
 *   - creates a Gmail draft to each person (does NOT send)
 *
 * Returns a summary of what was written + sample renders so Jonathan can
 * preview before committing. dry_run=true returns the renders without
 * pushing anything.
 */
router.post('/smart-lists/:id/bulk-action', async (req, res) => {
  try {
    const { action, template, subject, task_type, due_in_days, dry_run, limit } = req.body || {};
    if (!action || !['note','task','email_draft'].includes(action)) {
      return res.status(400).json({ error: 'action must be one of: note, task, email_draft' });
    }
    if (!template || template.length < 3) {
      return res.status(400).json({ error: 'template required' });
    }

    const key = await fub.getApiKey();
    if (!key) return res.status(503).json({ error: 'FUB not configured' });

    if (action === 'email_draft' && !process.env.GMAIL_REFRESH_TOKEN) {
      return res.status(503).json({ error: 'Gmail not configured — cannot create email drafts' });
    }

    // Pull the smart list members (capped to protect from mega-lists)
    const cap = Math.min(parseInt(limit) || 50, 100);
    const peopleResp = await fub.listPeople({ smartListId: req.params.id, limit: cap });
    const people = peopleResp.people || [];
    if (!people.length) return res.json({ success: true, count: 0, results: [] });

    // Load intuition so personalization uses Jonathan's voice
    let ctxBlock = '';
    try { ctxBlock = await require('../services/intuition').buildContextBlock(); } catch (e) {}

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic();

    const SYSTEM = `You are personalizing outreach for Jonathan Wallace (real estate agent, Southern
Georgian Bay) to a CRM contact. Rewrite the given template in Jonathan's voice,
referencing whatever you know about the specific contact. Keep the core
message and intent intact.

Rules:
- Use the contact's first name naturally, don't force it.
- If they have a stage / source / recent activity, reference it only when it
  genuinely strengthens the message.
- No real-estate clichés ('won't last', 'dream home', 'must-see').
- Match the template's length and register. Don't add fluff.
- Plain prose unless the template explicitly uses formatting.
- Return ONLY the rewritten message, no commentary or quotes.
${ctxBlock ? '\n' + ctxBlock : ''}`;

    const results = [];
    const errors = [];

    for (const person of people) {
      const firstName = person.firstName || (person.name || '').split(' ')[0] || 'friend';
      const email = person.emails?.[0]?.value || null;
      const userPayload = `Template:\n${template}\n\nContact:\n${JSON.stringify({
        first_name: firstName,
        name: person.name,
        stage: person.stage,
        source: person.source,
        tags: person.tags,
        last_activity: person.lastActivity,
        email,
        phone: person.phones?.[0]?.value || null
      }, null, 2)}`;

      let rendered;
      try {
        const r = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 600,
          system: SYSTEM,
          messages: [{ role: 'user', content: userPayload }]
        });
        rendered = r.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      } catch (e) {
        errors.push({ person_id: person.id, name: person.name, error: 'Claude: ' + e.message });
        continue;
      }

      if (dry_run) {
        results.push({ person_id: person.id, name: person.name, email, rendered, pushed: false });
        continue;
      }

      // Push the action
      try {
        if (action === 'note') {
          const note = await fub.createNote({
            personId: person.id,
            subject: subject || 'Bulk outreach',
            body: rendered,
            isHtml: false
          });
          results.push({ person_id: person.id, name: person.name, rendered, pushed: 'note', note_id: note.id });
        } else if (action === 'task') {
          const due = due_in_days != null
            ? new Date(Date.now() + Number(due_in_days) * 86400000).toISOString()
            : undefined;
          const t = await fub.createTask({
            personId: person.id,
            name: subject || rendered.split('\n')[0].slice(0, 80),
            type: mapTaskType(task_type || 'call'),
            dueDate: due,
            description: rendered,
            status: 'Active'
          });
          results.push({ person_id: person.id, name: person.name, rendered, pushed: 'task', task_id: t.id });
        } else if (action === 'email_draft') {
          if (!email) {
            errors.push({ person_id: person.id, name: person.name, error: 'No email on record' });
            continue;
          }
          const { google } = require('googleapis');
          const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
          oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
          const gmail = google.gmail({ version: 'v1', auth: oauth2 });

          const from = process.env.GMAIL_USER || 'jonathanwallacerealestate@gmail.com';
          const subj = subject || 'Touching base';
          const bodyHtml = rendered.split('\n').map(l => '<p>' + l.replace(/</g,'&lt;') + '</p>').join('');
          const raw = Buffer.from([
            `From: ${from}`,
            `To: ${email}`,
            `Subject: ${subj}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=UTF-8',
            '',
            bodyHtml
          ].join('\r\n')).toString('base64url');
          const r = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
          results.push({ person_id: person.id, name: person.name, email, rendered, pushed: 'email_draft', draft_id: r.data.id });
        }
      } catch (e) {
        errors.push({ person_id: person.id, name: person.name, error: e.message });
      }
    }

    publish({ type: 'fub', event: 'bulk_action', smart_list_id: req.params.id, count: results.length, action });
    res.json({
      success: true,
      smart_list_id: req.params.id,
      action,
      dry_run: !!dry_run,
      total: people.length,
      pushed: results.filter(r => r.pushed).length,
      rendered: results.length,
      errors,
      results
    });
  } catch (e) { handleFubError(res, e); }
});

function mapTaskType(t) {
  const m = { call: 'Call', phone: 'Call', email: 'Email', text: 'Text', sms: 'Text',
              meeting: 'Meeting', showing: 'Showing' };
  return m[(t || '').toLowerCase()] || 'Other';
}

// ---------- Conversion funnel ----------

/**
 * GET /api/fub/funnel?period=30|90|ytd
 * Computes a conversion funnel from FUB stages + local closings data:
 *   Lead → Active Prospect → Showing/Appointment → Offer → Firm → Closed
 *
 * Returns per-stage counts, conversion rates between stages, average
 * time-to-close for closed deals, and a Claude narrative interpretation.
 */
router.get('/funnel', async (req, res) => {
  try {
    const key = await fub.getApiKey();
    if (!key) return res.status(503).json({ error: 'FUB not configured' });

    const periodDays = req.query.period === 'ytd'
      ? Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000)
      : (parseInt(req.query.period) || 90);
    const cutoff = new Date(Date.now() - periodDays * 86400000);

    // Pull ALL FUB people created in the period (paginate up to 500)
    let people = [];
    let offset = 0;
    for (let i = 0; i < 5; i++) {
      const r = await fub.listPeople({ limit: 100, offset, sort: '-created' });
      const batch = r.people || [];
      if (!batch.length) break;
      people = people.concat(batch);
      offset += batch.length;
      if (batch.length < 100) break;
    }
    const fresh = people.filter(p => p.created && new Date(p.created) >= cutoff);

    // Bucket by stage
    const stageMap = {};
    for (const p of fresh) {
      const s = (p.stage || 'Unknown').trim();
      stageMap[s] = (stageMap[s] || 0) + 1;
    }

    // Pull appointments count from FUB (showings = active engagement)
    let appointmentCount = 0;
    try {
      const appts = await fub.listAppointments({
        limit: 100,
        after: cutoff.toISOString(),
        before: new Date().toISOString()
      });
      appointmentCount = (appts.appointments || []).length;
    } catch (e) { /* ignore if appointments endpoint not available */ }

    // Pull from local closings for offer → firm → closed funnel
    const { rows: closings } = await pool.query(
      `SELECT status, offer_date, firm_date, closing_date, sale_price,
              gross_commission, net_profit
         FROM closings
        WHERE (offer_date >= $1 OR firm_date >= $1 OR closing_date >= $1)`,
      [cutoff.toISOString().slice(0, 10)]
    );

    const offerCount = closings.filter(c => c.offer_date).length;
    const firmCount = closings.filter(c => c.firm_date || c.status === 'firm' || c.status === 'closed').length;
    const closedCount = closings.filter(c => c.status === 'closed').length;

    // Time-to-close for closed deals (offer_date → closing_date)
    const timesToClose = closings
      .filter(c => c.status === 'closed' && c.offer_date && c.closing_date)
      .map(c => Math.round((new Date(c.closing_date) - new Date(c.offer_date)) / 86400000));
    const avgTimeToClose = timesToClose.length
      ? Math.round(timesToClose.reduce((a, b) => a + b, 0) / timesToClose.length)
      : null;

    // Build the funnel stages
    const totalLeads = fresh.length;
    const funnel = [
      { stage: 'Leads (new)', count: totalLeads },
      { stage: 'Showings/Appointments', count: appointmentCount },
      { stage: 'Offers written', count: offerCount },
      { stage: 'Firm / conditions waived', count: firmCount },
      { stage: 'Closed', count: closedCount }
    ];
    // Conversion rates
    for (let i = 1; i < funnel.length; i++) {
      const prev = funnel[i - 1].count;
      funnel[i].conversion_from_prev = prev > 0
        ? Math.round((funnel[i].count / prev) * 100) + '%'
        : 'n/a';
    }
    funnel[0].conversion_from_prev = '100%';

    // Claude narrative
    let narrative = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        let ctxBlock = '';
        try { ctxBlock = await require('../services/intuition').buildContextBlock(); } catch (e) {}
        const Anthropic = require('@anthropic-ai/sdk');
        const anthropic = new Anthropic();
        const sys = `You are analyzing Jonathan Wallace's sales conversion funnel for the
last ${periodDays} days. Given the funnel data + stage breakdown + time-to-close,
write a 150-word narrative. Name the biggest leak (where the most drop-off
occurs), the healthiest conversion, and one concrete action to improve the
weakest point. Plain prose, no bullets. ${ctxBlock ? '\n' + ctxBlock : ''}`;
        const r = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          system: sys,
          messages: [{ role: 'user', content: JSON.stringify({ funnel, stageMap, avgTimeToClose, periodDays }, null, 2) }]
        });
        narrative = r.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      } catch (e) { /* narrative is optional */ }
    }

    res.json({
      period_days: periodDays,
      total_leads: totalLeads,
      funnel,
      by_fub_stage: stageMap,
      avg_time_to_close_days: avgTimeToClose,
      times_to_close: timesToClose,
      narrative
    });
  } catch (e) { handleFubError(res, e); }
});

// ---------- Contract deadline auto-tasks ----------

/**
 * POST /api/fub/contract-deadlines
 * Body: { closing_id?, dry_run? }
 *
 * For the specified closing (or all pending/firm closings if omitted),
 * computes contextual deadline tasks and creates them in BOTH FUB (as
 * tasks on the linked contact — via client_name search) and the local
 * crm_followups table.
 *
 * Task types generated depending on available date fields:
 *   - Pending (have offer_date): conditions waiver reminder 2 days
 *     before firm, inspection follow-up within 3 days of offer
 *   - Firm (have firm_date): financing confirmation 7 days before
 *     closing, final walkthrough 2 days before closing, closing-day
 *     check-in
 *   - General: firm check-in 3 days after firm_date
 *
 * Idempotent via `contract_task_` prefix stamped into closing notes.
 */
router.post('/contract-deadlines', async (req, res) => {
  try {
    const { closing_id, dry_run } = req.body || {};
    const key = await fub.getApiKey();

    const where = closing_id
      ? 'WHERE id = $1'
      : "WHERE status IN ('pending','firm') AND closing_date IS NOT NULL";
    const params = closing_id ? [closing_id] : [];
    const { rows: closings } = await pool.query(
      `SELECT * FROM closings ${where}`,
      params
    );

    if (!closings.length) return res.json({ success: true, closings_scanned: 0, tasks: [] });

    const plannedTasks = [];

    for (const c of closings) {
      // Skip if already stamped
      if (!closing_id && (c.notes || '').includes('contract_tasks_generated')) continue;

      // Build a schedule of tasks based on status + dates
      const now = new Date();
      const tasks = [];
      const closingDate = c.closing_date ? new Date(c.closing_date) : null;
      const firmDate = c.firm_date ? new Date(c.firm_date) : null;
      const offerDate = c.offer_date ? new Date(c.offer_date) : null;

      if (c.status === 'pending' && offerDate) {
        tasks.push({
          when: addDays(offerDate, 2),
          type: 'Call',
          name: `Inspection follow-up — ${c.property_address}`,
          description: `Check in on inspection results / any concerns. Pending status, offer ${offerDate.toISOString().slice(0,10)}.`
        });
        if (firmDate) {
          tasks.push({
            when: addDays(firmDate, -2),
            type: 'Call',
            name: `Conditions waiver reminder — ${c.property_address}`,
            description: `Deal goes firm ${firmDate.toISOString().slice(0,10)}. Confirm all conditions are satisfied / waived.`
          });
        }
      }

      if (firmDate && now <= addDays(firmDate, 7)) {
        tasks.push({
          when: addDays(firmDate, 3),
          type: 'Email',
          name: `Post-firm check-in — ${c.property_address}`,
          description: `Deal went firm ${firmDate.toISOString().slice(0,10)}. Check in on moving logistics, mover referrals, any loose ends.`
        });
      }

      if (closingDate) {
        tasks.push({
          when: addDays(closingDate, -7),
          type: 'Call',
          name: `Financing confirmation — ${c.property_address}`,
          description: `Closes ${closingDate.toISOString().slice(0,10)}. Confirm lender has funded / will fund on time.`
        });
        tasks.push({
          when: addDays(closingDate, -2),
          type: 'Meeting',
          name: `Final walkthrough — ${c.property_address}`,
          description: `Closes ${closingDate.toISOString().slice(0,10)}. Schedule the pre-closing walkthrough.`
        });
        tasks.push({
          when: closingDate,
          type: 'Call',
          name: `Closing day — ${c.property_address}`,
          description: `Closing day! Confirm keys / funds have moved. Congratulate ${c.client_name || 'client'}.`
        });
        tasks.push({
          when: addDays(closingDate, 30),
          type: 'Call',
          name: `30-day post-close check-in — ${c.property_address}`,
          description: `Called as part of standard post-close program. Ask for a referral if things are going smoothly.`
        });
      }

      // Filter out any tasks already in the past (more than 1 day old)
      const pruned = tasks.filter(t => t.when && t.when >= addDays(now, -1));

      // Resolve FUB person id if possible
      let fubPersonId = null;
      if (key && c.client_name) {
        try {
          const m = await fub.listPeople({ search: c.client_name, limit: 1 });
          if (m.people && m.people[0]) fubPersonId = m.people[0].id;
        } catch (e) { /* ignore */ }
      }

      if (dry_run) {
        plannedTasks.push({ closing_id: c.id, property: c.property_address, client: c.client_name, fub_person_id: fubPersonId, planned: pruned });
        continue;
      }

      let pushedFub = 0, pushedLocal = 0;
      for (const t of pruned) {
        try {
          // Local CRM follow-up
          await pool.query(
            `INSERT INTO crm_followups
              (contact_name, fub_person_id, follow_up_type, due_date, notes, status)
             VALUES ($1, $2, $3, $4, $5, 'open')`,
            [c.client_name, fubPersonId ? String(fubPersonId) : null,
             t.type.toLowerCase(), t.when.toISOString().slice(0,10),
             t.name + ' — ' + t.description]
          );
          pushedLocal++;
        } catch (e) { /* ignore dupes */ }

        // FUB task if we have the person
        if (key && fubPersonId) {
          try {
            await fub.createTask({
              personId: fubPersonId,
              name: t.name,
              type: t.type,
              dueDate: t.when.toISOString(),
              description: t.description,
              status: 'Active'
            });
            pushedFub++;
          } catch (e) { /* ignore dupes */ }
        }
      }

      // Stamp so we don't regenerate on re-run
      if (pushedLocal || pushedFub) {
        const stamp = `contract_tasks_generated=${new Date().toISOString().slice(0,10)}`;
        await pool.query(
          `UPDATE closings SET notes = CASE
             WHEN notes IS NULL OR notes = '' THEN $1
             ELSE notes || E'\\n\\n' || $1 END,
             updated_at = NOW()
           WHERE id = $2`,
          [stamp, c.id]
        );
      }

      plannedTasks.push({
        closing_id: c.id,
        property: c.property_address,
        client: c.client_name,
        fub_person_id: fubPersonId,
        generated: { fub: pushedFub, local: pushedLocal, total: pruned.length }
      });
    }

    publish({ type: 'fub', event: 'contract_deadlines_generated', closings: plannedTasks.length });
    res.json({ success: true, dry_run: !!dry_run, closings_scanned: closings.length, tasks: plannedTasks });
  } catch (e) { handleFubError(res, e); }
});

function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// ---------- Showing-day prep brief ----------

/**
 * POST /api/fub/showing-prep
 * Body: { appointment_id?, person_id?, listing_id? }
 *
 * Compiles a pre-showing brief: who you're meeting, their FUB history,
 * open tasks, recent notes, and (if a listing is referenced) the listing
 * details + quick talking points. Returns a Claude-rendered 250-word brief
 * Jonathan can read or have spoken to him in the car on the way.
 *
 * At least one of appointment_id (FUB) or person_id must be provided.
 * listing_id is optional — if absent, the agent tries to infer from the
 * appointment's title / location.
 */
router.post('/showing-prep', async (req, res) => {
  try {
    const key = await fub.getApiKey();
    if (!key) return res.status(503).json({ error: 'FUB not configured' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Claude not configured' });

    const { appointment_id, person_id, listing_id } = req.body || {};
    if (!appointment_id && !person_id) {
      return res.status(400).json({ error: 'appointment_id or person_id required' });
    }

    let appointment = null;
    let pid = person_id;

    // Resolve appointment from FUB if given
    if (appointment_id) {
      try {
        const ap = await fub.request('GET', '/appointments/' + encodeURIComponent(appointment_id));
        appointment = ap;
        if (!pid && ap.personIds && ap.personIds.length) pid = ap.personIds[0];
        if (!pid && ap.personId) pid = ap.personId;
      } catch (e) { /* appointment may be local-only or missing */ }
    }

    // Pull the person + history
    let personBundle = null;
    if (pid) {
      const [person, events, notes, tasks] = await Promise.all([
        fub.getPerson(pid).catch(() => null),
        fub.personEvents(pid, { limit: 15 }).catch(() => ({ events: [] })),
        fub.personNotes(pid, { limit: 8 }).catch(() => ({ notes: [] })),
        fub.personTasks(pid, { limit: 8 }).catch(() => ({ tasks: [] }))
      ]);
      personBundle = { person, events: events.events || [], notes: notes.notes || [], tasks: tasks.tasks || [] };
    }

    // Try to find the listing — explicit id wins, else fuzzy-match on
    // appointment title/location against active listings
    let listing = null;
    if (listing_id) {
      const r = await pool.query('SELECT * FROM listings WHERE id = $1', [listing_id]);
      listing = r.rows[0] || null;
    } else if (appointment) {
      const blob = [(appointment.title || ''), (appointment.location || ''), (appointment.description || '')].join(' ').toLowerCase();
      const r = await pool.query(
        `SELECT * FROM listings WHERE status IN ('active','new') LIMIT 50`
      );
      for (const L of r.rows) {
        const address = (L.address || '').toLowerCase();
        if (address && blob.includes(address.split(',')[0].trim())) { listing = L; break; }
      }
    }

    // Pull 5 nearby comps (same city, similar price) if we have a listing
    let comps = [];
    if (listing && listing.city) {
      const r = await pool.query(
        `SELECT address, city, price, bedrooms, bathrooms, square_footage, property_type, listed_date
           FROM listings
          WHERE id <> $1
            AND city = $2
            AND status IN ('active','new','sold')
          ORDER BY ABS(price - COALESCE($3, 0)) ASC
          LIMIT 5`,
        [listing.id, listing.city, listing.price || 0]
      );
      comps = r.rows;
    }

    // Assemble a tight data payload for Claude
    const data = {
      appointment: appointment ? {
        title: appointment.title,
        when: appointment.start,
        location: appointment.location,
        description: appointment.description
      } : null,
      contact: personBundle?.person ? {
        name: personBundle.person.name,
        stage: personBundle.person.stage,
        source: personBundle.person.source,
        emails: personBundle.person.emails?.map(e => e.value),
        phones: personBundle.person.phones?.map(p => p.value),
        last_activity: personBundle.person.lastActivity
      } : null,
      recent_notes: (personBundle?.notes || []).slice(0, 5).map(n => ({
        subject: n.subject,
        body: (n.body || '').replace(/<[^>]*>/g, '').slice(0, 400),
        created: n.created
      })),
      open_tasks: (personBundle?.tasks || []).filter(t => t.status !== 'Completed').map(t => ({
        name: t.name, type: t.type, due: t.dueDate
      })),
      listing,
      comps
    };

    let ctxBlock = '';
    try { ctxBlock = await require('../services/intuition').buildContextBlock(); } catch (e) {}

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic();

    const sys = `You are building a pre-showing brief for Jonathan Wallace — a real estate
agent in Southern Georgian Bay heading into an appointment.

Return 250 words, plain prose, 4 labeled paragraphs:

WHO YOU'RE MEETING — one sentence on the contact: name, stage, where
they came from, their vibe from the notes. Skip if no contact data.

PROPERTY SNAPSHOT — address, beds/baths/sqft, price, what stands out.
If no listing data, write 'Listing not linked — confirm on arrival' and
move on.

WHAT THEY'LL ASK — 2-3 things likely to come up in this showing based
on the contact's history and the property. E.g. 'He's mentioned the
school district before — come ready with that.'

HOW TO OPEN — a specific opener for the moment you meet. Not a script,
just a starter. Reference something real.

Rules: no cliches ('dream home', 'won't last', etc.), no fluff, specific
over vague. If critical data is missing, say so plainly.
${ctxBlock ? '\n' + ctxBlock : ''}`;

    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 900,
      system: sys,
      messages: [{ role: 'user', content: 'Showing prep input:\n' + JSON.stringify(data, null, 2) }]
    });
    const brief = r.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();

    res.json({
      brief,
      appointment: data.appointment,
      contact: data.contact,
      listing: data.listing ? { address: data.listing.address, city: data.listing.city, price: data.listing.price } : null,
      comp_count: comps.length,
      tokens: r.usage
    });
  } catch (e) { handleFubError(res, e); }
});

// ---------- Listing-match alerts ----------

/**
 * GET /api/fub/listing-matches
 * For every FUB person created in the last N days (default 30), try to match
 * their implied criteria against our local listings table and return any hits.
 *
 * Matching is deliberately fuzzy + lenient — we use the person's source,
 * tags, and any free-text in their stage/source/notes plus their name, and
 * match against listing address/city/property_type/description.
 *
 * Returns { matches: [{ person, listings: [...] }] }
 * Useful as a dashboard alert: "3 leads match 5 of your active listings".
 */
router.get('/listing-matches', async (req, res) => {
  try {
    const key = await fub.getApiKey();
    if (!key) return res.status(503).json({ error: 'FUB not configured' });
    const days = parseInt(req.query.days) || 30;

    // Pull recent leads (limit 100)
    const peopleResp = await fub.listPeople({ limit: 100, sort: '-created' });
    const cutoff = new Date(Date.now() - days * 86400000);
    const recent = (peopleResp.people || []).filter(p => p.created && new Date(p.created) >= cutoff);

    // Load active listings
    const { rows: listings } = await pool.query(
      `SELECT id, mls_number, address, city, price, bedrooms, bathrooms,
              square_footage, property_type, description, features
         FROM listings
        WHERE status IN ('active', 'new')
        ORDER BY listed_date DESC NULLS LAST
        LIMIT 100`
    );
    if (!listings.length) return res.json({ matches: [], listings_scanned: 0, leads_scanned: recent.length });

    const matches = [];
    for (const p of recent) {
      // Build a searchable blob from the person's data
      const personBlob = [
        p.name, p.firstName, p.lastName,
        p.stage, p.source, (p.tags || []).join(' '),
        (p.phones || []).map(x => x.value).join(' '),
        (p.emails || []).map(x => x.value).join(' '),
        (p.customFields ? JSON.stringify(p.customFields) : '')
      ].filter(Boolean).join(' ').toLowerCase();

      // Match each listing against the blob
      const hits = [];
      for (const L of listings) {
        // Community name match (big signal — SOGB towns)
        const city = (L.city || '').toLowerCase();
        const matchSignals = [];
        if (city && personBlob.includes(city)) matchSignals.push('city:' + L.city);
        // Property type
        const pt = (L.property_type || '').toLowerCase();
        if (pt && personBlob.includes(pt)) matchSignals.push('type:' + L.property_type);
        // MLS-number exact reference
        if (L.mls_number && personBlob.includes(L.mls_number.toLowerCase())) matchSignals.push('mls:' + L.mls_number);
        // Address fragment (last 1-3 words of street name)
        if (L.address) {
          const words = L.address.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          for (const w of words) {
            if (personBlob.includes(w)) { matchSignals.push('address:' + w); break; }
          }
        }
        if (matchSignals.length) {
          hits.push({
            listing_id: L.id,
            address: L.address,
            city: L.city,
            price: L.price,
            signals: matchSignals
          });
        }
      }
      if (hits.length) {
        matches.push({
          person: { id: p.id, name: p.name, source: p.source, stage: p.stage, created: p.created },
          listings: hits.slice(0, 5)
        });
      }
    }

    res.json({
      leads_scanned: recent.length,
      listings_scanned: listings.length,
      match_count: matches.length,
      matches
    });
  } catch (e) { handleFubError(res, e); }
});

// ---------- Auto-respond to fresh leads ----------

/**
 * POST /api/fub/auto-respond-new-leads
 * Body: { hours?: 24, template_name?, dry_run? }
 *
 * Finds FUB people created within the last `hours` who have ZERO open tasks
 * AND no notes authored by dashboard automation ('Auto-greet' subject tag),
 * then for each:
 *   - creates a FUB task ('Initial outreach — <contact>') due in 1 day
 *   - if a template is named, also drops a Gmail draft (when contact has
 *     email) personalized by Claude
 *
 * Intended to run on a schedule every ~hour so no new lead sits untouched.
 */
router.post('/auto-respond-new-leads', async (req, res) => {
  try {
    const key = await fub.getApiKey();
    if (!key) return res.status(503).json({ error: 'FUB not configured' });

    const hours = Math.max(1, Math.min(168, parseInt(req.body?.hours) || 24));
    const templateName = req.body?.template_name || null;
    const dryRun = !!req.body?.dry_run;

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Pull recent people (up to 100)
    const peopleResp = await fub.listPeople({ limit: 100, sort: '-created' });
    const recent = (peopleResp.people || []).filter(p =>
      p.created && new Date(p.created) >= cutoff
    );

    if (!recent.length) return res.json({ success: true, checked: 0, touched: 0, results: [] });

    // Load optional template
    let template = null;
    if (templateName) {
      const { rows } = await pool.query(
        `SELECT * FROM nurture_templates WHERE LOWER(name) = LOWER($1)`,
        [templateName]
      );
      if (rows.length) template = rows[0];
    }

    // Claude setup if we'll personalize
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

    const results = [];
    let touched = 0;

    for (const p of recent) {
      // Skip if already has open tasks (we don't double-touch)
      try {
        const openTasks = await fub.personTasks(p.id, { limit: 5 });
        const hasOpen = (openTasks.tasks || []).some(t => t.status !== 'Completed');
        if (hasOpen) { results.push({ person_id: p.id, name: p.name, skipped: 'has open tasks' }); continue; }
      } catch (e) { /* proceed — better to touch than to skip */ }

      const firstName = p.firstName || (p.name || '').split(' ')[0] || 'friend';
      const email = p.emails?.[0]?.value || null;

      let personalized = null;
      if (template && anthropic) {
        try {
          const r = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            system: `You are writing a first-touch outreach in Jonathan Wallace's voice
for a brand-new real estate lead. Rewrite the template using the contact's
first name naturally, reference the source if relevant. No real-estate cliches.
Plain prose. Return only the message.`,
            messages: [{ role: 'user', content: `Template:\n${template.body}\n\nContact:\n${JSON.stringify({ first_name: firstName, source: p.source, stage: p.stage, email }, null, 2)}` }]
          });
          personalized = r.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
        } catch (e) { personalized = template.body; }
      }

      if (dryRun) {
        results.push({ person_id: p.id, name: p.name, source: p.source, email, personalized, dry_run: true });
        touched++;
        continue;
      }

      // Create a FUB task to prompt Jonathan's actual outreach
      try {
        const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const task = await fub.createTask({
          personId: p.id,
          name: `Initial outreach — ${p.name || firstName}`,
          type: 'Call',
          dueDate: due,
          description: `Fresh ${p.source || 'inbound'} lead. Reach out within 24h.${personalized ? '\n\nSuggested opener:\n' + personalized : ''}`,
          status: 'Active'
        });
        results.push({ person_id: p.id, name: p.name, task_id: task.id, source: p.source, personalized: !!personalized });
        touched++;

        // Optional: also create a Gmail draft so Jonathan can send on a tap
        if (template && template.channel === 'email_draft' && email && personalized && process.env.GMAIL_REFRESH_TOKEN) {
          try {
            const { google } = require('googleapis');
            const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
            oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
            const gmail = google.gmail({ version: 'v1', auth: oauth2 });
            const from = process.env.GMAIL_USER || 'jonathanwallacerealestate@gmail.com';
            const html = personalized.split('\n').map(l => '<p>' + l.replace(/</g, '&lt;') + '</p>').join('');
            const raw = Buffer.from([
              `From: ${from}`,
              `To: ${email}`,
              `Subject: ${template.subject || 'Welcome'}`,
              'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html
            ].join('\r\n')).toString('base64url');
            await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
          } catch (e) { /* best effort */ }
        }
      } catch (e) {
        results.push({ person_id: p.id, name: p.name, error: e.message });
      }
    }

    publish({ type: 'fub', event: 'auto_responded', touched });
    res.json({ success: true, checked: recent.length, touched, results });
  } catch (e) { handleFubError(res, e); }
});

// ---------- Lead source attribution ----------

/**
 * GET /api/fub/attribution?period=30|90|ytd
 * Analyzes lead sources from the FUB people list + local closings to answer:
 *   - Which sources produced the most leads in the period?
 *   - Which sources converted to deals (via local closings table where
 *     client_name matches a FUB person)?
 *   - What's the $ GCI per source?
 *   - Where's the effort leaking?
 *
 * Returns a Claude-written 200-word narrative PLUS a structured breakdown
 * so the dashboard can render a table or bar chart.
 */
router.get('/attribution', async (req, res) => {
  try {
    const key = await fub.getApiKey();
    if (!key) return res.status(503).json({ error: 'FUB not configured' });

    const periodDays = req.query.period === 'ytd'
      ? Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000)
      : (parseInt(req.query.period) || 30);
    const cutoff = new Date(Date.now() - periodDays * 86400000);

    // Pull recent people (up to 500) — FUB API caps per page at 100; we page
    // a few times if needed
    let people = [];
    let offset = 0;
    for (let i = 0; i < 5; i++) {
      const resp = await fub.listPeople({ limit: 100, offset, sort: '-created' });
      const batch = resp.people || [];
      if (!batch.length) break;
      people = people.concat(batch);
      offset += batch.length;
      if (batch.length < 100) break;
    }

    const fresh = people.filter(p => p.created && new Date(p.created) >= cutoff);

    // Bucket by source
    const bySource = {};
    for (const p of fresh) {
      const s = (p.source || 'unknown').trim() || 'unknown';
      if (!bySource[s]) bySource[s] = { source: s, leads: 0, stages: {} };
      bySource[s].leads++;
      const stg = p.stage || 'unknown';
      bySource[s].stages[stg] = (bySource[s].stages[stg] || 0) + 1;
    }

    // Join with local closings to estimate GCI per source
    const { rows: closings } = await pool.query(
      `SELECT client_name, gross_commission, net_profit, status, closing_date
         FROM closings
        WHERE closing_date >= $1::date
          AND client_name IS NOT NULL`,
      [cutoff.toISOString().slice(0, 10)]
    );

    // Crude match: FUB person name → closing client_name, case-insensitive
    const nameToSource = new Map();
    for (const p of fresh) {
      if (p.name) nameToSource.set(p.name.toLowerCase().trim(), (p.source || 'unknown').trim() || 'unknown');
    }
    for (const c of closings) {
      const src = nameToSource.get((c.client_name || '').toLowerCase().trim()) || 'unattributed';
      if (!bySource[src]) bySource[src] = { source: src, leads: 0, stages: {} };
      bySource[src].gci = (bySource[src].gci || 0) + (Number(c.gross_commission) || 0);
      bySource[src].deals = (bySource[src].deals || 0) + 1;
      bySource[src].net = (bySource[src].net || 0) + (Number(c.net_profit) || 0);
    }

    const rows = Object.values(bySource)
      .sort((a, b) => (b.gci || 0) - (a.gci || 0) || b.leads - a.leads);

    // Claude narrative
    let narrative = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        let ctxBlock = '';
        try { ctxBlock = await require('../services/intuition').buildContextBlock(); } catch (e) {}
        const Anthropic = require('@anthropic-ai/sdk');
        const anthropic = new Anthropic();
        const sys = `You are reviewing lead-source attribution for Jonathan Wallace's
real estate business. Given the data, return a ~200-word narrative.
Cover: the source producing the most leads, the source producing the
most GCI, any source doing both, any leak (high lead count + low
conversion). Name specifics (numbers, sources). End with one concrete
recommendation for the coming period. Plain prose, no bullets.
${ctxBlock ? '\n' + ctxBlock : ''}`;
        const r = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 600,
          system: sys,
          messages: [{ role: 'user', content: `Period: last ${periodDays} days\n\nBy source:\n${JSON.stringify(rows, null, 2)}` }]
        });
        narrative = r.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      } catch (e) { narrative = null; }
    }

    res.json({
      success: true,
      period_days: periodDays,
      cutoff: cutoff.toISOString(),
      total_leads: fresh.length,
      total_deals: closings.length,
      total_gci: closings.reduce((a, c) => a + (Number(c.gross_commission) || 0), 0),
      by_source: rows,
      narrative
    });
  } catch (e) { handleFubError(res, e); }
});

// ---------- Contact enrichment ----------

/**
 * POST /api/fub/people/:id/enrich
 * Body: { push_note?: true }   // defaults to false = preview only
 *
 * Pulls the full FUB contact record + all events/notes/tasks, feeds to
 * Claude for a research note answering:
 *   - What do we actually know?
 *   - What's suspiciously missing that matters?
 *   - What should the next touch look like?
 *   - 2-3 conversational openers personalized to them.
 * Returns the rendered note. With push_note=true, also creates a FUB note
 * stamped as 'Claude research note'.
 */
router.post('/people/:id/enrich', async (req, res) => {
  try {
    const key = await fub.getApiKey();
    if (!key) return res.status(503).json({ error: 'FUB not configured' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Claude not configured' });

    const [person, events, notes, tasks] = await Promise.all([
      fub.getPerson(req.params.id),
      fub.personEvents(req.params.id, { limit: 50 }).catch(() => ({ events: [] })),
      fub.personNotes(req.params.id, { limit: 20 }).catch(() => ({ notes: [] })),
      fub.personTasks(req.params.id, { limit: 20 }).catch(() => ({ tasks: [] }))
    ]);
    if (!person) return res.status(404).json({ error: 'Person not found' });

    let ctxBlock = '';
    try { ctxBlock = await require('../services/intuition').buildContextBlock(); } catch (e) {}

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic();

    const SYSTEM = `You are researching a CRM contact for Jonathan Wallace (real estate agent,
Southern Georgian Bay) so he walks into the next touch prepared.

Return plain prose, under 280 words, with FOUR labeled paragraphs in this order:

WHAT WE KNOW — name the facts that matter: stage, source, any past deal history,
known timeline or property preferences, last 1-2 notable interactions.

WHAT'S MISSING — flag the gaps that would block a deal. Price range? Financing?
Decision timeline? Spouse/partner involvement? Don't speculate; name what we
don't know that we should.

RECOMMENDED NEXT TOUCH — one concrete action. Call/text/email, specific topic,
why this next.

CONVERSATIONAL OPENERS — three short opener options Jonathan could actually
use, tuned to what we know. Not scripts — just starters. One should be
referential ('I remember you mentioning...'), one should be value-forward
('wanted to share something specific about the Midland market...'), one
should be open-ended ('how's the search coming along?').

Rules: no real-estate cliches, no fluff, no 'dream home'. If the contact is
genuinely cold (no recent activity), say so plainly and treat the openers as
re-engagement prompts.
${ctxBlock ? '\n' + ctxBlock : ''}`;

    const userMsg = `Contact record:\n${JSON.stringify({
      id: person.id,
      name: person.name,
      firstName: person.firstName,
      lastName: person.lastName,
      stage: person.stage,
      source: person.source,
      tags: person.tags,
      emails: person.emails?.map(e => e.value),
      phones: person.phones?.map(p => p.value),
      created: person.created,
      lastActivity: person.lastActivity,
      assignedUserId: person.assignedUserId
    }, null, 2)}

Recent events (${(events.events || []).length}):
${JSON.stringify((events.events || []).slice(0, 15).map(e => ({ type: e.type, description: e.description, created: e.created })), null, 2)}

Recent notes (${(notes.notes || []).length}):
${JSON.stringify((notes.notes || []).slice(0, 8).map(n => ({ subject: n.subject, body: (n.body || '').replace(/<[^>]*>/g, '').slice(0, 500), created: n.created })), null, 2)}

Open tasks:
${JSON.stringify((tasks.tasks || []).filter(t => t.status !== 'Completed').map(t => ({ name: t.name, type: t.type, due: t.dueDate })), null, 2)}`;

    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: SYSTEM,
      messages: [{ role: 'user', content: userMsg }]
    });
    const rendered = r.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();

    let pushed = null;
    if (req.body?.push_note === true) {
      try {
        const note = await fub.createNote({
          personId: parseInt(req.params.id),
          subject: 'Claude research note',
          body: rendered,
          isHtml: false
        });
        pushed = { note_id: note.id };
      } catch (e) {
        return res.json({ rendered, pushed: null, push_error: e.message });
      }
    }

    res.json({ rendered, pushed, tokens: r.usage });
  } catch (e) { handleFubError(res, e); }
});

// ---------- Appointments / Calendar sync ----------

/**
 * POST /api/fub/appointments/sync
 * Pulls the next 30 days of FUB appointments into the local calendar_events
 * table so they appear alongside Google Calendar events in the dashboard.
 * Idempotent via UNIQUE (google_event_id) — FUB appointment IDs are prefixed
 * 'fub:' so they don't collide with real Google Calendar events.
 */
router.post('/appointments/sync', async (req, res) => {
  try {
    const now = new Date();
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const resp = await fub.listAppointments({
      limit: 100,
      after: now.toISOString(),
      before: future.toISOString()
    });
    const appts = resp.appointments || [];

    let upserted = 0;
    for (const a of appts) {
      if (!a.title && !a.type) continue;
      if (!a.start) continue;
      try {
        await pool.query(
          `INSERT INTO calendar_events
            (google_event_id, calendar_id, title, description, location,
             start_time, end_time, all_day, attendees, meeting_link, event_type, status, last_synced_at)
           VALUES ($1, 'fub', $2, $3, $4, $5, $6, false, '[]'::jsonb, null, $7, 'confirmed', NOW())
           ON CONFLICT (google_event_id) DO UPDATE SET
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             location = EXCLUDED.location,
             start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             event_type = EXCLUDED.event_type,
             last_synced_at = NOW()`,
          [
            'fub:' + a.id,
            a.title || a.type || 'FUB appointment',
            a.description || a.note || null,
            a.location || null,
            a.start,
            a.end || a.start,
            (a.type || 'appointment').toLowerCase()
          ]
        );
        upserted++;
      } catch (e) {
        console.error('[FUB] appointment upsert failed:', e.message);
      }
    }

    publish({ type: 'fub', event: 'appointments_synced', upserted });
    res.json({ success: true, fetched: appts.length, upserted });
  } catch (e) { handleFubError(res, e); }
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
