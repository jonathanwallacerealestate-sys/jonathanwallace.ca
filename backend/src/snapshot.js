'use strict';

const { isDateString, parseDeadline, torontoDate } = require('./time');

function clip(value, max) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function clipText(value, max) {
  if (value == null) return '';
  return String(value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeHref(value) {
  let s = clip(value, 500);
  if (!s) return '';
  if (s.toLowerCase() === 'checklist') return 'checklist';
  if (/[\u0000-\u001f]/.test(s)) return '';
  if (/^tel:/i.test(s)) {
    const digits = s.slice(4).replace(/[\s().-]/g, '');
    if (/^\+?[0-9]{7,15}$/.test(digits)) return `tel:${digits}`;
    return '';
  }
  if (/\s/.test(s)) return '';
  if (/^mailto:[^\s]+$/i.test(s)) return s;
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  return '';
}

function normalizeMix(item) {
  if (!item || typeof item !== 'object') return null;
  const title = clip(item.title, 140);
  if (!title) return null;
  return {
    title,
    valueLabel: clip(item.valueLabel, 80),
    deadline: parseDeadline(item.deadline),
    action: clip(item.action, 180),
    owner: clip(item.owner, 40),
    status: clip(item.status, 40).toLowerCase()
  };
}

function normalizeMust(item, index) {
  if (!item || typeof item !== 'object') return null;
  const title = clip(item.title, 160);
  if (!title) return null;
  const rankNum = Number(item.rank);
  const rank = Number.isFinite(rankNum) && rankNum > 0 ? Math.round(rankNum) : index + 1;
  let ctaLabel = clip(item.ctaLabel, 60);
  const ctaHref = normalizeHref(item.ctaHref);
  if (ctaHref && !ctaLabel) ctaLabel = ctaHref === 'checklist' ? 'Mark done' : 'Open';
  return {
    rank,
    title,
    why: clip(item.why, 240),
    ctaLabel,
    ctaHref,
    _i: index
  };
}

function normalizeListing(item) {
  if (!item || typeof item !== 'object') return null;
  const address = clip(item.address, 160);
  if (!address) return null;
  return {
    address,
    note: clip(item.note, 240),
    status: clip(item.status, 40).toLowerCase()
  };
}

function normalizeFeedback(item) {
  if (!item || typeof item !== 'object') return null;
  const address = clip(item.address, 160);
  if (!address) return null;
  const openSince = isDateString(item.openSince) ? String(item.openSince) : '';
  return {
    address,
    to: clip(item.to, 80),
    openSince
  };
}

function normalizeTrigger(item) {
  if (!item || typeof item !== 'object') return null;
  const label = clip(item.label, 80);
  if (!label) return null;
  return {
    label,
    when: clip(item.when, 40),
    note: clip(item.note, 160)
  };
}

function normalizeSnapshot(body, { today } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const err = new Error('Body must be a JSON object');
    err.status = 400;
    throw err;
  }

  let date = body.date == null || body.date === '' ? (today || torontoDate()) : String(body.date).trim();
  if (!isDateString(date)) {
    const err = new Error('date must be YYYY-MM-DD in America/Toronto');
    err.status = 400;
    throw err;
  }

  const mix = asArray(body.mix).slice(0, 12).map(normalizeMix).filter(Boolean).slice(0, 8);
  const mustDo = asArray(body.mustDo)
    .slice(0, 20)
    .map(normalizeMust)
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || a._i - b._i)
    .slice(0, 5)
    .map(({ _i, ...rest }) => rest);

  const listings = asArray(body.listings).slice(0, 30).map(normalizeListing).filter(Boolean).slice(0, 20);
  const feedbackOwed = asArray(body.feedbackOwed).slice(0, 30).map(normalizeFeedback).filter(Boolean).slice(0, 20);
  const parked = asArray(body.parked).map((item) => clip(item, 140)).filter(Boolean).slice(0, 12);
  const triggers = asArray(body.triggers).slice(0, 6).map(normalizeTrigger).filter(Boolean).slice(0, 4);

  return {
    date,
    timezone: 'America/Toronto',
    mix,
    mustDo,
    listings,
    feedbackOwed,
    parked,
    triggers,
    notes: clipText(body.notes, 2000),
    updatedAt: new Date().toISOString(),
    seeded: false
  };
}

module.exports = { normalizeSnapshot, normalizeHref };
