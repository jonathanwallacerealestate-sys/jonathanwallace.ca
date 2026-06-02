// agent-hq/lib/jacqui/context-loaders/listings.js
//
// Phase 5 — wire BrokerBay active-listings snapshot into Jacqui's chat context.
//
// The snapshot is written by the brokerbay-active-listings skill via the Chrome
// extension (see agent-hq-sync). The Agent HQ Listings tab reads the same store.
// Until this module shipped, Jacqui had no awareness of active listings and
// would honestly say so when asked. Now she answers from grounded data.
//
// Created 2026-05-27.

import fs from 'fs/promises';
import path from 'path';

const STORE_PATH =
  process.env.LISTINGS_STORE_PATH ||
  path.join(process.env.JACQUI_DIR || './data', 'listings/active.json');

/**
 * Load the active listings snapshot.
 * @returns {Promise<{listings: Array, refreshedAt: string|null, ageMinutes: number|null, error?: string}>}
 */
export async function loadActiveListings() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    const refreshedAt = data.refreshedAt || data.updated_at || null;
    const ageMinutes = refreshedAt
      ? Math.round((Date.now() - new Date(refreshedAt).getTime()) / 60000)
      : null;
    return {
      listings: data.listings || data.items || [],
      refreshedAt,
      ageMinutes,
    };
  } catch (err) {
    return {
      listings: [],
      error: err.code === 'ENOENT' ? 'no_store' : err.message,
    };
  }
}

/**
 * Format listings as a system-prompt block.
 * Returns an empty string when there is nothing useful to inject so the
 * prompt stays clean.
 * @returns {string}
 */
export function formatListingsContext({ listings, refreshedAt, ageMinutes, error }) {
  if (error === 'no_store') {
    return `## ACTIVE LISTINGS\nNo listings store found at \`${STORE_PATH}\`. The BrokerBay scrape may not have run yet.\n`;
  }
  if (error) {
    return `## ACTIVE LISTINGS\nListings store read error: ${error}. Treat listing-related questions with caution.\n`;
  }
  if (!listings.length) {
    return `## ACTIVE LISTINGS\nNo active listings on the brokerage feed right now.\n`;
  }

  const lines = listings.map((l, i) => {
    const status = l.status || l.availability || 'Active';
    const price = l.price ? `$${Number(l.price).toLocaleString()}` : '';
    const dom = l.daysOnMarket != null ? `${l.daysOnMarket} DOM` : '';
    const tags = [status, price, dom].filter(Boolean).join(' · ');
    return `${i + 1}. ${l.address} — ${tags}`;
  });

  const freshness = ageMinutes != null ? `(refreshed ${ageMinutes} min ago)` : '';
  return `## ACTIVE LISTINGS ${freshness}\n${lines.join('\n')}\n\nWhen Jonathan asks about active listings, answer from this list. If a specific listing isn't here, say so explicitly.\n`;
}

/**
 * Convenience helper for callers that just want the formatted block.
 * Used by lib/routes/jacqui.js to inject the listings context into the
 * system prompt on every chat turn.
 * @returns {Promise<string>}
 */
export async function loadListingsBlock() {
  const ctx = await loadActiveListings();
  return formatListingsContext(ctx);
}
