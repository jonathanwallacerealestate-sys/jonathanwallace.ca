'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('events');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { torontoDate, torontoDateTimeISO, addDays } = require('../src/time');

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wallace-desk-'));
}

async function request(base, urlPath, { method = 'GET', headers = {}, body, redirect = 'manual' } = {}) {
  const res = await fetch(base + urlPath, {
    method,
    headers: {
      ...headers,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { status: res.status, headers: res.headers, text, json };
}

function cookieFrom(res) {
  const raw = res.headers.get('set-cookie') || '';
  const pair = raw.split(';')[0];
  return pair;
}

test('Toronto date rolls at midnight and deadlines keep the local offset', () => {
  assert.equal(torontoDate(new Date('2026-09-23T03:30:00Z')), '2026-09-22');
  assert.equal(torontoDate(new Date('2026-09-23T04:30:00Z')), '2026-09-23');
  const edt = torontoDateTimeISO('2026-09-30', 17, 0);
  assert.equal(new Date(edt).toISOString(), '2026-09-30T21:00:00.000Z');
  const est = torontoDateTimeISO('2026-11-02', 17, 0);
  assert.equal(new Date(est).toISOString(), '2026-11-02T22:00:00.000Z');
  assert.equal(addDays('2026-09-23', 7), '2026-09-30');
});

test('health, seed board, and empty-date read', async () => {
  const dir = tmpDir();
  const srv = await listen(createApp({ dataDir: dir, ingestToken: '', pin: '', seed: true }));
  try {
    const health = await request(srv.base, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.status, 'ok');
    assert.equal(health.json.service, 'wallace-desk');
    assert.equal(health.json.database.ok, true);
    assert.equal(health.json.database.driver, 'file');
    assert.equal(health.json.auth.uiLocked, false);
    assert.equal(health.json.auth.ingestConfigured, false);
    assert.equal(health.json.lastSnapshot.seeded, true);
    assert.equal(typeof health.json.today, 'string');

    const page = await request(srv.base, '/');
    assert.equal(page.status, 200);
    assert.match(page.text, /Wallace Desk/);
    assert.match(page.text, /12-155 William/);
    assert.match(page.text, /Craig Strachan/);
    assert.match(page.text, /Sample board/);
    assert.match(page.text, /Dial backlog/);
    assert.match(page.text, /14 days open/);
    assert.doesNotMatch(page.text, /<script[^>]*>[\s\S]*12-155 William/);

    const today = await request(srv.base, '/api/desk/today');
    assert.equal(today.status, 200);
    assert.equal(today.json.timezone, 'America/Toronto');
    assert.equal(today.json.date, health.json.today);
    assert.equal(today.json.mix[0].title, '12-155 William');

    const missing = await request(srv.base, '/api/desk/today?date=1999-01-01');
    assert.equal(missing.status, 404);
    assert.match(missing.json.hint, /POST \/api\/desk\/snapshot/);

    const refused = await request(srv.base, '/api/desk/snapshot', {
      method: 'POST',
      body: { date: '2026-09-23', mix: [] }
    });
    assert.equal(refused.status, 503);
  } finally {
    await srv.close();
  }
});

test('ingest is token-gated, idempotent, and readable', async () => {
  const dir = tmpDir();
  const today = torontoDate();
  const srv = await listen(createApp({
    dataDir: dir,
    ingestToken: 'desk-secret',
    pin: '2468',
    seed: false
  }));
  try {
    const open = await request(srv.base, '/');
    assert.equal(open.status, 401);
    assert.match(open.text, /PIN/);
    assert.doesNotMatch(open.text, /12-155 William/);

    const noToken = await request(srv.base, '/api/desk/snapshot', {
      method: 'POST',
      body: { notes: 'nope' }
    });
    assert.equal(noToken.status, 401);

    const bad = await request(srv.base, '/api/desk/snapshot', {
      method: 'POST',
      headers: { 'x-desk-token': 'wrong' },
      body: { notes: 'nope' }
    });
    assert.equal(bad.status, 401);

    const first = await request(srv.base, '/api/desk/snapshot', {
      method: 'POST',
      headers: { 'x-desk-token': 'desk-secret' },
      body: {
        date: today,
        timezone: 'America/Toronto',
        mix: [{
          title: '12-155 William',
          valueLabel: '~$1.225M firm',
          deadline: '2020-01-01T17:00:00-05:00',
          action: 'Order status cert CondoCafe',
          owner: 'JW',
          status: 'open'
        }],
        mustDo: [
          { rank: 3, title: 'Third', why: 'Later', ctaLabel: 'Call', ctaHref: 'tel:+1 705 555 0199' },
          { rank: 1, title: '<script>alert(1)</script>', why: 'First', ctaLabel: 'Go', ctaHref: 'javascript:alert(1)' },
          { rank: 2, title: 'Second', why: 'Mid', ctaLabel: 'Mark done', ctaHref: 'checklist' },
          { rank: 4, title: 'Fourth', why: '', ctaLabel: 'Mail', ctaHref: 'mailto:a@example.com' },
          { rank: 5, title: 'Fifth', why: '', ctaLabel: 'Web', ctaHref: 'https://example.com/listing' },
          { rank: 6, title: 'Dropped', why: 'Over the max', ctaLabel: 'No', ctaHref: 'tel:+17055550100' }
        ],
        listings: [{ address: '18 Baltic', note: 'Unsigned', status: 'unsigned' }],
        feedbackOwed: [{ address: '48 Zoo Park Rd', to: 'Craig Strachan', openSince: addDays(today, -14) }],
        parked: ['Dial backlog'],
        notes: 'Live board'
      }
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.ok, true);
    assert.equal(first.json.date, today);

    const lockedRead = await request(srv.base, '/api/desk/today');
    assert.equal(lockedRead.status, 401);

    const read = await request(srv.base, '/api/desk/today', {
      headers: { authorization: 'Bearer desk-secret' }
    });
    assert.equal(read.status, 200);
    assert.equal(read.json.notes, 'Live board');
    assert.equal(read.json.seeded, false);
    assert.equal(read.json.mustDo.length, 5);
    assert.equal(read.json.mustDo[0].title, '<script>alert(1)</script>');
    assert.equal(read.json.mustDo[0].ctaHref, '');
    assert.equal(read.json.mustDo[1].ctaHref, 'checklist');
    assert.equal(read.json.mustDo[2].ctaHref, 'tel:+17055550199');
    assert.equal(read.json.mustDo.map((item) => item.title).includes('Dropped'), false);
    assert.equal(read.json.mix[0].status, 'open');
    assert.ok(read.json.mix[0].deadline);

    const replace = await request(srv.base, '/api/desk/snapshot', {
      method: 'POST',
      headers: { 'x-desk-token': 'desk-secret' },
      body: {
        date: today,
        mix: [{ title: '84 Mosley, Wasaga', valueLabel: 'Conditional', deadline: addDays(today, 1), action: 'Waiver', owner: 'JW' }],
        mustDo: [],
        notes: 'Replaced'
      }
    });
    assert.equal(replace.status, 200);
    const again = await request(srv.base, '/api/desk/today', {
      headers: { 'x-desk-token': 'desk-secret' }
    });
    assert.equal(again.json.notes, 'Replaced');
    assert.equal(again.json.mix.length, 1);
    assert.equal(again.json.mix[0].title, '84 Mosley, Wasaga');
    assert.match(again.json.mix[0].deadline, /T17:00:00/);

    const other = await request(srv.base, '/api/desk/snapshot', {
      method: 'POST',
      headers: { 'x-desk-token': 'desk-secret' },
      body: { date: '2026-01-02', notes: 'Other day', mix: [{ title: 'Keep me' }] }
    });
    assert.equal(other.status, 200);
    const still = await request(srv.base, '/api/desk/today', {
      headers: { 'x-desk-token': 'desk-secret' }
    });
    assert.equal(still.json.notes, 'Replaced');

    const gate = await request(srv.base, '/?token=desk-secret');
    assert.equal(gate.status, 302);
    const cookie = cookieFrom(gate);
    assert.match(cookie, /^wallace_desk=/);
    assert.equal(gate.headers.get('location'), '/');

    const html = await request(srv.base, '/', { headers: { cookie } });
    assert.equal(html.status, 200);
    assert.match(html.text, /84 Mosley, Wasaga/);
    assert.match(html.text, /is-over|No clock|clock/);
    assert.match(html.text, /&lt;script&gt;|Replaced/);
    assert.doesNotMatch(html.text, /<script>alert\(1\)<\/script>/);

    const overduePage = await request(srv.base, '/api/desk/snapshot', {
      method: 'POST',
      headers: { 'x-desk-token': 'desk-secret' },
      body: {
        mix: [{
          title: 'Past firm',
          deadline: '2020-01-02T15:00:00Z',
          valueLabel: 'Overdue deal',
          action: 'Chase it'
        }]
      }
    });
    assert.equal(overduePage.status, 200);
    const overdueHtml = await request(srv.base, '/', { headers: { cookie } });
    assert.match(overdueHtml.text, /is-over/);
    assert.match(overdueHtml.text, /Overdue/);
    assert.match(overdueHtml.text, / over</);

    const badDate = await request(srv.base, '/api/desk/snapshot', {
      method: 'POST',
      headers: { 'x-desk-token': 'desk-secret' },
      body: { date: '09-23-2026' }
    });
    assert.equal(badDate.status, 400);

    const dash = await request(srv.base, '/dashboard');
    assert.equal(dash.status, 302);
    assert.equal(dash.headers.get('location'), '/');
  } finally {
    await srv.close();
  }
});

test('PIN session unlocks the UI and a bad pin does not', async () => {
  const dir = tmpDir();
  const srv = await listen(createApp({
    dataDir: dir,
    ingestToken: 'desk-secret',
    pin: '2468',
    seed: true
  }));
  try {
    const wrong = await request(srv.base, '/api/desk/session', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: undefined
    });
    const form = await fetch(srv.base + '/api/desk/session', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'pin=0000&next=/',
      redirect: 'manual'
    });
    assert.equal(form.status, 302);
    assert.match(form.headers.get('location'), /locked=1/);
    assert.equal(form.headers.get('set-cookie'), null);

    const ok = await fetch(srv.base + '/api/desk/session', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'pin=2468&next=/',
      redirect: 'manual'
    });
    assert.equal(ok.status, 302);
    const cookie = (ok.headers.get('set-cookie') || '').split(';')[0];
    const page = await request(srv.base, '/', { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(page.text, /12-155 William/);
    assert.equal(wrong.status, 302);
  } finally {
    await srv.close();
  }
});

test('corrupt snapshot file fails health without taking the process down', async () => {
  const dir = tmpDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'desk-snapshots.json'), '{not json');
  const store = createStore(dir);
  assert.equal(store.health().ok, false);
  const srv = await listen(createApp({ dataDir: dir, ingestToken: '', pin: '', seed: true, store }));
  try {
    const health = await request(srv.base, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.status, 'degraded');
    assert.equal(health.json.database.ok, false);
  } finally {
    await srv.close();
  }
});
