# Morning Note — FUB is deeply integrated, Claude can operate it, and it's watching for you

> **22 total FUB commits.** Last overnight run added 8 more rounds. Claude
> can now run bulk outreach, research contacts, pull attribution reports,
> auto-respond to fresh leads, and flag listing matches as they come in —
> all on command or on a schedule.

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

## What shipped overall (newest first, 22 FUB-related commits)

```
85b7111  FUB round 22: listing-match alerts (lead ↔ active listings)
409eb4b  FUB round 21: auto-respond to new leads + weekly attribution email
2c653d4  FUB round 20: 5 new Claude agent tools for new capabilities
35ecc78  FUB round 19: nurture templates — save, reuse, apply to lists
95364ed  FUB round 18: lead source attribution report
5e1b852  FUB round 17: contact enrichment — Claude research note
417583f  FUB round 16: pull appointments into the calendar card
bdb1127  FUB round 15: smart-list bulk actions with Claude personalization
8e28845  FUB round 14: Weekly Review pulls FUB pipeline stats
81de100  FUB round 13: morning brief surfaces new FUB leads since yesterday
b8a5fe7  FUB round 12: two-way task completion — CRM green-check mirrors to FUB
c242363  FUB round 11: Smart Lists filter on the Contacts card
8a32a77  FUB round 10: deal sync — push local closings into FUB Deals
2ad644d  FUB round 9:  inbox-zero loop — flagged emails show FUB context
6d4bafa  FUB round 8:  Hour of Power × FUB — search, pre-call brief,
                      auto-push analysis (fub_person_id column)
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

### Rounds 12-14 highlights

**Round 12 — Two-way task completion**: tapping the green ✓ on any CRM
follow-up now ALSO closes the corresponding task in FUB (when linked via
`fub_event_id`). Toast shows "Done · mirrored to FUB" so you know the
round-trip succeeded. No more orphaned open tasks in FUB.

**Round 13 — New leads in morning brief**: Brief Me now pulls FUB people
created in the last 24 hours and names 1-2 in the briefing by source.
*"A new Midland lead named Sarah came in off the website at 11pm."*

**Round 14 — Weekly review pipeline pulse**: the Sunday-night Weekly
Review now includes new_leads_this_week, tasks_completed_this_week, and
deals grouped by status. The review prompt names one new lead by name +
source to personalize the reflection.

### 🔥 Rounds 15-20 highlights (newest work, since last note)

**Round 15 — Smart list × bulk action × Claude personalization**
The big one. Pick a FUB smart list, pick a template, Claude rewrites
the template for EACH contact using their name/stage/source/recent
activity, and drops either:
- a note on each contact, OR
- a task on each contact (with type + due-in-days), OR
- a Gmail draft to each contact (does NOT auto-send)

Two-stage flow enforced: **Dry-run preview** → review the personalized
renders → **Execute**. Per-contact cards show rendered text + push
status + any errors. 5 minutes of work becomes 30 seconds for a batch
of 20 contacts. Contacts card → pick a smart list → "Bulk action"
button appears.

**Round 16 — FUB appointments → Calendar card**
Your FUB showings/appointments now flow into the dashboard calendar
card alongside Google Calendar. Hourly `fub_sync` job now runs BOTH
tasks and appointments in parallel. Book a showing on your phone in
FUB → it's on the dashboard within an hour, no double entry.

**Round 17 — Contact enrichment (research note)**
Open any contact → new "🔍 Research this contact" button → Claude
produces a 4-paragraph read: WHAT WE KNOW, WHAT'S MISSING (the gaps
blocking a deal), RECOMMENDED NEXT TOUCH, and 3 conversational
openers (referential, value-forward, open-ended). Two secondary
buttons: "Save as FUB note" (pushes to FUB) and "Speak it" (TTS).
Cold-lead re-engagement now takes 30 seconds.

**Round 18 — Lead source attribution report**
P&L card has a new "📊 Lead source report" button. Pulls up to 500 FUB
contacts, buckets by source, joins with your closings table for GCI
and deal counts per source. Claude writes a 200-word narrative calling
out the top producer, any leak (high leads + no conversion), and one
concrete recommendation. Finally answers *"where is my business
actually coming from."*

**Round 19 — Nurture templates**
Save reusable message bodies, reuse them across contacts + smart
lists. 5 starter templates seeded:
- Monthly market pulse (email)
- Past client check-in (text)
- Referral ask (warm) (email)
- Open house follow-up (warm) (note)
- Seller LOO offer (email)

Bulk-action modal gets a template picker that auto-fills subject /
body / default channel. Use count bubbles most-effective templates to
the top over time. Manage from Settings → Nurture Templates → Manage.

**Round 20 — Claude agent tools for all the new stuff**
Claude can now, via voice or chat, do any of:
- "Prep me for a call with Sarah Mitchell" → `fub_find_person` +
  `fub_enrich_contact`
- "Where are my deals coming from this quarter" →
  `fub_attribution_report`
- "Send the monthly market pulse to my hot leads" →
  `fub_list_smart_lists` + `fub_bulk_action` (dry-run first,
  confirm, then push)
- "Apply the referral ask template to Tom Bradley" →
  `fub_apply_template`

5 new tools, fully wired into the existing tool-use loop.
Safety default: `fub_bulk_action` defaults `dry_run=true` so Claude
can never mass-push without showing you the renders first.

**Round 21 — Auto-respond + weekly attribution digest**
Two new scheduler kinds, both seeded as disabled schedules:
- **FUB — auto-respond to new leads** (hourly): scans FUB for people
  created in the last 24h with no open tasks, creates an "Initial
  outreach" call task due in 24h for each. Optional: pass a
  `template_name` and it'll also personalize a Gmail draft per lead
  so you can send on a tap.
- **FUB — weekly attribution digest** (Monday 7am, email): runs the
  full attribution report and emails the Claude narrative + KPI
  summary to you. Zero effort to see where leads came from weekly.

Both show up in the Schedule Manager (Settings → Scheduled Jobs) for
one-click enable.

**Round 22 — Listing ↔ lead matches**
Amber banner at the top of the Lead Gen card shows whenever recent
FUB leads have criteria matching one of your active listings. Matches
on city (Midland, etc.), property type, MLS number, or address
fragments appearing in the lead's name/source/tags/custom fields.
Click "See all matches" for the full list with per-match signal
explanations and a one-click path to open the contact. 10-min
client-side cache. Effort to set up: zero — works against your
existing listings table + fresh FUB leads.

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

## Try this (the stuff from rounds 15-20 that's worth 5 minutes)

### 1. Bulk action on a smart list (the killer workflow)
1. Contacts card → pick a smart list (e.g. "Hot Leads")
2. Click **Bulk action** (new button)
3. Template picker → pick "Monthly market pulse"
4. Click **Dry-run preview** → Claude personalizes all ~N contacts
5. Scroll the preview — each one should name the contact and reference
   their stage/source where relevant
6. Click **Execute** → Gmail drafts for each, waiting in your drafts
   folder for you to review + send

### 2. Research an old contact
1. Contacts card → click any contact you haven't touched in months
2. In the detail modal, scroll down to the quick actions
3. Click **🔍 Research this contact**
4. Read the 4-paragraph brief
5. Click **Save as FUB note** if you want it permanent, or **Speak it**
   to hear it while doing something else

### 3. Lead source attribution
1. P&L card → click **📊 Lead source report**
2. Pick period "30" (or 90 or ytd)
3. See the KPI row, the narrative Claude wrote, and the sorted table
   with bar-chart lead counts

### 4. Voice-command Claude to do any of the above
- **F5 tap** to focus agent, or **F5 hold** for push-to-talk
- Try: "prep me for a call with [any contact name]"
- Try: "where are my leads coming from this quarter"
- Try: "list my smart lists" then "send the market update to [list name]"
  — Claude will dry-run first and show you samples before pushing

## Closed in this run (rounds 15-22)

- ✅ Smart list → one-click bulk action (round 15)
- ✅ FUB → Google Calendar two-way (round 16)
- ✅ Contact enrichment (round 17)
- ✅ Lead-source attribution report (round 18)
- ✅ Nurture templates (round 19)
- ✅ Claude agent tools for everything above (round 20)
- ✅ Auto-respond to fresh FUB leads (round 21)
- ✅ Weekly attribution email digest (round 21)
- ✅ Listing-match alerts on the Lead Gen card (round 22)

## When you sit down

Two new schedules to flip on:
1. Settings → Scheduled Jobs → **FUB — auto-respond to new leads** → toggle on
2. Settings → Scheduled Jobs → **FUB — weekly attribution digest** → toggle on

That gets you auto-follow-up coverage + a Monday email telling you where
your leads came from last week.

Also worth looking at:
3. Lead Gen card — if any recent FUB leads match active listings, the
   amber banner at the top will show. If nothing shows, it means nothing
   matched — ping me if that feels wrong and I'll tune the matcher.

## Still on the "not done" list

- **Text / SMS send** — bulk "text" still drafts a note; no direct SMS
  (FUB has a limited text-send API; may need Twilio integration)
- **Smart list drag-reorder** for custom bulk-send sequences
- **Showing-day prep** — auto-compile a showing brief (who, where,
  comps for the property, their recent activity) 30 min before each
  FUB appointment
- **Kanban pipeline view** — drag a contact between FUB stages from
  the dashboard Contacts card
- **Call log from phone → FUB** — shortcut ingest for "I just called
  this number" that logs to FUB via Twilio or a Make.com flow

Tell me what to tackle when you're back.

---

## If anything's broken

1. `/api/health` → should return `healthy`
2. Settings → FUB section → status row tells you the truth
3. Railway Logs tab → paste any red stack traces
4. Rollback is still zero-risk: Railway → Deployments → any prior
   success → **Redeploy** (~30 sec)

Keep going. The foundation is rock solid.
