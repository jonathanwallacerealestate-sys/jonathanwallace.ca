// lib/routes/proxy.js
//
// API proxy for GitHub + Railway. Used by Claude Cowork sessions, scheduled tasks,
// or any other client that needs to talk to GitHub/Railway WITHOUT holding those
// PATs locally. The proxy adds the upstream Authorization header server-side and
// passes through everything else.
//
// Auth: Authorization: Bearer <CLAUDE_PROXY_SECRET>
//   - CLAUDE_PROXY_SECRET is a 32-byte hex shared secret set on Railway env vars
//     and saved to ~/.config/aghq/tokens.json on Jonathan's Mac.
//   - Without it, the proxy returns 401. Health endpoint is the only unauthenticated one.
//
// Endpoints:
//   GET  /api/proxy/health             — does NOT require auth; reports env-var presence
//   ANY  /api/proxy/github/<path...>   — forwards to https://api.github.com/<path...>
//   POST /api/proxy/railway            — forwards to https://backboard.railway.app/graphql/v2
//
// Upstream status + body are passed through. Connection errors → 502.
//
// Created 2026-05-16 to close the cross-session token-access loop.

import crypto from 'crypto';

const GITHUB_BASE  = 'https://api.github.com';
const RAILWAY_BASE = 'https://backboard.railway.app/graphql/v2';

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function isProxyAuthorized(req) {
  const expected = process.env.CLAUDE_PROXY_SECRET;
  if (!expected || expected.length < 16) return false;
  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return false;
  return constantTimeEqual(m[1].trim(), expected);
}

async function proxyUpstream(req, res, upstreamUrl, upstreamHeaders) {
  const init = { method: req.method, headers: { ...upstreamHeaders } };
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
    init.body = JSON.stringify(req.body);
    init.headers['Content-Type'] = 'application/json';
  }
  try {
    const r = await fetch(upstreamUrl, init);
    const body = await r.text();
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.set('Content-Type', ct);
    // Pass through pagination + rate-limit headers when present
    for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'link']) {
      const v = r.headers.get(h);
      if (v) res.set(h, v);
    }
    res.send(body);
  } catch (e) {
    console.error('[Proxy] upstream error:', e.message);
    res.status(502).json({ ok: false, error: 'upstream error', detail: e.message });
  }
}

export function register(app, _deps) {
  // Health — does NOT require auth (so anyone can probe whether the proxy is alive).
  // Only reports presence of env vars, never values.
  app.get('/api/proxy/health', (req, res) => {
    res.json({
      ok: true,
      proxyAuthConfigured: !!(process.env.CLAUDE_PROXY_SECRET && process.env.CLAUDE_PROXY_SECRET.length >= 16),
      githubConfigured: !!process.env.GITHUB_PAT,
      railwayConfigured: !!process.env.RAILWAY_API_TOKEN,
      checkedAt: new Date().toISOString(),
    });
  });

  // GitHub passthrough — any HTTP method.
  // Path after /api/proxy/github/ is appended to https://api.github.com/
  // Examples:
  //   GET  /api/proxy/github/repos/foo/bar
  //   PUT  /api/proxy/github/repos/foo/bar/contents/baz.md   (with body { message, content, sha? })
  app.all('/api/proxy/github/*', async (req, res) => {
    if (!isProxyAuthorized(req)) return res.status(401).json({ ok: false, error: 'proxy auth required' });
    if (!process.env.GITHUB_PAT) return res.status(503).json({ ok: false, error: 'GITHUB_PAT not configured' });

    // Strip the prefix; keep query string.
    const subPath = req.originalUrl.replace(/^\/api\/proxy\/github\//, '/');
    const upstreamUrl = GITHUB_BASE + subPath;

    await proxyUpstream(req, res, upstreamUrl, {
      'Authorization': 'Bearer ' + process.env.GITHUB_PAT,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'agent-hq-proxy/1.0',
    });
  });

  // Railway GraphQL passthrough.
  // POST /api/proxy/railway with body { query, variables? }
  app.post('/api/proxy/railway', async (req, res) => {
    if (!isProxyAuthorized(req)) return res.status(401).json({ ok: false, error: 'proxy auth required' });
    if (!process.env.RAILWAY_API_TOKEN) return res.status(503).json({ ok: false, error: 'RAILWAY_API_TOKEN not configured' });

    await proxyUpstream(req, res, RAILWAY_BASE, {
      'Authorization': 'Bearer ' + process.env.RAILWAY_API_TOKEN,
    });
  });

  console.log('[Proxy] registered /api/proxy/health, /api/proxy/github/*, /api/proxy/railway');
}
