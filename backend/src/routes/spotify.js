/**
 * Spotify integration — OAuth flow + recently-played podcast episode pull.
 *
 * Activation:
 *   1. Register an app at https://developer.spotify.com/dashboard
 *   2. Set Redirect URI to: <RAILWAY_URL>/api/spotify/callback
 *   3. Save client id + secret in dashboard Settings → Integrations
 *   4. From the Learning Capture card, click "Connect Spotify" — that
 *      opens the auth URL and we store the refresh token automatically.
 *
 * Once connected, /api/spotify/sync pulls recently-played items
 * (max 50 from Spotify API), upserts shows as learning_sources, upserts
 * podcast episodes as learning_log rows, and triggers extraction.
 *
 * Music tracks are skipped — we only care about podcast episodes.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/apiKey');
const { publish } = require('../services/events');

router.use((req, res, next) => {
  // Allow the OAuth callback through without API key (Spotify won't send it)
  if (req.path === '/callback') return next();
  return require('../middleware/apiKey').requireApiKey(req, res, next);
});

const SCOPE = 'user-read-recently-played user-read-playback-state';

// ---------- Settings helpers ----------
async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  if (!rows.length || rows[0].value == null) return null;
  return rows[0].value;
}
async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

function buildRedirectUri(req) {
  const fromSetting = process.env.SPOTIFY_REDIRECT_URI;
  if (fromSetting) return fromSetting;
  // Best-effort from request — works when called from the dashboard
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/spotify/callback`;
}

// GET /api/spotify/status — config + connection info
router.get('/status', async (req, res) => {
  const [clientId, clientSecret, refresh] = await Promise.all([
    getSetting('spotify_client_id'),
    getSetting('spotify_client_secret'),
    getSetting('spotify_refresh_token')
  ]);
  res.json({
    configured: !!(clientId && clientSecret),
    connected: !!refresh,
    redirect_uri: buildRedirectUri(req)
  });
});

// GET /api/spotify/auth-url — returns the authorize URL the dashboard pops open
router.get('/auth-url', async (req, res) => {
  const clientId = await getSetting('spotify_client_id');
  if (!clientId) return res.status(400).json({ error: 'Set spotify_client_id in Settings first' });
  const state = require('crypto').randomBytes(16).toString('hex');
  await setSetting('spotify_oauth_state', state);
  const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: buildRedirectUri(req),
    scope: SCOPE,
    state
  }).toString();
  res.json({ url });
});

// GET /api/spotify/callback?code=...&state=... — Spotify redirects here
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.send('<p>Spotify denied: ' + String(error) + '</p>');
    if (!code) return res.status(400).send('<p>Missing code.</p>');

    const expected = await getSetting('spotify_oauth_state');
    if (state !== expected) return res.status(400).send('<p>State mismatch — please retry from the dashboard.</p>');

    const [clientId, clientSecret] = await Promise.all([
      getSetting('spotify_client_id'),
      getSetting('spotify_client_secret')
    ]);

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: buildRedirectUri(req)
      }).toString()
    });
    const json = await tokenRes.json();
    if (!tokenRes.ok) return res.status(500).send('<pre>' + JSON.stringify(json, null, 2) + '</pre>');
    if (!json.refresh_token) return res.status(500).send('<p>Spotify did not return a refresh token.</p>');

    await setSetting('spotify_refresh_token', json.refresh_token);

    res.send(`<!DOCTYPE html><html><body style="font-family:system-ui;background:#0a1628;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center">
      <div>
        <h1 style="color:#c9a96e">Connected.</h1>
        <p>Spotify is now wired up. You can close this tab.</p>
      </div>
    </body></html>`);
  } catch (err) {
    console.error('spotify callback error:', err);
    res.status(500).send('<pre>' + (err.message || 'Unknown error') + '</pre>');
  }
});

// ---------- Token + API helpers ----------
async function getAccessToken() {
  const [clientId, clientSecret, refresh] = await Promise.all([
    getSetting('spotify_client_id'),
    getSetting('spotify_client_secret'),
    getSetting('spotify_refresh_token')
  ]);
  if (!refresh) throw new Error('Spotify not connected — visit /api/spotify/auth-url first');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }).toString()
  });
  const json = await r.json();
  if (!r.ok) throw new Error('Token refresh failed: ' + (json.error_description || JSON.stringify(json)));
  return json.access_token;
}

// POST /api/spotify/sync — pull recently-played and ingest podcast episodes
router.post('/sync', async (req, res) => {
  try {
    const token = await getAccessToken();
    const r = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(500).json({ error: 'Spotify API error', detail: t });
    }
    const data = await r.json();
    const items = data.items || [];

    let newEpisodes = 0;
    for (const it of items) {
      const track = it.track;
      // Spotify recently-played mostly returns tracks. For podcasts we need the
      // /episodes endpoint per track, but the basic shape lets us detect type.
      if (!track || track.type !== 'episode') continue;

      const ep = track;
      const showName = ep.show?.name || 'Unknown show';
      const showId = ep.show?.id;

      let sourceId = null;
      if (showId) {
        const src = await pool.query(
          `INSERT INTO learning_sources (kind, name, external_id, url)
           VALUES ('spotify_show', $1, $2, $3)
           ON CONFLICT (kind, external_id) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [showName, showId, ep.show?.external_urls?.spotify || null]
        );
        sourceId = src.rows[0].id;
      }

      // Skip if already logged
      const exists = await pool.query(
        'SELECT id FROM learning_log WHERE kind = $1 AND external_id = $2',
        ['spotify_episode', ep.id]
      );
      if (exists.rows.length) continue;

      await pool.query(
        `INSERT INTO learning_log
          (source_id, kind, title, author, external_id, url, consumed_at,
           duration_seconds, raw_notes)
         VALUES ($1,'spotify_episode',$2,$3,$4,$5,$6,$7,$8)`,
        [sourceId, ep.name, showName, ep.id,
         ep.external_urls?.spotify || null,
         it.played_at || null,
         ep.duration_ms ? Math.round(ep.duration_ms / 1000) : null,
         (ep.description || '').slice(0, 8000)]
      );
      newEpisodes++;
    }

    publish({ type: 'learning', event: 'spotify_sync', new_episodes: newEpisodes });
    res.json({ success: true, new_episodes: newEpisodes, scanned: items.length });
  } catch (err) {
    console.error('spotify sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
