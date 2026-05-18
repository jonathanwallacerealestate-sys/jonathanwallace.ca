// lib/routes/jacqui.js
//
// Routes for Jacqui — Jonathan's personal AI assistant, named in honour of his mom.
//
//   POST   /api/jacqui/chat       — send a message, get a reply (persists thread)
//   GET    /api/jacqui/history    — load thread (last N messages)
//   POST   /api/jacqui/clear      — wipe thread
//
// Phase 2: voice + memories + first email tool (create_email_draft via Make.com).
//
// CHANGES IN THIS VERSION (2026-05-18):
//   • Anthropic tool-use loop wired in
//   • Exposes `create_email_draft` tool that calls Make.com "Agent Outlook Gateway"
//     (scenario 5106541, webhook hook.us2.make.com/2ikw0v0f6k2os8xetecaa71if1gac9mu)
//   • Default-safe: drafts only. `send_email` route exists on the gateway but is
//     intentionally NOT exposed as a Jacqui tool yet — Jonathan reviews + sends.
//   • Optional env var: OUTLOOK_GATEWAY_URL (defaults to hardcoded URL)

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
      "Use this for ALL outbound emails Jacqui composes on Jonathan's behalf. The draft " +
      "lands in Outlook Drafts for Jonathan to review and send with one click. Follow the " +
      "operating manual: no bold formatting; sign off with one of 'Cheers', 'Have a " +
      "powerful day', or 'Talk soon'; tone is professional/calm/clear/direct/helpful; " +
      "never fabricate answers, never give legal/financial advice, never bind agreements.",
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
            "HTML or plain text body of the email. Plain text is preferred. Always sign " +
            "off with one of: 'Cheers, Jonathan', 'Have a powerful day, Jonathan', or " +
            "'Talk soon, Jonathan'. No bold formatting.",
        },
      },
      required: ['to', 'subject', 'body'],
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

        // Persist the assistant turn's full content (including tool_use blocks)
        // back into the thread so future turns see the context.
        thread.push({
          role: 'assistant',
          content: content,
          ts: new Date().toISOString(),
        });
        // Mirror for in-loop messages
        messages.push({ role: 'assistant', content });

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

        // Append tool_result as a user turn
        thread.push({
          role: 'user',
          content: toolResultBlocks,
          ts: new Date().toISOString(),
        });
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
