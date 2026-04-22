// ─────────────────────────────────────────────────────────────────
// User-scoped filesystem helpers
//
// Today, Agent HQ stores all JSON state in DATA_DIR directly
// (e.g. /data/.listings.json). Multi-tenant requires each agent's
// state to be isolated — the plan is to move to
// /data/users/{userId}/.listings.json.
//
// This module provides the resolver that will be used when we
// migrate each state file. It is BACKWARDS COMPATIBLE with the
// existing layout: for the owner (userId=1), it returns DATA_DIR
// directly, so no filesystem migration is needed until we
// explicitly opt a file into per-user scoping.
//
// Migration strategy (spelled out in MULTI_TENANT_ROADMAP.md):
//   1. Leave all existing code using DATA_DIR unchanged.
//   2. When migrating a single JSON file to per-user scoping,
//      rewrite its path constant to use userDataPath(userId, filename).
//   3. Run a one-time migration that moves
//      /data/{filename} → /data/users/1/{filename}.
// ─────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_OWNER_ID, isMultiTenantEnforced } from './user-context.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * The single-tenant DATA_DIR, resolved the same way server.js does.
 * Duplicated here rather than imported to avoid a circular dep.
 */
function resolveDataDir() {
  const envDir = process.env.DATA_DIR;
  if (envDir) {
    try {
      fs.mkdirSync(envDir, { recursive: true });
      return envDir;
    } catch {
      // fall through to fallback
    }
  }
  // Matches server.js fallback (parent of lib/ is the repo root)
  return path.resolve(__dirname, '..');
}

const ROOT_DATA_DIR = resolveDataDir();

/**
 * Get the directory where a specific user's JSON state lives.
 *
 * Owner user in single-tenant mode → ROOT_DATA_DIR (backwards compat)
 * Any other case (agent user, or enforced mode) → ROOT_DATA_DIR/users/{id}/
 *
 * Creates the directory on demand so callers can immediately write.
 */
export function getUserDataDir(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`getUserDataDir: invalid userId ${userId}`);
  }

  // Backwards-compat path: when the owner is operating in single-tenant
  // mode, their files remain at the legacy location.
  if (id === DEFAULT_OWNER_ID && !isMultiTenantEnforced()) {
    return ROOT_DATA_DIR;
  }

  const dir = path.join(ROOT_DATA_DIR, 'users', String(id));
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }
  return dir;
}

/**
 * Join a filename onto a user's data directory.
 *
 *   userDataPath(1, '.listings.json') === /data/.listings.json  (owner, single-tenant)
 *   userDataPath(2, '.listings.json') === /data/users/2/.listings.json
 */
export function userDataPath(userId, filename) {
  return path.join(getUserDataDir(userId), filename);
}

/**
 * Migrate a legacy shared file to user-scoped location. Idempotent:
 * if the user-scoped file already exists, this is a no-op.
 *
 * Intended to be called during an explicit data migration, not on
 * every request. See scripts/migrate-owner-data.js (future).
 */
export function migrateLegacyFileToUser({ filename, userId }) {
  const legacyPath = path.join(ROOT_DATA_DIR, filename);
  const newPath = userDataPath(userId, filename);

  if (legacyPath === newPath) return { skipped: 'same-path' };
  if (!fs.existsSync(legacyPath)) return { skipped: 'legacy-missing' };
  if (fs.existsSync(newPath)) return { skipped: 'already-migrated' };

  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  fs.copyFileSync(legacyPath, newPath);
  return { moved: true, from: legacyPath, to: newPath };
}
