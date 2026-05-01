// lib/routes/cma-parse.js
//
// PDF upload route for the CMA tab — accepts a REALM listing PDF, runs
// pdf-parse + Anthropic extraction, returns structured fields the React
// intake form can merge into its state.
//
//   POST /api/cma/parse-pdf  (multipart/form-data, field name "file")
//
// The field name "file" matches the existing photo upload pattern so the
// React drop-zone in the CMA modal can use the same FormData shape.

import { parseRealmListing } from '../parsers/realm-listing.js';

/**
 * deps:
 *   anthropic   — Anthropic SDK client (or null)
 *   pdfParse    — pdf-parse function (the legacy CJS one already imported in server.js)
 *   pdfUpload   — multer instance (memory storage)
 *   model       — (optional) Anthropic model id
 */
export function register(app, deps) {
  const { anthropic, pdfParse, pdfUpload, model } = deps;

  app.post('/api/cma/parse-pdf', pdfUpload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.json({ ok: false, error: 'No PDF uploaded (expected multipart field "file")' });
    }
    try {
      // 1. Extract text from the PDF
      const pdfData = await pdfParse(req.file.buffer);
      const text = pdfData.text || '';
      if (!text.trim()) {
        return res.json({ ok: false, error: 'PDF had no extractable text — is it a scan? OCR not supported in Phase 1.' });
      }

      // 2. Parse to structured fields (regex + AI merge)
      const { fields, sources } = await parseRealmListing(text, { anthropic, model });

      // Quick health summary so the UI can show the user what landed
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
        },
      });
    } catch (err) {
      console.error('[CMA parse-pdf] error:', err.message);
      res.json({ ok: false, error: err.message });
    }
  });
}
