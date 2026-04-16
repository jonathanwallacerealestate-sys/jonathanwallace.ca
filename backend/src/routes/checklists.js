/**
 * Deal checklists — Claude generates a tailored checklist for any deal type
 * (buyer, seller, listing, pre-close) and drops each item as both a local
 * personal_task AND a FUB task on the linked contact.
 *
 * Templates are contextual: Claude sees the closings row, the contact's FUB
 * history (if linked), and the current date so deadlines are absolute.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const Anthropic = require('@anthropic-ai/sdk');
const { requireApiKey } = require('../middleware/apiKey');
const { publish } = require('../services/events');

router.use(requireApiKey);

const VALID_TYPES = ['new_listing', 'new_buyer_rep', 'pre_close_buyer', 'pre_close_seller', 'post_close', 'custom'];

const SYSTEM_PROMPT = `You are generating a real estate transaction checklist for Jonathan Wallace
(The Official Realty Group, Southern Georgian Bay, Ontario). Return STRICT JSON:

{
  "title": "<short checklist title>",
  "items": [
    {
      "title": "<short task title>",
      "due_date": "YYYY-MM-DD",
      "category": "admin|contract|marketing|client|inspection|finance|legal",
      "priority": 1-5,
      "notes": "<1-2 sentence explanation of what specifically to do>"
    }
  ]
}

Rules:
- Items sorted by due_date ascending (earliest first).
- due_date must be an absolute date (not relative). Use today's date and the
  deal dates provided to compute real calendar dates.
- 8-15 items per checklist. Don't pad with generic filler.
- For pre_close: include conditions waiver confirmation, financing approval,
  title search, insurance, walkthrough, key handover, lawyer check-in.
- For new_listing: include photography, floor plan, MLS entry, feature sheet,
  signage, staging consultation, open-house scheduling, social media.
- For new_buyer_rep: include BRA signing, needs assessment, MLS search setup,
  financing pre-approval, first showings, neighbourhood tour.
- For post_close: include thank-you gift, Google review ask, referral ask
  (30 days), 90-day check-in, 1-year anniversary.
- Adapt to whatever custom instructions Jonathan provides.
- Ontario-specific: SPIS, lawyer on title, Land Transfer Tax, FINTRAC.`;

/**
 * POST /api/checklists/generate
 * Body: { closing_id?, type, custom_instructions? }
 *
 * If closing_id is provided, uses the deal data for dates + client info.
 * Otherwise generates from type + custom instructions alone.
 * With dry_run=true, returns the checklist without creating tasks.
 */
router.post('/generate', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Claude not configured' });
    const { closing_id, type, custom_instructions, dry_run } = req.body || {};
    if (!type || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: 'type must be one of ' + VALID_TYPES.join(', ') });
    }

    // Load closing data if specified
    let closing = null;
    if (closing_id) {
      const { rows } = await pool.query('SELECT * FROM closings WHERE id = $1', [closing_id]);
      closing = rows[0] || null;
    }

    // Load intuition
    const intuition = require('../services/intuition');
    let ctxBlock = '';
    try { ctxBlock = await intuition.buildContextBlock(); } catch (e) {}

    const today = new Date().toISOString().slice(0, 10);
    const userMsg = `Checklist type: ${type}
Today: ${today}
${closing ? `Deal: ${JSON.stringify({
  property_address: closing.property_address,
  city: closing.city,
  client_name: closing.client_name,
  client_type: closing.client_type,
  transaction_side: closing.transaction_side,
  status: closing.status,
  offer_date: closing.offer_date,
  firm_date: closing.firm_date,
  closing_date: closing.closing_date,
  sale_price: closing.sale_price
}, null, 2)}` : 'No specific deal — generate a generic checklist for this type.'}
${custom_instructions ? `\nSpecial instructions from Jonathan: ${custom_instructions}` : ''}`;

    const anthropic = new Anthropic();
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: ctxBlock ? `${SYSTEM_PROMPT}\n\n${ctxBlock}` : SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }]
    });

    const text = r.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'Could not parse checklist JSON', raw: text });
    let parsed;
    try { parsed = JSON.parse(match[0]); }
    catch (e) { return res.status(500).json({ error: 'Invalid JSON: ' + e.message, raw: text }); }

    const items = parsed.items || [];
    if (dry_run) {
      return res.json({ success: true, dry_run: true, title: parsed.title, items, tokens: r.usage });
    }

    // Create tasks — both locally and in FUB if the deal has a linked client
    let fubPersonId = null;
    if (closing?.client_name) {
      try {
        const fub = require('../services/fub');
        const key = await fub.getApiKey();
        if (key) {
          const m = await fub.listPeople({ search: closing.client_name, limit: 1 });
          if (m.people && m.people[0]) fubPersonId = m.people[0].id;
        }
      } catch (e) { /* FUB not configured — local only */ }
    }

    const created = { local: [], fub: [] };
    for (const item of items) {
      // Local personal_task
      try {
        const lr = await pool.query(
          `INSERT INTO personal_tasks (title, notes, category, priority, due_date, source, external_id)
           VALUES ($1, $2, $3, $4, $5, 'checklist', $6)
           RETURNING id`,
          [item.title, item.notes || null, item.category || 'admin',
           item.priority || 3, item.due_date || null,
           closing_id ? `checklist:${closing_id}:${item.title.slice(0, 40)}` : null]
        );
        created.local.push(lr.rows[0]?.id);
      } catch (e) { /* skip dups */ }

      // FUB task if linked
      if (fubPersonId) {
        try {
          const fub = require('../services/fub');
          const task = await fub.createTask({
            personId: fubPersonId,
            name: item.title,
            type: mapCategory(item.category),
            dueDate: item.due_date ? new Date(item.due_date).toISOString() : undefined,
            description: item.notes || undefined,
            status: 'Active'
          });
          created.fub.push(task.id);
        } catch (e) { /* best effort */ }
      }
    }

    publish({ type: 'checklist', event: 'generated', closing_id, count: items.length });
    res.json({
      success: true,
      title: parsed.title,
      items,
      created: { local_count: created.local.length, fub_count: created.fub.length },
      fub_person_id: fubPersonId,
      tokens: r.usage
    });
  } catch (err) {
    console.error('checklist generate error:', err);
    res.status(500).json({ error: 'Failed to generate checklist', message: err.message });
  }
});

function mapCategory(cat) {
  const m = { admin: 'Other', contract: 'Other', marketing: 'Other',
              client: 'Call', inspection: 'Other', finance: 'Call', legal: 'Other' };
  return m[(cat || '').toLowerCase()] || 'Other';
}

/**
 * GET /api/checklists/types — returns the valid checklist types + descriptions
 * so the UI can show a picker without hardcoding.
 */
router.get('/types', (req, res) => {
  res.json({
    types: [
      { id: 'new_listing',       label: 'New listing checklist',            description: 'Photography, MLS entry, signage, marketing, open house' },
      { id: 'new_buyer_rep',     label: 'New buyer rep checklist',          description: 'BRA signing, pre-approval, MLS search, first showings' },
      { id: 'pre_close_buyer',   label: 'Pre-close checklist (buyer)',      description: 'Financing, title search, insurance, walkthrough, keys' },
      { id: 'pre_close_seller',  label: 'Pre-close checklist (seller)',     description: 'Conditions, SPIS, lawyer, staging tear-down, key handover' },
      { id: 'post_close',        label: 'Post-close relationship program',  description: 'Thank-you, review, referral ask, 90-day, anniversary' },
      { id: 'custom',            label: 'Custom checklist',                 description: 'Describe what you need — Claude will generate it' }
    ]
  });
});

module.exports = router;
