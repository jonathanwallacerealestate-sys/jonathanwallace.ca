/**
 * Hour of Power — timed prospecting blocks with per-call recording,
 * Claude analysis, and automatic follow-up creation.
 *
 * Each call's transcript is sent to Claude which returns:
 *   summary, sentiment, jonathan's commitments, client's commitments,
 *   recommended follow-ups (with relative due dates), coaching notes.
 * Recommended follow-ups are inserted into crm_followups so nothing falls
 * through.
 *
 * At end of session we trigger a debrief that scores the whole hour.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const Anthropic = require('@anthropic-ai/sdk');
const { requireApiKey } = require('../middleware/apiKey');
const { publish } = require('../services/events');
const intuition = require('../services/intuition');

const anthropic = new Anthropic();

router.use(requireApiKey);

// GET /api/power-hour/active — currently running session if any
router.get('/active', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM power_hour_sessions
       WHERE status IN ('active','paused')
       ORDER BY started_at DESC LIMIT 1`
    );
    if (!rows.length) return res.json({ session: null });
    const calls = await pool.query(
      `SELECT * FROM power_hour_calls WHERE session_id = $1 ORDER BY started_at DESC LIMIT 50`,
      [rows[0].id]
    );
    res.json({ session: rows[0], calls: calls.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load active session' });
  }
});

// GET /api/power-hour — recent sessions
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM power_hour_sessions ORDER BY started_at DESC LIMIT 30`
    );
    res.json({ sessions: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// GET /api/power-hour/:id — full session detail with calls
router.get('/:id', async (req, res) => {
  try {
    const s = await pool.query('SELECT * FROM power_hour_sessions WHERE id = $1', [req.params.id]);
    if (!s.rows.length) return res.status(404).json({ error: 'Not found' });
    const calls = await pool.query(
      'SELECT * FROM power_hour_calls WHERE session_id = $1 ORDER BY started_at ASC',
      [req.params.id]
    );
    res.json({ session: s.rows[0], calls: calls.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load session' });
  }
});

// POST /api/power-hour/start
router.post('/start', async (req, res) => {
  try {
    // Make sure no other session is still active — close it first
    await pool.query(
      `UPDATE power_hour_sessions SET status = 'abandoned', ended_at = NOW() WHERE status IN ('active','paused')`
    );
    const minutes = parseInt(req.body.planned_duration_minutes) || 60;
    const { rows } = await pool.query(
      `INSERT INTO power_hour_sessions (planned_duration_minutes, status, notes)
       VALUES ($1, 'active', $2) RETURNING *`,
      [minutes, req.body.notes || null]
    );
    publish({ type: 'power_hour', event: 'started', session_id: rows[0].id });
    res.status(201).json({ session: rows[0] });
  } catch (err) {
    console.error('power-hour start error:', err);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// POST /api/power-hour/:id/pause / resume
router.post('/:id/pause', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE power_hour_sessions SET status = 'paused', updated_at = NOW()
       WHERE id = $1 AND status = 'active' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(400).json({ error: 'Not active' });
    res.json({ session: rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to pause' }); }
});
router.post('/:id/resume', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE power_hour_sessions SET status = 'active', updated_at = NOW()
       WHERE id = $1 AND status = 'paused' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(400).json({ error: 'Not paused' });
    res.json({ session: rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to resume' }); }
});

// POST /api/power-hour/:id/end — close the session and trigger debrief
router.post('/:id/end', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE power_hour_sessions
       SET status = 'completed', ended_at = NOW(), notes = COALESCE($2, notes)
       WHERE id = $1 AND status IN ('active','paused')
       RETURNING *`,
      [req.params.id, req.body.notes || null]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found or already ended' });

    const session = r.rows[0];
    const calls = await pool.query(
      `SELECT contact_name, summary, sentiment, outcome, follow_ups
       FROM power_hour_calls WHERE session_id = $1 ORDER BY started_at`,
      [session.id]
    );

    let debrief = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        debrief = await generateDebrief(session, calls.rows);
        await pool.query('UPDATE power_hour_sessions SET debrief = $1 WHERE id = $2', [debrief, session.id]);
      } catch (e) {
        console.error('debrief error:', e.message);
      }
    }

    publish({ type: 'power_hour', event: 'ended', session_id: session.id });
    res.json({ session: { ...session, debrief }, debrief });
  } catch (err) {
    console.error('power-hour end error:', err);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// ---------- Calls within a session ----------

// POST /api/power-hour/:id/calls — start a new call (creates a row, returns id)
router.post('/:id/calls', async (req, res) => {
  try {
    const { contact_name, contact_phone, contact_email, crm_followup_id, fub_person_id } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO power_hour_calls (session_id, contact_name, contact_phone, contact_email, crm_followup_id, fub_person_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, contact_name || null, contact_phone || null, contact_email || null,
       crm_followup_id || null, fub_person_id ? String(fub_person_id) : null]
    );
    await pool.query(
      `UPDATE power_hour_sessions SET calls_count = calls_count + 1, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.status(201).json({ call: rows[0] });
  } catch (err) {
    console.error('call create error:', err);
    res.status(500).json({ error: 'Failed to start call' });
  }
});

/**
 * GET /api/power-hour/pre-call-brief?person_id=123
 * Fetches FUB person + recent events/notes/tasks and asks Claude for a
 * 30-second read before dialing. Spoken by the browser via TTS.
 */
router.get('/pre-call-brief', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Claude not configured' });
    const personId = req.query.person_id;
    if (!personId) return res.status(400).json({ error: 'person_id required' });
    const fub = require('../services/fub');
    if (!(await fub.getApiKey())) return res.status(503).json({ error: 'FUB not configured' });

    const [person, events, notes, tasks] = await Promise.all([
      fub.getPerson(personId).catch(() => null),
      fub.personEvents(personId, { limit: 10 }).catch(() => ({ events: [] })),
      fub.personNotes(personId, { limit: 5 }).catch(() => ({ notes: [] })),
      fub.personTasks(personId, { limit: 5 }).catch(() => ({ tasks: [] }))
    ]);
    if (!person) return res.status(404).json({ error: 'Person not found in FUB' });

    const intuition = require('../services/intuition');
    const ctx = await intuition.buildContextBlock();
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic();

    const data = {
      name: person.name || [person.firstName, person.lastName].filter(Boolean).join(' '),
      email: person.emails?.[0]?.value || '',
      phone: person.phones?.[0]?.value || '',
      stage: person.stage,
      source: person.source,
      last_activity: person.lastActivity,
      recent_events: (events.events || []).map(e => ({ type: e.type, description: e.description, created: e.created })),
      recent_notes: (notes.notes || []).map(n => ({ subject: n.subject, body: (n.body || '').replace(/<[^>]*>/g, '').slice(0, 400), created: n.created })),
      open_tasks: (tasks.tasks || []).filter(t => t.status !== 'Completed').map(t => ({ name: t.name, type: t.type, due: t.dueDate }))
    };

    const sys = `You are Jonathan Wallace's call-prep coach. Given a CRM contact's recent
history, give him a 30-second spoken read BEFORE he dials. Plain prose, no
markdown, no bullet points. Under 90 words.

Cover, tightly:
1. Who they are (one line — name, stage, source).
2. The single most recent meaningful touch.
3. Any open commitments (his OR theirs) that might come up.
4. One suggested opening line for the call if something specific would land.

If nothing useful exists, say so in one sentence and suggest a discovery opener.${ctx ? '\n\n' + ctx : ''}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: sys,
      messages: [{ role: 'user', content: 'Pre-call brief for:\n' + JSON.stringify(data, null, 2) }]
    });
    const brief = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    res.json({ brief, person: data });
  } catch (err) {
    console.error('pre-call-brief error:', err);
    res.status(500).json({ error: 'Failed to build brief', message: err.message });
  }
});

// PATCH /api/power-hour/calls/:callId — update transcript / outcome / etc.
router.patch('/calls/:callId', async (req, res) => {
  try {
    const allowed = ['contact_name','contact_phone','contact_email','transcript','outcome','notes'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) {
        const col = f === 'notes' ? 'coaching_notes' : f;
        sets.push(`${col} = $${idx++}`);
        params.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    params.push(req.params.callId);
    const { rows } = await pool.query(
      `UPDATE power_hour_calls SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ call: rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to update call' }); }
});

// POST /api/power-hour/calls/:callId/end — close call, optionally analyze
router.post('/calls/:callId/end', async (req, res) => {
  try {
    const { transcript, outcome, analyze } = req.body;
    const { rows } = await pool.query(
      `UPDATE power_hour_calls SET
         ended_at = NOW(),
         duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::int,
         transcript = COALESCE($2, transcript),
         outcome = COALESCE($3, outcome)
       WHERE id = $1 RETURNING *`,
      [req.params.callId, transcript || null, outcome || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const call = rows[0];

    // Bump session counters based on outcome
    if (call.session_id) {
      const isConnected = (outcome || call.outcome) === 'connected';
      await pool.query(
        `UPDATE power_hour_sessions SET
           connected_count = connected_count + $2,
           updated_at = NOW()
         WHERE id = $1`,
        [call.session_id, isConnected ? 1 : 0]
      );
    }

    // Always log to activity_log so daily counters reflect the call
    await pool.query(
      `INSERT INTO activity_log
        (activity_type, contact_name, contact_phone, contact_email, duration_seconds, outcome, source, related_session_id, related_call_id)
       VALUES ('call', $1, $2, $3, $4, $5, 'power_hour', $6, $7)`,
      [call.contact_name, call.contact_phone, call.contact_email,
       call.duration_seconds, call.outcome, call.session_id, call.id]
    );

    let analysis = null;
    if (analyze && process.env.ANTHROPIC_API_KEY && call.transcript) {
      analysis = await analyzeCall(call);
    }

    res.json({ call: rows[0], analysis });
  } catch (err) {
    console.error('call end error:', err);
    res.status(500).json({ error: 'Failed to end call' });
  }
});

// POST /api/power-hour/calls/:callId/analyze — explicit analyze trigger
router.post('/calls/:callId/analyze', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Claude not configured' });
    const { rows } = await pool.query('SELECT * FROM power_hour_calls WHERE id = $1', [req.params.callId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const call = rows[0];
    if (!call.transcript || call.transcript.trim().length < 20) {
      return res.status(400).json({ error: 'No transcript to analyze' });
    }
    const analysis = await analyzeCall(call);
    res.json({ analysis });
  } catch (err) {
    console.error('call analyze error:', err);
    res.status(500).json({ error: 'Failed to analyze call', message: err.message });
  }
});

// ---------- Claude helpers ----------

const CALL_ANALYSIS_PROMPT = `You are reviewing a recorded prospecting call between Jonathan Wallace (real
estate agent in Southern Georgian Bay, Ontario) and a contact. Jonathan was on
speakerphone, so the transcript may have noise / overlap.

Return JSON ONLY with this exact schema:
{
  "summary": "<2-3 sentence neutral summary>",
  "sentiment": "cold|warm|hot",
  "outcome": "connected|voicemail|no_answer|callback_requested|appointment_set|not_interested|wrong_number",
  "jonathan_commitments": ["<thing he said he would do>"],
  "client_commitments":   ["<thing they said they would do>"],
  "follow_ups": [
    { "type": "call|email|text|meeting|loo|cma", "subject": "...", "due_in_days": 1, "notes": "..." }
  ],
  "coaching_notes": "<1-2 specific observations: opening, listening, framing, ask. Keep it short and useful.>"
}

Rules:
- Only suggest follow-ups that map to something the call actually established.
- due_in_days is relative to today.
- Never invent details. If sentiment is unclear default to "warm".
- Coaching notes should sound like a peer, not a manager. No platitudes.`;

async function analyzeCall(call) {
  const ctx = await intuition.buildContextBlock();
  const userMsg = `Contact: ${call.contact_name || '(unknown)'}\nDuration: ${call.duration_seconds || '?'}s\n\nTranscript:\n${call.transcript}`;
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1200,
    system: ctx ? `${CALL_ANALYSIS_PROMPT}\n\n${ctx}` : CALL_ANALYSIS_PROMPT,
    messages: [{ role: 'user', content: userMsg }]
  });
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  let parsed;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch (e) {
    throw new Error('Could not parse Claude analysis JSON');
  }

  // Persist analysis on the call
  await pool.query(
    `UPDATE power_hour_calls SET
       summary = $1,
       sentiment = $2,
       outcome = COALESCE($3, outcome),
       jonathan_commitments = $4::jsonb,
       client_commitments = $5::jsonb,
       follow_ups = $6::jsonb,
       coaching_notes = $7,
       analyzed_at = NOW()
     WHERE id = $8`,
    [parsed.summary || null, parsed.sentiment || null, parsed.outcome || null,
     JSON.stringify(parsed.jonathan_commitments || []),
     JSON.stringify(parsed.client_commitments || []),
     JSON.stringify(parsed.follow_ups || []),
     parsed.coaching_notes || null, call.id]
  );

  // Auto-create CRM follow-ups so nothing falls through
  const created = [];
  for (const fu of (parsed.follow_ups || [])) {
    if (!fu.subject) continue;
    try {
      const due = fu.due_in_days != null
        ? new Date(Date.now() + Number(fu.due_in_days) * 86400000).toISOString().slice(0, 10)
        : null;
      const ins = await pool.query(
        `INSERT INTO crm_followups (contact_name, contact_phone, contact_email,
            fub_person_id, follow_up_type, due_date, notes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'open') RETURNING id`,
        [call.contact_name, call.contact_phone, call.contact_email,
         call.fub_person_id || null,
         fu.type || 'call', due, [fu.subject, fu.notes].filter(Boolean).join(' — ')]
      );
      created.push(ins.rows[0].id);
    } catch (e) { /* best effort */ }
  }

  // If this call is linked to a FUB contact, push a summary note + the
  // follow-ups into FUB so they live in the source of truth.
  const fubPushed = { note_id: null, task_ids: [] };
  if (call.fub_person_id) {
    try {
      const fub = require('../services/fub');
      const apiKey = await fub.getApiKey();
      if (apiKey) {
        // Build a clean note body from the analysis
        const noteLines = [];
        if (parsed.summary) noteLines.push(parsed.summary);
        if ((parsed.jonathan_commitments || []).length) {
          noteLines.push('\nMy commitments:');
          parsed.jonathan_commitments.forEach(x => noteLines.push('  - ' + x));
        }
        if ((parsed.client_commitments || []).length) {
          noteLines.push('\nTheir commitments:');
          parsed.client_commitments.forEach(x => noteLines.push('  - ' + x));
        }
        if (parsed.coaching_notes) noteLines.push('\nReflection: ' + parsed.coaching_notes);
        noteLines.push('\n— Logged automatically by dashboard Hour of Power');

        const subject = `Call ${call.duration_seconds ? '(' + Math.round(call.duration_seconds/60) + ' min) ' : ''}— ${parsed.sentiment || 'logged'}`;
        try {
          const note = await fub.createNote({
            personId: parseInt(call.fub_person_id),
            subject,
            body: noteLines.join('\n'),
            isHtml: false
          });
          fubPushed.note_id = note.id;
        } catch (e) { console.error('[FUB] note push failed:', e.message); }

        // Create a FUB task for each follow-up
        for (const fu of (parsed.follow_ups || [])) {
          if (!fu.subject) continue;
          try {
            const due = fu.due_in_days != null
              ? new Date(Date.now() + Number(fu.due_in_days) * 86400000).toISOString()
              : undefined;
            const t = await fub.createTask({
              personId: parseInt(call.fub_person_id),
              name: fu.subject,
              type: mapFollowupType(fu.type),
              dueDate: due,
              description: fu.notes || undefined,
              status: 'Active'
            });
            fubPushed.task_ids.push(t.id);
          } catch (e) { console.error('[FUB] task push failed:', e.message); }
        }

        if (fubPushed.note_id || fubPushed.task_ids.length) {
          await pool.query(
            `UPDATE power_hour_calls SET pushed_to_fub_at = NOW() WHERE id = $1`,
            [call.id]
          );
        }
      }
    } catch (e) {
      console.error('[FUB] push-analysis error:', e.message);
    }
  }

  return { ...parsed, created_followup_ids: created, fub_pushed: fubPushed, tokens: response.usage };
}

// Map our analysis follow-up types into FUB's Task type enum
function mapFollowupType(t) {
  const m = {
    call: 'Call', phone: 'Call',
    email: 'Email',
    text: 'Text', sms: 'Text',
    meeting: 'Meeting',
    showing: 'Showing',
    loo: 'Other', cma: 'Other'
  };
  return m[(t || '').toLowerCase()] || 'Other';
}

const DEBRIEF_PROMPT = `You are coaching Jonathan after his Hour of Power prospecting block.
Use the per-call summaries to write a 4-bullet debrief in plain prose
(not markdown). Bullets in this order:

1. WHAT WORKED — name a specific moment / behaviour.
2. WHAT TO REFINE — single concrete adjustment.
3. FOLLOW-UP PLAN — the highest-leverage next action across all the calls.
4. ENERGY READ — one short sentence on confidence / pacing observed in the
   transcripts. Honest, not flattering.

Under 180 words total. Speak peer-to-peer.`;

async function generateDebrief(session, calls) {
  const ctx = await intuition.buildContextBlock();
  const summary = {
    duration_planned_minutes: session.planned_duration_minutes,
    duration_actual_seconds: session.ended_at && session.started_at
      ? Math.round((new Date(session.ended_at) - new Date(session.started_at)) / 1000)
      : null,
    calls_made: session.calls_count,
    connected: session.connected_count,
    per_call: calls.map(c => ({
      contact: c.contact_name,
      sentiment: c.sentiment,
      outcome: c.outcome,
      summary: c.summary,
      follow_ups: c.follow_ups
    }))
  };
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    system: ctx ? `${DEBRIEF_PROMPT}\n\n${ctx}` : DEBRIEF_PROMPT,
    messages: [{ role: 'user', content: 'Hour of Power debrief:\n' + JSON.stringify(summary, null, 2) }]
  });
  return response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

module.exports = router;
