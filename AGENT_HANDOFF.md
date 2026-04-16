# Agent Handoff — Jonathan Wallace's Command Center

> **For the next Claude agent picking this up in Cowork.**
> Read top to bottom. Everything you need is here. Jonathan is non-technical
> — speak plainly, one step at a time, never tell him to edit code.

---

## The situation right now (April 2026)

Jonathan Wallace is a real estate agent in Southern Georgian Bay, Ontario.
Over a multi-session build I created a full **Agent Command Center** — a
private dashboard with 14 sections, 30+ API routes, deep Follow Up Boss
CRM integration (25 rounds), an EA-style email engine, voice I/O, Claude
agent tools, scheduled jobs, and more. **The code is all shipped to `main`
and auto-deployed to Railway. The server is healthy.**

### What's broken RIGHT NOW

**Two integrations aren't working on the live dashboard:**

1. **Email (Gmail) — not populating.** The "Sync now" button in the Emails
   card does nothing visible. Root cause is almost certainly missing or
   wrong-scoped Gmail env vars in Railway. The email engine needs
   `gmail.modify` scope (read + send + compose + label) but the original
   OAuth docs only said `gmail.send + gmail.compose`. A diagnostic
   endpoint exists at `GET /api/emails/diag` and a "⚕ Check" button
   in the Emails card header runs it with a visual checklist.

2. **Follow Up Boss — not connecting.** Jonathan previously pasted his FUB
   API key (`fka_0RcpFZ...`) in chat and I told him to set it as
   `FUB_API_KEY` in Railway Variables. It may not have stuck — or the
   service restarted and dropped it. Check `GET /api/fub/status`.

**YOUR FIRST JOB: walk Jonathan through his Railway Variables tab to
confirm what's set and what's missing. Then fix each one.**

---

## Who Jonathan is

- **Real estate agent**, Southern Georgian Bay (SOGB): Midland,
  Penetanguishene, Tiny Township, Tay Township, Wasaga Beach
- **Brokerage**: The Official Realty Group (TORG)
- **MLS**: Realm on PropTx OnePoint (`tools.proptx.ca/onepoint`), SSO via
  AMP (`sso.ampre.ca`). NOT Matrix.
- **CRM**: Follow-Up Boss (FUB)
- **Email**: `jonathanwallacerealestate@gmail.com`
- **Automation**: Make.com for webhooks
- **Uses Wispr Flow** for voice dictation (system-wide, Fn key)
- **Uses Claude Chrome** extension for browser workflows
- **Non-technical.** Never tell him to edit code. Do it for him.

---

## Quick URLs

| What | URL |
|---|---|
| Dashboard (direct) | `https://jonathanwallaceca-production.up.railway.app/dashboard?key=API_KEY` |
| Dashboard (via site) | `https://jonathanwallace.ca/dashboard?key=API_KEY` |
| Health check | `https://jonathanwallaceca-production.up.railway.app/api/health` |
| FUB status | `https://jonathanwallaceca-production.up.railway.app/api/fub/status` |
| Gmail diagnostic | `https://jonathanwallaceca-production.up.railway.app/api/emails/diag` |
| GitHub repo | `https://github.com/jonathanwallacerealestate-sys/jonathanwallace.ca` |
| Railway project | `https://railway.com/project/1db0b520-8a6b-42fb-9e17-6b50370c54e4` |

---

## PRIORITY 1: Fix the broken integrations

### Step 1 — Audit Railway Variables

Walk Jonathan to: **Railway → his service → Variables tab**

Have him confirm each of these exists (eye icon to reveal, he doesn't
need to share values — just yes/no):

| Variable | Required for | Notes |
|---|---|---|
| `DATABASE_URL` | Everything | Auto-set by Postgres plugin |
| `API_KEY` | Dashboard login | He's already logged in so this exists |
| `ANTHROPIC_API_KEY` | All Claude features | Starts `sk-ant-` |
| `FUB_API_KEY` | Follow Up Boss | Starts `fka_`. If missing, he needs to re-add it |
| `GMAIL_CLIENT_ID` | Email engine | Google Cloud OAuth client ID |
| `GMAIL_CLIENT_SECRET` | Email engine | Google Cloud OAuth client secret |
| `GMAIL_REFRESH_TOKEN` | Email engine | Long string starting `1//`. **Must be minted with `gmail.modify` scope** |
| `GMAIL_USER` | Email engine | `jonathanwallacerealestate@gmail.com` |
| `NODE_ENV` | Production mode | Should be `production` |

**For each missing variable, here's what to do:**

### If `FUB_API_KEY` is missing

1. Jonathan goes to Follow Up Boss → **Admin → API**
2. Click **Create API Key** → name it "JW Dashboard"
3. Copy the key (starts with `fka_`)
4. Railway → Variables → **+ New Variable** → Name: `FUB_API_KEY`,
   Value: paste the key
5. Railway auto-restarts (~30 sec)
6. Verify: open dashboard → Settings (gear) → FUB section should show green

### If ALL FOUR `GMAIL_*` variables are missing

This is the bigger setup. The email engine needs a Google OAuth refresh
token with **`gmail.modify`** scope (covers read inbox + send + compose +
label + archive).

**Walk Jonathan through this step by step:**

1. Go to https://console.cloud.google.com → pick or create a project
2. **APIs & Services → Library** → search "Gmail API" → **Enable**
3. **APIs & Services → OAuth consent screen**
   - User type: External
   - App name: "JW Dashboard"
   - Add `jonathanwallacerealestate@gmail.com` as test user
   - Scopes: skip for now (we'll set them in the playground)
4. **APIs & Services → Credentials** → **Create credentials → OAuth client ID**
   - Type: **Web application**
   - Authorized redirect URIs: add exactly:
     `https://developers.google.com/oauthplayground`
   - Save → copy the **Client ID** and **Client Secret**
5. Open https://developers.google.com/oauthplayground
   - Click the ⚙ gear (top right) → check **Use your own OAuth credentials**
   - Paste Client ID + Client Secret
   - Step 1: in the scope input box, type exactly:
     `https://www.googleapis.com/auth/gmail.modify`
   - Click **Authorize APIs** → sign in as `jonathanwallacerealestate@gmail.com`
   - Grant access
   - Step 2: click **Exchange authorization code for tokens**
   - Copy the **Refresh token** (long string starting `1//`)
6. In Railway → Variables, add these four:
   - `GMAIL_CLIENT_ID` = the client ID from step 4
   - `GMAIL_CLIENT_SECRET` = the client secret from step 4
   - `GMAIL_REFRESH_TOKEN` = the refresh token from step 5
   - `GMAIL_USER` = `jonathanwallacerealestate@gmail.com`
7. Railway auto-restarts
8. On the dashboard Emails card → click **⚕ Check** → should show all green
9. Click **Sync now** → emails should start populating

### If `GMAIL_REFRESH_TOKEN` exists but email still doesn't work

The token was probably minted with `gmail.send` + `gmail.compose` (old
instructions) which can't read the inbox. Re-mint it:
- Repeat steps 5-7 above, making sure the scope is `gmail.modify`
- Replace the old `GMAIL_REFRESH_TOKEN` value in Railway

---

## PRIORITY 2: Enable the scheduled jobs

Once the integrations are fixed, have Jonathan open:
**Dashboard → Settings (gear) → Scheduled Jobs → Manage**

Enable these (they're pre-seeded but disabled):

| Schedule | What it does |
|---|---|
| **FUB — hourly sync** | Pulls FUB tasks + appointments into the dashboard |
| **FUB — auto-respond to new leads** | Creates outreach tasks for fresh leads |
| **Email — active Gmail poll** | Scans inbox hourly, Claude triages each email |
| **Email — EA nudge digest** | Twice daily reminder for unanswered emails with attachments |
| **FUB — weekly attribution digest** | Monday 7am email with lead-source breakdown |

---

## What the dashboard has (complete inventory)

### 14 dashboard sections
Tasks · Emails (EA engine) · CRM Follow-ups · Calendar · Lead Gen +
Hour of Power · Closings & P&L · Personal Tasks · Workouts · Meals ·
Marketing · Learning Capture · Seller Forms · Letters of Opinion · Custom

### Top-bar buttons
🎙 Brief Me (F6) · ⚠ What did I forget? · 📊 Weekly Review ·
✉ Email My Day · ↻ Refresh · ⚙ Settings

### Voice hotkeys
F5 tap = focus agent + mic · F5 hold = push-to-talk (auto-sends,
Claude speaks reply) · F6 = Brief Me · F7 = learning capture · Esc = stop

### P&L card tools
📊 Lead source report · 🔻 Conversion funnel · ⏰ Generate deadline tasks ·
📋 Per-deal checklist generator · Push to FUB Deals

### Email EA features
Active Gmail poll · AI triage (priority/category/summary/suggested action) ·
Auto-label newsletters/junk · Forgotten-response nudges · Deep-link to Gmail ·
Claude draft replies + FUB note logging · Filter tabs (To reply / Urgent /
Attachments / Clients / Leads / Contracts / All)

### FUB integration (25 rounds)
Direct API client · Contact search + detail modal · Pre-call brief ·
Hour of Power auto-push (notes + tasks to FUB) · Inbox zero (FUB badges on
email senders) · Deal sync (closings → FUB Deals) · Smart list filter ·
Bulk action with Claude personalization · Appointments → Calendar ·
Contact enrichment (research note) · Lead source attribution · Auto-respond
to new leads · Two-way task completion · New-lead alerts in morning brief ·
Listing-match alerts · Showing-day prep brief · Contract deadline auto-tasks

### Claude agent tools (14+)
create_personal_task · create_crm_followup · log_workout · add_meal ·
schedule_marketing · complete_task · search_dashboard · fub_find_person ·
fub_add_note · fub_create_task · fub_complete_task · fub_update_stage ·
fub_create_person · fub_enrich_contact · fub_attribution_report ·
fub_bulk_action · fub_list_smart_lists · fub_apply_template ·
generate_deal_checklist · show_conversion_funnel

### Other systems
PWA (installable) · Service worker (offline) · Intuition layer (28 vocab +
9 memory, auto-injected into every Claude call) · Scheduled jobs (10 kinds) ·
AES-256-GCM credential vault · Chrome workflow framework · Business tools
catalog (bookmark import) · Nurture templates · Spotify OAuth · Learning
capture with voice memos

---

## Key files to know

| File | What it is |
|---|---|
| `backend/src/index.js` | Route wiring — 50 lines, the map to everything |
| `backend/src/db/init.js` | All 24+ tables + seeds + migrations |
| `backend/src/services/claude.js` | All Claude tool definitions + system prompt |
| `backend/src/services/fub.js` | FUB API client |
| `backend/src/services/gmail.js` | Gmail API client + diagnose() |
| `backend/src/services/emailPoller.js` | Active inbox scanner + nudge finder |
| `backend/src/services/emailTriage.js` | Claude email categorizer |
| `backend/src/services/scheduler.js` | In-process cron (10 job kinds) |
| `backend/src/views/dashboard.html` | Dashboard shell (14 sections) |
| `HANDOFF.md` | Full technical deployment reference (519 lines) |
| `DEPLOY.md` | Netlify + Railway topology + online editing flows |
| `MORNING_NOTE.md` | Latest feature summary for Jonathan |

---

## Things you must NOT do

- **Don't change API_KEY** without warning — locks Jonathan out instantly
- **Don't push to `main` casually** — Railway auto-deploys every commit
- **Don't drop tables** — `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD
  COLUMN IF NOT EXISTS` only. Never destructive SQL.
- **Don't store secrets in code** — env vars in Railway or app_settings table
- **Don't promise Audible integration** — no API exists. Voice capture only.
- **Don't say "won't last" or "dream home"** — Jonathan's voice rules

---

## How to talk to Jonathan

- One step at a time. Numbered lists.
- Plain English. "Open your Railway Variables tab" not "audit the env manifest."
- He uses Wispr Flow — his messages may be dictated and slightly rough.
- Real estate vocabulary is fine: LOO, FUB, MLS, firm date, conditional,
  APS, SPIS, CMA, GCI, DOM, SOGB, TORG — he knows all of these.
- If something's broken, diagnose before speculating. Use the built-in
  diagnostic endpoints (/api/health, /api/fub/status, /api/emails/diag).

---

## The handoff, in one breath

Code is shipped. Server is healthy. Two integrations (Email + FUB) aren't
working because Railway env vars are likely missing or misconfigured.
**Step 1: audit Railway Variables with Jonathan. Step 2: fix what's missing
(FUB key is a paste, Gmail needs the OAuth playground walkthrough).
Step 3: enable the scheduled jobs. Step 4: click Sync now on Emails +
pull from FUB.** Everything else works — he just needs these two
connections wired up.
