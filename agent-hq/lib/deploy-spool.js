// ─────────────────────────────────────────────
// DEPLOY SPOOL — Google Drive-backed deploy queue
// ─────────────────────────────────────────────
// Watches a Drive "pending" folder for bundle JSON files. For each bundle:
//   1. Validate shape, secret, TTL, replay-id
//   2. Call commitFiles() from github-deploy.js
//   3. Move the bundle file to "applied/" or "failed/"
//
// Bundle shape:
//   {
//     id: "<uuid or nanoid>",
//     requestedAt: "2026-04-22T19:50:00.000Z",
//     requestedBy: "cowork-session-pensive-gracious-cerf",  // optional label
//     message: "Commit message",
//     files: [{ path: "agent-hq/lib/foo.js", content: "..." }],
//     secret: "<matches DEPLOY_SECRET env var>",
//   }
//
// Why this exists: the Cowork sandbox's egress proxy blocks direct POSTs
// to hq.jonathanwallace.ca, but it CAN write to Google Drive via the
// user's MCP. Agent HQ (running on Railway) polls Drive and applies
// bundles on its own side. Autonomous, asynchronous, no Chrome required.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { commitFiles } from './github-deploy.js';

const POLL_INTERVAL_MS = parseInt(process.env.DEPLOY_SPOOL_POLL_MS || '30000', 10);
const PENDING_FOLDER_ID = process.env.DEPLOY_SPOOL_PENDING_FOLDER_ID || '';
const APPLIED_FOLDER_ID = process.env.DEPLOY_SPOOL_APPLIED_FOLDER_ID || '';
const FAILED_FOLDER_ID  = process.env.DEPLOY_SPOOL_FAILED_FOLDER_ID  || '';
const BUNDLE_TTL_MS = 10 * 60 * 1000; // 10 minutes — bundles older than this are rejected

// Public state snapshot for /api/admin/deploy/spool/status
const spoolState = {
  enabled: false,
  lastPollAt: null,
  lastPollOk: null,
  lastError: null,
  queueDepth: 0,
  appliedCount: 0,
  failedCount: 0,
  recent: [], // last 20 results, newest first
  config: {
    pollIntervalMs: POLL_INTERVAL_MS,
    hasPendingFolder: !!PENDING_FOLDER_ID,
    hasAppliedFolder: !!APPLIED_FOLDER_ID,
    hasFailedFolder:  !!FAILED_FOLDER_ID,
    bundleTtlMs: BUNDLE_TTL_MS,
  },
};

// ── Applied-id ledger (replay protection) ───────────────────────────────
const APPLIED_IDS_PATH = path.join(process.env.DATA_DIR || '/data', '.deploy-spool-applied.json');
let appliedIds = new Set();

function loadAppliedIds() {
  try {
    if (fs.existsSync(APPLIED_IDS_PATH)) {
      const arr = JSON.parse(fs.readFileSync(APPLIED_IDS_PATH, 'utf8'));
      if (Array.isArray(arr)) appliedIds = new Set(arr);
    }
  } catch (e) {
    console.error('[deploy-spool] failed to load applied-ids ledger:', e.message);
  }
}

function saveAppliedIds() {
  try {
    // Cap at 1000 most-recent IDs to avoid unbounded growth
    const arr = [...appliedIds].slice(-1000);
    fs.writeFileSync(APPLIED_IDS_PATH, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error('[deploy-spool] failed to save applied-ids ledger:', e.message);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────
function constantTimeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

async function moveFile(drive, fileId, newParentId) {
  const meta = await drive.files.get({ fileId, fields: 'parents' });
  const removeParents = (meta.data.parents || []).join(',');
  await drive.files.update({
    fileId,
    addParents: newParentId,
    removeParents,
    fields: 'id,parents',
  });
}

async function downloadFileText(drive, fileId) {
  const r = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  // googleapis returns the body as `data`; it can be string or buffer
  if (typeof r.data === 'string') return r.data;
  if (Buffer.isBuffer(r.data)) return r.data.toString('utf8');
  return String(r.data);
}

// ── Core polling logic ──────────────────────────────────────────────────
async function pollOnce(ctx) {
  spoolState.lastPollAt = new Date().toISOString();

  let drive;
  try {
    drive = ctx.getDrive();
  } catch (e) {
    spoolState.lastPollOk = false;
    spoolState.lastError = `Drive client unavailable: ${e.message}`;
    return;
  }
  if (!drive) {
    spoolState.lastPollOk = false;
    spoolState.lastError = 'Drive client unavailable (re-auth needed or drive scope missing)';
    return;
  }

  try {
    const list = await drive.files.list({
      q: `'${PENDING_FOLDER_ID}' in parents and trashed=false and mimeType='application/json'`,
      fields: 'files(id,name,createdTime,size,parents)',
      orderBy: 'createdTime',
      pageSize: 25,
    });
    const files = list.data.files || [];
    spoolState.queueDepth = files.length;
    spoolState.lastPollOk = true;
    spoolState.lastError = null;

    for (const f of files) {
      await processBundle(drive, f, ctx);
    }
  } catch (err) {
    spoolState.lastPollOk = false;
    spoolState.lastError = err.message;
    console.error('[deploy-spool] poll error:', err.message);
  }
}

async function processBundle(drive, file, ctx) {
  const startedAt = Date.now();
  const result = {
    fileName: file.name,
    driveFileId: file.id,
    ok: false,
    bundleId: null,
    requestedBy: null,
    error: null,
    commitSha: null,
    fileCount: null,
    finishedAt: null,
    durationMs: null,
  };

  try {
    const text = await downloadFileText(drive, file.id);
    let bundle;
    try { bundle = JSON.parse(text); }
    catch (e) { throw new Error(`invalid JSON: ${e.message}`); }

    // ── Shape validation ───────────────────────────────
    if (!bundle || typeof bundle !== 'object') throw new Error('bundle is not an object');
    if (!bundle.id || typeof bundle.id !== 'string') throw new Error('bundle.id (string) required');
    if (!bundle.requestedAt) throw new Error('bundle.requestedAt required');
    if (!bundle.message || typeof bundle.message !== 'string') throw new Error('bundle.message (string) required');
    if (!Array.isArray(bundle.files) || bundle.files.length === 0) {
      throw new Error('bundle.files must be a non-empty array');
    }
    for (const f of bundle.files) {
      if (!f?.path || typeof f.path !== 'string') throw new Error('each file needs {path: string}');
      if (typeof f.content !== 'string') throw new Error('each file needs {content: string}');
    }

    // ── Secret ─────────────────────────────────────────
    if (!bundle.secret || !constantTimeEq(bundle.secret, ctx.deploySecret)) {
      throw new Error('invalid or missing secret');
    }

    // ── Replay protection ──────────────────────────────
    if (appliedIds.has(bundle.id)) {
      throw new Error(`bundle id already applied: ${bundle.id}`);
    }

    // ── TTL ────────────────────────────────────────────
    const requestedMs = new Date(bundle.requestedAt).getTime();
    if (!Number.isFinite(requestedMs)) throw new Error('invalid requestedAt');
    const age = Date.now() - requestedMs;
    if (age > BUNDLE_TTL_MS) {
      throw new Error(`bundle expired (${Math.round(age / 60000)} min old, max ${BUNDLE_TTL_MS / 60000})`);
    }
    if (age < -60000) {
      throw new Error('bundle from the future (clock skew?)');
    }

    result.bundleId = bundle.id;
    result.requestedBy = bundle.requestedBy || 'unknown';
    result.fileCount = bundle.files.length;

    // ── Commit ─────────────────────────────────────────
    console.log(`[deploy-spool] applying bundle ${bundle.id} (${bundle.files.length} file(s)): ${bundle.message}`);
    const commit = await commitFiles({
      token: ctx.githubToken,
      owner: ctx.repoOwner,
      repo: ctx.repoName,
      branch: ctx.branch,
      message: `${bundle.message}\n\n(via Drive spool ${bundle.id.slice(0, 8)})`,
      files: bundle.files,
      author: { name: 'Agent HQ Deploy Bot', email: 'deploy@jonathanwallace.ca' },
    });

    result.ok = true;
    result.commitSha = commit.commitSha;
    appliedIds.add(bundle.id);
    saveAppliedIds();
    spoolState.appliedCount++;

    if (APPLIED_FOLDER_ID) {
      try { await moveFile(drive, file.id, APPLIED_FOLDER_ID); }
      catch (e) { console.error(`[deploy-spool] move to applied failed: ${e.message}`); }
    }
    console.log(`[deploy-spool] ✓ ${bundle.id.slice(0, 8)} → ${commit.commitSha.slice(0, 7)} (${bundle.files.length} file(s))`);

  } catch (err) {
    result.ok = false;
    result.error = err.message;
    spoolState.failedCount++;
    console.error(`[deploy-spool] ✗ ${file.name}: ${err.message}`);

    if (FAILED_FOLDER_ID) {
      try { await moveFile(drive, file.id, FAILED_FOLDER_ID); }
      catch (e) { console.error(`[deploy-spool] move to failed failed: ${e.message}`); }
    }
  }

  result.finishedAt = new Date().toISOString();
  result.durationMs = Date.now() - startedAt;
  spoolState.recent = [result, ...spoolState.recent].slice(0, 20);
  return result;
}

// ── Entry points ────────────────────────────────────────────────────────
let _timer = null;

/**
 * Start the Drive polling loop. No-op if config is missing.
 *
 * @param {object} ctx
 * @param {() => import('googleapis').drive_v3.Drive | null} ctx.getDrive  Factory for fresh authed Drive client
 * @param {string} ctx.deploySecret  Must match bundle.secret for accept
 * @param {string} ctx.githubToken   PAT with repo scope
 * @param {string} ctx.repoOwner
 * @param {string} ctx.repoName
 * @param {string} ctx.branch
 */
export function startDeploySpool(ctx) {
  if (!PENDING_FOLDER_ID) {
    console.log('[deploy-spool] DEPLOY_SPOOL_PENDING_FOLDER_ID not set — spool disabled');
    return;
  }
  if (!ctx?.deploySecret || !ctx?.githubToken || !ctx?.repoOwner || !ctx?.repoName) {
    console.log('[deploy-spool] missing deploy secret / github config — spool disabled');
    return;
  }
  if (_timer) {
    console.log('[deploy-spool] already running — ignoring duplicate start');
    return;
  }

  loadAppliedIds();
  spoolState.enabled = true;
  console.log(`[deploy-spool] starting — polling every ${POLL_INTERVAL_MS}ms, pending=${PENDING_FOLDER_ID.slice(0, 8)}…`);

  // Fire once immediately so we don't wait POLL_INTERVAL_MS for first pickup
  pollOnce(ctx).catch(e => console.error('[deploy-spool] initial poll errored:', e.message));
  _timer = setInterval(() => {
    pollOnce(ctx).catch(e => console.error('[deploy-spool] poll errored:', e.message));
  }, POLL_INTERVAL_MS);
}

/** Stop the polling loop (used in tests). */
export function stopDeploySpool() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  spoolState.enabled = false;
}

/** Snapshot of state for the status endpoint. */
export function getSpoolState() {
  return {
    ...spoolState,
    recent: spoolState.recent.slice(0, 10),
    appliedLedgerSize: appliedIds.size,
  };
}
