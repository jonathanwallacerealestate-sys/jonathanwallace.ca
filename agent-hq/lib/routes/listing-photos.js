// lib/routes/listing-photos.js
//
// All HTTP routes for listing-form photos:
//   POST   /api/listing-form/:id/photos                      — upload 1..N images
//   GET    /api/listing-form/:id/photos                      — list filenames + sizes
//   GET    /api/listing-form/:id/photos/:filename            — serve a single image
//   DELETE /api/listing-form/:id/photos/:filename            — delete a single image
//   POST   /api/listing-form/:id/photos/extract              — vision-extract suggestions
//   POST   /api/listing-form/:id/photos/suggestions/reject   — log a rejection
//
// Extracted from server.js 2026-04-24 — verbatim behavior, register-pattern wrapping.

import fs from 'fs';
import path from 'path';
import * as photoVision from '../photo-vision/index.js';

function listingPhotosDirFor(LISTING_PHOTOS_DIR, propertyId) {
  const safeId = String(propertyId).replace(/[^A-Za-z0-9_\-]/g, '-').slice(0, 120);
  const dir = path.join(LISTING_PHOTOS_DIR, safeId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safePhotoFilename(original) {
  const base = String(original || 'photo.jpg').split(/[\\/]/).pop();
  const cleaned = base.replace(/[^A-Za-z0-9_.\-]/g, '_').slice(0, 120);
  return cleaned || 'photo.jpg';
}

function uniqueFilename(dir, desired) {
  let name = desired;
  let i = 1;
  while (fs.existsSync(path.join(dir, name))) {
    const dot = desired.lastIndexOf('.');
    const stem = dot >= 0 ? desired.slice(0, dot) : desired;
    const ext  = dot >= 0 ? desired.slice(dot) : '';
    name = `${stem}-${i}${ext}`;
    i += 1;
  }
  return name;
}

/**
 * Register all listing-photo routes on the given Express app.
 *
 * deps:
 *   LISTING_PHOTOS_DIR  — absolute path of the per-listing photos root
 *   LISTING_FORMS_DIR   — absolute path of the per-listing form JSONs (for context lookup)
 *   photoUpload         — multer instance configured for photos
 *   anthropic           — Anthropic SDK client (for vision extract)
 */
export function register(app, deps) {
  const { LISTING_PHOTOS_DIR, LISTING_FORMS_DIR, photoUpload, anthropic } = deps;
  const dirFor = (id) => listingPhotosDirFor(LISTING_PHOTOS_DIR, id);

  // POST /api/listing-form/:id/photos — upload 1..N images
  app.post('/api/listing-form/:id/photos', photoUpload.array('photos', 60), (req, res) => {
    const propertyId = req.params.id;
    if (!propertyId) return res.json({ success: false, error: 'propertyId required' });
    const dir = dirFor(propertyId);
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) return res.json({ success: false, error: 'no files provided (field name: photos)' });
    const stored = [];
    for (const f of files) {
      try {
        const name = uniqueFilename(dir, safePhotoFilename(f.originalname));
        fs.writeFileSync(path.join(dir, name), f.buffer);
        stored.push({ filename: name, size: f.size, contentType: f.mimetype });
      } catch (err) {
        console.error(`[ListingForm] photo upload ${f.originalname} failed: ${err.message}`);
      }
    }
    console.log(`[ListingForm] Photos uploaded to ${propertyId}: ${stored.length} file(s)`);
    res.json({ success: true, stored });
  });

  // GET /api/listing-form/:id/photos — list filenames + sizes
  app.get('/api/listing-form/:id/photos', (req, res) => {
    const dir = dirFor(req.params.id);
    try {
      const files = fs.readdirSync(dir)
        .filter(f => /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f))
        .map(f => {
          const st = fs.statSync(path.join(dir, f));
          return { filename: f, size: st.size, uploadedAt: st.mtime.toISOString() };
        })
        .sort((a, b) => a.filename.localeCompare(b.filename));
      const extractPath = path.join(dir, '.extract-results.json');
      let extract = null;
      if (fs.existsSync(extractPath)) {
        try { extract = JSON.parse(fs.readFileSync(extractPath, 'utf8')); } catch {}
      }
      res.json({ success: true, photos: files, extract });
    } catch (err) {
      res.json({ success: false, error: err.message, photos: [] });
    }
  });

  // GET /api/listing-form/:id/photos/:filename — serve a single image
  app.get('/api/listing-form/:id/photos/:filename', (req, res) => {
    const dir = dirFor(req.params.id);
    const name = safePhotoFilename(req.params.filename);
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) return res.status(404).send('not found');
    res.sendFile(full);
  });

  // DELETE /api/listing-form/:id/photos/:filename
  app.delete('/api/listing-form/:id/photos/:filename', (req, res) => {
    const dir = dirFor(req.params.id);
    const name = safePhotoFilename(req.params.filename);
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) return res.json({ success: false, error: 'not found' });
    try { fs.unlinkSync(full); res.json({ success: true }); }
    catch (err) { res.json({ success: false, error: err.message }); }
  });

  // POST /api/listing-form/:id/photos/extract — run vision on every photo
  // attached to this listing and return aggregated suggestions.
  app.post('/api/listing-form/:id/photos/extract', async (req, res) => {
    if (!anthropic) return res.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' });
    const propertyId = req.params.id;
    const dir = dirFor(propertyId);
    const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f));
    if (files.length === 0) return res.json({ success: false, error: 'no photos attached to this listing' });

    // Pull the listing for address context (nicer prompts, better descriptive copy).
    let listingCtx = {};
    try {
      const formPath = path.join(LISTING_FORMS_DIR, `${propertyId}.json`);
      if (fs.existsSync(formPath)) {
        const form = JSON.parse(fs.readFileSync(formPath, 'utf8'));
        listingCtx = { address: form.address, city: form.city };
      }
    } catch {}

    console.log(`[photo-vision] Extracting from ${files.length} photo(s) for ${propertyId}`);
    const started = Date.now();

    // Pre-read all buffers once; we need them for both per-photo analysis AND
    // the room-clustering second pass.
    const buffersByFilename = new Map();
    for (const f of files) {
      try { buffersByFilename.set(f, fs.readFileSync(path.join(dir, f))); } catch {}
    }

    // Limit concurrency so we don't hit API rate limits on big photo sets.
    const CONCURRENCY = 4;
    const results = [];
    let idx = 0;
    async function worker() {
      while (idx < files.length) {
        const myIdx = idx++;
        const filename = files[myIdx];
        try {
          const buf = buffersByFilename.get(filename);
          const r = await photoVision.analyzePhoto(buf, {
            anthropic, filename, address: listingCtx.address, city: listingCtx.city, logger: console,
          });
          results[myIdx] = r;
        } catch (err) {
          results[myIdx] = { ok: false, filename, error: err.message };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker()));

    // Second pass: cluster multi-photo room types into unique rooms.
    let clusteredRooms = [];
    try {
      clusteredRooms = await photoVision.clusterAllRooms(results, buffersByFilename, {
        anthropic, logger: console,
      });
    } catch (err) {
      console.warn(`[photo-vision] clusterAllRooms error: ${err.message}`);
    }

    const merged = photoVision.mergeResults(results, clusteredRooms);
    merged.extractedAt = new Date().toISOString();
    merged.elapsedMs = Date.now() - started;

    try {
      fs.writeFileSync(path.join(dir, '.extract-results.json'), JSON.stringify(merged, null, 2));
    } catch {}

    console.log(`[photo-vision] Done ${propertyId} in ${merged.elapsedMs}ms — ${merged.analyzed} ok / ${merged.failed} failed — ${merged.suggestions.length} suggestion(s)`);
    res.json({ success: true, ...merged });
  });

  // POST /api/listing-form/:id/photos/suggestions/reject — log a rejection for
  // future prompt tuning. Stores simply so we can build a few-shot block later.
  app.post('/api/listing-form/:id/photos/suggestions/reject', (req, res) => {
    const dir = dirFor(req.params.id);
    const { field, suggestedValue, correctedValue, evidence } = req.body || {};
    if (!field) return res.json({ success: false, error: 'field required' });
    const logPath = path.join(dir, '.extract-rejections.jsonl');
    const line = JSON.stringify({
      at: new Date().toISOString(), field, suggestedValue, correctedValue: correctedValue || null, evidence: evidence || [],
    }) + '\n';
    try { fs.appendFileSync(logPath, line); res.json({ success: true }); }
    catch (err) { res.json({ success: false, error: err.message }); }
  });
}
