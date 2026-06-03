// lib/jacqui/morning-briefing.js
//
// Phase 3 — Jacqui's morning inbox triage.
//
// Pulls unread Outlook messages via the MS365 connector, hands them to Sonnet
// for classification (URGENT / CLIENT / LEAD / ROUTINE / NOISE), persists the
// result to JACQUI_DIR/briefings/YYYY-MM-DD.json, and returns a structured
// briefing the caller can render in chat, email, iMessage, or the Agent HQ UI.
//
// Designed to be safe to call on demand (Jacqui can run it from a chat
// message: "give me the morning briefing") AND on a cron schedule (the
// scheduled-tasks system fires it at 6am Toronto time daily).
//
// FACTS ONLY: the triage prompt forbids the model from inventing senders,
// subjects, or content. Anything the classifier is unsure about goes to
// ROUTINE, never to URGENT.

import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { ms365 } from '../connectors/ms365.js';
import { pickModel } from './model-router.js';

const TRIAGE_SYSTEM_PROMPT = `You are Jacqui, Jonathan Wallace's executive assistant.
Jonathan is a high-producing real estate agent at Faris Team in Georgian Bay / Midland, Ontario.

You will receive a JSON array of his UNREAD Outlook emails. Classify each one
into exactly one of these buckets:

  • URGENT — needs Jonathan's eyes TODAY. Signed offers, accepted/countered
    offers, deal-collapse risk, lawyer/legal correspondence, financial issues,
    urgent seller dissatisfaction, time-sensitive showing requests, inspection
    flags, conditional-period deadlines.
  • CLIENT — an active client (buyer or seller) thread that needs a personal
    response within 24h but isn't an emergency.
  • LEAD — new buyer or seller inquiry. Often Realtor.ca, Zillow, Faris Team
    inbound forms, brokerage feeds, or cold inbound from prospect emails.
  • ROUTINE — newsletters, brokerage admin, MLS notifications, scheduled
    market updates, factual replies that can wait until later in the day.
  • NOISE — spam, expired notifications, automated noise with no action.

OUTPUT FORMAT — strict JSON, nothing else. No markdown fences, no preamble.

{
  "headline": "one short sentence summarising the inbox state",
  "urgent":  [{ "id": "...", "from": "...", "subject": "...", "why": "<one short reason>" }],
  "client":  [{ "id": "...", "from": "...", "subject": "...", "summary": "<one short summary>" }],
  "lead":    [{ "id": "...", "from": "...", "subject": "..." }],
  "routine_count": <integer>,
  "noise_count":   <integer>
}

FACTS ONLY. Never invent a sender, subject, or detail. If you're not sure why
something is urgent, classify it as ROUTINE — better to under-flag than to
cry wolf. Pass the email's id field through verbatim so Jacqui can act on it.`;

/**
 * Run the morning briefing.
 *
 * @param {object} opts
 * @param {string} [opts.JACQUI_DIR] - if provided, briefing is persisted here.
 * @param {number} [opts.limit=50]   - how many recent messages to consider.
 * @returns {Promise<object>} the structured briefing object (always defined,
 *                            even on error — caller checks the `ok` field).
 */
export async function runMorningBriefing({ JACQUI_DIR, limit = 50 } = {}) {
  const t0 = Date.now();

  // Step 1 — pull recent inbox via the connector.
  const inboxResult = await ms365.readInbox({ limit });
  if (!inboxResult.ok) {
    return finalize({
      ok: false,
      error: `Inbox read failed via ${ms365.backendName}: ${inboxResult.error || 'unknown error'}`,
      backend: ms365.backendName,
    }, t0, JACQUI_DIR);
  }

  // Normalise the message array — Make.com gateway, Graph, and stubs may all
  // return slightly different shapes. We try the common ones in order.
  const messages =
    inboxResult.messages ||
    inboxResult.value ||
    inboxResult.data ||
    inboxResult.items ||
    [];

  const unread = messages.filter(m => m && m.isRead === false);

  if (unread.length === 0) {
    return finalize({
      ok: true,
      headline: 'Inbox at zero — nothing unread.',
      urgent: [],
      client: [],
      lead: [],
      routine_count: 0,
      noise_count: 0,
      total_considered: messages.length,
      total_unread: 0,
      backend: ms365.backendName,
    }, t0, JACQUI_DIR);
  }

  // Step 2 — compact each message into the minimal shape the classifier needs.
  // Body preview is capped at 500 chars to keep token cost predictable.
  const inboxJson = unread.map(m => ({
    id: m.id,
    from:
      m.from?.emailAddress?.address ||
      m.from?.emailAddress?.name ||
      m.from ||
      '(unknown sender)',
    subject: m.subject || '(no subject)',
    receivedDateTime: m.receivedDateTime || m.received_date_time || null,
    bodyPreview: (m.bodyPreview || m.body_preview || '').slice(0, 500),
  }));

  // Step 3 — Sonnet triage. Reasoning-tier model because classifying intent
  // across a noisy real-estate inbox is exactly the kind of work Haiku flubs.
  let completion;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    completion = await anthropic.messages.create({
      model: pickModel('reasoning'),
      max_tokens: 4000,
      system: TRIAGE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Unread emails (${unread.length}):\n${JSON.stringify(inboxJson, null, 2)}`,
      }],
    });
  } catch (e) {
    return finalize({
      ok: false,
      error: `Anthropic triage call failed: ${e.message}`,
      total_unread: unread.length,
      backend: ms365.backendName,
    }, t0, JACQUI_DIR);
  }

  const rawText = completion.content?.[0]?.text || '';
  let parsed;
  try {
    // Extract the first {...} JSON object even if the model wrapped it in prose.
    const m = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : rawText);
  } catch (e) {
    return finalize({
      ok: false,
      error: `Triage JSON parse failed: ${e.message}`,
      raw: rawText.slice(0, 2000),
      total_unread: unread.length,
      backend: ms365.backendName,
    }, t0, JACQUI_DIR);
  }

  return finalize({
    ok: true,
    headline: parsed.headline || '(no headline)',
    urgent: Array.isArray(parsed.urgent) ? parsed.urgent : [],
    client: Array.isArray(parsed.client) ? parsed.client : [],
    lead:   Array.isArray(parsed.lead)   ? parsed.lead   : [],
    routine_count: Number(parsed.routine_count) || 0,
    noise_count:   Number(parsed.noise_count)   || 0,
    total_considered: messages.length,
    total_unread: unread.length,
    backend: ms365.backendName,
    model: completion.model,
    usage: completion.usage,
  }, t0, JACQUI_DIR);
}

// ---- helpers -----------------------------------------------------------

function finalize(result, t0, JACQUI_DIR) {
  result.ts = new Date().toISOString();
  result.elapsed_ms = Date.now() - t0;

  // Persist to JACQUI_DIR/briefings/YYYY-MM-DD.json so the Agent HQ UI can
  // render today's briefing without re-running it. Failure is silent — the
  // briefing is still useful even if disk write fails.
  if (JACQUI_DIR) {
    try {
      const dir = path.join(JACQUI_DIR, 'briefings');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const today = result.ts.slice(0, 10);
      fs.writeFileSync(
        path.join(dir, `${today}.json`),
        JSON.stringify(result, null, 2),
      );
    } catch (e) {
      console.warn('[morning-briefing] persist failed:', e.message);
    }
  }

  return result;
}

/**
 * Read today's briefing from disk, if one exists. Used by the GET endpoint
 * so the Agent HQ UI can show the latest briefing without re-running it.
 */
export function readTodaysBriefing(JACQUI_DIR) {
  if (!JACQUI_DIR) return null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(JACQUI_DIR, 'briefings', `${today}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn('[morning-briefing] read failed:', e.message);
    return null;
  }
}

/**
 * Format the briefing as a human-readable plain text block. Useful for
 * iMessage / SMS dispatch and for Jacqui to quote when she answers
 * "what's in my inbox" in chat.
 */
export function formatBriefingText(briefing) {
  if (!briefing) return 'No briefing available yet.';
  if (!briefing.ok) return `Briefing failed: ${briefing.error || 'unknown error'}`;
  const lines = [];
  lines.push(briefing.headline || 'Morning briefing');
  lines.push('');
  if (briefing.urgent?.length) {
    lines.push(`URGENT (${briefing.urgent.length}):`);
    briefing.urgent.forEach(u => lines.push(`  • ${u.from} — ${u.subject} — ${u.why || ''}`.trim()));
    lines.push('');
  }
  if (briefing.client?.length) {
    lines.push(`CLIENT (${briefing.client.length}):`);
    briefing.client.forEach(c => lines.push(`  • ${c.from} — ${c.subject}${c.summary ? ' — ' + c.summary : ''}`));
    lines.push('');
  }
  if (briefing.lead?.length) {
    lines.push(`LEADS (${briefing.lead.length}):`);
    briefing.lead.forEach(l => lines.push(`  • ${l.from} — ${l.subject}`));
    lines.push('');
  }
  lines.push(`Routine: ${briefing.routine_count || 0}   Noise: ${briefing.noise_count || 0}   Total unread: ${briefing.total_unread || 0}`);
  return lines.join('\n');
}
