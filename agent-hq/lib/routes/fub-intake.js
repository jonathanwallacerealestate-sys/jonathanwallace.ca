// lib/routes/fub-intake.js
//
// PUBLIC-but-secret-protected intake endpoint used by the `faris-lead-intake`
// Apple Mail skill on Jonathan's Mac. The skill finds new "Lead assigned"
// notification emails sent by Faris's Follow Up Boss instance, and POSTs each
// one's raw subject + body here. We parse Name / Phone / Email / Source out
// of the FUB notification body and upsert the contact into Jonathan's Realty
// Group FUB account.
//
// Auth: x-intake-secret header must match FARIS_INTAKE_SECRET in env.
// Created 2026-05-07 alongside the faris-lead-intake skill build.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const FUB_BASE = 'https://api.followupboss.com/v1';
const TAG_IMPORTED = 'imported_from_faris';

/**
 * deps:
 *   LOG_DIR     — absolute path where intake logs are appended (faris-intake.log)
 *   FUB_API_KEY — Realty Group FUB API key (already in env as FUB_API_KEY)
 *   fubHeaders  — function returning auth headers (matches server.js convention)
 */
export function register(app, deps) {
  const { LOG_DIR, FUB_API_KEY, fubHeaders } = deps;

  app.post('/api/fub/intake-from-faris-email', async (req, res) => {
    const startedAt = new Date().toISOString();

    // 1. AUTH — shared secret in x-intake-secret header
    const provided = req.header('x-intake-secret');
    const expected = process.env.FARIS_INTAKE_SECRET;
    if (!expected) {
      console.error('[FarisIntake] FARIS_INTAKE_SECRET not set in Railway env');
      return res.status(500).json({ error: 'server_misconfigured' });
    }
    if (!provided || provided !== expected) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // 2. VALIDATE
    const { subject, body, messageId } = req.body || {};
    if (!subject || !body) {
      return res.status(400).json({ error: 'missing_subject_or_body' });
    }

    // 3. PARSE
    const parsed = parseFubLeadAssignedEmail(subject, body);
    if (!parsed.email && !parsed.phone) {
      await appendLog(LOG_DIR, {
        ts: startedAt, action: 'parse_failed', subject, messageId,
        reason: 'no_contact_method', parsed,
      });
      return res.status(422).json({
        error: 'parse_failed',
        detail: 'no email or phone found in body',
        parsed,
      });
    }

    // 4. UPSERT IN REALTY GROUP FUB
    if (!FUB_API_KEY) {
      return res.status(500).json({ error: 'fub_api_key_not_configured' });
    }

    try {
      // Look for existing person by email (FUB allows email-based dedupe)
      let existing = null;
      if (parsed.email) {
        const searchRes = await fetch(
          `${FUB_BASE}/people?email=${encodeURIComponent(parsed.email)}&limit=1`,
          { headers: fubHeaders() }
        );
        if (searchRes.ok) {
          const data = await searchRes.json();
          existing = (data.people && data.people[0]) || null;
        }
      }

      let person, action;

      if (existing) {
        // UPDATE — add tag, ensure phone is on file
        const existingTags = (existing.tags || []).slice();
        const newTags = Array.from(new Set([
          ...existingTags,
          TAG_IMPORTED,
          parsed.source ? `source: ${parsed.source}` : null,
        ].filter(Boolean)));

        const phonesPayload = parsed.phone
          ? mergePhone(existing.phones || [], parsed.phone)
          : (existing.phones || []);

        const updateRes = await fetch(`${FUB_BASE}/people/${existing.id}`, {
          method: 'PUT',
          headers: fubHeaders(),
          body: JSON.stringify({ tags: newTags, phones: phonesPayload }),
        });
        if (!updateRes.ok) {
          const errText = await updateRes.text();
          throw new Error(`FUB update ${updateRes.status}: ${errText}`);
        }
        person = await updateRes.json();
        action = 'updated';
      } else {
        // CREATE
        const createRes = await fetch(`${FUB_BASE}/people`, {
          method: 'POST',
          headers: fubHeaders(),
          body: JSON.stringify({
            firstName: parsed.firstName,
            lastName: parsed.lastName,
            emails: parsed.email ? [{ value: parsed.email, type: 'home' }] : [],
            phones: parsed.phone ? [{ value: parsed.phone, type: 'mobile' }] : [],
            tags: [TAG_IMPORTED, parsed.source ? `source: ${parsed.source}` : null].filter(Boolean),
            source: parsed.source || 'Faris',
          }),
        });
        if (!createRes.ok) {
          const errText = await createRes.text();
          throw new Error(`FUB create ${createRes.status}: ${errText}`);
        }
        person = await createRes.json();
        action = 'created';
      }

      await appendLog(LOG_DIR, {
        ts: startedAt, action, subject, messageId,
        fubPersonId: person.id,
        name: parsed.fullName,
        email: parsed.email,
        phone: parsed.phone,
        source: parsed.source,
      });

      console.log(`[FarisIntake] ${action} fub_id=${person.id} name="${parsed.fullName}" email=${parsed.email || '-'} phone=${parsed.phone || '-'} source="${parsed.source}"`);

      return res.json({
        success: true,
        action,
        fubPersonId: person.id,
        parsed,
      });
    } catch (err) {
      const detail = String(err && err.message || err);
      await appendLog(LOG_DIR, {
        ts: startedAt, action: 'error', subject, messageId, error: detail,
      });
      console.error('[FarisIntake] Upsert error:', err);
      return res.status(502).json({ error: 'fub_upsert_failed', detail });
    }
  });
}

// ────────────────────────── PARSER ──────────────────────────
//
// Sample FUB notification body (one line in real life, broken here for clarity):
//   "Follow Up Boss You've received a new lead named David Goodchild
//    from Team: Google - Paid DG  (705) 717-4556 dgoodchild271@gmail.com Open Lead..."
// Subject: "Lead assigned - David Goodchild"

export function parseFubLeadAssignedEmail(subject, body) {
  // Name (from subject preferred, from body as fallback)
  let fullName = '';
  const subjectMatch = (subject || '').match(/Lead assigned\s*-\s*(.+?)\s*$/i);
  if (subjectMatch) fullName = subjectMatch[1].trim();
  if (!fullName) {
    const bodyNameMatch = (body || '').match(/new lead named\s+([^\n]+?)\s+from Team:/i);
    if (bodyNameMatch) fullName = bodyNameMatch[1].trim();
  }
  const parts = fullName.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ');

  // Phone: (NNN) NNN-NNNN
  let phone = '';
  const phoneMatch = (body || '').match(/\(\d{3}\)\s*\d{3}-\d{4}/);
  if (phoneMatch) phone = phoneMatch[0];

  // Email — skip FUB's own + common no-reply patterns
  let email = '';
  const emailMatches = (body || '').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || [];
  for (const candidate of emailMatches) {
    if (!/(@followupboss\.com$|^noreply|^no-reply|^notifications@)/i.test(candidate)) {
      email = candidate;
      break;
    }
  }

  // Source/Team — between "from Team:" and the next double-space
  let source = '';
  const sourceMatch = (body || '').match(/from Team:\s*(.+?)\s{2,}/i);
  if (sourceMatch) source = sourceMatch[1].trim();

  return { fullName, firstName, lastName, phone, email, source };
}

function mergePhone(existingPhones, newPhone) {
  const exists = existingPhones.some(p => normalizePhone(p.value) === normalizePhone(newPhone));
  if (exists) return existingPhones;
  return [...existingPhones, { value: newPhone, type: 'mobile' }];
}

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

async function appendLog(LOG_DIR, entry) {
  try {
    const dir = LOG_DIR || '/tmp';
    if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'faris-intake.log');
    await fsp.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('[FarisIntake] log write failed:', err);
  }
}
