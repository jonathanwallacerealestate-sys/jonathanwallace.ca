// lib/routes/bridge.js
//
// Mac Bridge — WebSocket endpoint at wss://hq.jonathanwallace.ca/bridge that the
// local Mac daemon connects to. Holds the connection open and exposes a
// `callBridge(method, params)` helper so other route modules (e.g. teb.js) can
// run remote procedure calls against the Mac (read chat.db, send iMessage).
//
// Endpoints:
//   GET  /api/bridge/status          — connection state + last heartbeat
//   POST /api/bridge/pair/init       — generate a 6-digit pairing code (auth: session)
//   POST /api/bridge/pair/complete   — Mac exchanges code for a bearer token
//   WS   /bridge                     — Mac daemon connects here with Bearer auth
//
// Trust model:
//   - Pairing code: 6 digits, single-use, 5-minute TTL. Only issued to an
//     authenticated session (or always-allowed in single-tenant mode).
//   - Bearer token: 256-bit random, generated server-side at pair time, returned
//     once to the Mac, stored on disk as sha256(token) — plaintext never persists.
//   - WS: required Authorization: Bearer <token> header at the HTTP upgrade.
//
// Wire format (over the WS, JSON per frame):
//   server → mac:  { id: "<rpc-id>", method: "...", params: { ... } }
//   mac → server:  { id: "<rpc-id>", result: { ... } }      // success
//                  { id: "<rpc-id>", error:  "<message>" }  // failure
//                  { type: "heartbeat", ts: ISO }           // unsolicited
//
// Created 2026-05-14 PM for the TEB rebuild architecture (council audit).

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';

const STATE_FILENAME = '.bridge.json';
const PAIR_CODE_TTL_MS = 5 * 60 * 1000;       // 5 minutes
const RPC_TIMEOUT_MS = 15 * 1000;             // 15 seconds per RPC
const HEARTBEAT_GRACE_MS = 60 * 1000;         // 60s stale = "stale" in status
const PING_INTERVAL_MS   = 20 * 1000;        // server pings every 20s to keep proxy alive
const TOKEN_BYTES = 32;                       // 256-bit
const CODE_BYTES = 3;                         // 6 hex digits → numeric below

// ─── Module state ─────────────────────────────────────────────────────
//
// One connected Mac at a time (single-tenant). When a second Mac connects,
// the first is closed. Reconnects from the same Mac just replace the slot.

let liveSocket = null;
let liveSocketConnectedAt = null;
let liveSocketLastHeartbeat = null;
const pendingRpcs = new Map();   // rpcId → { resolve, reject, timer, method }
const pendingPairs = new Map();  // code → { issuedAt, issuedBy }

// Token store: sha256(token) → { createdAt, label }
// Persisted to disk so a server restart doesn't force re-pairing.
let tokenStore = { tokens: {}, createdAt: null };
let stateInitialized = false;

function loadState(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.tokens && typeof parsed.tokens === 'object') {
        tokenStore = parsed;
      }
    }
  } catch (e) {
    console.error('[Bridge] load error:', e.message);
  }
  stateInitialized = true;
}

function saveState(filePath) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(tokenStore, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error('[Bridge] save error:', e.message);
  }
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function generatePairingCode() {
  // 6-digit numeric code. 1 in 1,000,000 — fine given 5-min TTL and one issuer.
  return crypto.randomInt(100000, 1000000).toString();
}

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function isSingleTenant() {
  // Mirrors lib/auth-middleware.js logic. Single-tenant = no DB-backed auth.
  return process.env.MULTI_TENANT !== 'enforced';
}

function isAuthorized(req) {
  // In single-tenant mode, any same-origin caller is trusted (mirrors how
  // imessage.js read endpoints behave). In multi-tenant mode, require a session.
  if (isSingleTenant()) return true;
  return !!req.user || !!(req.session && req.session.userId);
}

// ─── RPC helper exposed to other modules ──────────────────────────────
//
// Returns a Promise that resolves with the Mac's response, or rejects on
// timeout / disconnect / Mac-side error.
//
// Other modules import this directly:
//   import { callBridge } from './bridge.js';
//   const queue = await callBridge('imessage.queue', { sinceDays: 14 });

export async function callBridge(method, params = {}, { timeoutMs = RPC_TIMEOUT_MS } = {}) {
  if (!liveSocket || liveSocket.readyState !== liveSocket.OPEN) {
    const err = new Error('Mac Bridge not connected');
    err.code = 'BRIDGE_DISCONNECTED';
    throw err;
  }
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRpcs.delete(id);
      const err = new Error(`Bridge RPC '${method}' timed out after ${timeoutMs}ms`);
      err.code = 'BRIDGE_TIMEOUT';
      reject(err);
    }, timeoutMs);
    pendingRpcs.set(id, { resolve, reject, timer, method });
    try {
      liveSocket.send(JSON.stringify({ id, method, params }));
    } catch (e) {
      clearTimeout(timer);
      pendingRpcs.delete(id);
      reject(e);
    }
  });
}

export function getBridgeStatus() {
  const connected = !!(liveSocket && liveSocket.readyState === liveSocket.OPEN);
  const heartbeatAge = liveSocketLastHeartbeat
    ? Date.now() - new Date(liveSocketLastHeartbeat).getTime()
    : null;
  return {
    connected,
    connectedAt: liveSocketConnectedAt,
    lastHeartbeat: liveSocketLastHeartbeat,
    heartbeatAgeMs: heartbeatAge,
    stale: connected && heartbeatAge != null && heartbeatAge > HEARTBEAT_GRACE_MS,
    pendingRpcs: pendingRpcs.size,
    pairedTokens: Object.keys(tokenStore.tokens).length,
  };
}

// ─── WebSocket attach ────────────────────────────────────────────────
//
// Called from server.js after http.createServer(app). Attaches a WSS to the
// HTTP server's 'upgrade' event so we can validate the Bearer token BEFORE
// promoting to a WebSocket connection.

export function attachWebSocket(httpServer, { filePath }) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/bridge') return; // let other upgrade handlers (if any) try

    // Auth: Bearer token in Authorization header
    const auth = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    if (!match) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const token = match[1].trim();
    const hashed = sha256(token);
    if (!tokenStore.tokens[hashed]) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      // Close any existing connection — only one Mac at a time.
      if (liveSocket && liveSocket !== ws) {
        try { liveSocket.close(1000, 'replaced by newer connection'); } catch {}
      }
      liveSocket = ws;
      liveSocket.isAlive = true;
      liveSocketConnectedAt = new Date().toISOString();
      liveSocketLastHeartbeat = liveSocketConnectedAt;
      console.log(`[Bridge] Mac connected (token=${hashed.slice(0, 8)}…)`);

      ws.on('pong', () => {
        ws.isAlive = true;
        liveSocketLastHeartbeat = new Date().toISOString();
      });

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); }
        catch { return console.warn('[Bridge] bad JSON frame'); }

        if (msg.type === 'heartbeat') {
          liveSocketLastHeartbeat = new Date().toISOString();
          return;
        }
        if (msg.id && pendingRpcs.has(msg.id)) {
          const pending = pendingRpcs.get(msg.id);
          clearTimeout(pending.timer);
          pendingRpcs.delete(msg.id);
          if (msg.error) {
            const err = new Error(msg.error);
            err.code = 'BRIDGE_RPC_ERROR';
            pending.reject(err);
          } else {
            pending.resolve(msg.result);
          }
          return;
        }
        console.warn('[Bridge] orphan message:', msg.id || '(no id)');
      });

      ws.on('close', (code, reason) => {
        if (liveSocket === ws) {
          console.log(`[Bridge] Mac disconnected (code=${code} reason=${reason || '-'})`);
          liveSocket = null;
          liveSocketConnectedAt = null;
          liveSocketLastHeartbeat = null;
          // Reject any in-flight RPCs
          for (const [id, p] of pendingRpcs.entries()) {
            clearTimeout(p.timer);
            const err = new Error(`Bridge disconnected during '${p.method}'`);
            err.code = 'BRIDGE_DISCONNECTED';
            p.reject(err);
            pendingRpcs.delete(id);
          }
        }
      });

      ws.on('error', (err) => {
        console.error('[Bridge] socket error:', err.message);
      });
    });
  });

  // Periodically prune stale pairing codes
  setInterval(() => {
    const now = Date.now();
    for (const [code, info] of pendingPairs.entries()) {
      if (now - info.issuedAt > PAIR_CODE_TTL_MS) pendingPairs.delete(code);
    }
  }, 60_000);


  // WS-level ping every 20s keeps the proxy from idle-killing the TCP connection.
  // Pongs are auto-replied by the ws library on the Mac side; the 'pong' handler
  // above resets isAlive and updates liveSocketLastHeartbeat.
  const pingInterval = setInterval(() => {
    if (!liveSocket) return;
    if (liveSocket.isAlive === false) {
      console.log('[Bridge] no pong since last ping — terminating stale connection');
      try { liveSocket.terminate(); } catch {}
      return;
    }
    liveSocket.isAlive = false;
    try { liveSocket.ping(); } catch (e) { console.error('[Bridge] ping failed:', e.message); }
  }, PING_INTERVAL_MS);

  wss.on('close', () => clearInterval(pingInterval));
  return wss;
}

// ─── HTTP routes ─────────────────────────────────────────────────────

export function register(app, deps) {
  const { DATA_DIR } = deps;
  const filePath = path.join(DATA_DIR, STATE_FILENAME);
  if (!stateInitialized) loadState(filePath);

  // GET /api/bridge/status — public read of connection state.
  // Used by the TEB header to show a green/red dot.
  app.get('/api/bridge/status', (req, res) => {
    res.json({ ok: true, ...getBridgeStatus() });
  });

  // POST /api/bridge/pair/init — issue a 6-digit code (5min TTL, single-use).
  // Requires an authenticated session in multi-tenant mode.
  app.post('/api/bridge/pair/init', (req, res) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'authentication required' });
    }
    const code = generatePairingCode();
    pendingPairs.set(code, {
      issuedAt: Date.now(),
      issuedBy: req.user?.id || 'single-tenant',
    });
    console.log(`[Bridge] pairing code issued (expires in ${PAIR_CODE_TTL_MS / 60000} min)`);
    res.json({
      ok: true,
      code,
      expiresAt: new Date(Date.now() + PAIR_CODE_TTL_MS).toISOString(),
    });
  });

  // POST /api/bridge/pair/complete — Mac exchanges code for a bearer token.
  // Body: { code: "123456", label?: "MacBook Pro 2024" }
  // No session auth — auth IS the code (single-use, short TTL).
  app.post('/api/bridge/pair/complete', (req, res) => {
    const code = String(req.body?.code || '').trim();
    const label = String(req.body?.label || 'unlabeled').slice(0, 60);
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, error: 'code must be 6 digits' });
    }
    const info = pendingPairs.get(code);
    if (!info) {
      return res.status(401).json({ ok: false, error: 'unknown or expired code' });
    }
    if (Date.now() - info.issuedAt > PAIR_CODE_TTL_MS) {
      pendingPairs.delete(code);
      return res.status(401).json({ ok: false, error: 'code expired' });
    }
    pendingPairs.delete(code);

    const token = generateToken();
    const hashed = sha256(token);
    tokenStore.tokens[hashed] = {
      createdAt: new Date().toISOString(),
      label,
    };
    tokenStore.createdAt = tokenStore.createdAt || new Date().toISOString();
    saveState(filePath);

    console.log(`[Bridge] paired token (label=${label}, hash=${hashed.slice(0, 8)}…)`);
    res.json({
      ok: true,
      token, // plaintext, only chance to read it
      wsUrl: 'wss://' + (req.get('host') || 'hq.jonathanwallace.ca') + '/bridge',
    });
  });

  // POST /api/bridge/pair/revoke — admin-only, by hash prefix.
  app.post('/api/bridge/pair/revoke', (req, res) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'authentication required' });
    }
    const prefix = String(req.body?.hashPrefix || '').trim();
    if (prefix.length < 8) {
      return res.status(400).json({ ok: false, error: 'hashPrefix must be ≥8 chars' });
    }
    let revoked = 0;
    for (const h of Object.keys(tokenStore.tokens)) {
      if (h.startsWith(prefix)) {
        delete tokenStore.tokens[h];
        revoked++;
      }
    }
    if (revoked > 0) saveState(filePath);
    // Close any live socket whose token matches (we don't know which token the
    // live socket used by hash, so just close it — Mac will re-auth if its token
    // wasn't the revoked one).
    if (liveSocket) {
      try { liveSocket.close(1000, 'token revoked, please re-pair'); } catch {}
    }
    res.json({ ok: true, revoked });
  });
}
