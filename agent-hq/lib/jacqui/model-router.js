// lib/jacqui/model-router.js
//
// Picks the right Anthropic model for the task. Replaces the hardcoded
// JACQUI_MODEL across the codebase so we can route per-call.
//
// Task classes:
//   - 'quick'     — fast classification, routing, lightweight Q&A.
//                   Haiku 4.5. Sub-second to a few seconds.
//   - 'reasoning' — drafting emails, decomposing docs, multi-step thinking
//                   that benefits from a stronger model. Sonnet 4.6.
//   - 'heavy'     — weekly digests, mastermind synthesis, hard analysis,
//                   self-improvement meta-passes. Opus 4.6.
//
// Override via env vars (per-class) so we can swap models without code changes:
//   JACQUI_MODEL_QUICK     — default 'claude-haiku-4-5-20251001'
//   JACQUI_MODEL_REASONING — default 'claude-sonnet-4-6'
//   JACQUI_MODEL_HEAVY     — default 'claude-opus-4-6'
//
// Legacy: JACQUI_MODEL (no class suffix) still works as the 'quick' override
// for backwards compat with the existing system-prompt.js.
//
// Created 2026-05-25.

export const MODEL_CLASS = {
  QUICK: 'quick',
  REASONING: 'reasoning',
  HEAVY: 'heavy',
};

// Defaults — bump these when newer model IDs ship.
const DEFAULTS = {
  quick: 'claude-haiku-4-5-20251001',
  reasoning: 'claude-sonnet-4-6',
  heavy: 'claude-opus-4-6',
};

export function pickModel(taskClass = 'quick') {
  const cls = String(taskClass).toLowerCase();
  if (cls === MODEL_CLASS.HEAVY) {
    return process.env.JACQUI_MODEL_HEAVY || DEFAULTS.heavy;
  }
  if (cls === MODEL_CLASS.REASONING) {
    return process.env.JACQUI_MODEL_REASONING || DEFAULTS.reasoning;
  }
  return process.env.JACQUI_MODEL_QUICK || process.env.JACQUI_MODEL || DEFAULTS.quick;
}

// pickModelWithFallback returns a chain — caller can iterate and try the next
// one if a call fails (e.g. heavy model momentarily unavailable).
export function pickModelWithFallback(taskClass = 'quick') {
  const cls = String(taskClass).toLowerCase();
  if (cls === MODEL_CLASS.HEAVY) {
    return [
      process.env.JACQUI_MODEL_HEAVY || DEFAULTS.heavy,
      process.env.JACQUI_MODEL_REASONING || DEFAULTS.reasoning,
      process.env.JACQUI_MODEL_QUICK || DEFAULTS.quick,
    ];
  }
  if (cls === MODEL_CLASS.REASONING) {
    return [
      process.env.JACQUI_MODEL_REASONING || DEFAULTS.reasoning,
      process.env.JACQUI_MODEL_QUICK || DEFAULTS.quick,
    ];
  }
  return [process.env.JACQUI_MODEL_QUICK || process.env.JACQUI_MODEL || DEFAULTS.quick];
}

// callAnthropicWithFallback — try a chain of models until one succeeds.
// Returns { completion, model, attempts } on success, throws on full chain failure.
export async function callAnthropicWithFallback({ anthropic, taskClass, requestParams }) {
  const chain = pickModelWithFallback(taskClass);
  const attempts = [];
  let lastErr = null;
  for (const model of chain) {
    try {
      const completion = await anthropic.messages.create({
        ...requestParams,
        model,
      });
      attempts.push({ model, ok: true });
      return { completion, model, attempts };
    } catch (e) {
      attempts.push({ model, ok: false, error: e.message });
      lastErr = e;
      // If it's a 4xx (bad request / invalid model), don't retry — code bug.
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) break;
    }
  }
  throw new Error(`All models in chain failed: ${attempts.map(a => `${a.model}:${a.error || 'ok'}`).join(' → ')}`);
}


// ---------------------------------------------------------------------------
// Phase 4.1.5 — Turn classifier + status-based model routing
//
// Classify each chat turn into ACK / QUALIFY / WORKING / DONE / ERROR using
// Haiku (cheap, fast). Then route QUALIFY/ERROR to Sonnet (reasoning),
// everything else to Haiku (quick). Inverts the prior "always Sonnet" default
// so most turns are cheap; only high-stakes turns escalate.
//
// Env override: JACQUI_DISABLE_SONNET_ESCALATION=1 forces quick for everything.
//
// Added 2026-05-27.

const CLASSIFY_PROMPT = `You will receive Jonathan's latest message and the recent chat history.
Output ONLY one of these five words: ACK, QUALIFY, WORKING, DONE, ERROR.

- QUALIFY = the message is ambiguous and needs a clarifying question before acting.
- ERROR = the previous tool call returned an error or Jacqui cannot fulfill the request.
- ACK = Jonathan gave an unambiguous task that requires tool calls.
- WORKING = interim status during a multi-step task.
- DONE = the task is complete and a summary is being returned.

Default to ACK if you're not sure. Output exactly one word.`;

/**
 * Classify a Jacqui chat turn into one of the five contract states.
 * Always uses Haiku (cheap, fast). Returns 'ACK' on any failure.
 * @param {Object} opts
 * @param {Object} opts.anthropic       Initialized Anthropic SDK client
 * @param {string} opts.userMessage     The latest user turn
 * @param {Array}  [opts.recentHistory] Last few thread messages for context
 * @returns {Promise<'ACK'|'QUALIFY'|'WORKING'|'DONE'|'ERROR'>}
 */
export async function classifyTurn({ anthropic, userMessage, recentHistory }) {
  try {
    const historyText = (recentHistory || [])
      .slice(-6)
      .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 400) : ''}`)
      .join('\n');

    const r = await anthropic.messages.create({
      model: pickModel('quick'),
      max_tokens: 8,
      messages: [{
        role: 'user',
        content: `${CLASSIFY_PROMPT}\n\n---\nRecent history:\n${historyText}\n\n---\nLatest user message:\n${userMessage}`,
      }],
    });

    const text = (r.content?.[0]?.text || '').trim().toUpperCase();
    const valid = ['ACK', 'QUALIFY', 'WORKING', 'DONE', 'ERROR'];
    return valid.includes(text) ? text : 'ACK';
  } catch (e) {
    // Classifier failure must NEVER block the main reply. Fall back to ACK.
    console.warn('[model-router] classifyTurn failed:', e.message);
    return 'ACK';
  }
}

/**
 * Pick the right model based on turn classification.
 * QUALIFY and ERROR turns route to reasoning (Sonnet). Everything else
 * stays on quick (Haiku) for speed and cost.
 *
 * Env override: JACQUI_DISABLE_SONNET_ESCALATION=1 forces quick for everything.
 */
export function pickModelForStatus(status) {
  if (process.env.JACQUI_DISABLE_SONNET_ESCALATION === '1') return pickModel('quick');
  if (status === 'QUALIFY' || status === 'ERROR') return pickModel('reasoning');
  return pickModel('quick');
}
