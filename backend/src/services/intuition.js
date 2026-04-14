/**
 * Intuition — load Jonathan's vocabulary + long-term memory and fold it
 * into Claude's system prompt on every request. Cached in-process for 60s
 * so we're not doing two extra queries per task.
 */
const pool = require('../db/pool');

const CACHE_TTL_MS = 60 * 1000;
const MAX_VOCAB = 60;          // top-N by weight
const MAX_MEMORY = 30;         // top-N by importance

let cache = { at: 0, vocab: [], memory: [] };

async function refreshCache() {
  const [v, m] = await Promise.all([
    pool.query(
      `SELECT term, expansion FROM agent_vocabulary
       WHERE enabled = TRUE
       ORDER BY weight DESC, term ASC
       LIMIT $1`,
      [MAX_VOCAB]
    ),
    pool.query(
      `SELECT key, value, category, importance FROM agent_memory
       ORDER BY importance DESC, updated_at DESC
       LIMIT $1`,
      [MAX_MEMORY]
    )
  ]);
  cache = { at: Date.now(), vocab: v.rows, memory: m.rows };
  return cache;
}

async function getContext() {
  if (Date.now() - cache.at > CACHE_TTL_MS) await refreshCache();
  return cache;
}

/**
 * Formats vocabulary + memory as a compact context block that gets appended
 * to Claude's system prompt. Keeps token cost low while giving the agent
 * everything it needs to sound like it's been working with Jonathan for years.
 */
async function buildContextBlock() {
  try {
    const { vocab, memory } = await getContext();

    const vocabLines = vocab.map(v => `- ${v.term}: ${v.expansion}`);
    const memByCat = {};
    for (const m of memory) (memByCat[m.category] = memByCat[m.category] || []).push(m);

    const memBlocks = Object.entries(memByCat).map(([cat, items]) =>
      `### ${cat}\n` + items.map(m => `- ${m.key}: ${m.value}`).join('\n')
    );

    const out = [];
    if (vocabLines.length) {
      out.push('## Jonathan\'s vocabulary');
      out.push('When Jonathan uses these terms, interpret them exactly as defined:');
      out.push(vocabLines.join('\n'));
    }
    if (memBlocks.length) {
      out.push('\n## What you know about Jonathan');
      out.push(memBlocks.join('\n\n'));
    }
    return out.join('\n');
  } catch (e) {
    console.error('intuition.buildContextBlock error:', e.message);
    return '';
  }
}

/** Invalidate the cache after an upsert so changes take effect immediately. */
function invalidate() { cache.at = 0; }

/** Lightweight helper for Claude's `search_dashboard` complements — finds
 *  a memory or vocabulary entry by keyword. */
async function lookup(query) {
  const q = '%' + query + '%';
  const [v, m] = await Promise.all([
    pool.query(
      `SELECT term, expansion FROM agent_vocabulary
       WHERE enabled = TRUE AND (term ILIKE $1 OR expansion ILIKE $1) LIMIT 10`, [q]),
    pool.query(
      `SELECT key, value, category FROM agent_memory
       WHERE key ILIKE $1 OR value ILIKE $1 LIMIT 10`, [q])
  ]);
  return { vocabulary: v.rows, memory: m.rows };
}

module.exports = { buildContextBlock, getContext, invalidate, lookup };
