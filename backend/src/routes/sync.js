/**
 * Sync endpoints — receive pushes from Make.com scenarios that pull from
 * Follow-Up Boss, Gmail, Google Calendar, etc. and forward into the dashboard.
 *
 * Each endpoint is idempotent (uses upsert) so Make can safely replay batches.
 * All endpoints require the X-API-Key header.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

// Shared utility: log raw webhook payload for audit + replay
async function logWebhook(endpoint, payload, status, response) {
  try {
    await pool.query(
      `INSERT INTO webhook_logs (endpoint, method, payload, response_status, response_body)
       VALUES ($1, 'POST', $2::jsonb, $3, $4::jsonb)`,
      [endpoint, JSON.stringify(payload).slice(0, 100000), status, JSON.stringify(response)]
    );
  } catch (e) { /* swallow logging errors */ }
}

/**
 * POST /api/sync/follow-up-boss
 * Make.com scenario listens to FUB webhooks and forwards normalized person/event data.
 * Accepts either a single object or { followups: [...] } batch.
 */
router.post('/follow-up-boss', async (req, res) => {
  try {
    const items = Array.isArray(req.body)
      ? req.body
      : req.body.followups || [req.body];
    let upserted = 0;
    for (const f of items) {
      if (!f) continue;
      await pool.query(
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
           updated_at = NOW()`,
        [f.fub_person_id || f.person_id || null,
         f.fub_event_id || f.event_id || f.id || null,
         f.contact_name || f.name || null,
         f.contact_email || f.email || null,
         f.contact_phone || f.phone || null,
         f.stage || null, f.lead_source || f.source || null,
         f.follow_up_type || f.type || null,
         f.due_date || null, f.notes || null, f.status,
         f.last_activity_at || f.updated_at || null]
      );
      upserted++;
    }
    const result = { success: true, upserted, source: 'follow-up-boss' };
    await logWebhook('/api/sync/follow-up-boss', req.body, 200, result);
    res.json(result);
  } catch (err) {
    console.error('FUB sync error:', err);
    res.status(500).json({ error: 'FUB sync failed', message: err.message });
  }
});

/**
 * POST /api/sync/gmail
 * Make.com "Gmail — watch emails" scenario calls this when an inbox message
 * matches the "needs attention" filter (starred, label:follow-up, from-client, etc.).
 */
router.post('/gmail', async (req, res) => {
  try {
    const items = Array.isArray(req.body)
      ? req.body
      : req.body.emails || [req.body];
    let upserted = 0;
    for (const e of items) {
      if (!e || !e.gmail_message_id) continue;
      await pool.query(
        `INSERT INTO flagged_emails
          (gmail_message_id, thread_id, from_address, from_name, subject, snippet,
           received_at, priority, status, labels, tag)
         VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8,'normal'), COALESCE($9,'needs_reply'),
                 COALESCE($10,'[]')::jsonb, $11)
         ON CONFLICT (gmail_message_id) DO UPDATE SET
           subject = EXCLUDED.subject,
           snippet = EXCLUDED.snippet,
           priority = EXCLUDED.priority,
           status = EXCLUDED.status,
           labels = EXCLUDED.labels,
           tag = EXCLUDED.tag`,
        [e.gmail_message_id, e.thread_id || null,
         e.from_address || e.from || null, e.from_name || null,
         e.subject || null, e.snippet || e.preview || null,
         e.received_at || e.date || null,
         e.priority, e.status,
         e.labels ? JSON.stringify(e.labels) : null,
         e.tag || null]
      );
      upserted++;
    }
    const result = { success: true, upserted, source: 'gmail' };
    await logWebhook('/api/sync/gmail', req.body, 200, result);
    res.json(result);
  } catch (err) {
    console.error('Gmail sync error:', err);
    res.status(500).json({ error: 'Gmail sync failed', message: err.message });
  }
});

/**
 * POST /api/sync/calendar
 * Called from Make.com "Google Calendar — search events" scenario each morning
 * (and on change events) to hydrate the daily calendar view.
 */
router.post('/calendar', async (req, res) => {
  try {
    const items = Array.isArray(req.body)
      ? req.body
      : req.body.events || [req.body];
    let upserted = 0;
    for (const e of items) {
      if (!e || !e.title || !e.start_time) continue;
      await pool.query(
        `INSERT INTO calendar_events
          (google_event_id, calendar_id, title, description, location,
           start_time, end_time, all_day, attendees, meeting_link, event_type, status, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8,false), COALESCE($9,'[]')::jsonb,
                 $10,$11, COALESCE($12,'confirmed'), NOW())
         ON CONFLICT (google_event_id) DO UPDATE SET
           title = EXCLUDED.title, description = EXCLUDED.description,
           location = EXCLUDED.location, start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time, attendees = EXCLUDED.attendees,
           meeting_link = EXCLUDED.meeting_link, status = EXCLUDED.status,
           last_synced_at = NOW()`,
        [e.google_event_id || e.id || null, e.calendar_id || null,
         e.title, e.description || null, e.location || null,
         e.start_time, e.end_time || null, e.all_day,
         e.attendees ? JSON.stringify(e.attendees) : null,
         e.meeting_link || null, e.event_type || null, e.status]
      );
      upserted++;
    }
    const result = { success: true, upserted, source: 'google-calendar' };
    await logWebhook('/api/sync/calendar', req.body, 200, result);
    res.json(result);
  } catch (err) {
    console.error('Calendar sync error:', err);
    res.status(500).json({ error: 'Calendar sync failed', message: err.message });
  }
});

/**
 * POST /api/sync/marketing
 * Push marketing pieces scheduled / posted via Make.com (Buffer, Meta Graph,
 * LinkedIn API) so the dashboard always reflects live posting status.
 */
router.post('/marketing', async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body.items || [req.body];
    let upserted = 0;
    for (const m of items) {
      if (!m || !m.title) continue;
      if (m.external_id) {
        // upsert by external_id
        const existing = await pool.query(
          'SELECT id FROM marketing_items WHERE external_id = $1',
          [m.external_id]
        );
        if (existing.rows.length) {
          await pool.query(
            `UPDATE marketing_items SET title=$1, platform=$2, campaign_type=$3, content=$4,
               media_urls=COALESCE($5,'[]')::jsonb, scheduled_for=$6, status=COALESCE($7,status),
               metrics=COALESCE($8,metrics), updated_at=NOW()
             WHERE external_id=$9`,
            [m.title, m.platform || null, m.campaign_type || null, m.content || null,
             m.media_urls ? JSON.stringify(m.media_urls) : null,
             m.scheduled_for || null, m.status,
             m.metrics ? JSON.stringify(m.metrics) : null, m.external_id]
          );
          upserted++;
          continue;
        }
      }
      await pool.query(
        `INSERT INTO marketing_items (title, platform, campaign_type, content, media_urls,
           scheduled_for, status, metrics, external_id)
         VALUES ($1,$2,$3,$4, COALESCE($5,'[]')::jsonb, $6, COALESCE($7,'scheduled'),
                 COALESCE($8,'{}')::jsonb, $9)`,
        [m.title, m.platform || null, m.campaign_type || null, m.content || null,
         m.media_urls ? JSON.stringify(m.media_urls) : null,
         m.scheduled_for || null, m.status,
         m.metrics ? JSON.stringify(m.metrics) : null, m.external_id || null]
      );
      upserted++;
    }
    const result = { success: true, upserted, source: 'marketing' };
    await logWebhook('/api/sync/marketing', req.body, 200, result);
    res.json(result);
  } catch (err) {
    console.error('Marketing sync error:', err);
    res.status(500).json({ error: 'Marketing sync failed' });
  }
});

module.exports = router;
