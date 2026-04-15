/**
 * Active Gmail poller — runs on a schedule, pulls recent messages, triages
 * with Claude, detects thread reply state, and upserts into flagged_emails.
 *
 * Key tricks:
 *   - For each new (to us) Gmail message, pull its FULL parsed body so
 *     Claude can triage it properly.
 *   - For each thread, check whether Jonathan has replied (from:me inside
 *     the thread). If the LAST message in the thread is from Jonathan,
 *     mark status=handled + stamp my_last_reply_at.
 *   - If last message is from someone else and we already stamped
 *     my_last_reply_at, leave the row alone (they're the one waiting).
 *   - Skip messages labeled SENT, DRAFT, SPAM, TRASH.
 *   - Skip already-handled messages unless a new reply came in.
 */
const pool = require('../db/pool');
const gmail = require('./gmail');
const triage = require('./emailTriage');

const MY_ADDRESS = (process.env.GMAIL_USER || 'jonathanwallacerealestate@gmail.com').toLowerCase();

async function pollInbox({ days = 7, maxMessages = 40 } = {}) {
  if (!gmail.isConfigured()) {
    const err = new Error('Gmail not configured: set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in Railway → Variables (and the refresh token needs gmail.modify scope).');
    err.code = 'GMAIL_NOT_CONFIGURED';
    throw err;
  }

  // Only pull threads where the latest activity is recent. 'in:inbox' excludes
  // archived threads so we don't re-triage ancient archived mail.
  const query = `in:inbox -in:trash -in:spam newer_than:${days}d`;
  const list = await gmail.listMessageIds({ query, maxResults: maxMessages });

  let scanned = 0, inserted = 0, updated = 0, triaged = 0, skipped = 0;
  const errors = [];

  for (const ref of list) {
    try {
      scanned++;
      const msg = await gmail.getMessage(ref.id);

      // Skip if sender IS me (this is a sent message caught by newer_than filter)
      const senderAddr = msg.headers?.fromAddress;
      if (!senderAddr || senderAddr === MY_ADDRESS) { skipped++; continue; }

      // Check thread state: who sent the LAST message? Did I reply somewhere?
      let myLastReplyAt = null;
      try {
        const thread = await gmail.getThread(msg.threadId);
        for (const m of thread.messages) {
          const addr = m.headers?.fromAddress;
          if (addr === MY_ADDRESS && m.internalDate) {
            if (!myLastReplyAt || m.internalDate > myLastReplyAt) myLastReplyAt = m.internalDate;
          }
        }
      } catch (e) { /* thread metadata can fail; continue */ }

      // Determine if this is a fresh send from the contact AFTER my last reply
      const msgDate = msg.internalDate;
      const needsMyAttention = !myLastReplyAt || (msgDate && msgDate > myLastReplyAt);

      // Already-tracked in flagged_emails?
      const existing = await pool.query(
        `SELECT id, status, analyzed_category FROM (
           SELECT id, status, ai_category AS analyzed_category FROM flagged_emails
           WHERE gmail_message_id = $1
         ) t`,
        [msg.id]
      );

      let rowId = existing.rows[0]?.id;
      let wasNew = !rowId;
      let triageResult = null;

      // Only triage if:
      //   - Brand new to us (first time seeing it), OR
      //   - We've never triaged it (ai_category null)
      if ((wasNew || !existing.rows[0]?.analyzed_category) && needsMyAttention) {
        try {
          triageResult = await triage.triage(msg, { fubContext: null });
          triaged++;
        } catch (e) {
          errors.push({ id: msg.id, stage: 'triage', error: e.message });
        }
      }

      const hasAttachment = (msg.attachments || []).length > 0;
      const attachNames = (msg.attachments || []).map(a => a.name);
      const webLink = gmail.threadWebLink(msg.threadId);

      // Decide status
      let status;
      if (myLastReplyAt && (!msgDate || msgDate <= myLastReplyAt)) {
        status = 'handled';
      } else if (triageResult?.needs_reply === false) {
        status = 'informational';
      } else {
        status = 'needs_reply';
      }

      if (wasNew) {
        await pool.query(
          `INSERT INTO flagged_emails
            (gmail_message_id, thread_id, from_address, from_name, subject, snippet,
             received_at, priority, status, has_attachment, attachment_names,
             ai_category, ai_priority, ai_summary, ai_suggested_action,
             ai_suggested_label, my_last_reply_at, gmail_web_link, source_ingest, labels)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,'poller','[]'::jsonb)
           ON CONFLICT (gmail_message_id) DO NOTHING`,
          [
            msg.id, msg.threadId, senderAddr, msg.headers?.fromName || null,
            msg.headers?.subject || null, (msg.snippet || '').slice(0, 600),
            msg.internalDate,
            triageResult?.priority || 'normal',
            status,
            hasAttachment, JSON.stringify(attachNames),
            triageResult?.category || null,
            triageResult?.priority || null,
            triageResult?.summary || null,
            triageResult?.suggested_action || null,
            triageResult?.suggested_label || null,
            myLastReplyAt || null,
            webLink
          ]
        );
        inserted++;
      } else {
        // Update status + attachment + last-reply tracking; only rewrite AI fields
        // if we just triaged
        const sets = [
          'thread_id = $1', 'from_name = COALESCE($2, from_name)',
          'subject = COALESCE($3, subject)', 'snippet = COALESCE($4, snippet)',
          'has_attachment = $5', 'attachment_names = $6::jsonb',
          'status = $7', 'my_last_reply_at = $8', 'gmail_web_link = $9'
        ];
        const params = [
          msg.threadId, msg.headers?.fromName || null,
          msg.headers?.subject || null, (msg.snippet || '').slice(0, 600),
          hasAttachment, JSON.stringify(attachNames),
          status, myLastReplyAt || null, webLink
        ];
        if (triageResult) {
          sets.push(
            `ai_category = $${params.length + 1}`,
            `ai_priority = $${params.length + 2}`,
            `ai_summary  = $${params.length + 3}`,
            `ai_suggested_action = $${params.length + 4}`,
            `ai_suggested_label  = $${params.length + 5}`,
            `priority = $${params.length + 6}`
          );
          params.push(triageResult.category, triageResult.priority,
                      triageResult.summary, triageResult.suggested_action,
                      triageResult.suggested_label, triageResult.priority);
        }
        params.push(rowId);
        await pool.query(
          `UPDATE flagged_emails SET ${sets.join(', ')} WHERE id = $${params.length}`,
          params
        );
        updated++;
      }
    } catch (e) {
      errors.push({ id: ref.id, stage: 'upsert', error: e.message });
    }
  }

  return { scanned, inserted, updated, triaged, skipped, errors: errors.slice(0, 5) };
}

/**
 * EA nudge scan — find emails still flagged needs_reply that:
 *   - have been sitting 24h+ since received
 *   - have an attachment OR priority >= high
 *   - haven't been nudged in the last 12 hours
 * Returns the set worth nudging. Caller decides delivery channel.
 */
async function findNudgeCandidates({ minHoursWaiting = 24 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM flagged_emails
     WHERE status = 'needs_reply'
       AND (snoozed_until IS NULL OR snoozed_until < NOW())
       AND received_at < NOW() - ($1 || ' hours')::interval
       AND (has_attachment = TRUE OR ai_priority IN ('urgent', 'high'))
       AND (nudge_sent_at IS NULL OR nudge_sent_at < NOW() - INTERVAL '12 hours')
     ORDER BY
       CASE ai_priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
       has_attachment DESC,
       received_at ASC
     LIMIT 20`,
    [String(minHoursWaiting)]
  );
  return rows;
}

module.exports = { pollInbox, findNudgeCandidates };
