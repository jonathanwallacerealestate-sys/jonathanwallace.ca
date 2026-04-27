// lib/health.js
//
// Dependency-status probes for /api/health.
//
// Each probe is independent: one failure doesn't cascade. Each has a hard
// timeout so a slow dep doesn't hang the whole probe. Errors are caught and
// returned as { ok: false, error: ... } — never thrown.
//
// Designed so an external monitor (Make.com, UptimeRobot, etc.) can hit
// /api/health every 15 min and treat HTTP 503 as the alert trigger.

import fs from 'fs';
import path from 'path';

export const PROBE_TIMEOUT_MS = 5000;
export const BACKUP_STALENESS_HOURS = 26; // backup runs daily; 26h gives jitter buffer

async function withTimeout(fn, timeoutMs = PROBE_TIMEOUT_MS) {
  const start = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return { ok: true, latencyMs: Date.now() - start, ...(result || {}) };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

// Anthropic API: list models. Cheapest authenticated GET.
export function probeAnthropic({ apiKey }) {
  return withTimeout(async () => {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    return {};
  });
}

// Follow Up Boss API: identity endpoint confirms key is valid.
export function probeFub({ apiKey, fubBase, fubHeaders }) {
  return withTimeout(async () => {
    if (!apiKey) throw new Error('FUB_API_KEY not set');
    const res = await fetch(`${fubBase}/identity`, { headers: fubHeaders() });
    if (!res.ok) throw new Error(`fub identity ${res.status}`);
    return {};
  });
}

// Google Drive API: about.get confirms OAuth tokens are still valid.
export function probeDrive({ getDrive }) {
  return withTimeout(async () => {
    const drive = getDrive();
    if (!drive) throw new Error('drive auth not initialized (no scope or no tokens)');
    const about = await drive.about.get({ fields: 'user(emailAddress)' });
    if (!about?.data?.user?.emailAddress) throw new Error('about returned no user');
    return { user: about.data.user.emailAddress };
  });
}

// Backup staleness: if the last backup is older than BACKUP_STALENESS_HOURS,
// flag it. This is the specific failure that was silent for 24+ hours.
export function probeBackup({ backupState }) {
  return withTimeout(async () => {
    const last = backupState?.lastBackupAt;
    if (!last) {
      throw new Error('no backup has ever run');
    }
    const ageMs = Date.now() - new Date(last).getTime();
    const ageHours = ageMs / 3_600_000;
    if (ageHours > BACKUP_STALENESS_HOURS) {
      throw new Error(`last backup ${ageHours.toFixed(1)}h ago (threshold ${BACKUP_STALENESS_HOURS}h)`);
    }
    if (backupState?.lastError) {
      throw new Error(`last attempt error: ${backupState.lastError}`);
    }
    return {
      lastBackupAt: last,
      ageHours: +ageHours.toFixed(1),
    };
  });
}

// Volume: write/read/delete a probe file. Confirms the Railway volume is
// mounted, writable, and persisting.
export function probeVolume({ dataDir }) {
  return withTimeout(async () => {
    if (!dataDir) throw new Error('DATA_DIR not set');
    if (!fs.existsSync(dataDir)) throw new Error(`DATA_DIR ${dataDir} does not exist`);
    const probeFile = path.join(dataDir, '.health-probe');
    const stamp = `${Date.now()}-${Math.random()}`;
    fs.writeFileSync(probeFile, stamp);
    const read = fs.readFileSync(probeFile, 'utf8');
    fs.unlinkSync(probeFile);
    if (read !== stamp) throw new Error('write/read mismatch');
    return { dataDir };
  });
}

// Aggregate runner — call all probes in parallel and return one payload.
export async function runAllProbes(ctx) {
  const [anthropic, fub, drive, backup, volume] = await Promise.all([
    probeAnthropic({ apiKey: ctx.anthropicApiKey }),
    probeFub({ apiKey: ctx.fubApiKey, fubBase: ctx.fubBase, fubHeaders: ctx.fubHeaders }),
    probeDrive({ getDrive: ctx.getDrive }),
    probeBackup({ backupState: ctx.backupState }),
    probeVolume({ dataDir: ctx.dataDir }),
  ]);
  return {
    anthropic,
    fub,
    drive,
    backup,
    volume,
  };
}
