/**
 * Follow Up Boss API client.
 *
 * Docs: https://docs.followupboss.com/reference/
 *
 * Auth: Basic auth with API_KEY as username and empty password.
 * Rate limit: 250 requests per 10 seconds (generous).
 *
 * Design:
 *   - The API key is read from app_settings (key: 'fub_api_key') on every call.
 *     If absent, methods throw 'FUB_NOT_CONFIGURED' so callers can 503 gracefully.
 *   - Each method returns the raw FUB response on success, or throws on error.
 *   - A tiny in-memory LRU caches read responses for 60s to avoid pounding the
 *     API when the dashboard polls.
 *   - All writes bypass the cache and invalidate the matching read cache key.
 */
const pool = require('../db/pool');

const FUB_BASE = 'https://api.followupboss.com/v1';
const READ_CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // key -> { at, value }

// ---------- Settings helpers ----------

async function getApiKey() {
  // Check env var first (preferred for production), fall back to app_settings
  if (process.env.FUB_API_KEY) return process.env.FUB_API_KEY;
  try {
    const { rows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'fub_api_key'`
    );
    if (!rows.length || rows[0].value == null) return null;
    const v = rows[0].value;
    return typeof v === 'string' ? v : null;
  } catch (e) {
    return null;
  }
}

function isConfigured() {
  // Synchronous best-effort — caller should still await getApiKey() before a real call
  return !!process.env.FUB_API_KEY;
}

// ---------- Low-level HTTP ----------

async function request(method, path, { query, body, skipCache } = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    const err = new Error('Follow Up Boss API key not configured. Set fub_api_key in dashboard Settings.');
    err.code = 'FUB_NOT_CONFIGURED';
    throw err;
  }

  let url = FUB_BASE + path;
  if (query && Object.keys(query).length) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v == null) continue;
      if (Array.isArray(v)) { for (const x of v) qs.append(k, String(x)); }
      else qs.set(k, String(v));
    }
    url += '?' + qs.toString();
  }

  const cacheKey = method.toUpperCase() === 'GET' ? url : null;
  if (cacheKey && !skipCache) {
    const hit = cache.get(cacheKey);
    if (hit && (Date.now() - hit.at) < READ_CACHE_TTL_MS) return hit.value;
  }

  const auth = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': auth,
      'X-System': 'JonathanWallace-Dashboard',
      'X-System-Key': apiKey.slice(0, 6) + '…',
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }

  if (!res.ok) {
    const err = new Error(`FUB ${method} ${path} failed: ${res.status} ${res.statusText} — ${JSON.stringify(data).slice(0, 200)}`);
    err.status = res.status;
    err.response = data;
    throw err;
  }

  if (cacheKey) cache.set(cacheKey, { at: Date.now(), value: data });
  return data;
}

function invalidateCache() { cache.clear(); }

// ---------- Public API (read) ----------

async function whoami() {
  return request('GET', '/identity', { skipCache: true });
}

async function listPeople({ limit = 50, offset = 0, sort, stage, assignedTo, search } = {}) {
  return request('GET', '/people', {
    query: { limit, offset, sort, stage, assignedTo, search, fields: 'allFields' }
  });
}

async function getPerson(id) {
  return request('GET', '/people/' + encodeURIComponent(id), {
    query: { fields: 'allFields' }
  });
}

async function personEvents(id, { limit = 25 } = {}) {
  return request('GET', '/events', {
    query: { personId: id, limit, sort: '-created' }
  });
}

async function personNotes(id, { limit = 25 } = {}) {
  return request('GET', '/notes', { query: { personId: id, limit } });
}

async function personTasks(id, { limit = 25 } = {}) {
  return request('GET', '/tasks', { query: { personId: id, limit } });
}

async function listTasks({ limit = 100, offset = 0, status, assignedTo, dueAfter, dueBefore } = {}) {
  return request('GET', '/tasks', {
    query: { limit, offset, status, assignedTo, dueAfter, dueBefore, sort: 'dueDate' }
  });
}

async function listStages() {
  return request('GET', '/stages', { query: { limit: 100 } });
}

async function listUsers() {
  return request('GET', '/users', { query: { limit: 100 } });
}

async function listDeals({ limit = 50, offset = 0, status, stage } = {}) {
  return request('GET', '/deals', { query: { limit, offset, status, stage } });
}

async function listPipelines() {
  return request('GET', '/pipelines', { query: { limit: 50 } });
}

async function listSmartLists() {
  return request('GET', '/smartLists', { query: { limit: 100 } });
}

// ---------- Public API (write) ----------

async function createPerson(person) {
  invalidateCache();
  return request('POST', '/people', { body: person });
}

async function updatePerson(id, updates) {
  invalidateCache();
  return request('PUT', '/people/' + encodeURIComponent(id), { body: updates });
}

async function createTask(task) {
  invalidateCache();
  return request('POST', '/tasks', { body: task });
}

async function updateTask(id, updates) {
  invalidateCache();
  return request('PUT', '/tasks/' + encodeURIComponent(id), { body: updates });
}

async function completeTask(id, { notes } = {}) {
  invalidateCache();
  return request('PUT', '/tasks/' + encodeURIComponent(id), {
    body: { status: 'Completed', ...(notes ? { description: notes } : {}) }
  });
}

async function createNote(note) {
  // note: { personId, subject, body, isHtml }
  invalidateCache();
  return request('POST', '/notes', { body: note });
}

async function createEvent(event) {
  // event: { personId, type, source, description, ... }
  invalidateCache();
  return request('POST', '/events', { body: event });
}

async function createDeal(deal) {
  invalidateCache();
  return request('POST', '/deals', { body: deal });
}

// ---------- Convenience: find-or-nothing by email/phone ----------

async function findPersonByEmail(email) {
  if (!email) return null;
  try {
    const r = await request('GET', '/people', { query: { email, limit: 1 } });
    return (r.people && r.people[0]) || null;
  } catch (e) { return null; }
}

async function findPersonByPhone(phone) {
  if (!phone) return null;
  try {
    const r = await request('GET', '/people', { query: { phone, limit: 1 } });
    return (r.people && r.people[0]) || null;
  } catch (e) { return null; }
}

module.exports = {
  // low-level
  request, invalidateCache,
  // config
  getApiKey, isConfigured,
  // read
  whoami, listPeople, getPerson, personEvents, personNotes, personTasks,
  listTasks, listStages, listUsers, listDeals, listPipelines, listSmartLists,
  findPersonByEmail, findPersonByPhone,
  // write
  createPerson, updatePerson,
  createTask, updateTask, completeTask,
  createNote, createEvent, createDeal
};
