// lib/util/casing.js
//
// Normalization helpers for data that arrives in ALL CAPS or without standard
// formatting from upstream sources (GeoWarehouse PDFs, REALM exports, etc).
//
// Built 2026-05-09 in response to Sisu rejecting `L9M1N1` postal codes and
// the export endpoint mis-splitting `DENNIS ALFRED MCMASTER` into
// firstName=DENNIS / lastName=ALFRED MCMASTER (should be Dennis Alfred /
// McMaster).
//
// These helpers are used by both the GeoWarehouse parser (write-side fix)
// and the /api/listing-form/:id/sisu-export endpoint (read-side backstop
// for legacy records). Defense-in-depth.

const ALL_CAPS_RE = /^[^a-z]*$/; // no lowercase letters anywhere

// Particles that should stay lowercase inside a name (Van der Berg, de la
// Cruz, etc). NOT applied to the first or last token — only middle tokens.
const NAME_PARTICLES = new Set([
  'de', 'del', 'della', 'di', 'da', 'la', 'le', 'van', 'von', 'der', 'den',
  'ter', 'ten', 'el', 'al', 'bin', 'ibn', 'y',
]);

/**
 * Title-case a single word. Internal helper.
 */
function titleCaseWord(w) {
  if (!w) return w;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

/**
 * Apply Mc/Mac prefix re-capitalization (McMaster, MacKenzie, McDonald).
 * Runs AFTER title-casing — only re-uppercases the letter immediately
 * following Mc or Mac. Safe to call repeatedly.
 */
function fixMcMacPrefix(s) {
  if (!s) return s;
  return s.replace(/\b(Mc|Mac)([a-z])/g, (_, prefix, ch) => prefix + ch.toUpperCase());
}

/**
 * Title-case a string only if it's currently ALL CAPS (or all caps + symbols).
 * If the string already has any lowercase letter, leave it alone — the user
 * may have intentionally cased it (e.g., "McDonald", "iMac").
 *
 *   titleCaseIfAllCaps('PENETANGUISHENE')      → 'Penetanguishene'
 *   titleCaseIfAllCaps('DENNIS ALFRED MCMASTER') → 'Dennis Alfred McMaster'
 *   titleCaseIfAllCaps('Dennis McMaster')      → 'Dennis McMaster' (unchanged)
 *   titleCaseIfAllCaps('')                     → ''
 */
function titleCaseIfAllCaps(s) {
  if (s == null) return s;
  const str = String(s);
  if (!str.trim()) return str;
  if (!ALL_CAPS_RE.test(str)) return str; // already has lowercase — leave alone

  const titled = str
    .split(/(\s+)/) // keep whitespace runs as separators
    .map((token, idx, arr) => {
      if (/^\s+$/.test(token)) return token;
      // Particles stay lowercase when they're not first or last word
      const wordIdx = arr.slice(0, idx).filter(t => !/^\s+$/.test(t)).length;
      const totalWords = arr.filter(t => !/^\s+$/.test(t)).length;
      const isFirst = wordIdx === 0;
      const isLast = wordIdx === totalWords - 1;
      const lower = token.toLowerCase();
      if (!isFirst && !isLast && NAME_PARTICLES.has(lower)) return lower;
      // Handle hyphenated tokens (e.g., ANNE-MARIE → Anne-Marie)
      if (token.includes('-')) {
        return token.split('-').map(titleCaseWord).join('-');
      }
      return titleCaseWord(token);
    })
    .join('');

  return fixMcMacPrefix(titled);
}

/**
 * Format a Canadian postal code with the required space.
 *
 *   formatPostalCode('L9M1N1')   → 'L9M 1N1'
 *   formatPostalCode('l9m 1n1')  → 'L9M 1N1'
 *   formatPostalCode('L9M  1N1') → 'L9M 1N1'
 *   formatPostalCode('')         → ''
 *   formatPostalCode('garbage')  → 'garbage' (returned as-is if no postal pattern)
 *
 * Sisu rejects postal codes without the space and returns `Server Error —
 * Please try again` on save. This was the save-blocker on 5 Scott Street.
 */
function formatPostalCode(s) {
  if (s == null) return s;
  const str = String(s).trim();
  if (!str) return str;
  // Strip all whitespace, uppercase
  const compact = str.replace(/\s+/g, '').toUpperCase();
  // Match exactly 6 alphanumerics in A1A1A1 pattern
  const m = compact.match(/^([A-Z]\d[A-Z])(\d[A-Z]\d)$/);
  if (m) return `${m[1]} ${m[2]}`;
  return str; // unrecognized — return original
}

/**
 * Split a full name into firstName + lastName using last-token-as-surname rule.
 * Handles Mc/Mac, hyphenated names, and ALL CAPS input.
 *
 *   splitFullName('Dennis Alfred McMaster')
 *     → { firstName: 'Dennis Alfred', lastName: 'McMaster' }
 *   splitFullName('DENNIS ALFRED MCMASTER')
 *     → { firstName: 'Dennis Alfred', lastName: 'McMaster' }
 *   splitFullName('Jane Doe')
 *     → { firstName: 'Jane', lastName: 'Doe' }
 *   splitFullName('Cher')
 *     → { firstName: 'Cher', lastName: '' }
 *   splitFullName('')
 *     → { firstName: '', lastName: '' }
 *
 * If the last token is a particle (de, van, etc.) — uncommon as a surname on
 * its own — we still treat it as the last name; the caller is responsible
 * for fancier parsing if needed.
 */
function splitFullName(s) {
  if (s == null) return { firstName: '', lastName: '' };
  const normalized = titleCaseIfAllCaps(String(s)).trim();
  if (!normalized) return { firstName: '', lastName: '' };

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };

  // Last token is the surname; everything else is first/middle.
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(' ');
  return { firstName, lastName };
}

/**
 * Normalize a contact-name string (sellerName, buyerName, etc.) to
 * title-cased form with Mc/Mac preserved. Doesn't split — use
 * splitFullName for that.
 *
 *   normalizeContactName('DENNIS ALFRED MCMASTER')
 *     → 'Dennis Alfred McMaster'
 *   normalizeContactName('JANE MACKENZIE')
 *     → 'Jane MacKenzie'
 *   normalizeContactName('Jane McDonald')
 *     → 'Jane McDonald' (unchanged)
 */
function normalizeContactName(s) {
  return titleCaseIfAllCaps(s);
}

export {
  titleCaseIfAllCaps,
  fixMcMacPrefix,
  formatPostalCode,
  splitFullName,
  normalizeContactName,
};
