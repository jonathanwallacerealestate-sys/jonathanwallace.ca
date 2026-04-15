/**
 * Daily Brief — one shot aggregator.
 * Returns everything the dashboard needs to paint the "start of day" screen
 * in a single request: tasks, flagged emails, CRM follow-ups, today's calendar,
 * upcoming closings + YTD P&L, personal tasks, today's workout, today's meals,
 * and scheduled marketing.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');

router.use(requireApiKey);

router.get('/', async (req, res) => {
  try {
    const [
      agentTasks, agentStats,
      emails, emailCounts,
      followups, followupCounts,
      todaysEvents,
      upcomingClosings, ytdPnl,
      personalTasks,
      todaysWorkouts,
      todaysMeals,
      upcomingMarketing,
      customCategories, customItems
    ] = await Promise.all([
      pool.query(`SELECT id, type, instruction, status, created_at, completed_at
                    FROM tasks ORDER BY created_at DESC LIMIT 10`),
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'processing') AS processing,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) AS total FROM tasks`),

      pool.query(`SELECT * FROM flagged_emails
         WHERE status IN ('needs_reply', 'informational', 'snoozed')
           AND (snoozed_until IS NULL OR snoozed_until < NOW())
         ORDER BY
           CASE COALESCE(ai_priority, priority)
             WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
           has_attachment DESC,
           received_at DESC NULLS LAST
         LIMIT 40`),
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'needs_reply') AS needs_reply,
        COUNT(*) FILTER (WHERE (ai_priority = 'urgent' OR priority = 'urgent') AND status='needs_reply') AS urgent,
        COUNT(*) FILTER (WHERE status='handled' AND handled_at::date = CURRENT_DATE) AS handled_today,
        COUNT(*) FILTER (WHERE has_attachment = TRUE AND status='needs_reply') AS with_attachment
        FROM flagged_emails`),

      pool.query(`SELECT * FROM crm_followups
         WHERE status = 'open'
           AND (due_date IS NULL OR due_date <= CURRENT_DATE + INTERVAL '7 days')
         ORDER BY COALESCE(due_date, '9999-12-31') ASC
         LIMIT 30`),
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'open' AND due_date = CURRENT_DATE) AS due_today,
        COUNT(*) FILTER (WHERE status = 'open' AND due_date < CURRENT_DATE) AS overdue,
        COUNT(*) FILTER (WHERE status = 'open' AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days') AS this_week,
        COUNT(*) FILTER (WHERE status = 'open') AS open_total
        FROM crm_followups`),

      pool.query(`SELECT * FROM calendar_events
         WHERE start_time >= CURRENT_DATE
           AND start_time <  CURRENT_DATE + INTERVAL '1 day'
         ORDER BY start_time ASC`),

      pool.query(`SELECT id, property_address, city, client_name, transaction_side, sale_price,
                          gross_commission, net_profit, closing_date, status
           FROM closings
          WHERE status IN ('pending','firm')
            AND (closing_date IS NULL OR closing_date >= CURRENT_DATE)
          ORDER BY COALESCE(closing_date, '9999-12-31') ASC
          LIMIT 15`),
      pool.query(`SELECT
        COUNT(*) AS deals,
        COALESCE(SUM(sale_price),0) AS sale_volume,
        COALESCE(SUM(gross_commission),0) AS gross_commission,
        COALESCE(SUM(net_profit),0) AS net_profit
        FROM closings
        WHERE EXTRACT(YEAR FROM closing_date) = EXTRACT(YEAR FROM CURRENT_DATE)
          AND status IN ('closed','firm','pending')`),

      pool.query(`SELECT * FROM personal_tasks
          WHERE status != 'done'
            AND (due_date IS NULL OR due_date <= CURRENT_DATE + INTERVAL '7 days')
          ORDER BY
            CASE WHEN due_date < CURRENT_DATE THEN 0
                 WHEN due_date = CURRENT_DATE THEN 1 ELSE 2 END,
            priority DESC, created_at ASC
          LIMIT 30`),

      pool.query(`SELECT * FROM workouts WHERE workout_date = CURRENT_DATE`),

      pool.query(`SELECT * FROM meal_plan WHERE meal_date = CURRENT_DATE
         ORDER BY CASE meal_type
           WHEN 'breakfast' THEN 1 WHEN 'snack_morning' THEN 2
           WHEN 'lunch' THEN 3 WHEN 'snack_afternoon' THEN 4
           WHEN 'dinner' THEN 5 WHEN 'snack_evening' THEN 6 ELSE 99 END`),

      pool.query(`SELECT m.*, l.address AS listing_address FROM marketing_items m
         LEFT JOIN listings l ON l.id = m.listing_id
         WHERE m.status IN ('scheduled','draft')
           AND (m.scheduled_for IS NULL OR m.scheduled_for <= NOW() + INTERVAL '7 days')
         ORDER BY COALESCE(m.scheduled_for, '9999-12-31'::timestamptz) ASC
         LIMIT 20`),

      pool.query(`SELECT * FROM dashboard_categories WHERE enabled = TRUE ORDER BY sort_order ASC, name ASC`),
      pool.query(`SELECT * FROM custom_items
         WHERE status != 'done'
           AND category_slug IN (
             SELECT slug FROM dashboard_categories WHERE enabled = TRUE AND is_builtin = FALSE
           )
         ORDER BY COALESCE(due_date,'9999-12-31') ASC, created_at DESC`)
    ]);

    // Nutrition rollup
    const mealTotals = todaysMeals.rows.reduce((a, m) => {
      a.calories += Number(m.calories) || 0;
      a.protein_g += Number(m.protein_g) || 0;
      a.carbs_g += Number(m.carbs_g) || 0;
      a.fat_g += Number(m.fat_g) || 0;
      return a;
    }, { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

    // Group custom items by category slug
    const itemsBySlug = {};
    for (const item of customItems.rows) {
      (itemsBySlug[item.category_slug] = itemsBySlug[item.category_slug] || []).push(item);
    }

    res.json({
      generated_at: new Date().toISOString(),
      timezone: 'America/Toronto',
      today: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }),
      tasks: { recent: agentTasks.rows, stats: agentStats.rows[0] },
      emails: { list: emails.rows, stats: emailCounts.rows[0] },
      crm: { list: followups.rows, stats: followupCounts.rows[0] },
      calendar: { today: todaysEvents.rows },
      closings: { upcoming: upcomingClosings.rows, ytd: ytdPnl.rows[0] },
      personal: { list: personalTasks.rows },
      workouts: { today: todaysWorkouts.rows },
      meals: { today: todaysMeals.rows, totals: mealTotals },
      marketing: { upcoming: upcomingMarketing.rows },
      categories: customCategories.rows,
      custom_items: itemsBySlug
    });
  } catch (err) {
    console.error('daily-brief error:', err);
    res.status(500).json({ error: 'Failed to build daily brief', message: err.message });
  }
});

module.exports = router;
