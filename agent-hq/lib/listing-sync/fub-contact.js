// lib/listing-sync/fub-contact.js
//
// Keeps the FUB contact in sync with the deal card.
//
// See lib/listing-sync/README.md for the destination-module contract.

function splitName(full) {
  if (!full) return { firstName: '', lastName: '' };
  const parts = String(full).trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function normalizeStreet(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function syncOnSave(form, ctx) {
  const { fubApiKey, fubBase, fubHeaders, logger = console } = ctx || {};
  if (!form || !form.fubId || !fubApiKey) return { skipped: true };

  try {
    const body = {};

    if (form.sellerName) {
      const { firstName, lastName } = splitName(form.sellerName);
      if (firstName) body.firstName = firstName;
      if (lastName) body.lastName = lastName;
    }

    if (form.sellerPhone) {
      body.phones = [{ value: String(form.sellerPhone).trim(), type: 'home' }];
    }

    if (form.sellerEmail) {
      body.emails = [{ value: String(form.sellerEmail).trim(), type: 'home' }];
    }

    if (form.address) {
      body.addresses = [{
        street: form.address,
        city: form.city || '',
        code: form.postalCode || '',
        state: 'ON',
        country: 'Canada',
        type: 'home',
      }];
    }

    if (Object.keys(body).length === 0) return { skipped: true, reason: 'no fields to sync' };

    const resp = await fetch(`${fubBase}/people/${form.fubId}`, {
      method: 'PUT',
      headers: fubHeaders(),
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      logger.warn(`[listing-sync/fub] syncOnSave ${form.fubId} failed: ${resp.status} ${txt.slice(0, 200)}`);
      return { ok: false, status: resp.status };
    }

    logger.info(`[listing-sync/fub] syncOnSave ${form.fubId} ok (${Object.keys(body).join(',')})`);
    return { ok: true };
  } catch (err) {
    logger.warn(`[listing-sync/fub] syncOnSave ${form.fubId} error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

export async function syncOnClose(form, ctx) {
  const { fubApiKey, fubBase, fubHeaders, logger = console } = ctx || {};
  if (!form || !form.fubId || !fubApiKey) return { skipped: true };

  try {
    const resp = await fetch(`${fubBase}/people/${form.fubId}`, { headers: fubHeaders() });
    if (!resp.ok) {
      logger.warn(`[listing-sync/fub] syncOnClose fetch ${form.fubId} failed: ${resp.status}`);
      return { ok: false, status: resp.status };
    }
    const person = await resp.json();

    // Scrub the property address from the contact. Match on street, because
    // city/postal may also appear on a future home.
    const listingStreet = normalizeStreet(form.address);
    const existing = Array.isArray(person.addresses) ? person.addresses : [];
    const filtered = listingStreet
      ? existing.filter(a => normalizeStreet(a.street) !== listingStreet)
      : existing;

    const patch = { stage: 'Past Client' };
    if (filtered.length !== existing.length) {
      patch.addresses = filtered;
    }

    const putResp = await fetch(`${fubBase}/people/${form.fubId}`, {
      method: 'PUT',
      headers: fubHeaders(),
      body: JSON.stringify(patch),
    });

    if (!putResp.ok) {
      const txt = await putResp.text().catch(() => '');
      logger.warn(`[listing-sync/fub] syncOnClose ${form.fubId} put failed: ${putResp.status} ${txt.slice(0, 200)}`);
      return { ok: false, status: putResp.status };
    }

    logger.info(`[listing-sync/fub] syncOnClose ${form.fubId} ok (addresses ${existing.length}→${filtered.length}, stage→Past Client)`);
    return { ok: true, removedAddresses: existing.length - filtered.length };
  } catch (err) {
    logger.warn(`[listing-sync/fub] syncOnClose ${form.fubId} error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
