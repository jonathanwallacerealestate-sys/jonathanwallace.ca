/**
 * Voice control — single source of truth for speech input/output on the
 * Agent Command Center.
 *
 * Hotkeys:
 *   F5 (tap)     — focus the agent compose box AND start in-browser voice
 *                  recognition. If you use Wispr Flow or another system-wide
 *                  dictation tool, the OS typically grabs F5 first — the
 *                  textarea is already focused for you. Our in-browser
 *                  recognition is the fallback.
 *   F5 (hold)    — push-to-talk. Hold, speak, release to auto-send to Claude.
 *                  Claude's response is spoken back aloud.
 *   F6          — Brief Me (morning briefing)
 *   Esc          — stop any recording/speaking and close modal
 *
 * Also wires the microphone button in the compose card to the same flow.
 */
(function(){
  'use strict';

  const HOLD_THRESHOLD_MS = 250;    // below this = tap, above = hold
  const MAX_HOLD_TIME_MS = 60000;   // safety cap

  let state = {
    recog: null,
    listening: false,
    holdTimer: null,
    holdStart: 0,
    mode: 'idle',                   // idle | tap | hold | auto-sent
    utterance: null,
    voiceReplyEnabled: true,        // speaks Claude responses after voice send
    lastVoiceTaskId: null
  };

  document.addEventListener('DOMContentLoaded', () => {
    setupGlobalHotkeys();
    setupMicButton();
    indicator.init();
  });

  // ------------- Hotkeys -------------
  function setupGlobalHotkeys() {
    // Keydown — repeat events are suppressed
    let keyDownAt = 0;
    let f5Held = false;

    window.addEventListener('keydown', (e) => {
      // F5 — voice hotkey (override browser reload, service worker has our back)
      if (e.key === 'F5' && !e.repeat) {
        e.preventDefault();
        keyDownAt = Date.now();
        f5Held = false;
        state.holdStart = keyDownAt;

        // If the user holds past the threshold, switch to hold-to-talk mode
        state.holdTimer = setTimeout(() => {
          f5Held = true;
          startListening('hold');
        }, HOLD_THRESHOLD_MS);
      }

      // F6 — Brief Me
      if (e.key === 'F6' && !e.repeat) {
        e.preventDefault();
        if (window.DB_BRIEF) window.DB_BRIEF.run();
      }

      // Esc — panic stop
      if (e.key === 'Escape') {
        stopListening();
        stopSpeaking();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'F5') {
        e.preventDefault();
        const held = Date.now() - keyDownAt;
        clearTimeout(state.holdTimer);

        if (f5Held) {
          // Push-to-talk: stop + auto-send
          stopListening({ autoSend: true });
        } else {
          // Tap: focus compose + begin listening (no auto-send)
          focusCompose();
          startListening('tap');
        }
      }
    });
  }

  // ------------- Mic button in the compose card -------------
  function setupMicButton() {
    const btn = document.getElementById('agent-voice');
    if (!btn) return;
    // Click = tap behaviour (start/stop toggle, no auto-send)
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.listening) stopListening();
      else { focusCompose(); startListening('tap'); }
    });
    // Long-press = hold behaviour (push-to-talk)
    let touchTimer = null;
    btn.addEventListener('mousedown', () => {
      touchTimer = setTimeout(() => startListening('hold'), HOLD_THRESHOLD_MS);
    });
    btn.addEventListener('mouseup', () => {
      clearTimeout(touchTimer);
      if (state.mode === 'hold') stopListening({ autoSend: true });
    });
    btn.addEventListener('mouseleave', () => clearTimeout(touchTimer));
  }

  function focusCompose() {
    const ta = document.getElementById('agent-instruction');
    if (!ta) return;
    // Scroll the tasks card into view (nav chip) and focus
    const taskCard = document.querySelector('[data-section="tasks"]');
    if (taskCard) taskCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => ta.focus(), 200);
  }

  // ------------- Speech Recognition -------------
  function getRecognizer() {
    if (state.recog) return state.recog;
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) return null;
    const r = new Rec();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-CA';
    state.recog = r;
    return r;
  }

  function startListening(mode) {
    if (state.listening) return;
    const ta = document.getElementById('agent-instruction');
    if (!ta) return;
    const r = getRecognizer();
    if (!r) {
      indicator.show('Voice unavailable on this browser', 'error');
      return;
    }

    // Safety: kill any current utterance so TTS doesn't interfere
    stopSpeaking();

    state.mode = mode;
    state.listening = true;
    state.originalValue = ta.value;
    state.finalTranscript = '';

    // Results handler
    const onResult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) state.finalTranscript += res[0].transcript;
        else interim += res[0].transcript;
      }
      ta.value = (state.originalValue + ' ' + state.finalTranscript + ' ' + interim).trim();
    };
    const onError = (e) => {
      indicator.show('Voice: ' + (e.error || 'error'), 'error');
      stopListening();
    };
    const onEnd = () => {
      if (state.listening) stopListening();
    };
    r.onresult = onResult;
    r.onerror = onError;
    r.onend = onEnd;

    try { r.start(); }
    catch (err) { stopListening(); return; }

    indicator.show(mode === 'hold' ? 'Hold-to-talk — release to send' : 'Listening… (Esc to cancel)');
    decorateMicBtn(true);

    // Auto-stop after 60s safety cap for hold mode
    if (mode === 'hold') {
      state.holdSafety = setTimeout(() => {
        if (state.mode === 'hold' && state.listening) stopListening({ autoSend: true });
      }, MAX_HOLD_TIME_MS);
    }
  }

  function stopListening(opts = {}) {
    clearTimeout(state.holdSafety);
    const wasListening = state.listening;
    state.listening = false;
    decorateMicBtn(false);
    indicator.hide();
    try { state.recog && state.recog.stop(); } catch (e) {}
    if (!wasListening) return;

    if (opts.autoSend) {
      const ta = document.getElementById('agent-instruction');
      if (ta && ta.value.trim()) {
        state.lastVoiceTaskId = null;
        if (window.DB_RENDER && window.DB_RENDER.submitAgent) {
          indicator.show('Sending to agent…');
          // submitAgent is async but doesn't return — we poll below for the result
          Promise.resolve(window.DB_RENDER.submitAgent()).then(() => {
            setTimeout(() => indicator.hide(), 1200);
            if (state.voiceReplyEnabled) pollAndSpeakNewestResult();
          });
        }
      } else {
        indicator.show('Nothing to send', 'error');
        setTimeout(() => indicator.hide(), 1500);
      }
    }
    state.mode = 'idle';
  }

  // ------------- Voice reply (Claude → TTS) -------------
  async function pollAndSpeakNewestResult() {
    // Wait for the worker to pick up the task (typically 10-30s). Poll the
    // most recent task and, once it's completed, speak a friendly summary.
    try {
      const { api } = window.DB;
      // Grab the newest task id
      const { tasks } = await api('/api/tasks?limit=1');
      if (!tasks || !tasks.length) return;
      const newest = tasks[0];
      state.lastVoiceTaskId = newest.id;

      indicator.show('Agent working…');
      let attempts = 0;
      const maxAttempts = 30; // ~90s
      const poll = async () => {
        attempts++;
        try {
          const { task } = await api('/api/tasks/' + newest.id);
          if (task.status === 'completed') {
            indicator.hide();
            const spoken = extractSpeakableSummary(task.result && task.result.content);
            if (spoken) speak(spoken);
            return;
          }
          if (task.status === 'failed') {
            indicator.show('Task failed', 'error');
            setTimeout(() => indicator.hide(), 1500);
            return;
          }
        } catch (e) { /* keep polling */ }
        if (attempts < maxAttempts) setTimeout(poll, 3000);
        else indicator.hide();
      };
      setTimeout(poll, 4000);
    } catch (e) { /* no-op */ }
  }

  // Extract a speakable version of a markdown result — strip headings,
  // code blocks, and links; cap to ~60 seconds of speech (~450 chars).
  function extractSpeakableSummary(markdown) {
    if (!markdown) return '';
    let text = String(markdown)
      .replace(/```[\s\S]*?```/g, ' ')       // drop code blocks
      .replace(/^#+\s*/gm, '')               // drop heading markers
      .replace(/\*\*([^*]+)\*\*/g, '$1')     // bold → plain
      .replace(/\*([^*]+)\*/g, '$1')         // italic → plain
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → label
      .replace(/[-*]\s+/g, ' ')              // list bullets → space
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 900) text = text.slice(0, 900) + '. The full response is in the dashboard.';
    return text;
  }

  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    stopSpeaking();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-CA';
    u.rate = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => /Samantha|Daniel|Karen|Alex|Moira/i.test(v.name));
    if (preferred) u.voice = preferred;
    state.utterance = u;
    window.speechSynthesis.speak(u);
  }
  function stopSpeaking() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    state.utterance = null;
  }

  // ------------- Visual indicator (top-of-page pill) -------------
  const indicator = {
    el: null,
    init() {
      if (document.getElementById('voice-indicator')) { this.el = document.getElementById('voice-indicator'); return; }
      const el = document.createElement('div');
      el.id = 'voice-indicator';
      el.style.cssText = `
        position: fixed; top: 70px; left: 50%; transform: translateX(-50%) translateY(-20px);
        background: #1a1a2e; color: #fff; padding: 0.5rem 1rem; border-radius: 999px;
        font-size: 0.85rem; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 300; opacity: 0; pointer-events: none; transition: all 0.25s ease;
        display: flex; align-items: center; gap: 0.5rem;
      `;
      el.innerHTML = '<span class="vi-dot" style="width:8px;height:8px;border-radius:50%;background:#ef4444;animation:vi-pulse 1s ease-in-out infinite"></span><span class="vi-text"></span>';
      const style = document.createElement('style');
      style.textContent = '@keyframes vi-pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.6);opacity:0.4} }';
      document.head.appendChild(style);
      document.body.appendChild(el);
      this.el = el;
    },
    show(text, kind = 'listening') {
      if (!this.el) this.init();
      this.el.querySelector('.vi-text').textContent = text;
      this.el.querySelector('.vi-dot').style.background = kind === 'error' ? '#f59e0b' : '#ef4444';
      this.el.style.opacity = '1';
      this.el.style.transform = 'translateX(-50%) translateY(0)';
    },
    hide() {
      if (!this.el) return;
      this.el.style.opacity = '0';
      this.el.style.transform = 'translateX(-50%) translateY(-20px)';
    }
  };

  function decorateMicBtn(active) {
    const btn = document.getElementById('agent-voice');
    if (!btn) return;
    if (active) {
      btn.style.background = '#ef4444';
      btn.style.color = '#fff';
      btn.innerHTML = '&#9632;';
    } else {
      btn.style.background = '#f3f4f6';
      btn.style.color = '';
      btn.innerHTML = '&#127908;';
    }
  }

  // Expose for Settings / other modules
  window.DB_VOICE = {
    startListening, stopListening, speak, stopSpeaking,
    setVoiceReply(on) { state.voiceReplyEnabled = !!on; },
    isListening() { return state.listening; }
  };
})();
