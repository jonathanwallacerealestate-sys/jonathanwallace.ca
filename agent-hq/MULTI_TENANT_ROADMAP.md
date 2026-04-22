# Agent HQ — Multi-Tenant Roadmap

Started 2026-04-22. This document captures the architectural decisions and the step-by-step path from "Jonathan's personal dashboard" to "a platform multiple agents can use."

## Current status: Foundation installed (dormant)

Phase 1 is complete. The code below is in the repo but has zero effect on your dashboard until you attach a Postgres service on Railway.

When you open hq.jonathanwallace.ca today:
- No login required
- Your listings, FUB data, emails all load exactly as before
- JSON state files still live in `/data/*.json` as they always have
- The only new log line on boot: `[db] DATABASE_URL not set — multi-tenant subsystem dormant`

## Decisions locked in

1. **Database:** Postgres on Railway (will activate when you add the plugin)
2. **Onboarding:** Invite-only (admin creates accounts manually)
3. **Billing:** Free while finding product-market fit
4. **Scraping:** Each agent runs their own Chrome + Cowork
5. **Scope:** Foundation now, activation when agent UX is seamless

## Architecture at a glance

```
single-tenant mode (today)                    enforced mode (future flip)
─────────────────────────                    ─────────────────────────────
Your browser                                 Agent's browser
    │                                            │
    ▼                                            ▼  (sends session cookie)
hq.jonathanwallace.ca ────────► Express ───► session middleware
    │                               │               │
    │ (no auth check)               │               ▼
    ▼                               │          attachUser()
/api/listings (returns data)        │               │
    │                               │               ▼
    ▼                               │          req.user = {id, email, role}
fs.readFileSync('/data/            │               │
  .listings.json')                  │               ▼
                                    │          requireAuthIfEnforced()
                                    │               │
                                    │               ▼
                                    └────────► /api/listings
                                                    │
                                                    ▼
                                            userId = req.user.id
                                                    │
                                                    ▼
                                            fs.readFileSync(
                                              userDataPath(userId,
                                                '.listings.json'))
                                            → /data/users/{id}/.listings.json
```

The seam is **the resolver functions** — `getCurrentUserId(req)` and `userDataPath(userId, filename)`. Every existing JSON access will migrate through this seam one at a time, in Phase 2.

## What's built today (Phase 1)

New files:

```
db/
├── pool.js                         Postgres connection (no-op without DATABASE_URL)
├── migrate.js                      Migration runner (idempotent)
└── migrations/
    └── 001_users_and_sessions.sql  Schema: users, user_invites, sessions

lib/
├── users.js                        CRUD + bcrypt helpers + owner seed
├── user-context.js                 getCurrentUserId(req) / requireUserId(req)
├── user-data.js                    userDataPath(userId, filename) / migrateLegacyFileToUser
├── auth-routes.js                  /api/auth/login, /logout, /me, /accept-invite
├── auth-middleware.js              attachUser, requireAuthIfEnforced, requireRole
└── multi-tenant-bootstrap.js       Orchestrates everything at server startup
```

Modified files:

- `package.json` — added `pg`, `bcryptjs`, `express-session`, `connect-pg-simple`
- `server.js` — one import and one `installMultiTenant(app)` call; 12 new lines total

Zero changes to:

- Any existing `/api/*` route handlers
- `src/App.jsx` (the dashboard UI)
- `/data/*.json` state files
- Cowork skills (brokerbay-active-listings, realm-listtrac-stats, etc.)

## The three activation tiers

### Tier 0: Dormant (today — default)

Nothing multi-tenant runs. `DATABASE_URL` is unset. Server logs "dormant" on boot. Your dashboard works identically to before.

### Tier 1: Ready (Postgres attached, but not enforced)

Activate by:

1. In Railway, add the Postgres plugin to the `impartial-nurturing` service. Railway injects `DATABASE_URL` automatically.
2. Set three env vars (once, for owner seed):
   - `OWNER_EMAIL=jonathanwallacerealestate@gmail.com`
   - `OWNER_PASSWORD=<pick a strong one>`
   - `OWNER_NAME=Jonathan Wallace`
3. Set a session secret: `SESSION_SECRET=<32+ random chars>`
4. Deploy.

What happens:
- Migrations run once, creating `users`, `user_invites`, `sessions` tables
- Your user row is seeded with id=1, role='owner'
- The `/api/auth/*` endpoints become live
- You can log in at `/api/auth/login`, but nothing forces you to
- Your existing dashboard still works without logging in
- After the first successful seed, you can remove `OWNER_PASSWORD` from env vars (the hash is in the DB)

This is a safe "test the auth plumbing" mode. You can try login/logout/session-me without breaking anything.

### Tier 2: Enforced (full multi-tenant)

Activate by:

1. Complete Tier 1 first.
2. Complete Phase 2 (migrate all `/api/*` handlers to use `requireUserId(req)`) — see below.
3. Migrate your JSON state files to `/data/users/1/` with the migration script (also Phase 2).
4. Set `MULTI_TENANT=enforced` in Railway env vars.
5. Deploy.

What happens:
- Every `/api/*` request without a session cookie gets a 401
- The SPA boots, gets 401 on `/api/listings`, redirects to a login page
- Logged-in requests scope all data to `req.user.id`
- Other users created via invite flow get their own `/data/users/{id}/` directory

## Phase 2: What's next (not built yet)

Rough estimate: 2-3 focused sessions.

### Step 1 — Login UI (~4 hours)

Add a login page to `src/App.jsx`. When the SPA boots it calls `/api/auth/me`; if that returns `user: null`, show the login form.

Nothing activates this — it's just there for when enforced mode flips on.

### Step 2 — Migrate state files to user-scoped paths (~8 hours)

There are 19 JSON state files in `DATA_DIR`. Each one needs a rewrite pass:

```js
// Before
const LISTINGS_PATH = path.join(DATA_DIR, '.listings.json');
let listingsState = {...};
fs.readFileSync(LISTINGS_PATH);

// After
import { userDataPath } from './lib/user-data.js';
import { requireUserId } from './lib/user-context.js';

function getListingsPath(userId) { return userDataPath(userId, '.listings.json'); }
const listingsStateByUser = new Map(); // userId -> {listings, lastSyncedAt, ...}

function getListingsState(userId) {
  let state = listingsStateByUser.get(userId);
  if (!state) {
    // lazy-load on first access
    const p = getListingsPath(userId);
    state = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : defaultState();
    listingsStateByUser.set(userId, state);
  }
  return state;
}
```

Then every route handler that touches listings gets:

```js
app.get('/api/listings', (req, res) => {
  const userId = requireUserId(req);
  const state = getListingsState(userId);
  ...
});
```

Files that need this treatment (rough count from the existing state):

1. `.listings.json` (listings + listtrac stats + market context)
2. `.cmas.json`
3. `.listing-feedback.json`
4. `.aps-deals.json`
5. `.fub-processed-leads.json`
6. `.ea-thread-state.json`, `.ea-stuck-queue.json`
7. `.gmail-connection-state.json`, `.gmail-missed-emails.json`
8. `.gcal-tokens.json` ⚠️ per-user OAuth tokens — this is Phase 3
9. `.backup-state.json` (may stay global or move per-user)
10. `.quicklinks.json`, `.task-state.json`, `.feedback-submitted.json`, `.outlook-sent-scrape.json`, `.bb-agents-processed.json`, `.tj-import-state.json`, `.sync-requests.json`, `.listing-forms/*`

### Step 3 — One-time data migration script (~2 hours)

A script `scripts/migrate-owner-data.js` that:

1. Creates `/data/users/1/`
2. Copies every JSON state file from `/data/*.json` to `/data/users/1/*.json`
3. Leaves the originals in place for 30 days (belt-and-suspenders)
4. Logs a manifest of what was moved

Run manually (with server stopped) before flipping `MULTI_TENANT=enforced`.

### Step 4 — Login page in the SPA (~4 hours)

Minimal React component. Only rendered when `/api/auth/me` returns `null`. No changes elsewhere in App.jsx.

## Phase 3: Per-user integrations (2-3 more sessions)

The hardest remaining pieces — each agent brings their own accounts.

### Google OAuth per-user

Currently `.gcal-tokens.json` stores Jonathan's tokens at the server level. For multi-tenant, each user needs their own token file (or row). The OAuth callback URL needs to route tokens to the correct user id from the session.

Required before this: **your GCP OAuth app has to graduate from "Testing" to "Production" status.** Google verification takes 2-6 weeks. Start this the week you activate Tier 1 so the calendar time runs in parallel with coding.

### Follow Up Boss per-user

FUB API keys are per-account. Each agent enters theirs in a settings panel. Store encrypted:

- Add table: `user_integrations (user_id, service, ciphertext, created_at)`
- Encrypt with `crypto.createCipheriv` using a server-wide `INTEGRATIONS_KEY` env var
- Rotate keys via a migration if ever needed

### REALM / BrokerBay / ListTrac

No API — all scraped from the agent's own browser. The skills already run per-session in Cowork. No server changes needed — we just need to make sure each agent is POSTing data keyed to their own user_id. This is essentially solved by Phase 2 because `/api/listings/ingest` will scope by `req.user.id`.

## Phase 4: Agent invites and onboarding (~1 week)

- Admin-only UI to issue invites (email + role)
- Invite email template (send via your existing Gmail integration)
- Claim flow: agent clicks invite link → sets password → runs first-time onboarding wizard
  - Connect Google
  - Enter FUB API key
  - Log into BrokerBay / REALM in a new tab
  - Run first BrokerBay scrape
- Admin panel: see all agents, suspend, delete, impersonate (for support)

## Phase 5: Billing (when 5+ agents are paying)

Stripe subscription per agent. Plan limits (listings, AI calls, storage). Out of scope until product-market fit is clear.

## Phase 6: Operational (parallel)

- Sentry for error tracking
- Daily Postgres backups (Railway does this automatically; verify)
- Privacy policy + ToS (lawyer-reviewed, $500-1500)
- PIPEDA compliance review
- Admin panel for user management

## What to do next (when you're ready)

Today: **nothing.** Phase 1 is in the repo. Your dashboard is unchanged. You can push these changes to `main` whenever convenient — they're backwards-compatible.

When you decide to activate Tier 1 (could be weeks or months from now):
1. Railway → add Postgres plugin → takes 30 seconds
2. Set env vars (`OWNER_EMAIL`, `OWNER_PASSWORD`, `OWNER_NAME`, `SESSION_SECRET`)
3. Redeploy → migrations run, your user is seeded
4. Test `POST /api/auth/login` with curl → confirm you get a session cookie
5. Remove `OWNER_PASSWORD` from env vars
6. You're now "ready" — nothing user-visible has changed, but the system can do multi-tenant the moment you want

When you decide to activate Tier 2 (full multi-tenant):
- That's another 2-3 dev sessions (Phase 2 work). Don't do it until you have a clear agent value prop and at least one paying or piloting agent ready to onboard.

## Code review notes

A few things worth flagging:

1. **`bcryptjs` vs native `bcrypt`.** I chose the pure-JS version because it makes Railway deploys simpler (no native compilation). It's ~2x slower at hashing, which is irrelevant at any scale you'll see before needing to reconsider.

2. **Session store is Postgres-backed.** Sessions survive server restarts and multi-instance deployments. Fine for anything up to ~1,000 concurrent users.

3. **CITEXT extension for emails.** Used to enforce case-insensitive uniqueness without a trigger. Falls back to `lower(email)` unique index if the extension can't be created on the host.

4. **Owner-in-single-tenant compatibility.** `getUserDataDir(1)` returns `DATA_DIR` directly when not in enforced mode — that's the mechanism that preserves Jonathan's existing file paths. Once enforced mode is on, even user #1's files move to `/data/users/1/`. That transition is done by the migration script, not at runtime.

5. **The `/api/auth/me` endpoint always returns 200.** Even in Tier 0 (dormant), it returns `{ok: true, user: null}` if called. This is intentional — the SPA can safely poll it to decide whether to show a login screen, with zero risk of breaking in single-tenant mode.

## Sanity checks after deploying Phase 1

```bash
# Boot logs should show
[db] DATABASE_URL not set — multi-tenant subsystem dormant
[multi-tenant] dormant — set DATABASE_URL on Railway to activate

# Dashboard should load normally at hq.jonathanwallace.ca
# All /api/* endpoints behave identically to pre-deploy

# Verify the new code compiles but is inert:
curl https://hq.jonathanwallace.ca/api/auth/me
# → 404 (endpoint not mounted in dormant mode — correct)
```
