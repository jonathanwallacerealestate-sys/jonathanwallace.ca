# Listing Sync — Pluggable Destinations

Wherever Agent HQ needs to push listing-form data outside itself, the outbound
code lives in this folder — **one module per destination**, same shape for every
one.

## The contract

Each module exports:

```js
export async function syncOnSave(form, ctx) { /* called after every save */ }
export async function syncOnClose(form, ctx) { /* called when deal is closed */ }
```

`ctx` holds environment-provided dependencies so the module doesn't reach into
`server.js`:

```
{
  fubApiKey,    // string, may be empty — skip if unset
  fubBase,      // 'https://api.followupboss.com/v1'
  fubHeaders,   // () => object, prebuilt auth headers
  logger,       // { info, warn, error } — console-like
}
```

Every sync function **must be non-blocking from the caller's POV** — internal
fetch failures should be caught and logged, never throw out to the Express
handler. The deal-card save happens before the sync runs, and the save should
succeed even if sync is broken.

## Current destinations

- **`fub-contact.js`** — pushes seller name/phone/email/mailing address to the
  linked FUB contact on save. On close, scrubs the property's street address
  from the contact and bumps their stage to Past Client.
- **`realm.js`** — placeholder. Future: REALM MLS push via Chrome extension or
  direct API. Today exports no-op `syncOnSave` / `syncOnClose`.

## Not in this folder (intentionally)

- **Sisu export** (`/api/listing-form/:id/sisu-export`) — already decoupled. The
  Chrome extension pulls the field mapping from that endpoint and drives Sisu's
  web UI itself. No code-level change needed when Sisu is retired; just stop
  calling that endpoint from the extension.

## Moving from Sisu → REALM (or anywhere else) later

1. Fill in `realm.js` with real `syncOnSave` / `syncOnClose` implementations
   (API calls, Chrome-extension triggers, whatever REALM needs).
2. Register it in the dispatcher (`server.js`: wherever `require('./lib/listing-sync/fub-contact')`
   is imported, add `realm` alongside).
3. Optionally gate with an env var — e.g. `LISTING_SYNC_TARGETS=fub,realm`.
4. Nothing else in `server.js` or the React app needs to change.
