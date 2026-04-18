---
name: contract-milestones
description: Watch inbox for accepted-offer and DocuSign-completed patterns, download and parse APS/amendment PDFs, extract milestone dates (conditional, title search, closing, custom items like septic pumpout), create FUB deal + tasks, add to Outlook calendar, run T-72/48/24 countdowns.
---

# Contract Milestone Tracking

## Trigger patterns (inbox monitoring)

Watch both inboxes for:
- Subject / body containing: "Congratulations, see attached accepted offer"
- Subject / body containing: "Congratulations, see accepted conditional offer. Deposit instructions are on the listing"
- Subject starts with "Completed:" from `dse@camail.docusign.net`
- Subject contains: `APS`, `Amendment`, `Notice of Fulfillment`, `Waiver`, `Accepted Offer`, `Counter`

## Action sequence

1. **Download** PDF attachment.
2. **Parse** dates (OCR if scanned) — extract:
   - Accepted date / date of acceptance
   - Irrevocable date
   - Conditional period length
   - Condition removal date(s) — financing, inspection, status certificate, well/septic, insurance, etc.
   - Title search date / requisition date
   - Completion / closing date
   - Possession date
   - Any custom schedule items (e.g., "septic pumped before title search," "chattels to be inspected by X")
3. **Create or update FUB deal** on Jonathan's personal FUB instance:
   - Stage: Conditional / Firm / Pending Closing (as appropriate)
   - Expected close date
   - Commission / GCI fields
   - Link to parsed PDF in FUB notes
4. **Create FUB tasks** for each milestone:
   - T-7 / T-3 / T-1 reminders for each condition
   - Closing-date countdown reminders
5. **Add Outlook calendar events** (Red category) for every milestone.
6. **Surface to dashboard:** new deal card with countdown and condition checklist.

## During conditional period

- Daily 1-line digest in dashboard: `[Address]: Day N of M conditional. Inspection [✓/pending], Financing [✓/pending], Status Cert [✓/pending].`
- **T-72 / T-48 / T-24** alerts before any unresolved condition.
- At T-48: draft chase emails ready for inspector, mortgage broker, opposing lawyer.

## T-3 pre-title-search check-in (lawyer)

**Three business days before the title search date,** agent drafts email to the lawyer handling the deal:

> Subject: `[Address] — Title Search Check-In`
>
> Hi [Lawyer name],
>
> Just checking in on [Address]. Anything you need from us before title search on [date]?
>
> Talk soon.

Casual-polished tone. Never gives legal interpretation.

## T-7 pre-closing checklist (client)

**Seven days before closing,** agent drafts client email:

- Lawyer contact confirmed
- Final walkthrough booking (buyer) / walkthrough coordination (seller)
- Utilities switchover / cancel
- Key handoff plan
- Address change list (buyer)
- Insurance binder (buyer)
- Mailbox/utilities cancel (seller)

## Closing day + post-closing

- **Day of closing:** draft `Congratulations on closing!` message.
- **Day +1:** apply FUB `Advocate-Nurture` tag; create anniversary card task (Jonathan-managed, firing at closing date +365).
- **Day +14:** review-request follow-up draft.

## Outputs
- FUB deal record (stage, milestones, links).
- FUB tasks (T-X reminders).
- Outlook calendar events (Red category).
- Dashboard deal card with live countdown.

## Guardrails
- Never auto-respond to APS/amendment/counter email. Always draft + P0 escalate.
- Never interpret legal language in writing.
- Never authorize deposit or money movement.
- If parsing is ambiguous (can't confidently extract a date), push to `Claude stuck` ticker — Jonathan fills the gap.
