# Deployment & Online Editing Workflow

This repo runs as two services:

| Piece | Hosted where | Purpose |
|-------|-------------|---------|
| **Marketing site** (`index.html`, `buyers.html`, community pages, etc.) | Netlify | Public-facing realty site at `jonathanwallace.ca` |
| **Agent Command Center** (backend + dashboard UI) | Railway | Private daily briefing at `/dashboard` — beta at the Railway URL, eventually at `dashboard.jonathanwallace.ca` |

Both auto-deploy from GitHub. **No laptop required** — every change can be
made from a browser (GitHub web editor, Claude Code on web, or via
this dashboard's own settings drawer).

## Online editing flows

### A. Edit text / config from the browser
1. Open `https://github.com/jonathanwallacerealestate-sys/jonathanwallace.ca`
2. Press `.` to open the GitHub web IDE (or use the pencil icon on any file)
3. Commit on the `main` branch → Railway + Netlify auto-deploy in ~60 seconds

### B. Edit runtime config without any commit
The dashboard itself exposes a **Settings** drawer (gear icon in the top
right) that writes to the `app_settings` table. Use it for:
- Make.com webhook URLs (agent output, marketing publisher, CRM write-back)
- Daily calorie / protein / workout targets
- Timezone
- Greeting text

These values persist in Postgres and survive deploys.

### C. Ask Claude to make code changes
From anywhere (phone, iPad, borrowed computer):
1. Open Claude.ai → the "Code" section
2. Point it at this repo
3. Describe the change — Claude edits, commits, and pushes to a branch on
   GitHub. GitHub → Railway/Netlify → live.

## Netlify (frontend)

`netlify.toml` already pins the config. If you need to connect a fresh
Netlify project:

1. **New site from Git** → pick `jonathanwallace.ca`
2. Build command: _(none — it's static)_
3. Publish directory: `.` (repo root)
4. Add custom domain `jonathanwallace.ca` → Netlify handles SSL

## Railway (backend + dashboard)

`backend/railway.toml` pins the config. To connect:

1. **New project → Deploy from GitHub** → pick this repo
2. **Root directory**: `backend`
3. Railway auto-detects Node (Nixpacks) and runs `node src/index.js`
4. Provision a **Postgres plugin** — Railway wires `DATABASE_URL` automatically
5. Set env vars:
   - `API_KEY` — the secret you type into the dashboard login
   - `ANTHROPIC_API_KEY` — enables the Claude worker
   - `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_USER` — enables agent email tools

Railway gives you a URL like `https://<your-app>.up.railway.app`. Test:
- `GET /api/health` → `{ "status": "healthy" }`
- `GET /dashboard?key=YOUR_API_KEY` → full dashboard

## Subdomain: `dashboard.jonathanwallace.ca` → Railway

When the beta is ready to move under the main brand:

1. In **Railway → Settings → Networking**, add a custom domain:
   `dashboard.jonathanwallace.ca`. Railway gives you a CNAME target like
   `<your-app>.up.railway.app`.
2. In your DNS provider, add:
   ```
   CNAME  dashboard  <your-app>.up.railway.app
   ```
3. Railway auto-provisions Let's Encrypt SSL (takes ~1 min).
4. Update `backend/src/index.js` CORS origins to include
   `https://dashboard.jonathanwallace.ca` (already includes the base domain).
5. The dashboard now loads at `https://dashboard.jonathanwallace.ca/dashboard`.

### Add-to-homescreen for iPhone
Once on the real domain:
1. Visit `https://dashboard.jonathanwallace.ca/dashboard?key=API_KEY`
2. Share → Add to Home Screen
3. Icon + manifest are already wired — launches as a standalone app.

## Embedding the dashboard link in jonathanwallace.ca

A discreet "Agent Login" button is included in the marketing site footer.
It points to the Railway URL today; swap it to `dashboard.jonathanwallace.ca`
after the DNS cutover.

## Auto-deploy rules

Railway + Netlify both watch the `main` branch by default. Feature work
happens on branches like `claude/agent-dashboard-*`. Merge to `main` when
ready to ship to production.

## Rollback

- **Railway**: Deployments tab → click any prior deploy → "Redeploy"
- **Netlify**: Deploys tab → "Publish deploy" on any prior build

Both take < 30 seconds and don't require a laptop.
