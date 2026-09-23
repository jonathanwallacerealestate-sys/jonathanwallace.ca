'use strict';

const ZONE = 'America/Toronto';

function torontoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [y, m, d] = String(value).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function tzOffsetMinutes(utcMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 60000);
}

function formatOffset(mins) {
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/** Civil Toronto date + clock → ISO-8601 with the correct EST/EDT offset. */
function torontoDateTimeISO(dateStr, hour = 17, minute = 0) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const civilUtc = Date.UTC(y, m - 1, d, hour, minute, 0);
  let offset = tzOffsetMinutes(civilUtc);
  let instant = civilUtc - offset * 60000;
  offset = tzOffsetMinutes(instant);
  instant = civilUtc - offset * 60000;
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${dateStr}T${hh}:${mm}:00${formatOffset(offset)}`;
}

function parseDeadline(value) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  if (isDateString(s)) return torontoDateTimeISO(s, 17, 0);
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return '';
  return t.toISOString();
}

function formatLongDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(dt);
}

function formatWeekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(dt);
}

function formatMonthDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(dt);
}

function formatDeadlineWhen(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(t);
}

function describeDeadline(iso, now = new Date()) {
  const t = new Date(iso).getTime();
  if (!iso || Number.isNaN(t)) {
    return { label: 'No clock', overdue: false, urgent: false };
  }
  const diff = t - now.getTime();
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);
  let label;
  if (days > 0) label = `${days}d ${hours}h`;
  else if (hours > 0) label = `${hours}h ${mins}m`;
  else label = `${mins}m`;
  if (overdue) label = `${label} over`;
  return { label, overdue, urgent: !overdue && diff < 48 * 3600000 };
}

function mixPhase(item, now = new Date()) {
  if (item.status === 'done') return 'done';
  if (item.status === 'overdue') return 'overdue';
  const clock = item.deadline ? describeDeadline(item.deadline, now) : null;
  if (clock && clock.overdue) return 'overdue';
  if (clock && clock.urgent) return 'urgent';
  return 'open';
}

function daysBetween(startStr, endStr) {
  if (!isDateString(startStr) || !isDateString(endStr)) return null;
  const [ys, ms, ds] = startStr.split('-').map(Number);
  const [ye, me, de] = endStr.split('-').map(Number);
  const a = Date.UTC(ys, ms - 1, ds);
  const b = Date.UTC(ye, me - 1, de);
  return Math.max(0, Math.round((b - a) / 86400000));
}

function updatedLabel(iso, now = new Date()) {
  const t = new Date(iso).getTime();
  if (!iso || Number.isNaN(t)) return 'Updated just now';
  const s = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (s < 45) return 'Updated just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `Updated ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 36) return `Updated ${h}h ago`;
  return `Updated ${Math.floor(h / 24)}d ago`;
}

module.exports = {
  ZONE,
  torontoDate,
  isDateString,
  addDays,
  torontoDateTimeISO,
  parseDeadline,
  formatLongDate,
  formatWeekday,
  formatMonthDay,
  formatDeadlineWhen,
  describeDeadline,
  mixPhase,
  daysBetween,
  updatedLabel
};
