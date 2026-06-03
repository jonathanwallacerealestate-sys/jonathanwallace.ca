// lib/connectors/ms365.js
//
// Microsoft 365 / Outlook connector — the single abstraction Jacqui uses for
// anything email-related. Jacqui tools call domain methods on this connector;
// the connector decides which backend to use under the hood.
//
// CURRENT BACKEND: Make.com "Agent Outlook Gateway" scenario 5106541
//   (webhook hook.us2.make.com/2ikw0v0f6k2os8xetecaa71if1gac9mu).
// FUTURE BACKEND: Microsoft Graph direct, once one of two paths opens up:
//   • Anthropic registers http://localhost on the MS365 MCP Entra app
//     (current blocker: AADSTS900971 "No reply address provided"), OR
//   • Faris Team IT registers an Entra app for Agent HQ and gives us
//     client_id / client_secret / tenant_id / refresh_token.
//
// To swap backends in production, flip the MS365_BACKEND env var.
// 'make' (default)  → routes through Make.com webhook
// 'graph'           → routes through Microsoft Graph (stub until creds exist)
//
// Method signatures are deliberately Graph-shaped so the swap is one file.

const OUTLOOK_GATEWAY_URL =
  process.env.OUTLOOK_GATEWAY_URL ||
  'https://hook.us2.make.com/2ikw0v0f6k2os8xetecaa71if1gac9mu';

const BACKEND = (process.env.MS365_BACKEND || 'make').toLowerCase();

// ---- Make.com backend (current default) ---------------------------------

/**
 * Low-level POST to the Make.com Outlook Gateway scenario.
 * Returns { ok, status, ...payload } on success or { ok: false, error } on failure.
 */
async function callMakeGateway(action, action_params) {
  try {
    const resp = await fetch(OUTLOOK_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, action_params }),
    });
    const text = await resp.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    if (!resp.ok) {
      return { ok: false, status: resp.status, error: parsed?.error || text };
    }
    return { ok: true, status: resp.status, ...parsed };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const makeBackend = {
  /** Create a draft in Outlook Drafts (no send). */
  createEmailDraft: ({ to, subject, body }) =>
    callMakeGateway('create_email_draft', { to, subject, body }),

  /** Send an email immediately — only call after explicit Jonathan approval. */
  sendEmail: ({ to, subject, body }) =>
    callMakeGateway('send_email', { to, subject, body }),

  /** Read the most recent inbox messages (default 25, max 100). */
  readInbox: ({ limit = 25 } = {}) =>
    callMakeGateway('read_inbox', { limit }),

  /** Outlook KQL-style search over the mailbox. */
  searchMessages: ({ query, limit = 25 }) =>
    callMakeGateway('search_messages', { query, limit }),

  /** Mark a single message as read by Graph message id. */
  markRead: ({ messageId }) =>
    callMakeGateway('mark_read', { messageId }),
};

// ---- Microsoft Graph backend (stub, ships when creds are provisioned) ---
//
// When MS365_BACKEND=graph and the following env vars are set, this backend
// activates. Until then every method returns a clear "not yet enabled" error
// so misconfiguration is obvious instead of silent.
//
//   MS365_TENANT_ID
//   MS365_CLIENT_ID
//   MS365_CLIENT_SECRET
//   MS365_REFRESH_TOKEN
//   MS365_USER_PRINCIPAL_NAME  (e.g. jonathan@faristeam.ca)

function graphNotReady(method) {
  const missing = [
    'MS365_TENANT_ID',
    'MS365_CLIENT_ID',
    'MS365_CLIENT_SECRET',
    'MS365_REFRESH_TOKEN',
    'MS365_USER_PRINCIPAL_NAME',
  ].filter(k => !process.env[k]);

  return {
    ok: false,
    error:
      `MS365 Graph backend not yet provisioned (method: ${method}). ` +
      (missing.length
        ? `Missing env vars: ${missing.join(', ')}. `
        : `All env vars present but Graph implementation is a stub. `) +
      `Set MS365_BACKEND=make to fall back to Make.com.`,
  };
}

const graphBackend = {
  createEmailDraft: async () => graphNotReady('createEmailDraft'),
  sendEmail:        async () => graphNotReady('sendEmail'),
  readInbox:        async () => graphNotReady('readInbox'),
  searchMessages:   async () => graphNotReady('searchMessages'),
  markRead:         async () => graphNotReady('markRead'),
};

// ---- Dispatch -----------------------------------------------------------

const backends = { make: makeBackend, graph: graphBackend };
const active = backends[BACKEND] || makeBackend;

/**
 * MS365 connector — the only thing Jacqui's tools call for email work.
 * `backendName` is exposed so callers (and health checks) can log which
 * backend is actually wired in.
 */
export const ms365 = {
  backendName: BACKEND in backends ? BACKEND : 'make',
  createEmailDraft: (input) => active.createEmailDraft(input),
  sendEmail:        (input) => active.sendEmail(input),
  readInbox:        (input) => active.readInbox(input),
  searchMessages:   (input) => active.searchMessages(input),
  markRead:         (input) => active.markRead(input),
};

export default ms365;
