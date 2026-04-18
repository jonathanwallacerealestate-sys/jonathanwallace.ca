---
name: inbox-triage
description: Sweep Gmail + Outlook, triage every new thread into state (Awaiting You / Draft Ready / Awaiting Them / Closed), file to property folder when applicable, and queue drafts in the 12–3 PM response queue. Trigger on schedule (7 AM, hourly during business hours) or on demand.
---

# Inbox Triage

## Inputs
- Gmail API (`jonathanwallacerealestate@gmail.com`) — inbound + BCC'd outbound from faristeam.ca.
- Outlook web (Chrome routine) — faristeam.ca Sent folder, last 24 hrs.

## Priority order per thread
1. Client-facing (buyer / seller / lead / past client)
2. Third-party property inquiries (other agents, BrokerBay, co-op questions)
3. Internal Faris staff (non-realtor): listings@, bookings@, photography@, marketing@, Hugo, Listings Dept
4. Auto-notifications (archive/extract per matrix)

## State assignment
- Last sender ≠ Jonathan → `Awaiting Your Reply`
- Last sender = Jonathan AND reply expected → `Awaiting Them`
- Jonathan has not replied AND draft is pre-written → `Draft Ready`
- Thread has explicit close (thanks/confirmed/closed) → `Closed`
- Jonathan snoozed → `Snoozed`

## Auto-archive matrix
| Sender pattern | Action |
|----------------|--------|
| `info@mg.brokerbay.com` (Confirmed showing) | Move to property folder + archive |
| `noreply@sisu.co` duplicates | Keep one, archive rest |
| `dse@camail.docusign.net` (Completed) | Hold 48 hrs → file to property folder |
| `noreply@realtor.ca` | Archive after extraction |
| `sso@ampre.ca` (OTP) | Archive immediately |
| `hello@notify.railway.app` | Archive (Jonathan handles) |
| Other team agents' offer alerts | Archive (FYI only) |
| `notifications@em.realmmlp.ca` | Archive (informational) |

## Draft rules
- Draft only. Never send.
- CC `jonathan@faristeam.ca` on every outbound.
- Sign-offs: Cheers / Have a powerful day / Talk soon.
- No bold in body. No signature block (auto-populates).
- Voice: professional for lawyers + lenders; casual-polished for clients; warm-decisive for agents/internal.

## Outputs
- Thread states written to email-state cache.
- Drafts written to Gmail Drafts folder with `[CLAUDE DRAFT]` tag in first line (removed before Jonathan sends).
- Dashboard refresh.

## Guardrails
- Never send.
- Never auto-respond to offer/APS/counter emails — always draft + P0 escalate.
- Never modify FUB lead owner or stage.
