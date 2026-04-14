/**
 * Morning briefing — pulls today's daily-brief data, hands it to Claude
 * with a tight system prompt, returns a short spoken-style summary the
 * dashboard will narrate via the SpeechSynthesis API.
 */
const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

const anthropic = new Anthropic();

const BRIEF_SYSTEM_PROMPT = `You are Jonathan Wallace's personal morning briefing assistant.

Jonathan is a high-producing real estate agent in Georgian Bay, Ontario. Each morning
he sits down at his dashboard and you tell him what he needs to know.

Speak like a real human assistant who has been working with Jonathan for years.
You are NOT writing a report. You are briefing him out loud. Be warm, crisp,
and specific.

Rules:
- Keep it under 180 words.
- Start with a one-line greeting that references the day of the week.
- Lead with what matters most TODAY: urgent emails, overdue CRM follow-ups,
  calendar conflicts, closings that need movement.
- Then cover wins and forward-looking items briefly.
- Don't read lists aloud. Summarize them. Use natural phrasing like
  "three follow-ups, one of them overdue with a new Wasaga Beach lead."
- Don't use markdown. Don't use bullet points. Write prose.
- End with a one-sentence nudge or priority for the day.
- Use Jonathan's first name sparingly — once at most.`;

router.get('/summary', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Claude not configured on this server' });
    }

    // Assemble the brief data server-side so we can pass structured context to Claude.
    const brief = await buildBriefSnapshot();

    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Toronto', weekday: 'long', month: 'long', day: 'numeric'
    });

    const userMessage = `Today is ${today}. Here is the raw data from the dashboard.
Give me my morning briefing.

${JSON.stringify(brief, null, 2)}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: BRIEF_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    res.json({
      summary: text,
      generated_at: new Date().toISOString(),
      tokens: response.usage,
      snapshot: brief
    });
  } catch (err) {
    console.error('briefing error:', err);
    res.status(500).json({ error: 'Failed to generate briefing', message: err.message });
  }
});

async function buildBriefSnapshot() {
  const q = (s, p = []) => pool.query(s, p).then(r => r.rows);

  const [urgentEmails, crmToday, crmOverdue, calendarToday,
         closingsSoon, personalToday, workoutsToday, marketingToday] =
    await Promise.all([
      q(`SELECT subject, from_name, from_address, priority FROM flagged_emails
          WHERE status='needs_reply' ORDER BY
            CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
            received_at DESC LIMIT 5`),
      q(`SELECT contact_name, follow_up_type, notes FROM crm_followups
          WHERE status='open' AND due_date = CURRENT_DATE LIMIT 10`),
      q(`SELECT contact_name, follow_up_type, due_date FROM crm_followups
          WHERE status='open' AND due_date < CURRENT_DATE LIMIT 10`),
      q(`SELECT title, start_time, location, event_type FROM calendar_events
          WHERE start_time >= CURRENT_DATE AND start_time < CURRENT_DATE + INTERVAL '1 day'
          ORDER BY start_time ASC`),
      q(`SELECT property_address, status, closing_date, sale_price FROM closings
          WHERE status IN ('pending','firm') AND closing_date <= CURRENT_DATE + INTERVAL '21 days'
          ORDER BY closing_date ASC LIMIT 5`),
      q(`SELECT title, category, due_date, priority FROM personal_tasks
          WHERE status != 'done' AND (due_date <= CURRENT_DATE OR priority >= 4)
          ORDER BY priority DESC LIMIT 10`),
      q(`SELECT title, workout_type, completed FROM workouts
          WHERE workout_date = CURRENT_DATE`),
      q(`SELECT title, platform, scheduled_for FROM marketing_items
          WHERE status='scheduled' AND scheduled_for BETWEEN NOW() AND NOW() + INTERVAL '24 hours'`)
    ]);

  return {
    urgent_emails: urgentEmails,
    crm_due_today: crmToday,
    crm_overdue: crmOverdue,
    calendar_today: calendarToday,
    closings_coming_up: closingsSoon,
    personal_tasks: personalToday,
    workout_today: workoutsToday,
    marketing_today: marketingToday
  };
}

module.exports = router;
