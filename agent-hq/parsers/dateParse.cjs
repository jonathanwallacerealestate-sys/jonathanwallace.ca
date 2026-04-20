// Ontario APS date parsing utilities — ported from aps-parser service

const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

function normalizeYear(y) {
  const n = Number(y);
  if (Number.isNaN(n)) return null;
  if (n >= 1000) return n;
  if (n < 100) return 2000 + n;
  return n;
}

function parseApsDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/\s+/g, ' ');

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return toIso(m[1], m[2], m[3]);

  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) return toIso(normalizeYear(m[3]), month, m[1]);
  }

  m = s.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) return toIso(normalizeYear(m[3]), month, m[2]);
  }

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) return toIso(normalizeYear(m[3]), m[2], m[1]);

  return null;
}

function toIso(year, month, day) {
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  if (!y || !mo || !d) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Ontario statutory holidays — OREA forms exclude these from business days.
// Covers: New Year's, Family Day, Good Friday, Easter Monday,
// Victoria Day, Canada Day, Civic Holiday (Simcoe Day), Labour Day,
// Thanksgiving, Christmas Day, Boxing Day.
function getOntarioHolidays(year) {
  const holidays = new Set();
  const add = (m, d) => holidays.add(`${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);

  // Fixed dates
  add(1, 1);   // New Year's Day
  add(7, 1);   // Canada Day
  add(12, 25); // Christmas Day
  add(12, 26); // Boxing Day

  // Family Day — 3rd Monday of February
  const feb1dow = new Date(Date.UTC(year, 1, 1)).getUTCDay();
  const famDay = 1 + ((8 - feb1dow) % 7) + 14;
  add(2, famDay);

  // Easter (Anonymous Gregorian algorithm)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterMonth = Math.floor((h + l - 7 * m + 114) / 31);
  const easterDay = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, easterMonth - 1, easterDay));
  // Good Friday (Easter - 2)
  const goodFriday = new Date(easter);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  add(goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate());
  // Easter Monday (Easter + 1) — observed in Ontario real estate
  const easterMon = new Date(easter);
  easterMon.setUTCDate(easterMon.getUTCDate() + 1);
  add(easterMon.getUTCMonth() + 1, easterMon.getUTCDate());

  // Victoria Day — Monday before May 25
  const may25dow = new Date(Date.UTC(year, 4, 25)).getUTCDay();
  const vicDay = 25 - (may25dow === 0 ? 6 : may25dow === 1 ? 7 : may25dow - 1);
  add(5, vicDay);

  // Civic Holiday (Simcoe Day) — 1st Monday of August
  const aug1dow = new Date(Date.UTC(year, 7, 1)).getUTCDay();
  const civicDay = 1 + ((8 - aug1dow) % 7);
  add(8, civicDay);

  // Labour Day — 1st Monday of September
  const sep1dow = new Date(Date.UTC(year, 8, 1)).getUTCDay();
  const labourDay = 1 + ((8 - sep1dow) % 7);
  add(9, labourDay);

  // Thanksgiving — 2nd Monday of October
  const oct1dow = new Date(Date.UTC(year, 9, 1)).getUTCDay();
  const thanksDay = 1 + ((8 - oct1dow) % 7) + 7;
  add(10, thanksDay);

  return holidays;
}

// Cache holidays per year to avoid recalculating
const _holidayCache = {};
function isOntarioHoliday(isoDate) {
  const year = parseInt(isoDate.slice(0, 4), 10);
  if (!_holidayCache[year]) _holidayCache[year] = getOntarioHolidays(year);
  return _holidayCache[year].has(isoDate);
}

function addBusinessDays(isoDate, days) {
  if (!isoDate) return null;
  const d = new Date(isoDate + 'T12:00:00Z');
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !isOntarioHoliday(iso)) added += 1;
  }
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  if (!isoDate) return null;
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { parseApsDate, normalizeYear, addBusinessDays, addDays };
