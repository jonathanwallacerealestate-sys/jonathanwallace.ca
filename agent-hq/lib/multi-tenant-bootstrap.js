// ─────────────────────────────────────────────────────────────────
// Multi-tenant bootstrap
//
// Single entry point called from server.js. Handles:
//   1. Running pending SQL migrations
//   2. Seeding the owner user on first boot (if env vars supplied)
//   3. Installing session middleware (Postgres-backed)
//   4. Mounting auth routes (/api/auth/*)
//   5. Installing attachUser + requireAuthIfEnforced middleware
//
// All of this is a no-op when DATABASE_URL is not configured — so
// Agent HQ's current single-tenant behavior is preserved byte-for-
// byte until Postgres is attached.
// ─────────────────────────────────────────────────────────────────

import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { hasDatabase, getPool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { seedOwnerIfEmpty } from './users.js';
import { createAuthRouter } from './auth-routes.js';
import { attachUser, requireAuthIfEnforced } from './auth-middleware.js';
import { isMultiTenantEnforced } from './user-context.js';

const PgSession = connectPgSimple(session);

/**
 * Install all multi-tenant infrastructure onto the express app.
 * Safe to call even when Postgres is not configured — in that case
 * this logs a single line and returns.
 *
 * @param {import('express').Express} app
 */
export async function installMultiTenant(app) {
  if (!hasDatabase()) {
    console.log('[multi-tenant] dormant — set DATABASE_URL on Railway to activate');
    return { installed: false };
  }

  // 1. Apply pending migrations
  try {
    await runMigrations();
  } catch (err) {
    console.error('[multi-tenant] migration failed:', err.message);
    throw err;
  }

  // 2. Seed the owner user if not yet present
  try {
    await seedOwnerIfEmpty();
  } catch (err) {
    console.warn('[multi-tenant] seedOwner skipped:', err.message);
  }

  // 3. Install session middleware
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    console.warn(
      '[multi-tenant] SESSION_SECRET not set — using an ephemeral fallback. ' +
      'Set a long random value in Railway before enabling MULTI_TENANT=enforced.'
    );
  }
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(session({
    store: new PgSession({
      pool: getPool(),
      tableName: 'sessions',
      createTableIfMissing: false, // handled by our migration
    }),
    name: 'agenthq.sid',
    secret: sessionSecret || 'dev-only-do-not-use-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,               // HTTPS only in prod
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,   // 30 days
    },
  }));

  // 4. Hydrate req.user from session on every request (non-blocking)
  app.use(attachUser());

  // 5. Mount auth endpoints
  app.use('/api/auth', createAuthRouter());

  // 6. Guard API routes when enforced mode is on
  app.use(requireAuthIfEnforced());

  console.log(
    `[multi-tenant] installed — mode: ${isMultiTenantEnforced() ? 'ENFORCED' : 'ready (not enforced)'}`
  );
  return { installed: true, enforced: isMultiTenantEnforced() };
}
