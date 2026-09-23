'use strict';

const {
  describeDeadline,
  mixPhase,
  daysBetween,
  formatWeekday,
  formatMonthDay,
  formatDeadlineWhen,
  updatedLabel
} = require('./time');

const LISTING_LABELS = {
  'photo-clash': 'Photo clash',
  unsigned: 'Unsigned',
  live: 'Confirm live',
  'confirm-live': 'Confirm live',
  'expiry-missing': 'Expiry missing',
  overdue: 'Overdue',
  open: 'Open',
  done: 'Done',
  waiting: 'Waiting'
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function listingLabel(status) {
  if (!status) return 'Open';
  return LISTING_LABELS[status] || status.replace(/-/g, ' ');
}

function daysLabel(n) {
  if (n == null) return 'Open';
  if (n === 0) return 'Opened today';
  if (n === 1) return '1 day open';
  return `${n} days open`;
}

const CSS = `
:root {
  color-scheme: dark;
  --bg: #0c1116;
  --bg-raise: #161d26;
  --line: rgba(243, 239, 230, 0.08);
  --text: #f4efe6;
  --muted: #93a0ad;
  --faint: #6d7b88;
  --gold: #d4b483;
  --gold-dim: rgba(212, 180, 131, 0.16);
  --over: #ff6b5a;
  --urgent: #e6b15a;
  --ok: #8fceab;
  --shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  min-height: 100vh;
  background:
    radial-gradient(1200px 480px at 50% -10%, rgba(212, 180, 131, 0.08), transparent 55%),
    var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 17px;
  line-height: 1.4;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
a { color: inherit; }
button, input { font: inherit; color: inherit; }
.wrap {
  width: min(32rem, 100%);
  margin: 0 auto;
  padding: 1.35rem 1.15rem 3.5rem;
}
.kicker {
  margin: 0;
  font-family: Georgia, "Iowan Old Style", Palatino, serif;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-size: 0.78rem;
  color: var(--gold);
}
h1 {
  margin: 0.35rem 0 0;
  font-family: Georgia, "Iowan Old Style", Palatino, serif;
  font-weight: 500;
  font-size: clamp(2.4rem, 10vw, 3.3rem);
  letter-spacing: -0.03em;
  line-height: 0.95;
}
.subdate { margin: 0.45rem 0 0; color: var(--muted); font-size: 1.02rem; }
.updated { margin: 0.2rem 0 0; color: var(--faint); font-size: 0.92rem; }
.banner, .sample {
  margin: 1rem 0 0;
  padding: 0.75rem 0.85rem;
  border-radius: 12px;
  background: var(--gold-dim);
  color: var(--text);
  font-size: 0.95rem;
}
.banner a, .earlier a { color: var(--gold); }
.section { margin-top: 1.7rem; }
.section h2 {
  margin: 0;
  font-size: 0.78rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--gold);
  font-weight: 650;
}
.lede { margin: 0.3rem 0 0.85rem; color: var(--muted); font-size: 0.95rem; }
.hero, .card, .row, .gate {
  background: var(--bg-raise);
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: var(--shadow);
}
.hero { padding: 1.15rem 1.15rem 1.2rem; }
.hero .address {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}
.money { margin: 0.2rem 0 0; color: var(--gold); font-size: 1.05rem; }
.clock {
  margin: 0.85rem 0 0.15rem;
  font-variant-numeric: tabular-nums;
  font-weight: 640;
  letter-spacing: -0.04em;
  font-size: clamp(3.2rem, 16vw, 4.6rem);
  line-height: 0.9;
}
.clock.is-over, .count.is-over, .pill.is-over { color: var(--over); }
.clock.is-urgent, .count.is-urgent { color: var(--urgent); }
.when { margin: 0.35rem 0 0; color: var(--muted); }
.action { margin: 0.8rem 0 0; font-size: 1.05rem; }
.owner {
  display: inline-block;
  margin-top: 0.7rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: rgba(243, 239, 230, 0.06);
  color: var(--muted);
  font-size: 0.82rem;
  letter-spacing: 0.04em;
}
.flag {
  display: inline-block;
  margin-left: 0.4rem;
  color: var(--over);
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.stack { display: flex; flex-direction: column; gap: 0.65rem; }
.row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.35rem 0.75rem;
  padding: 0.9rem 1rem;
  align-items: center;
}
.row .address { margin: 0; font-weight: 640; }
.row .meta { grid-column: 1 / -1; margin: 0; color: var(--muted); font-size: 0.92rem; }
.count {
  font-variant-numeric: tabular-nums;
  font-weight: 680;
  font-size: 1.05rem;
  color: var(--gold);
}
.card { padding: 1rem 1rem 1.05rem; }
.card-top { display: flex; gap: 0.75rem; align-items: baseline; }
.rank {
  font-family: Georgia, "Iowan Old Style", Palatino, serif;
  color: var(--gold);
  font-size: 1.55rem;
  line-height: 1;
  min-width: 1.2rem;
}
.card h3 { margin: 0; font-size: 1.12rem; font-weight: 650; letter-spacing: -0.02em; }
.why { margin: 0.45rem 0 0; color: var(--muted); }
.cta {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 48px;
  margin-top: 0.9rem;
  padding: 0.7rem 1rem;
  border: 0;
  border-radius: 12px;
  background: var(--text);
  color: #141b22;
  text-decoration: none;
  font-weight: 700;
  letter-spacing: -0.01em;
}
button.cta { cursor: pointer; }
.card.is-done { opacity: 0.48; }
.card.is-done h3 { text-decoration: line-through; }
.pill {
  justify-self: end;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  background: rgba(230, 177, 90, 0.14);
  color: var(--urgent);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}
.pill.live { background: rgba(143, 206, 171, 0.12); color: var(--ok); }
.pill.unsigned, .pill.overdue { background: rgba(255, 107, 90, 0.12); color: var(--over); }
.who { margin: 0.25rem 0 0; color: var(--text); }
.days { color: var(--gold); font-variant-numeric: tabular-nums; }
.parked {
  margin: 0;
  padding: 0.2rem 0 0 1.1rem;
  color: var(--muted);
}
.parked li { margin: 0.35rem 0; }
.trigger {
  padding: 0.9rem 1rem;
  border-left: 3px solid var(--gold);
  background: rgba(212, 180, 131, 0.06);
  border-radius: 0 14px 14px 0;
}
.trigger strong { display: block; }
.trigger span { color: var(--muted); }
.notes p { margin: 0.4rem 0; color: var(--muted); }
.empty {
  margin-top: 1.6rem;
  padding: 1.2rem 1rem;
  border: 1px dashed rgba(212, 180, 131, 0.35);
  border-radius: 18px;
}
.empty h2 { font-size: 1.35rem; letter-spacing: -0.02em; text-transform: none; color: var(--text); }
.empty p { color: var(--muted); }
.earlier { margin-top: 1rem; }
.quiet { margin: 0.4rem 0 0; color: var(--faint); font-size: 0.92rem; }
.foot {
  margin-top: 2.2rem;
  color: var(--faint);
  font-size: 0.82rem;
  letter-spacing: 0.04em;
}
.gate { padding: 1.2rem 1.1rem 1.3rem; margin-top: 1.4rem; }
label { display: block; margin-bottom: 0.4rem; color: var(--muted); }
input[type="password"] {
  width: 100%;
  min-height: 52px;
  padding: 0.7rem 0.85rem;
  border-radius: 12px;
  border: 1px solid rgba(212, 180, 131, 0.35);
  background: #10161c;
  font-size: 1.2rem;
}
.err { color: var(--over); margin: 0 0 0.8rem; }
a:focus-visible, button:focus-visible, input:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  * { scroll-behavior: auto; }
}
`;

const CLIENT_JS = `
(function () {
  function describe(iso) {
    var t = new Date(iso).getTime();
    if (!iso || isNaN(t)) return { label: 'No clock', overdue: false, urgent: false };
    var diff = t - Date.now();
    var overdue = diff < 0;
    var abs = Math.abs(diff);
    var days = Math.floor(abs / 86400000);
    var hours = Math.floor((abs % 86400000) / 3600000);
    var mins = Math.floor((abs % 3600000) / 60000);
    var label = days > 0 ? (days + 'd ' + hours + 'h') : hours > 0 ? (hours + 'h ' + mins + 'm') : (mins + 'm');
    if (overdue) label = label + ' over';
    return { label: label, overdue: overdue, urgent: !overdue && diff < 172800000 };
  }
  function paintClocks() {
    document.querySelectorAll('[data-deadline]').forEach(function (el) {
      var info = describe(el.getAttribute('data-deadline'));
      el.textContent = info.label;
      el.classList.toggle('is-over', info.overdue);
      el.classList.toggle('is-urgent', info.urgent);
    });
  }
  function paintUpdated() {
    var el = document.querySelector('[data-updated]');
    if (!el) return;
    var t = new Date(el.getAttribute('data-updated')).getTime();
    if (isNaN(t)) return;
    var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    var text = 'Updated just now';
    if (s >= 45 && s < 3600) text = 'Updated ' + Math.floor(s / 60) + 'm ago';
    else if (s >= 3600 && s < 129600) text = 'Updated ' + Math.floor(s / 3600) + 'h ago';
    else if (s >= 129600) text = 'Updated ' + Math.floor(s / 86400) + 'd ago';
    el.textContent = text;
  }
  function paintChecks() {
    document.querySelectorAll('[data-check]').forEach(function (btn) {
      var key = 'wallace-desk:' + btn.getAttribute('data-check');
      var card = btn.closest('[data-card]');
      var on = false;
      try { on = localStorage.getItem(key) === '1'; } catch (e) {}
      if (card) card.classList.toggle('is-done', on);
      btn.textContent = on ? 'Done' : btn.getAttribute('data-label');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  document.querySelectorAll('[data-check]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = 'wallace-desk:' + btn.getAttribute('data-check');
      try {
        var on = localStorage.getItem(key) === '1';
        localStorage.setItem(key, on ? '0' : '1');
      } catch (e) {}
      paintChecks();
    });
  });
  paintClocks();
  paintUpdated();
  paintChecks();
  setInterval(function () { paintClocks(); paintUpdated(); }, 30000);
})();
`;

function page({ title, body, script = false }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0c1116">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Wallace Desk">
<title>${esc(title)}</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon.svg">
<style>${CSS}</style>
</head>
<body>
<main class="wrap">
${body}
</main>
${script ? `<script>${CLIENT_JS}</script>` : ''}
</body>
</html>`;
}

function header(date, updatedAt, now) {
  return `<p class="kicker">Wallace Desk</p>
<h1>${esc(formatWeekday(date))}</h1>
<p class="subdate">${esc(formatMonthDay(date))}</p>
<p class="updated" data-updated="${esc(updatedAt || '')}">${esc(updatedLabel(updatedAt, now))}</p>`;
}

function clockHtml(deadline, now, className) {
  const info = describeDeadline(deadline, now);
  const cls = [
    className,
    info.overdue ? 'is-over' : '',
    info.urgent ? 'is-urgent' : ''
  ].filter(Boolean).join(' ');
  return `<p class="${cls}" data-deadline="${esc(deadline)}">${esc(info.label)}</p>`;
}

function ctaHtml(item, date) {
  if (!item.ctaHref) return '';
  if (item.ctaHref === 'checklist') {
    const key = `${date}:${item.rank}:${item.title}`.slice(0, 180);
    return `<button type="button" class="cta" data-check="${esc(key)}" data-label="${esc(item.ctaLabel)}">${esc(item.ctaLabel)}</button>`;
  }
  const extra = /^https?:/i.test(item.ctaHref) ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a class="cta" href="${esc(item.ctaHref)}"${extra}>${esc(item.ctaLabel)}</a>`;
}

function renderMix(mix, now) {
  if (!mix.length) {
    return `<section class="section"><h2>Mix</h2><p class="lede">No firm deadlines on the board.</p></section>`;
  }
  const ordered = mix.slice().sort((a, b) => {
    const ad = a.status === 'done' ? 1 : 0;
    const bd = b.status === 'done' ? 1 : 0;
    if (ad !== bd) return ad - bd;
    const at = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const bt = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    return at - bt;
  });
  const [hero, ...rest] = ordered;
  const phase = mixPhase(hero, now);
  const when = formatDeadlineWhen(hero.deadline);
  const heroHtml = `<article class="hero">
<p class="address">${esc(hero.title)}${phase === 'overdue' ? '<span class="flag">Overdue</span>' : ''}</p>
${hero.valueLabel ? `<p class="money">${esc(hero.valueLabel)}</p>` : ''}
${hero.deadline ? clockHtml(hero.deadline, now, 'clock') : '<p class="clock">No clock</p>'}
${when ? `<p class="when">Due ${esc(when)}</p>` : ''}
${hero.action ? `<p class="action">${esc(hero.action)}</p>` : ''}
${hero.owner ? `<span class="owner">${esc(hero.owner)}</span>` : ''}
</article>`;
  const rows = rest.map((item) => {
    const itemPhase = mixPhase(item, now);
    return `<article class="row">
<p class="address">${esc(item.title)}</p>
${item.deadline ? clockHtml(item.deadline, now, 'count') : ''}
<p class="meta">${esc([item.valueLabel, item.action, itemPhase === 'overdue' ? 'Overdue' : ''].filter(Boolean).join(' · '))}</p>
</article>`;
  }).join('');
  return `<section class="section"><h2>Mix</h2><p class="lede">Firm money and condition clocks.</p><div class="stack">${heroHtml}${rows}</div></section>`;
}

function renderMust(items, date) {
  if (!items.length) {
    return `<section class="section"><h2>Before dials</h2><p class="lede">Nothing forced this morning.</p></section>`;
  }
  const cards = items.map((item) => `<article class="card" data-card>
<div class="card-top"><span class="rank">${esc(item.rank)}</span><h3>${esc(item.title)}</h3></div>
${item.why ? `<p class="why">${esc(item.why)}</p>` : ''}
${ctaHtml(item, date)}
</article>`).join('');
  return `<section class="section"><h2>Before dials</h2><p class="lede">What has to happen before dials.</p><div class="stack">${cards}</div></section>`;
}

function pillClass(status) {
  if (status === 'unsigned' || status === 'overdue') return 'pill unsigned';
  if (status === 'live' || status === 'done') return 'pill live';
  return 'pill';
}

function renderListings(items) {
  if (!items.length) return '';
  const rows = items.map((item) => `<article class="row">
<p class="address">${esc(item.address)}</p>
<span class="${pillClass(item.status)}">${esc(listingLabel(item.status))}</span>
${item.note ? `<p class="meta">${esc(item.note)}</p>` : ''}
</article>`).join('');
  return `<section class="section"><h2>Listing closeout</h2><p class="lede">Photos, signatures, live, expiry.</p><div class="stack">${rows}</div></section>`;
}

function renderFeedback(items, asOf) {
  if (!items.length) return '';
  const rows = items.map((item) => {
    const n = daysBetween(item.openSince, asOf);
    return `<article class="card">
<h3>${esc(item.address)}</h3>
<p class="who">${item.to ? esc(item.to) : 'Co-op agent'} · <span class="days">${esc(daysLabel(n))}</span></p>
</article>`;
  }).join('');
  return `<section class="section"><h2>Feedback owed</h2><p class="lede">Still open.</p><div class="stack">${rows}</div></section>`;
}

function renderParked(items) {
  if (!items.length) return '';
  const lis = items.map((item) => `<li>${esc(item)}</li>`).join('');
  return `<section class="section"><h2>Parked</h2><p class="lede">Leave these. They are not the morning.</p><ul class="parked">${lis}</ul></section>`;
}

function renderTriggers(items) {
  if (!items.length) return '';
  const blocks = items.map((item) => `<article class="trigger"><strong>${esc(item.label)}${item.when ? ` · ${esc(item.when)}` : ''}</strong>${item.note ? `<span>${esc(item.note)}</span>` : ''}</article>`).join('');
  return `<section class="section"><h2>On the calendar</h2><div class="stack">${blocks}</div></section>`;
}

function renderNotes(notes) {
  if (!notes) return '';
  const html = esc(notes).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  return `<section class="section notes"><h2>Note</h2>${html}</section>`;
}

function renderDesk({ snapshot, today, viewDate, previous, now = new Date() }) {
  const day = viewDate || today;
  if (!snapshot) {
    const earlier = previous
      ? `<p class="earlier"><a href="/?date=${esc(previous.date)}">Last board · ${esc(formatMonthDay(previous.date))}</a></p>`
      : '';
    const heading = day === today ? 'No snapshot for today' : 'No snapshot for that day';
    const sentence = day === today
      ? 'No snapshot for today — run weekday desk board or POST /api/desk/snapshot'
      : `Nothing was posted for ${formatMonthDay(day)}.`;
    const body = `${header(day, '', now)}
<section class="empty">
<h2>${esc(heading)}</h2>
<p>${esc(sentence)}</p>
</section>
${earlier}
<p class="foot">Jonathan Wallace · Faris Team · North Simcoe</p>`;
    return page({ title: 'Wallace Desk', body, script: true });
  }

  const notToday = snapshot.date !== today
    ? `<p class="banner">This is ${esc(formatWeekday(snapshot.date))}’s board. <a href="/">Back to today</a></p>`
    : '';
  const sample = snapshot.seeded
    ? `<p class="sample">Sample board. It stays until today’s snapshot is posted.</p>`
    : '';
  const body = `${header(snapshot.date, snapshot.updatedAt, now)}
${notToday}
${sample}
${renderMix(snapshot.mix || [], now)}
${renderMust(snapshot.mustDo || [], snapshot.date)}
${renderListings(snapshot.listings || [])}
${renderFeedback(snapshot.feedbackOwed || [], snapshot.date)}
${renderParked(snapshot.parked || [])}
${renderTriggers(snapshot.triggers || [])}
${renderNotes(snapshot.notes || '')}
<p class="foot">Jonathan Wallace · Faris Team · North Simcoe</p>`;
  return page({
    title: `Wallace Desk · ${formatWeekday(snapshot.date)}`,
    body,
    script: true
  });
}

function renderGate({ mode, error, next }) {
  const field = mode === 'pin' ? 'pin' : 'token';
  const label = mode === 'pin' ? 'PIN' : 'Desk token';
  const help = mode === 'pin'
    ? 'This desk is private. The PIN stays on this phone for 30 days.'
    : 'Enter the ingest token once. It stays on this phone for 30 days.';
  const err = error ? '<p class="err">That did not match. Try again.</p>' : '';
  const body = `<p class="kicker">Wallace Desk</p>
<h1>Morning</h1>
<p class="subdate">${esc(help)}</p>
<form class="gate" method="post" action="/api/desk/session">
${err}
<label for="${field}">${label}</label>
<input id="${field}" name="${field}" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" ${mode === 'pin' ? 'inputmode="numeric"' : ''} autofocus required>
<input type="hidden" name="next" value="${esc(next || '/')}">
<button class="cta" type="submit">Open desk</button>
</form>
<p class="foot">Jonathan Wallace · Faris Team</p>`;
  return page({ title: 'Wallace Desk', body });
}

function iconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#10161c"/>
<text x="32" y="42" text-anchor="middle" font-family="Georgia, serif" font-size="28" fill="#d4b483">W</text>
</svg>`;
}

module.exports = { renderDesk, renderGate, iconSvg, esc };
