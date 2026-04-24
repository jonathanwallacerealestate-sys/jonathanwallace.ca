// lib/listing-sync/realm.js
//
// Placeholder for REALM MLS destination. Today a no-op; fill in when
// the deal-card → MLS push shifts off Sisu and onto REALM.
//
// See lib/listing-sync/README.md for the module contract.

export async function syncOnSave(/* form, ctx */) {
  // TODO: push listing-form fields into REALM. Likely paths:
  //  - Direct REST (if REALM exposes one with an API key)
  //  - Drive the REALM web UI via the Chrome extension, much like
  //    brokerbay-active-listings does for BrokerBay
  return { skipped: true, reason: 'realm destination not yet implemented' };
}

export async function syncOnClose(/* form, ctx */) {
  // TODO: mark listing sold / removed on REALM when implemented.
  return { skipped: true, reason: 'realm destination not yet implemented' };
}
