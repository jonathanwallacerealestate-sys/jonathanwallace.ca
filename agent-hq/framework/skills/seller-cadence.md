---
name: seller-cadence
description: Operationalize Jonathan's Day 1-30 Listing Strategy. Pre-book 14-day and 30-day reviews at listing intake, run weekly seller touches, chase showing feedback same-day, draft sandwich-format seller updates, coordinate cancel/relist cycles.
---

# Seller Cadence

Priority lane. Most of Jonathan's volume is sellers.

## Trigger: new active listing
Source: `noreply@sisu.co` "A New Listing is Live" email.

**On trigger:**
1. Register listing in tracker. State: Day 1.
2. Pre-book `14 Day Market Review: [Address]` — 1 hour — in Outlook for listing date +14.
3. Pre-book `21 Day Market Review: [Address]` — 1 hour — per SOP.
4. Pre-book 30-day review for listing date +30.
5. Draft Day 1 personal touch email/text to seller (validate their effort).
6. Confirm syndication completeness (REALTOR.ca, TRREB, local boards) by parsing follow-up emails.
7. Notify marketing AI bot (separate session) that a new listing is live for copy generation.

## Weekly cadence (per active listing)
- **Faris auto-sends ListRac weekly stats** — do not duplicate.
- Agent ensures **one additional personal touch/week** (configurable 1x or 2x in dashboard at intake).
- **Monday afternoon** after ListRac email: draft `Listing Update Call: [Address]` email. Two suggested Mon 1–4 PM slots + Calendly backup. 1-line agenda.
- **Call morning:** draft `Market Update Prep: [Address]` with REALM data — solds last 14 days (1–3 default, 5 max), 1–3 new listings, price changes. Matched by area/features/bed-bath. Solds include price, DOM, sale-to-list ratio, co-op agent.
- **Weekly seller call:** 15 min. Agenda = showing count, feedback trends, recent solds.

## Day 1–5 cadence (per Day 1-30 strategy doc)
- Day 1: personal touch, validate seller's effort, confirm they like presentation/video/photos.
- Day 3–5: early-traction update (views, saves, showings).

## Day 6–14 cadence
- Day 7: showing activity + early feedback summary.
- Day 10: data-driven update on views + comparable movement.
- Day 14: first formal market review meeting (already pre-booked).

## Day 15–21 cadence
- Day 15–16: market review meeting conducted. Data-driven positioning decision.
- Day 18–20: follow up to confirm adjustments rolled out.

## Day 22–30 cadence
- Day 22–25: re-engagement update (refreshed marketing, re-touched agents).
- Day 28–30: 30-day review meeting.

## Showing feedback workflow (the engine)

**Same-business-day rule:** if a showing has happened and the showing agent has not filled out the BrokerBay online feedback form by EOB that day:
1. Agent drafts email to the showing agent requesting feedback.
2. Jo (via FUB text) sends a parallel ping.
3. If online form is filled → team auto-forwards to Jonathan → if negative, team asks Jonathan whether to push to client.
4. If still missing next day → Jonathan's faristeam.ca email sent by Jo, CC Jonathan.
5. If still missing → seller message is neutral ("we've reached out and have not received a response yet, will try again").

**Feedback received:**
- Agent loads into FUB note on the deal.
- Agent pushes call note to dashboard (phone-first preferred): seller name, property, agent who showed, feedback summary, last 3 convos with seller, 3–5 talking points, 2–3 anticipated objections.
- If Jonathan picks email push: agent drafts **sandwich format** (positive → concern with simple fix → positive). Translate harsh agent words into respectful observations + action steps.
- First two weeks: Jonathan approves sandwich wording. After that Jo runs independently.

## 10–14 day post-showing agent follow-up (Jonathan's buyer showings)
- 10 days after Jonathan showed a property, agent drafts: "Hey [Agent], any news on your buyers for [property]? Still looking, or found something?"
- Seeds Jonathan's brand, surfaces if they bought elsewhere.
- Default ON, per-listing disable available.

## Cancel / Relist workflow
Triggered by Jonathan or by 14-day review decision.

1. Draft SISU `Cancel/Relist Requested` form content (Jonathan executes).
2. Coordinate with listings@faristeam.ca and photography@faristeam.ca — drafts for any requests (e.g., "front aerial with lot lines").
3. On relist live: new MLS ID, re-syndication check, tracker refresh.
4. Trigger marketing AI bot with "price improvement" angle.
5. Reset or branch Day-counter per Jonathan's call.

## Always end with next step
Every outbound seller communication must end with an action plan or next scheduled check-in. Agent verifies before queuing draft.

## Outputs
- Outlook calendar events (14/21/30 day reviews).
- FUB deal updates (listing status).
- Drafts queued in Gmail Drafts.
- Dashboard active-listings board refreshed.
- Call notes for phone-first seller feedback calls.
