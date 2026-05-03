// lib/parsers/realm-listing.js
//
// Parse an Ontario REALM MLS listing PDF (active or sold) into structured
// fields suitable for the CMA intake form.
//
// Strategy:
//   1. Try pure regex/text parsing for the obvious structured fields
//      (MLS#, prices, beds, baths, sqft, lot, year, taxes, dates).
//   2. Optionally call Anthropic with the full text + a JSON schema for
//      a single-shot structured extraction. AI fills gaps and pulls soft
//      fields (style, foundation, heating, basement, public remarks,
//      inclusions, features) more reliably than regex.
//   3. Merge: AI result wins on soft fields; regex wins on hard fields
//      where the regex hit (MLS#, prices, dates).
//
// Returns the merged object. Missing fields are null. Caller is expected
// to hand the result to the React form which merges into form state.

const SCHEMA_DOC = `{
  "address": string|null,
  "city": string|null,
  "province": string|null,
  "postalCode": string|null,
  "mlsId": string|null,
  "status": "Sold"|"Active"|"Terminated"|"Suspended"|"Expired"|"Leased"|"Closed"|"Pending"|"Conditional"|null,
  "listPrice": number|null,
  "soldPrice": number|null,
  "listedDate": string|null (ISO date),
  "soldDate": string|null (ISO date),
  "daysOnMarket": number|null,
  "bedrooms": string|null (e.g. "3+1"),
  "bathrooms": string|null (e.g. "2+1"),
  "sqft": string|null (e.g. "1500-1750" or "1234"),
  "lotSize": string|null (e.g. "60 x 120 ft"),
  "yearBuilt": number|null,
  "approxAge": string|null (e.g. "0-5", "16-30", "51-99"),
  "style": string|null (Bungalow, 2-Storey, Sidesplit, Backsplit, Bungaloft, etc.),
  "propertyType": string|null (Detached, Semi-Detached, Townhouse, Condo Apt, etc.),
  "propertyClass": "Freehold"|"Condo"|"Commercial"|null,
  "basement": string|null,
  "foundation": string|null (Poured Concrete, Concrete Block, Stone, etc.),
  "heating": string|null,
  "cooling": string|null,
  "garage": string|null,
  "parking": string|null,
  "taxes": number|null,
  "taxYear": number|null,
  "waterfront": boolean|null,
  "inclusions": string|null,
  "publicRemarks": string|null,
  "features": string|null
}`;

// ---------- Regex helpers ----------

function num(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[$,]/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function trim(s) {
  return s == null ? null : String(s).trim().replace(/\s+/g, ' ');
}

function regexFirst(text, ...patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1] != null) return m[1];
  }
  return null;
}

function parseRegexPass(text) {
  const t = text || '';
  const out = {
    address: null, city: null, province: null, postalCode: null,
    mlsId: null, status: null,
    listPrice: null, soldPrice: null,
    listedDate: null, soldDate: null, daysOnMarket: null,
    bedrooms: null, bathrooms: null,
    sqft: null, lotSize: null,
    yearBuilt: null, approxAge: null,
    style: null, propertyType: null, propertyClass: null,
    basement: null, foundation: null,
    heating: null, cooling: null,
    garage: null, parking: null,
    taxes: null, taxYear: null,
    waterfront: null,
    inclusions: null, publicRemarks: null, features: null,
  };

  // MLS # — TRREB / Itso style: letter prefix + 8 digits
  out.mlsId = trim(regexFirst(
    t,
    /\bMLS\s*#?\s*[:\-]?\s*([A-Z]\d{7,8})\b/i,
    /\b([A-Z]\d{8})\b/,
  ));

  // Status — REALM puts "Sold" / "Active" / "Terminated" near the top of the
  // listing block. Capture it explicitly so the frontend can auto-route
  // comps without relying on price-field presence alone.
  const statusRaw = regexFirst(
    t,
    /\bStatus\s*[:\-]?\s*(Sold|Active|Terminated|Suspended|Expired|Leased|Closed|Pending|Conditional)\b/i,
    /\b(Sold|Active|Terminated|Suspended|Expired|Leased|Closed|Pending|Conditional)\s+Price\b/i,
  );
  if (statusRaw) out.status = trim(statusRaw);

  // List price / Sold price.
  // REALM's "Print to PDF" puts the sold price in the top-right of each
  // listing card. pdf-parse may render it without a "Price:" label — just
  // "Sold $X,XXX,XXX" or "$X,XXX,XXX" right under "Sold". Match all
  // common shapes.
  const lp = regexFirst(
    t,
    /List\s*Price\s*[:\-]?\s*\$?([\d,]+)/i,
    /Asking\s*Price\s*[:\-]?\s*\$?([\d,]+)/i,
    /\bLP\s*[:\-]?\s*\$?([\d,]+)/i,
    /Original\s*(?:List\s*)?Price\s*[:\-]?\s*\$?([\d,]+)/i,
  );
  if (lp) out.listPrice = num(lp);

  const sp = regexFirst(
    t,
    /Sold\s*Price\s*[:\-]?\s*\$?([\d,]+)/i,
    /Sale\s*Price\s*[:\-]?\s*\$?([\d,]+)/i,
    /Closed\s*Price\s*[:\-]?\s*\$?([\d,]+)/i,
    /\bSP\s*[:\-]?\s*\$?([\d,]+)/i,
    // Bare "Sold" header followed by a price on the next non-empty line
    // (matches REALM's top-right card layout after pdf-parse linearization).
    /\bSold\s*\n+\s*\$\s*([\d,]+)/i,
    /\$\s*([\d,]+)\s*\n\s*Sold\b/i,
  );
  if (sp) out.soldPrice = num(sp);

  // Bidirectional inference from status — if status is explicitly Sold but
  // we couldn't catch the soldPrice via regex, the AI pass usually fills it.
  // If status is Active and we accidentally pulled a "soldPrice" from history,
  // wipe it so the comp gets correctly classified as active.
  if (out.status && /^(active|terminated|suspended|expired|pending|conditional)$/i.test(out.status)) {
    out.soldPrice = null;
  }

  // Days on Market
  const dom = regexFirst(t, /\bDOM\s*[:\-]?\s*(\d+)\b/i, /Days\s*on\s*Market\s*[:\-]?\s*(\d+)/i);
  if (dom) out.daysOnMarket = num(dom);

  // Bedrooms / bathrooms
  out.bedrooms = trim(regexFirst(
    t,
    /Bedrooms?\s*[:\-]?\s*(\d+(?:\s*\+\s*\d+)?)/i,
    /\bBeds?\s*[:\-]?\s*(\d+(?:\s*\+\s*\d+)?)/i,
  ));
  out.bathrooms = trim(regexFirst(
    t,
    /Bathrooms?\s*[:\-]?\s*(\d+(?:\s*\+\s*\d+)?)/i,
    /\bBaths?\s*[:\-]?\s*(\d+(?:\s*\+\s*\d+)?)/i,
  ));

  // Sqft (often "1500-1750", "Approx 1234", "1500 sqft")
  out.sqft = trim(regexFirst(
    t,
    /Approx(?:imate)?\s*(?:Square\s*F(?:oo|ee)tage|Sq\s*Ft|Sqft)\s*[:\-]?\s*([\d,\-\s]+(?:sq\s*ft)?)/i,
    /(?:Square\s*F(?:oo|ee)tage|Sq\s*Ft|Sqft)\s*[:\-]?\s*([\d,\-\s]+)/i,
  ));

  // Lot size — frontage x depth, in ft or m
  out.lotSize = trim(regexFirst(
    t,
    /Lot\s*(?:Size|Dimensions?|Frontage)\s*[:\-]?\s*([\d.]+\s*[xX×]\s*[\d.]+\s*(?:ft|feet|m|metres)?)/i,
    /Lot\s*[:\-]?\s*([\d.]+\s*[xX×]\s*[\d.]+\s*(?:ft|feet|m|metres)?)/i,
  ));

  // Year built / Approximate Age (REALM uses bands like "16-30", "51-99")
  const yb = regexFirst(t, /Year\s*Built\s*[:\-]?\s*(\d{4})/i, /Built\s*[:\-]?\s*(\d{4})/i);
  if (yb) out.yearBuilt = num(yb);
  out.approxAge = trim(regexFirst(t, /Approx(?:imate)?\s*Age\s*[:\-]?\s*([\d\-+ a-zA-Z]+)\n/i));

  // Taxes
  const tx = regexFirst(t, /(?:Annual\s*)?Taxes?\s*[:\-]?\s*\$?([\d,]+)/i, /Property\s*Tax(?:es)?\s*[:\-]?\s*\$?([\d,]+)/i);
  if (tx) out.taxes = num(tx);
  const txY = regexFirst(t, /Tax\s*Year\s*[:\-]?\s*(\d{4})/i);
  if (txY) out.taxYear = num(txY);

  // Style (very loose — REALM commonly uses 1-2 word descriptors)
  out.style = trim(regexFirst(
    t,
    /Style\s*[:\-]?\s*([A-Za-z][A-Za-z \-/]{2,40})\n/,
  ));

  // Property type (Freehold/Condo/Commercial categories)
  const ptypeRaw = regexFirst(
    t,
    /Property\s*Type\s*[:\-]?\s*([A-Za-z][A-Za-z \-/]{2,40})\n/i,
  );
  if (ptypeRaw) out.propertyType = trim(ptypeRaw);
  if (/condo|condominium|apartment|apt/i.test(t)) out.propertyClass = 'Condo';
  if (/commercial|industrial/i.test(t) && !out.propertyClass) out.propertyClass = 'Commercial';
  if (!out.propertyClass) out.propertyClass = 'Freehold';

  // Foundation, basement, heating, cooling, garage, parking
  out.foundation = trim(regexFirst(t, /Foundation\s*[:\-]?\s*([A-Za-z][A-Za-z ,/]{2,80})\n/i));
  out.basement   = trim(regexFirst(t, /Basement\s*[:\-]?\s*([A-Za-z][A-Za-z ,/]{2,80})\n/i));
  out.heating    = trim(regexFirst(t, /Heat(?:ing)?\s*[:\-]?\s*([A-Za-z][A-Za-z ,/]{2,80})\n/i));
  out.cooling    = trim(regexFirst(t, /(?:Air\s*Conditioning|Cooling|A\/C)\s*[:\-]?\s*([A-Za-z][A-Za-z ,/]{2,80})\n/i));
  out.garage     = trim(regexFirst(t, /Garage\s*(?:Type)?\s*[:\-]?\s*([A-Za-z][A-Za-z ,/0-9]{2,80})\n/i));
  out.parking    = trim(regexFirst(t, /Parking\s*(?:Spaces?)?\s*[:\-]?\s*([\d]+)/i));

  // Waterfront flag
  if (/waterfront\s*[:\-]?\s*(yes|y|true)/i.test(t)) out.waterfront = true;
  else if (/waterfront\s*[:\-]?\s*(no|n|false)/i.test(t)) out.waterfront = false;

  // Address line — very loose first pass
  const addrLine = regexFirst(t, /Address\s*[:\-]?\s*([^\n]{6,120})/i);
  if (addrLine) out.address = trim(addrLine);

  // Postal code
  out.postalCode = trim(regexFirst(t, /\b([A-Z]\d[A-Z]\s*\d[A-Z]\d)\b/));

  return out;
}

// ---------- Anthropic pass ----------

async function parseAnthropicPass(text, anthropic, model = 'claude-haiku-4-5-20251001') {
  if (!anthropic) return null;
  const trimmed = String(text || '').slice(0, 60000); // generous cap

  const sys = `You extract structured fields from Ontario MLS listing PDFs (REALM, TRREB, Itso). Return ONLY valid JSON matching the schema. Use null for any field you can't find. Do not invent. Do not add prose, do not wrap in code fences.`;

  const user = `Schema:
${SCHEMA_DOC}

PDF text:
${trimmed}`;

  try {
    const completion = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      system: sys,
      messages: [{ role: 'user', content: user }],
    });
    const raw = (completion.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    // Strip optional code fences if Claude added them anyway
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();

    return JSON.parse(cleaned);
  } catch (err) {
    console.warn('[realm-listing] AI extraction failed:', err.message);
    return null;
  }
}

// ---------- Multi-listing PDF splitting ----------
//
// REALM "Print to PDF" lets you select multiple listings and export them as a
// single combined PDF. Each listing's section is anchored by an MLS# header
// (TRREB / Itso pattern: letter + 7-8 digits). Detect 2+ MLS#s and slice the
// text at each MLS# boundary so each slice can be parsed as a single listing.
//
// Heuristic: find every MLS# match position, dedupe by MLS value (a listing
// might mention its MLS# twice on the same page), keep only positions where
// the MLS# value is unique within the document, then slice the text between
// successive positions.

const MLS_GLOBAL = /\b([A-Z]\d{7,8})\b/g;

export function detectMultiListing(text) {
  const t = String(text || '');
  if (!t) return { count: 0, positions: [] };
  const seen = new Map(); // mlsId → first position
  let m;
  MLS_GLOBAL.lastIndex = 0;
  while ((m = MLS_GLOBAL.exec(t))) {
    const mlsId = m[1];
    if (!seen.has(mlsId)) {
      seen.set(mlsId, m.index);
    }
  }
  const positions = Array.from(seen.entries())
    .map(([mlsId, index]) => ({ mlsId, index }))
    .sort((a, b) => a.index - b.index);
  return { count: positions.length, positions };
}

export function splitMultiListingText(text) {
  const t = String(text || '');
  const { count, positions } = detectMultiListing(t);
  if (count <= 1) return [t];

  // Slice text at each MLS# position. The MLS# usually appears AFTER a label
  // like "MLS#:" so back up a few chars to keep that label with its listing.
  const slices = [];
  for (let i = 0; i < positions.length; i++) {
    const start = i === 0 ? 0 : Math.max(0, positions[i].index - 30);
    const end = i === positions.length - 1 ? t.length : Math.max(0, positions[i + 1].index - 30);
    const slice = t.slice(start, end).trim();
    if (slice.length > 100) slices.push(slice); // skip tiny slivers
  }
  return slices;
}

// ---------- Public API ----------

export async function parseRealmListing(text, opts = {}) {
  const { anthropic = null, model } = opts;

  const regexResult = parseRegexPass(text);
  const aiResult = anthropic ? await parseAnthropicPass(text, anthropic, model) : null;

  // Merge: prefer AI for everything, fall back to regex for any field AI missed.
  const merged = { ...regexResult };
  if (aiResult && typeof aiResult === 'object') {
    for (const [k, v] of Object.entries(aiResult)) {
      if (v != null && v !== '') merged[k] = v;
    }
    // Hard-field regex precedence — if regex pulled a clear value and AI returned
    // something different, trust regex for these (they're deterministic patterns):
    for (const k of ['mlsId', 'listPrice', 'soldPrice', 'taxes', 'taxYear', 'postalCode', 'yearBuilt', 'daysOnMarket']) {
      if (regexResult[k] != null) merged[k] = regexResult[k];
    }
  }

  return {
    fields: merged,
    sources: {
      regex: regexResult,
      ai: aiResult,
    },
  };
}

/**
 * Parse a REALM PDF that may contain ONE or MANY listings. Returns an array
 * of {fields, sources} — one entry per detected listing. Single-listing PDFs
 * return a one-element array. Used by the comp drop zone, which can accept
 * a multi-listing export and create N comp tiles in one shot.
 */
export async function parseRealmListingsMulti(text, opts = {}) {
  const slices = splitMultiListingText(text);
  const results = [];
  for (const slice of slices) {
    const r = await parseRealmListing(slice, opts);
    // Only keep slices that yielded at least an MLS# OR an address — otherwise
    // it's noise (header page, table of contents, etc.).
    if (r.fields && (r.fields.mlsId || r.fields.address || r.fields.listPrice || r.fields.soldPrice)) {
      results.push(r);
    }
  }
  return results;
}
