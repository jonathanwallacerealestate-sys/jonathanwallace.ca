// ─────────────────────────────────────────────────────────────────
// Migration runner
//
// Reads .sql files from db/migrations/ and applies any that haven't
// been recorded in the schema_migrations table. Each migration runs
// in its own transaction, so a failure rolls back cleanly.
//
// Naming convention: NNN_description.sql (e.g. 001_users.sql).
// The leading number determines apply order; the runner sorts
// lexicographically.
//
// Usage (from server.js):
//   import { runMigrations } from './db/migrate.js';
//   await runMigrations();
//
// Usage (CLI, for manual runs):
//   node db/migrate.js
// ─────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, hasDatabase } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Apply any unapplied migrations.
 * Safe to call on every server startup.
 */
export async function runMigrations() {
  if (!hasDatabase()) {
    console.log('[migrate] skipped — DATABASE_URL not configured');
    return { applied: [], skipped: true };
  }

  const pool = getPool();
  if (!pool) return { applied: [], skipped: true };

  // Ensure the tracking table exists. This creates it on first run
  // before migration 001 is applied, so the runner can use it to
  // check for 001 itself.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
  `);

  // Read all migration files and sort by filename
  let files;
  try {
    files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch (e) {
    console.log('[migrate] migrations dir not found — nothing to apply');
    return { applied: [], skipped: true };
  }

  // Find what's already applied
  const { rows } = await pool.query(
    'SELECT version FROM schema_migrations'
  );
  const applied = new Set(rows.map(r => r.version));

  const newlyApplied = [];

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;

    const filepath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(filepath, 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version]
      );
      await client.query('COMMIT');
      console.log(`[migrate] applied ${version}`);
      newlyApplied.push(version);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] FAILED ${version}: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  }

  if (newlyApplied.length === 0) {
    console.log('[migrate] database up-to-date');
  } else {
    console.log(`[migrate] applied ${newlyApplied.length} migration(s)`);
  }

  return { applied: newlyApplied, skipped: false };
}

// Allow running as a script: `node db/migrate.js`
if (process.argv[1] === __filename) {
  runMigrations()
    .then(({ applied, skipped }) => {
      if (skipped) {
        console.log('Skipped — DATABASE_URL not set');
      } else {
        console.log(`Done. Applied: ${applied.length}`);
      }
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
