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
