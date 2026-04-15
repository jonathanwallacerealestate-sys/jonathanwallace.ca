const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

// GET /api/calendar — list events in a date range (default: today)
router.get('/', async (req, res) => {
  try {
    const { from, to, range } = req.query;
    let startSql = 'CURRENT_DATE';
    let endSql = "CURRENT_DATE + INTERVAL '1 day'";
    if (range === 'week') endSql = "CURRENT_DATE + INTERVAL '7 days'";
    if (range === 'month') endSql = "CURRENT_DATE + INTERVAL '30 days'";
    const params = [];
    if (from) { params.push(from); startSql = `$${params.length}::timestamptz`; }
    if (to) { params.push(to); endSql = `$${params.length}::timestamptz`; }

    const { rows } = await pool.query(
      `SELECT * FROM calendar_events
       WHERE start_time >= ${startSql}
         AND start_time < ${endSql}
       ORDER BY start_time ASC`,
      params
    );
    res.json({ events: rows, count: rows.length });
  } catch (err) {
    console.error('calendar list error:', err);
    res.status(500).json({ error: 'Failed to list calendar events' });
  }
});

// POST /api/calendar — upsert a calendar event (from Make.com sync)
router.post('/', async (req, res) => {
  try {
    const {
      google_event_id, calendar_id, title, description, location,
      start_time, end_time, all_day, attendees, meeting_link, event_type, status
    } = req.body;
    if (!title || !start_time) return res.status(400).json({ error: 'title and start_time required' });

    const { rows } = await pool.query(
      `INSERT INTO calendar_events
        (google_event_id, calendar_id, title, description, location,
         start_time, end_time, all_day, attendees, meeting_link, event_type, status, last_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,false), COALESCE($9,'[]')::jsonb, $10, $11, COALESCE($12,'confirmed'), NOW())
       ON CONFLICT (google_event_id) DO UPDATE SET
         calendar_id = EXCLUDED.calendar_id,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         location = EXCLUDED.location,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         all_day = EXCLUDED.all_day,
         attendees = EXCLUDED.attendees,
         meeting_link = EXCLUDED.meeting_link,
         event_type = EXCLUDED.event_type,
         status = EXCLUDED.status,
         last_synced_at = NOW()
       RETURNING *`,
      [google_event_id || null, calendar_id || null, title, description || null, location || null,
       start_time, end_time || null, all_day,
       attendees ? JSON.stringify(attendees) : null, meeting_link || null,
       event_type || null, status]
    );
    res.status(201).json({ event: rows[0] });
  } catch (err) {
    console.error('calendar create error:', err);
    res.status(500).json({ error: 'Failed to save calendar event' });
  }
});

// POST /api/calendar/bulk — batch upsert from Make.com (array of events)
router.post('/bulk', async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : req.body.events;
    if (!Array.isArray(events)) return res.status(400).json({ error: 'Expected array of events' });
    let inserted = 0;
    for (const e of events) {
      if (!e.title || !e.start_time) continue;
      await pool.query(
        `INSERT INTO calendar_events
          (google_event_id, calendar_id, title, description, location, start_time, end_time,
           all_day, attendees, meeting_link, event_type, status, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8,false), COALESCE($9,'[]')::jsonb, $10, $11, COALESCE($12,'confirmed'), NOW())
         ON CONFLICT (google_event_id) DO UPDATE SET
           title = EXCLUDED.title, description = EXCLUDED.description,
           location = EXCLUDED.location, start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time, attendees = EXCLUDED.attendees,
           meeting_link = EXCLUDED.meeting_link, status = EXCLUDED.status,
           last_synced_at = NOW()`,
        [e.google_event_id || null, e.calendar_id || null, e.title, e.description || null, e.location || null,
         e.start_time, e.end_time || null, e.all_day,
         e.attendees ? JSON.stringify(e.attendees) : null, e.meeting_link || null,
         e.event_type || null, e.status]
      );
      inserted++;
    }
    res.json({ success: true, upserted: inserted });
  } catch (err) {
    console.error('calendar bulk error:', err);
    res.status(500).json({ error: 'Failed bulk calendar sync' });
  }
});

// DELETE /api/calendar/:id
router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM calendar_events WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;
