// lib/routes/bootstrap.js
//
// Cowork session bootstrap — serves a static HTML page that returns the
// CLAUDE_PROXY_SECRET stored in the requesting browser's localStorage.
//
// Threat model: the server NEVER holds or serves the secret. The page is
// pure HTML+JS. Only Jonathan's already-logged-in Chrome profile (the same
// one Cowork's Chrome MCP attaches to) has the secret in localStorage.
// Anyone hitting this URL from another browser just gets an empty <pre>.
//
// One-time seed:
//   Jonathan visits /admin/cowork-bootstrap?seed=<proxy_secret> once.
//   JS stores it in localStorage and replaceState-cleans the URL.
//
// Every Cowork session forward:
//   Chrome MCP → navigate to /admin/cowork-bootstrap → read #aghq-secret.
//
// Created 2026-05-17 to close Task #14 (cross-session secret access).

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Agent HQ — Cowork Bootstrap</title>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { color: #555; margin: 4px 0 16px; }
  pre { background: #f4f4f4; padding: 14px; border-radius: 6px; border: 1px solid #ddd; font-size: 13px; word-break: break-all; white-space: pre-wrap; }
  .ok { color: #1f7a1f; }
  .empty { color: #999; font-style: italic; }
  .seeded { color: #1f7a1f; font-weight: 600; }
  code { background: #eee; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
</style>
</head>
<body>
<h1>Agent HQ — Cowork Bootstrap</h1>
<p id="status">Loading...</p>
<pre id="aghq-secret" data-present="0"></pre>
<p style="font-size:12px;color:#888;">This page reads <code>aghq_cowork_secret</code> from this browser's localStorage and renders it above. Cowork sessions read it via Chrome MCP. Pure client-side — the server never holds the secret.</p>
<script>
(function(){
  var params = new URLSearchParams(location.search);
  var seed = params.get('seed');
  var seeded = false;
  if (seed && seed.length >= 16) {
    localStorage.setItem('aghq_cowork_secret', seed);
    seeded = true;
    history.replaceState({}, '', location.pathname);
  }
  var clearFlag = params.get('clear');
  if (clearFlag === '1') {
    localStorage.removeItem('aghq_cowork_secret');
    history.replaceState({}, '', location.pathname);
  }
  var secret = localStorage.getItem('aghq_cowork_secret') || '';
  var el = document.getElementById('aghq-secret');
  var status = document.getElementById('status');
  if (secret) {
    el.textContent = secret;
    el.dataset.present = '1';
    status.innerHTML = seeded
      ? '<span class="seeded">Seed accepted and stored. Future Cowork sessions can pick this up automatically.</span>'
      : '<span class="ok">Secret available in this browser.</span>';
  } else {
    el.textContent = '';
    el.dataset.present = '0';
    status.innerHTML = '<span class="empty">No secret stored in this browser yet. Visit this URL once with <code>?seed=&lt;your CLAUDE_PROXY_SECRET&gt;</code>.</span>';
  }
})();
</script>
</body>
</html>`;

export function register(app, _deps) {
  app.get('/admin/cowork-bootstrap', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(HTML);
  });
  console.log('[Bootstrap] registered /admin/cowork-bootstrap');
}
