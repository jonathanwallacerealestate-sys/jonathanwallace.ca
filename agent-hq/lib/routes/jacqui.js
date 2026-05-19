// lib/routes/jacqui.js
//
// Routes for Jacqui — Jonathan's personal AI assistant, named in honour of his mom.
//
//   POST   /api/jacqui/chat       — send a message, get a reply (persists thread)
//   GET    /api/jacqui/history    — load thread (last N messages)
//   POST   /api/jacqui/clear      — wipe thread
//
// Phase 2: voice + memories + email toolkit (5 tools via Make.com Outlook Gateway).
//
// CHANGES IN THIS VERSION (2026-05-19):
//   • PERSISTENCE FIX — only plain-text assistant replies are written to the
//     thread file. Tool_use / tool_result blocks live in-memory for the
//     current request's tool-use loop only. Fixes React #31 ("Objects are
//     not valid as a React child") in the Jacqui tab.
//   • Tool calls still returned to the caller in the response's `tool_calls`
//     array for debugging.
//
// Previous changes (2026-05-18):
//   • Anthropic tool-use loop wired in (up to 5 rounds).
//   • Five email tools exposed: create_email_draft, send_email, read_inbox,
//     search_messages, mark_read — all via Make.com "Agent Outlook Gateway"
//     (scenario 5106541, hook.us2.make.com/2ikw0v0f6k2os8xetecaa71if1gac9mu).
//   • send_email guarded by strict description-level rules.
//   • Optional env var: OUTLOOK_GATEWAY_URL (defaults to hardcoded URL).

import fs from 'fs';
import path from 'path';
import { buildSystemPrompt, JACQUI_MODEL, JACQUI_MAX_TOKENS, JACQUI_HISTORY_CAP } from '../jacqui/system-prompt.js';
import { loadMemoryContext } from './jacqui-memory.js';

const OUTLOOK_GATEWAY_URL =
  process.env.OUTLOOK_GATEWAY_URL ||
  'https://hook.us2.make.com/2ikw0v0f6k2os8xetecaa71if1gac9mu';

// --- Tool definitions exposed to Jacqui ----------------------------------
const JACQUI_TOOLS = [
  {
    name: 'create_email_draft',
    description:
      "Create a draft email in Jonathan's Faris Team Outlook (jonathan@faristeam.ca). " +
      "DEFAULT TOOL for any email request — use this unless Jonathan has explicitly told " +
      "you to SEND in his most recent message. The draft lands in Outlook Drafts for him " +
      "to review and one-click send. Follow the operating manual: no bold formatting; " +
      "sign off with one of 'Cheers', 'Have a powerful day', or 'Talk soon'; tone is " +
      "professional/calm/clear/direct/helpful; never fabricate, never give legal/financial " +
      "advice, never bind agreements.",
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address. Single address. For multiple recipients, mention CCs in the body or ask Jonathan.',
        },
        subject: {
          type: 'string',
          description: 'Email subject line. Keep concise. If replying, prefix with "Re: ".',
        },
        body: {
          type: 'string',
          description:
            "Plain text or simple HTML body. Always sign off with one of: " +
            "'Cheers, Jonathan', 'Have a powerful day, Jonathan', or 'Talk soon, Jonathan'. " +
            "No bold formatting.",
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'send_email',
    description:
      "Send an email IMMEDIATELY from Jonathan's Faris Team Outlook (jonathan@faristeam.ca) " +
      "— no draft, no review step. " +
      "STRICT GUARDRAIL — only use this tool when ALL of the following are true: " +
      "(1) Jonathan's MOST RECENT message contains an explicit send verb directed at this email " +
      "('send', 'send it', 'send the email', 'ship it', 'fire it off', 'go ahead and send', " +
      "'send now', 'yes send', or near-identical phrasing); " +
      "(2) You have already shown Jonathan the draft content earlier in the conversation, " +
      "OR the email body is short and unambiguous AND falls inside an approved autonomous " +
      "action from the operating manual (Realtor.ca reply, appointment confirmation, showing " +
      "coordination, factual property answer, vendor coordination, feedback follow-up, prep " +
      "materials); " +
      "(3) The email does NOT involve legal language, financial terms, deal negotiation, " +
      "contract terms, lawyer communication, signature requests, or payment. " +
      "If ANY of the three conditions is unclear or false, use create_email_draft instead " +
      "and tell Jonathan 'I put it in your Drafts — say send when you want it out.' " +
      "Follow the operating manual: no bold, approved sign-offs only, professional tone, " +
      "never fabricate. If Jonathan said 'draft', 'write me one', 'compose', or any non-send " +
      "verb, use create_email_draft — NOT this tool.",
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address. Single address.',
        },
        subject: {
          type: 'string',
          description: 'Email subject line. Keep concise. If replying, prefix with "Re: ".',
        },
        body: {
          type: 'string',
          description:
            "Plain text or simple HTML body. Sign off with one of: " +
            "'Cheers, Jonathan', 'Have a powerful day, Jonathan', or 'Talk soon, Jonathan'. " +
            "No bold formatting.",
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'read_inbox',
    description:
      "Read the most recent messages from Jonathan's Faris Team Outlook Inbox " +
      "(jonathan@faristeam.ca). Use when Jonathan asks 'what's in my inbox?', " +
      "'any new emails?', 'show me my recent emails', or as part of inbox processing " +
      "windows. Returns each message's id, subject, from, receivedDateTime, bodyPreview, " +
      "isRead, hasAttachments. After reading, run inbox-triage UX per the system prompt: " +
      "for each actionable email, surface 3 labeled response options (Direct / Warm / Ask back) " +
      "in plain text so Jonathan can pick one — DO NOT immediately call create_email_draft. " +
      "Also flag urgent items and escalations per the SOP (signature requests, legal, " +
      "deal-collapse risk, high-value client concerns, financial risk, urgent seller " +
      "dissatisfaction).",
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'How many messages to fetch (default 25, max 100). Use 10 for a quick scan, 25-50 for full processing window.',
        },
      },
    },
  },
  {
    name: 'search_messages',
    description:
      "Search Jonathan's Faris Team Outlook for messages matching a query string. " +
      "Use when looking up a specific client thread, address, vendor, or topic. " +
      "Query syntax follows Outlook search: bare text searches everywhere; 'from:foo' " +
      "narrows by sender; 'subject:bar' narrows by subject; 'AND' / 'OR' combine. " +
      "Examples: '47 Bay Street' / 'from:realtor.ca' / 'subject:offer AND from:gmail.com'. " +
      "Returns id, subject, from, receivedDateTime, bodyPreview, isRead for each match.",
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query — bare text or Outlook search operators (from:, subject:, AND, OR).',
        },
        limit: {
          type: 'number',
          description: 'Max results (default 25).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'mark_read',
    description:
      "Mark a specific email message as READ in Jonathan's Faris Team Outlook. Use " +
      "AFTER you've handled a message (drafted a reply, surfaced it to Jonathan, " +
      "filed it, etc.) to clear it from the unread queue. Per the SOP: never delete " +
      "automatically, only mark read. Pass the messageId returned by read_inbox or " +
      "search_messages.",
    input_schema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The Outlook message ID returned by read_inbox or search_messages (the `id` field).',
        },
      },
      required: ['messageId'],
    },
  },
];

// --- Helpers --------------------------------------------------------------
async function callOutlookGateway(action, action_params) {
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

async function runTool(name, input) {
  switch (name) {
    case 'create_email_draft':
      return await callOutlookGateway('create_email_draft', {
        to: input.to,
        subject: input.subject,
        body: input.body,
      });
    case 'send_email':
      return await callOutlookGateway('send_email', {
        to: input.to,
        subject: input.subject,
        body: input.body,
      });
    case 'read_inbox':
      return await callOutlookGateway('read_inbox', {
        limit: input.limit || 25,
      });
    case 'search_messages':
      return await callOutlookGateway('search_messages', {
        query: input.query,
        limit: input.limit || 25,
      });
    case 'mark_read':
      return await callOutlookGateway('mark_read', {
        messageId: input.messageId,
      });
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

/**
 * deps:
 *   anthropic       — initialized Anthropic SDK client (or null if not configured)
 *   JACQUI_DIR      — absolute path of the Jacqui state dir
 *   threadFile      — (optional) override thread filename. defaults to 'main.json'
 */
export function register(app, deps) {
  const { anthropic, JACQUI_DIR, threadFile = 'main.json' } = deps;
  const THREAD_PATH = path.join(JACQUI_DIR, threadFile);

  function loadThread() {
    if (!fs.existsSync(THREAD_PATH)) return [];
    try { return JSON.parse(fs.readFileSync(THREAD_PATH, 'utf8')); }
    catch (e) {
      console.warn('[Jacqui] thread parse failed, starting fresh:', e.message);
      return [];
    }
  }

  function saveThread(messages) {
    try {
      const trimmed = messages.slice(-JACQUI_HISTORY_CAP);
      fs.writeFileSync(THREAD_PATH, JSON.stringify(trimmed, null, 2));
    } catch (e) {
      console.error('[Jacqui] thread save failed:', e.message);
    }
  }

  // GET /api/jacqui/history — return current thread
  app.get('/api/jacqui/history', (req, res) => {
    res.json({ success: true, messages: loadThread(), model: JACQUI_MODEL });
  });

  // POST /api/jacqui/clear — wipe the thread
  app.post('/api/jacqui/clear', (req, res) => {
    try {
      if (fs.existsSync(THREAD_PATH)) fs.unlinkSync(THREAD_PATH);
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  // POST /api/jacqui/chat — send a message, get a reply (with tool-use loop)
  app.post('/api/jacqui/chat', async (req, res) => {
    if (!anthropic) {
      return res.json({ success: false, error: 'Anthropic not configured' });
    }
    const userMessage = String(req.body?.message || '').trim();
    if (!userMessage) {
      return res.json({ success: false, error: 'Empty message' });
    }

    // Load thread, append user turn
    const thread = loadThread();
    thread.push({ role: 'user', content: userMessage, ts: new Date().toISOString() });

    // Build Anthropic-shaped messages from thread.
    // For tool-use turns we may have richer `content` arrays in memory; pass them through
    // when they're already arrays, otherwise wrap the string.
    const messages = thread.slice(-JACQUI_HISTORY_CAP).map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content,
    }));

    // Load persistent memory and compose system prompt
    let memoryBlock = '';
    try {
      memoryBlock = loadMemoryContext(JACQUI_DIR) || '';
    } catch (e) {
      console.warn('[Jacqui] memory load failed (continuing without):', e.message);
    }
    const systemPrompt = memoryBlock
      ? `${buildSystemPrompt()}\n\n---\n\n${memoryBlock}`
      : buildSystemPrompt();

    // --- Tool-use loop -----------------------------------------------------
    const MAX_TOOL_ROUNDS = 5;
    let lastUsage = null;
    let finalReplyText = '...';
    let toolCallsLog = [];

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const completion = await anthropic.messages.create({
          model: JACQUI_MODEL,
          max_tokens: JACQUI_MAX_TOKENS,
          system: systemPrompt,
          tools: JACQUI_TOOLS,
          messages,
        });

        lastUsage = completion.usage || lastUsage;
        const content = completion.content || [];

        // In-memory: keep the rich content (tool_use blocks) for the current
        // tool-use loop so Anthropic gets full context across rounds.
        messages.push({ role: 'assistant', content });

        // Persistence: store ONLY the assistant's text reply in the thread file.
        // The React UI renders message.content as a string — rich content arrays
        // (tool_use blocks) blow up with React error #31. Tool calls are returned
        // separately on each request via the `tool_calls` array.
        const textOnly = content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim();
        if (textOnly) {
          thread.push({
            role: 'assistant',
            content: textOnly,
            ts: new Date().toISOString(),
          });
        }

        // If stop_reason is anything except tool_use, we're done.
        if (completion.stop_reason !== 'tool_use') {
          finalReplyText =
            content
              .filter(b => b.type === 'text')
              .map(b => b.text)
              .join('\n')
              .trim() || '...';
          break;
        }

        // Otherwise, run each tool_use block and feed results back.
        const toolUseBlocks = content.filter(b => b.type === 'tool_use');
        const toolResultBlocks = [];
        for (const tu of toolUseBlocks) {
          const result = await runTool(tu.name, tu.input);
          toolCallsLog.push({ name: tu.name, input: tu.input, result });
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(result),
            is_error: !result.ok,
          });
        }

        // In-memory only: tool_result blocks stay in the loop messages so
        // Anthropic sees them on the next round. They do NOT go into the
        // persisted thread (they're operational, not user-facing — and they'd
        // be rich arrays that crash React).
        messages.push({ role: 'user', content: toolResultBlocks });
      }

      saveThread(thread);

      res.json({
        success: true,
        reply: finalReplyText,
        model: JACQUI_MODEL,
        usage: lastUsage,
        tool_calls: toolCallsLog,
      });
    } catch (err) {
      console.error('[Jacqui] chat error:', err.message);
      // Roll back the user message so retry is clean
      // (only the trailing user message we appended at the top of the handler)
      const idx = thread.findIndex(m => m.ts === thread[thread.length - 1]?.ts);
      if (idx >= 0) thread.pop();
      saveThread(thread);
      res.json({ success: false, error: err.message });
    }
  });
}
