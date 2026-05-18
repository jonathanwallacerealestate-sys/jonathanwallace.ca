// lib/routes/health-console.js
//
// Data Freshness Console — the dashboard for "what's broken right now?"
// Aggregates every data source feeding Agent HQ. Sprint 1 build #1 of
// the 2026-05-17 council audit.
//
// Endpoints:
//   GET /api/health/console — JSON, same schema as /api/health but with
//                             more probes (bridge, PAT expiry, proxy auth,
//                             listings store freshness, postgres).
//   GET /admin/health       — static HTML page that polls the JSON every
//                             30s and renders cards (green/amber/red).
//
// Threat model: same as /api/health and /admin/cowork-bootstrap — public
// status data, no secrets in response, no auth needed. The page consumes
// only its own /api/health/console endpoint.
//
// Created 2026-05-17 — Sprint 1 #1 (Data Freshness Console).

import fs from 'fs';

// ─────────────────────────────────────────────
// Extra probes (existing 5 live in lib/health.js)
// ─────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 5000;

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

// iMessage Bridge — call /api/bridge/status on localhost to stay decoupled
// from the bridge module's internals.
function probeBridge({ port }) {
  return withTimeout(async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/bridge/status`);
    if (!res.ok) throw new Error(`bridge status ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error('bridge returned ok=false');
    if (!data.connected) throw new Error('bridge disconnected');
    if (data.stale) throw new Error(`bridge heartbeat stale (${data.heartbeatAgeMs}ms)`);
    return {
      connected: data.connected,
      pairedTokens: data.pairedTokens,
      lastHeartbeat: data.lastHeartbeat,
      heartbeatAgeMs: data.heartbeatAgeMs,
    };
  });
}

// GitHub PAT — warn 14 days before expiry, fail if expired. Source-of-truth
// is the GITHUB_PAT_EXPIRES_AT env var; fallback to hard-coded 2026-06-15
// from the 2026-05-16 handoff.
function probePatExpiry({ expiresAt }) {
  const start = Date.now();
  if (!expiresAt) {
    return { ok: false, latencyMs: 0, error: 'GITHUB_PAT_EXPIRES_AT not set' };
  }
  const daysRemaining = Math.floor(
    (new Date(expiresAt).getTime() - Date.now()) / 86_400_000
  );
  if (daysRemaining < 0) {
    return {
      ok: false, latencyMs: Date.now() - start,
      error: `PAT expired ${-daysRemaining}d ago`,
      expiresAt, daysRemaining,
    };
  }
  if (daysRemaining < 14) {
    return {
      ok: false, latencyMs: Date.now() - start,
      error: `PAT expires in ${daysRemaining}d (rotate soon)`,
      expiresAt, daysRemaining,
    };
  }
  return { ok: true, latencyMs: Date.now() - start, expiresAt, daysRemaining };
}

// Proxy auth — just reports whether the CLAUDE_PROXY_SECRET env var is set.
// Configured-but-stale is impossible (the secret is checked per-request in
// proxy.js), so a simple presence check is enough.
function probeProxyAuth({ configured }) {
  return {
    ok: !!configured,
    latencyMs: 0,
    ...(configured ? {} : { error: 'CLAUDE_PROXY_SECRET not set' }),
  };
}

// Generic file-freshness probe (used for listings store, listtrac state,
// etc.). Treats missing-file as failure with a specific message so the UI
// can show "never synced" distinctly from "stale".
function probeFileFreshness({ filePath, maxAgeHours, label }) {
  const start = Date.now();
  try {
    if (!filePath) {
      return { ok: false, latencyMs: 0, error: `${label}: path not configured` };
    }
    if (!fs.existsSync(filePath)) {
      return { ok: false, latencyMs: Date.now() - start, error: `${label}: never synced (no file at ${filePath})` };
    }
    const stat = fs.statSync(filePath);
    const ageHours = (Date.now() - stat.mtimeMs) / 3_600_000;
    const lastModified = new Date(stat.mtimeMs).toISOString();
    if (ageHours > maxAgeHours) {
      return {
        ok: false, latencyMs: Date.now() - start,
        error: `${label}: ${ageHours.toFixed(1)}h old (threshold ${maxAgeHours}h)`,
        lastModified, ageHours: +ageHours.toFixed(1),
      };
    }
    return {
      ok: true, latencyMs: Date.now() - start,
      lastModified, ageHours: +ageHours.toFixed(1),
    };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

// Postgres — if DATABASE_URL is set, try a SELECT 1. If unset, skip
// (multi-tenant is dormant per MULTI_TENANT_ROADMAP.md).
function probePostgres({ databaseUrl, pgPool }) {
  return withTimeout(async () => {
    if (!databaseUrl) return { skipped: true };
    if (!pgPool) throw new Error('DATABASE_URL set but pgPool not provided');
    const r = await pgPool.query('SELECT 1 as ok');
    if (r.rows?.[0]?.ok !== 1) throw new Error('unexpected SELECT 1 result');
    return {};
  });
}

// ─────────────────────────────────────────────
// HTML page
// ─────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Agent HQ — Data Freshness</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: #0e1118; --panel: #161b23; --line: #232b38; --text: #e5e7eb;
    --muted: #8b94a7; --ok: #22c55e; --warn: #f59e0b; --err: #ef4444;
    --accent: #6ea8ff;
  }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
         background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
  .wrap { max-width: 1120px; margin: 0 auto; }
  header { display: flex; align-items: baseline; justify-content: space-between;
           flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
  h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
  .sub { font-size: 12px; color: var(--muted); }
  .controls { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--muted); }
  .overall { background: var(--panel); border: 1px solid var(--line);
             border-radius: 10px; padding: 14px 16px; margin-bottom: 16px;
             display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .overall .big { font-size: 22px; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .card { background: var(--panel); border: 1px solid var(--line);
          border-radius: 10px; padding: 14px 16px; }
  .card .row { display: flex; align-items: center; gap: 10px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .dot.ok   { background: var(--ok);   box-shadow: 0 0 0 4px rgba(34,197,94,.15); }
  .dot.warn { background: var(--warn); box-shadow: 0 0 0 4px rgba(245,158,11,.15); }
  .dot.err  { background: var(--err);  box-shadow: 0 0 0 4px rgba(239,68,68,.15); }
  .dot.skip { background: #6b7280; }
  .name { font-weight: 600; flex: 1; }
  .group { font-size: 10px; text-transform: uppercase; color: var(--muted);
           letter-spacing: .08em; }
  .status-pill { font-size: 10px; text-transform: uppercase; letter-spacing: .06em;
                 padding: 2px 6px; border-radius: 4px; }
  .status-pill.ok   { background: rgba(34,197,94,.12);  color: var(--ok); }
  .status-pill.warn { background: rgba(245,158,11,.14); color: var(--warn); }
  .status-pill.err  { background: rgba(239,68,68,.13);  color: var(--err); }
  .status-pill.skip { background: rgba(107,114,128,.16); color: #cbd5e1; }
  .detail { font-size: 12px; color: var(--muted); margin-top: 8px;
            display: grid; gap: 2px; }
  .err-msg { color: var(--err); font-size: 12px; margin-top: 8px;
             padding: 6px 8px; background: rgba(239,68,68,.08);
             border-radius: 6px; word-break: break-word; }
  button { background: var(--line); border: 1px solid #364159; color: var(--text);
           padding: 5px 10px; border-radius: 6px; font-size: 12px; cursor: pointer; }
  button:hover { background: #2c3648; border-color: #475569; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .pulse { animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
  .foot { margin-top: 20px; font-size: 11px; color: var(--muted); text-align: center; }
  .foot a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>Agent HQ — Data Freshness</h1>
      <div class="sub">Every source feeding HQ, refreshed every 30 seconds.</div>
    </div>
    <div class="controls">
      <span id="updated" class="pulse">Loading…</span>
      <button id="refresh" onclick="load(true)">Refresh now</button>
    </div>
  </header>
  <div class="overall" id="overall"></div>
  <div class="grid" id="grid"></div>
  <div class="foot">
    Probe endpoint: <a href="/api/health/console">/api/health/console</a> ·
    External monitor endpoint: <a href="/api/health">/api/health</a>
  </div>
</div>
<script>
const SOURCES = [
  { key: 'anthropic',     name: 'Anthropic API',       group: 'AI'      },
  { key: 'fub',           name: 'Follow Up Boss',      group: 'CRM'     },
  { key: 'drive',         name: 'Google Drive',        group: 'Storage' },
  { key: 'backup',        name: 'Drive Backup',        group: 'Storage' },
  { key: 'volume',        name: 'Railway Volume',      group: 'Infra'   },
  { key: 'bridge',        name: 'iMessage Bridge',     group: 'Comms'   },
  { key: 'listingsStore', name: 'Listings Store',      group: 'Data'    },
  { key: 'patExpiry',     name: 'GitHub PAT',          group: 'Infra'   },
  { key: 'proxyAuth',     name: 'Proxy Auth',          group: 'Infra'   },
  { key: 'postgres',      name: 'Postgres',            group: 'Infra'   },
];

function relTime(iso) {
  if (!iso) return '—';
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 1)    return 'just now';
  if (m < 60)   return Math.round(m) + 'm ago';
  if (m < 1440) return (m/60).toFixed(1) + 'h ago';
  return (m/1440).toFixed(1) + 'd ago';
}

function statusOf(check) {
  if (!check) return { cls: 'err',  label: 'NO DATA' };
  if (check.skipped) return { cls: 'skip', label: 'SKIPPED' };
  if (check.ok)      return { cls: 'ok',   label: 'OK' };
  // Warn vs hard error: presence of "expires in" / "stale" in message → warn.
  const msg = (check.error || '').toLowerCase();
  if (msg.includes('expires in') || msg.includes('stale') || msg.includes('threshold')) {
    return { cls: 'warn', label: 'WARN' };
  }
  return { cls: 'err', label: 'ERROR' };
}

function cardHtml(s, check) {
  const st = statusOf(check);
  const detailLines = [];
  if (check?.user)             detailLines.push('Account: '+check.user);
  if (check?.expiresAt)        detailLines.push('Expires: '+check.expiresAt+' ('+check.daysRemaining+'d)');
  if (check?.lastBackupAt)     detailLines.push('Last backup: '+relTime(check.lastBackupAt));
  if (check?.lastModified)     detailLines.push('Updated: '+relTime(check.lastModified));
  if (check?.lastHeartbeat)    detailLines.push('Heartbeat: '+relTime(check.lastHeartbeat));
  if (check?.pairedTokens!=null) detailLines.push('Paired tokens: '+check.pairedTokens);
  if (check?.ageHours!=null)   detailLines.push('Age: '+check.ageHours+'h');
  if (check?.dataDir)          detailLines.push('Path: '+check.dataDir);
  if (check?.latencyMs!=null && !check?.skipped) detailLines.push('Latency: '+check.latencyMs+'ms');
  const detail = detailLines.length
    ? '<div class="detail">'+detailLines.map(l=>'<div>'+l+'</div>').join('')+'</div>'
    : '';
  const err = check?.error ? '<div class="err-msg">'+escapeHtml(check.error)+'</div>' : '';
  return ''
    + '<div class="card">'
    + '  <div class="row">'
    + '    <span class="dot '+st.cls+'"></span>'
    + '    <span class="name">'+s.name+'</span>'
    + '    <span class="status-pill '+st.cls+'">'+st.label+'</span>'
    + '  </div>'
    + '  <div class="group" style="margin-top:4px">'+s.group+'</div>'
    + detail + err
    + '</div>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
  ));
}

async function load(manual) {
  const u = document.getElementById('updated');
  u.textContent = 'Loading…'; u.classList.add('pulse');
  const btn = document.getElementById('refresh'); btn.disabled = true;
  try {
    const res = await fetch('/api/health/console', { cache: 'no-store' });
    const data = await res.json();
    const checks = data.checks || {};
    const present = Object.values(checks);
    const okCount = present.filter(c => c.ok || c.skipped).length;
    const total = present.length;
    const overall = data.status === 'ok'
      ? '<span class="big" style="color:var(--ok)">All systems green</span>'
      : '<span class="big" style="color:var(--warn)">'+(total-okCount)+' issue'+(total-okCount===1?'':'s')+' to address</span>';
    document.getElementById('overall').innerHTML =
      overall
      + '<span style="color:var(--muted);font-size:12px">· '+okCount+' / '+total+' healthy · probe '+data.probeMs+'ms</span>';
    document.getElementById('grid').innerHTML =
      SOURCES.map(s => cardHtml(s, checks[s.key])).join('');
    u.textContent = 'Updated '+new Date().toLocaleTimeString();
    u.classList.remove('pulse');
  } catch (e) {
    u.textContent = 'Load failed: '+e.message;
    u.classList.remove('pulse');
  } finally {
    btn.disabled = false;
  }
}
load(true);
setInterval(load, 30000);
</script>
</body>
</html>`;

// ─────────────────────────────────────────────
// Register
// ─────────────────────────────────────────────

export function register(app, deps) {
  const {
    health,                  // imported lib/health.js module
    anthropicApiKey, fubApiKey, fubBase, fubHeaders,
    getDrive, getBackupState, dataDir,
    port,
    githubPatExpiresAt,
    proxyAuthConfigured,
    listingsStorePath,
    databaseUrl, pgPool,
  } = deps;

  app.get('/api/health/console', async (req, res) => {
    const start = Date.now();
    const backupState = typeof getBackupState === 'function' ? getBackupState() : null;
    const base = await health.runAllProbes({
      anthropicApiKey, fubApiKey, fubBase, fubHeaders,
      getDrive, backupState, dataDir,
    });
    const [bridge, postgres] = await Promise.all([
      probeBridge({ port }),
      probePostgres({ databaseUrl, pgPool }),
    ]);
    const checks = {
      ...base,
      bridge,
      listingsStore: probeFileFreshness({
        filePath: listingsStorePath, maxAgeHours: 26, label: 'listings store',
      }),
      patExpiry: probePatExpiry({ expiresAt: githubPatExpiresAt }),
      proxyAuth: probeProxyAuth({ configured: proxyAuthConfigured }),
      postgres,
    };
    const consequential = Object.values(checks).filter(c => !c.skipped);
    const allOk = consequential.every(c => c.ok);
    res.set('Cache-Control', 'no-store');
    res.status(allOk ? 200 : 503).json({
      status: allOk ? 'ok' : 'degraded',
      checkedAt: new Date().toISOString(),
      probeMs: Date.now() - start,
      checks,
    });
  });

  app.get('/admin/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(HTML);
  });

  console.log('[HealthConsole] registered /admin/health + /api/health/console');
}
