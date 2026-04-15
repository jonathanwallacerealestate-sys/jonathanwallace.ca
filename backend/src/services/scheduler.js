/**
 * In-process scheduler. Polls every 60s, picks up scheduled_tasks whose
 * next_run_at <= NOW(), dispatches by kind, then computes the next run.
 *
 * Single-instance only. Fine for one Railway dyno; if we ever scale beyond
 * one process, swap to pg-boss or a Redis lock around the SELECT.
 *
 * Time interpretation: all hour/minute fields are America/Toronto.
 *
 * Kinds:
 *   agent_task      — payload.instruction inserted into tasks table
 *   briefing        — calls /api/brief/summary internally; emails or stores result
 *   weekly_review   — calls /api/brief/weekly internally
 *   gap_analysis    — calls /api/brief/gaps internally
 *   chrome_workflow — runs the workflow's compose step and emails the prompt
 */
const pool = require('../db/pool');
const { publish } = require('./events');

const POLL_INTERVAL_MS = 60 * 1000;
const TZ = 'America/Toronto';

let interval = null;
let running = false;

function start() {
  if (interval) return;
  console.log('[Scheduler] Starting scheduler (60s polling, TZ=' + TZ + ')');
  interval = setInterval(tick, POLL_INTERVAL_MS);
  // Run first tick after a short delay so app boot completes
  setTimeout(tick, 5000);
}

function stop() {
  if (interval) clearInterval(interval);
  interval = null;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const due = await pool.query(`
      SELECT * FROM scheduled_tasks
      WHERE enabled = TRUE
        AND (next_run_at IS NULL OR next_run_at <= NOW())
      ORDER BY COALESCE(next_run_at, '1970-01-01'::timestamptz) ASC
      LIMIT 5
    `);
    for (const job of due.rows) {
      await dispatch(job).catch(err => {
        console.error('[Scheduler] Dispatch error for #' + job.id, err.message);
      });
    }
  } catch (err) {
    console.error('[Scheduler] Tick error:', err.message);
  } finally {
    running = false;
  }
}

async function dispatch(job) {
  console.log(`[Scheduler] Running #${job.id} ${job.name} (${job.kind})`);
  let result = null, status = 'completed';
  try {
    switch (job.kind) {
      case 'agent_task':       result = await runAgentTask(job); break;
      case 'briefing':         result = await runBriefing(job); break;
      case 'weekly_review':    result = await runWeeklyReview(job); break;
      case 'gap_analysis':     result = await runGapAnalysis(job); break;
      case 'chrome_workflow':  result = await runChromeWorkflow(job); break;
      case 'fub_sync':         result = await runFubSync(job); break;
      default: status = 'failed'; result = { error: 'Unknown kind: ' + job.kind };
    }
  } catch (err) {
    status = 'failed';
    result = { error: err.message };
  }

  const next = nextRun(job);
  await pool.query(
    `UPDATE scheduled_tasks SET
       last_run_at = NOW(),
       last_status = $1,
       last_result = $2::jsonb,
       next_run_at = $3,
       run_count = run_count + 1,
       updated_at = NOW()
     WHERE id = $4`,
    [status, JSON.stringify(result || {}), next, job.id]
  );
  publish({ type: 'schedule', job_id: job.id, name: job.name, status });
}

// ----- Kind dispatchers -----

async function runAgentTask(job) {
  const p = job.payload || {};
  const instruction = p.instruction || job.description || job.name;
  if (!instruction) throw new Error('No instruction in payload');
  const r = await pool.query(
    `INSERT INTO tasks (type, instruction, context, priority, source)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     RETURNING id`,
    [p.type || 'process_instruction', instruction,
     JSON.stringify(p.context || {}), p.priority || 5, 'scheduler:' + job.name]
  );
  return { queued_task_id: r.rows[0].id };
}

async function runBriefing(job) {
  const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/brief/summary`;
  const data = await internalGet(url);
  await maybeDeliver(job, 'Morning Briefing', data.summary);
  return { summary: data.summary, tokens: data.tokens };
}

async function runWeeklyReview(job) {
  const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/brief/weekly`;
  const data = await internalGet(url);
  await maybeDeliver(job, 'Weekly Review', data.review);
  return { review: data.review, tokens: data.tokens };
}

async function runGapAnalysis(job) {
  const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/brief/gaps`;
  const data = await internalGet(url);
  await maybeDeliver(job, 'What did I forget?', data.analysis);
  return { analysis: data.analysis, tokens: data.tokens };
}

async function runFubSync(job) {
  const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/fub/sync`;
  const data = await internalPost(url);
  return { upserted: data.upserted, fetched: data.fetched };
}

async function runChromeWorkflow(job) {
  const p = job.payload || {};
  if (!p.workflow_id) throw new Error('payload.workflow_id required');
  const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/chrome/workflows/${p.workflow_id}/run`;
  const data = await internalPost(url);
  // Email the assembled prompt + URL so Jonathan can paste into Claude Chrome
  // from his phone or wherever he's standing
  const subject = `Scheduled workflow: ${job.name}`;
  const body = `<pre style="font-family:monospace;font-size:13px;white-space:pre-wrap">${escapeHtml(data.prompt)}</pre>` +
               (data.target_url ? `<p><a href="${escapeHtml(data.target_url)}">${escapeHtml(data.target_url)}</a></p>` : '');
  await maybeDeliver(job, subject, body, { html: true });
  return { workflow_id: p.workflow_id, prompt_length: (data.prompt || '').length };
}

// ----- Delivery -----

async function maybeDeliver(job, subject, content, opts = {}) {
  if (!content) return;
  if (job.deliver_via === 'email' || job.deliver_via === 'both') {
    try { await emailViaGmail(job.deliver_to, subject, content, opts); }
    catch (e) { console.error('[Scheduler] email delivery failed:', e.message); }
  }
}

async function emailViaGmail(to, subject, content, opts = {}) {
  const { google } = require('googleapis');
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const from = process.env.GMAIL_USER || 'jonathanwallacerealestate@gmail.com';
  const recipient = to || from;
  const html = opts.html ? content : `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.55;color:#1a1a2e">${content.replace(/\n{2,}/g,'</p><p>').replace(/^/,'<p>') + '</p>'}</div>`;
  const raw = Buffer.from([
    `From: ${from}`,
    `To: ${recipient}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    html
  ].join('\r\n')).toString('base64url');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
}

async function internalGet(url) {
  const headers = process.env.API_KEY ? { 'X-API-Key': process.env.API_KEY } : {};
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error('Internal GET ' + url + ' -> ' + res.status + ': ' + text.slice(0, 200));
  try { return JSON.parse(text); } catch (e) { return { raw: text }; }
}
async function internalPost(url) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.API_KEY) headers['X-API-Key'] = process.env.API_KEY;
  const res = await fetch(url, { method: 'POST', headers, body: '{}' });
  const text = await res.text();
  if (!res.ok) throw new Error('Internal POST ' + url + ' -> ' + res.status + ': ' + text.slice(0, 200));
  try { return JSON.parse(text); } catch (e) { return { raw: text }; }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ----- Next-run calculator (America/Toronto) -----

function nextRun(job) {
  // We compute in Toronto local time then convert back to UTC.
  const now = new Date();
  const tzNow = nowInTz(TZ);

  let candidate = new Date(tzNow);
  candidate.setHours(job.run_at_hour ?? 7, job.run_at_minute ?? 0, 0, 0);

  if (job.frequency === 'hourly') {
    candidate = new Date(tzNow);
    candidate.setMinutes(job.run_at_minute ?? 0, 0, 0);
    if (candidate <= tzNow) candidate.setHours(candidate.getHours() + 1);
  } else if (job.frequency === 'daily') {
    if (candidate <= tzNow) candidate.setDate(candidate.getDate() + 1);
  } else if (job.frequency === 'weekly') {
    const targetDow = job.run_at_dow ?? 1; // default Monday
    const diff = (targetDow - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + diff);
    if (candidate <= tzNow) candidate.setDate(candidate.getDate() + 7);
  } else if (job.frequency === 'monthly') {
    const targetDom = job.run_at_dom ?? 1;
    candidate.setDate(targetDom);
    if (candidate <= tzNow) candidate.setMonth(candidate.getMonth() + 1);
  } else {
    if (candidate <= tzNow) candidate.setDate(candidate.getDate() + 1);
  }
  // Convert local TZ candidate back to UTC by adjusting for the TZ offset
  const offsetMin = candidate.getTime() - tzNow.getTime();
  return new Date(now.getTime() + offsetMin);
}

// Returns a Date object whose getHours()/getDate() reflect TZ local clock.
function nowInTz(tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}:${parts.second}`);
}

module.exports = { start, stop, tick, nextRun };
