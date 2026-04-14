/**
 * API key middleware for protecting endpoints from unauthorized access.
 * Make.com and other integrations send X-API-Key header.
 * Website form submissions use CORS origin check instead.
 */
function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.API_KEY;

  if (!validKey) {
    // If no API key is configured, skip check (dev mode)
    console.warn('WARNING: No API_KEY set — skipping auth check');
    return next();
  }

  if (apiKey === validKey) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized — invalid or missing API key' });
}

module.exports = { requireApiKey };
