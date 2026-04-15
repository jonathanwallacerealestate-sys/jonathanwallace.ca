/**
 * AES-256-GCM encryption for credential passwords.
 *
 * Key source, in order:
 *   1. CREDENTIALS_ENCRYPTION_KEY env var (64-hex = 32 bytes)
 *   2. Otherwise derived via sha256(API_KEY + "::creds")
 *
 * Set CREDENTIALS_ENCRYPTION_KEY in Railway for production so the key is
 * independent of API_KEY rotation.
 */
const crypto = require('crypto');

function getKey() {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (raw && /^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const fallback = process.env.API_KEY || 'dashboard-default-key';
  return crypto.createHash('sha256').update(fallback + '::creds').digest();
}

function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(ciphertext) {
  if (!ciphertext) return '';
  if (!ciphertext.startsWith('v1:')) return ciphertext; // unencrypted legacy
  const key = getKey();
  const buf = Buffer.from(ciphertext.slice(3), 'base64');
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const enc = buf.slice(28);
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
}

function maskForDisplay(plaintext) {
  if (!plaintext) return '';
  if (plaintext.length <= 4) return '****';
  return plaintext.slice(0, 2) + '•'.repeat(Math.min(plaintext.length - 3, 8)) + plaintext.slice(-1);
}

module.exports = { encrypt, decrypt, maskForDisplay };
