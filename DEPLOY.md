# Deployment & Online Editing Workflow

This repo runs as two services:

| Piece | Hosted where | Purpose |
|-------|-------------|---------|
| **Marketing site** (`index.html`, `buyers.html`, community pages, etc.) | Netlify | Public-facing realty site at `jonathanwallace.ca` |
| **Wallace Desk** (`backend/`) | Railway | Private morning board at `hq.jonathanwallace.ca` |

Both auto-deploy from GitHub. Copy and layout changes ship from a browser
via the GitHub web editor. The morning board itself is not edited in git —
Make.com or the chief of staff posts it to `POST /api/desk/snapshot`.

## Online editing flows

### A. Edit text / config from the browser
1. Open `https://github.com/jonathanwallacerealestate-sys/jonathanwallace.ca`
2. Press `.` to open the GitHub web IDE (or use the pencil icon on any file)
3. Commit on the `main` branch → Railway + Netlify auto-deploy in ~60 seconds

### B. Push today’s board without a commit
`POST /api/desk/snapshot` with `X-Desk-Token`. The JSON replaces that
Toronto date. See [`backend/WALLACE-DESK.md`](backend/WALLACE-DESK.md).

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

## Railway (Wallace Desk)

`backend/railway.toml` pins the config. Full env and ingest docs:
[`backend/WALLACE-DESK.md`](backend/WALLACE-DESK.md).

1. **Root directory**: `backend`
2. Start command: `node src/index.js` (healthcheck `GET /api/health`)
3. Mount a volume at `/data` and set `DATA_DIR=/data`
4. Set `DESK_INGEST_TOKEN`, `DESK_PIN`, and `NODE_ENV=production`
5. Custom domain: `hq.jonathanwallace.ca`

No Postgres plugin and no Anthropic key. The service stores one JSON file on the volume.

Test:
- `GET /api/health` → `{ "status": "ok", "service": "wallace-desk" }`
- `GET /` → the desk (PIN gate when `DESK_PIN` is set)
- `POST /api/desk/snapshot` with header `X-Desk-Token`

### Add to the iPhone home screen
1. Open `https://hq.jonathanwallace.ca/`, enter the PIN
2. Share → Add to Home Screen
3. The manifest is served by the app. It opens standalone on `/`

## Footer link on jonathanwallace.ca

The marketing footer still has “Agent login” pointing at `/dashboard`.
Netlify redirects that to this Railway service, and the service redirects
`/dashboard` to `/`. The public pages do not need a change for the desk to load.

## Auto-deploy rules

Railway + Netlify both watch the `main` branch by default. Feature work
happens on branches like `claude/agent-dashboard-*`. Merge to `main` when
ready to ship to production.

## Rollback

- **Railway**: Deployments tab → click any prior deploy → "Redeploy"
- **Netlify**: Deploys tab → "Publish deploy" on any prior build

Both take < 30 seconds and don't require a laptop.
