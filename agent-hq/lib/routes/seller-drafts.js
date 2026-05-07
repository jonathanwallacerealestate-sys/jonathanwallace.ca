// lib/routes/seller-drafts.js
//
// Queue + drain for the `draft-seller-emails` Apple Mail skill.
//
// Flow:
//   1. Jonathan clicks "Send Form to Seller" on a listing in Agent HQ
//   2. The button POSTs to /api/listing-form/:propertyId/queue-seller-draft,
//      which sets `sellerEmailDraftQueued = true` on the listing JSON
//   3. The draft-seller-emails skill (running on Jonathan's Mac) periodically
//      GETs /api/listing-form/seller-drafts/queue, gets back an array of
//      { propertyId, to, subject, body } items, and creates a persistent
//      draft in Mac Mail's Drafts folder for each via AppleScript
//   4. After successfully creating each draft, the skill POSTs to
//      /api/listing-form/:propertyId/clear-seller-draft-queue
//
// Auth: x-intake-secret header — same secret as the faris intake skill, since
// only Jonathan's Mac calls these endpoints.
//
// Created 2026-05-07.

import fs from 'node:fs';
import path from 'node:path';

const AGENT = {
  name: 'Jonathan Wallace',
  team: 'Faris Team Real Estate Brokerage',
  phone: '705-433-2525',
};

export function register(app, deps) {
  const { LISTING_FORMS_DIR, AGENT_HQ_BASE_URL = 'https://hq.jonathanwallace.ca' } = deps;

  // ─────────── shared auth check ───────────
  function requireSecret(req, res) {
    const provided = req.header('x-intake-secret');
    const expected = process.env.FARIS_INTAKE_SECRET;
    if (!expected) {
      res.status(500).json({ error: 'server_misconfigured' });
      return false;
    }
    if (!provided || provided !== expected) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  }

  // ─────────── shared file helpers ───────────
  function loadForm(propertyId) {
    const p = path.join(LISTING_FORMS_DIR, `${propertyId}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  function saveForm(propertyId, form) {
    const p = path.join(LISTING_FORMS_DIR, `${propertyId}.json`);
    fs.writeFileSync(p, JSON.stringify(form, null, 2));
  }

  // ─────────── POST queue-seller-draft ───────────
  // Sets the queue flag on a listing. Returns the {to, subject, body} that
  // the skill will use, so the frontend can show a confirmation toast.
  app.post('/api/listing-form/:propertyId/queue-seller-draft', async (req, res) => {
    const form = loadForm(req.params.propertyId);
    if (!form) return res.status(404).json({ success: false, error: 'listing_not_found' });

    const email = buildSellerEmail(form, AGENT_HQ_BASE_URL);
    if (!email.to) {
      return res.status(400).json({
        success: false,
        error: 'missing_seller_email',
        detail: 'Add a seller email to the listing before queuing a draft.',
      });
    }

    form.sellerEmailDraftQueued = true;
    form.sellerEmailDraftQueuedAt = new Date().toISOString();
    form.updatedAt = form.sellerEmailDraftQueuedAt;
    saveForm(req.params.propertyId, form);

    console.log(`[SellerDrafts] Queued draft: ${form.propertyId} → ${email.to}`);

    // Fire-and-confirm: if MAKE_OUTLOOK_DRAFT_WEBHOOK is set, POST the email
    // payload to Make.com which creates an Outlook draft via the
    // microsoft-email:createAMessage module. This eliminates the AppleScript
    // skill drain step — the draft appears in Outlook within a couple seconds.
    const outlookWebhook = process.env.MAKE_OUTLOOK_DRAFT_WEBHOOK;
    let outlookResult = null;
    if (outlookWebhook) {
      try {
        const fwdRes = await fetch(outlookWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId: form.propertyId,
            to: email.to,
            subject: email.subject,
            body: email.body,
          }),
        });
        const fwdText = await fwdRes.text();
        try { outlookResult = JSON.parse(fwdText); } catch { outlookResult = { raw: fwdText.slice(0, 200) }; }
        if (outlookResult && outlookResult.success && outlookResult.draftId) {
          form.outlookDraftId = outlookResult.draftId;
          form.outlookDraftCreatedAt = new Date().toISOString();
          // Clear the queue flag — the draft is now live in Outlook
          form.sellerEmailDraftQueued = false;
          saveForm(req.params.propertyId, form);
          console.log(`[SellerDrafts] Outlook draft created: ${form.propertyId} draftId=${outlookResult.draftId}`);
        } else {
          console.warn(`[SellerDrafts] Outlook webhook did not return draftId:`, outlookResult);
        }
      } catch (err) {
        console.error('[SellerDrafts] Outlook webhook call failed:', err);
      }
    }

    res.json({
      success: true,
      propertyId: form.propertyId,
      to: email.to,
      subject: email.subject,
      outlookDraftCreated: !!(outlookResult && outlookResult.success),
      outlookDraftId: outlookResult && outlookResult.draftId,
    });
  });

  // ─────────── GET seller-drafts/queue ───────────
  // Returns all listings currently flagged for draft creation, with the
  // formatted email content ready to drop into Mac Mail.
  app.get('/api/listing-form/seller-drafts/queue', (req, res) => {
    if (!requireSecret(req, res)) return;
    try {
      const files = fs.readdirSync(LISTING_FORMS_DIR).filter(f => f.endsWith('.json'));
      const queue = [];
      for (const f of files) {
        try {
          const form = JSON.parse(fs.readFileSync(path.join(LISTING_FORMS_DIR, f), 'utf8'));
          if (!form.sellerEmailDraftQueued) continue;
          const email = buildSellerEmail(form, AGENT_HQ_BASE_URL);
          if (!email.to) continue; // can't draft without a recipient
          queue.push({
            propertyId: form.propertyId,
            to: email.to,
            subject: email.subject,
            body: email.body,
            queuedAt: form.sellerEmailDraftQueuedAt || null,
          });
        } catch { /* skip malformed */ }
      }
      res.json({ success: true, queue });
    } catch (err) {
      console.error('[SellerDrafts] queue read failed:', err);
      res.status(500).json({ success: false, error: String(err.message || err) });
    }
  });

  // ─────────── POST clear-seller-draft-queue ───────────
  // Clears the flag after the skill has successfully created the Mail draft.
  app.post('/api/listing-form/:propertyId/clear-seller-draft-queue', (req, res) => {
    if (!requireSecret(req, res)) return;
    const form = loadForm(req.params.propertyId);
    if (!form) return res.status(404).json({ success: false, error: 'listing_not_found' });

    form.sellerEmailDraftQueued = false;
    form.sellerEmailDraftLoadedAt = new Date().toISOString();
    form.updatedAt = form.sellerEmailDraftLoadedAt;
    saveForm(req.params.propertyId, form);

    console.log(`[SellerDrafts] Cleared draft queue: ${form.propertyId}`);
    res.json({ success: true, propertyId: form.propertyId });
  });
}

// ─────────────── EMAIL TEMPLATE ───────────────
// Mirrors what was previously built inline in ListingForm.jsx. Lifted here so
// both the queue + draft endpoints emit identical content, and so the template
// has one source of truth.
export function buildSellerEmail(form, baseUrl = 'https://hq.jonathanwallace.ca') {
  const sellerName = form.sellerName || 'the seller';
  const firstName = sellerName.split(' ')[0] || 'there';
  const formLink = `${baseUrl}/?seller=${encodeURIComponent(form.propertyId)}`;
  const addr = form.address || 'your home';
  const city = form.city ? `, ${form.city}` : '';

  const subject = `Pre-Listing Questionnaire — ${form.address || 'Your Home'}${city}`;
  const body = `Hi ${firstName},

Thank you for choosing to work with me on the sale of ${addr}${city}.

To make sure I have everything I need to market your home properly, I've put together a quick pre-listing questionnaire that covers the things only you would know — utilities, upgrades, what's included in the sale, and a few details about the systems in the home.

It takes about 10 minutes. Skip any field that doesn't apply (e.g. septic if you're on municipal sewer):
${formLink}

Your answers come straight back to me and help me build an accurate, compelling listing. Any questions, just reply to this email.

Looking forward to getting your home sold!

${AGENT.name}
${AGENT.team}
${AGENT.phone}`;

  return { to: form.sellerEmail || '', subject, body };
}
