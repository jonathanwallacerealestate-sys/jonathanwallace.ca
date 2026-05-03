// lib/daily-drive/state.js
//
// Daily Drive state — tracks daily call target, today's calls made, and
// the consecutive-day streak. Lightweight JSON file at ${DATA_DIR}/.daily-drive.json.
//
// Streak logic (the loss-aversion engine):
//   - "Met goal" = today's calls >= today's target
//   - If today met goal AND yesterday met goal → streak += 1
//   - If today met goal AND yesterday did NOT → streak = 1
//   - If today did NOT meet goal AND it's now tomorrow → streak resets to 0
//
// We compute streak fresh on every read so it stays accurate even when the
// app sleeps overnight.

import fs from 'fs';
import path from 'path';

const DEFAULTS = {
  config: { dailyTarget: 5, agentName: 'Jonathan' },
  history: [], // [{ date: 'YYYY-MM-DD', callsMade: N, target: N, metGoal: bool }]
  today: { date: null, callsMade: 0, loggedFubIds: [] },
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayISO(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function loadState(filePath) {
  if (!fs.existsSync(filePath)) return JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { ...DEFAULTS, ...raw, config: { ...DEFAULTS.config, ...(raw.config || {}) } };
  } catch (e) {
    console.warn('[daily-drive] state load failed, using defaults:', e.message);
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function saveState(filePath, state) {
  try { fs.writeFileSync(filePath, JSON.stringify(state, null, 2)); }
  catch (e) { console.error('[daily-drive] save failed:', e.message); }
}

// Roll today's counters into history when the date changes.
function rollover(state) {
  const today = todayISO();
  if (!state.today.date) {
    state.today = { date: today, callsMade: 0, loggedFubIds: [] };
    return;
  }
  if (state.today.date !== today) {
    // Save yesterday's record into history
    const target = state.config.dailyTarget;
    const callsMade = state.today.callsMade || 0;
    state.history = state.history || [];
    // Avoid duplicate history entries
    const existing = state.history.find(h => h.date === state.today.date);
    if (!existing) {
      state.history.push({
        date: state.today.date,
        callsMade,
        target,
        metGoal: callsMade >= target,
      });
    }
    // Cap history at 365 days
    if (state.history.length > 365) state.history = state.history.slice(-365);
    state.today = { date: today, callsMade: 0, loggedFubIds: [] };
  }
}

// Compute streak from the history. Walks backward from today, counting
// consecutive days that met goal. Today counts if metGoal already; otherwise
// streak is "based on yesterday's chain" until today meets goal.
function computeStreak(state) {
  const today = todayISO();
  const target = state.config.dailyTarget;
  const todayMet = (state.today.callsMade || 0) >= target;

  // Build a date → metGoal map from history
  const map = {};
  for (const h of state.history || []) {
    map[h.date] = h.metGoal;
  }
  map[today] = todayMet;

  // Walk backward from today
  let streak = 0;
  let cursor = today;
  for (let i = 0; i < 365; i++) {
    if (map[cursor] === true) {
      streak += 1;
      cursor = yesterdayISO(cursor);
    } else {
      // If today not yet met but yesterday was, return yesterday's chain length
      // (so the user sees their existing streak, not 0, until their day fails)
      if (cursor === today && !todayMet) {
        // continue to yesterday and count from there as the "active" streak
        cursor = yesterdayISO(cursor);
        continue;
      }
      break;
    }
  }
  return streak;
}

function computeLongestStreak(state) {
  const target = state.config.dailyTarget;
  const todayMet = (state.today.callsMade || 0) >= target;
  const dates = (state.history || []).map(h => h.date).sort();
  if (todayMet) dates.push(state.today.date);

  // Build a sorted list of metGoal entries
  const metMap = {};
  for (const h of state.history || []) metMap[h.date] = h.metGoal;
  metMap[state.today.date] = todayMet;

  let longest = 0;
  let current = 0;
  let prevDate = null;
  for (const date of Object.keys(metMap).sort()) {
    if (metMap[date]) {
      if (prevDate && yesterdayISO(date) === prevDate) {
        current += 1;
      } else {
        current = 1;
      }
      if (current > longest) longest = current;
      prevDate = date;
    } else {
      current = 0;
      prevDate = date;
    }
  }
  return longest;
}

// Public API
export function readState(filePath) {
  const state = loadState(filePath);
  rollover(state);
  saveState(filePath, state); // persist any rollover
  const target = state.config.dailyTarget;
  const callsMade = state.today.callsMade || 0;
  return {
    config: state.config,
    today: {
      date: state.today.date,
      callsMade,
      target,
      remaining: Math.max(0, target - callsMade),
      metGoal: callsMade >= target,
      loggedFubIds: state.today.loggedFubIds || [],
    },
    streak: {
      current: computeStreak(state),
      longest: computeLongestStreak(state),
    },
    history: (state.history || []).slice(-30), // last 30 days for UI
  };
}

export function logCall(filePath, fubId) {
  const state = loadState(filePath);
  rollover(state);
  state.today.loggedFubIds = state.today.loggedFubIds || [];
  // De-dupe — calling the same person twice in a day shouldn't double-count
  if (fubId && !state.today.loggedFubIds.includes(String(fubId))) {
    state.today.loggedFubIds.push(String(fubId));
    state.today.callsMade = state.today.loggedFubIds.length;
  } else if (!fubId) {
    // No fubId — generic increment (manual log)
    state.today.callsMade = (state.today.callsMade || 0) + 1;
  }
  saveState(filePath, state);
  return readState(filePath);
}

export function unlogCall(filePath, fubId) {
  const state = loadState(filePath);
  rollover(state);
  if (fubId) {
    state.today.loggedFubIds = (state.today.loggedFubIds || []).filter(id => id !== String(fubId));
    state.today.callsMade = state.today.loggedFubIds.length;
  } else {
    state.today.callsMade = Math.max(0, (state.today.callsMade || 0) - 1);
  }
  saveState(filePath, state);
  return readState(filePath);
}

export function setTarget(filePath, target) {
  const state = loadState(filePath);
  rollover(state);
  state.config.dailyTarget = Math.max(1, Math.min(50, parseInt(target) || 5));
  saveState(filePath, state);
  return readState(filePath);
}

export function resetToday(filePath) {
  const state = loadState(filePath);
  rollover(state);
  state.today.callsMade = 0;
  state.today.loggedFubIds = [];
  saveState(filePath, state);
  return readState(filePath);
}
