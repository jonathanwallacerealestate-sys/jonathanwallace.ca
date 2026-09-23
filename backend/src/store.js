'use strict';

const fs = require('fs');
const path = require('path');
const { buildSeed } = require('./seed');

function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return path.join(__dirname, '..', 'data');
}

function createStore(dataDir) {
  const file = path.join(dataDir, 'desk-snapshots.json');
  let broken = null;
  let state = { snapshots: {} };

  function load() {
    try {
      if (!fs.existsSync(file)) {
        broken = null;
        state = { snapshots: {} };
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !parsed.snapshots || typeof parsed.snapshots !== 'object') {
        throw new Error('Snapshot file is missing a snapshots object');
      }
      state = { snapshots: parsed.snapshots };
      broken = null;
    } catch (err) {
      broken = err.message;
      state = { snapshots: {} };
    }
  }

  function write(next) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next));
    fs.renameSync(tmp, file);
    state = next;
    broken = null;
  }

  load();

  function upsert(snapshot) {
    const next = {
      snapshots: { ...state.snapshots, [snapshot.date]: snapshot }
    };
    write(next);
    return snapshot;
  }

  function get(date) {
    return state.snapshots[date] ? { ...state.snapshots[date] } : null;
  }

  function dates() {
    return Object.keys(state.snapshots).sort();
  }

  function previous(date) {
    const older = dates().filter((d) => d < date);
    if (!older.length) return null;
    return get(older[older.length - 1]);
  }

  function lastSnapshot() {
    let best = null;
    for (const snap of Object.values(state.snapshots)) {
      if (!best || String(snap.updatedAt) > String(best.updatedAt)) best = snap;
    }
    return best ? { ...best } : null;
  }

  function seedIfEmpty(today) {
    if (broken) return null;
    if (Object.keys(state.snapshots).length > 0) return null;
    const seed = buildSeed(today);
    upsert(seed);
    return seed;
  }

  function health() {
    return {
      ok: !broken,
      driver: 'file',
      dataDir,
      error: broken
    };
  }

  return { upsert, get, previous, lastSnapshot, seedIfEmpty, health, file };
}

module.exports = { createStore, resolveDataDir };
