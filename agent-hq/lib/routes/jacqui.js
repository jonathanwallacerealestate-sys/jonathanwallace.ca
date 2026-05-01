// lib/routes/jacqui.js
//
// Routes for Jacqui — Jonathan's personal AI assistant, named in honour of his mom.
//
//   POST   /api/jacqui/chat       — send a message, get a reply (persists thread)
//   GET    /api/jacqui/history    — load thread (last N messages)
//   POST   /api/jacqui/clear      — wipe thread
//
// Phase 1: voice + memories only, no tool use yet.
// Phase 2 will add tool definitions (listings, FUB, calendar, Gmail).

import fs from 'fs';
import path from 'path';
import { buildSystemPrompt, JACQUI_MODEL, JACQUI_MAX_TOKENS, JACQUI_HISTORY_CAP } from '../jacqui/system-prompt.js';

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

  // POST /api/jacqui/chat — send a message, get a reply
  app.post('/api/jacqui/chat', async (req, res) => {
    if (!anthropic) {
      return res.json({ success: false, error: 'Anthropic not configured' });
    }
    const userMessage = String(req.body?.message || '').trim();
    if (!userMessage) {
      return res.json({ success: false, error: 'Empty message' });
    }

    // Load and append user turn
    const thread = loadThread();
    thread.push({ role: 'user', content: userMessage, ts: new Date().toISOString() });

    // Build Anthropic-shaped messages from thread
    const messages = thread.slice(-JACQUI_HISTORY_CAP).map(m => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const completion = await anthropic.messages.create({
        model: JACQUI_MODEL,
        max_tokens: JACQUI_MAX_TOKENS,
        system: buildSystemPrompt(),
        messages,
      });

      const replyText =
        (completion.content || [])
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim() || '...';

      thread.push({ role: 'assistant', content: replyText, ts: new Date().toISOString() });
      saveThread(thread);

      res.json({
        success: true,
        reply: replyText,
        model: JACQUI_MODEL,
        usage: completion.usage || null,
      });
    } catch (err) {
      console.error('[Jacqui] chat error:', err.message);
      // Don't persist a failed turn — pop the user message back off so retry is clean
      thread.pop();
      saveThread(thread);
      res.json({ success: false, error: err.message });
    }
  });
}
