// lib/routes/in-person-signing.js
//
// In-person signing pipeline (Stages 10-12 of the listing pipeline).
//
// Flow:
//   1. Jonathan clicks "Start In-Person Signing" on the Listing Form
//   2. Agent HQ POSTs to a Make.com webhook with the property data
//   3. Make.com creates a DocuSign envelope from the RECO + MLS templates,
//      pre-fills fields, sends to in-person signer (Jonathan)
//   4. After the envelope completes, Make.com saves the signed PDFs to a
//      property-specific Drive folder, then POSTs back here to /signing-complete
//   5. Agent HQ updates the listing's signingStatus + signed PDF URLs
//
// Created 2026-05-07.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

// Make.com webhook URL — this is the inbound webhook that triggers the
// "Start In-Person Signing" scenario. Set via env var MAKE_SIGNING_WEBHOOK
// after the Make.com scenario is created (it auto-generates a unique URL).
const DEFAULT_SIGNING_WEBHOOK = process.env.MAKE_SIGNING_WEBHOOK || '';

export function register(app, deps) {
  const { LISTING_FORMS_DIR, LOG_DIR } = deps;

  // ─────── helper ───────
  function loadForm(propertyId) {
    const p = path.join(LISTING_FORMS_DIR, `${propertyId}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  function saveForm(propertyId, form) {
    const p = path.join(LISTING_FORMS_DIR, `${propertyId}.json`);
    fs.writeFileSync(p, JSON.stringify(form, null, 2));
  }
  function requireSecret(req, res) {
    const provided = req.header('x-intake-secret');
    const expected = process.env.FARIS_INTAKE_SECRET;
    if (!expected || !provided || provided !== expected) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  }

  // ─────── POST /api/listing-form/:propertyId/start-signing ───────
  // Called by the "Start In-Person Signing" button. Forwards property data
  // to Make.com which creates the DocuSign envelope and returns its URL.
  app.post('/api/listing-form/:propertyId/start-signing', async (req, res) => {
    const form = loadForm(req.params.propertyId);
    if (!form) return res.status(404).json({ success: false, error: 'listing_not_found' });
    if (!form.sellerEmail) {
      return res.status(400).json({
        success: false,
        error: 'missing_seller_email',
        detail: 'Add seller email to the listing before starting the signing session.',
      });
    }

    const webhookUrl = DEFAULT_SIGNING_WEBHOOK;
    if (!webhookUrl) {
      return res.status(500).json({
        success: false,
        error: 'webhook_not_configured',
        detail: 'Set MAKE_SIGNING_WEBHOOK in Railway env after creating the Make.com scenario.',
      });
    }

    const payload = {
      propertyId: form.propertyId,
      address: form.address,
      city: form.city || '',
      postalCode: form.postalCode || '',
      sellerName: form.sellerName,
      sellerFirstName: (form.sellerName || '').split(/\s+/)[0] || '',
      sellerLastName: (form.sellerName || '').split(/\s+/).slice(1).join(' '),
      sellerEmail: form.sellerEmail,
      sellerPhone: form.sellerPhone || '',
      sellerName2: form.sellerName2 || '',
      sellerEmail2: form.sellerEmail2 || '',
      sellerPhone2: form.sellerPhone2 || '',
      listPrice: form.listPrice || '',
      taxes: form.taxes || '',
      taxYear: form.taxYear || '',
      yearBuilt: form.yearBuilt || '',
      pin: form.pin || '',
      legalDescription: form.legalDescription || '',
      sisuTransactionUrl: form.sisuTransactionUrl || '',
      agent: {
        name: 'Jonathan Wallace',
        team: 'Faris Team Real Estate Brokerage',
        email: 'jonathanwallace@rogers.com',
        phone: '705-433-2525',
      },
    };

    try {
      const fwd = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const fwdText = await fwd.text();
      let fwdJson = null;
      try { fwdJson = JSON.parse(fwdText); } catch { /* not json */ }

      // Update listing state
      form.signingStatus = 'in_progress';
      form.signingStartedAt = new Date().toISOString();
      if (fwdJson && fwdJson.envelopeId) form.docusignEnvelopeId = fwdJson.envelopeId;
      if (fwdJson && fwdJson.envelopeUrl) form.docusignEnvelopeUrl = fwdJson.envelopeUrl;
      form.updatedAt = form.signingStartedAt;
      saveForm(req.params.propertyId, form);

      console.log(`[InPersonSigning] start-signing fired for ${form.propertyId} → Make.com (${fwd.status})`);
      return res.json({
        success: true,
        propertyId: form.propertyId,
        envelopeUrl: fwdJson && fwdJson.envelopeUrl,
        envelopeId: fwdJson && fwdJson.envelopeId,
        makeStatus: fwd.status,
        makeResponse: fwdJson || fwdText.slice(0, 200),
      });
    } catch (err) {
      console.error('[InPersonSigning] start-signing failed:', err);
      return res.status(502).json({
        success: false,
        error: 'webhook_call_failed',
        detail: String(err && err.message || err),
      });
    }
  });

  // ─────── POST /api/listing-form/:propertyId/signing-complete ───────
  // Called by Make.com after DocuSign envelope-completed webhook fires.
  // Records the signed PDF Drive URLs on the listing.
  app.post('/api/listing-form/:propertyId/signing-complete', async (req, res) => {
    if (!requireSecret(req, res)) return;
    const form = loadForm(req.params.propertyId);
    if (!form) return res.status(404).json({ success: false, error: 'listing_not_found' });

    const { envelopeId, recoSignedPdfUrl, mlsSignedPdfUrl, signedAt, signedPdfUrls } = req.body || {};

    form.signingStatus = 'complete';
    form.signedAt = signedAt || new Date().toISOString();
    if (envelopeId) form.docusignEnvelopeId = envelopeId;
    if (recoSignedPdfUrl) form.recoSignedPdfUrl = recoSignedPdfUrl;
    if (mlsSignedPdfUrl) form.mlsSignedPdfUrl = mlsSignedPdfUrl;
    if (Array.isArray(signedPdfUrls)) form.signedPdfUrls = signedPdfUrls;
    form.updatedAt = form.signedAt;
    saveForm(req.params.propertyId, form);

    await appendLog(LOG_DIR, {
      ts: new Date().toISOString(),
      action: 'signing_complete',
      propertyId: form.propertyId,
      envelopeId,
      recoSignedPdfUrl,
      mlsSignedPdfUrl,
    });

    console.log(`[InPersonSigning] signing-complete: ${form.propertyId} envelope=${envelopeId}`);
    return res.json({ success: true, propertyId: form.propertyId });
  });

  // ─────── POST /api/listing-form/:propertyId/cancel-signing ───────
  // Resets the signing state — used when an in-person signing session was
  // started accidentally or is otherwise stuck.
  app.post('/api/listing-form/:propertyId/cancel-signing', (req, res) => {
    const form = loadForm(req.params.propertyId);
    if (!form) return res.status(404).json({ success: false, error: 'listing_not_found' });
    form.signingStatus = '';
    form.signingStartedAt = '';
    form.docusignEnvelopeId = '';
    form.docusignEnvelopeUrl = '';
    form.updatedAt = new Date().toISOString();
    saveForm(req.params.propertyId, form);
    console.log(`[InPersonSigning] cancel-signing: ${form.propertyId}`);
    return res.json({ success: true, propertyId: form.propertyId });
  });

  // ─────── GET /api/listing-form/:propertyId/signing-status ───────
  // Polled by the frontend to know when signing completes (so the UI can
  // flip from "in progress" to "complete").
  app.get('/api/listing-form/:propertyId/signing-status', (req, res) => {
    const form = loadForm(req.params.propertyId);
    if (!form) return res.status(404).json({ success: false, error: 'listing_not_found' });
    return res.json({
      success: true,
      propertyId: form.propertyId,
      signingStatus: form.signingStatus || 'not_started',
      signingStartedAt: form.signingStartedAt || null,
      signedAt: form.signedAt || null,
      docusignEnvelopeId: form.docusignEnvelopeId || null,
      docusignEnvelopeUrl: form.docusignEnvelopeUrl || null,
      recoSignedPdfUrl: form.recoSignedPdfUrl || null,
      mlsSignedPdfUrl: form.mlsSignedPdfUrl || null,
      signedPdfUrls: form.signedPdfUrls || [],
    });
  });
}

async function appendLog(LOG_DIR, entry) {
  try {
    const dir = LOG_DIR || '/tmp';
    if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'in-person-signing.log');
    await fsp.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('[InPersonSigning] log write failed:', err);
  }
}
