/**
 * Business Tools catalog — Jonathan's Chrome bookmarks turned into a
 * structured list of every site he uses for work. Each tool can be
 * one-click promoted to a credential entry or a Claude Chrome workflow.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const Anthropic = require('@anthropic-ai/sdk');
const { requireApiKey } = require('../middleware/apiKey');
const { parseBookmarksHtml, parseUrlList } = require('../services/bookmarkParser');
const intuition = require('../services/intuition');

const anthropic = new Anthropic();

router.use(requireApiKey);

// GET /api/tools — list all tools, grouped by folder for the UI
router.get('/', async (req, res) => {
  try {
    const includeArchived = req.query.archived === 'true';
    const where = includeArchived ? '' : 'WHERE archived = FALSE';
    const { rows } = await pool.query(
      `SELECT t.*, c.username AS credential_username,
              CASE WHEN c.password_ciphertext IS NULL THEN false ELSE true END AS credential_has_password
         FROM business_tools t
         LEFT JOIN site_credentials c ON c.name = t.credential_name
         ${where}
         ORDER BY t.folder_path NULLS FIRST, t.name ASC`
    );
    // Group for the UI
    const groups = {};
    for (const r of rows) {
      const key = r.folder_path || '/';
      (groups[key] = groups[key] || []).push(r);
    }
    res.json({
      tools: rows,
      count: rows.length,
      groups: Object.entries(groups).map(([folder, items]) => ({ folder, items }))
    });
  } catch (err) {
    console.error('tools list error:', err);
    res.status(500).json({ error: 'Failed to list tools' });
  }
});

// POST /api/tools — create or upsert a single tool
router.post('/', async (req, res) => {
  try {
    const { name, url, folder_path, favicon_url, description, tags, credential_name } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const cleanName = name || extractName(url);
    const { rows } = await pool.query(
      `INSERT INTO business_tools (name, url, folder_path, favicon_url, description, tags, credential_name, source)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6,'[]')::jsonb, $7, COALESCE($8,'manual'))
       ON CONFLICT (url) DO UPDATE SET
         name = EXCLUDED.name,
         folder_path = COALESCE(EXCLUDED.folder_path, business_tools.folder_path),
         favicon_url = COALESCE(EXCLUDED.favicon_url, business_tools.favicon_url),
         description = COALESCE(EXCLUDED.description, business_tools.description),
         tags = EXCLUDED.tags,
         credential_name = COALESCE(EXCLUDED.credential_name, business_tools.credential_name),
         last_seen_at = NOW(),
         updated_at = NOW(),
         archived = FALSE
       RETURNING *`,
      [cleanName, url, folder_path || null, favicon_url || null, description || null,
       tags ? JSON.stringify(tags) : null, credential_name || null, req.body.source || null]
    );
    res.status(201).json({ tool: rows[0] });
  } catch (err) {
    console.error('tools upsert error:', err);
    res.status(500).json({ error: 'Failed to save tool' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['name','url','folder_path','favicon_url','description','tags','credential_name','archived'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) {
        sets.push(`${f} = $${idx++}`);
        params.push(f === 'tags' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE business_tools SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ tool: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update tool' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM business_tools WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) { res.status(500).json({ error: 'Failed to delete' }); }
});

/**
 * POST /api/tools/import
 * Body: { html?, urls?, folderFilter? }
 *  - html: raw Chrome "Export bookmarks" HTML
 *  - urls: plain-text URL list (one per line, MD links / TSV / "name - url" all OK)
 *  - folderFilter: case-insensitive substring; only bookmarks whose folder
 *    path includes the filter are imported (e.g. "business")
 */
router.post('/import', async (req, res) => {
  try {
    const { html, urls, folderFilter } = req.body || {};
    if (!html && !urls) return res.status(400).json({ error: 'Provide html or urls' });

    let items = [];
    if (html) items = items.concat(parseBookmarksHtml(html, { folderFilter }));
    if (urls) items = items.concat(parseUrlList(urls, { folder: req.body.defaultFolder || '/Imported' }));

    let inserted = 0, updated = 0;
    for (const it of items) {
      try {
        const r = await pool.query(
          `INSERT INTO business_tools (name, url, folder_path, favicon_url, source, last_seen_at)
           VALUES ($1,$2,$3,$4,'bookmarks_import', NOW())
           ON CONFLICT (url) DO UPDATE SET
             name = EXCLUDED.name,
             folder_path = EXCLUDED.folder_path,
             favicon_url = COALESCE(EXCLUDED.favicon_url, business_tools.favicon_url),
             last_seen_at = NOW(),
             archived = FALSE
           RETURNING xmax`,
          [it.name, it.url, it.folder_path || null, it.favicon_url || null]
        );
        // xmax = 0 means a fresh insert; non-zero means an update
        if (r.rows[0] && Number(r.rows[0].xmax) === 0) inserted++;
        else updated++;
      } catch (e) {
        // Skip bad rows but keep going
        console.warn('tool import skip:', it.url, e.message);
      }
    }
    res.json({ success: true, parsed: items.length, inserted, updated });
  } catch (err) {
    console.error('tools import error:', err);
    res.status(500).json({ error: 'Import failed', message: err.message });
  }
});

/**
 * POST /api/tools/:id/make-credential
 * One-click: create a site_credentials placeholder for this tool, link it.
 * Body may include: name (slug override), username, password.
 */
router.post('/:id/make-credential', async (req, res) => {
  try {
    const { rows: tools } = await pool.query('SELECT * FROM business_tools WHERE id = $1', [req.params.id]);
    if (!tools.length) return res.status(404).json({ error: 'Tool not found' });
    const t = tools[0];

    const slug = (req.body.name || slugify(t.name)).slice(0, 100);
    const vault = require('../services/cryptoVault');
    const cipher = req.body.password ? vault.encrypt(req.body.password) : null;

    await pool.query(
      `INSERT INTO site_credentials (name, site, url, username, password_ciphertext, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (name) DO UPDATE SET
         site = EXCLUDED.site,
         url = COALESCE(EXCLUDED.url, site_credentials.url),
         username = COALESCE(EXCLUDED.username, site_credentials.username),
         password_ciphertext = COALESCE(EXCLUDED.password_ciphertext, site_credentials.password_ciphertext),
         notes = COALESCE(EXCLUDED.notes, site_credentials.notes),
         updated_at = NOW()`,
      [slug, t.name, t.url, req.body.username || null, cipher,
       req.body.notes || `Auto-created from Business Tools entry: ${t.name}`]
    );
    await pool.query('UPDATE business_tools SET credential_name = $1, updated_at = NOW() WHERE id = $2', [slug, t.id]);

    const { rows } = await pool.query(
      `SELECT t.*, c.username AS credential_username
         FROM business_tools t LEFT JOIN site_credentials c ON c.name = t.credential_name
         WHERE t.id = $1`, [t.id]
    );
    res.json({ tool: rows[0], credential_name: slug });
  } catch (err) {
    console.error('tools make-credential error:', err);
    res.status(500).json({ error: 'Failed to create credential' });
  }
});

/**
 * POST /api/tools/:id/make-workflow
 * Asks Claude to draft a starter Chrome workflow (3-6 plain-English steps)
 * for this tool, then inserts it. Workflow is linked to the tool's
 * credential if one exists.
 */
router.post('/:id/make-workflow', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Claude not configured' });
    }
    const { rows: tools } = await pool.query('SELECT * FROM business_tools WHERE id = $1', [req.params.id]);
    if (!tools.length) return res.status(404).json({ error: 'Tool not found' });
    const t = tools[0];

    const goal = req.body.goal || `the most common task Jonathan would automate on ${t.name}`;
    const ctx = await intuition.buildContextBlock();

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 700,
      system: `You are designing a Claude Chrome workflow for Jonathan Wallace, a real estate
agent in Southern Georgian Bay (Midland / Penetanguishene / Tiny / Tay /
Wasaga Beach). The workflow will be executed by Claude Chrome — a browser
extension that follows plain-English steps inside a Chrome tab.

Return JSON ONLY, no commentary. Schema:
{
  "name": "<short name>",
  "description": "<one sentence>",
  "steps": ["step 1", "step 2", "..."],
  "expected_output": "<what Claude should report back>"
}

Rules:
- 3-6 steps. Each step is a single concrete action ("click X", "filter by Y",
  "open the report", "download the CSV", "summarize the result").
- If the tool requires login, the first step is always "Log in with the
  credential provided." (the runner injects the password).
- Steps reference real UI elements only when you can be confident they
  exist on the named tool; otherwise speak in plain English about the goal.
- expected_output is what Jonathan should see after the workflow runs.${ctx ? '\n\n' + ctx : ''}`,
      messages: [{ role: 'user', content: `Tool name: ${t.name}\nURL: ${t.url}\nFolder: ${t.folder_path || '/'}\nGoal: ${goal}\n\nDraft the workflow JSON.` }]
    });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (e) {
      return res.status(500).json({ error: 'Could not parse workflow JSON', raw: text });
    }

    const name = parsed.name || `${t.name} — quick task`;
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];

    const wf = await pool.query(
      `INSERT INTO chrome_workflows (name, description, target_url, credential_name, steps, expected_output, tags)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6, COALESCE($7,'[]')::jsonb)
       ON CONFLICT (name) DO UPDATE SET
         description = EXCLUDED.description,
         target_url = EXCLUDED.target_url,
         credential_name = EXCLUDED.credential_name,
         steps = EXCLUDED.steps,
         expected_output = EXCLUDED.expected_output,
         updated_at = NOW()
       RETURNING *`,
      [name, parsed.description || null, t.url, t.credential_name || null,
       JSON.stringify(steps), parsed.expected_output || null,
       JSON.stringify(['from-bookmark', t.folder_path || ''])]
    );

    // Track the workflow id on the tool's external_workflow_ids array
    await pool.query(
      `UPDATE business_tools SET
         external_workflow_ids = COALESCE(external_workflow_ids,'[]'::jsonb) ||
            jsonb_build_array($1),
         updated_at = NOW()
       WHERE id = $2`,
      [wf.rows[0].id, t.id]
    );

    res.json({ workflow: wf.rows[0], tokens: response.usage });
  } catch (err) {
    console.error('tools make-workflow error:', err);
    res.status(500).json({ error: 'Failed to draft workflow', message: err.message });
  }
});

function extractName(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (e) { return url.slice(0, 60); }
}
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '').slice(0, 60) || 'tool';
}

module.exports = router;
