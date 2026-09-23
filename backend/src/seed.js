'use strict';

const { addDays, torontoDate, torontoDateTimeISO } = require('./time');

/** First-boot board so / is not an empty screen. Replaced by the next ingest. */
function buildSeed(today = torontoDate()) {
  const weekOut = addDays(today, 7);
  const tomorrow = addDays(today, 1);
  const openSince = addDays(today, -14);

  return {
    date: today,
    timezone: 'America/Toronto',
    mix: [
      {
        title: '12-155 William',
        valueLabel: '~$1.225M firm',
        deadline: torontoDateTimeISO(weekOut, 17, 0),
        action: 'Order status cert CondoCafe',
        owner: 'JW',
        status: 'open'
      },
      {
        title: '84 Mosley, Wasaga',
        valueLabel: 'Conditional',
        deadline: torontoDateTimeISO(tomorrow, 17, 0),
        action: 'Waiver or walk — call the buyer',
        owner: 'JW',
        status: 'open'
      }
    ],
    mustDo: [
      {
        rank: 1,
        title: 'Order status certificate — 12-155 William',
        why: 'Firm. The CondoCafe 10-day clock starts the morning it is ordered.',
        ctaLabel: 'Call CondoCafe',
        ctaHref: 'tel:+17055550140'
      },
      {
        rank: 2,
        title: 'Chase the unsigned listing — 18 Baltic',
        why: 'DocuSign is still with the seller. MLS cannot go live.',
        ctaLabel: 'Email seller',
        ctaHref: 'mailto:seller@example.com?subject=18%20Baltic%20listing%20signature'
      },
      {
        rank: 3,
        title: 'Confirm 22 Champlain is live on MLS',
        why: 'Photos are up. Nobody has confirmed the listing is actually live.',
        ctaLabel: 'Mark confirmed',
        ctaHref: 'checklist'
      },
      {
        rank: 4,
        title: 'Co-op feedback to Craig Strachan',
        why: 'The showing at 48 Zoo Park is still open. He is waiting.',
        ctaLabel: 'Call Craig',
        ctaHref: 'tel:+17055550190'
      },
      {
        rank: 5,
        title: 'Book the photo retake — 9 Tiny Beaches',
        why: 'The twilight set clashes with the MLS remarks. Do it before weekend traffic.',
        ctaLabel: 'Mark booked',
        ctaHref: 'checklist'
      }
    ],
    listings: [
      { address: '18 Baltic', note: 'DocuSign listing agreement still unsigned.', status: 'unsigned' },
      { address: '9 Tiny Beaches', note: 'Twilight photos do not match the remarks.', status: 'photo-clash' },
      { address: '22 Champlain', note: 'Uploaded. Live status not confirmed.', status: 'live' },
      { address: '140 Main, Penetang', note: 'Expiry date is missing on the listing.', status: 'expiry-missing' }
    ],
    feedbackOwed: [
      { address: '48 Zoo Park Rd, Wasaga', to: 'Craig Strachan', openSince }
    ],
    parked: ['Dial backlog', 'Newsletter unsub cleanup', 'Buffer queue review'],
    triggers: [
      {
        label: 'Wasaga farm',
        when: 'Saturday',
        note: 'Only if the William status certificate is already ordered.'
      }
    ],
    notes: 'Sample board seeded so the first open is not blank. A weekday desk push replaces it.',
    updatedAt: new Date().toISOString(),
    seeded: true
  };
}

module.exports = { buildSeed };
