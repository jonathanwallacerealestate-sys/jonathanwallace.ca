// ─────────────────────────────────────────────────────────────────
// User model — CRUD + password helpers
//
// All functions here assume Postgres is configured. Callers in
// dormant mode should feature-detect via hasDatabase() before
// invoking. Keeping the shape clean here means server.js stays
// readable when we wire it in.
// ─────────────────────────────────────────────────────────────────

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getPool, hasDatabase } from '../db/pool.js';

// Tuned for reasonable defense against offline brute-force while
// keeping login latency acceptable on Railway's smaller dynos.
// Raise to 12 if login latency becomes a non-issue.
const BCRYPT_ROUNDS = 10;

/**
 * Hash a plaintext password for storage.
 * @param {string} plaintext
 * @returns {Promise<string>} bcrypt hash
 */
export async function hashPassword(plaintext) {
  if (!plaintext || plaintext.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

/**
 * Verify a plaintext password against a stored hash.
 * Returns false on mismatch or null/empty inputs — never throws.
 */
export async function verifyPassword(plaintext, hash) {
  if (!plaintext || !hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/**
 * Normalize an email for storage and lookup.
 * CITEXT handles case-insensitivity at the DB level; this is belt-
 * and-suspenders for consistency in logs and edge cases.
 */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Fetch a single user by id. Returns null if not found.
 */
export async function getUserById(id) {
  if (!hasDatabase()) return null;
  const { rows } = await getPool().query(
    `SELECT id, email, name, role, status, display_name, phone,
            brokerage, headshot_url, brand_color, last_login_at,
            created_at, updated_at
     FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Fetch a single user by email. Returns null if not found.
 * For login flows use getUserByEmailWithHash instead.
 */
export async function getUserByEmail(email) {
  if (!hasDatabase()) return null;
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { rows } = await getPool().query(
    `SELECT id, email, name, role, status, display_name, phone,
            brokerage, headshot_url, brand_color, last_login_at,
            created_at, updated_at
     FROM users WHERE lower(email) = $1`,
    [normalized]
  );
  return rows[0] || null;
}

/**
 * Fetch a user + password_hash for verification. Never surface
 * the hash outside the login path.
 */
export async function getUserByEmailWithHash(email) {
  if (!hasDatabase()) return null;
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { rows } = await getPool().query(
    `SELECT id, email, password_hash, name, role, status
     FROM users WHERE lower(email) = $1`,
    [normalized]
  );
  return rows[0] || null;
}

/**
 * Create a user. For invite-only mode, set role='agent' status='invited'
 * and omit password — then the user claims the invite and sets a
 * password, which activates them.
 *
 * @param {object} opts
 * @param {string} opts.email
 * @param {string} [opts.password]  plaintext; hashed before insert
 * @param {string} [opts.name]
 * @param {('owner'|'admin'|'agent')} [opts.role]
 * @param {('active'|'invited')} [opts.status]
 */
export async function createUser({
  email,
  password,
  name,
  role = 'agent',
  status = 'active',
  displayName,
  phone,
  brokerage,
  headshotUrl,
  brandColor,
}) {
  if (!hasDatabase()) {
    throw new Error('createUser called without DATABASE_URL');
  }
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('email is required');

  const passwordHash = password ? await hashPassword(password) : null;

  const { rows } = await getPool().query(
    `INSERT INTO users
       (email, password_hash, name, role, status,
        display_name, phone, brokerage, headshot_url, brand_color)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, email, name, role, status,
               display_name, phone, brokerage, headshot_url, brand_color,
               last_login_at, created_at, updated_at`,
    [normalized, passwordHash, name || null, role, status,
     displayName || null, phone || null, brokerage || null,
     headshotUrl || null, brandColor || null]
  );
  return rows[0];
}

/**
 * Mark a user as having just logged in. Fire-and-forget.
 */
export async function recordLogin(userId) {
  if (!hasDatabase()) return;
  try {
    await getPool().query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [userId]
    );
  } catch (err) {
    console.warn('[users] recordLogin failed:', err.message);
  }
}

/**
 * Set a new password for an existing user.
 */
export async function setPassword(userId, newPlaintext) {
  if (!hasDatabase()) {
    throw new Error('setPassword called without DATABASE_URL');
  }
  const hash = await hashPassword(newPlaintext);
  await getPool().query(
    `UPDATE users
       SET password_hash = $1,
           status = CASE WHEN status = 'invited' THEN 'active' ELSE status END
     WHERE id = $2`,
    [hash, userId]
  );
}

/**
 * Issue an invite. Returns the token — the caller is responsible
 * for delivering it (email, etc.).
 */
export async function createInvite({ email, invitedBy = null, role = 'agent', ttlDays = 7 }) {
  if (!hasDatabase()) {
    throw new Error('createInvite called without DATABASE_URL');
  }
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('email is required');

  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  await getPool().query(
    `INSERT INTO user_invites (token, email, invited_by, role, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [token, normalized, invitedBy, role, expiresAt]
  );

  return { token, email: normalized, expiresAt };
}

/**
 * Look up (but do not consume) an invite. Returns null if missing
 * or expired.
 */
export async function getInvite(token) {
  if (!hasDatabase()) return null;
  const { rows } = await getPool().query(
    `SELECT token, email, invited_by, role, expires_at, accepted_at, created_at
     FROM user_invites WHERE token = $1`,
    [token]
  );
  const invite = rows[0];
  if (!invite) return null;
  if (invite.accepted_at) return null;
  if (invite.expires_at < new Date()) return null;
  return invite;
}

/**
 * Seed the owner user (Jonathan) if the users table is empty.
 * Called once during server bootstrap. Returns the owner's id,
 * or null if seeding was skipped.
 *
 * Reads email/password from env vars so the seed password is
 * never hard-coded or committed:
 *   OWNER_EMAIL     (required to seed)
 *   OWNER_PASSWORD  (required to seed)
 *   OWNER_NAME      (optional, defaults to "Owner")
 */
export async function seedOwnerIfEmpty() {
  if (!hasDatabase()) return null;

  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS n FROM users WHERE role = 'owner'`
  );
  if (rows[0].n > 0) return null;

  const email = normalizeEmail(process.env.OWNER_EMAIL || '');
  const password = process.env.OWNER_PASSWORD || '';
  const name = process.env.OWNER_NAME || 'Owner';

  if (!email || !password) {
    console.warn(
      '[users] seedOwnerIfEmpty — OWNER_EMAIL/OWNER_PASSWORD not set; ' +
      'skipping owner seed. Set both env vars once, deploy, then remove them.'
    );
    return null;
  }

  const owner = await createUser({
    email, password, name, role: 'owner', status: 'active',
  });
  console.log(`[users] seeded owner (id=${owner.id}, email=${owner.email})`);
  return owner.id;
}
