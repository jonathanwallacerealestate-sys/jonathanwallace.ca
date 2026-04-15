# Morning Note — Follow Up Boss is wired up

> For Jonathan, to read when you're back.
> Everything that shipped while you slept, plus what to do first.

---

## TL;DR

Follow Up Boss is now a first-class citizen of the Agent Command Center.
The dashboard talks to FUB directly, Claude can take actions in FUB on
your behalf, and the morning briefing speaks to FUB state. **One thing
needs your attention before it works: your FUB API key needs to be set
in Railway.**

---

## Step 1 — Set your FUB API key in Railway (30 seconds)

Open your Railway service → **Variables** tab → **+ New Variable**:

- **Name**: `FUB_API_KEY`
- **Value**: your FUB API key (the `fka_...` string)

Click **Add**. Railway auto-restarts (~30 sec).

*(Heads up: you pasted the key in chat earlier. When you have 30 sec,
rotate it: FUB → Admin → API → revoke old key → create a new one →
paste the new one into Railway. Chat transcripts keep copies, so best
practice is to rotate any key that touched a chat.)*

---

## Step 2 — Verify it works (30 seconds)

Open the dashboard → **Settings (gear top-right) → Follow Up Boss section**.

You should see one of:
- 🟢 **Connected as [your name]** → done, move to step 3
- 🟡 **Not configured** → key isn't in Railway yet, try again
- 🔴 **Configured but connection failed** → wrong key or network issue

---

## Step 3 — Turn on the hourly sync (1 click)

**Settings → Scheduled Jobs → Manage** → find the row "**FUB — hourly sync**"
→ click the ⏸ icon to toggle it on. It'll now auto-pull your FUB tasks
into the CRM card every hour at :00.

Or hit **Pull from FUB** on the CRM card toolbar any time for an on-demand sync.

---

## What's new in the dashboard

### CRM card

- **Pull from FUB** button in the toolbar — manual sync trigger
- **+ FUB Task** button — opens a modal with live person search, pick
  a contact, set task type + due date, Create in FUB
- Each row now shows a **FUB** badge when linked to a FUB contact
- New **⚡ lightning-bolt button** on every FUB-linked row → opens the
  contact detail modal with the person's full event history, open
  tasks, recent notes, and a **quick-add note** box

### New Contacts card

A whole new section between CRM and Calendar — browses your FUB address
book with search + stage filter + a **+ New Lead** button. Click any
contact for the same full-history detail modal.

### Settings drawer

New **Follow Up Boss** section with:
- API key field (masked password input)
- Connection status indicator (green / amber / red)
- **Test Connection** button
- **Sync Now** button

### Morning Briefing

Your next Brief Me will now speak to FUB state:
> *"Good Tuesday morning. Three FUB tasks are overdue — the Smiths
> from last week is on top..."*

If FUB isn't configured, it quietly skips the FUB bits.

---

## New Claude agent tools (say this and it works)

You can say things like:
- *"Add Sarah Mitchell as a new lead, phone 705-555-1234, she's
  looking in Midland under $800k"* → creates her in FUB
- *"Log that I just had a great 20-min call with Tom about the
  Midland lakefront, he's ready to see it Saturday"* → finds Tom,
  adds a note, creates a Saturday showing task
- *"Move the Smiths to Active Client"* → updates their stage
- *"Mark my call task with Sarah as done"* → completes the task

Full tool list: `fub_find_person`, `fub_add_note`, `fub_create_task`,
`fub_complete_task`, `fub_update_stage`, `fub_create_person`.

---

## What shipped (commits, newest first)

```
8f12213  FUB round 7: surface FUB live state in the morning briefing
1a99088  FUB round 6: dedicated Contacts browser card
949a01a  FUB round 5: contact-detail drill-in on CRM rows
005858e  FUB round 4: docs + seeded hourly sync schedule + intuition
a4ad146  FUB round 3: dashboard UI — Settings, CRM buttons, add-task modal
bc35bfd  FUB round 2: 6 Claude agent tools for Follow Up Boss
7b3c8ac  Scheduler: add fub_sync job kind
e7a4bea  FUB round 1: direct API client + routes + settings wiring
```

8 commits. All on `main`. All auto-deployed to Railway (check Deployments
tab — newest should be commit `8f12213`).

---

## Try this when you wake up

1. Set the env var (Step 1 above)
2. Test Connection (Step 2)
3. Turn on hourly sync (Step 3)
4. Open the new **Contacts** card → search for a real client you know
   → click them → read the full modal. See the recent activity, click
   "Add task for this contact," pick a follow-up date.
5. Back to the **Agent Tasks** card → compose box → try this:

   > *"Add a note to [real client name] that I'm going to send them
   > the fresh comps for their neighbourhood tomorrow, then create a
   > task to actually send those comps by 10am tomorrow."*

   Claude should find the person in FUB, add the note, and create the
   task. Watch it happen in real time.

---

## Known caveats

- **FUB rate limit**: 250 requests per 10 seconds. Our sync is well
  under — don't worry about it.
- **Hourly (not every-15-min) sync**: the scheduler supports
  hourly/daily/weekly/monthly, not custom intervals. Hourly is plenty
  for a CRM that sees a few tasks per day. If you want tighter, say
  so and I'll add a `minutely` scheduler kind.
- **Person search**: FUB's API search matches name / email / phone
  substrings. Partial matches work; misspellings don't.
- **MFA in FUB**: not an issue — we're using the API key, not a
  user login.

---

## What I didn't do (open ideas for next round)

- **Two-way deal sync** — push your local `closings` table into FUB
  Deals so P&L and CRM are one pipeline
- **Smart-list-powered segments** — "show me everyone in smart list
  'Hot Leads'" as a dedicated dashboard filter
- **Auto-create FUB task when Hour of Power call analysis surfaces a
  follow-up** (right now it creates a local `crm_followups` row; we
  could also push to FUB if the contact is there)
- **Inbox zero loop** — when you flag a Gmail message "needs reply,"
  auto-find the sender in FUB and surface their recent context
- **Contact enrichment** — on a cold FUB record, ask Claude to pull
  public info (LinkedIn, company, etc.) and stage it as a note for review

Tell me any of those when you're ready.

---

## If anything's broken

1. Check the dashboard is up: `/api/health` returns `healthy`
2. Check the FUB status panel (Settings → Follow Up Boss section)
3. Railway → Logs tab — paste any red stack traces to me
4. Rollback is always available: Railway → Deployments → pick any
   prior successful deploy → **Redeploy** (~30 sec). Zero data loss.

Sleep well. Talk soon.
