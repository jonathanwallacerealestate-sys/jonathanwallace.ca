// lib/routes/listing-inquiry-forward.js
//
// Listing Inquiry → Buyer's Agent forwarder (Jacqui-callable + scheduled rule).
//
// Pattern:
//   • Inbound emails about a listing (FUB lead notifications, engagement@
//     forwards, brokerbay showing requests, etc.) land in jonathan@faristeam.ca
//   • For matching listings, the contact info (name / email / phone) is
//     extracted from the email body via Haiku
//   • A real-time forward goes to the buyer's agent (e.g. Ryan Allary)
//   • A short "Received." acknowledgement is sent to the engagement address
//   • The original email is permanently deleted from Outlook
//   • Each lead is deduped by email AND phone so re-arrivals don't re-send
//
// Endpoints:
//   POST  /api/jacqui/rules/listing-inquiry-forward/scan
//         — manual or scheduled trigger. Runs the full sweep.
//   GET   /api/jacqui/rules/listing-inquiry-forward/state
//         — inspect rule config + processed-lead history.
//   PUT   /api/jacqui/rules/listing-inquiry-forward/config
//         — update rule config (forward_to, listing_match, etc.).
//   POST  /api/jacqui/rules/listing-inquiry-forward/reset
//         — clear processed history (force re-process). Dev only.
//
// State persisted at ${JACQUI_DIR}/rules/listing-inquiry-forward.json.
//
// Created 2026-05-25.

import fs from 'fs';
import path from 'path';

const OUTLOOK_GATEWAY_URL =
  process.env.OUTLOOK_GATEWAY_URL ||
  'https://hook.us2.make.com/2ikw0v0f6k2os8xetecaa71if1gac9mu';

const DEFAULT_CONFIG = {
  rule_id: '2-405-bay-street-to-ryan',
  enabled: true,
  // Subject/body match for inbound emails. Case-insensitive substring.
  listing_match: '2-405 Bay Street',
  // Also match the BAY STREET / Bay St variants engagement@ uses.
  listing_match_aliases: [
    '2-405 Bay Street',
    '2 - 405 BAY STREET',
    '2-405 Bay St',
    '405 Bay Street N/A #2',
  ],
  // Where to forward extracted contact info.
  forward_to: 'rallary@exitrealtytruenorth.com',
  forward_subject_template: '{address} — New Lead: {name}',
  // Where to send the "Received." acknowledgement. null/empty = skip ack.
  ack_to: 'engagement@faristeam.ca',
  ack_body: 'Received. Forwarded to buyer\'s agent.\n\nCheers, Jonathan',
  // What to do with the original email after successful forward.
  // 'delete' | 'mark_read' | 'archive'
  post_action: 'delete',
  // Senders we should NEVER auto-act on (our own outbound, etc.)
  sender_blocklist: [
    'jonathan@faristeam.ca',
    'rallary@exitrealtytruenorth.com',
    'engagement@faristeam.ca',  // we don't loop on our own ack receipts
  ],
  // Cap scans to N messages per cycle to bound cost.
  scan_limit: 25,
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadState(statePath) {
  if (!fs.existsSync(statePath)) {
    return {
      config: { ...DEFAULT_CONFIG },
      processed_message_ids: [],
      processed_lead_emails: [],
      processed_lead_phones: [],
      runs: [],
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      config: { ...DEFAULT_CONFIG, ...(raw.config || {}) },
      processed_message_ids: raw.processed_message_ids || [],
      processed_lead_emails: raw.processed_lead_emails || [],
      processed_lead_phones: raw.processed_lead_phones || [],
      runs: raw.runs || [],
    };
  } catch (e) {
    console.warn('[ListingInquiryForward] state parse failed, starting fresh:', e.message);
    return {
      config: { ...DEFAULT_CONFIG },
      processed_message_ids: [],
      processed_lead_emails: [],
      processed_lead_phones: [],
      runs: [],
    };
  }
}

function saveState(statePath, state) {
  // Keep history bounded.
  if (state.processed_message_ids.length > 2000) {
    state.processed_message_ids = state.processed_message_ids.slice(-1500);
  }
  if (state.processed_lead_emails.length > 2000) {
    state.processed_lead_emails = state.processed_lead_emails.slice(-1500);
  }
  if (state.processed_lead_phones.length > 2000) {
    state.processed_lead_phones = state.processed_lead_phones.slice(-1500);
  }
  if (state.runs.length > 100) {
    state.runs = state.runs.slice(-50);
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

async function callGateway(action, action_params) {
  try {
    const resp = await fetch(OUTLOOK_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, action_params }),
    });
    const text = await resp.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    if (!resp.ok) return { ok: false, status: resp.status, error: parsed?.error || text };
    return { ok: true, status: resp.status, ...parsed };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Heuristic body extractor — works on FUB lead emails which have this shape:
//   "You've received a new lead named X from Team:..." +
//   "(705) 433-4061" + "lead@example.com" + "2-405 Bay St, Midland..."
// We pull name, phone, email directly with regex; phones are NA format.
function regexExtract(text) {
  const t = String(text || '').replace(/[ ​\r]/g, ' ');
  // Name: "Lead assigned - <Name>" or "named <Name> from Team:" or "Contact details:\nName: <Name>"
  let name = null;
  const nameNamedFrom = t.match(/named\s+([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){0,3})\s+from\s+Team/i);
  const nameAssigned = t.match(/Lead assigned\s*[-—]\s*([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){0,3})/i);
  const nameContact = t.match(/(?:^|\n)\s*Name:\s*([^\n]+)/i);
  const nameSubject = t.match(/about\s+([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){0,3})/);
  name = (nameContact?.[1] || nameNamedFrom?.[1] || nameAssigned?.[1] || nameSubject?.[1] || '').trim() || null;

  // Email: first non-faristeam, non-followupboss email
  const emails = (t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).filter(e =>
    !/faristeam\.ca$|followupboss\.com$|brokerbay\.com$|docusign\.net$|exitrealtytruenorth\.com$/i.test(e)
  );
  const email = emails[0] || null;

  // Phone: NA-style 10/11 digit. Prefer formatted variant.
  let phone = null;
  const phoneFormatted = t.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  if (phoneFormatted) phone = phoneFormatted[0].trim();

  return { name, email, phone };
}

async function extractContactWithHaiku({ anthropic, subject, body }) {
  // Regex first — covers the FUB lead pattern cleanly.
  const re = regexExtract(`${subject || ''}\n${body || ''}`);
  if (re.name && re.email && re.phone) return { ...re, method: 'regex' };

  if (!anthropic) {
    return { ...re, method: 're+no-anthropic' };
  }
  try {
    const completion = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Extract the inquirer's contact info from this real-estate inquiry email. Return ONLY JSON: {"name": "...", "email": "...", "phone": "..."}. If any field is missing, return empty string for it.

Subject: ${subject || ''}

Body:
${(body || '').slice(0, 3000)}`,
      }],
    });
    const raw = completion.content?.[0]?.text || '';
    let parsed = {};
    try {
      let t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      const f = t.indexOf('{'), l = t.lastIndexOf('}');
      if (f >= 0 && l > f) t = t.slice(f, l + 1);
      parsed = JSON.parse(t);
    } catch {}
    return {
      name: parsed.name || re.name || null,
      email: parsed.email || re.email || null,
      phone: parsed.phone || re.phone || null,
      method: 're+haiku',
    };
  } catch (e) {
    console.warn('[ListingInquiryForward] Haiku extract failed:', e.message);
    return { ...re, method: 're+haiku-error' };
  }
}

function matchesListing(msg, config) {
  const subj = String(msg.subject || '').toLowerCase();
  const prev = String(msg.bodyPreview || '').toLowerCase();
  const aliases = (config.listing_match_aliases || [config.listing_match]).map(a => a.toLowerCase());
  return aliases.some(a => subj.includes(a) || prev.includes(a));
}

function senderAddress(msg) {
  const f = msg.from || msg.sender || {};
  if (typeof f === 'string') return f.toLowerCase();
  const ea = f.emailAddress || f;
  return String(ea?.address || ea?.email || '').toLowerCase();
}

function getSubject(msg) { return String(msg.subject || ''); }
function getId(msg) { return msg.id || msg.messageId || msg.internetMessageId || null; }
function getBody(msg) {
  const b = msg.body;
  if (b && typeof b === 'object') return b.content || b.text || '';
  return msg.bodyPreview || '';
}

// Best-effort delete; Make.com gateway may not have a delete_message action
// (current scenario 5106541 has 7 routes per the 2026-05-20 handoff). If
// delete_message isn't wired, we fall back to mark_read so the inbox is at
// least cleared from "unread."
async function postActionOnMessage(messageId, postAction) {
  if (postAction === 'delete') {
    const r = await callGateway('delete_message', { messageId });
    if (r.ok) return { ok: true, action: 'deleted' };
    // Fallback if route doesn't exist yet
    const r2 = await callGateway('mark_read', { messageId });
    if (r2.ok) return { ok: true, action: 'mark_read_fallback', note: 'delete_message not wired on gateway' };
    return { ok: false, action: 'none', error: r.error || r2.error };
  }
  if (postAction === 'archive') {
    const r = await callGateway('archive_message', { messageId });
    if (r.ok) return { ok: true, action: 'archived' };
    const r2 = await callGateway('mark_read', { messageId });
    if (r2.ok) return { ok: true, action: 'mark_read_fallback' };
    return { ok: false, action: 'none', error: r.error || r2.error };
  }
  if (postAction === 'mark_read') {
    const r = await callGateway('mark_read', { messageId });
    return { ok: r.ok, action: 'mark_read', error: r.error };
  }
  return { ok: true, action: 'none' };
}

export async function runScan({ anthropic, jacquiDir, dryRun = false }) {
  const RULES_DIR = path.join(jacquiDir, 'rules');
  ensureDir(RULES_DIR);
  const STATE_PATH = path.join(RULES_DIR, 'listing-inquiry-forward.json');
  const state = loadState(STATE_PATH);
  const cfg = state.config;

  const run = {
    startedAt: new Date().toISOString(),
    dryRun: !!dryRun,
    found: 0,
    skipped_already_processed: 0,
    skipped_no_contact: 0,
    skipped_duplicate_lead: 0,
    skipped_blocklisted_sender: 0,
    forwarded: 0,
    acknowledged: 0,
    deleted: 0,
    errors: [],
    details: [],
  };

  if (!cfg.enabled) {
    run.error = 'rule disabled';
    return run;
  }

  // Phase 1: pull a recent inbox window. We search by listing match to bias
  // the result set toward what we care about; if the gateway returns sent
  // items along with inbox, we filter those out by sender_blocklist.
  const searchRes = await callGateway('search_messages', {
    query: cfg.listing_match,
    limit: cfg.scan_limit,
  });
  if (!searchRes.ok) {
    run.error = `search_messages failed: ${searchRes.error}`;
    return run;
  }
  const messages = searchRes.messages || searchRes.value || searchRes.results || [];
  run.found = messages.length;

  for (const msg of messages) {
    const id = getId(msg);
    if (!id) continue;
    const detail = { id, subject: getSubject(msg) };

    if (state.processed_message_ids.includes(id)) {
      run.skipped_already_processed += 1;
      detail.status = 'already-processed';
      run.details.push(detail);
      continue;
    }
    const sender = senderAddress(msg);
    if (cfg.sender_blocklist.some(b => sender.endsWith(b.toLowerCase()))) {
      run.skipped_blocklisted_sender += 1;
      detail.status = 'blocklisted-sender';
      detail.sender = sender;
      run.details.push(detail);
      state.processed_message_ids.push(id);
      continue;
    }
    if (!matchesListing(msg, cfg)) {
      // search hit but doesn't match aliases — skip silently, don't mark processed.
      detail.status = 'no-listing-match';
      run.details.push(detail);
      continue;
    }

    // Extract contact
    const contact = await extractContactWithHaiku({
      anthropic,
      subject: getSubject(msg),
      body: getBody(msg),
    });
    detail.contact = contact;

    if (!contact.name && !contact.email && !contact.phone) {
      run.skipped_no_contact += 1;
      detail.status = 'no-contact-extracted';
      run.details.push(detail);
      continue;
    }

    // Dedupe by email + phone
    const emailKey = (contact.email || '').toLowerCase().trim();
    const phoneKey = (contact.phone || '').replace(/\D/g, '');
    if (emailKey && state.processed_lead_emails.includes(emailKey)) {
      run.skipped_duplicate_lead += 1;
      detail.status = 'duplicate-lead-email';
      run.details.push(detail);
      state.processed_message_ids.push(id);
      continue;
    }
    if (phoneKey && state.processed_lead_phones.includes(phoneKey)) {
      run.skipped_duplicate_lead += 1;
      detail.status = 'duplicate-lead-phone';
      run.details.push(detail);
      state.processed_message_ids.push(id);
      continue;
    }

    // Forward to buyer's agent
    const fwdSubject = cfg.forward_subject_template
      .replace('{address}', cfg.listing_match)
      .replace('{name}', contact.name || 'New inquiry');
    const fwdBody = [
      `Hi Ryan,`,
      ``,
      `New lead on ${cfg.listing_match}, Midland:`,
      ``,
      `Name:  ${contact.name || '—'}`,
      `Email: ${contact.email || '—'}`,
      `Phone: ${contact.phone || '—'}`,
      ``,
      `Source: ${sender || 'unknown'} (${getSubject(msg)})`,
      `Received: ${msg.receivedDateTime || msg.received || '—'}`,
      ``,
      `Auto-forwarded by Agent HQ. Reply directly if anything looks off.`,
      ``,
      `Cheers, Jonathan`,
    ].join('\n');

    let fwdRes;
    if (dryRun) {
      fwdRes = { ok: true, dryRun: true };
      detail.forward = fwdRes;
      run.forwarded += 1;
    } else {
      fwdRes = await callGateway('send_email', {
        to: cfg.forward_to,
        subject: fwdSubject,
        body: fwdBody,
      });
      detail.forward = fwdRes;
      if (!fwdRes.ok) {
        run.errors.push({ stage: 'forward', id, error: fwdRes.error });
        detail.status = 'forward-failed';
        run.details.push(detail);
        continue;
      }
      run.forwarded += 1;
    }

    // Acknowledge engagement
    if (cfg.ack_to && !dryRun) {
      const ackSubject = `Re: ${getSubject(msg).slice(0, 100)}`;
      const ackRes = await callGateway('send_email', {
        to: cfg.ack_to,
        subject: ackSubject,
        body: cfg.ack_body,
      });
      detail.ack = ackRes;
      if (ackRes.ok) {
        run.acknowledged += 1;
      } else {
        run.errors.push({ stage: 'ack', id, error: ackRes.error });
      }
    } else if (dryRun) {
      detail.ack = { ok: true, dryRun: true };
      run.acknowledged += 1;
    }

    // Post-action on original (delete preferred, mark_read fallback)
    let paRes;
    if (dryRun) {
      paRes = { ok: true, action: 'dry-run', note: 'would ' + cfg.post_action };
      detail.post_action = paRes;
    } else {
      paRes = await postActionOnMessage(id, cfg.post_action);
      detail.post_action = paRes;
      if (paRes.ok && (paRes.action === 'deleted' || paRes.action === 'archived')) {
        run.deleted += 1;
      } else if (!paRes.ok) {
        run.errors.push({ stage: 'post_action', id, error: paRes.error });
      }
    }

    // Record dedupe + processed (skip in dry run so a real run can still see them)
    if (!dryRun) {
      state.processed_message_ids.push(id);
      if (emailKey) state.processed_lead_emails.push(emailKey);
      if (phoneKey) state.processed_lead_phones.push(phoneKey);
    }

    detail.status = 'forwarded';
    run.details.push(detail);
  }

  run.finishedAt = new Date().toISOString();
  state.runs.push({
    at: run.finishedAt,
    found: run.found,
    forwarded: run.forwarded,
    acknowledged: run.acknowledged,
    deleted: run.deleted,
    skipped: run.skipped_already_processed + run.skipped_duplicate_lead + run.skipped_blocklisted_sender + run.skipped_no_contact,
    errors: run.errors.length,
  });
  if (!dryRun) saveState(STATE_PATH, state);
  return run;
}

export function register(app, deps) {
  const { anthropic, jacquiDir, JACQUI_DIR } = deps;
  const dir = jacquiDir || JACQUI_DIR;
  if (!dir) {
    throw new Error('listing-inquiry-forward: jacquiDir required');
  }
  const RULES_DIR = path.join(dir, 'rules');
  ensureDir(RULES_DIR);
  const STATE_PATH = path.join(RULES_DIR, 'listing-inquiry-forward.json');

  app.post('/api/jacqui/rules/listing-inquiry-forward/scan', async (req, res) => {
    try {
      const dryRun = req.query.dry_run === '1' || req.query.dry_run === 'true' || req.body?.dry_run === true;
      const run = await runScan({ anthropic, jacquiDir: dir, dryRun });
      res.json({ ok: true, run });
    } catch (e) {
      console.error('[ListingInquiryForward] scan error:', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/jacqui/rules/listing-inquiry-forward/state', (req, res) => {
    const state = loadState(STATE_PATH);
    res.json({
      ok: true,
      config: state.config,
      counts: {
        processed_message_ids: state.processed_message_ids.length,
        processed_lead_emails: state.processed_lead_emails.length,
        processed_lead_phones: state.processed_lead_phones.length,
        runs: state.runs.length,
      },
      recent_runs: state.runs.slice(-10),
      recent_leads: state.processed_lead_emails.slice(-20),
    });
  });

  app.put('/api/jacqui/rules/listing-inquiry-forward/config', (req, res) => {
    const state = loadState(STATE_PATH);
    const b = req.body || {};
    state.config = { ...state.config, ...b };
    saveState(STATE_PATH, state);
    res.json({ ok: true, config: state.config });
  });

  app.post('/api/jacqui/rules/listing-inquiry-forward/seed-dedupe', (req, res) => {
    const state = loadState(STATE_PATH);
    const b = req.body || {};
    const emails = Array.isArray(b.lead_emails) ? b.lead_emails : [];
    const phones = Array.isArray(b.lead_phones) ? b.lead_phones : [];
    const msgIds = Array.isArray(b.message_ids) ? b.message_ids : [];
    let added = { emails: 0, phones: 0, message_ids: 0 };
    for (const e of emails) {
      const k = String(e).toLowerCase().trim();
      if (k && !state.processed_lead_emails.includes(k)) {
        state.processed_lead_emails.push(k);
        added.emails += 1;
      }
    }
    for (const p of phones) {
      const k = String(p).replace(/\D/g, '');
      if (k && !state.processed_lead_phones.includes(k)) {
        state.processed_lead_phones.push(k);
        added.phones += 1;
      }
    }
    for (const m of msgIds) {
      if (m && !state.processed_message_ids.includes(m)) {
        state.processed_message_ids.push(m);
        added.message_ids += 1;
      }
    }
    saveState(STATE_PATH, state);
    res.json({ ok: true, added, counts: {
      processed_message_ids: state.processed_message_ids.length,
      processed_lead_emails: state.processed_lead_emails.length,
      processed_lead_phones: state.processed_lead_phones.length,
    }});
  });

  app.post('/api/jacqui/rules/listing-inquiry-forward/reset', (req, res) => {
    const state = loadState(STATE_PATH);
    state.processed_message_ids = [];
    state.processed_lead_emails = [];
    state.processed_lead_phones = [];
    state.runs = [];
    saveState(STATE_PATH, state);
    res.json({ ok: true, message: 'state reset (config preserved)' });
  });

  console.log('[ListingInquiryForward] registered v1 — /api/jacqui/rules/listing-inquiry-forward/{scan,state,config,reset}');
}
