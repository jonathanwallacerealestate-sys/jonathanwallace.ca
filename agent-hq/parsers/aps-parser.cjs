// APS Parser — integrated into Agent HQ
// Parses Ontario OREA Form 100 Agreements of Purchase and Sale.
// Uses Claude (Anthropic) as primary extractor, regex as fallback.

const pdfParse = require('pdf-parse');
const { parseApsDate, addBusinessDays, addDays } = require('./dateParse.cjs');

// ─────────────────────────────────────────────
// Text Extraction
// ─────────────────────────────────────────────

const OCR_THRESHOLD_CHARS = 500;

async function extractText(pdfBuffer) {
  const { text, numpages } = await pdfParse(pdfBuffer);
  if (text && text.length >= OCR_THRESHOLD_CHARS) {
    return { text, pages: numpages, source: 'pdf-text-layer' };
  }
  return { text: text || '', pages: numpages, source: 'pdf-text-layer-thin' };
}

// ─────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────

function normalizeText(raw) {
  if (!raw) return '';
  let text = raw;
  text = text.replace(/^.*?([A-Za-z])\1{2,}.*?Docusign.*$/gim, '');
  text = text.replace(/^.*\b(?:DoDc|DoDDc|DDoo|ccuuii).*$/gim, '');
  text = text.replace(/Do*c*u*s*i*g*n?\s*En*v*e*l*o*p*e?\s*ID[:.]?[^\n]*/gi, '');
  text = text.replace(/©\s*\d{4},?\s*Ontario Real Estate Association[^\n]*/gi, '');
  text = text.replace(/The trademarks REALTOR[^\n]*(?:\n[^\n]*){0,5}?used under license[^\n]*/gi, '');
  text = text.replace(/Form\s+\d{2,3}\s+Revised\s+\d{4}\s+Page\s+\d+\s+of\s+\d+/gi, '');
  text = text.replace(/INITIALS OF BUYER\(S\)\s*:?\s*(?:\w{1,4}\s*)?INITIALS OF SELLER\(S\)\s*:?[^\n]*/gi, '');
  text = text.replace(/\.{5,}/g, ' ');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function splitSections(normalized) {
  const sections = { main: normalized, schedules: [] };
  const schedRe = /(Schedule\s+[A-Z])\s*\n(?:Agreement of Purchase and Sale)?/gi;
  const matches = [...normalized.matchAll(schedRe)];
  if (matches.length === 0) return sections;
  sections.main = normalized.slice(0, matches[0].index);
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
    sections.schedules.push({ name: matches[i][1], text: normalized.slice(start, end) });
  }
  return sections;
}

// ─────────────────────────────────────────────
// Regex Field Extraction (fallback)
// ─────────────────────────────────────────────

const MONTH_RE = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';

function extractFields(main, fullText) {
  const apsStart = locateApsStart(fullText);
  const apsText = fullText.slice(apsStart);
  const page1 = apsText.split(/\n(?=\d+\.\s|3\. NOTICES:)/)[0] || apsText.slice(0, 8000);

  return {
    form: detectForm(fullText),
    agreementDate: extractAgreementDate(page1),
    buyers: extractBuyers(page1),
    sellers: extractSellers(page1),
    property: extractProperty(page1),
    purchasePrice: extractPurchasePrice(page1),
    deposit: extractDeposit(page1),
    depositHolder: extractDepositHolder(page1),
    irrevocable: extractIrrevocable(page1, fullText),
    completionDate: extractCompletionDate(page1, fullText),
    titleSearchDate: extractTitleSearchDate(fullText),
    chattelsIncluded: captureAfterLabel(fullText, /CHATTELS INCLUDED:/i),
    fixturesExcluded: captureAfterLabel(fullText, /FIXTURES EXCLUDED:/i),
    rentalItems: captureAfterLabel(fullText, /RENTAL ITEMS[^:]*:/i),
    emails: extractEmails(fullText),
    lawyers: extractLawyers(fullText),
    acceptance: extractAcceptance(fullText),
  };
}

function detectForm(text) {
  if (/Form\s+120\b/i.test(text) && /Amendment to Agreement/i.test(text)) return 'OREA-120-amendment';
  if (/Form\s+124\b/i.test(text) && /Notice of Fulfillment/i.test(text)) return 'OREA-124-fulfillment';
  if (/Form\s+128\b/i.test(text)) return 'OREA-128-signback';
  if (/Form\s+100\b/i.test(text)) return 'OREA-100';
  if (/Form\s+101\b/i.test(text)) return 'OREA-101';
  if (/Form\s+320\b/i.test(text)) return 'OREA-320';
  return 'unknown';
}

function locateApsStart(text) {
  const m = text.match(/Agreement of Purchase and Sale\s*\n?Form 100/i);
  if (m) return m.index;
  const realProp = text.indexOf('REAL PROPERTY:');
  return realProp > 0 ? Math.max(0, realProp - 600) : 0;
}

function findDateMatches(text) {
  const re = new RegExp(`(\\d{1,2})\\s*${MONTH_RE}\\s*(\\d{2,4})`, 'gi');
  return [...text.matchAll(re)].map(m => ({
    iso: parseApsDate(m[0].replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2')),
    raw: m[0],
    index: m.index,
  }));
}

function findNameMatches(text) {
  const re = /([A-Z][A-Z .'\-]{2,}(?:\s*&\s*[A-Z][A-Z .'\-]{2,})*(?:\s+(?:AND|and)\s+[A-Z][A-Z .'\-]{2,})*)/g;
  const BLOCK = /\b(BUYER|SELLER|AGREEMENT|SCHEDULE|FORM|PROPERTY|ADDRESS|REAL|COMPLETION|DEPOSIT|PURCHASE|PRICE|TITLE|IRREVOC|DELIVERY|DOLLARS|NOTICE|LISTING|BROKERAGE|OREA|REALTOR|WITNESS|SIGNED|SEALED|DEFINITIONS|INTERPRETATIONS|REPRESENTATION|REPRESENTATIVE|INSURANCE|DISCHARGE|CHATTEL|FIXTURES|PLANNING|RESIDENCY|ELECTRONIC|REGISTRATION|DOCUMENT|RECEIPT|EDT|EST|PST|PDT|UTC|AM|PM|DUE|DILIGENCE|NULL|VOID|FULL|HEREIN|OFFER|ACCEPTED|CONDITIONAL)\b/i;
  const results = [];
  for (const m of text.matchAll(re)) {
    const s = m[0].trim();
    const tokens = s.split(/\s+/);
    if (tokens.length < 2) continue;
    if (tokens.some(t => t.replace(/[.&'\-]/g, '').length < 2)) continue;
    if (BLOCK.test(s)) continue;
    if (s.length > 100) continue;
    if (/^\d/.test(s)) continue;
    results.push({ name: s, index: m.index });
  }
  return results;
}

function extractAgreementDate(text) { return findDateMatches(text)[0]?.iso || null; }
function extractBuyers(text) { const n = findNameMatches(text); return n.length > 0 ? splitNames(n[0].name) : []; }
function extractSellers(text) { const n = findNameMatches(text); return n.length >= 2 ? splitNames(n[1].name) : []; }
function splitNames(s) { return s.split(/\s*(?:&|\band\b|,)\s*/i).map(x => x.trim()).filter(x => x && x.length < 60); }

function extractProperty(text) {
  const addrRe = /([0-9]+[A-Za-z0-9 .'\-]{2,80}?)(ON|Ontario)([A-Z]\d[A-Z]\s*\d[A-Z]\d)/i;
  const m = text.match(addrRe);
  let address = null;
  if (m) {
    const street = m[1].replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
    const postal = m[3].replace(/\s+/g, '').replace(/(.{3})(.{3})/, '$1 $2');
    address = `${street}, ${m[2]} ${postal}`.replace(/,\s+ON/, ', ON');
  }
  const frontageMatches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(Feet|Ft\.?|Metres?|Meters?)/gi)];
  const frontage = frontageMatches[0]?.[0] || null;
  const depth = frontageMatches[1]?.[0] || null;
  const legalM = text.match(/\b(LT\s+\d+\s+PL\s+\d+[^\n]{0,100}|PCL\s+\d+[^\n]{0,100}|PLAN\s+\d+[^\n]{0,100}|PT\s+(LT|LOT)\s+\d+[^\n]{0,100}|CON\s+\d+[^\n]{0,100})/i);
  return { address, frontage, depth, legalDescription: legalM ? legalM[0].trim() : null };
}

function extractPurchasePrice(text) {
  const depositIdx = text.search(/DEPOSIT:|by negotiable cheque/i);
  const window = depositIdx > 0 ? text.slice(0, depositIdx) : text;
  const pattern = /\$?\s*([\d]{3,}(?:,\d{3})+(?:\.\d{2})?|\d{5,}(?:\.\d{2})?)/g;
  const matches = [...window.matchAll(pattern)]
    .map(m => ({ raw: m[0], amount: Number(m[1].replace(/,/g, '')) }))
    .filter(x => x.amount >= 50000 && x.amount <= 50000000);
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  return { amountCad: last.amount, raw: last.raw.trim() };
}

function extractDeposit(text) {
  const start = text.search(/DEPOSIT:/i);
  if (start === -1) return null;
  const end = text.indexOf('Deposit Holder', start);
  const window = text.slice(start, end > 0 ? end : start + 2000);
  const pattern = /([\d]{1,3}(?:,\d{3})+(?:\.\d{2})?|\d{4,}(?:\.\d{2})?)/g;
  const matches = [...window.matchAll(pattern)]
    .map(m => Number(m[1].replace(/,/g, '')))
    .filter(n => n >= 500 && n <= 500000);
  if (matches.length === 0) return null;
  return { amountCad: matches[matches.length - 1], timing: /upon acceptance/i.test(window) ? 'upon_acceptance' : 'as_described' };
}

function extractDepositHolder(text) {
  const KNOWN = [/RE\/?MAX[^\n,]*/i, /ROYAL LEPAGE[^\n,]*/i, /SOTHEBY[^\n,]*/i, /CENTURY 21[^\n,]*/i, /SUTTON[^\n,]*/i, /COLDWELL BANKER[^\n,]*/i, /REVEL REALTY[^\n,]*/i, /FARIS TEAM[^\n,]*/i, /KELLER WILLIAMS[^\n,]*/i];
  for (const re of KNOWN) { const m = text.match(re); if (m) return m[0].trim().replace(/\s+/g, ' ').replace(/[,.]+$/, ''); }
  const m = text.match(/([A-Z][A-Z ,./\-&]+?)\s*[""]?Deposit Holder/i);
  return m ? m[1].trim() : null;
}

function extractIrrevocable(page1) {
  const dates = findDateMatches(page1);
  return { irrevocableBy: null, time: null, amPm: null, date: dates[1]?.iso || null };
}

function extractCompletionDate(page1) {
  const dates = findDateMatches(page1);
  const valid = dates.filter(d => d.iso).map(d => d.iso);
  if (valid.length === 0) return null;
  return valid[valid.length - 1];
}

function extractTitleSearchDate(text) {
  const anchor = text.search(/TITLE SEARCH:/i);
  if (anchor === -1) return null;
  const window = text.slice(anchor, anchor + 800);
  return findDateMatches(window)[0]?.iso || null;
}

function extractEmails(text) {
  const emails = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(m => m[0].toLowerCase());
  return [...new Set(emails)];
}

function extractLawyers(text) {
  const result = { seller: null, buyer: null };
  const sellerM = text.match(/Seller.?s Lawyer[\s:]+([^\n]+?)(?:Address|Email|Tel|$)/i);
  const buyerM = text.match(/Buyer.?s Lawyer[\s:]+([^\n]+?)(?:Address|Email|Tel|$)/i);
  if (sellerM) result.seller = sellerM[1].trim().replace(/\s+/g, ' ').slice(0, 200);
  if (buyerM) result.buyer = buyerM[1].trim().replace(/\s+/g, ' ').slice(0, 200);
  return result;
}

function extractAcceptance(text) {
  const re = /(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*\|\s*(\d{1,2}:\d{2})\s*(AM|PM)?/gi;
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return { signedAt: null, all: [] };
  const all = matches.map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  return { signedAt: all[all.length - 1], all: [...new Set(all)] };
}

function captureAfterLabel(text, labelRe) {
  const m = text.match(labelRe);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 500);
  const lines = after.split('\n').map(l => l.trim()).filter(l => l && l !== 'None' && l.length > 1);
  const picked = lines.slice(0, 4).join(' ').trim();
  if (!picked || /^(none|n\/a)$/i.test(picked)) return null;
  return picked.length > 400 ? picked.slice(0, 400) + '…' : picked;
}

// ─────────────────────────────────────────────
// Conditions Extraction
// ─────────────────────────────────────────────

const CONDITION_KEYWORDS = [
  { key: 'financing', aliases: [/financ/i, /mortgage/i] },
  { key: 'inspection', aliases: [/home inspection/i, /property inspection/i] },
  { key: 'insurance', aliases: [/insurance/i] },
  { key: 'status_certificate', aliases: [/status cert/i, /estoppel/i] },
  { key: 'spis', aliases: [/spis/i, /seller property information/i] },
  { key: 'lawyer_review', aliases: [/lawyer.?s review/i, /solicitor.?s review/i] },
  { key: 'sale_of_property', aliases: [/sale of buyer/i, /sale of purchaser/i] },
  { key: 'water_test', aliases: [/water test/i, /potability/i, /bacteriological/i] },
  { key: 'septic', aliases: [/septic/i, /sewage system/i] },
  { key: 'well', aliases: [/\bwell\b/i] },
  { key: 'survey', aliases: [/survey/i] },
];

function extractConditions(schedules, acceptanceIso) {
  const results = [];
  for (const sched of schedules) {
    const blocks = splitHeadings(sched.text);
    for (const block of blocks) {
      const classification = classifyBlock(block);
      if (!classification) continue;
      results.push({
        schedule: sched.name,
        ...classification,
        waiverByIso: classification.businessDays && acceptanceIso
          ? addBusinessDays(acceptanceIso, classification.businessDays) : null,
      });
    }
  }
  return results;
}

function splitHeadings(text) {
  const lines = text.split('\n');
  const blocks = [];
  let current = { heading: null, body: [] };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const isHeading = /^[A-Z0-9][A-Z0-9 &/,()'.\-]{4,80}$/.test(line) &&
      !/^FORM\b|^SCHEDULE\b|^BUYER:|^SELLER:|^ADDRESS/.test(line) &&
      line.split(' ').length <= 10;
    if (isHeading) {
      if (current.heading || current.body.length) blocks.push(current);
      current = { heading: line, body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.heading || current.body.length) blocks.push(current);
  return blocks.filter(b => b.heading);
}

function classifyBlock(block) {
  const body = block.body.join(' ');
  const isCondition = /conditional on|subject to the buyer|null and void and the deposit/i.test(body);
  if (!isCondition) return null;
  const bdMatch = body.match(/(\d{1,2})\s*\(?\s*(?:\w+)?\s*\)?\s*business days/i) || body.match(/(\d{1,2})\s*business days/i);
  const calMatch = body.match(/(\d{1,2})\s*\(?\s*\w+\s*\)?\s*(?:calendar )?days/i);
  let category = 'other';
  for (const c of CONDITION_KEYWORDS) {
    if (c.aliases.some(re => re.test(block.heading) || re.test(body))) { category = c.key; break; }
  }
  return {
    label: block.heading,
    category,
    businessDays: bdMatch ? Number(bdMatch[1]) : null,
    calendarDays: !bdMatch && calMatch ? Number(calMatch[1]) : null,
    raw: body.slice(0, 600),
  };
}

// ─────────────────────────────────────────────
// Milestones Builder
// ─────────────────────────────────────────────

function buildMilestones(fields, conditions) {
  const ms = [];
  const addr = fields.property?.address || 'property';
  const acceptance = fields.acceptance?.signedAt || fields.agreementDate || null;

  if (fields.completionDate) {
    ms.push({ kind: 'closing', priority: 'critical', title: `Closing — ${addr}`, date: fields.completionDate, reminders: [7, 3, 1] });
    ms.push({ kind: 'home_anniversary', priority: 'low', title: `Home Anniversary — ${addr}`, date: bumpYear(fields.completionDate, 1), recurrence: 'yearly', reminders: [14] });
  }
  if (fields.titleSearchDate) {
    ms.push({ kind: 'title_search', priority: 'high', title: `Title search deadline — ${addr}`, date: fields.titleSearchDate, reminders: [5, 2, 1] });
  }
  if (fields.deposit && fields.deposit.timing === 'upon_acceptance' && acceptance) {
    ms.push({ kind: 'deposit_due', priority: 'critical', title: `Deposit due (24h) — ${addr}`, date: addDays(acceptance, 1), reminders: [0] });
  }
  for (const c of conditions) {
    if (!c.waiverByIso) continue;
    ms.push({ kind: 'condition', priority: 'high', title: `${prettyCondition(c)} — waive by — ${addr}`, date: c.waiverByIso, category: c.category, reminders: [3, 1] });
  }
  return ms.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function prettyCondition(c) {
  const map = { financing: 'Financing', inspection: 'Inspection', insurance: 'Insurance', status_certificate: 'Status certificate', spis: 'SPIS review', lawyer_review: "Lawyer's review", sale_of_property: "Sale of buyer's property", water_test: 'Water test', septic: 'Septic inspection', well: 'Well inspection', survey: 'Survey' };
  return map[c.category] || c.label || 'Condition';
}

function bumpYear(iso, years) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────
// LLM Extraction (uses Anthropic Claude — already in Agent HQ)
// ─────────────────────────────────────────────

const LLM_SCHEMA = `Return ONLY a JSON object with this exact shape. Use null for any field you cannot find with high confidence:
{
  "agreementDate": "YYYY-MM-DD" | null,
  "buyers": ["Full Name", ...],
  "sellers": ["Full Name", ...],
  "property": { "address": "street, city ON postal", "frontage": "X Feet" | null, "depth": "X Feet" | null, "legalDescription": string | null },
  "purchasePrice": { "amountCad": number, "raw": string },
  "deposit": { "amountCad": number, "timing": "upon_acceptance" | "herewith" | "as_described" },
  "depositHolder": string | null,
  "irrevocable": { "irrevocableBy": "Buyer" | "Seller" | null, "time": "HH:MM" | null, "amPm": "a.m." | "p.m." | null, "date": "YYYY-MM-DD" | null },
  "completionDate": "YYYY-MM-DD" | null,
  "titleSearchDate": "YYYY-MM-DD" | null,
  "chattelsIncluded": string | null,
  "fixturesExcluded": string | null,
  "rentalItems": string | null,
  "emails": ["..."],
  "lawyers": { "seller": string | null, "buyer": string | null },
  "conditions": [{ "label": string, "category": "financing"|"inspection"|"insurance"|"status_certificate"|"spis"|"lawyer_review"|"sale_of_property"|"water_test"|"septic"|"well"|"survey"|"other", "businessDays": number|null, "calendarDays": number|null, "raw": "first 300 chars" }]
}

Rules:
- INVARIANT: every PDF is an ACCEPTED offer. Both parties have signed.
- Counter-offer values may be stacked. Always return the LAST value in each stack.
- Dates are Ontario/Toronto local. "19 February 26" means 19 Feb 2026.
- Purchase price and deposit must be numbers (no $ or commas).
- Conditions live in Schedule A. Set "conditions": [] for firm/unconditional deals.
- If Form 320 appears before Form 100, IGNORE 320 — extract from Form 100 only.`;

async function llmExtract(anthropicClient, text) {
  if (!anthropicClient) return null;
  try {
    const msg = await anthropicClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are parsing an Ontario OREA Form 100 Agreement of Purchase and Sale.\n\n${LLM_SCHEMA}\n\nHere is the PDF text:\n\n${text.slice(0, 60000)}`,
      }],
    });
    const content = msg.content?.[0]?.text || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.log('[APS] LLM extraction failed:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// Main Orchestrator
// ─────────────────────────────────────────────

async function parseApsPdf(pdfBuffer, { filename, anthropicClient } = {}) {
  const { text: rawText, pages, source } = await extractText(pdfBuffer);
  const text = normalizeText(rawText);
  const { main, schedules } = splitSections(text);

  let fields;
  let conditions;
  let extractor = 'regex';

  // Try LLM first
  const llmResult = await llmExtract(anthropicClient, text);
  if (llmResult) {
    extractor = 'llm';
    fields = llmResult;
    conditions = llmResult.conditions || [];
    // Merge in regex-extracted acceptance timestamps
    const regexFields = extractFields(main, text);
    fields.acceptance = regexFields.acceptance;
    fields.form = regexFields.form;
    const acceptanceIso = fields.acceptance?.signedAt || fields.agreementDate;
    conditions = conditions.map(c => ({
      ...c,
      waiverByIso: c.businessDays && acceptanceIso ? addBusinessDays(acceptanceIso, c.businessDays) : null,
    }));
  } else {
    fields = extractFields(main, text);
    const acceptanceIso = fields.acceptance?.signedAt || fields.agreementDate;
    conditions = extractConditions(schedules, acceptanceIso);
  }

  const milestones = buildMilestones(fields, conditions);
  const dealIsFirm = conditions.length === 0 || /no conditions|unconditional|firm offer/i.test(main);

  return {
    source: 'aps-parser',
    parsedAt: new Date().toISOString(),
    filename: filename || null,
    textSource: source,
    pages,
    fields,
    conditions,
    milestones,
    extractor,
    status: dealIsFirm ? 'firm' : 'conditional',
    confidence: computeConfidence(fields, conditions, pages),
  };
}

function computeConfidence(fields, conditions, pages) {
  let score = 0, max = 0;
  const addCheck = (weight, present) => { max += weight; if (present) score += weight; };
  addCheck(3, fields.completionDate);
  addCheck(2, fields.titleSearchDate);
  addCheck(2, fields.purchasePrice?.amountCad);
  addCheck(2, fields.property?.address);
  addCheck(1, fields.buyers?.length);
  addCheck(1, fields.sellers?.length);
  addCheck(1, fields.deposit?.amountCad);
  addCheck(1, pages > 3);
  return Number((score / Math.max(1, max)).toFixed(2));
}

module.exports = { parseApsPdf };
