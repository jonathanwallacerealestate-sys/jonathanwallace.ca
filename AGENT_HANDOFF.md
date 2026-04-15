# Agent Handoff — Jonathan Wallace's Command Center

> **For the next Claude agent / coworker picking this up.**
> Read this top to bottom. Everything you need to help Jonathan is here.

---

## The situation in one paragraph

Jonathan Wallace is a real estate agent in Southern Georgian Bay, Ontario.
Over multiple sessions I built him a full **Agent Command Center** — a
private dashboard that aggregates his tasks, email triage, CRM follow-ups,
calendar, closings + P&L, personal to-dos, workouts, meals, marketing,
Letters of Opinion, and Hour-of-Power prospecting blocks with live call
recording + Claude analysis. The backend is deployed to Railway, the
marketing site is on Netlify, and everything is wired through the Claude
Sonnet 4 API. **The code is all shipped and the server is running
healthy.** Jonathan is now blocked because he doesn't know his own API key
(to log into the dashboard) and isn't sure which environment variables are
actually set in Railway. **Your job is to guide him through logging in and
verifying the env vars, then walk him through using the dashboard for the
first time.** He is not a developer — speak plainly, one step at a time,
and never assume he can edit code.

---

## Who Jonathan is (use this, don't ignore it)

- **Real estate agent**, Southern Georgian Bay (SOGB): Midland, Penetanguishene,
  Tiny Township, Tay Township, Wasaga Beach. Collingwood is a secondary market.
- **Brokerage**: The Official Realty Group (TORG).
- **MLS**: Realm on PropTx OnePoint (`tools.proptx.ca/onepoint`), SSO via AMP
  (`sso.ampre.ca`). Not Matrix.
- **CRM**: Follow-Up Boss (FUB).
- **Email**: `jonathanwallacerealestate@gmail.com`, Gmail OAuth.
- **Automation**: Make.com for CRM/Gmail/Calendar webhooks.
- **Listens to**: podcasts (Spotify) + audiobooks (Audible) — wants insights
  captured into the dashboard.
- **Uses Wispr Flow** for voice dictation on his laptop (system-wide, Fn key).
- **Uses Claude Chrome** extension for browser workflows on sites without APIs.
- **Non-technical.** He does not know the difference between Railway and
  Netlify intuitively. Explain the architecture when it matters, but don't
  overdo it. Never tell him to "edit netlify.toml" — do it for him.

---

## Deployment state (current as of handoff)

### ✅ What's working

- **GitHub repo**: `jonathanwallacerealestate-sys/jonathanwallace.ca` on `main`
  at commit `c6a0aff`.
- **Railway backend**: live at
  `https://jonathanwallaceca-production.up.railway.app`.
  Health check passes — `GET /api/health` returns `{"status":"healthy",...}`.
  All 24 Postgres tables migrated on boot, worker + scheduler started.
- **Netlify marketing site**: live at `jonathanwallace.ca`. A commit was
  just pushed to add the `/dashboard` and `/api/*` proxy to Railway — it
  should be redeployed by the time you read this.

### ⚠ What's blocking Jonathan right now

- **He doesn't know his `API_KEY`.** Without it he can't log into the
  dashboard. It's stored in Railway → service → Variables → `API_KEY`.
  If no value is set there, the dashboard is wide open (no auth) — in
  which case help him generate and set one.
- **Unknown: which other env vars are set in Railway.** He needs to
  audit `ANTHROPIC_API_KEY`, `GMAIL_*`, `CREDENTIALS_ENCRYPTION_KEY`.
  Guide him through the Railway Variables tab.

### ❓ What's unknown / unverified

- Whether Make.com scenarios for FUB / Gmail / Calendar are already pushing
  data to the new sync endpoints (the sync endpoints are new in this deploy).
- Whether the Netlify deploy of the proxy redirect actually succeeded.
  He can verify by visiting `https://jonathanwallace.ca/dashboard` — it
  should 302-redirect to the Railway URL. If not, Netlify may still be
  building or the redirect may have a typo.
- Whether he's registered a Spotify developer app yet. (Optional.)

---

## What the dashboard is (30-second version for him)

One mobile-first web page at `/dashboard?key=API_KEY` with 14 sections:
Tasks · Emails · CRM · Calendar · **Lead Gen + Hour of Power** · P&L ·
Personal · Workouts · Meals · Marketing · **Learning Capture** · Sellers ·
**Letters of Opinion** · Custom.

Top-bar buttons: **🎙 Brief Me**, ⚠ What did I forget?, 📊 Weekly Review,
✉ Email My Day, ↻ Refresh, ⚙ Settings.

Voice hotkeys: **F5 tap** = focus input + mic, **F5 hold** = push-to-talk
(auto-sends, Claude speaks reply), **F6** = Brief Me, **F7** = quick
learning capture, **Esc** = stop.

PWA — installable to home screen via Share → Add to Home Screen on iPhone.

---

## Your prioritized task list with Jonathan

### 1. Help him find or set the `API_KEY` *(blocker)*

Walk him through:

```
Railway project → click the non-Postgres service card
→ Variables tab
→ find "API_KEY"
→ click the eye icon 👁 to reveal the value
→ copy it
```

If `API_KEY` **doesn't exist**:
- Tell him to click **+ New Variable**
- Name: `API_KEY`
- Value: any 32+ char random string. Give him something like
  `openssl rand -hex 32` in a Mac Terminal, OR just suggest a strong
  passphrase he can remember (with a mix of letters, numbers, symbols).
- Warn him Railway will auto-restart the service (~30 sec) after adding.

Then have him open:
`https://jonathanwallaceca-production.up.railway.app/dashboard?key=THE_KEY`

First visit should show the dashboard. API key is saved in localStorage
automatically so future visits to `/dashboard` (no `?key=`) auto-redirect.

### 2. Audit the other Railway env vars

While he's in the Variables tab, have him confirm each of these exists
(eye icon to peek at the value, but he doesn't need to share it):

| Variable | Required for |
|---|---|
| `DATABASE_URL` | Auto-set by Postgres plugin. Must exist. |
| `API_KEY` | Dashboard login (from step 1) |
| `ANTHROPIC_API_KEY` | Everything Claude-powered (Brief Me, Weekly Review, agent tasks, Hour of Power analysis). Starts `sk-ant-`. |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_USER` | Sending emails |
| `NODE_ENV` | Should be `production` |

For each one missing, walk him through creating it. Gmail OAuth setup is in
`HANDOFF.md` §5 — it's the trickiest; only guide him through it if he wants
"Email My Day" / agent email tools to work immediately.

Strongly recommend adding `CREDENTIALS_ENCRYPTION_KEY` (any 64 hex chars) so
the Chrome credential vault survives `API_KEY` rotations.

### 3. First-visit dashboard verification

Once he can log in, guide him through these in order — pause after each:

1. **See the 14 sections.** If the page is blank, open browser console (F12 → Console tab) and have him paste errors to you.
2. **Tap Settings (⚙ top right) → Manage** on any row (Vocabulary, Chrome Workflows, Schedules). Confirms the drawer works.
3. **Scroll to Tasks card** → type into the compose box: *"Hello, are you there?"* → Send. A task should appear, go from pending → processing → completed in ~5 sec. Click to read response. This proves the full Claude pipeline works.
4. **Tap 🎙 Brief Me** (top right). With no Make.com data flowing yet it'll be a short "nothing urgent to report" greeting. That's fine — it proves briefing works.
5. **Scroll to Lead Generation card** → tap **+ Call** (with any name) → counter increments. Tap **Start** on Hour of Power → timer appears. He doesn't need to actually do a call.

### 4. Proactively explain what's *not* yet wired

He doesn't know this unless you tell him:

- **No data in CRM / Calendar / Emails yet** because Make.com scenarios
  targeting the new sync endpoints haven't been created. His old Make.com
  scenarios (if any) push to the Railway backend URLs — we need to confirm
  they still work and optionally add new scenarios per the templates in
  `backend/DASHBOARD.md`.
- **No Spotify sync yet** because he hasn't registered a Spotify developer
  app and plugged `client_id`/`client_secret` into Settings. Walk him
  through this only if he wants to use Learning Capture from podcasts.
  Audible is manual-only (no API exists).
- **No scheduled jobs yet** — Settings → Manage (Scheduled Jobs) is empty.
  Recommend a starter set:
  - Morning Briefing, daily 6:30am, email delivery
  - Weekly Review, Sundays 8pm, email delivery
  - Gap check, Wed + Sat 5pm, email delivery
- **Chrome workflows for Realm are pre-seeded** but the credential has no
  password yet. He needs to enter it manually: Settings → Claude Chrome
  Workflows → Manage → Credentials tab → edit `realm` → paste his TRREB/
  PropTx password (encrypted at rest with AES-256-GCM).

### 5. Check Netlify proxy status

Have him visit `https://jonathanwallace.ca/dashboard`. Expected: 302-redirect
to the Railway URL. If it shows the homepage or errors, check:

- Netlify dashboard → Deploys → is commit `c6a0aff` marked "Published"?
- If not, it might still be building, or a Netlify env var might be missing.
- Fallback: tell him to always use the Railway URL directly — the proxy
  is a convenience, not a requirement.

---

## Things you must NOT do

- **Don't change the API key without permission.** It will lock him out
  instantly.
- **Don't modify `netlify.toml` `[[redirects]]` without care** — the proxy
  was JUST fixed after shipping broken (placeholder `RAILWAY_APP_URL_HERE`
  in production for a few hours). Real value is
  `jonathanwallaceca-production.up.railway.app`.
- **Don't merge anything to `main` without flagging it.** Railway
  auto-deploys on every push to main.
- **Don't drop any table or run destructive SQL.** The schema has
  ~14,000 lines of his data model. Any migration must be additive
  (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
- **Don't assume he's looking at what you're looking at.** Tell him what
  to click, not what the code does.
- **Don't overpromise integrations** that don't exist. Audible has no API
  — be honest.

---

## How to communicate with Jonathan

- **One step at a time.** Numbered lists. Ask him to report back between
  steps.
- **Plain English.** "Find the Variables tab in Railway" not "audit the
  environment manifest."
- **Voice / written both fine.** He uses Wispr Flow and often dictates.
- **Real estate vocabulary is welcome** — LOO, FUB, MLS, firm date,
  conditional, APS, SPIS, CMA, GCI, DOM, SOGB — he understands all of
  these and uses them interchangeably. Claude in the dashboard already
  knows them (seeded into `agent_vocabulary` table).
- **Never say "won't last," "dream home," or other real-estate clichés.**
  That's in his seeded voice rules.

---

## Reference docs in the repo

| File | Use when |
|---|---|
| `HANDOFF.md` | You need the full technical deployment reference — every env var, every route, every table, Make.com scenario templates |
| `DEPLOY.md` | Deploy workflows, online-editing flows, subdomain cutover |
| `backend/DASHBOARD.md` | Make.com webhook payload schemas (FUB, Gmail, Calendar, Marketing) |
| `backend/src/db/init.js` | Source of truth for all 24 tables + seed data |
| `backend/src/services/claude.js` | All Claude tool definitions + system prompts |
| `backend/src/views/dashboard.html` | The dashboard shell (section order, button IDs) |
| `AGENT_HANDOFF.md` *(this file)* | The "pick up where I left off" note |

---

## Quick URLs

- **Dashboard (direct):** `https://jonathanwallaceca-production.up.railway.app/dashboard?key=API_KEY`
- **Dashboard (via jonathanwallace.ca):** `https://jonathanwallace.ca/dashboard?key=API_KEY` *(once Netlify proxy deploys)*
- **Health check:** `https://jonathanwallaceca-production.up.railway.app/api/health`
- **GitHub repo:** `https://github.com/jonathanwallacerealestate-sys/jonathanwallace.ca`
- **Railway project:** `https://railway.com/project/1db0b520-8a6b-42fb-9e17-6b50370c54e4`
- **Spotify developer dashboard:** `https://developer.spotify.com/dashboard` *(for later)*

---

## The handoff, in one breath

Deployment is done. Code shipped, server healthy, database migrated.
Jonathan needs to (1) find or set his Railway `API_KEY`, (2) audit the
other env vars, (3) log in, (4) click through the dashboard once to
confirm it works, (5) optionally wire up Make.com / Spotify /
scheduled jobs / the Realm credential for Chrome workflows. **Go help
him get unstuck on step 1 first.** Everything else cascades from there.
