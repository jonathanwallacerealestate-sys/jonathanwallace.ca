# Agent Command Center — Deployment Handoff

A complete deployment + operations guide for the **Agent Command Center** built
into `jonathanwallace.ca`. Hand this document to any developer; it contains
everything needed to take the repo from "cloned" to "live and serving Jonathan
Wallace as his daily-driver dashboard."

---

## TL;DR

- **Marketing site** is static HTML/CSS/JS, deployed to **Netlify** from `main`.
- **Backend + Agent Command Center** is a Node/Express app in `backend/`,
  deployed to **Railway** from `main`. Uses a Railway-provisioned **PostgreSQL**.
- All 24 database tables auto-migrate on app boot via `initDb()` in
  `backend/src/db/init.js`.
- Configure environment variables in Railway, deploy, visit
  `https://<railway-url>/dashboard?key=<API_KEY>`.
- Optionally proxy `jonathanwallace.ca/dashboard` through Netlify to Railway
  by editing the placeholder in `netlify.toml`.

---

## 1. Repo layout

```
jonathanwallace.ca/
├── index.html, buyers.html, sellers.html, about.html, contact.html
├── communities/                ← static community pages
├── css/, js/                   ← static site assets
├── netlify.toml                ← Netlify config + dashboard/api proxy
├── README.md, DEPLOY.md, HANDOFF.md
└── backend/                    ← Railway-deployed Node app
    ├── package.json
    ├── railway.toml            ← Nixpacks build, healthcheck on /api/health
    ├── Procfile
    ├── DASHBOARD.md            ← Setup + Make.com scenario templates
    ├── .env.example
    └── src/
        ├── index.js            ← Express app + route wiring + start()
        ├── db/
        │   ├── init.js         ← All 24 CREATE TABLE IF NOT EXISTS + seeds
        │   └── pool.js         ← pg connection pool from DATABASE_URL
        ├── middleware/apiKey.js
        ├── routes/             ← 29 REST routes (see §6)
        ├── services/
        │   ├── claude.js       ← Anthropic SDK + 14 tool defs + tool-use loop
        │   ├── intuition.js    ← Vocabulary + memory loader (60s cache)
        │   ├── scheduler.js    ← In-process cron-like scheduler
        │   ├── worker.js       ← Agent task queue worker (10s poll)
        │   ├── events.js       ← In-process pub/sub for SSE
        │   ├── cryptoVault.js  ← AES-256-GCM credential encryption
        │   └── bookmarkParser.js  ← Netscape bookmark format parser
        └── views/
            ├── dashboard.html  ← Single-page dashboard shell
            ├── dashboard.css   ← All dashboard styles
            ├── login.html      ← API-key gate
            ├── manifest.json   ← PWA manifest
            ├── sw.js           ← Service worker (offline cache)
            ├── icon-192.svg, icon-512.svg
            └── dashboard.*.js  ← 12 client modules (see §7)
```

---

## 2. Tech stack

| Layer | Tech | Notes |
|---|---|---|
| Frontend (marketing) | HTML / CSS / Vanilla JS | No build step |
| Frontend (dashboard) | Single-page vanilla JS | Loaded as a PWA; no React/Vue/etc. |
| Backend | Node.js 18+, Express 4 | Helmet + CORS + rate-limit + morgan |
| Database | PostgreSQL (Railway plugin) | Single connection pool via `pg` |
| AI | Anthropic Claude (`claude-sonnet-4-20250514`) | Native tool-use API |
| Email | Gmail API via `googleapis` (OAuth refresh-token) | |
| Calendar / Drive | Google Calendar via Make.com webhook | |
| CRM | Follow-Up Boss via Make.com webhook → `/api/sync/follow-up-boss` | |
| Live updates | Server-Sent Events at `/api/events/stream` | |
| Hosting (static) | Netlify (auto-deploy from `main`) | |
| Hosting (backend) | Railway (auto-deploy from `main`, Nixpacks builder) | |
| Optional | Spotify Web API (OAuth, configured in-app) | |

---

## 3. Required services & accounts

The backend can run with only `DATABASE_URL` and `API_KEY`. Everything else
gracefully degrades if a credential is missing. Set these up in advance:

| Service | Required for | Where to register |
|---|---|---|
| **Railway** | Hosting backend + Postgres | https://railway.com |
| **Netlify** | Hosting marketing site | https://app.netlify.com |
| **Anthropic API** | Agent task processing, briefings, all Claude features | https://console.anthropic.com |
| **Google Cloud (Gmail API)** | Sending emails, drafts, "Email My Day" | https://console.cloud.google.com |
| **Make.com** | Webhooks for Follow-Up Boss / Gmail watch / Calendar sync | https://make.com |
| **Spotify Developer** *(optional)* | Pulling recently-played podcast episodes | https://developer.spotify.com/dashboard |

---

## 4. Environment variables (Railway)

Set these in **Railway → service → Variables**. Restart the service after changes.

### Required

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | Auto-provided by Railway when you attach the Postgres plugin | `postgresql://...` |
| `API_KEY` | Long random string. Used as `?key=` to log into the dashboard AND as `X-API-Key` header for all `/api/*` routes. Treat as a secret. | `8f4d...` |

### Strongly recommended

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Enables agent worker, briefing, gap analysis, weekly review, call analysis, learning extraction, LOO generation. Without this most "smart" features 503. |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_USER` | Enables agent email tools + "Email My Day" + scheduled-job email delivery. See §5 for OAuth setup. |
| `NODE_ENV` | `production` |

### Optional

| Variable | Description |
|---|---|
| `CREDENTIALS_ENCRYPTION_KEY` | 64-hex-char key used to AES-256-GCM encrypt Claude Chrome credentials at rest. If absent, derived from `sha256(API_KEY + "::creds")`. **Recommended** to set explicitly so credentials survive an `API_KEY` rotation. Generate with `openssl rand -hex 32`. |
| `PORT` | Defaults to `3000`. Railway sets this automatically. |
| `SPOTIFY_REDIRECT_URI` | Override the auto-detected Spotify OAuth callback URL. Usually leave unset. |

### Spotify configuration *(set inside the dashboard, not as env vars)*

After deploy, open the dashboard → **Settings → Manage** and enter:
- `spotify_client_id`
- `spotify_client_secret`

Then click **Connect Spotify** in the Learning Capture card to do the OAuth
dance. The refresh token is stored in `app_settings` (Postgres), not env vars.

---

## 5. Gmail OAuth refresh token (one-time setup)

This is the trickiest piece. Required for the Claude agent to send/draft
emails on Jonathan's behalf and for "Email My Day".

1. Go to https://console.cloud.google.com → create or pick a project
2. **APIs & Services → Library** → enable **Gmail API**
3. **APIs & Services → OAuth consent screen**
   - User type: **External** (or Internal if Google Workspace)
   - App name: "Jonathan Wallace Dashboard"
   - Add Jonathan's email as a test user
   - Scopes: add `https://www.googleapis.com/auth/gmail.send` and
     `https://www.googleapis.com/auth/gmail.compose`
4. **APIs & Services → Credentials** → **Create credentials → OAuth client ID**
   - Type: **Web application**
   - Authorized redirect URIs: `https://developers.google.com/oauthplayground`
     (we'll use the playground to mint a refresh token)
   - Save; copy the **client ID** and **client secret**
5. Visit https://developers.google.com/oauthplayground
   - Click the gear icon (top right) → check **Use your own OAuth credentials**
     → paste the client ID + secret
   - Step 1: pick scopes → enter manually
     `https://www.googleapis.com/auth/gmail.send`
     `https://www.googleapis.com/auth/gmail.compose`
   - **Authorize APIs** → sign in as `jonathanwallacerealestate@gmail.com`
   - Step 2: **Exchange authorization code for tokens** → copy the
     **refresh token** (long string starting `1//`)
6. Set in Railway:
   ```
   GMAIL_CLIENT_ID=...apps.googleusercontent.com
   GMAIL_CLIENT_SECRET=...
   GMAIL_REFRESH_TOKEN=1//...
   GMAIL_USER=jonathanwallacerealestate@gmail.com
   ```

Test by sending Jonathan a "Brief Me" email from the dashboard once deployed.

---

## 6. API reference (29 routes)

All routes under `/api/*` require the header `X-API-Key: <API_KEY>` unless noted.
Spotify callback and dashboard PWA assets are public.

```
PUBLIC
  GET   /                              ← API root info
  GET   /api/health                    ← Healthcheck (Railway uses this)
  POST  /api/contact                   ← Marketing site contact form
  POST  /api/seller-form               ← Marketing site seller intake
  GET   /api/seller-form/:sessionId    ← Resume a saved seller form draft
  GET   /api/listings                  ← Public listings feed
  GET   /api/spotify/callback          ← Spotify OAuth landing
  GET   /dashboard                     ← Dashboard HTML (gated by ?key=)
  GET   /dashboard/manifest.json       ← PWA manifest
  GET   /dashboard/sw.js               ← Service worker
  GET   /dashboard/assets/:file        ← Dashboard CSS/JS/icons

AUTH-GATED (X-API-Key)
  /api/tasks                ← Claude agent task queue (CRUD + /quick)
  /api/personal-tasks       ← Personal to-dos
  /api/emails               ← Flagged Gmail messages needing reply
  /api/follow-ups           ← CRM follow-ups (synced from Follow-Up Boss)
  /api/calendar             ← Today's calendar events (synced from Google)
  /api/closings             ← Closings + P&L; /api/closings/pnl for monthly
  /api/workouts             ← Workout log
  /api/meals                ← Meal plan with macro rollups
  /api/marketing            ← Marketing items (drafts, scheduled, posted)
  /api/categories           ← Custom dashboard sections + /:slug/items
  /api/sync/follow-up-boss  ← Make.com push from FUB
  /api/sync/gmail           ← Make.com push from Gmail filters
  /api/sync/calendar        ← Make.com push from Google Calendar
  /api/sync/marketing       ← Make.com push when posts publish
  /api/daily-brief          ← One-shot aggregator (powers the dashboard)
  /api/settings             ← Runtime config (CRUD + /bulk)
  /api/brief
    /summary                ← Morning briefing (Claude, spoken)
    /gaps                   ← "What did I forget?" analysis
    /weekly                 ← Weekly review reflection
    /email                  ← Compose + send today's plan via Gmail
  /api/events/stream        ← SSE for live dashboard updates (uses ?key=)
  /api/intuition
    /vocabulary             ← Custom terms Claude knows (CRUD)
    /memory                 ← Long-term preferences/tactics (CRUD)
    /learn-from-task/:id    ← Auto-suggest vocab/memory from a task result
  /api/letters              ← Letters of Opinion (CRUD + generate + print)
  /api/chrome
    /credentials            ← AES-256-GCM encrypted vault
    /workflows              ← Named browser workflows + /:id/run
  /api/tools                ← Business Tools catalog (Chrome bookmark import)
  /api/schedules            ← Recurring jobs + /:id/run-now
  /api/activity             ← Activity log + /counts + /goals
  /api/power-hour           ← Hour of Power sessions + /calls + /analyze
  /api/learning             ← Learning Capture (CRUD + /analyze + /apply)
    /voice-capture          ← Quick voice memo, auto-attached to recent
  /api/spotify
    /status, /auth-url      ← OAuth setup
    /sync                   ← Pull recently-played podcast episodes
```

---

## 7. Database — 24 tables

All defined in `backend/src/db/init.js` and created via `CREATE TABLE IF NOT
EXISTS` on every app boot. Idempotent and safe to re-run.

```
contacts              listings            webhook_logs        tasks
seller_forms          dashboard_categories app_settings       agent_vocabulary
agent_memory          custom_items        site_credentials    chrome_workflows
business_tools        scheduled_tasks     letter_opinions     activity_log
lead_gen_goals        power_hour_sessions power_hour_calls    learning_sources
learning_log          personal_tasks      flagged_emails      crm_followups
calendar_events       closings            workouts            meal_plan
marketing_items
```

Seeded data (idempotent via `ON CONFLICT DO NOTHING` / `DO UPDATE`):
- 9 built-in dashboard categories (Tasks, Emails, CRM, Calendar, Closings, Personal, Workouts, Meals, Marketing)
- 28 vocabulary terms (LOO, FUB, MLS, Realm, PropTx, OnePoint, TRREB, AMP SSO, all SOGB municipalities, etc.)
- 9 long-term memory entries (voice rules, default open-house slot, market area, brokerage, etc.)
- 5 default lead-gen goals (calls 30/day, connected 10/day, emails 20/day, contacts 5/day, follow-ups 15/day)
- 1 Realm credential placeholder + 3 Realm Chrome workflows
- 8 default app_settings entries (timezone, daily targets, dashboard greeting, Spotify keys placeholder)

---

(continued in part 2)

## 8. Deploying the backend to Railway

### First-time setup

1. Sign in at https://railway.com → **New Project → Deploy from GitHub repo** →
   pick `jonathanwallacerealestate-sys/jonathanwallace.ca`.
2. Railway creates a service. Open it, then:
   - **Settings → Source → Root directory**: `backend`
   - **Settings → Build**: leave Nixpacks (auto-detected from `railway.toml`)
   - **Settings → Deploy → Start command**: leave default
     (`node src/index.js` from `railway.toml`)
   - **Settings → Networking → Generate Domain** — copy the resulting
     `something-production.up.railway.app` URL. This is your **public URL**.
3. **Add Postgres**: project → **+ New → Database → PostgreSQL**. Railway will
   automatically inject `DATABASE_URL` into your service.
4. **Variables tab** — paste in everything from §4 (Required + Recommended).
5. Trigger a deploy (push to `main` or click **Deploy** in the UI).
6. Watch **Deployments → Logs**. You should see:
   ```
   Database tables verified/created
   Database initialized
   Task worker started
   Scheduler started
   API server running on port 3000
   ```
7. Verify: `curl https://<railway-url>/api/health` → `{"status":"healthy",...}`
8. Open `https://<railway-url>/dashboard?key=<API_KEY>` → you should see the
   login page if the key is wrong, or the full dashboard if right.

### Subsequent deploys

- Push to `main` → Railway auto-deploys in ~60 seconds.
- Database migrations run automatically — no manual step.
- To **rollback**: Railway → **Deployments** → click any prior successful
  deploy → **Redeploy** (~30 sec).

---

## 9. Deploying the marketing site to Netlify

The static site already deploys from `main`. If wiring it up fresh:

1. Netlify → **Add new site → Import an existing project** → pick the same
   GitHub repo.
2. **Build settings**:
   - Build command: *(empty)*
   - Publish directory: `.` (repo root)
3. **Domain settings** → add `jonathanwallace.ca` → Netlify auto-provisions SSL.

### Wiring `jonathanwallace.ca/dashboard` → Railway

By default the dashboard is reachable only at the Railway URL. To proxy it
through `jonathanwallace.ca`:

1. Open `netlify.toml` in the repo (root).
2. Find the commented-out `# Agent Command Center — proxy to Railway backend.`
   block.
3. Replace `RAILWAY_APP_URL_HERE` (4 occurrences) with the **host portion** of
   your Railway URL. E.g. if Railway gave you
   `https://torg-production-1a2b.up.railway.app`, paste
   `torg-production-1a2b.up.railway.app` (no `https://`, no path).
4. Delete the leading `#` from the three `[[redirects]]` blocks.
5. Commit + push. Netlify auto-redeploys in ~30 sec.
6. Verify: `https://jonathanwallace.ca/dashboard?key=<API_KEY>` should now
   serve the dashboard.

### Eventual subdomain cutover (`dashboard.jonathanwallace.ca`)

1. Railway → **Settings → Networking → Custom Domain** → add
   `dashboard.jonathanwallace.ca`. Railway gives you a CNAME target.
2. In your DNS provider, add:
   ```
   CNAME  dashboard  <your-app>.up.railway.app.
   ```
3. Wait for SSL provisioning (~1 min).
4. Update `backend/src/index.js` CORS origins to include
   `https://dashboard.jonathanwallace.ca`.
5. (Optional) Remove the Netlify proxy redirects since the subdomain is
   now self-serving.

---

## 10. Make.com scenarios (5 webhooks Jonathan needs to wire up)

Each scenario pushes data **into** the dashboard via a `POST`. All endpoints
require the header `X-API-Key: <API_KEY>`. Payloads are idempotent (upsert by
external ID) so retries are safe.

### A. Follow-Up Boss → CRM follow-ups
- Trigger: FUB webhook (`task.created`, `task.updated`, `person.updated`)
- Action: `POST https://<railway-url>/api/sync/follow-up-boss`
- Body: see `backend/DASHBOARD.md` for full payload schema

### B. Gmail → Flagged emails
- Trigger: Gmail "Watch emails" matching label `dashboard-flag` or starred
- Action: `POST /api/sync/gmail`

### C. Google Calendar → Today's events
- Trigger: Scheduler 6:00 AM daily + Calendar Watch on changes
- Action: `POST /api/sync/calendar` (batch array)

### D. Marketing publishers (optional)
- After Buffer / Meta Graph / LinkedIn API publishes, push the result back
- Action: `POST /api/sync/marketing` with `external_id`, `status: "posted"`,
  `metrics`

### E. Backend Calendar/Drive tools (already wired)
- The `claude.js` service POSTs to a Make.com webhook for calendar event
  creation and Google Drive search. Webhook URL is hardcoded at
  `backend/src/services/claude.js:120`. To rotate, edit that line and redeploy
  (or move it to an env var).

Full payload templates: `backend/DASHBOARD.md`.

---

## 11. Post-deploy verification checklist

Run after every fresh deploy or major env-var change:

- [ ] `GET /api/health` returns `{"status":"healthy"}`
- [ ] Railway logs show "Database tables verified/created" and "Scheduler started"
- [ ] `GET /dashboard?key=<API_KEY>` loads the dashboard (not the login page)
- [ ] Dashboard shows the 14 sections
- [ ] Settings (gear icon) opens the drawer with no errors
- [ ] Click "Brief Me" → Claude responds (proves `ANTHROPIC_API_KEY` works)
- [ ] Click "Email My Day" → email arrives (proves Gmail OAuth works)
- [ ] Quick-log a call in Lead Generation → counter increments
- [ ] Open Personal Tasks card → quick-add a task → it appears
- [ ] (PWA) On iPhone Safari → Share → Add to Home Screen → launches as app
- [ ] If wired up, `https://jonathanwallace.ca/dashboard?key=...` works via
      Netlify proxy

---

## 12. Operations & monitoring

| Thing to check | Where |
|---|---|
| App health | `GET /api/health` (Railway healthcheck pings this every ~30s) |
| Live logs | Railway service → **Logs** tab |
| Database queries | Railway → Postgres plugin → **Data** tab (browse tables) |
| Active SSE clients | `GET /api/events/subscribers` |
| Worker stats | Logs print "Health: N tasks completed, M errors" every 5 min |
| Scheduled jobs | `GET /api/schedules` returns `last_run_at`, `last_status`, `next_run_at` |

### Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Service won't start, "ECONNREFUSED" | `DATABASE_URL` not set | Attach Postgres plugin in Railway |
| All `/api/*` return 401 | API_KEY mismatch between client and server | Verify `?key=` matches Railway env var exactly |
| Dashboard loads but Brief Me 503 | `ANTHROPIC_API_KEY` missing | Set in Railway, restart |
| Scheduler appears stuck | Time-zone math drift | `POST /api/schedules/:id/run-now` to trigger manually; check Railway logs |
| Make.com push gets 401 | API key changed | Update `X-API-Key` header in each Make.com scenario |
| PWA stale after deploy | Service worker cached | Bump `CACHE_VERSION` in `backend/src/views/sw.js` |
| Hour-of-Power transcript empty | Browser doesn't support Web Speech API | Use Chrome or Safari; Firefox/Edge don't support it |

### Rotating the API key

1. Generate new key (`openssl rand -hex 32`)
2. Update Railway env `API_KEY` → service auto-restarts
3. Update Make.com scenarios with new key
4. Tell Jonathan the new key (he'll need to sign in again on each device)
5. **If `CREDENTIALS_ENCRYPTION_KEY` was NOT set explicitly**, all stored Chrome
   credentials become un-decryptable. Set `CREDENTIALS_ENCRYPTION_KEY` BEFORE
   first use to avoid this.

### Backups

Railway Postgres has automatic daily backups (paid plan). For belt-and-braces:
```
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```

---

## 13. Known limitations (truthful "not done" list)

| Area | Status |
|---|---|
| Spotify auto-sync schedule | Manual button works; nightly auto-pull is one schedule entry away |
| Audible API | None exists publicly. Capture is voice (F7) + manual paste only |
| Audio storage | Hour-of-Power calls store transcript text only — no audio blob |
| Hour-of-Power CRM auto-suggest | "Start Call" prompts for name; CRM autocomplete not wired |
| Tool launcher palette (F4) | Discussed; not built |
| Programmatic Claude Chrome execution | We compose the prompt; user pastes into the extension to actually drive the browser |
| Frontend test suite | None |
| Multi-replica scaling | Scheduler + SSE pub/sub are in-process. If Railway scales beyond one replica, swap scheduler for `pg-boss` and SSE for Redis pub/sub |
| Audit logging | `webhook_logs` captures Make.com payloads; no broader audit trail |
| 2FA on dashboard login | API key only |

---

## 14. Where to look when something needs changing

| To change… | Edit this |
|---|---|
| A schema column | `backend/src/db/init.js` (CREATE TABLE block + index list). Re-run startup. New columns won't drop existing rows; column-type changes need manual ALTER. |
| A Claude system prompt | `SYSTEM_PROMPT` in `backend/src/services/claude.js`, or the per-feature prompts in `backend/src/routes/briefing.js`, `letters.js`, `powerHour.js`, `learning.js`, `tools.js` |
| Available agent tools | `TOOLS` array in `backend/src/services/claude.js`; add executor to `executeDashboardTool()` |
| Default seed data (vocab, memory, goals, categories) | `backend/src/db/init.js` — search for `INSERT INTO ... ON CONFLICT` blocks |
| Dashboard section colors / labels | `backend/src/db/init.js` `dashboard_categories` seed |
| Dashboard CSS | `backend/src/views/dashboard.css` |
| A specific dashboard card behaviour | `backend/src/views/dashboard.<name>.js` (one file per major card) |
| Scheduler tick interval | `POLL_INTERVAL_MS` in `backend/src/services/scheduler.js` (default 60s) |
| Worker poll interval | `POLL_INTERVAL` in `backend/src/services/worker.js` (default 10s) |
| Marketing site copy | Static HTML files in repo root + `communities/` |
| Netlify redirects / headers | `netlify.toml` |

---

## 15. Documentation pointers in this repo

- **`HANDOFF.md`** *(this file)* — deployment + ops handoff
- **`DEPLOY.md`** — high-level deployment workflows + online-editing flows
- **`backend/DASHBOARD.md`** — full API reference + Make.com scenario JSON
  payload templates
- **`README.md`** — marketing site customization (colors, copy, contact)
- **`backend/.env.example`** — minimal env var template

---

## 16. First-day-on-the-job checklist for a new engineer

1. Clone the repo, read this doc top to bottom
2. Verify Railway access; sign in and look at the existing service
3. Verify Netlify access; look at the existing site
4. Run `GET /api/health` to confirm the backend is up
5. Open the dashboard with Jonathan's API key, walk through each section
6. Read `backend/src/index.js` (only ~50 LOC) — it's the wiring map for
   everything
7. Read `backend/src/db/init.js` — gives you the entire data model in one place
8. Pick one feature (e.g. Letter of Opinion) and trace it end-to-end:
   `dashboard.html` → `dashboard.letters.js` → `routes/letters.js` →
   `services/intuition.js` → Anthropic API → `db/init.js` `letter_opinions`
   table → printable HTML view at `/api/letters/:id/print`
9. You now understand the architecture. Everything else is a variant of that
   pattern.

---

## 17a. Follow Up Boss (FUB) — direct API integration

FUB is wired up as a first-class citizen. The Make.com sync webhook at
`/api/sync/follow-up-boss` still exists for event-based pushes, but the
dashboard now talks to FUB's REST API directly for both reads and writes.

### Configuration

Two ways — env var takes precedence:

1. **Railway env var** (recommended for production):
   `FUB_API_KEY=fka_...` → service restart
2. **Dashboard Settings**: open Settings (gear) → Follow Up Boss section
   → paste the key into the masked field → Save All. Stored in
   `app_settings.fub_api_key`. Enter a new key here and it takes effect
   on the next request (60s cache TTL max).

### Where to get the key

1. Follow Up Boss → **Admin** → **API**
2. **Create API Key** → name it "JW Dashboard"
3. Copy the key (starts `fka_`)

### Available routes (all require `X-API-Key` header)

```
GET   /api/fub/status             configured + connected + whoami
POST  /api/fub/test               explicit connection test
GET   /api/fub/people             list (?search, ?limit, ?offset, ?stage)
GET   /api/fub/people/:id         person + events + notes + tasks
POST  /api/fub/people             create
PATCH /api/fub/people/:id         update (e.g. stage change)
GET   /api/fub/tasks              list (?status, ?dueAfter, ?dueBefore)
POST  /api/fub/tasks              create
PATCH /api/fub/tasks/:id          update
POST  /api/fub/tasks/:id/complete mark done + mirror to crm_followups
POST  /api/fub/notes              create
GET   /api/fub/stages             list pipeline stages
GET   /api/fub/users              list FUB team members
GET   /api/fub/deals              list deals
POST  /api/fub/deals              create
GET   /api/fub/pipelines          list pipelines
GET   /api/fub/smart-lists        list smart lists
POST  /api/fub/sync               pull open tasks → upsert into crm_followups
```

### Background sync schedule

A pre-seeded schedule named `FUB — hourly sync` exists in `scheduled_tasks`,
**disabled by default**. Once `fub_api_key` is set:

1. Dashboard → Settings → Scheduled Jobs → Manage
2. Find `FUB — hourly sync`, click the pause/enable toggle
3. It will now auto-pull every hour at :00, keeping the CRM card fresh

Alternatively, click **Pull from FUB** on the CRM card toolbar for an
on-demand sync.

### Claude agent tools (6 new)

Jonathan can say things like *"Add Sarah Mitchell as a lead, phone
705-555-1234, she's looking in Midland under $800k"* and Claude does it.

- `fub_find_person`   — search by email/phone/name (returns candidates when ambiguous)
- `fub_add_note`      — log a thought/call recap against a contact
- `fub_create_task`   — schedule a follow-up tied to a contact
- `fub_complete_task` — mark a FUB task done
- `fub_update_stage`  — move contact through pipeline
- `fub_create_person` — register a brand-new lead (with optional first-contact note)

All route through `services/fub.js` with 60s GET-response caching and
write-through cache invalidation. Graceful 503 when the key isn't set.

### Dashboard UI surface

- **Settings → Follow Up Boss section**: API key field (password input, masked),
  connection status row, Test Connection button, Sync Now button
- **CRM card toolbar**: "Pull from FUB" (manual sync) + "+ FUB Task" (opens
  a modal with debounced live person search, then posts to FUB and
  auto-syncs so the new task appears in the dashboard immediately)
- **CRM card list items**: still driven by `crm_followups` table which is
  kept in sync by the schedule / manual sync / Make.com pushes (any of
  the three keeps it fresh)

### Intuition layer additions

- **Vocabulary**: updated `FUB` entry + added `Follow Up Boss` term
- **Memory**: new `fub_integration` entry telling Claude to prefer FUB
  tools over `create_crm_followup` when the contact lives in FUB

### Rate limiting

FUB's documented limit is 250 requests per 10 seconds. Our sync pulls
~50-100 requests per run (1 list call + 1 per-person detail call for
up to 100 tasks). Well under the limit even at hourly cadence.

### Rotating the key

1. FUB → Admin → API → revoke old key → create new one
2. Paste new key in Dashboard Settings (or update `FUB_API_KEY` env var)
3. Save. No data migration needed — old tasks stay linked by
   `fub_event_id` + `fub_person_id` in `crm_followups`.

### Testing after first setup

```
# 1. Verify the key
POST /api/fub/test
→ { "success": true, "whoami": { "name": "...", "email": "..." } }

# 2. Pull a fresh batch
POST /api/fub/sync
→ { "success": true, "upserted": N, "fetched": N }

# 3. Verify in dashboard
CRM card should show your FUB open tasks.
```

---

## 17. Contact

- **Repo**: https://github.com/jonathanwallacerealestate-sys/jonathanwallace.ca
- **Original PR**: https://github.com/jonathanwallacerealestate-sys/jonathanwallace.ca/pull/1
- **Built by**: Claude (Anthropic) via Claude Code session
- **Owner**: Jonathan Wallace — jonathanwallacerealestate@gmail.com

Built with HTML, CSS, JavaScript, Node.js, Express, PostgreSQL, Anthropic Claude
SDK, and the Web Speech API. Hosted on Netlify (frontend) + Railway (backend).
