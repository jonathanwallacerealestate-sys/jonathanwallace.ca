// ─────────────────────────────────────────────────────────────────
// Auth middleware
//
// Two middleware factories:
//   attachUser        — always runs; hydrates req.user from session.
//                       Never blocks a request. Safe to mount globally.
//   requireAuthIfEnforced — blocks unauthenticated API requests
//                       only when MULTI_TENANT=enforced is set.
//
// This split means single-tenant mode stays fully open (today's
// behavior), while flipping to enforced mode activates auth
// everywhere without further code changes.
// ─────────────────────────────────────────────────────────────────

import { getUserById } from './users.js';
import { hasDatabase } from '../db/pool.js';
import { isMultiTenantEnforced } from './user-context.js';

/**
 * Always-on middleware: if the session carries a userId, fetch the
 * user row and attach as req.user. No-op otherwise.
 */
export function attachUser() {
  return async (req, res, next) => {
    try {
      const userId = req.session?.userId;
      if (userId && hasDatabase()) {
        const user = await getUserById(userId);
        if (user && user.status === 'active') {
          // Attach a sanitized copy — never leak password_hash.
          req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            status: user.status,
            displayName: user.display_name,
            brokerage: user.brokerage,
          };
        }
      }
    } catch (err) {
      console.warn('[auth] attachUser failed:', err.message);
    }
    next();
  };
}

/**
 * Guards API routes. Allows public paths through (see allowlist).
 * Only blocks when MULTI_TENANT=enforced and req.user is missing.
 */
export function requireAuthIfEnforced(opts = {}) {
  const publicPaths = new Set([
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/me',
    '/api/auth/accept-invite',
    '/api/health',
    ...(opts.publicPaths || []),
  ]);

  return (req, res, next) => {
    if (!isMultiTenantEnforced()) return next();
    if (!req.path.startsWith('/api/')) return next();
    if (publicPaths.has(req.path)) return next();
    if (req.user) return next();

    res.status(401).json({ ok: false, error: 'authentication required' });
  };
}

/**
 * Role-guard helper. Usage:
 *   app.post('/api/admin/x', requireRole('owner', 'admin'), handler);
 *
 * Only meaningful when auth is enforced — in single-tenant mode
 * every request is implicitly the owner.
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!isMultiTenantEnforced()) return next(); // single-tenant = owner
    if (!req.user) return res.status(401).json({ ok: false, error: 'auth required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    next();
  };
}
