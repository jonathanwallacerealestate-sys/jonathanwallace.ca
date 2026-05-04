// lib/cma/run.js
//
// Autonomous CMA analyzer. Takes a CMA record (with subject + uploaded comps)
// and returns a structured pricing analysis via Claude API. Runs entirely
// server-side — no Chrome extension, no REALM scrape, no copy/paste.
//
// Methodology: Suze Cumming "The Nature of Real Estate" — subject analysis,
// disciplined comp weighting, adjustment grid, conservative price range.
//
// Used by:
//   - server.js: auto-fired when a new CMA is created with ≥2 comps
//   - server.js: POST /api/cma/:id/run for on-demand re-runs

export const CMA_RUNNER_MODEL = process.env.CMA_RUNNER_MODEL || 'claude-haiku-4-5-20251001';
export const CMA_RUNNER_MIN_COMPS = 2;
// 8000 is generous — Haiku 4.5 supports up to 64k output tokens.
// Previously 3000, which truncated mid-string when the adjustment grid had
// many comps + full narrative + seller update + bullets + warnings.
export const CMA_RUNNER_MAX_TOKENS = 8000;

function fmtMoney(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString();
}

/**
 * Best-effort repair of a JSON string that was truncated mid-output (typically
 * because the model hit max_tokens). Walks the string tracking string state
 * and bracket depth, then closes whatever's still open.
 *
 * Returns the repaired string, or null if the input doesn't look recoverable.
 */
function repairTruncatedJson(s) {
  if (!s || typeof s !== 'string' || s.length < 10) return null;
  // Trim trailing whitespace and any orphan partial token (like a trailing comma)
  let str = s.replace(/[\s,]+$/, '');

  let inString = false;
  let escape = false;
  const stack = []; // stack of '{' or '['
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' && stack[stack.length - 1] === '{') stack.pop();
    else if (ch === ']' && stack[stack.length - 1] === '[') stack.pop();
  }
  // Close dangling string
  if (inString) str += '"';
  // Close dangling structures (innermost first)
  while (stack.length) {
    const open = stack.pop();
    str += open === '{' ? '}' : ']';
  }
  // Strip any trailing comma right before the closing brackets we just added
  str = str.replace(/,(\s*[}\]])/g, '$1');
  return str;
}

function formatSubject(cma) {
  const lines = [];
  lines.push(`Address: ${cma.address || '—'}, ${cma.city || '—'}, ${cma.province || 'ON'}`);
  if (cma.mlsId) lines.push(`MLS#: ${cma.mlsId}`);
  if (cma.propertyClass) lines.push(`Class: ${cma.propertyClass}`);
  if (cma.style) lines.push(`Style: ${cma.style}`);
  if (cma.bedrooms) lines.push(`Bedrooms: ${cma.bedrooms}`);
  if (cma.bathrooms) lines.push(`Bathrooms: ${cma.bathrooms}`);
  if (cma.sqft) lines.push(`Approx sqft: ${cma.sqft}`);
  if (cma.lotSize) lines.push(`Lot: ${cma.lotSize}`);
  if (cma.yearBuilt) lines.push(`Year built: ${cma.yearBuilt}`);
  if (cma.foundation) lines.push(`Foundation: ${cma.foundation}`);
  if (cma.garage) lines.push(`Garage: ${cma.garage}`);
  if (cma.waterfront) lines.push(`Waterfront: yes`);
  if (cma.listPrice) lines.push(`Current list price: ${fmtMoney(cma.listPrice)}`);
  if (cma.notes) lines.push(`Notes: ${cma.notes}`);

  // GeoWarehouse / MPAC data — authoritative for property facts (lot, zoning,
  // taxes, sales history, year built). NOT reliable for room counts.
  if (cma.geoData && typeof cma.geoData === 'object') {
    const g = cma.geoData;
    lines.push('');
    lines.push('GeoWarehouse / MPAC data (authoritative for property facts):');
    if (g.pin) lines.push(`  PIN: ${g.pin}`);
    if (g.legalDescription) lines.push(`  Legal: ${String(g.legalDescription).slice(0, 240)}`);
    if (g.zoning) lines.push(`  Zoning: ${g.zoning}`);
    if (g.lotDimensions) lines.push(`  Lot dimensions: ${g.lotDimensions}`);
    if (g.lotFrontage) lines.push(`  Frontage: ${g.lotFrontage} ft`);
    if (g.lotDepth) lines.push(`  Depth: ${g.lotDepth} ft`);
    if (g.assessedValue) lines.push(`  MPAC assessed value: ${fmtMoney(g.assessedValue)}`);
    if (g.taxes) lines.push(`  Taxes: ${fmtMoney(g.taxes)}${g.taxYear ? ' (' + g.taxYear + ')' : ''}`);
    if (g.waterSource) lines.push(`  Water: ${g.waterSource}`);
    if (g.sewerType) lines.push(`  Sewer: ${g.sewerType}`);
    if (g.lastSaleDate || g.lastSalePrice) {
      lines.push(`  Last registered sale: ${g.lastSaleDate || '—'} for ${g.lastSalePrice ? fmtMoney(g.lastSalePrice) : '—'} (do NOT anchor valuation on this — context only)`);
    }
  }

  // Prior listing data — historical context (failed listings, last list/sold price,
  // remarks describing condition at time of listing). May be 1-5 years old.
  if (cma.subjectListingData && typeof cma.subjectListingData === 'object') {
    const s = cma.subjectListingData;
    lines.push('');
    lines.push('Subject\'s prior REALM listing (historical context — may be 1-5 years old):');
    if (s.priorMlsId) lines.push(`  Prior MLS#: ${s.priorMlsId}`);
    if (s.originalListPrice) lines.push(`  Originally listed at: ${fmtMoney(s.originalListPrice)}`);
    if (s.priorListedDate) lines.push(`  Prior listed: ${s.priorListedDate}`);
    if (s.priorSoldPrice) lines.push(`  Prior sold price: ${fmtMoney(s.priorSoldPrice)}`);
    if (s.priorSoldDate) lines.push(`  Prior sold: ${s.priorSoldDate}`);
    if (s.priorDaysOnMarket != null) lines.push(`  Prior DOM: ${s.priorDaysOnMarket}`);
    if (s.publicRemarks) lines.push(`  Prior remarks: ${String(s.publicRemarks).slice(0, 600)}`);
    if (s.features) lines.push(`  Prior features: ${String(s.features).slice(0, 300)}`);
  }

  return lines.join('\n');
}

function formatComp(c, kind) {
  const lines = [];
  lines.push(`[${kind} comp · id=${c.id}]`);
  if (c.address) lines.push(`Address: ${c.address}${c.city ? ', ' + c.city : ''}`);
  if (c.mlsId) lines.push(`MLS#: ${c.mlsId}`);
  if (c.soldPrice) lines.push(`Sold price: ${fmtMoney(c.soldPrice)}`);
  if (c.listPrice && !c.soldPrice) lines.push(`List price: ${fmtMoney(c.listPrice)}`);
  else if (c.listPrice) lines.push(`Original list: ${fmtMoney(c.listPrice)}`);
  if (c.soldDate) lines.push(`Sold: ${c.soldDate}`);
  if (c.listedDate) lines.push(`Listed: ${c.listedDate}`);
  if (c.daysOnMarket != null) lines.push(`DOM: ${c.daysOnMarket}`);
  if (c.bedrooms) lines.push(`Bedrooms: ${c.bedrooms}`);
  if (c.bathrooms) lines.push(`Bathrooms: ${c.bathrooms}`);
  if (c.sqft) lines.push(`Approx sqft: ${c.sqft}`);
  if (c.lotSize) lines.push(`Lot: ${c.lotSize}`);
  if (c.yearBuilt) lines.push(`Year built: ${c.yearBuilt}`);
  if (c.style) lines.push(`Style: ${c.style}`);
  if (c.foundation) lines.push(`Foundation: ${c.foundation}`);
  if (c.garage) lines.push(`Garage: ${c.garage}`);
  if (c.waterfront) lines.push(`Waterfront: yes`);
  if (c.publicRemarks) lines.push(`Remarks: ${String(c.publicRemarks).slice(0, 600)}`);
  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are an appraisal-grade Comparative Market Analysis (CMA) analyst for Ontario residential real estate, specializing in the Georgian Bay / Simcoe County markets (Midland, Penetanguishene, Tay, Tiny, Wasaga Beach, Barrie, Orillia).

Apply Suze Cumming's methodology from "The Nature of Real Estate":

1. SUBJECT ANALYSIS: Note condition, size, location, age, key features.
   Identify what makes the subject unique vs. typical local stock.

   CRITICAL — read the subject notes field VERY carefully. If the notes
   describe condition (e.g., "beat up", "low-grade finishes", "crawlspace
   only", "no finished driveway", "freshly renovated"), treat those as
   AUTHORITATIVE. The agent has been on-site; you have not. Apply the
   adjustments listed below in step 3 based on those notes, even when the
   listing PDF or GeoWarehouse data doesn't capture them.

   If the subject has a CRAWLSPACE (not a basement), this is the single
   most important fact to weigh. Most comps in this market have full
   basements — adjust each comp DOWN by $60,000 to $100,000 for that
   structural difference alone, before you start on condition / finishes.

2. COMP SELECTION: Prefer recent sales (≤90 days), similar size (±20%), similar area, similar condition. Weight recent sales over actives. Note any comp that's stale or stretches the criteria.

3. ADJUSTMENT GRID: For each comp, list the adjustments you'd apply to bring it onto the subject's footing. Sum adjustments → adjusted value per comp.

   GEORGIAN BAY / SIMCOE COUNTY ADJUSTMENT MAGNITUDES (calibrated by Jonathan
   Wallace from on-the-ground sales — these are LOCAL TRUTHS, not generic ranges):

   BASEMENT — one of the largest single drivers in this market:
     • Crawlspace only or no basement vs. comp WITH a basement → -$60,000 to -$100,000
     • Subject has full unfinished basement vs. comp without → +$60,000 to +$100,000
     • Finished basement adds another +$60,000 to +$100,000 over unfinished
     CRITICAL: do NOT skip this adjustment. Homes without basements have a
     much smaller buyer pool and resell harder. If a comp has a basement and
     the subject does not (or vice versa), the adjustment MUST be in the
     -$60K to -$100K range — never less.

   CONDITION / FINISHES — second-largest driver after basement:
     • Beat-up interior, low-grade finishes, dated kitchen/bath, deferred
       maintenance → -$40,000 to -$80,000 vs. comparable updated homes
     • Builder-grade / standard / well-maintained → baseline (no adjustment)
     • Recently updated kitchen + baths, fresh paint, modern fixtures → +$30,000 to +$60,000
     • Luxury / custom finishes throughout → +$80,000 to +$150,000+

   DRIVEWAY:
     • Gravel or unfinished driveway → -$10,000 vs. paved/concrete
     • Standard paved or concrete → baseline
     • Stamped concrete, interlock, decorative → +$5,000 to +$15,000

   GARAGE (Midland-area context):
     • No garage → -$25,000 to -$40,000 vs. single attached
     • Single attached → baseline
     • Double attached → +$30,000 to +$50,000
     • Detached shop / oversized garage → +$20,000 to +$60,000 depending on size

   WATERFRONT — huge:
     • Direct waterfront with frontage → +$100,000 to +$300,000+ vs. inland comp
     • Water access / deeded waterfront / view → +$30,000 to +$80,000
     • Adjustment scale depends on water type (Georgian Bay direct >> inland lake)

   LOCATION QUALITY:
     • Premium street / view / proximity to amenities → +$20,000 to +$60,000
     • Standard residential → baseline
     • Backing onto commercial / busy road / power lines → -$20,000 to -$50,000

   STANDARD ADJUSTMENTS (apply on top of the above):
     • Time of sale: recent sales need less; stale sales get a market-trend
       adjustment of ~0.3-0.5% per month in either direction
     • Size: $80-180/sqft contributory value for sqft delta
     • Bedrooms: $8-15K per bedroom delta
     • Bathrooms: $10-20K per full bath delta
     • Lot size / frontage: $300-800 per linear foot of frontage delta in
       residential areas; more on premium lots
     • Style premium: bungalow premium for retirees, +$10-25K vs. 2-storey
       in this demographic

   When in doubt, apply LARGER adjustments rather than smaller. Underestimating
   adjustments produces overpriced CMAs, which lose listings.

4. RECONCILE: Weighted average of adjusted comps → subject estimated value. Discount comps that needed huge adjustments.

5. PRICE RANGE:
   - low = aggressive (~92-95% of estimated value, attracts multiple offers)
   - mid = expected market price
   - high = stretch (~105-108%, room to negotiate down)

6. DAYS ON MARKET: Based on comp DOM averages + current market velocity in the area.

7. NARRATIVE: Two flavours, both CONCISE — over-long narratives waste tokens
   and risk truncating the JSON. Hard caps:
   - pricingNarrative: agent-facing, 2-3 short paragraphs, ~250 words MAX,
     technical and defensible
   - sellerUpdate: seller-facing, 1 warm but honest paragraph, ~120 words MAX,
     no jargon
   - pricingBullets: 4-6 punchy bullets, each under 20 words
   - adjustmentGrid notes: one short sentence per comp, under 30 words each
   - warnings: only flag genuine issues (stretched comp, missing data) — no
     boilerplate disclaimers

Return ONLY valid JSON. No prose, no code fences. Schema:

{
  "priceRange": {"low": number, "mid": number, "high": number},
  "estimatedDom": number,
  "pricingNarrative": string,
  "pricingBullets": [string],
  "sellerUpdate": string,
  "adjustmentGrid": [
    {
      "compId": string,
      "address": string,
      "kind": "sold" | "active",
      "adjustedValue": number,
      "adjustments": {"<feature>": number},
      "weight": number,
      "notes": string
    }
  ],
  "warnings": [string]
}

If you have fewer than 2 comps, set every numeric field to null and return one warning explaining the limitation.`;

/**
 * Run the analyzer against a CMA record.
 *
 * @param {object} cma - The CMA record (must include comps.solds[] and comps.actives[])
 * @param {object} opts
 * @param {object} opts.anthropic - Anthropic SDK client
 * @param {string} [opts.model] - Model id (defaults to CMA_RUNNER_MODEL)
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   priceRange?: {low: number, mid: number, high: number},
 *   estimatedDom?: number,
 *   pricingNarrative?: string,
 *   pricingBullets?: string[],
 *   sellerUpdate?: string,
 *   adjustmentGrid?: Array,
 *   warnings?: string[],
 *   error?: string,
 *   model?: string,
 *   usage?: object
 * }>}
 */
export async function runCmaAnalysis(cma, { anthropic, model = CMA_RUNNER_MODEL } = {}) {
  if (!anthropic) return { ok: false, error: 'Anthropic not configured' };

  const solds = (cma.comps && cma.comps.solds) || [];
  const actives = (cma.comps && cma.comps.actives) || [];
  const compCount = solds.length + actives.length;

  if (compCount < CMA_RUNNER_MIN_COMPS) {
    return {
      ok: false,
      error: `Need at least ${CMA_RUNNER_MIN_COMPS} comparables to run analysis. Currently have ${compCount}. Drop more comp PDFs in the New CMA modal, or use the realm-cma skill to pull from REALM.`,
    };
  }

  // Build the user message
  const subjectBlock = formatSubject(cma);
  const compsBlock = [
    ...solds.map(c => formatComp(c, 'SOLD')),
    ...actives.map(c => formatComp(c, 'ACTIVE')),
  ].join('\n\n');

  const userMessage = `SUBJECT PROPERTY:
${subjectBlock}

COMPARABLES (${compCount}):
${compsBlock}

Generate the appraisal-grade analysis as JSON.`;

  try {
    const completion = await anthropic.messages.create({
      model,
      max_tokens: CMA_RUNNER_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const raw = (completion.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    // Strip optional code fences
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      // Truncation recovery — if Claude hit max_tokens mid-string we can
      // sometimes salvage the partial response by closing dangling strings,
      // arrays, and objects.
      const repaired = repairTruncatedJson(cleaned);
      if (repaired) {
        try {
          parsed = JSON.parse(repaired);
          console.warn('[CMA Runner] recovered from truncated JSON via repair pass');
        } catch (repairErr) {
          console.error('[CMA Runner] JSON parse failed even after repair. Raw:', raw.slice(0, 500));
          return {
            ok: false,
            error: `Analyzer returned malformed JSON (likely truncated at ${cleaned.length} chars). Try re-running. ${parseErr.message}`,
          };
        }
      } else {
        console.error('[CMA Runner] JSON parse failed. Raw:', raw.slice(0, 500));
        return { ok: false, error: 'Analyzer returned malformed JSON: ' + parseErr.message };
      }
    }

    return {
      ok: true,
      ...parsed,
      model,
      usage: completion.usage || null,
    };
  } catch (err) {
    console.error('[CMA Runner] error:', err.message);
    return { ok: false, error: err.message };
  }
}
