'use strict';

const crypto = require('crypto');

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function sessionValue(secret) {
  return crypto.createHmac('sha256', String(secret)).update('wallace-desk-v1').digest('hex');
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    if (key !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return '';
    }
  }
  return '';
}

function setSessionCookie(res, req, secret) {
  const secure = process.env.NODE_ENV === 'production' || req.secure;
  const bits = [
    `wallace_desk=${encodeURIComponent(sessionValue(secret))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 30}`
  ];
  if (secure) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

function secretsOf({ pin, ingestToken }) {
  return [pin, ingestToken].filter(Boolean);
}

function hasSession(req, secrets) {
  const got = readCookie(req, 'wallace_desk');
  if (!got || !secrets.length) return false;
  return secrets.some((secret) => safeEqual(got, sessionValue(secret)));
}

function bearer(req) {
  return String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

function presentedSecrets(req) {
  return [req.get('x-desk-token') || '', bearer(req)].filter(Boolean);
}

function matchesAny(presented, expected) {
  if (!expected) return false;
  return presented.some((value) => safeEqual(value, expected));
}

function safeNext(value) {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.includes('\\') || value.includes('://') || /%2f%2f/i.test(value)) return '/';
  return value;
}

module.exports = {
  safeEqual,
  setSessionCookie,
  secretsOf,
  hasSession,
  presentedSecrets,
  matchesAny,
  safeNext
};
