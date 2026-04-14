/**
 * Letter of Opinion (LOO / LOV) — Jonathan's written market-value estimate.
 * CRUD + Claude-assisted letter-body generation + printable HTML view.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const Anthropic = require('@anthropic-ai/sdk');
const { requireApiKey } = require('../middleware/apiKey');
const intuition = require('../services/intuition');

const anthropic = new Anthropic();

// -------- CRUD (all require API key) --------
router.get('/', requireApiKey, async (req, res) => {
  try {
    const { status } = req.query;
    const where = [];
    const params = [];
    if (status && status !== 'all') { params.push(status); where.push(`status = $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT * FROM letter_opinions
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY prepared_date DESC, created_at DESC LIMIT 200`,
      params
    );
    res.json({ letters: rows, count: rows.length });
  } catch (err) {
    console.error('letters list error:', err);
    res.status(500).json({ error: 'Failed to list letters' });
  }
});

router.post('/', requireApiKey, async (req, res) => {
  try {
    const b = req.body;
    if (!b.property_address) return res.status(400).json({ error: 'property_address required' });
    const { rows } = await pool.query(
      `INSERT INTO letter_opinions
        (seller_form_id, client_name, client_email, prepared_for,
         property_address, city, postal_code, property_type,
         bedrooms, bathrooms, square_footage, lot_size, year_built,
         opinion_low, opinion_mid, opinion_high, comps, rationale, letter_body,
         prepared_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               COALESCE($17,'[]')::jsonb, $18, $19, COALESCE($20,CURRENT_DATE), COALESCE($21,'draft'))
       RETURNING *`,
      [b.seller_form_id || null, b.client_name || null, b.client_email || null, b.prepared_for || null,
       b.property_address, b.city || null, b.postal_code || null, b.property_type || null,
       b.bedrooms || null, b.bathrooms || null, b.square_footage || null, b.lot_size || null, b.year_built || null,
       b.opinion_low || null, b.opinion_mid || null, b.opinion_high || null,
       b.comps ? JSON.stringify(b.comps) : null, b.rationale || null, b.letter_body || null,
       b.prepared_date || null, b.status]
    );
    res.status(201).json({ letter: rows[0] });
  } catch (err) {
    console.error('letters create error:', err);
    res.status(500).json({ error: 'Failed to create letter' });
  }
});

router.patch('/:id', requireApiKey, async (req, res) => {
  try {
    const allowed = ['client_name','client_email','prepared_for','property_address','city','postal_code',
      'property_type','bedrooms','bathrooms','square_footage','lot_size','year_built',
      'opinion_low','opinion_mid','opinion_high','comps','rationale','letter_body',
      'prepared_date','status','delivered_at'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) {
        sets.push(`${f} = $${idx++}`);
        params.push(f === 'comps' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE letter_opinions SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ letter: rows[0] });
  } catch (err) {
    console.error('letters update error:', err);
    res.status(500).json({ error: 'Failed to update letter' });
  }
});

router.delete('/:id', requireApiKey, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM letter_opinions WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

/**
 * POST /api/letters/generate-from-seller-form/:id
 * One-click: take a seller_forms row, ask Claude to draft the LOO body, insert
 * the draft letter row, and return it to the dashboard ready for review.
 */
router.post('/generate-from-seller-form/:id', requireApiKey, async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Claude not configured' });
    }
    const { rows: forms } = await pool.query('SELECT * FROM seller_forms WHERE id = $1', [req.params.id]);
    if (!forms.length) return res.status(404).json({ error: 'Seller form not found' });
    const f = forms[0];

    const ctx = await intuition.buildContextBlock();
    const systemPrompt = `You are Jonathan Wallace (The Official Realty Group) preparing a formal
Letter of Opinion of Value (LOO) for a property in Southern Georgian Bay, Ontario.

Write it in Jonathan's voice: professional, confident, specific. No fluff.
No clichés like "dream home" or "won't last". No high-pressure language.

Format the letter body with these sections (in this order, plain text — no markdown):

  OPINION OF VALUE
  (One-paragraph summary with a single-number headline value or a tight range.)

  SUBJECT PROPERTY
  (Address, property type, bedrooms, bathrooms, square footage, lot, year built, condition.)

  METHODOLOGY
  (Brief — comparative market analysis using recent comparable sales in the immediate area.)

  MARKET CONTEXT
  (2-3 sentences on current SOGB market conditions relevant to the property.)

  CLOSING
  (Professional sign-off. Noting the LOO is an informal opinion, not a formal appraisal.)

Do NOT include the letterhead / date / recipient address blocks — the dashboard
will render those. Start directly at "OPINION OF VALUE".${ctx ? '\n\n' + ctx : ''}`;

    const userMsg = `Draft the LOO body for this property:\n\n${JSON.stringify({
      owner_name: f.owner_name,
      property_address: f.property_address,
      city: f.city,
      postal_code: f.postal_code,
      property_type: f.property_type,
      bedrooms: f.bedrooms,
      bathrooms: f.bathrooms,
      square_footage: f.square_footage,
      lot_size: f.lot_size,
      year_built: f.year_built,
      upgrades: f.upgrades,
      condition_rating: f.condition_rating,
      price_expectation: f.price_expectation,
      additional_notes: f.additional_notes
    }, null, 2)}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }]
    });

    const body = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

    // Insert the draft
    const inserted = await pool.query(
      `INSERT INTO letter_opinions
        (seller_form_id, client_name, client_email, property_address, city, postal_code,
         property_type, bedrooms, bathrooms, square_footage, lot_size, year_built,
         letter_body, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft')
       RETURNING *`,
      [f.id, f.owner_name, f.email, f.property_address, f.city, f.postal_code,
       f.property_type, f.bedrooms, f.bathrooms, f.square_footage, f.lot_size, f.year_built,
       body]
    );

    res.status(201).json({ letter: inserted.rows[0], tokens: response.usage });
  } catch (err) {
    console.error('letters generate-from-seller-form error:', err);
    res.status(500).json({ error: 'Failed to generate letter', message: err.message });
  }
});

/**
 * POST /api/letters/:id/generate-body
 * Regenerate the letter body using whatever data is already on the letter row
 * (or user-supplied opinion_low/mid/high + rationale).
 */
router.post('/:id/generate-body', requireApiKey, async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Claude not configured' });
    }
    const { rows } = await pool.query('SELECT * FROM letter_opinions WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const l = rows[0];

    const ctx = await intuition.buildContextBlock();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1800,
      system: `You are Jonathan Wallace drafting a formal Letter of Opinion of Value. Plain text,
no markdown. Sections in order: OPINION OF VALUE, SUBJECT PROPERTY, METHODOLOGY,
MARKET CONTEXT, CLOSING. No clichés. Disclose the LOO is informal, not a formal appraisal.${ctx ? '\n\n' + ctx : ''}`,
      messages: [{ role: 'user', content: `Draft the LOO body for:\n\n${JSON.stringify(l, null, 2)}` }]
    });
    const body = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const upd = await pool.query(
      `UPDATE letter_opinions SET letter_body = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [body, req.params.id]
    );
    res.json({ letter: upd.rows[0], tokens: response.usage });
  } catch (err) {
    console.error('letters generate-body error:', err);
    res.status(500).json({ error: 'Failed to generate body', message: err.message });
  }
});

/**
 * GET /api/letters/:id/print?key=API_KEY
 * Standalone HTML page formatted for browser-native Print → Save as PDF.
 * Auth via query string so the "Print" button can open a new tab.
 */
router.get('/:id/print', async (req, res) => {
  if (process.env.API_KEY && req.query.key !== process.env.API_KEY) {
    return res.status(401).send('unauthorized');
  }
  try {
    const { rows } = await pool.query('SELECT * FROM letter_opinions WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).send('Not found');
    const l = rows[0];
    res.type('html').send(renderLetterHtml(l));
  } catch (err) {
    console.error('letters print error:', err);
    res.status(500).send('Render failed');
  }
});

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
function fmtMoney(n) {
  const v = Number(n) || 0;
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);
}
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderLetterHtml(l) {
  const opinionLine = l.opinion_low && l.opinion_high && l.opinion_low !== l.opinion_high
    ? `${fmtMoney(l.opinion_low)} – ${fmtMoney(l.opinion_high)}`
    : l.opinion_mid ? fmtMoney(l.opinion_mid) : 'See letter below';

  const body = (l.letter_body || '').split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Letter of Opinion — ${esc(l.property_address)}</title>
<style>
  @page { margin: 0.8in; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a2e; line-height: 1.55; max-width: 8.5in; margin: 0 auto; padding: 0.75in 0.5in; }
  .header { border-bottom: 2px solid #c9a96e; padding-bottom: 0.75rem; margin-bottom: 2rem; }
  .brand { font-size: 1.4rem; letter-spacing: 2px; color: #0a1628; font-weight: 700; }
  .brand-sub { font-size: 0.85rem; color: #6b7280; letter-spacing: 1px; text-transform: uppercase; }
  .meta { display:flex; justify-content:space-between; margin: 1.5rem 0; font-size: 0.85rem; color: #374151; }
  h1 { font-size: 1.3rem; margin: 1rem 0 0.5rem; }
  .opinion-box { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 1rem 1.25rem; margin: 1.25rem 0; }
  .opinion-box .label { font-size: 0.75rem; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; }
  .opinion-box .value { font-size: 1.4rem; font-weight: 700; color: #c9a96e; margin-top: 0.25rem; }
  p { margin: 0.7rem 0; }
  .signature { margin-top: 2.5rem; padding-top: 0.5rem; border-top: 1px dashed #e5e7eb; }
  .signature .name { font-weight: 700; }
  .footer { margin-top: 2rem; font-size: 0.72rem; color: #9ca3af; line-height: 1.5; }
  .actions { position: fixed; top: 0.5rem; right: 0.5rem; display: flex; gap: 0.4rem; }
  .actions button { background:#0a1628;color:#fff;border:none;padding:0.5rem 0.9rem;border-radius:6px;cursor:pointer;font-size:0.8rem; }
  @media print { .actions { display: none; } body { padding: 0; } }
</style></head>
<body>
  <div class="actions">
    <button onclick="window.print()">Print / Save PDF</button>
    <button onclick="window.close()">Close</button>
  </div>
  <div class="header">
    <div class="brand">JONATHAN WALLACE</div>
    <div class="brand-sub">The Official Realty Group · Southern Georgian Bay</div>
  </div>

  <div class="meta">
    <div><strong>Date:</strong> ${esc(fmtDate(l.prepared_date))}</div>
    <div><strong>File:</strong> LOO-${esc(String(l.id).padStart(4,'0'))}</div>
  </div>

  <p>
    ${l.prepared_for ? `<strong>Prepared for:</strong> ${esc(l.prepared_for)}<br>` : ''}
    ${l.client_name ? `<strong>Client:</strong> ${esc(l.client_name)}<br>` : ''}
    <strong>Subject Property:</strong> ${esc(l.property_address)}${l.city ? ', ' + esc(l.city) : ''}${l.postal_code ? ' ' + esc(l.postal_code) : ''}
  </p>

  <div class="opinion-box">
    <div class="label">Opinion of Value</div>
    <div class="value">${opinionLine}</div>
  </div>

  ${body || '<p><em>Letter body not yet generated. Open the letter in the dashboard and click "Generate Body" to have Claude draft the content.</em></p>'}

  <div class="signature">
    <p class="name">Jonathan Wallace</p>
    <p>Realtor · The Official Realty Group<br>
       jonathanwallacerealestate@gmail.com</p>
  </div>

  <div class="footer">
    This Letter of Opinion is an informal estimate of market value based on comparable sales and publicly available data.
    It is not a formal appraisal and should not be relied upon as such for mortgage, legal, or tax purposes where a
    formal appraisal is required.
  </div>
</body></html>`;
}

module.exports = router;
