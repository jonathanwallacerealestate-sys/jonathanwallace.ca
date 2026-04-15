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

/**
 * POST /api/emails/poll
 * Triggers an active Gmail poll — called by the scheduler + manually.
 * Returns 503 when Gmail is not configured so the UI can guide the user
 * to fix it, rather than showing a confusing "0 scanned" success.
 */
router.post('/poll', async (req, res) => {
  try {
    const { pollInbox } = require('../services/emailPoller');
    const result = await pollInbox({
      days: Math.min(Math.max(parseInt(req.body?.days) || 7, 1), 30),
      maxMessages: Math.min(Math.max(parseInt(req.body?.max) || 40, 1), 100)
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('email poll error:', err);
    if (err.code === 'GMAIL_NOT_CONFIGURED') {
      return res.status(503).json({
        error: 'gmail_not_configured',
        message: err.message,
        fix_url: '/api/emails/diag'
      });
    }
    // Detect scope / permission errors from Gmail API
    const msg = err.message || '';
    if (/insufficient\s*auth|insufficient\s*permission|Precondition|invalid_grant|scope/i.test(msg)) {
      return res.status(503).json({
        error: 'gmail_scope_or_token_invalid',
        message: msg,
        fix: 'Re-mint your Gmail refresh token with scope https://www.googleapis.com/auth/gmail.modify (it covers read, send, compose, label). Update GMAIL_REFRESH_TOKEN in Railway → Variables. Instructions in HANDOFF.md §5.',
        fix_url: '/api/emails/diag'
      });
    }
    res.status(500).json({ error: 'Poll failed', message: msg });
  }
});

/**
 * GET /api/emails/diag
 * Self-diagnostic: are env vars set? can we auth? can we read the inbox?
 * Returns a structured report the UI can display as a fix-it checklist.
 * Never 500s — always returns a 200 with { ok, report }.
 */
router.get('/diag', async (req, res) => {
  try {
    const gmailSvc = require('../services/gmail');
    const report = await gmailSvc.diagnose();
    const ok = !!(report.can_auth && report.can_list_inbox && report.can_read_message && !report.error);
    res.json({ ok, report });
  } catch (err) {
    res.json({ ok: false, report: { error: err.message, fix: 'See Railway logs.' } });
  }
});

/**
 * POST /api/emails/nudge
 * Scans for unresponded emails >24h with attachments or high priority and
 * creates/updates personal_tasks for each one so they surface on the dashboard.
 * Also stamps nudge_sent_at to avoid re-nudging.
 */
router.post('/nudge', async (req, res) => {
  try {
    const { findNudgeCandidates } = require('../services/emailPoller');
    const candidates = await findNudgeCandidates({
      minHoursWaiting: parseInt(req.body?.min_hours) || 24
    });

    let nudged = 0;
    const nudges = [];
    for (const e of candidates) {
      const senderLabel = e.from_name || e.from_address || 'unknown sender';
      const ageHours = Math.round((Date.now() - new Date(e.received_at).getTime()) / 3600000);
      const attachmentNote = e.has_attachment
        ? ` (attachment${Array.isArray(e.attachment_names) && e.attachment_names.length > 1 ? 's' : ''}: ${Array.isArray(e.attachment_names) ? e.attachment_names.slice(0, 2).join(', ') : ''})`
        : '';
      const priorityNote = e.ai_priority === 'urgent' ? ' — URGENT' : (e.ai_priority === 'high' ? ' — high priority' : '');

      const title = `Reply to ${senderLabel}: ${e.subject || '(no subject)'}${priorityNote}`;
      const notes = `${ageHours}h since received${attachmentNote}.${e.ai_summary ? '\n\n' + e.ai_summary : ''}${e.ai_suggested_action ? '\n\nSuggested action: ' + e.ai_suggested_action : ''}${e.gmail_web_link ? '\n\nOpen: ' + e.gmail_web_link : ''}`;

      // Upsert a personal_task for this email — external_id keeps it unique
      const extId = 'email_nudge:' + e.id;
      await pool.query(
        `INSERT INTO personal_tasks (title, notes, category, priority, due_date, source, external_id)
         VALUES ($1, $2, 'email', $3, CURRENT_DATE, 'ea_nudge', $4)
         ON CONFLICT (external_id) DO UPDATE SET
           title = EXCLUDED.title,
           notes = EXCLUDED.notes,
           priority = EXCLUDED.priority,
           updated_at = NOW()`,
        [title.slice(0, 250), notes.slice(0, 2000),
         e.ai_priority === 'urgent' ? 5 : (e.ai_priority === 'high' ? 4 : 3),
         extId]
      ).catch(() => {/* table may lack unique constraint on external_id; fallback below */});

      // Fallback insert if upsert above silently no-oped for old schemas
      try {
        const exists = await pool.query('SELECT id FROM personal_tasks WHERE external_id = $1', [extId]);
        if (!exists.rows.length) {
          await pool.query(
            `INSERT INTO personal_tasks (title, notes, category, priority, due_date, source, external_id)
             VALUES ($1, $2, 'email', $3, CURRENT_DATE, 'ea_nudge', $4)`,
            [title.slice(0, 250), notes.slice(0, 2000),
             e.ai_priority === 'urgent' ? 5 : 4, extId]
          );
        }
      } catch (e2) { /* best effort */ }

      // Stamp nudge_sent_at
      await pool.query(
        `UPDATE flagged_emails SET nudge_sent_at = NOW() WHERE id = $1`,
        [e.id]
      );
      nudges.push({ email_id: e.id, from: senderLabel, subject: e.subject });
      nudged++;
    }
    res.json({ success: true, checked: candidates.length, nudged, nudges });
  } catch (err) {
    console.error('email nudge error:', err);
    res.status(500).json({ error: 'Nudge failed', message: err.message });
  }
});

/**
 * GET /api/emails/:id/open — returns the Gmail web link (or 404)
 */
router.get('/:id/open', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT gmail_web_link, thread_id FROM flagged_emails WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    let link = rows[0].gmail_web_link;
    if (!link && rows[0].thread_id) {
      link = `https://mail.google.com/mail/u/0/#inbox/${rows[0].thread_id}`;
    }
    res.json({ url: link });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

/**
 * POST /api/emails/:id/apply-label   Body: { label? }  (uses ai_suggested_label if omitted)
 */
router.post('/:id/apply-label', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT gmail_message_id, ai_suggested_label FROM flagged_emails WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const msgId = rows[0].gmail_message_id;
    if (!msgId) return res.status(400).json({ error: 'No gmail_message_id on record' });
    const label = (req.body?.label || rows[0].ai_suggested_label || '').trim();
    if (!label) return res.status(400).json({ error: 'No label provided and no ai_suggested_label' });
    const gmail = require('../services/gmail');
    const result = await gmail.applyLabel(msgId, label);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('apply-label error:', err);
    res.status(err.code === 'GMAIL_NOT_CONFIGURED' ? 503 : 500).json({
      error: 'Failed to apply label', message: err.message
    });
  }
});

/**
 * POST /api/emails/:id/archive — archives in Gmail (removes INBOX label)
 * AND marks the local row as handled.
 */
router.post('/:id/archive', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT gmail_message_id FROM flagged_emails WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const msgId = rows[0].gmail_message_id;
    if (msgId) {
      try { await require('../services/gmail').archiveMessage(msgId); }
      catch (e) { if (e.code !== 'GMAIL_NOT_CONFIGURED') throw e; }
    }
    await pool.query(
      `UPDATE flagged_emails SET status = 'handled', handled_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('archive error:', err);
    res.status(500).json({ error: 'Archive failed', message: err.message });
  }
});

/**
 * POST /api/emails/:id/snooze  Body: { hours }
 */
router.post('/:id/snooze', async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(336, parseInt(req.body?.hours) || 24));
    const { rows } = await pool.query(
      `UPDATE flagged_emails
       SET snoozed_until = NOW() + ($1 || ' hours')::interval,
           status = 'snoozed'
       WHERE id = $2 RETURNING snoozed_until`,
      [String(hours), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, snoozed_until: rows[0].snoozed_until });
  } catch (err) {
    res.status(500).json({ error: 'Snooze failed' });
  }
});

module.exports = router;
