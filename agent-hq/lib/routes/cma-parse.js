// lib/routes/cma-parse.js
//
// PDF upload routes for the CMA tab. Two endpoints:
//
//   POST /api/cma/parse-pdf                  → REALM listing PDF (subject's prior listing
//                                              OR a comparable). Uses regex + Anthropic
//                                              extraction.
//
//   POST /api/cma/parse-geowarehouse-pdf     → GeoWarehouse property report. Pure regex
//                                              parser, no AI needed (the format is stable).
//                                              Pulls PIN, zoning, lot dims, MPAC assessment,
//                                              tax history, sales history, year built,
//                                              beds/baths, water/sewer, ownership type.
//
// Both accept multipart/form-data with field name "file".

import { parseRealmListing, parseRealmListingsMulti, detectMultiListing } from '../parsers/realm-listing.js';

/**
 * deps:
 *   anthropic              — Anthropic SDK client (or null)
 *   pdfParse               — pdf-parse function
 *   pdfUpload              — multer instance (memory storage)
 *   parseGeoWarehouseText  — function from lib/parsers/geowarehouse.js
 *   model                  — (optional) Anthropic model id for REALM AI extraction
 */
export function register(app, deps) {
  const { anthropic, pdfParse, pdfUpload, parseGeoWarehouseText, model } = deps;

  // POST /api/cma/parse-pdf — REALM listing PDF.
  //
  // Handles BOTH:
  //   - single-listing PDF (subject prior listing or one comp) → returns { fields, meta }
  //   - multi-listing PDF (REALM "Print to PDF" of 2+ selected listings) →
  //     returns { listings: [{ fields, meta }, ...], meta: { count: N, ... } }
  //
  // Frontend (CmaPdfDropZone) handles both shapes: one push per listing.
  app.post('/api/cma/parse-pdf', pdfUpload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.json({ ok: false, error: 'No PDF uploaded (expected multipart field "file")' });
    }
    try {
      const pdfData = await pdfParse(req.file.buffer);
      const text = pdfData.text || '';
      if (!text.trim()) {
        return res.json({ ok: false, error: 'PDF had no extractable text — is it a scan? OCR not supported.' });
      }

      // Detect how many listings are in this PDF
      const detected = detectMultiListing(text);
      const isMulti = detected.count > 1;

      if (isMulti) {
        // Multi-listing path — slice the text and parse each slice.
        const results = await parseRealmListingsMulti(text, { anthropic, model });
        const listings = results.map(({ fields, sources }) => {
          const filledCount = Object.values(fields).filter(v => v != null && v !== '').length;
          return {
            fields,
            meta: {
              filledFields: filledCount,
              totalFields: Object.keys(fields).length,
              aiUsed: !!sources.ai,
              mlsId: fields.mlsId || null,
              source: 'realm-listing',
            },
          };
        });
        return res.json({
          ok: true,
          // Multi-listing response shape
          listings,
          meta: {
            filename: req.file.originalname,
            bytes: req.file.size,
            textLength: text.length,
            numPages: pdfData.numpages,
            count: listings.length,
            detectedCount: detected.count,
            source: 'realm-listing-multi',
          },
        });
      }

      // Single-listing path — original behavior.
      const { fields, sources } = await parseRealmListing(text, { anthropic, model });
      const filledCount = Object.values(fields).filter(v => v != null && v !== '').length;
      const totalCount = Object.keys(fields).length;

      res.json({
        ok: true,
        fields,
        meta: {
          filename: req.file.originalname,
          bytes: req.file.size,
          textLength: text.length,
          numPages: pdfData.numpages,
          filledFields: filledCount,
          totalFields: totalCount,
          aiUsed: !!sources.ai,
          source: 'realm-listing',
        },
      });
    } catch (err) {
      console.error('[CMA parse-pdf] error:', err.message);
      res.json({ ok: false, error: err.message });
    }
  });

  // POST /api/cma/parse-geowarehouse-pdf — GeoWarehouse property report
  app.post('/api/cma/parse-geowarehouse-pdf', pdfUpload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.json({ ok: false, error: 'No PDF uploaded (expected multipart field "file")' });
    }
    if (!parseGeoWarehouseText) {
      return res.json({ ok: false, error: 'GeoWarehouse parser not wired (server config error)' });
    }
    try {
      const pdfData = await pdfParse(req.file.buffer);
      const text = pdfData.text || '';
      if (!text.trim()) {
        return res.json({ ok: false, error: 'PDF had no extractable text.' });
      }

      // Sanity check: does this look like a GeoWarehouse report?
      const looksLikeGeo = /geowarehouse|teranet|property report|PIN\s+\d{9}|MPAC|Assessment Roll/i.test(text);

      const fields = parseGeoWarehouseText(text);
      const filledCount = Object.values(fields).filter(v => v != null && v !== '' && (typeof v !== 'object' || (Array.isArray(v) && v.length))).length;

      res.json({
        ok: true,
        fields,
        meta: {
          filename: req.file.originalname,
          bytes: req.file.size,
          textLength: text.length,
          numPages: pdfData.numpages,
          filledFields: filledCount,
          looksLikeGeoWarehouse: looksLikeGeo,
          warning: looksLikeGeo ? null : 'This does not appear to be a GeoWarehouse report — parsed fields may be incomplete.',
          source: 'geowarehouse',
        },
      });
    } catch (err) {
      console.error('[CMA parse-geowarehouse-pdf] error:', err.message);
      res.json({ ok: false, error: err.message });
    }
  });
}
