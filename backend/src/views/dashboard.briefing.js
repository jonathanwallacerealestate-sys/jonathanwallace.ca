/**
 * Morning briefing client — one-tap Claude summary of your day, spoken aloud
 * via the browser's SpeechSynthesis API (works on iPhone, desktop Safari/Chrome).
 */
(function(){
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('brief-btn');
    if (btn) btn.addEventListener('click', runBriefing);

    const gapsBtn = document.getElementById('gaps-btn');
    if (gapsBtn) gapsBtn.addEventListener('click', runGapAnalysis);

    const emailBtn = document.getElementById('email-day-btn');
    if (emailBtn) emailBtn.addEventListener('click', emailMyDay);
  });

  async function runGapAnalysis() {
    const { openModal, api, toast } = window.DB;
    openModal('What did I forget?', `
      <div id="gaps-content" style="min-height:120px;font-size:1rem;line-height:1.6;color:var(--text)">
        <div style="display:flex;align-items:center;gap:0.75rem;color:var(--muted)">
          <div class="pulse" style="width:10px;height:10px;border-radius:50%;background:#ef4444;animation:pulse 1.2s ease-in-out infinite"></div>
          <span>Checking the last 7 days…</span>
        </div>
      </div>
    `, `
      <button class="btn-secondary" id="gaps-replay" style="display:none">Speak it</button>
      <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
    `);
    try {
      const data = await api('/api/brief/gaps');
      const analysis = data.analysis || 'All clear.';
      const content = document.getElementById('gaps-content');
      if (content) {
        content.innerHTML = '';
        analysis.split(/\n{2,}/).forEach(p => {
          const el = document.createElement('p');
          el.style.margin = '0 0 0.75rem';
          el.textContent = p.trim();
          content.appendChild(el);
        });
      }
      const replay = document.getElementById('gaps-replay');
      if (replay) {
        replay.style.display = '';
        replay.onclick = () => speak(analysis);
      }
      // Auto-speak
      speak(analysis);
    } catch (e) {
      const content = document.getElementById('gaps-content');
      if (content) content.innerHTML = '<p style="color:#991b1b">Could not analyze: ' + escapeHtml(e.message) + '</p>';
      toast(e.message, 'error');
    }
  }

  async function emailMyDay() {
    const { api, toast } = window.DB;
    const btn = document.getElementById('email-day-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
    try {
      const data = await api('/api/brief/email', { method: 'POST', body: JSON.stringify({}) });
      toast('Today plan emailed' + (data.to ? ' to ' + data.to : ''), 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  }

  let currentUtterance = null;

  async function runBriefing() {
    const { openModal, closeModal, api, toast } = window.DB;

    openModal('Morning Briefing', `
      <div id="brief-content" style="min-height:120px;font-size:1.05rem;line-height:1.6;color:var(--text)">
        <div style="display:flex;align-items:center;gap:0.75rem;color:var(--muted)">
          <div class="pulse" style="width:10px;height:10px;border-radius:50%;background:var(--accent);animation:pulse 1.2s ease-in-out infinite"></div>
          <span>Reading your day…</span>
        </div>
      </div>
      <style>
        @keyframes pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.4);opacity:0.4} }
      </style>
    `, `
      <button class="btn-secondary" id="stop-speaking" style="display:none">Stop</button>
      <button class="btn-secondary" onclick="DB.closeModal();window.DB_BRIEF && window.DB_BRIEF.stop()">Close</button>
      <button class="btn-primary" id="replay-btn" style="display:none">Replay</button>
    `);

    try {
      const data = await api('/api/brief/summary');
      const summary = data.summary || 'Nothing urgent to report.';
      const content = document.getElementById('brief-content');
      if (content) {
        content.innerHTML = '';
        // Render as paragraphs
        summary.split(/\n{2,}/).forEach(p => {
          const el = document.createElement('p');
          el.style.margin = '0 0 0.75rem';
          el.textContent = p.trim();
          content.appendChild(el);
        });
      }

      // Speak it
      speak(summary);

      // Wire replay
      const replayBtn = document.getElementById('replay-btn');
      if (replayBtn) {
        replayBtn.style.display = '';
        replayBtn.onclick = () => speak(summary);
      }
      const stopBtn = document.getElementById('stop-speaking');
      if (stopBtn) {
        stopBtn.onclick = stop;
      }
    } catch (e) {
      const content = document.getElementById('brief-content');
      if (content) {
        content.innerHTML = '<p style="color:#991b1b">Briefing failed: ' + escapeHtml(e.message) + '</p>';
      }
      toast(e.message, 'error');
    }
  }

  function speak(text) {
    stop();
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-CA';
    u.rate = 1.05;
    u.pitch = 1.0;
    // Prefer a natural-sounding voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v =>
      /Samantha|Daniel|Karen|Alex|Moira|Google UK English Male/i.test(v.name)
    );
    if (preferred) u.voice = preferred;
    u.onstart = () => {
      const s = document.getElementById('stop-speaking');
      if (s) s.style.display = '';
    };
    u.onend = () => {
      const s = document.getElementById('stop-speaking');
      if (s) s.style.display = 'none';
      currentUtterance = null;
    };
    currentUtterance = u;
    window.speechSynthesis.speak(u);
  }

  function stop() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    const s = document.getElementById('stop-speaking');
    if (s) s.style.display = 'none';
    currentUtterance = null;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  window.DB_BRIEF = { run: runBriefing, speak, stop };
})();
