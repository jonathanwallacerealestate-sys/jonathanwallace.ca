// ─────────────────────────────────────────────────────────────────
// Sphere module — tiered relationship management over FUB contacts
//
// Reads contacts from Follow Up Boss, classifies each by tier tag
// (Advocate / A / B / C), computes days-since-last-touch, compares
// against a per-tier cadence target, and returns an "overdue" view
// of who needs outreach this week.
//
// Builds on the same FUB auth/fetch pattern already used in
// server.js (/api/fub/calllist, /api/fub/stages) — this module
// doesn't own FUB secrets, it takes them as arguments.
//
// Tier source: today we key off FUB TAGS. If this turns out to be
// stages in Jonathan's data, change TIER_TAG_RULES below — the
// rest of the module is tier-agnostic.
// ─────────────────────────────────────────────────────────────────

/**
 * Target touches per year, translated to an average cadence window
 * in days. When a contact's days-since-last-touch exceeds this,
 * they're flagged overdue.
 *
 * Defaults locked in with Jonathan 2026-04-22:
 *   Advocate 12/yr, A 8/yr, B 4/yr, C 2/yr.
 * Adjust here; everything downstream reads from this one place.
 */
export const CADENCE_DAYS_BY_TIER = {
  advocate: 30,   // 12/yr ≈ every 30 days
  a:        46,   //  8/yr ≈ every 46 days
  b:        91,   //  4/yr ≈ every 91 days
  c:        182,  //  2/yr ≈ every 182 days
};

/**
 * Tier classification. Inspects a FUB contact's `tags` array and
 * picks the highest-priority matching tier.
 *
 * We use startsWith checks (case-insensitive) so variants like
 * "A-tier", "a tier", "A - Hot", "Advocate 2026" all resolve.
 *
 * Priority order: Advocate > A > B > C. The first matching rule
 * wins, so a contact tagged "Advocate" AND "A" is classified as
 * Advocate.
 */
const TIER_TAG_RULES = [
  { tier: 'advocate', matches: (tag) => /^advocate\b/i.test(tag) },
  { tier: 'a',        matches: (tag) => /^a\b|^a[-_ ]/i.test(tag) },
  { tier: 'b',        matches: (tag) => /^b\b|^b[-_ ]/i.test(tag) },
  { tier: 'c',        matches: (tag) => /^c\b|^c[-_ ]/i.test(tag) },
];

/** Classify a contact into a tier. Returns null if no tier tag found. */
export function classifyTier(contact) {
  const tags = Array.isArray(contact?.tags) ? contact.tags : [];
  for (const rule of TIER_TAG_RULES) {
    for (const tag of tags) {
      if (rule.matches(String(tag))) return rule.tier;
    }
  }
  return null;
}

/** Humanize tier key for display. */
export function tierLabel(tier) {
  return { advocate: 'Advocate', a: 'A', b: 'B', c: 'C' }[tier] || 'Untiered';
}

/**
 * "No lead gen" tag detector. Past clients who moved away, don't-contact
 * relationships, etc. — stay in FUB but don't appear in the daily Sphere
 * cadence view. Matches case- and separator-insensitive variants:
 *   "no lead gen", "No-Lead-Gen", "noLeadGen", "no_lead_gen", "noleadgen", etc.
 */
export function hasNoLeadGenTag(person) {
  if (!Array.isArray(person?.tags)) return false;
  return person.tags.some(t => {
    const norm = String(t).toLowerCase().replace(/[\s\-_]+/g, '');
    return norm === 'noleadgen';
  });
}

/**
 * Find the most recent touch for a contact. FUB exposes multiple
 * activity signals — we want the MOST RECENT one across all of them,
 * not the first non-null in some priority order. This matters because
 * a logged note bumps `lastNote` and `lastActivity` but NOT
 * `lastCommunication` — so a stale `lastCommunication` (e.g. from a
 * pre-disconnect period) shouldn't keep the contact stuck in overdue
 * after a real Pop-By or Note was logged.
 *
 * Looks at: lastCommunication, lastActivity, lastNote, lastInbound,
 * lastOutbound. Falls back to `created` if none are present.
 *
 * Returns an ISO string or null.
 */
export function lastTouchAt(contact) {
  if (!contact) return null;
  const candidates = [
    contact.lastCommunication,
    contact.lastActivity,
    contact.lastNote,
    contact.lastInbound,
    contact.lastOutbound,
  ].filter(Boolean);
  if (candidates.length === 0) return contact.created || null;
  // Pick the most recent. Bad date strings sort to NaN — drop them.
  let bestIso = null;
  let bestMs = -Infinity;
  for (const iso of candidates) {
    const ms = new Date(iso).getTime();
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      bestIso = iso;
    }
  }
  return bestIso || contact.created || null;
}

/**
 * Days since last touch. Returns null if we have no touch data.
 */
export function daysSinceLastTouch(contact, now = Date.now()) {
  const iso = lastTouchAt(contact);
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / (24 * 60 * 60 * 1000));
}

/**
 * Compute cadence state for a classified contact.
 *   - cadenceDays:  target window for this tier
 *   - daysSince:    days since last meaningful touch
 *   - overdueBy:    negative = not yet due; 0 = due today; positive = overdue
 *   - status:       'green' | 'amber' | 'red'  (for UI)
 *
 * Amber kicks in at 80% of the cadence window; red at 100%+.
 */
export function cadenceState(contact, tier, now = Date.now()) {
  const cadenceDays = CADENCE_DAYS_BY_TIER[tier];
  const daysSince = daysSinceLastTouch(contact, now);

  if (cadenceDays === undefined || daysSince === null) {
    return { cadenceDays: cadenceDays ?? null, daysSince, overdueBy: null, status: 'unknown' };
  }

  const overdueBy = daysSince - cadenceDays;
  let status = 'green';
  if (daysSince >= cadenceDays) status = 'red';
  else if (daysSince >= cadenceDays * 0.8) status = 'amber';

  return { cadenceDays, daysSince, overdueBy, status };
}

/**
 * Priority score for ranking an overdue list. Higher = more urgent.
 * Weighted so a very overdue Advocate beats a slightly overdue C,
 * and ties are broken by how far past cadence the contact is.
 *
 *   Advocate base: 1000
 *   A base:         500
 *   B base:         200
 *   C base:         100
 * Plus overdueBy (in days), so every day past cadence adds 1 point.
 */
export function priorityScore(tier, state) {
  const BASE = { advocate: 1000, a: 500, b: 200, c: 100 };
  const base = BASE[tier] || 0;
  const od = state?.overdueBy;
  if (od === null || od === undefined) return base;
  return base + Math.max(0, od);
}

/**
 * Fetch all tiered contacts from FUB. Returns an object keyed by
 * tier with arrays of enriched contact records. Untiered contacts
 * are dropped.
 *
 * @param {object} opts
 * @param {string} opts.apiKey   FUB API key
 * @param {string} opts.fubBase  FUB API base URL
 * @param {object} opts.fubHeaders  pre-built headers helper (auth etc.)
 * @param {number} [opts.pageSize=100]  FUB page size (max 100)
 * @param {number} [opts.maxPerStage=500]  safety cap per stage
 * @param {string[]} [opts.stages]  FUB stage names to pull (defaults
 *   to the sphere-relevant stages used in server.js calllist)
 */
export async function fetchSphereByTier({
  apiKey,
  fubBase,
  fubHeaders,
  pageSize = 100,
  maxPerStage = 500,
  stages = [
    'Active Client',
    'A - Hot 1-3 Months',
    'B - Warm 3-6 Months',
    'C - Cold 6+ Months',
    'Past Client',
    'Sphere',
    'Firm',
  ],
} = {}) {
  if (!apiKey) {
    throw new Error('FUB_API_KEY not configured');
  }

  const now = Date.now();
  const seen = new Set(); // dedupe — a contact can be in multiple stages? (rare, but safe)
  const byTier = { advocate: [], a: [], b: [], c: [] };
  const untieredSample = []; // track first 20 we skip so we can surface them to Jonathan
  const excluded = []; // contacts hidden from sphere by the "no lead gen" tag
  let totalFetched = 0;

  for (const stage of stages) {
    let offset = 0;
    let keepGoing = true;

    while (keepGoing) {
      const url = `${fubBase}/people?stage=${encodeURIComponent(stage)}` +
                  `&limit=${pageSize}&offset=${offset}` +
                  `&sort=lastActivity&order=asc` +
                  `&includeTrash=false`;
      const resp = await fetch(url, { headers: fubHeaders() });
      if (!resp.ok) {
        console.error(`[sphere] FUB error (${stage}, offset ${offset}): ${resp.status}`);
        break;
      }
      const data = await resp.json();
      const people = Array.isArray(data?.people) ? data.people : [];
      totalFetched += people.length;

      for (const p of people) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);

        // "No lead gen" — past clients out of geo, don't-contact people, etc.
        // Stay in FUB and remain searchable in Agent HQ, but never surface in
        // the daily Sphere overdue/tier views. Match common formatting variants.
        if (hasNoLeadGenTag(p)) {
          const tier = classifyTier(p);
          const state = tier ? cadenceState(p, tier, now) : { cadenceDays: null, daysSince: null, overdueBy: null, status: 'unknown' };
          excluded.push({
            fubId: p.id,
            name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.name || '(no name)',
            firstName: p.firstName || '',
            lastName: p.lastName || '',
            email: (Array.isArray(p.emails) && p.emails[0]?.value) || '',
            phone: (Array.isArray(p.phones) && p.phones[0]?.value) || '',
            stage: p.stage || '',
            tags: Array.isArray(p.tags) ? p.tags : [],
            tier,
            lastTouchAt: lastTouchAt(p),
            daysSince: state.daysSince,
            cadenceDays: state.cadenceDays,
            overdueBy: state.overdueBy,
            status: state.status,
            score: tier ? priorityScore(tier, state) : 0,
            fubUrl: `https://app.followupboss.com/2/people/view/${p.id}`,
            excluded: true,
          });
          continue;
        }

        const tier = classifyTier(p);
        if (!tier) {
          if (untieredSample.length < 20) {
            untieredSample.push({
              fubId: p.id,
              name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.name || '(no name)',
              stage: p.stage,
              tags: p.tags || [],
            });
          }
          continue;
        }

        const state = cadenceState(p, tier, now);
        byTier[tier].push({
          fubId: p.id,
          name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.name || '(no name)',
          firstName: p.firstName || '',
          lastName: p.lastName || '',
          email: (Array.isArray(p.emails) && p.emails[0]?.value) || '',
          phone: (Array.isArray(p.phones) && p.phones[0]?.value) || '',
          stage: p.stage || '',
          tags: Array.isArray(p.tags) ? p.tags : [],
          tier,
          lastTouchAt: lastTouchAt(p),
          daysSince: state.daysSince,
          cadenceDays: state.cadenceDays,
          overdueBy: state.overdueBy,
          status: state.status,
          score: priorityScore(tier, state),
          fubUrl: `https://app.followupboss.com/2/people/view/${p.id}`,
        });
      }

      if (people.length < pageSize) keepGoing = false;
      else {
        offset += pageSize;
        if (offset >= maxPerStage) keepGoing = false;
      }
    }
  }

  // Sort each tier by priority score (most urgent first)
  for (const t of Object.keys(byTier)) {
    byTier[t].sort((a, b) => b.score - a.score);
  }

  const counts = {
    advocate: byTier.advocate.length,
    a: byTier.a.length,
    b: byTier.b.length,
    c: byTier.c.length,
    untiered: untieredSample.length,
    excluded: excluded.length,
    totalFetched,
    uniqueContacts: seen.size,
  };

  return {
    byTier,
    counts,
    untieredSample,
    excluded, // contacts hidden by "no lead gen" tag — searchable, not rendered as cards
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Slice: just the overdue list across all tiers, ranked by urgency.
 * Useful for the Morning Brief widget and daily task queue.
 */
export function flattenOverdue(byTier, { limit = 50 } = {}) {
  const all = [];
  for (const t of ['advocate', 'a', 'b', 'c']) {
    for (const c of byTier[t] || []) {
      if (c.status === 'red') all.push(c);
    }
  }
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, limit);
}
