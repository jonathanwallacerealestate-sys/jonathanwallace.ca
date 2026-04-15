/**
 * Email triage — given a parsed Gmail message + optional FUB context, asks
 * Claude for a structured categorization plus a suggested reply-draft seed.
 *
 * Returns:
 *   { priority, category, summary, suggested_action, suggested_label,
 *     needs_reply, draft_reply }
 *
 * priority: urgent | high | normal | low
 * category: client | active_deal | lead | contract | admin | marketing |
 *           personal | junk | newsletter | transaction
 */
const Anthropic = require('@anthropic-ai/sdk');
const intuition = require('./intuition');

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are Jonathan Wallace's executive assistant triaging his inbox.
Jonathan is a real estate agent in Southern Georgian Bay, Ontario. He gets
a mix of client emails, leads, contract paperwork, brokerage admin,
marketing newsletters, and personal. You need to (1) file it and (2) tell
him what to do about it.

Return STRICT JSON, no commentary. Schema:
{
  "priority": "urgent|high|normal|low",
  "category": "client|active_deal|lead|contract|admin|marketing|personal|junk|newsletter|transaction",
  "summary": "<ONE sentence. What is this email actually about?>",
  "needs_reply": true|false,
  "suggested_action": "<What Jonathan should do, in plain English. One sentence.>",
  "suggested_label": "<A short Gmail label name that groups this well, e.g. 'Deals/123 Main St', 'Leads/Inbound', 'Admin/Brokerage', 'Newsletters'. null if no label fits.>",
  "draft_reply": "<If needs_reply is true, a short draft reply in Jonathan's voice. Plain prose, no subject. null otherwise.>"
}

Rules:
- priority=urgent ONLY if the email is time-critical (hours) — closing-day
  issues, conditions waiver deadlines today, lender emergencies, client
  panicking. For normal business responses: high.
- needs_reply=false for newsletters, receipts, calendar invites, most
  automated emails.
- Attachments from clients (signed contracts, inspection reports) are
  priority=high AND needs_reply=true unless already resolved.
- If the email looks like a FUB system email / MLS alert / notification
  where the sender is a system not a human, category=admin or marketing
  and needs_reply=false.
- draft_reply should be short (under 80 words), reference specifics from
  the email, and sound like a real human response — not a template. No
  cliches, no 'dream home'.
- suggested_label MUST use forward-slashes for nesting if you want a
  hierarchy: 'Deals/2-Water-St', 'Leads/Website', etc. Single level is
  fine too.`;

async function triage(message, { fubContext } = {}) {
  const body = (message.bodyPlain || message.bodyHtml || message.snippet || '').slice(0, 4000);
  const strippedBody = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const input = {
    from: message.headers?.from,
    subject: message.headers?.subject,
    date: message.headers?.date,
    has_attachments: (message.attachments || []).length > 0,
    attachment_names: (message.attachments || []).map(a => a.name),
    body: strippedBody.slice(0, 2500),
    fub_known: !!fubContext,
    fub_stage: fubContext?.stage,
    fub_source: fubContext?.source,
    fub_recent_notes: fubContext?.recent_notes?.slice(0, 3)
  };

  let ctxBlock = '';
  try { ctxBlock = await intuition.buildContextBlock(); } catch (e) {}

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    system: ctxBlock ? `${SYSTEM_PROMPT}\n\n${ctxBlock}` : SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }]
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Triage: no JSON in response');
  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch (e) { throw new Error('Triage: invalid JSON: ' + e.message); }

  // Normalize
  const VALID_PRIORITY = ['urgent', 'high', 'normal', 'low'];
  const VALID_CATEGORY = ['client','active_deal','lead','contract','admin','marketing','personal','junk','newsletter','transaction'];
  return {
    priority: VALID_PRIORITY.includes(parsed.priority) ? parsed.priority : 'normal',
    category: VALID_CATEGORY.includes(parsed.category) ? parsed.category : 'admin',
    summary: (parsed.summary || '').slice(0, 500),
    needs_reply: !!parsed.needs_reply,
    suggested_action: (parsed.suggested_action || '').slice(0, 300),
    suggested_label: parsed.suggested_label || null,
    draft_reply: parsed.draft_reply || null,
    tokens: response.usage
  };
}

module.exports = { triage };
