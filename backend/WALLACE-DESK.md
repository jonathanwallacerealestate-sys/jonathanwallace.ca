# Wallace Desk

Morning command screen for Jonathan Wallace. One Node service on Railway Hobby.
It does not call an LLM, Follow Up Boss, Google Drive, or Gmail. Make.com and
the chief of staff push a finished board in. Jonathan opens the screen before dials.

Marketing pages on Netlify stay as they are. `jonathanwallace.ca/dashboard`
already redirects to this service; `/dashboard` on the service sends you to `/`.

## What he sees

1. **Mix** — firm and high-dollar deals, biggest countdown first. Red when the deadline has passed.
2. **Before dials** — at most five ranked moves. One button each: call, email, link, or a checklist tick stored on the phone.
3. **Listing closeout** — photo clash, unsigned, confirm live, expiry missing.
4. **Feedback owed** — who, which address, how many days it has been open.
5. **Parked** — work that is explicitly not this morning.
6. **On the calendar** — optional. Rendered only when the snapshot includes `triggers` (Wasaga / farm).

A sample board is written the first time the data file is empty, so the URL is not blank on first boot. The next real push for that date replaces it.

## Environment

Set these on the Railway service. Do not commit them.

| Variable | Required | Purpose |
|---|---|---|
| `DESK_INGEST_TOKEN` | Yes | Shared secret for `POST /api/desk/snapshot`. Header `X-Desk-Token`. |
| `DESK_PIN` | Strongly recommended | Short PIN Jonathan types on the phone. Sets a 30-day httpOnly cookie. |
| `DATA_DIR` | Yes in production | Directory for the board file. Use `/data`. |
| `PORT` | Set by Railway | Listen port. Local default `3000`. |
| `NODE_ENV` | Yes in production | `production` marks the session cookie `Secure`. |

If `DESK_PIN` is unset, the UI asks for `DESK_INGEST_TOKEN` instead. If both are unset, the page is open and ingest returns 503. `GET /api/health` is always public and does not include the board.

There is no `DATABASE_URL`, `API_KEY`, or `ANTHROPIC_API_KEY`. The old command center used those. This service does not.

## Persistence

Snapshots live in `$DATA_DIR/desk-snapshots.json` (one object per Toronto date).

On Railway:

1. Add a volume mounted at `/data`.
2. Set `DATA_DIR=/data`.

Without the volume, a new deploy starts empty and the sample board comes back. Postgres is not used. A database plugin left over from Agent Command Center is unused and can be removed so the project stays on Hobby.

## Endpoints

### `GET /api/health`

`200` when the snapshot file is readable. `503` when it is not.

```json
{
  "status": "ok",
  "service": "wallace-desk",
  "timezone": "America/Toronto",
  "today": "2026-09-23",
  "database": { "ok": true, "driver": "file" },
  "lastSnapshot": { "date": "2026-09-23", "updatedAt": "2026-09-23T11:05:00.000Z", "ageSeconds": 90, "seeded": false },
  "auth": { "uiLocked": true, "ingestConfigured": true }
}
```

### `POST /api/desk/snapshot`

Header: `X-Desk-Token: $DESK_INGEST_TOKEN` (or `Authorization: Bearer …`).

Upserts by `date`. Posting the same Toronto date again replaces that day and leaves other days alone. The server sets `updatedAt` and forces `timezone` to `America/Toronto`. Omit `date` to use today in Toronto.

Dates are `YYYY-MM-DD`. A date-only `deadline` is treated as 5:00pm America/Toronto. Prefer a full offset timestamp.

`mustDo` is kept to the five lowest ranks. `ctaHref` may be `tel:`, `mailto:`, `https:`, or the literal `checklist`. Anything else is dropped.

Optional `triggers` (max 4) renders the calendar strip. Leave it off when nothing is close.

```json
{
  "date": "2026-09-23",
  "timezone": "America/Toronto",
  "mix": [
    {
      "title": "12-155 William",
      "valueLabel": "~$1.225M firm",
      "deadline": "2026-09-30T17:00:00-04:00",
      "action": "Order status cert CondoCafe",
      "owner": "JW",
      "status": "open"
    }
  ],
  "mustDo": [
    {
      "rank": 1,
      "title": "Order status certificate — 12-155 William",
      "why": "Firm. CondoCafe 10-day clock.",
      "ctaLabel": "Call CondoCafe",
      "ctaHref": "tel:+17055550140"
    }
  ],
  "listings": [
    { "address": "18 Baltic", "note": "DocuSign still unsigned.", "status": "unsigned" }
  ],
  "feedbackOwed": [
    { "address": "48 Zoo Park Rd, Wasaga", "to": "Craig Strachan", "openSince": "2026-09-09" }
  ],
  "parked": ["Dial backlog", "Newsletter unsub cleanup"],
  "triggers": [
    { "label": "Wasaga farm", "when": "Saturday", "note": "Only after the status cert is ordered." }
  ],
  "notes": "Optional."
}
```

Listing `status` values the screen knows by name: `photo-clash`, `unsigned`, `live`, `confirm-live`, `expiry-missing`. Other short labels still show.

Response: `{ "ok": true, "date": "2026-09-23", "updatedAt": "…" }`.

### `GET /api/desk/today`

Same auth as the page (cookie, `X-Desk-Token`, or bearer). `?date=YYYY-MM-DD` reads another day. `404` when that day has no board.

### `GET /`

The desk. First visit with a PIN configured is a gate. `POST /api/desk/session` with `pin` sets the cookie. `/?token=$DESK_INGEST_TOKEN` does the same once and redirects so the token is not left in the address bar.

`/dashboard` redirects to `/` so the existing marketing-site “Agent login” link still lands here.

Countdowns turn overdue in the browser from the deadline. No Railway cron.

## How the chief of staff / Make pushes the board

The weekday desk board is written outside this service (Grok chief of staff, then Make, or a manual post). This box only stores and shows it.

**Make.com**, weekday morning, after the board text exists:

1. HTTP module, `POST`, URL `https://hq.jonathanwallace.ca/api/desk/snapshot`.
2. Header `X-Desk-Token` = the Railway `DESK_INGEST_TOKEN` (store it in Make, not in the scenario log if you can help it).
3. Body: the JSON above. Map mix, the five must-dos, listing closeout, open feedback, and the parked list from that morning’s board.
4. Run it again if a deal moves. Same `date` replaces the day.

**Manual**, from a laptop, same payload in `board.json`:

```bash
curl -sS -X POST "https://hq.jonathanwallace.ca/api/desk/snapshot" \
  -H "Content-Type: application/json" \
  -H "X-Desk-Token: $DESK_INGEST_TOKEN" \
  --data @board.json
```

Check with:

```bash
curl -sS "https://hq.jonathanwallace.ca/api/health"
curl -sS "https://hq.jonathanwallace.ca/api/desk/today" \
  -H "X-Desk-Token: $DESK_INGEST_TOKEN"
```

Then open `/` on the phone, enter `DESK_PIN`, and add it to the home screen.

## Local

```bash
cd backend
npm install
DESK_INGEST_TOKEN=dev-token DESK_PIN=2468 npm start
npm test
```

Open `http://127.0.0.1:3000/`. Data lands in `backend/data/` unless `DATA_DIR` is set.

## Deploy

Railway project root directory: `backend`. `railway.toml` starts `node src/index.js` and healthchecks `/api/health`. Custom domain: `hq.jonathanwallace.ca`.
