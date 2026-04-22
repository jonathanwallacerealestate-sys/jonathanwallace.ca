// ─────────────────────────────────────────────────────────────────
// User context resolution
//
// Today, Agent HQ is single-tenant — every request is implicitly
// "Jonathan's". This module centralizes that assumption so that
// activating multi-tenant mode is a single code change.
//
// USAGE PATTERN:
//   import { getCurrentUserId } from './lib/user-context.js';
//   app.get('/api/something', (req, res) => {
//     const userId = getCurrentUserId(req);
//     // load/save data scoped to userId
//   });
//
// In single-tenant mode (default): always returns DEFAULT_OWNER_ID.
// In enforced mode (MULTI_TENANT=enforced): returns the user's id
// from their session, or null if no session (in which case the
// auth middleware should have already rejected the request).
// ─────────────────────────────────────────────────────────────────

// ID of the owner — Jonathan. Chosen as 1 because SERIAL ids start
// at 1, and the owner seed runs before any agent signs up.
export const DEFAULT_OWNER_ID = 1;

/**
 * True when the server has been started in enforced multi-tenant mode.
 * Checked lazily so tests can mutate env before first call.
 */
export const isMultiTenantEnforced = () =>
  String(process.env.MULTI_TENANT || '').toLowerCase() === 'enforced';

/**
 * Resolve the current user's id for a request.
 *
 * @param {import('express').Request} req
 * @returns {number | null}  user id, or null if anonymous and enforced
 */
export function getCurrentUserId(req) {
  if (!isMultiTenantEnforced()) {
    // Single-tenant mode — every request is the owner.
    return DEFAULT_OWNER_ID;
  }
  // Enforced mode — the session middleware has already populated
  // req.user (see lib/auth-middleware.js). A null return here means
  // an unauthenticated caller reached this code; the auth middleware
  // should reject before we get here.
  return req?.user?.id ?? null;
}

/**
 * Convenience: fail loudly if the caller forgot the auth check.
 * Use inside API handlers where auth is guaranteed by middleware:
 *   const userId = requireUserId(req);
 */
export function requireUserId(req) {
  const id = getCurrentUserId(req);
  if (id === null) {
    const err = new Error('authentication required');
    err.status = 401;
    throw err;
  }
  return id;
}
