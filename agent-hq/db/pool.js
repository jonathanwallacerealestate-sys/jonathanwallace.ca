// ─────────────────────────────────────────────────────────────────
// Postgres connection pool
//
// The pool is created ONLY when DATABASE_URL is set (Railway injects
// this automatically when a Postgres plugin is attached to a service).
// When unset, every export from this module is null and the rest of
// the app is expected to feature-detect before using it.
//
// This keeps Agent HQ running in its current single-tenant, JSON-file
// mode when no database is configured — zero risk of regression.
// ─────────────────────────────────────────────────────────────────

import pg from 'pg';

const { Pool } = pg;

// When Railway provisions Postgres, it provides DATABASE_URL.
// When running locally or without the plugin, this is undefined and
// the multi-tenant subsystem stays dormant.
const DATABASE_URL = process.env.DATABASE_URL || '';

/** @type {pg.Pool | null} */
let pool = null;

if (DATABASE_URL) {
  // Railway's Postgres service uses self-signed certs over the public
  // network. When SSL is required (production), disable cert validation
  // but keep TLS on. Override with PGSSLMODE=disable for local dev.
  const sslMode = (process.env.PGSSLMODE || '').toLowerCase();
  const ssl = sslMode === 'disable'
    ? false
    : { rejectUnauthorized: false };

  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl,
    // Conservative pool sizing for a small-scale SaaS —
    // tune upward once multi-tenancy is actually live.
    max: parseInt(process.env.PG_POOL_MAX || '10', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (err) => {
    console.error('[db] unexpected error on idle client:', err.message);
  });

  console.log('[db] Postgres pool initialized (DATABASE_URL present)');
} else {
  console.log('[db] DATABASE_URL not set — multi-tenant subsystem dormant');
}

/** True when a Postgres pool is available. */
export const hasDatabase = () => pool !== null;

/** Get the shared pool (or null when Postgres is not configured). */
export const getPool = () => pool;

/**
 * Convenience query wrapper that throws a helpful error if the pool
 * is missing. Use this only from code paths that already checked
 * `hasDatabase()`.
 *
 * @param {string} text  SQL text
 * @param {any[]}  params  Parameter values
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
  if (!pool) {
    throw new Error('[db] query() called but DATABASE_URL is not configured');
  }
  return pool.query(text, params);
}

/** Graceful shutdown — called from the SIGTERM handler in server.js. */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
