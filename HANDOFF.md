# Wallace Desk — operator note

The Agent Command Center handoff is retired. Do not attach Postgres, do not
set `ANTHROPIC_API_KEY`, and do not start a worker or a cron. Those jobs
fetched CRM and mail from Railway. Wallace Desk does not.

Live setup: [`backend/WALLACE-DESK.md`](backend/WALLACE-DESK.md).

- One Node service, root directory `backend`
- Start: `node --max-old-space-size=256 src/index.js`
- Health: `GET /api/health` (HTTP 200 while the process is up)
- Store: one JSON file at `DATA_DIR=/data`
- Ingest: `POST /api/desk/snapshot` with header `X-Desk-Token`
- Domain stays `hq.jonathanwallace.ca`
- Railway spend cap: **$10**
