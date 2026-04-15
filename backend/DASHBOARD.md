# Agent Command Center — jonathanwallace.ca

The agent dashboard is a single-page app served from the Railway backend at
`/dashboard?key=YOUR_API_KEY`. Designed to be the first thing you open every
morning. Works from any browser, any device.

## What's on the dashboard

| Section | What it shows | Powered by |
|--------|--------------|------------|
| **Agent Tasks** | Every Claude task that's pending, running, or recently finished — plus a quick-compose box to kick off a new one | `/api/tasks` + Claude worker |
| **Emails** | Gmail messages flagged as needing attention, sorted by priority | Make.com "Watch emails" → `/api/sync/gmail` |
| **CRM Follow-ups** | Follow-Up Boss tasks (due today / overdue / this week) | Make.com FUB webhook → `/api/sync/follow-up-boss` |
| **Calendar** | Today's Google Calendar events, meeting links, attendees | Make.com Calendar scenario → `/api/sync/calendar` |
| **Closings & P&L** | Pending/firm/closed deals + YTD KPIs (volume, GCI, net) | `/api/closings` — manual entry or agent-fed |
| **Personal Tasks** | Personal/family/errand/admin to-dos with due dates | `/api/personal-tasks` |
| **Workouts** | Today's workout log with exercises, duration, intensity | `/api/workouts` |
| **Meal Plan** | Today's meals with macro rollups | `/api/meals` |
| **Marketing** | Scheduled + draft posts (Instagram, Facebook, LinkedIn, email blasts) | `/api/marketing` + Make.com |
| **Custom Sections** | Any extra category you want to track. No code changes required | `/api/categories` + `/api/categories/:slug/items` |

## URLs

- Dashboard: `https://<your-railway-app>.up.railway.app/dashboard?key=API_KEY`
- Daily brief (JSON): `/api/daily-brief` (requires `X-API-Key`)
- Health: `/api/health`

## Environment variables (set in Railway)

```
DATABASE_URL=...            # Railway provides automatically
API_KEY=...                 # The key used to log into the dashboard
ANTHROPIC_API_KEY=...       # Enables the Claude worker
GMAIL_CLIENT_ID=...         # Gmail OAuth
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_USER=jonathanwallacerealestate@gmail.com
```

## Make.com scenarios you need to build

Each scenario pushes data **into** the dashboard via a webhook. All endpoints
require the `X-API-Key` header that matches `API_KEY`. Payloads are idempotent
(upserts by external id) so scenarios can safely retry.

### 1. Follow-Up Boss → CRM follow-ups
- Trigger: FUB webhook (`task.created`, `task.updated`, `person.updated`)
- Action: HTTP POST to `/api/sync/follow-up-boss`
- Body:
  ```json
  {
    "fub_event_id": "{{task.id}}",
    "fub_person_id": "{{task.personId}}",
    "contact_name": "{{person.name}}",
    "contact_email": "{{person.emails[0].value}}",
    "contact_phone": "{{person.phones[0].value}}",
    "stage": "{{person.stage}}",
    "lead_source": "{{person.source}}",
    "follow_up_type": "{{task.type}}",
    "due_date": "{{task.dueDate}}",
    "notes": "{{task.name}}",
    "status": "open",
    "last_activity_at": "{{person.updated}}"
  }
  ```

### 2. Gmail → Flagged emails
- Trigger: Gmail "Watch emails" (filter: starred, label:follow-up, or sender list)
- Action: HTTP POST to `/api/sync/gmail`
- Body:
  ```json
  {
    "gmail_message_id": "{{message.id}}",
    "thread_id": "{{message.threadId}}",
    "from_address": "{{message.from.address}}",
    "from_name": "{{message.from.name}}",
    "subject": "{{message.subject}}",
    "snippet": "{{message.snippet}}",
    "received_at": "{{message.date}}",
    "priority": "high",
    "labels": "{{message.labels}}"
  }
  ```

### 3. Google Calendar → Today's events
- Trigger: Scheduler, 6:00 AM daily + on-change via Calendar Watch
- Action: Search events for today, then HTTP POST array to `/api/sync/calendar`
- Body (batch):
  ```json
  {
    "events": [
      {
        "google_event_id": "{{id}}",
        "title": "{{summary}}",
        "description": "{{description}}",
        "location": "{{location}}",
        "start_time": "{{start.dateTime}}",
        "end_time": "{{end.dateTime}}",
        "all_day": false,
        "attendees": "{{attendees}}",
        "meeting_link": "{{hangoutLink}}"
      }
    ]
  }
  ```

### 4. Marketing (optional)
When a post is published (e.g. via Buffer or Meta Graph) push the result back:
`POST /api/sync/marketing` with `external_id`, `status: "posted"`, `metrics`.

## Adding a new dashboard section

No code deploy required.

```bash
curl -X POST https://<app>/api/categories \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Goals", "color": "#8b5cf6", "sort_order": 100 }'
```

Or just click **+ New Section** inside the Custom Sections card. The new
category appears on the dashboard immediately and supports the same add /
complete / delete lifecycle as the built-ins.

## Full API surface

All endpoints require `X-API-Key`. Every resource supports list, create, patch,
delete. See `src/routes/*.js` for the exact shapes.

```
GET  /api/daily-brief            — one-shot aggregate for the dashboard

POST /api/tasks/quick            — fire an agent task (Claude)
GET  /api/tasks/:id              — status/result

GET  /api/personal-tasks         ?status, ?category, ?due=today|week|overdue
POST /api/personal-tasks
PATCH/DELETE /api/personal-tasks/:id

GET  /api/emails                 ?status=needs_reply|handled|all
POST /api/emails
PATCH/DELETE /api/emails/:id

GET  /api/follow-ups             ?due=today|overdue|week&status=open|all
POST /api/follow-ups
PATCH/DELETE /api/follow-ups/:id

GET  /api/calendar               ?range=day|week|month
POST /api/calendar
POST /api/calendar/bulk

GET  /api/closings               ?status=all|pending|firm|closed&year=YYYY
GET  /api/closings/pnl           ?year=YYYY
POST /api/closings
PATCH/DELETE /api/closings/:id

GET  /api/workouts               ?date=today|week|YYYY-MM-DD
POST /api/workouts
PATCH/DELETE /api/workouts/:id

GET  /api/meals                  ?date=today|week|YYYY-MM-DD
POST /api/meals
PATCH/DELETE /api/meals/:id

GET  /api/marketing              ?status, ?platform, ?upcoming=true
POST /api/marketing
PATCH/DELETE /api/marketing/:id

GET  /api/categories             — all dashboard sections (builtin + custom)
POST /api/categories
PATCH/DELETE /api/categories/:slug
GET  /api/categories/:slug/items
POST /api/categories/:slug/items
PATCH/DELETE /api/categories/:slug/items/:id

POST /api/sync/follow-up-boss    — Make.com push
POST /api/sync/gmail             — Make.com push
POST /api/sync/calendar          — Make.com push
POST /api/sync/marketing         — Make.com push
```

## Data model

See `src/db/init.js` for the full schema. The key tables:

- `tasks` — Claude agent queue (existing)
- `personal_tasks`, `flagged_emails`, `crm_followups`, `calendar_events`,
  `closings`, `workouts`, `meal_plan`, `marketing_items` — per-section
- `dashboard_categories` + `custom_items` — extensibility layer

All tables have `created_at` (and most have `updated_at`) — useful for
analytics and for Claude to reason about recency.

## Mobile / iPhone use

The dashboard is mobile-first. On iPhone Safari:
1. Visit `https://<app>/dashboard?key=API_KEY`
2. Tap the Share icon → "Add to Home Screen"
3. Now it launches like a native app.

The quick-compose box on Tasks works as the same entry point Make.com uses
for SMS-to-agent automations (POST `/api/tasks/quick`).
