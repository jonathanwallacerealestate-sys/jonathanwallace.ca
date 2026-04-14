/**
 * Claude Chrome credentials + workflow framework.
 *
 * Stores encrypted site credentials and named multi-step workflows.
 * The /run endpoint assembles a ready-to-paste Claude Chrome prompt that
 * includes the decrypted password so Claude can log in and execute steps
 * inside a Chrome tab for sites without APIs (e.g. legacy MLS portals).
 *
 * The reveal endpoint is behind API key AND requires a user confirmation
 * flag so credentials aren't echoed back on every routine GET.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');
const vault = require('../services/cryptoVault');

router.use(requireApiKey);

// ============ Credentials ============

// GET /api/chrome/credentials — list, never returning plaintext passwords
router.get('/credentials', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, site, url, username, notes, mfa_hint,
              last_used_at, use_count, created_at, updated_at,
              CASE WHEN password_ciphertext IS NULL THEN false ELSE true END AS has_password
       FROM site_credentials ORDER BY name ASC`
    );
    res.json({ credentials: rows });
  } catch (err) {
    console.error('credentials list error:', err);
    res.status(500).json({ error: 'Failed to list credentials' });
  }
});

router.post('/credentials', async (req, res) => {
  try {
    const { name, site, url, username, password, notes, mfa_hint } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const cipher = password ? vault.encrypt(password) : null;
    const { rows } = await pool.query(
      `INSERT INTO site_credentials (name, site, url, username, password_ciphertext, notes, mfa_hint)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (name) DO UPDATE SET
         site = EXCLUDED.site, url = EXCLUDED.url,
         username = EXCLUDED.username,
         password_ciphertext = COALESCE(EXCLUDED.password_ciphertext, site_credentials.password_ciphertext),
         notes = EXCLUDED.notes,
         mfa_hint = EXCLUDED.mfa_hint,
         updated_at = NOW()
       RETURNING id, name, site, url, username, notes, mfa_hint,
                 CASE WHEN password_ciphertext IS NULL THEN false ELSE true END AS has_password`,
      [name, site || null, url || null, username || null, cipher, notes || null, mfa_hint || null]
    );
    res.status(201).json({ credential: rows[0] });
  } catch (err) {
    console.error('credentials upsert error:', err);
    res.status(500).json({ error: 'Failed to save credential' });
  }
});

router.delete('/credentials/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM site_credentials WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) { res.status(500).json({ error: 'Failed to delete credential' }); }
});

// GET /api/chrome/credentials/:id/reveal?confirm=true
// Returns plaintext password — only when confirm=true is explicitly passed.
router.get('/credentials/:id/reveal', async (req, res) => {
  if (req.query.confirm !== 'true') {
    return res.status(400).json({ error: 'Add ?confirm=true to reveal' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT name, username, password_ciphertext FROM site_credentials WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({
      name: rows[0].name,
      username: rows[0].username,
      password: rows[0].password_ciphertext ? vault.decrypt(rows[0].password_ciphertext) : '',
      masked: rows[0].password_ciphertext ? vault.maskForDisplay(vault.decrypt(rows[0].password_ciphertext)) : ''
    });
  } catch (err) {
    console.error('reveal error:', err);
    res.status(500).json({ error: 'Failed to reveal credential' });
  }
});

// ============ Workflows ============

router.get('/workflows', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.*, c.username AS credential_username
         FROM chrome_workflows w
         LEFT JOIN site_credentials c ON c.name = w.credential_name
         ORDER BY w.last_run_at DESC NULLS LAST, w.name ASC`
    );
    res.json({ workflows: rows });
  } catch (err) {
    console.error('workflows list error:', err);
    res.status(500).json({ error: 'Failed to list workflows' });
  }
});

router.post('/workflows', async (req, res) => {
  try {
    const b = req.body;
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const steps = Array.isArray(b.steps) ? b.steps : (b.steps ? splitSteps(b.steps) : []);
    const { rows } = await pool.query(
      `INSERT INTO chrome_workflows (name, description, target_url, credential_name, steps, expected_output, tags)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6, COALESCE($7,'[]')::jsonb)
       ON CONFLICT (name) DO UPDATE SET
         description = EXCLUDED.description,
         target_url = EXCLUDED.target_url,
         credential_name = EXCLUDED.credential_name,
         steps = EXCLUDED.steps,
         expected_output = EXCLUDED.expected_output,
         tags = EXCLUDED.tags,
         updated_at = NOW()
       RETURNING *`,
      [b.name, b.description || null, b.target_url || null, b.credential_name || null,
       JSON.stringify(steps), b.expected_output || null,
       b.tags ? JSON.stringify(b.tags) : null]
    );
    res.status(201).json({ workflow: rows[0] });
  } catch (err) {
    console.error('workflows upsert error:', err);
    res.status(500).json({ error: 'Failed to save workflow' });
  }
});

router.patch('/workflows/:id', async (req, res) => {
  try {
    const allowed = ['name','description','target_url','credential_name','steps','expected_output','tags'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowed) {
      if (f in req.body) {
        sets.push(`${f} = $${idx++}`);
        if (f === 'steps' || f === 'tags') params.push(JSON.stringify(req.body[f]));
        else params.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE chrome_workflows SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ workflow: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update workflow' });
  }
});

router.delete('/workflows/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM chrome_workflows WHERE id = $1', [req.params.id]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) { res.status(500).json({ error: 'Failed to delete workflow' }); }
});

/**
 * POST /api/chrome/workflows/:id/run
 * Assembles a ready-to-paste Claude Chrome prompt for this workflow.
 * Returns both the prompt text and the decrypted credential so the
 * dashboard can copy it to the clipboard + open the target URL in a new tab.
 */
router.post('/workflows/:id/run', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.*, c.username AS cred_username, c.password_ciphertext AS cred_cipher,
              c.url AS cred_url, c.mfa_hint AS cred_mfa
         FROM chrome_workflows w
         LEFT JOIN site_credentials c ON c.name = w.credential_name
         WHERE w.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const w = rows[0];
    const password = w.cred_cipher ? vault.decrypt(w.cred_cipher) : '';

    const prompt = buildClaudeChromePrompt(w, password);

    await pool.query(
      `UPDATE chrome_workflows SET last_run_at = NOW(), run_count = run_count + 1 WHERE id = $1`,
      [req.params.id]
    );
    if (w.credential_name) {
      await pool.query(
        `UPDATE site_credentials SET last_used_at = NOW(), use_count = use_count + 1 WHERE name = $1`,
        [w.credential_name]
      );
    }

    res.json({
      prompt,
      target_url: w.target_url || w.cred_url || null,
      credential: w.credential_name ? {
        name: w.credential_name,
        username: w.cred_username || '',
        password,
        mfa_hint: w.cred_mfa || ''
      } : null
    });
  } catch (err) {
    console.error('workflow run error:', err);
    res.status(500).json({ error: 'Failed to run workflow', message: err.message });
  }
});

function splitSteps(text) {
  return String(text).split(/\n+/).map(s => s.trim()).filter(Boolean);
}

function buildClaudeChromePrompt(w, password) {
  const lines = [];
  lines.push(`Workflow: ${w.name}`);
  if (w.description) lines.push(`Goal: ${w.description}`);
  lines.push('');
  if (w.target_url) lines.push(`Open: ${w.target_url}`);
  if (w.credential_name) {
    lines.push('');
    lines.push('Login credentials (enter when prompted):');
    lines.push(`  Username: ${w.cred_username || '(not set)'}`);
    lines.push(`  Password: ${password || '(not set — ask me)'}`);
    if (w.cred_mfa) lines.push(`  MFA: ${w.cred_mfa}`);
  }
  const steps = Array.isArray(w.steps) ? w.steps : [];
  if (steps.length) {
    lines.push('');
    lines.push('Steps:');
    steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  }
  if (w.expected_output) {
    lines.push('');
    lines.push(`Expected output: ${w.expected_output}`);
  }
  lines.push('');
  lines.push('When you have completed the workflow, summarize what you did and any results back to me.');
  return lines.join('\n');
}

module.exports = router;
