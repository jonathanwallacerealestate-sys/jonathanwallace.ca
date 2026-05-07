// lib/routes/listing-form-intake.js
//
// PUBLIC-but-secret-protected intake endpoint for Make.com to create a new
// listing in Agent HQ when a Seller Appointment fires in Realty Group FUB.
//
// Make.com posts the parsed FUB Person + Appointment data here. We:
//   1. dedupe (idempotent on fubAppointmentId)
//   2. write a per-listing JSON to LISTING_FORMS_DIR with the Seller fields
//      and address pre-filled
//   3. return everything Make.com needs to fan out the rest of the work:
//      - the formatted seller-form email (to / subject / body) so Make.com
//        can drop a draft into Outlook
//      - the calendar event content (title / location / body / start / end)
//        so Make.com can create the Outlook calendar entry
//
// Auth: x-intake-secret header — same secret as the faris-lead-intake skill
// and the new Make.com Faris scenario.
//
// Created 2026-05-07 alongside the Make.com Seller Appointment fan-out scenario.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildSellerEmail } from './seller-drafts.js';

const AGENT_HQ_BASE_URL = 'https://hq.jonathanwallace.ca';
const AGENT = {
  name: 'Jonathan Wallace',
  team: 'Faris Team Real Estate Brokerage',
  phone: '705-433-2525',
};

export function register(app, deps) {
  const { LOG_DIR, LISTING_FORMS_DIR } = deps;

  app.post('/api/listing-form/intake/fub-appointment', async (req, res) => {
    const startedAt = new Date().toISOString();

    // 1. AUTH
    const provided = req.header('x-intake-secret');
    const expected = process.env.FARIS_INTAKE_SECRET;
    if (!expected) {
      return res.status(500).json({ error: 'server_misconfigured' });
    }
    if (!provided || provided !== expected) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // 2. VALIDATE
    const {
      fubPersonId,
      fubAppointmentId,
      address,
      city = '',
      postalCode = '',
      sellerName = '',
      sellerEmail = '',
      sellerPhone = '',
      sellerName2 = '',
      sellerPhone2 = '',
      sellerEmail2 = '',
      notes = '',
      appointmentStart,
      appointmentEnd,
    } = req.body || {};

    if (!address) {
      return res.status(400).json({ error: 'missing_address' });
    }

    // 3. DEDUPE — propertyId is the slug of the address; if an active listing
    //    already exists for this address OR for this fubAppointmentId, return
    //    the existing record instead of creating a duplicate.
    if (!fs.existsSync(LISTING_FORMS_DIR)) {
      await fsp.mkdir(LISTING_FORMS_DIR, { recursive: true });
    }

    const propertyId = slugify(address);
    const existingPath = path.join(LISTING_FORMS_DIR, `${propertyId}.json`);

    let form;
    let action;

    if (fs.existsSync(existingPath)) {
      // Existing listing for this address — check status. If closed, we still
      // want a fresh listing for the new appointment — but use a suffixed id.
      try {
        const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
        if (existing.status === 'closed') {
          // Active listing closed — start a new one with a suffix
          const newId = `${propertyId}-${Date.now().toString(36)}`;
          form = newListingForm(newId);
          action = 'created';
          fillFromIntake(form, {
            fubPersonId, fubAppointmentId, address, city, postalCode,
            sellerName, sellerEmail, sellerPhone,
            sellerName2, sellerPhone2, sellerEmail2,
            notes, appointmentStart, appointmentEnd,
          });
          fs.writeFileSync(path.join(LISTING_FORMS_DIR, `${newId}.json`), JSON.stringify(form, null, 2));
        } else if (existing.fubAppointmentId === fubAppointmentId) {
          // Same appointment — return existing (true idempotence)
          form = existing;
          action = 'deduped';
        } else {
          // Active listing for this address but different appointment —
          // merge the new appointment data into the existing listing
          form = existing;
          fillFromIntake(form, {
            fubPersonId, fubAppointmentId, address, city, postalCode,
            sellerName, sellerEmail, sellerPhone,
            sellerName2, sellerPhone2, sellerEmail2,
            notes, appointmentStart, appointmentEnd,
          });
          form.updatedAt = startedAt;
          fs.writeFileSync(existingPath, JSON.stringify(form, null, 2));
          action = 'updated';
        }
      } catch (err) {
        return res.status(500).json({ error: 'listing_read_failed', detail: String(err) });
      }
    } else {
      // No existing listing — create new
      form = newListingForm(propertyId);
      action = 'created';
      fillFromIntake(form, {
        fubPersonId, fubAppointmentId, address, city, postalCode,
        sellerName, sellerEmail, sellerPhone,
        sellerName2, sellerPhone2, sellerEmail2,
        notes, appointmentStart, appointmentEnd,
      });
      fs.writeFileSync(existingPath, JSON.stringify(form, null, 2));
    }

    // 4. BUILD response payloads for Make.com fan-out
    const draft = buildSellerEmail(form, AGENT_HQ_BASE_URL);
    const calendar = buildCalendarEvent(form);

    // 5. LOG
    await appendLog(LOG_DIR, {
      ts: startedAt,
      action,
      fubPersonId,
      fubAppointmentId,
      propertyId: form.propertyId,
      address: form.address,
      sellerEmail: form.sellerEmail,
    });

    console.log(`[ListingFormIntake] ${action} property=${form.propertyId} address="${form.address}" fubAppt=${fubAppointmentId || '-'}`);

    return res.json({
      success: true,
      action,
      propertyId: form.propertyId,
      address: form.address,
      draft,
      calendar,
    });
  });
}

// ─────────────────── helpers ───────────────────

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function newListingForm(propertyId) {
  const now = new Date().toISOString();
  return {
    propertyId,
    address: '',
    city: '',
    postalCode: '',
    sellerName: '',
    sellerEmail: '',
    sellerPhone: '',
    sellerName2: '',
    sellerPhone2: '',
    sellerEmail2: '',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    createdVia: 'fub_appointment',
  };
}

function fillFromIntake(form, intake) {
  // Only set fields that are non-empty in the intake — never overwrite
  // existing values with blanks (so a re-intake doesn't wipe master data).
  const fields = [
    'address', 'city', 'postalCode',
    'sellerName', 'sellerEmail', 'sellerPhone',
    'sellerName2', 'sellerPhone2', 'sellerEmail2',
    'notes',
  ];
  for (const f of fields) {
    if (intake[f]) form[f] = intake[f];
  }
  if (intake.fubPersonId) form.fubPersonId = intake.fubPersonId;
  if (intake.fubAppointmentId) form.fubAppointmentId = intake.fubAppointmentId;
  if (intake.appointmentStart) form.appointmentStart = intake.appointmentStart;
  if (intake.appointmentEnd) form.appointmentEnd = intake.appointmentEnd;
}

function buildCalendarEvent(form) {
  const addr = form.address || 'TBD';
  const city = form.city ? `, ${form.city}` : '';
  const title = `Seller Appointment — ${addr}${city}`;
  const location = `${addr}${city}${form.postalCode ? `, ${form.postalCode}` : ''}`;
  const formLink = `${AGENT_HQ_BASE_URL}/?seller=${encodeURIComponent(form.propertyId)}`;
  const adminLink = `${AGENT_HQ_BASE_URL}/#listing-form/${encodeURIComponent(form.propertyId)}`;

  const lines = [
    `Seller appointment with ${form.sellerName || 'TBD'}.`,
    '',
    `Property: ${addr}${city}`,
    form.postalCode ? `Postal: ${form.postalCode}` : null,
    '',
    'Seller contact:',
    form.sellerName ? `  • ${form.sellerName}` : null,
    form.sellerPhone ? `  • Phone: ${form.sellerPhone}` : null,
    form.sellerEmail ? `  • Email: ${form.sellerEmail}` : null,
    form.sellerName2 ? `  • Co-seller: ${form.sellerName2}${form.sellerPhone2 ? ` (${form.sellerPhone2})` : ''}` : null,
    '',
    `Pre-listing form (seller link): ${formLink}`,
    `Master listing form (admin): ${adminLink}`,
    '',
    form.notes ? `Notes from FUB:\n${form.notes}` : null,
  ].filter(Boolean);

  return {
    title,
    location,
    body: lines.join('\n'),
    start: form.appointmentStart || null,
    end: form.appointmentEnd || null,
  };
}

async function appendLog(LOG_DIR, entry) {
  try {
    const dir = LOG_DIR || '/tmp';
    if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'listing-form-intake.log');
    await fsp.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('[ListingFormIntake] log write failed:', err);
  }
}
