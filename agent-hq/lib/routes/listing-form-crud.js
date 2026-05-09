// lib/routes/listing-form-crud.js
//
// CRUD routes for listing-form records:
//   GET    /api/listing-form/list                  — list saved forms (excludes closed by default)
//   GET    /api/listing-form/load/:propertyId      — load one form
//   POST   /api/listing-form/save                  — save (creates or updates)
//   DELETE /api/listing-form/:propertyId           — hard delete
//   POST   /api/listing-form/:propertyId/close     — archive + downstream sync (FUB stage→Past Client)
//
// Extracted from server.js 2026-04-24 — verbatim behavior, register-pattern wrapping.

import fs from 'fs';
import path from 'path';
import * as listingSync from '../listing-sync/index.js';

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

/**
 * deps:
 *   LISTING_FORMS_DIR  — absolute path of the per-listing form JSONs root
 *   FUB_API_KEY        — Follow Up Boss API key (passed to listing-sync)
 *   FUB_BASE           — FUB base URL
 *   fubHeaders         — () => HTTP headers for FUB calls
 *   makeSaveWebhook    — (optional) Make.com webhook URL fired on save; falls back to the existing default
 */
export function register(app, deps) {
  const {
    LISTING_FORMS_DIR,
    FUB_API_KEY, FUB_BASE, fubHeaders,
    makeSaveWebhook = 'https://hook.us2.make.com/95nk30o9mrpff5rfrz31l1tnxgf3ydf7',
  } = deps;

  // GET /api/listing-form/list — exclude closed by default
  app.get('/api/listing-form/list', (req, res) => {
    try {
      const includeClosed = req.query.includeClosed === '1' || req.query.includeClosed === 'true';
      const files = fs.readdirSync(LISTING_FORMS_DIR).filter(f => f.endsWith('.json'));
      const listings = files.map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(LISTING_FORMS_DIR, f), 'utf8'));
          return {
            propertyId: data.propertyId,
            address: data.address || '',
            city: data.city || '',
            sellerName: data.sellerName || '',
            sellerEmail: data.sellerEmail || '',
            listPrice: data.listPrice || '',
            status: data.status || 'draft',
            closedAt: data.closedAt || '',
            updatedAt: data.updatedAt || data.createdAt || '',
            createdAt: data.createdAt || '',
            sellerSubmittedAt: data.sellerSubmittedAt || '',
            signingStatus: data.signingStatus || '',
            signingStartedAt: data.signingStartedAt || '',
            signedAt: data.signedAt || '',
            docusignEnvelopeUrl: data.docusignEnvelopeUrl || '',
          };
        } catch { return null; }
      }).filter(Boolean)
        .filter(l => includeClosed || l.status !== 'closed')
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      res.json({ success: true, listings });
    } catch (err) {
      console.error('[ListingForm] List error:', err.message);
      res.json({ success: false, error: err.message, listings: [] });
    }
  });

  // GET /api/listing-form/load/:propertyId
  app.get('/api/listing-form/load/:propertyId', (req, res) => {
    const filePath = path.join(LISTING_FORMS_DIR, `${req.params.propertyId}.json`);
    if (!fs.existsSync(filePath)) {
      return res.json({ success: false, error: 'Not found' });
    }
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      res.json({ success: true, data });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // POST /api/listing-form/save — creates or updates
  app.post('/api/listing-form/save', (req, res) => {
    try {
      const data = req.body;
      if (!data.propertyId) {
        if (!data.address) return res.json({ success: false, error: 'Address or propertyId required' });
        data.propertyId = slugify(`${data.address} ${data.city || 'midland'}`);
      }
      if (!data.createdAt) data.createdAt = new Date().toISOString();
      data.updatedAt = new Date().toISOString();

      const filePath = path.join(LISTING_FORMS_DIR, `${data.propertyId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

      // Make.com webhook (non-blocking)
      fetch(makeSaveWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(data),
      }).catch(err => console.log('[ListingForm] Make.com sync (non-critical):', err.message));

      // Fan out to registered listing-sync destinations (FUB contact, future REALM, etc.)
      listingSync.syncOnSave(data, {
        fubApiKey: FUB_API_KEY, fubBase: FUB_BASE, fubHeaders, logger: console,
      }).catch(err => console.log('[ListingForm] listing-sync syncOnSave error:', err.message));

      console.log(`[ListingForm] Saved: ${data.propertyId} (${data.address})`);
      res.json({ success: true, propertyId: data.propertyId });
    } catch (err) {
      console.error('[ListingForm] Save error:', err.message);
      res.json({ success: false, error: err.message });
    }
  });

  // DELETE /api/listing-form/:propertyId — hard delete
  app.delete('/api/listing-form/:propertyId', (req, res) => {
    const filePath = path.join(LISTING_FORMS_DIR, `${req.params.propertyId}.json`);
    if (!fs.existsSync(filePath)) return res.json({ success: false, error: 'Not found' });
    try {
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // POST /api/listing-form/:propertyId/close — archive + downstream sync
  app.post('/api/listing-form/:propertyId/close', async (req, res) => {
    const filePath = path.join(LISTING_FORMS_DIR, `${req.params.propertyId}.json`);
    if (!fs.existsSync(filePath)) return res.json({ success: false, error: 'Not found' });
    try {
      const form = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      form.status = 'closed';
      form.closedAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(form, null, 2));

      const syncResults = await listingSync.syncOnClose(form, {
        fubApiKey: FUB_API_KEY, fubBase: FUB_BASE, fubHeaders, logger: console,
      });

      console.log(`[ListingForm] Closed: ${form.propertyId} (${form.address}) sync=${JSON.stringify(syncResults)}`);
      res.json({ success: true, propertyId: form.propertyId, sync: syncResults });
    } catch (err) {
      console.error('[ListingForm] Close error:', err.message);
      res.json({ success: false, error: err.message });
    }
  });
}

export { slugify };
