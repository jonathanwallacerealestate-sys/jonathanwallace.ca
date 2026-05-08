// lib/routes/seller-form-public.js
//
// PUBLIC seller-facing routes — NO auth required (the propertyId in the URL
// is the access token, just like a calendar invite link).
//
//   GET   /api/seller-form/:propertyId         — fetch property header + current
//                                                 values for whitelisted seller fields
//   POST  /api/seller-form/:propertyId/submit  — merge seller-only fields into the
//                                                 master JSON, set sellerSubmittedAt
//
// Server-side WHITELIST: any field the seller submits that is NOT in
// SELLER_FIELDS is silently dropped. This means a malicious payload can't
// overwrite the listPrice or any of Jonathan's master fields.
//
// Created 2026-05-07 alongside the SellerForm component for the end-to-end
// seller-deployment flow.

import fs from 'fs';
import path from 'path';

// SELLER_FIELDS is duplicated from src/config/listing-form-options.js because
// the backend can't import from the frontend bundle. Keep the two lists in
// sync — adding a field to one means adding it to the other. A simple test
// in next session can assert parity.
const SELLER_FIELDS = new Set([
  'taxes',
  'sellerName', 'sellerPhone', 'sellerEmail',
  'sellerName2', 'sellerPhone2', 'sellerEmail2',
  'electricalAmps', 'electricalType',
  'roofAge',
  'septicLastPumped', 'septicLastInspected', 'septicDetails',
  'furnaceAge', 'furnaceOwnedRented', 'furnaceMonthlyCost',
  'acOwnedRented', 'acMonthlyCost',
  'hotWaterType', 'hotWaterAge', 'hotWaterOwnedRented', 'hotWaterMonthlyCost',
  'rentalItems',
  'hydroProvider', 'propaneProvider', 'gasProvider', 'internetProvider', 'internetType',
  'appliancesIncluded', 'otherInclusions', 'inclusionsNotes',
  'exclusions',
  'visibleUpgrades', 'hiddenUpgrades', 'floorPlanChanges',
]);

/**
 * deps:
 *   LISTING_FORMS_DIR  — absolute path of the per-listing form JSONs root
 *   makeSaveWebhook    — (optional) Make.com webhook URL fired on seller submit
 */
export function register(app, deps) {
  const {
    LISTING_FORMS_DIR,
    // Fired when seller submits — Make.com scenario 'Seller Form Submitted — Notify Jonathan' (5007342)
    // sends Jonathan an Outlook email so he knows the seller filled their portion.
    makeSaveWebhook = 'https://hook.us2.make.com/8pvqs18m22obrtln0vrm2szpe7n6cqvs',
  } = deps;

  // GET /api/seller-form/:propertyId — what the seller sees when they open the link
  app.get('/api/seller-form/:propertyId', (req, res) => {
    const filePath = path.join(LISTING_FORMS_DIR, `${req.params.propertyId}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }
    try {
      const form = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      // Return only what the seller form needs: a header for context + the
      // current values of the whitelisted fields so the seller sees what's
      // already filled (e.g. their name, if Jonathan pre-filled it).
      const sellerView = {};
      for (const f of SELLER_FIELDS) {
        if (form[f] !== undefined) sellerView[f] = form[f];
      }
      res.json({
        success: true,
        header: {
          propertyId: form.propertyId,
          address: form.address || '',
          city: form.city || '',
          postalCode: form.postalCode || '',
        },
        agent: {
          name: 'Jonathan Wallace',
          team: 'Faris Team Real Estate Brokerage',
          phone: '705-433-2525',
          email: 'jonathanwallacerealestate@gmail.com',
        },
        sellerSubmittedAt: form.sellerSubmittedAt || '',
        values: sellerView,
      });
    } catch (err) {
      console.error('[SellerForm] Load error:', err.message);
      res.json({ success: false, error: err.message });
    }
  });

  // POST /api/seller-form/:propertyId/submit — merge seller-only fields
  app.post('/api/seller-form/:propertyId/submit', (req, res) => {
    const filePath = path.join(LISTING_FORMS_DIR, `${req.params.propertyId}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }
    try {
      const form = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const incoming = req.body || {};

      // Whitelist filter — drop anything not in SELLER_FIELDS. This is the
      // entire security model for the public endpoint.
      let writtenCount = 0;
      const writtenFields = [];
      for (const [k, v] of Object.entries(incoming)) {
        if (!SELLER_FIELDS.has(k)) continue;
        form[k] = v;
        writtenCount++;
        writtenFields.push(k);
      }

      form.sellerSubmittedAt = new Date().toISOString();
      form.updatedAt = form.sellerSubmittedAt;

      fs.writeFileSync(filePath, JSON.stringify(form, null, 2));

      // Notify Make.com so Jonathan can wire a Slack/SMS push if he wants
      fetch(makeSaveWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          event: 'seller_form_submitted',
          propertyId: form.propertyId,
          address: form.address,
          sellerName: form.sellerName,
          sellerSubmittedAt: form.sellerSubmittedAt,
          fieldsWritten: writtenCount,
        }),
      }).catch(err => console.log('[SellerForm] Make.com notify (non-critical):', err.message));

      console.log(`[SellerForm] Submitted: ${form.propertyId} — ${writtenCount} field(s) written: ${writtenFields.join(', ')}`);
      res.json({
        success: true,
        propertyId: form.propertyId,
        fieldsWritten: writtenCount,
        sellerSubmittedAt: form.sellerSubmittedAt,
      });
    } catch (err) {
      console.error('[SellerForm] Submit error:', err.message);
      res.json({ success: false, error: err.message });
    }
  });
}

export { SELLER_FIELDS };
