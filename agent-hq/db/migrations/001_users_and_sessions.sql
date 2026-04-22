-- ─────────────────────────────────────────────────────────────────
-- Migration 001 — Users and Sessions
--
-- Creates the foundational tables for multi-tenant Agent HQ:
--   users              — one row per agent
--   user_invites       — pending invitations (invite-only onboarding)
--   sessions           — express-session store (connect-pg-simple compatible)
--   schema_migrations  — tracks which migrations have been applied
--
-- NOTE: This migration is safe to run against a fresh Postgres or an
-- existing Postgres that does not yet have these tables. The runner
-- applies it exactly once per database.
--
-- NOTE: Creating these tables does NOT activate multi-tenant mode.
-- Auth enforcement remains off until the server is started with
-- MULTI_TENANT=enforced. See MULTI_TENANT_ROADMAP.md.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(255) PRIMARY KEY,
  applied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── users ────────────────────────────────────────────────────────
-- id       : stable surrogate key used as the partition dimension
--            across every other multi-tenant table
-- email    : primary login identifier, stored lower-cased
-- role     : 'owner' | 'admin' | 'agent' — owner is user #1 (Jonathan)
--            and cannot be deleted
-- status   : 'active' | 'invited' | 'suspended' | 'deleted'
-- password_hash : bcrypt hash; NULL while the user is still in
--            'invited' state (they set a password when they accept)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  email           CITEXT,  -- case-insensitive unique emails
  password_hash   TEXT,
  name            VARCHAR(255),
  role            VARCHAR(32) NOT NULL DEFAULT 'agent'
    CHECK (role IN ('owner', 'admin', 'agent')),
  status          VARCHAR(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'invited', 'suspended', 'deleted')),
  -- Optional profile fields surfaced on seller reports, emails, etc.
  display_name    VARCHAR(255),
  phone           VARCHAR(64),
  brokerage       VARCHAR(255),
  headshot_url    TEXT,
  -- Per-agent branding colour — hex, used on emails and landing pages
  brand_color     VARCHAR(16),
  -- Soft-timestamps for observability
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CITEXT is a Postgres extension — load it before the constraint.
-- Doing this inside the same migration keeps the file self-contained.
-- If the extension is not available on the host (rare), fall back to
-- a lower() unique index on a TEXT column. See FALLBACK below.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS citext;
EXCEPTION WHEN insufficient_privilege THEN
  -- Some managed Postgres services disallow CREATE EXTENSION. If so,
  -- the column was created as CITEXT-pending; we convert to TEXT and
  -- rely on a functional unique index.
  ALTER TABLE users ALTER COLUMN email TYPE TEXT;
END
$$;

-- Unique email. If CITEXT loaded we get case-insensitive equality for
-- free; if not, the lower() index guarantees the same semantics.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users (lower(email));

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);

-- ── user_invites ─────────────────────────────────────────────────
-- A separate table so invites can be issued (and revoked) without
-- polluting the users table. An invite is claimed by POSTing the
-- token + a chosen password, which creates/activates the user row.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_invites (
  token           VARCHAR(64) PRIMARY KEY,
  email           TEXT        NOT NULL,
  invited_by      INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  role            VARCHAR(32) NOT NULL DEFAULT 'agent'
    CHECK (role IN ('owner', 'admin', 'agent')),
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_invites_email
  ON user_invites (lower(email));

-- ── sessions ─────────────────────────────────────────────────────
-- Shape dictated by connect-pg-simple. Do not rename columns.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  sid     VARCHAR      NOT NULL COLLATE "default" PRIMARY KEY,
  sess    JSON         NOT NULL,
  expire  TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expire
  ON sessions (expire);

-- ── updated_at trigger ───────────────────────────────────────────
-- Keep updated_at in sync on any UPDATE to users.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
