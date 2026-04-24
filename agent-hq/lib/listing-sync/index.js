// lib/listing-sync/index.js
//
// Fans out a listing-form event to every enabled destination module.
// Swap / add destinations by editing the DESTINATIONS map or the
// LISTING_SYNC_TARGETS env var.
//
// See lib/listing-sync/README.md for the module contract.

import * as fubContact from './fub-contact.js';
import * as realm from './realm.js';

const ALL_DESTINATIONS = {
  fub: fubContact,
  realm: realm,
};

function resolveTargets() {
  const raw = (process.env.LISTING_SYNC_TARGETS || 'fub').trim();
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

async function runHook(hookName, form, ctx) {
  const targets = resolveTargets();
  const results = {};
  for (const name of targets) {
    const mod = ALL_DESTINATIONS[name];
    if (!mod || typeof mod[hookName] !== 'function') {
      results[name] = { skipped: true, reason: 'destination not registered or missing hook' };
      continue;
    }
    try {
      results[name] = await mod[hookName](form, ctx);
    } catch (err) {
      results[name] = { ok: false, error: err.message };
    }
  }
  return results;
}

export function syncOnSave(form, ctx) { return runHook('syncOnSave', form, ctx); }
export function syncOnClose(form, ctx) { return runHook('syncOnClose', form, ctx); }
export { resolveTargets };
