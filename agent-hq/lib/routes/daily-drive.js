// lib/routes/daily-drive.js
//
// Endpoints for the gamification layer (streak, daily target, today's progress).
// Consumed by the MorningBrief badge and hooked into CallListSection's existing
// per-call logging.
//
//   GET    /api/daily-drive/state           — full state (streak, today, history)
//   POST   /api/daily-drive/log-call        — body: { fubId? } — increment today
//   POST   /api/daily-drive/unlog-call      — body: { fubId? } — undo
//   POST   /api/daily-drive/set-target      — body: { target } — adjust daily goal
//   POST   /api/daily-drive/reset-today     — admin: zero out today's counter

import {
  readState, logCall, unlogCall, setTarget, resetToday,
} from '../daily-drive/state.js';

/**
 * deps:
 *   DAILY_DRIVE_PATH  — absolute path to the state file (JSON)
 */
export function register(app, deps) {
  const { DAILY_DRIVE_PATH } = deps;

  app.get('/api/daily-drive/state', (req, res) => {
    try {
      res.json({ ok: true, state: readState(DAILY_DRIVE_PATH) });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/daily-drive/log-call', (req, res) => {
    try {
      const fubId = req.body && req.body.fubId;
      const state = logCall(DAILY_DRIVE_PATH, fubId);
      res.json({ ok: true, state });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/daily-drive/unlog-call', (req, res) => {
    try {
      const fubId = req.body && req.body.fubId;
      const state = unlogCall(DAILY_DRIVE_PATH, fubId);
      res.json({ ok: true, state });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/daily-drive/set-target', (req, res) => {
    try {
      const target = req.body && req.body.target;
      const state = setTarget(DAILY_DRIVE_PATH, target);
      res.json({ ok: true, state });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/daily-drive/reset-today', (req, res) => {
    try {
      const state = resetToday(DAILY_DRIVE_PATH);
      res.json({ ok: true, state });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });
}
