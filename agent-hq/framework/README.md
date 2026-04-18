# Wallace Agent HQ Framework

**For Jonathan Wallace's Claude EA deployment inside Agent HQ.**

This repo is the framework specification — not executable code. Drop these files into Agent HQ and write the implementation against them.

## Structure

```
agent-hq-framework/
├── README.md                       ← you are here
├── Wallace_Agent_HQ_Framework.md   ← [at project root] comprehensive framework document
├── Wallace_Agent_HQ_Framework.docx ← [at project root] human-readable version
├── skills/
│   ├── inbox-triage.md            ← 7 AM sweep + state model + auto-archive
│   ├── jo-handoff.md              ← DTL at 8 AM + EOD parse at 12:30 PM
│   ├── seller-cadence.md          ← Day 1-30 listing lifecycle
│   ├── lead-first-touch.md        ← 60-min first-touch + P1 rescues
│   ├── contract-milestones.md     ← APS parsing + FUB deal + countdowns
│   ├── calendar-management.md     ← Outlook-truth + protected blocks
│   └── guardrails.md              ← Hard rules + escalation tiers
├── schemas/
│   └── data-model.md              ← Thread, Lead, Deal, Listing, Showing, Task, DTL, Audit
└── memory/
    └── preferences.md             ← Identity, schedule, people, tech, goals
```

## Phase-1 build priority

Build in this order:
1. `guardrails.md` — load as precondition on every workflow.
2. `calendar-management.md` + `inbox-triage.md` — daily rhythm foundation.
3. `jo-handoff.md` — unblocks Jo's day-starting dependency.
4. `seller-cadence.md` — the heaviest lane.
5. `lead-first-touch.md` — lead reassignment rescue value.
6. `contract-milestones.md` — highest financial risk reduction.

## Dependencies

| System | Role | Auth |
|--------|------|------|
| Follow Up Boss (personal) | Source of truth for contacts/deals/tasks; SMS | API key |
| Gmail API | Read inbox; write drafts | OAuth |
| Outlook web (Chrome) | Read Sent folder; file folders | Headless session |
| Outlook BCC rule | Capture sent → Gmail | One-time setup |
| Google Calendar API | Read events | OAuth (read-only) |
| Railway | Backend host | existing |
| Netlify | Dashboard host | existing |
| GitHub | Framework repo + memory | PAT (`claude-deploy`) |

## Hard prohibitions
- No sending email (drafts only).
- No responding to offers/counters/APS without explicit Jonathan click.
- No code commits, pushes, or deploys.
- No legal interpretation in writing.
- No Sunday bookings without approval.

## Success metrics

See `Wallace_Agent_HQ_Framework.md` §16.

## Iterating

This is v0.1. Open items in §17 of the framework doc. Agent's job during Phase 1 is to surface gaps as they come up via the `Claude stuck, needs answer` ticker, so Jonathan can fill in the framework file and rebuild.
