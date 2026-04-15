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
const { google } = require('googleapis');
const intuition = require('../services/intuition');

router.use(requireApiKey);

const anthropic = new Anthropic();

// Gmail client — reused for "Email my day" export
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

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
- Use Jonathan's first name sparingly — once at most.
- If recent_learning has unapplied action items, weave one in naturally — "you noted from the [show name] episode that..."
- fub_live.overdue_count is the number of overdue Follow Up Boss tasks. If it's
  > 0, lead with it. If fub_live is null, FUB isn't configured — don't mention FUB.
- fub_live.new_leads_24h_count shows how many fresh leads came in overnight. If
  > 0, name one or two ("a new Midland lead named Sarah came in off the website
  at 11pm"). These are the hottest. Only skip if there's something more urgent.`;

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

    const ctx = await intuition.buildContextBlock();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: ctx ? `${BRIEF_SYSTEM_PROMPT}\n\n${ctx}` : BRIEF_SYSTEM_PROMPT,
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
         closingsSoon, personalToday, workoutsToday, marketingToday,
         activityToday, goalsToday, recentLearning, openLearningActions] =
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
          WHERE status='scheduled' AND scheduled_for BETWEEN NOW() AND NOW() + INTERVAL '24 hours'`),
      q(`SELECT activity_type, COUNT(*)::int AS count,
                COUNT(*) FILTER (WHERE outcome='connected')::int AS connected
           FROM activity_log WHERE activity_date = CURRENT_DATE GROUP BY activity_type`),
      q(`SELECT goal_type, daily_target FROM lead_gen_goals WHERE enabled = TRUE`),
      q(`SELECT title, kind, summary, action_items
           FROM learning_log
           WHERE consumed_at >= NOW() - INTERVAL '7 days'
             AND summary IS NOT NULL
           ORDER BY consumed_at DESC LIMIT 5`),
      q(`SELECT title, jsonb_array_length(COALESCE(action_items,'[]'::jsonb))::int AS total,
                jsonb_array_length(COALESCE(applied_action_item_ids,'[]'::jsonb))::int AS applied
           FROM learning_log
           WHERE jsonb_array_length(COALESCE(action_items,'[]'::jsonb)) >
                 jsonb_array_length(COALESCE(applied_action_item_ids,'[]'::jsonb))
             AND consumed_at >= NOW() - INTERVAL '14 days'
           ORDER BY consumed_at DESC LIMIT 5`)
    ]);

  const activityMap = Object.fromEntries(activityToday.map(r => [r.activity_type, r]));
  const goalMap = Object.fromEntries(goalsToday.map(r => [r.goal_type, r.daily_target]));

  // Pull FUB live state (best-effort — 503 / missing key falls through silently)
  const fub = await safeFubSnapshot();

  return {
    urgent_emails: urgentEmails,
    crm_due_today: crmToday,
    crm_overdue: crmOverdue,
    calendar_today: calendarToday,
    closings_coming_up: closingsSoon,
    personal_tasks: personalToday,
    workout_today: workoutsToday,
    marketing_today: marketingToday,
    lead_gen_today: {
      calls: { actual: activityMap.call?.count || 0, connected: activityMap.call?.connected || 0, target: goalMap.calls || 0 },
      emails: { actual: activityMap.email?.count || 0, target: goalMap.emails || 0 },
      contacts_added: { actual: (activityMap.text?.count || 0) + (activityMap.drop_by?.count || 0) + (activityMap.social_dm?.count || 0) + (activityMap.meeting?.count || 0), target: goalMap.contacts_added || 0 }
    },
    recent_learning: recentLearning,
    open_learning_actions: openLearningActions,
    fub_live: fub
  };
}

async function safeFubSnapshot() {
  try {
    const fub = require('../services/fub');
    const key = await fub.getApiKey();
    if (!key) return null;
    // Today's open tasks + overdue + new leads since yesterday, all in parallel
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [todayTasks, overdueTasks, newLeads] = await Promise.all([
      fub.listTasks({ limit: 25, status: 'Active', dueBefore: today + 'T23:59:59Z', dueAfter: today + 'T00:00:00Z' }).catch(() => ({ tasks: [] })),
      fub.listTasks({ limit: 15, status: 'Active', dueBefore: today + 'T00:00:00Z' }).catch(() => ({ tasks: [] })),
      fub.listPeople({ limit: 10, sort: '-created' }).catch(() => ({ people: [] }))
    ]);
    // Filter people created in the last 24h
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const fresh = (newLeads.people || [])
      .filter(p => p.created && new Date(p.created).getTime() >= cutoff)
      .slice(0, 8)
      .map(p => ({
        id: p.id, name: p.name, source: p.source, stage: p.stage,
        email: p.emails?.[0]?.value, phone: p.phones?.[0]?.value
      }));
    return {
      due_today_count: (todayTasks.tasks || []).length,
      overdue_count: (overdueTasks.tasks || []).length,
      new_leads_24h_count: fresh.length,
      due_today: (todayTasks.tasks || []).slice(0, 10).map(t => ({
        name: t.name, type: t.type, person_id: t.personId, due: t.dueDate
      })),
      overdue: (overdueTasks.tasks || []).slice(0, 10).map(t => ({
        name: t.name, type: t.type, person_id: t.personId, due: t.dueDate
      })),
      new_leads: fresh
    };
  } catch (e) {
    return null;
  }
}

/**
 * Weekly review — Sunday-night style reflection on the past 7 days with
 * GCI tracking, deal pipeline movement, missed targets, and 2-3 priorities
 * for the upcoming week.
 */
const WEEKLY_SYSTEM_PROMPT = `You are Jonathan Wallace's accountability partner doing his weekly review.

Speak like a peer who knows him — direct, specific, no fluff. Reflect on the
last 7 days using the data provided. Format as plain prose, not lists.

Cover, in this order:
1. Wins worth naming — closings that closed, deals that went firm, marketing
   that landed, workouts hit, key follow-ups completed.
2. Numbers that matter — GCI booked this week, deals in the pipeline, sale
   volume YTD against trajectory.
3. What slipped — overdue CRM, marketing past its scheduled date, workouts
   missed against the weekly target.
4. Two or three priorities for the upcoming week. Concrete, named.

Keep the whole thing under 280 words. End with one sentence of forward
momentum, not a question.`;

router.get('/weekly', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Claude not configured' });
    }
    const data = await buildWeeklySnapshot();
    const ctx = await intuition.buildContextBlock();

    const userMessage = `Week ending ${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto', weekday: 'long', month: 'long', day: 'numeric' })}.\n\nData:\n${JSON.stringify(data, null, 2)}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 700,
      system: ctx ? `${WEEKLY_SYSTEM_PROMPT}\n\n${ctx}` : WEEKLY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    res.json({ review: text, generated_at: new Date().toISOString(), tokens: response.usage, snapshot: data });
  } catch (err) {
    console.error('weekly review error:', err);
    res.status(500).json({ error: 'Failed to generate weekly review', message: err.message });
  }
});

async function buildWeeklySnapshot() {
  const q = (s, p = []) => pool.query(s, p).then(r => r.rows);
  const [
    closingsClosed, closingsFirm, dealsPipeline, ytd,
    crmDone, crmOverdue, marketingPosted, marketingMissed,
    workouts7, workoutTarget, mealsDays
  ] = await Promise.all([
    q(`SELECT property_address, sale_price, gross_commission, net_profit, closing_date
         FROM closings WHERE status='closed' AND closing_date >= CURRENT_DATE - INTERVAL '7 days'`),
    q(`SELECT property_address, sale_price, gross_commission, firm_date
         FROM closings WHERE status='firm' AND firm_date >= CURRENT_DATE - INTERVAL '7 days'`),
    q(`SELECT COUNT(*) AS deals,
              COALESCE(SUM(gross_commission),0) AS gross_commission_pipeline
         FROM closings WHERE status IN ('pending','firm')`),
    q(`SELECT COUNT(*) AS deals,
              COALESCE(SUM(sale_price),0) AS sale_volume,
              COALESCE(SUM(gross_commission),0) AS gross_commission,
              COALESCE(SUM(net_profit),0) AS net_profit
         FROM closings
         WHERE EXTRACT(YEAR FROM closing_date) = EXTRACT(YEAR FROM CURRENT_DATE)
           AND status IN ('closed','firm','pending')`),
    q(`SELECT COUNT(*) AS done FROM crm_followups
         WHERE status='done' AND completed_at >= CURRENT_DATE - INTERVAL '7 days'`),
    q(`SELECT contact_name, due_date FROM crm_followups
         WHERE status='open' AND due_date < CURRENT_DATE LIMIT 10`),
    q(`SELECT title, platform, scheduled_for FROM marketing_items
         WHERE status='posted' AND updated_at >= CURRENT_DATE - INTERVAL '7 days' LIMIT 20`),
    q(`SELECT title, platform, scheduled_for FROM marketing_items
         WHERE status='scheduled' AND scheduled_for < NOW() LIMIT 10`),
    q(`SELECT workout_date, workout_type, completed FROM workouts
         WHERE workout_date >= CURRENT_DATE - INTERVAL '7 days' ORDER BY workout_date DESC`),
    q(`SELECT value FROM app_settings WHERE key = 'workout_week_target'`),
    q(`SELECT meal_date, COUNT(*) AS meals_logged FROM meal_plan
         WHERE meal_date >= CURRENT_DATE - INTERVAL '7 days' GROUP BY meal_date`)
  ]);
  return {
    closings_closed_this_week: closingsClosed,
    deals_went_firm_this_week: closingsFirm,
    pipeline: dealsPipeline[0] || {},
    ytd: ytd[0] || {},
    crm_completed_this_week: Number(crmDone[0]?.done || 0),
    crm_overdue: crmOverdue,
    marketing_posted_this_week: marketingPosted,
    marketing_past_due: marketingMissed,
    workouts_last_7_days: workouts7,
    workout_target_per_week: workoutTarget[0]?.value || 5,
    meal_days_logged: mealsDays.length
  };
}

/**
 * "What did I forget?" — compares recent activity + goals (from app_settings)
 * against upcoming commitments and flags blind spots.
 */
const GAP_SYSTEM_PROMPT = `You are Jonathan Wallace's no-nonsense accountability coach.
He's a high-producing real estate agent with personal goals (workouts per week,
daily nutrition targets) and business commitments (CRM follow-ups, closings).

Your job: given a snapshot of the last 7 days of activity plus his stated goals,
tell him what he has dropped the ball on. Be direct. Be short.

Rules:
- Under 120 words.
- Plain prose, no markdown, no bullets.
- Lead with the single most important miss.
- Call out CRM follow-ups that are overdue, workouts missed against target,
  protein/calorie days that look way off target, closings without recent
  activity, and marketing that was scheduled but never posted.
- If everything looks good, say so in one sentence and move on.
- Always end with one concrete next action to take in the next 2 hours.`;

router.get('/gaps', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Claude not configured on this server' });
    }
    const [activity, goals] = await Promise.all([
      buildActivitySnapshot(),
      loadGoals()
    ]);

    const userMessage = `Goals:\n${JSON.stringify(goals, null, 2)}\n\nLast 7 days + upcoming:\n${JSON.stringify(activity, null, 2)}`;

    const ctx = await intuition.buildContextBlock();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: ctx ? `${GAP_SYSTEM_PROMPT}\n\n${ctx}` : GAP_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    res.json({ analysis: text, generated_at: new Date().toISOString(), tokens: response.usage, snapshot: activity, goals });
  } catch (err) {
    console.error('gap analysis error:', err);
    res.status(500).json({ error: 'Failed to analyze gaps', message: err.message });
  }
});

/**
 * "Email my day" — sends a copy of today's briefing + quick action list
 * to Jonathan's own inbox so it's accessible from any email client.
 */
router.post('/email', async (req, res) => {
  try {
    if (!process.env.GMAIL_REFRESH_TOKEN) {
      return res.status(503).json({ error: 'Gmail not configured' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Claude not configured' });
    }

    const snapshot = await buildBriefSnapshot();
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Toronto', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 900,
      system: `You are composing the day-start email for Jonathan Wallace. Write a clean HTML email
(no external CSS, inline styles only) that starts with a one-paragraph briefing,
then has clearly labeled sections for Priorities, Today's Calendar, Needs Reply,
CRM Follow-Ups, and Closings. Keep it scannable on mobile. No wasted words.`,
      messages: [{ role: 'user', content: `Today is ${today}. Snapshot:\n${JSON.stringify(snapshot, null, 2)}` }]
    });

    const html = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

    const to = (req.body && req.body.to) || process.env.GMAIL_USER || 'jonathanwallacerealestate@gmail.com';
    const subject = `Today's Plan — ${today}`;
    const raw = Buffer.from([
      `From: ${process.env.GMAIL_USER || 'jonathanwallacerealestate@gmail.com'}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html
    ].join('\r\n')).toString('base64url');

    const g = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });

    res.json({ success: true, messageId: g.data.id, to, subject });
  } catch (err) {
    console.error('email-day error:', err);
    res.status(500).json({ error: 'Failed to email day', message: err.message });
  }
});

async function buildActivitySnapshot() {
  const q = (s, p = []) => pool.query(s, p).then(r => r.rows);
  const [workouts7, meals7, crmOverdue, crmCompletedWeek,
         closingsStale, marketingScheduled, marketingPosted] =
    await Promise.all([
      q(`SELECT workout_date, workout_type, duration_minutes, completed FROM workouts
          WHERE workout_date >= CURRENT_DATE - INTERVAL '7 days' ORDER BY workout_date DESC`),
      q(`SELECT meal_date, SUM(calories) AS kcal, SUM(protein_g) AS protein_g,
                COUNT(*) AS meal_count FROM meal_plan
          WHERE meal_date >= CURRENT_DATE - INTERVAL '7 days'
          GROUP BY meal_date ORDER BY meal_date DESC`),
      q(`SELECT contact_name, follow_up_type, due_date FROM crm_followups
          WHERE status='open' AND due_date < CURRENT_DATE LIMIT 20`),
      q(`SELECT COUNT(*) AS done FROM crm_followups
          WHERE status='done' AND completed_at >= CURRENT_DATE - INTERVAL '7 days'`),
      q(`SELECT property_address, status, updated_at FROM closings
          WHERE status IN ('pending','firm')
            AND updated_at < CURRENT_DATE - INTERVAL '5 days'
          LIMIT 10`),
      q(`SELECT COUNT(*) AS scheduled FROM marketing_items
          WHERE status='scheduled' AND scheduled_for < NOW()`),
      q(`SELECT COUNT(*) AS posted FROM marketing_items
          WHERE status='posted' AND updated_at >= CURRENT_DATE - INTERVAL '7 days'`)
    ]);
  return {
    workouts_last_7_days: workouts7,
    meals_last_7_days: meals7,
    crm_overdue: crmOverdue,
    crm_completed_this_week: crmCompletedWeek[0]?.done || 0,
    closings_without_recent_activity: closingsStale,
    marketing_past_due: marketingScheduled[0]?.scheduled || 0,
    marketing_posted_this_week: marketingPosted[0]?.posted || 0
  };
}

async function loadGoals() {
  const keys = ['workout_week_target','daily_goal_calories','daily_goal_protein'];
  const { rows } = await pool.query('SELECT key, value FROM app_settings WHERE key = ANY($1)', [keys]);
  const g = {};
  for (const r of rows) g[r.key] = r.value;
  return g;
}

module.exports = router;
