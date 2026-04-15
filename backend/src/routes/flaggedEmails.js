const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

// GET /api/emails — list flagged emails (default: needs_reply)
router.get('/', async (req, res) => {
  try {
    const { status = 'needs_reply', limit = 50 } = req.query;
    const { rows } = await pool.query(
      `SELECT * FROM flagged_emails
       WHERE ($1 = 'all' OR status = $1)
       ORDER BY
         CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         received_at DESC NULLS LAST
       LIMIT $2`,
      [status, Math.min(parseInt(limit) || 50, 200)]
    );
    res.json({ emails: rows, count: rows.length });
  } catch (err) {
    console.error('flagged_emails list error:', err);
    res.status(500).json({ error: 'Failed to list emails' });
  }
});

// POST /api/emails — create or upsert a flagged email (called by Make.com when an important email arrives)
router.post('/', async (req, res) => {
  try {
    const {
      gmail_message_id, thread_id, from_address, from_name,
      subject, snippet, received_at, priority, status, labels, tag
    } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO flagged_emails
        (gmail_message_id, thread_id, from_address, from_name, subject, snippet, received_at, priority, status, labels, tag)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8,'normal'), COALESCE($9,'needs_reply'), COALESCE($10,'[]')::jsonb, $11)
       ON CONFLICT (gmail_message_id) DO UPDATE SET
         subject = EXCLUDED.subject,
         snippet = EXCLUDED.snippet,
         priority = EXCLUDED.priority,
         status = EXCLUDED.status,
         labels = EXCLUDED.labels,
         tag = EXCLUDED.tag
       RETURNING *`,
      [gmail_message_id || null, thread_id || null, from_address || null, from_name || null,
       subject || null, snippet || null, received_at || null, priority, status,
       labels ? JSON.stringify(labels) : null, tag || null]
    );
    res.status(201).json({ email: rows[0] });
  } catch (err) {
    console.error('flagged_emails create error:', err);
    res.status(500).json({ error: 'Failed to flag email' });
  }
});

// PATCH /api/emails/:id — mark as handled, snooze, re-prioritize
router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['priority','status','tag','assigned_to'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) { sets.push(`${f} = $${idx++}`); params.push(req.body[f]); }
    }
    if (req.body.status === 'handled') sets.push(`handled_at = NOW()`);
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE flagged_emails SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ email: rows[0] });
  } catch (err) {
    console.error('flagged_emails update error:', err);
    res.status(500).json({ error: 'Failed to update email' });
  }
});

// DELETE /api/emails/:id
router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM flagged_emails WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

/**
 * POST /api/emails/:id/draft-reply
 * Body: { instructions?, log_to_fub?: true }
 *
 * Claude reads the flagged email, pulls FUB context on the sender if any,
 * drafts a reply in Jonathan's voice, creates a Gmail draft, and (unless
 * log_to_fub=false) logs a 'Drafted reply' note against the sender in FUB.
 */
router.post('/:id/draft-reply', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Claude not configured' });
    if (!process.env.GMAIL_REFRESH_TOKEN) return res.status(503).json({ error: 'Gmail not configured' });

    const { rows } = await pool.query('SELECT * FROM flagged_emails WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const email = rows[0];
    if (!email.from_address) return res.status(400).json({ error: 'Email has no sender address' });

    // Pull FUB context on sender if available
    const fub = require('../services/fub');
    let fubContext = null;
    try {
      const key = await fub.getApiKey();
      if (key) {
        const person = await fub.findPersonByEmail(email.from_address);
        if (person) {
          const [events, notes] = await Promise.all([
            fub.personEvents(person.id, { limit: 10 }).catch(() => ({ events: [] })),
            fub.personNotes(person.id, { limit: 5 }).catch(() => ({ notes: [] }))
          ]);
          fubContext = {
            person_id: person.id,
            name: person.name,
            stage: person.stage,
            source: person.source,
            recent_events: (events.events || []).slice(0, 5).map(e => ({ type: e.type, description: (e.description || '').slice(0, 150) })),
            recent_notes: (notes.notes || []).slice(0, 3).map(n => ({ subject: n.subject, body: (n.body || '').replace(/<[^>]*>/g, '').slice(0, 300) }))
          };
        }
      }
    } catch (e) { /* FUB context is optional */ }

    // Intuition
    const intuition = require('../services/intuition');
    let ctxBlock = '';
    try { ctxBlock = await intuition.buildContextBlock(); } catch (e) {}

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic();

    const sys = `You are drafting a reply to an email from Jonathan Wallace's voice
(real estate agent, Southern Georgian Bay). Return ONLY the reply body
— no subject line, no greeting fluff, no quoted original.

Rules:
- Reference the CRM context if present (stage, source, recent notes) to
  match the relationship.
- Plain prose, no markdown.
- Under 150 words unless the email explicitly requires detail.
- No real-estate cliches ('won't last', 'dream home', etc.)
- Sign off 'Jonathan' or leave it to the email signature
- If critical info is missing to answer, ask for it directly in one line

${ctxBlock ? '\n' + ctxBlock : ''}`;

    const userMsg = `Incoming email:
From: ${email.from_name ? email.from_name + ' <' + email.from_address + '>' : email.from_address}
Subject: ${email.subject || '(no subject)'}
Received: ${email.received_at}
Body / snippet:
${email.snippet || '(no body captured)'}

${fubContext ? 'CRM context on this sender (Follow Up Boss):\n' + JSON.stringify(fubContext, null, 2) : 'Sender is not in FUB.'}

${req.body?.instructions ? '\nAdditional instruction from Jonathan: ' + req.body.instructions : ''}`;

    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: sys,
      messages: [{ role: 'user', content: userMsg }]
    });
    const reply = r.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();

    // Create Gmail draft
    const { google } = require('googleapis');
    const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
    oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });

    const from = process.env.GMAIL_USER || 'jonathanwallacerealestate@gmail.com';
    const subj = email.subject?.toLowerCase().startsWith('re:') ? email.subject : ('Re: ' + (email.subject || '(no subject)'));
    const html = reply.split('\n').map(l => '<p>' + l.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>').join('');
    const rawHeaders = [
      `From: ${from}`,
      `To: ${email.from_address}`,
      `Subject: ${subj}`
    ];
    if (email.gmail_message_id) {
      rawHeaders.push(`In-Reply-To: <${email.gmail_message_id}>`);
      rawHeaders.push(`References: <${email.gmail_message_id}>`);
    }
    rawHeaders.push('MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html);
    const raw = Buffer.from(rawHeaders.join('\r\n')).toString('base64url');

    const draftResp = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw, threadId: email.thread_id || undefined } }
    });

    // Log to FUB if requested and context exists
    let fub_logged = false;
    if (req.body?.log_to_fub !== false && fubContext?.person_id) {
      try {
        await fub.createNote({
          personId: fubContext.person_id,
          subject: 'Drafted email reply',
          body: `Re: ${email.subject || '(no subject)'}\n\n${reply}\n\n(Draft saved to Gmail — review and send when ready.)`,
          isHtml: false
        });
        fub_logged = true;
      } catch (e) { /* best effort */ }
    }

    res.json({
      success: true,
      reply,
      draft_id: draftResp.data.id,
      fub_person_id: fubContext?.person_id || null,
      fub_logged,
      tokens: r.usage
    });
  } catch (err) {
    console.error('draft-reply error:', err);
    res.status(500).json({ error: 'Failed to draft reply', message: err.message });
  }
});

module.exports = router;
