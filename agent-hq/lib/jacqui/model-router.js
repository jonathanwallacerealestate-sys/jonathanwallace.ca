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
