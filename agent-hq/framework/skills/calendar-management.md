---
name: calendar-management
description: Outlook is the source of truth (mirrored to Google). Read both, write to Outlook. Respect protected blocks (Tue 9-11 coaching, Wed/Thu 7-10 PM billiards, Sunday off). Apply category colors (Red/Green/Yellow). Enforce booking standards (listing appt 2 hrs, max 2/afternoon, 30-min travel buffer, no provisional holds).
---

# Calendar Management

## Source of truth
- **Outlook** = truth (Jonathan carries on phone).
- **Google Calendar** = mirror (already syncs from Outlook).
- **FUB calendars** = read-only mirrors via existing FUB↔calendar integration.

Read both Outlook (hourly Chrome routine) and Google API. **Write to Outlook primary.** Google updates flow through existing mirror.

## Category colors (must apply)
- **Red** = work
- **Green** = family
- **Yellow** = business development

## Protected blocks (never schedule, never interrupt)
- **Tue 9:00–11:00 AM** — Greg Halthaus / Tom Ferry coaching. DND.
- **Wed & Thu 7:00–10:00 PM** — billiards (arrives 6:30 PM, home by 5:00 PM those days).
- **Sun morning** — off.
- **Sun all day** — soft mode unless approved.
- **Family events (Green category)** — inviolable.

## Standard booking parameters
| Event type | Default length | Notes |
|------------|---------------|-------|
| Listing appointment | 2 hours | Max 2/afternoon. 30-min travel buffer. |
| Buyer consult | 1 hour | Virtual unless specified. |
| Weekly seller call | 15 minutes | Mon 1:00–4:00 PM. |
| 21-day market review | 1 hour | Pre-booked at intake. |
| 14-day / 30-day review | 1 hour | Pre-booked at intake. |
| Showings (own) | per BrokerBay | + 30-min travel buffer. |

## Available windows
- Mon: 8:30 AM – 6:00 PM
- Tue: 8:30 AM – 6:00 PM (excluding 9–11 coaching)
- Wed: 8:30 AM – 4:00 PM
- Thu: 8:30 AM – 4:00 PM
- Fri: 8:30 AM – 6:00 PM
- Sat: 10:00 AM – 4:30 PM (Jonathan approval required)
- Sun: off limits unless approved

## Conflict prevention
On any new booking attempt, agent checks against:
1. Existing Outlook events.
2. Protected blocks.
3. Travel buffer needs (next/previous event location).
4. Family calendar items.

If conflict detected, push to `Claude stuck` ticker — never guess.

## Booking discipline
- **No provisional holds.** Book only when confirmed.
- Calendar invites for client events go via Outlook.
- Saturday bookings need Jonathan approval.
- Sunday bookings need explicit Jonathan approval.

## Outputs
- Outlook events (with category color applied).
- Dashboard today/week panel.
- Conflict-detection prompts.
