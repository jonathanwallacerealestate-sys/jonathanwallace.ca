/**
 * Tiny in-process pub/sub for Server-Sent Events.
 * Sync + async writes (Make.com pushes, agent tool calls, manual CRUD)
 * call publish() to notify any connected dashboard clients.
 *
 * Single-instance only. If Railway scales beyond one replica, swap this
 * for Redis pub/sub. For now a single Node process is plenty.
 */
const subscribers = new Set();

function subscribe(res) {
  subscribers.add(res);
  return () => subscribers.delete(res);
}

function publish(event) {
  const payload = `event: ${event.type || 'message'}\ndata: ${JSON.stringify({
    ...event,
    ts: new Date().toISOString()
  })}\n\n`;
  for (const res of subscribers) {
    try { res.write(payload); }
    catch (e) { subscribers.delete(res); }
  }
}

function subscriberCount() { return subscribers.size; }

module.exports = { subscribe, publish, subscriberCount };
