// ─────────────────────────────────────────────────────────────────
// Auth routes (/api/auth/*)
//
// Login, logout, and session inspection. Mounted only when Postgres
// is configured (hasDatabase() === true). In single-tenant mode the
// routes still exist but aren't relied on by the dashboard, so
// Jonathan's UX is unchanged.
//
// Once MULTI_TENANT=enforced is set, the auth middleware in
// auth-middleware.js will reject unauthenticated requests and the
// SPA will redirect to /login.
// ─────────────────────────────────────────────────────────────────

import express from 'express';
import {
  getUserById,
  getUserByEmailWithHash,
  verifyPassword,
  recordLogin,
  getInvite,
  setPassword,
} from './users.js';
import { hasDatabase } from '../db/pool.js';

export function createAuthRouter() {
  const router = express.Router();
  router.use(express.json());

  // POST /api/auth/login
  // body: { email, password }
  router.post('/login', async (req, res) => {
    if (!hasDatabase()) {
      return res.status(501).json({ ok: false, error: 'auth not configured' });
    }
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'email and password required' });
    }

    const user = await getUserByEmailWithHash(email);
    if (!user || user.status !== 'active' || !user.password_hash) {
      // Deliberate vague error — never leak whether the email exists.
      return res.status(401).json({ ok: false, error: 'invalid credentials' });
    }

    const match = await verifyPassword(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ ok: false, error: 'invalid credentials' });
    }

    // Store just the user id in the session — re-fetch profile on
    // each request. Keeps the session payload small and always fresh.
    req.session.userId = user.id;
    recordLogin(user.id); // fire-and-forget

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  });

  // POST /api/auth/logout
  router.post('/logout', (req, res) => {
    if (!req.session) return res.json({ ok: true });
    req.session.destroy(err => {
      if (err) return res.status(500).json({ ok: false, error: 'logout failed' });
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  });

  // GET /api/auth/me
  // Returns the current user or null. Safe to call unauthenticated.
  router.get('/me', async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.json({ ok: true, user: null });
    const user = await getUserById(userId);
    if (!user) {
      // Session references a deleted user — clear it.
      req.session.destroy(() => {});
      return res.json({ ok: true, user: null });
    }
    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        displayName: user.display_name,
        brokerage: user.brokerage,
        headshotUrl: user.headshot_url,
        brandColor: user.brand_color,
      },
    });
  });

  // POST /api/auth/accept-invite
  // body: { token, password, name? }
  // Consumes an invite token and sets the user's password.
  router.post('/accept-invite', async (req, res) => {
    if (!hasDatabase()) {
      return res.status(501).json({ ok: false, error: 'auth not configured' });
    }
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ ok: false, error: 'token and password required' });
    }

    const invite = await getInvite(token);
    if (!invite) {
      return res.status(400).json({ ok: false, error: 'invite invalid or expired' });
    }

    // The invited user row must exist (created at invite time) in
    // status='invited'. Acceptance activates them and sets a password.
    // For MVP we require the invite flow to be completed by a user
    // row already present — the admin invite endpoint (future) will
    // create the row alongside the invite.
    const user = await getUserByEmailWithHash(invite.email);
    if (!user) {
      return res.status(400).json({ ok: false, error: 'no user row for invite' });
    }

    await setPassword(user.id, password);

    // Mark the invite consumed
    const { getPool } = await import('../db/pool.js');
    await getPool().query(
      'UPDATE user_invites SET accepted_at = NOW() WHERE token = $1',
      [token]
    );

    // Log them in
    req.session.userId = user.id;
    recordLogin(user.id);

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  });

  return router;
}
