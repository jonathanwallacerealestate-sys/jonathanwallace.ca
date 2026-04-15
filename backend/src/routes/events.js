const express = require('express');
const router = express.Router();
const { subscribe, subscriberCount } = require('../services/events');

/**
 * GET /api/events/stream?key=API_KEY
 * Server-Sent Events endpoint for the dashboard. The API key is passed as a
 * query string because EventSource can't set custom headers.
 */
router.get('/stream', (req, res) => {
  if (process.env.API_KEY && req.query.key !== process.env.API_KEY) {
    return res.status(401).send('unauthorized');
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write(`: connected\n\n`);

  const unsub = subscribe(res);

  // Heartbeat every 25s keeps proxies from timing out the connection
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); }
    catch (e) { clearInterval(heartbeat); }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsub();
  });
});

router.get('/subscribers', (req, res) => {
  res.json({ count: subscriberCount() });
});

module.exports = router;
