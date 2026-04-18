---
name: lead-first-touch
description: When a new FUB lead arrives, ingest the assignment email + Engagement notes follow-up, draft a personalized first-touch email + SMS within 60 minutes, create FUB call task, and apply Listing Appointment tag if applicable. Rescue any FUB reassignment-warning leads as P1.
---

# Lead First-Touch

## Trigger
Inbound `leads@followupboss.com` "Lead assigned" email.

## Sequence
1. Parse lead from email: name, phone, email, source tag, FUB profile link.
2. **Wait** for second email from Faris's lead-engagement department containing conversation notes (typically 5–30 min after assignment).
3. Once notes arrive, ingest into FUB profile cache.
4. **Within 60 minutes of original lead-assignment timestamp,** draft:
   - **First-touch email** — casual-polished, references specific Engagement note context.
   - **First-touch SMS** — short, punchy, sets expectation for Jonathan's call.
   - **FUB task** — `Call [Lead Name] within 24 hrs` assigned to Jonathan.
5. If lead matches Listing Appointment criteria (selling intent), apply FUB tag `Listing Appointment` → triggers Jonathan's existing pre-listing checklist email automation.
6. Surface drafts in dashboard for one-click send.

## Lead source landscape (preserve tags)
- `SP: Networking`
- `Team: Brokerage Call-In`
- `Realtor.ca`
- Engagement-routed leads

Reported on for ROI analysis (Phase 2).

## P1: lead reassignment warning
When `notifications@followupboss.com` warns "Please reach out to this lead today or it will be reassigned":
- P1 alert breaks through any block except family/Sunday/pool.
- Agent drafts emergency first-touch (email + SMS).
- Surfaces lead context with `REASSIGNMENT RISK` header on dashboard top bar.

## P1: InterFace appointment-form alert
When `notifications@interface.re` flags "Appointment Follow Up Form Not Submitted":
- P1.
- Agent drafts the FUB appointment follow-up form content (synthesized from calendar notes + post-appointment emails).
- Jonathan files in InterFace before next escalation.

## FUB tag taxonomy
- `Listing Appointment` — triggers pre-listing automation
- `Advocate` — VIP, P0 tier
- Stage tags: `Hot`, `Warm`, `Nurture`, `Past`
- Source tags preserved as-is

## Outputs
- Drafts (email + SMS) in dashboard.
- FUB task created for Jonathan.
- Optional: FUB tag `Listing Appointment` applied (only if selling-intent confirmed).

## Guardrails
- Never assign lead to anyone but Jonathan (he's the assignee on his personal FUB).
- Never change stage without Jonathan approval (notes/tasks OK).
- Never send first-touch on Jonathan's behalf — always draft.
