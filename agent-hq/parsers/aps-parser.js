// ─────────────────────────────────────────────
// APS (Agreement of Purchase and Sale) PARSER
//
// Extracts structured deal data from Ontario OREA Form 100 PDFs using
// Claude vision (works on fillable, flattened, and scanned docs).
// Per contract-milestones.md: blocks on ambiguity, surfaces to stuck queue.
// ─────────────────────────────────────────────

import fs from 'fs';
import path from 'path';

// Required fields that MUST parse confidently for the deal to auto-advance.
// Anything missing → block + push to Claude-stuck ticker.
const REQUIRED = [
  'property.address',
  'dealType',
  'prices.purchasePrice',
  'dates.acceptedDate',
  'dates.closingDate',
];
const CONDITIONAL_REQUIRED = ['conditions']; // must be non-empty when dealType=conditional

const MIN_CONFIDENCE = 0.8;

const EXTRACTION_PROMPT = `You are extracting structured data from an Ontario real-estate document.

The document is one of: OREA Form 100 (Agreement of Purchase and Sale), Amendment (Form 120), Waiver (Form 123), Notice of Fulfillment (Form 124), Counter Offer / Signback, or Confirmation of Cooperation & Representation (Form 320, often attached as Schedule B). Likely signed via DocuSign — values may appear flattened in the text layer, possibly with stacked counter-offer artifacts. The FINAL accepted values are what matter: use the layout, signature timestamps, and initials to determine which value is final.

An APS package frequently contains multiple forms concatenated: Form 100 + Schedule A (conditions) + Schedule B (Form 320 cooperation/commission). Parse them as one deal — do not split.

Return STRICT JSON (no markdown fence, no commentary) matching this shape:

{
  "documentType": "APS" | "Amendment" | "Waiver" | "Notice of Fulfillment" | "Counter" | "Signback" | "Cooperation Only" | "Unknown",
  "dealType": "firm" | "conditional",
  "side": "listing" | "buyer" | "unknown",
  "property": {
    "address": string,                  // e.g. "11 Joliet Crescent"
    "city": string,
    "province": string,                 // "ON"
    "postalCode": string | null,
    "legalDescription": string | null,
    "frontage": string | null,          // e.g. "91.29 ft"
    "depth": string | null
  },
  "buyer": {
    "names": string[],                  // full legal names
    "lawyer": { "name": string, "firm": string|null, "email": string|null, "phone": string|null } | null
  },
  "seller": {
    "names": string[],
    "lawyer": { "name": string, "firm": string|null, "email": string|null, "phone": string|null } | null
  },
  "prices": {
    "purchasePrice": number,            // CDN dollars, no $ or commas
    "deposit": number,
    "depositHolder": string             // brokerage name
  },
  "dates": {
    "acceptedDate": "YYYY-MM-DD",
    "irrevocableDate": "YYYY-MM-DD" | null,
    "closingDate": "YYYY-MM-DD",
    "titleSearchDate": "YYYY-MM-DD" | null,
    "possessionDate": "YYYY-MM-DD" | null
  },
  "conditions": [
    {
      "type": "financing" | "inspection" | "status_cert" | "septic" | "well" | "insurance" | "spis" | "lawyer_review" | "custom",
      "description": string,             // full text from schedule
      "removalDate": "YYYY-MM-DD",
      "inFavourOf": "buyer" | "seller"
    }
  ],
  "brokerages": {
    "listing": { "name": string, "agent": string|null, "email": string|null, "phone": string|null } | null,
    "cooperating": { "name": string, "agent": string|null, "email": string|null, "phone": string|null } | null
  },
  "commission": {
    "total": number | null,                   // total % or $ to be paid by seller
    "totalUnit": "percent" | "dollars" | null,
    "listingSide": number | null,
    "cooperatingSide": number | null,         // what listing brokerage pays coop
    "cooperatingSideUnit": "percent" | "dollars" | null,
    "cooperatingSideRaw": string | null,      // e.g. "2.5% plus HST" or "as per MLS"
    "hstTreatment": "plus HST" | "inclusive" | "other" | null,
    "notes": string | null
  },
  "cooperation": {                            // from Form 320 / Schedule B if present
    "sellerBrokerageRole": "single" | "multiple" | "none" | null,
    "buyerBrokerageRole": "coop" | "sold_by_buyer_brokerage" | "none" | null,
    "coopBrokeragePaidBy": "seller_brokerage" | "buyer" | null,
    "commissionStructure": string | null      // verbatim commission clause e.g. "Seller Brokerage will pay Co-operating Brokerage 2.5% plus HST"
  },
  "customScheduleItems": string[],      // non-condition schedule items e.g. "septic pumped before title search"
  "confidence": {
    "property.address": number,         // 0.0-1.0
    "dealType": number,
    "prices.purchasePrice": number,
    "dates.acceptedDate": number,
    "dates.closingDate": number,
    "conditions": number                 // overall confidence in condition list
  },
  "ambiguous": [
    { "field": string, "reason": string, "candidates": string[] }
  ],
  "parseNotes": string                  // 1-3 sentences on anything unusual
}

Rules:
- If the document is an Amendment/Waiver/NoF, populate only the fields the document actually changes; others null.
- Dates: always ISO YYYY-MM-DD. If ambiguous between DD/MM/YYYY and MM/DD/YYYY, prefer DD/MM/YYYY (Canadian convention).
- Purchase price: pick the FINAL accepted value. If counter offers leave multiple values, the final one is typically in the latest-initialed layer or the DocuSign signature page.
- Condition types: map "Status Certificate" → status_cert; "home inspection" → inspection; "arranging financing" / "mortgage" → financing; septic/well/insurance as obvious. Use "custom" for anything else and put full text in description.
- inFavourOf: default buyer unless the clause specifies seller.
- Schedule B / Form 320: extract checked boxes to set cooperation.sellerBrokerageRole and buyerBrokerageRole. Capture the cooperating-brokerage commission rate exactly as written into cooperation.commissionStructure AND also parse it into commission.cooperatingSide (numeric) + commission.cooperatingSideUnit + commission.hstTreatment. If the text says "as per MLS" or similar, leave cooperatingSide numeric as null and set cooperatingSideRaw to the exact phrase.
- Confidence: be honest. If a value was clearly printed and matches the signature page, 0.95+. If you had to guess between counter values, 0.5-0.7. If not found at all, omit from confidence dict.
- ambiguous[]: list any field where you couldn't decide between plausible values. ALWAYS include candidates.
- Return ONLY the JSON object. No prose, no markdown.`;

/**
 * Extract structured APS data from a PDF buffer using Claude vision.
 * @param {object} anthropic - instantiated Anthropic SDK client
 * @param {Buffer} pdfBuffer - the PDF file bytes
 * @param {string} filename - original filename (for logging/metadata)
 * @returns {Promise<{success:boolean, data?:object, blocked?:boolean, blockReasons?:string[], error?:string, raw?:string}>}
 */
export async function parseApsPdf(anthropic, pdfBuffer, filename = 'unknown.pdf') {
  if (!anthropic) return { success: false, error: 'Anthropic SDK not initialized (missing ANTHROPIC_API_KEY)' };
  if (!pdfBuffer || pdfBuffer.length === 0) return { success: false, error: 'Empty PDF buffer' };

  const base64 = pdfBuffer.toString('base64');
  let raw = '';

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      }],
    });
    raw = response.content.map(c => c.type === 'text' ? c.text : '').join('').trim();
  } catch (err) {
    return { success: false, error: `Claude API error: ${err.message}`, raw };
  }

  // Strip any accidental markdown fence and parse
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (err) {
    return { success: false, error: `Claude returned non-JSON: ${err.message}`, raw };
  }

  // ─── Validate & compute block reasons ───
  const blockReasons = [];

  for (const field of REQUIRED) {
    const val = getPath(data, field);
    if (val == null || val === '') blockReasons.push(`Missing ${field}`);
    const conf = data?.confidence?.[field];
    if (typeof conf === 'number' && conf < MIN_CONFIDENCE) {
      blockReasons.push(`Low confidence on ${field} (${conf.toFixed(2)})`);
    }
  }

  if (data.dealType === 'conditional' && (!Array.isArray(data.conditions) || data.conditions.length === 0)) {
    blockReasons.push('dealType=conditional but no conditions extracted');
  }

  if (Array.isArray(data.conditions)) {
    data.conditions.forEach((c, i) => {
      if (!c.removalDate) blockReasons.push(`condition[${i}] (${c.type || 'unknown'}) missing removalDate`);
    });
  }

  if (Array.isArray(data.ambiguous) && data.ambiguous.length > 0) {
    data.ambiguous.forEach(a => blockReasons.push(`Ambiguous ${a.field}: ${a.reason}`));
  }

  return {
    success: true,
    blocked: blockReasons.length > 0,
    blockReasons,
    data: { ...data, _filename: filename, _parsedAt: new Date().toISOString() },
    raw,
  };
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// ─────────────────────────────────────────────
// MILESTONE TASK EXPANSION
// Given a parsed APS, generate the list of FUB tasks to create per
// framework/skills/contract-milestones.md cadence (T-7/T-3/T-1, T-72/48/24, etc.)
// ─────────────────────────────────────────────

/**
 * @param {object} deal - parsed APS data (output of parseApsPdf().data)
 * @returns {Array<{title:string, dueDate:string, type:string, notes?:string}>}
 */
export function buildMilestoneTasks(deal) {
  const tasks = [];
  const addr = deal?.property?.address || 'Unknown address';
  const closing = deal?.dates?.closingDate;
  const title = deal?.dates?.titleSearchDate;

  // Per condition: T-7, T-3, T-1 reminders + T-72/48/24 chase alerts
  (deal.conditions || []).forEach((c) => {
    const removal = c.removalDate;
    if (!removal) return;
    const label = `${c.type}${c.description ? ` — ${truncate(c.description, 50)}` : ''}`;

    tasks.push(
      { title: `[${addr}] ${label} removal T-7`, dueDate: offsetDays(removal, -7), type: 'milestone', notes: c.description },
      { title: `[${addr}] ${label} removal T-3`, dueDate: offsetDays(removal, -3), type: 'milestone', notes: c.description },
      { title: `[${addr}] ${label} removal T-1`, dueDate: offsetDays(removal, -1), type: 'milestone', notes: c.description },
      { title: `[${addr}] ${label} DUE TODAY`,   dueDate: removal,                 type: 'milestone', notes: c.description },
    );
  });

  // Title search: T-3 lawyer check-in
  if (title) {
    tasks.push({
      title: `[${addr}] Email lawyer re: title search check-in`,
      dueDate: offsetDays(title, -3),
      type: 'milestone',
      notes: `Title search date: ${title}`,
    });
    tasks.push({ title: `[${addr}] Title search date`, dueDate: title, type: 'milestone' });
  }

  // Closing: T-7 client checklist, T-1 final confirm, day-of + day+1 + day+14
  if (closing) {
    tasks.push(
      { title: `[${addr}] Client closing checklist T-7`, dueDate: offsetDays(closing, -7),  type: 'milestone', notes: 'Lawyer, walkthrough, utilities, key plan, address list, insurance' },
      { title: `[${addr}] Closing T-1 final confirm`,    dueDate: offsetDays(closing, -1),  type: 'milestone' },
      { title: `[${addr}] CLOSING DAY — congrats msg`,    dueDate: closing,                 type: 'milestone' },
      { title: `[${addr}] Post-close anniversary card (365d)`, dueDate: offsetDays(closing, +365), type: 'milestone' },
      { title: `[${addr}] Review-request follow-up`,     dueDate: offsetDays(closing, +14), type: 'milestone' },
    );
  }

  return tasks;
}

function offsetDays(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ─────────────────────────────────────────────
// DEAL STORE — flat-file persistence following agent-hq convention
// (same pattern as .ea-stuck-queue.json, .task-state.json, etc.)
// ─────────────────────────────────────────────

export function createDealStore(dataDir) {
  const dealsPath = path.join(dataDir, '.aps-deals.json');
  const pdfDir = path.join(dataDir, '.aps-pdfs');
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });

  let deals = [];
  try {
    if (fs.existsSync(dealsPath)) deals = JSON.parse(fs.readFileSync(dealsPath, 'utf8'));
  } catch (e) { console.error('[APS] Failed to load deal store:', e.message); }

  function save() {
    try { fs.writeFileSync(dealsPath, JSON.stringify(deals, null, 2)); }
    catch (e) { console.error('[APS] Failed to save deal store:', e.message); }
  }

  return {
    all() { return deals; },
    get(id) { return deals.find(d => d.id === id); },
    add(deal) { deals.unshift(deal); save(); return deal; },
    update(id, patch) {
      const d = deals.find(x => x.id === id);
      if (!d) return null;
      Object.assign(d, patch);
      save();
      return d;
    },
    remove(id) { deals = deals.filter(d => d.id !== id); save(); },
    pdfPath(id, originalName) {
      const safe = (originalName || 'aps.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      return path.join(pdfDir, `${id}_${safe}`);
    },
  };
}

// ─────────────────────────────────────────────
// FUB TASK CREATION
// ─────────────────────────────────────────────

/**
 * Create a task in Follow Up Boss.
 * @param {string} fubApiKey
 * @param {object} task - { title, dueDate (YYYY-MM-DD), personId?, notes? }
 * @returns {Promise<{success:boolean, fubTaskId?:string, error?:string}>}
 */
export async function createFubTask(fubApiKey, task) {
  if (!fubApiKey) return { success: false, error: 'FUB_API_KEY not configured' };

  const body = {
    name: task.title,
    dueDate: task.dueDate, // FUB accepts YYYY-MM-DD
    type: 'To-do',
    isCompleted: false,
  };
  if (task.personId) body.personId = task.personId;
  if (task.notes) body.description = task.notes;

  try {
    const res = await fetch('https://api.followupboss.com/v1/tasks', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(fubApiKey + ':').toString('base64'),
        'Content-Type': 'application/json',
        'X-System': 'AgentHQ',
        'X-System-Key': 'agenthq-v1',
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: `FUB ${res.status}: ${json.errorMessage || res.statusText}` };
    return { success: true, fubTaskId: String(json.id) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
