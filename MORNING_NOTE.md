# Morning Note — Follow Up Boss is deeply integrated

> For Jonathan, to read when you're back.
> Everything that shipped while you slept, plus what to do first.

---

## TL;DR

FUB is now a **first-class citizen** across the entire dashboard — not
just a card. Your Hour of Power calls auto-push to FUB. Flagged emails
show FUB context inline. Closings mirror to FUB as Deals with one
click. Contacts card is filterable by smart list. **Setup is done (the
FUB API key is in Railway).** Two small on-switches to flip on first
login and you're off.

---

## Step 1 — Verify FUB is live (10 seconds)

Open the dashboard → **Settings (gear top-right) → Follow Up Boss section**.

Expected: 🟢 **Connected as [your name]**.

If not, hit **Test Connection**. If that fails, paste the error here
and I'll diagnose.

## Step 2 — Turn on hourly sync (1 click)

**Settings → Scheduled Jobs → Manage** → find **FUB — hourly sync** →
click the pause icon to enable it. It'll run at the top of every hour
and auto-pull your FUB tasks into the CRM card.

---

## What's new since the last note (rounds 8-11, 4 more commits)

### 🔥 Hour of Power now talks to FUB

**Before**: you tapped Start Call → a tiny `prompt()` asked for a name →
call was logged with just text.

**Now**:
- **Live FUB contact search** with 280ms debounce — type 2+ characters,
  pick from actual FUB results (name, email, phone, stage visible)
- **Pre-call brief button** — once a contact is selected, hit it and
  Claude generates a 30-second spoken read based on their recent
  events/notes/open tasks. Spoken aloud via TTS.
- **Freetext fallback** if the contact isn't in FUB (for cold calls
  off an open house sign-in sheet)

And the big one: when the call analysis completes:
- **A structured note** (summary, your commitments, their commitments,
  coaching reflection) is auto-posted to FUB as a note on that contact
- **A FUB task** is created for every follow-up Claude suggests
- The `pushed_to_fub_at` timestamp goes on the call so we can see
  it later

Zero manual CRM data entry after a prospecting block. You just talk,
hang up, and everything's where it should be.

### ✉ Inbox zero × FUB

Every flagged email in the Emails card now shows a tiny purple **FUB**
badge on the sender's row if they exist in FUB. The badge also shows
their stage — *"FUB · Hot Lead"* — so you can prioritize replies at a
glance.

Click the badge → opens the full FUB contact detail modal (history +
open tasks + quick-add note). Client-side cache keeps lookups snappy
(5 min per sender), and if FUB isn't configured, the badges silently
disappear — no broken UI.

### 💰 Deal sync — closings → FUB

New **Push to FUB Deals** button on the Closings card toolbar.

One click and every closing that isn't already synced pushes to FUB as
a Deal:
- Name = property address
- Price = sale_price
- Commission = gross_commission
- Close date = closing_date
- Stage mapping: pending → Under Contract, firm → Firm / Conditions
  Waived, closed → Closed, cancelled → Lost
- Best-effort person link via client_name search

Idempotent — re-clicking only pushes new/un-synced rows (we stamp
`fub_deal_id=<id>` into the closing notes so we never duplicate).

### 📋 Smart Lists as a Contacts filter

New third dropdown on the Contacts card (between Stage and Refresh)
populated from your FUB smart lists. Pick one → filter the list to
that segment.

Combines with search + stage, so: *"Hot Leads in 'New Lead' stage
named Mitchell"* is a 3-field combo away.

---

## What shipped overall (newest first, 11 FUB-related commits)

```
c242363  FUB round 11: Smart Lists filter on the Contacts card
8a32a77  FUB round 10: deal sync — push local closings into FUB Deals
2ad644d  FUB round 9:  inbox-zero loop — flagged emails show FUB context
6d4bafa  FUB round 8:  Hour of Power × FUB — search, pre-call brief,
                      auto-push analysis (fub_person_id column)
7c1192a  Morning note (prior)
8f12213  FUB round 7:  live FUB state in morning briefing
1a99088  FUB round 6:  dedicated Contacts browser card
949a01a  FUB round 5:  contact-detail drill-in on CRM rows
005858e  FUB round 4:  docs + hourly sync schedule seed + intuition
a4ad146  FUB round 3:  Settings UI, CRM buttons, add-task modal
bc35bfd  FUB round 2:  6 Claude agent tools
7b3c8ac  Scheduler:    fub_sync job kind
e7a4bea  FUB round 1:  direct API client + routes
```

All on `main`. All auto-deployed to Railway.

---

## Try this when you wake up

### 1. The whole loop (the moment of truth)

1. **Settings → FUB** → confirm green connected
2. **Settings → Scheduled Jobs** → enable **FUB — hourly sync**
3. Go to the **Contacts** card → pick any real client → open their
   detail modal → see their full history
4. Go to **Lead Generation** → **Start** an Hour of Power (even 30 min)
5. Tap **Start Call** → search that same client → click them
6. Tap **Pre-call brief** → listen to the 30-second read
7. Start recording, dictate a quick pretend conversation for 15
   seconds ("we talked about the Midland listing, she wants to see it
   Saturday"), tap **End Call**
8. Wait ~10 seconds for Claude to analyze
9. Go back to their FUB contact detail modal → scroll to notes
10. You should see a fresh note titled "Call (0 min) — warm" with a
    clean structured summary, plus a new FUB task for "Schedule
    Saturday showing for Midland listing"

If step 10 lights up, the whole stack works end-to-end.

### 2. Push your closings to FUB

If you have any `closings` rows:
1. Go to **P&L** card
2. Click **Push to FUB Deals**
3. Check your FUB Deals view — they should all be there

### 3. See inbox-zero magic

If any flagged emails exist from real clients in your FUB, just look
at the **Emails** card. FUB badges should appear automatically.

---

## Known caveats

- **FUB API search** matches name / email / phone substrings. Partial
  matches work; misspellings don't. This affects the Hour of Power
  contact picker and the closings → deal person-linking.
- **Pre-call brief** requires both FUB configured AND the contact to
  have some recent activity. If the contact is brand new, the brief
  will say so and suggest a discovery opener.
- **FUB rate limit** is 250 requests per 10 seconds. Our hourly sync
  + per-sender email lookups are well under. If you mash **Sync Now**
  repeatedly, you'll hit the cache instead of FUB.
- **Inbox zero FUB badges** only appear for senders with a matching
  email in FUB. People who email you from personal accounts that FUB
  doesn't know about won't show badges.

---

## Still on the "not done" list

- **Two-way task sync** — completing a FUB task from dashboard
  mirrors to FUB (done for calls-via-HoP and for direct task-complete
  button; NOT for the CRM card's green-check button yet)
- **Smart list → one-click bulk action** ("text all 12 Hot Leads a
  holiday message")
- **Event log on the morning brief** — "3 new leads since yesterday"
  with names
- **FUB → Google Calendar two-way** (Showings scheduled in FUB
  auto-appear in your calendar card)
- **Weekly review** consumes FUB stats (new leads / closed / lost
  this week) for a real pipeline health read

Tell me any of those when you're ready.

---

## If anything's broken

1. `/api/health` → should return `healthy`
2. Settings → FUB section → status row tells you the truth
3. Railway Logs tab → paste any red stack traces
4. Rollback is still zero-risk: Railway → Deployments → any prior
   success → **Redeploy** (~30 sec)

Keep going. The foundation is rock solid.
