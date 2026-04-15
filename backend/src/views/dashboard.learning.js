/**
 * Learning Capture client.
 *
 * - Renders recent learning items grouped by source, with extracted
 *   action items, vocabulary, and memory suggestions.
 * - Quick voice capture (F7 hotkey + button): push-to-talk, transcript
 *   gets auto-attached to the most recent listening session if one
 *   exists in the last 4 hours, otherwise stored as a standalone
 *   voice memo.
 * - Manual entry modal: pick kind, paste notes, optionally enter
 *   title / source / URL — Claude analyzes immediately.
 * - "Apply" buttons promote action items to personal_tasks and
 *   suggested vocabulary/memory into the intuition layer.
 */
(function(){
  'use strict';
  const { api, toast, openModal, closeModal } = window.DB;
  const { escapeHtml, fmtDate } = window.DB_UTIL;

  document.addEventListener('DOMContentLoaded', () => {
    hookIntoLoadCycle();
    document.body.addEventListener('click', handleClick);
    setupHotkey();
  });

  function hookIntoLoadCycle() {
    const orig = window.load;
    if (typeof orig !== 'function') { setTimeout(render, 1000); return; }
    window.load = async function() {
      await orig.apply(this, arguments);
      await render();
    };
  }

  function setupHotkey() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F7' && !e.repeat) {
        e.preventDefault();
        startVoiceCapture();
      }
    });
  }

  async function render() {
    const host = document.getElementById('learning-list');
    const stats = document.getElementById('learning-stats');
    if (!host) return;
    try {
      const { items } = await api('/api/learning?range=month&limit=20');
      const week = items.filter(i => new Date(i.consumed_at) >= new Date(Date.now() - 7 * 86400000));
      const openActions = items.reduce((a, i) => a + ((i.action_items || []).length - ((i.applied_action_item_ids || []).length || 0)), 0);
      if (stats) {
        stats.innerHTML = `
          <span class="chip-stat">${week.length} this week</span>
          <span class="chip-stat ${openActions > 0 ? 'warn' : ''}">${openActions} action items pending</span>
        `;
      }
      if (!items.length) {
        host.innerHTML = '<div class="empty">Nothing captured yet. Tap <strong>Quick Note</strong> while listening to a podcast or audiobook, or paste notes via Manual Entry.</div>';
        return;
      }
      host.innerHTML = items.slice(0, 12).map(itemRow).join('');
    } catch (e) {
      host.innerHTML = '<div class="empty">Could not load: ' + escapeHtml(e.message) + '</div>';
    }
  }

  const KIND_LABEL = {
    spotify_episode: 'Podcast',
    audible_chapter: 'Audiobook',
    youtube_video: 'YouTube',
    article: 'Article',
    voice_memo: 'Voice memo',
    conversation: 'Conversation',
    course_lesson: 'Course',
    manual: 'Manual'
  };
  const KIND_DOT = {
    spotify_episode: '#1db954',
    audible_chapter: '#f59e0b',
    youtube_video: '#ef4444',
    article: '#6366f1',
    voice_memo: '#c9a96e',
    conversation: '#ec4899',
    course_lesson: '#06b6d4',
    manual: '#6b7280'
  };

  function itemRow(item) {
    const k = KIND_LABEL[item.kind] || item.kind;
    const dot = KIND_DOT[item.kind] || '#6b7280';
    const ai = (item.action_items || []).length;
    const applied = (item.applied_action_item_ids || []).length;
    const pendingActions = Math.max(0, ai - applied);
    return `
      <div class="row" data-learning-row="${item.id}">
        <div class="row-main">
          <div class="row-title" style="display:flex;align-items:center;gap:0.5rem">
            <span style="width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0"></span>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.title || '(untitled)')}</span>
          </div>
          <div class="row-meta">
            <span>${escapeHtml(k)}</span>
            ${item.source_name ? `<span>${escapeHtml(item.source_name)}</span>` : ''}
            ${item.author ? `<span>${escapeHtml(item.author)}</span>` : ''}
            <span>${fmtDate(item.consumed_at)}</span>
            ${ai ? `<span class="badge ${pendingActions ? 'warn' : 'completed'}">${pendingActions ? pendingActions + ' open' : ai + ' done'}</span>` : ''}
            ${item.analyzed_at ? '' : '<span class="badge pending">not analyzed</span>'}
          </div>
          ${item.summary ? `<div class="row-sub">${escapeHtml(item.summary)}</div>` : ''}
        </div>
        <div class="row-actions">
          <button data-learning="view" data-id="${item.id}">Open</button>
          ${item.analyzed_at ? '' : `<button class="primary" data-learning="analyze" data-id="${item.id}">Analyze</button>`}
          <button class="danger" data-learning="del" data-id="${item.id}">&times;</button>
        </div>
      </div>`;
  }

  async function handleClick(e) {
    const btn = e.target.closest('[data-learning]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.dataset.id;
    try {
      switch (btn.dataset.learning) {
        case 'capture-voice':   return startVoiceCapture();
        case 'add-manual':      return openManualEntry();
        case 'spotify-sync':    return syncSpotify();
        case 'spotify-connect': return connectSpotify();
        case 'view':            return openItemDetail(id);
        case 'analyze':         return analyze(id);
        case 'del':
          if (!confirm('Delete this learning item?')) return;
          await api('/api/learning/' + id, { method: 'DELETE' });
          toast('Deleted');
          if (typeof window.load === 'function') window.load();
          return;
      }
    } catch (err) { toast(err.message, 'error'); }
  }

  // ---------- Manual entry ----------
  function openManualEntry() {
    openModal('Capture from any source', `
      <div class="form-grid">
        <div class="form-field"><label>Source kind</label>
          <select id="le-kind">
            <option value="audible_chapter">Audible / Audiobook chapter</option>
            <option value="spotify_episode">Podcast episode</option>
            <option value="youtube_video">YouTube video</option>
            <option value="article">Article / blog</option>
            <option value="course_lesson">Course lesson</option>
            <option value="conversation">Conversation / mentor call</option>
            <option value="manual">Other</option>
          </select>
        </div>
        <div class="form-field"><label>Title</label>
          <input id="le-title" placeholder="Episode / chapter / article name"></div>
        <div class="form-field"><label>Author / Show / Author</label>
          <input id="le-author" placeholder="optional"></div>
        <div class="form-field"><label>URL (optional)</label>
          <input id="le-url" placeholder="https://..."></div>
        <div class="form-field" style="grid-column:1/-1">
          <label>Notes / transcript / chapter highlights</label>
          <textarea id="le-notes" rows="8" placeholder="Paste raw notes, transcript snippets, or your reactions. Claude will pull out concepts + action items + suggested vocabulary + memory."></textarea>
        </div>
      </div>
      <p style="font-size:0.78rem;color:var(--muted);margin-top:0.5rem">Tip: For Audible — open the chapter in the Audible app, hit the bookmark / clip button to grab snippets, then paste here.</p>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="le-save">Save & Analyze</button>
    `);
    document.getElementById('le-save').onclick = async () => {
      const body = {
        kind: document.getElementById('le-kind').value,
        title: document.getElementById('le-title').value.trim() || null,
        author: document.getElementById('le-author').value.trim() || null,
        url: document.getElementById('le-url').value.trim() || null,
        raw_notes: document.getElementById('le-notes').value.trim() || null
      };
      if (!body.raw_notes || body.raw_notes.length < 10) {
        return toast('Add some notes first', 'error');
      }
      try {
        const r = await api('/api/learning', { method: 'POST', body: JSON.stringify(body) });
        toast('Saved — analyzing…', 'success');
        closeModal();
        if (r.item?.id) await analyze(r.item.id, { silent: true });
        if (typeof window.load === 'function') window.load();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  async function analyze(id, opts = {}) {
    if (!opts.silent) toast('Analyzing…');
    try {
      await api('/api/learning/' + id + '/analyze', { method: 'POST', body: '{}' });
      if (!opts.silent) toast('Analyzed', 'success');
      if (typeof window.load === 'function') window.load();
      // Auto-open the detail view so Jonathan can decide what to apply
      if (!opts.silent) openItemDetail(id);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------- Detail / Apply ----------
  async function openItemDetail(id) {
    let item;
    try {
      const r = await api('/api/learning/' + id);
      item = r.item;
    } catch (e) { return toast(e.message, 'error'); }

    const concepts = (item.key_concepts || []);
    const actions = (item.action_items || []);
    const vocab = (item.suggested_vocabulary || []);
    const mem = (item.suggested_memory || []);
    const appliedIds = item.applied_action_item_ids || [];

    const conceptHtml = concepts.length
      ? '<ul style="margin:0.4rem 0 0.5rem 1.2rem;font-size:0.9rem;line-height:1.55">' + concepts.map(c => '<li>' + escapeHtml(c) + '</li>').join('') + '</ul>'
      : '';

    const actionHtml = actions.length
      ? actions.map((a, i) => `
          <div style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.5rem;border:1px solid var(--border);border-radius:6px;margin-bottom:0.4rem">
            <input type="checkbox" data-apply-action="${i}" ${appliedIds.length ? '' : 'checked'} style="margin-top:0.2rem">
            <div style="flex:1;font-size:0.88rem">
              <div><strong>${escapeHtml(a.title || '')}</strong></div>
              <div style="color:var(--muted);font-size:0.78rem;margin-top:0.2rem">
                ${a.category ? escapeHtml(a.category) + ' · ' : ''}due in ${a.due_in_days != null ? a.due_in_days : 7}d
              </div>
              ${a.notes ? '<div style="color:var(--muted);font-size:0.8rem;margin-top:0.2rem">' + escapeHtml(a.notes) + '</div>' : ''}
            </div>
          </div>`).join('')
      : '<p style="color:var(--muted);font-size:0.85rem">No action items extracted.</p>';

    const vocabHtml = vocab.length
      ? vocab.map((v, i) => `
          <div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem;font-size:0.85rem">
            <input type="checkbox" data-apply-vocab="${i}" checked>
            <span><strong>${escapeHtml(v.term)}</strong> — ${escapeHtml(v.expansion)}</span>
          </div>`).join('')
      : '';
    const memHtml = mem.length
      ? mem.map((m, i) => `
          <div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem;font-size:0.85rem">
            <input type="checkbox" data-apply-mem="${i}" checked>
            <span><strong>${escapeHtml(m.key)}</strong> — ${escapeHtml(m.value)}</span>
          </div>`).join('')
      : '';

    openModal(item.title || 'Learning detail', `
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:0.5rem">
        ${escapeHtml(KIND_LABEL[item.kind] || item.kind)}${item.author ? ' · ' + escapeHtml(item.author) : ''}${item.consumed_at ? ' · ' + new Date(item.consumed_at).toLocaleString('en-CA', { timeZone: 'America/Toronto' }) : ''}
      </div>
      ${item.summary ? `<p style="font-size:0.95rem;line-height:1.55;margin-bottom:0.75rem">${escapeHtml(item.summary)}</p>` : ''}

      ${concepts.length ? '<h4 style="margin:0.75rem 0 0.3rem;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">Key concepts</h4>' + conceptHtml : ''}

      <h4 style="margin:0.75rem 0 0.4rem;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">Action items</h4>
      ${actionHtml}

      ${vocabHtml ? '<h4 style="margin:0.75rem 0 0.3rem;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">Vocabulary to teach Claude</h4>' + vocabHtml : ''}
      ${memHtml ? '<h4 style="margin:0.75rem 0 0.3rem;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">Memory to remember</h4>' + memHtml : ''}

      <details style="margin-top:1rem">
        <summary style="cursor:pointer;font-size:0.8rem;color:var(--muted)">Raw notes</summary>
        <pre style="background:#fafafa;padding:0.75rem;border-radius:6px;font-size:0.78rem;white-space:pre-wrap;max-height:240px;overflow-y:auto;margin-top:0.5rem">${escapeHtml(item.raw_notes || '')}</pre>
      </details>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
      <button class="btn-secondary" data-learning="analyze" data-id="${item.id}">Re-analyze</button>
      <button class="btn-primary" id="le-apply">Apply Selected</button>
    `);

    document.getElementById('le-apply').onclick = async () => {
      const action_item_indexes = Array.from(document.querySelectorAll('[data-apply-action]:checked')).map(el => parseInt(el.dataset.applyAction));
      const vocabulary_indexes = Array.from(document.querySelectorAll('[data-apply-vocab]:checked')).map(el => parseInt(el.dataset.applyVocab));
      const memory_indexes = Array.from(document.querySelectorAll('[data-apply-mem]:checked')).map(el => parseInt(el.dataset.applyMem));
      try {
        const data = await api('/api/learning/' + item.id + '/apply', {
          method: 'POST',
          body: JSON.stringify({ action_item_indexes, vocabulary_indexes, memory_indexes })
        });
        const t = data.created.tasks.length;
        const v = data.created.vocab.length;
        const m = data.created.memory.length;
        toast(`Created ${t} task${t === 1 ? '' : 's'}, ${v} vocab, ${m} memory`, 'success');
        closeModal();
        if (typeof window.load === 'function') window.load();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  // ---------- Spotify ----------
  async function syncSpotify() {
    toast('Pulling Spotify history…');
    try {
      const data = await api('/api/spotify/sync', { method: 'POST', body: '{}' });
      toast(`Pulled ${data.scanned} items, ${data.new_episodes} new episodes`, 'success');
      if (typeof window.load === 'function') window.load();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function connectSpotify() {
    try {
      const status = await api('/api/spotify/status');
      if (!status.configured) {
        return toast('Set spotify_client_id and spotify_client_secret in Settings first. Make sure your Spotify app redirect URI is: ' + status.redirect_uri, 'error');
      }
      const data = await api('/api/spotify/auth-url');
      window.open(data.url, '_blank', 'noopener');
      toast('Spotify auth opened in new tab — return here when done');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------- Quick voice capture ----------
  function startVoiceCapture() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) return toast('Voice capture needs Chrome or Safari', 'error');

    let transcript = '';
    let attachToRecent = true;
    openModal('Quick voice capture', `
      <p style="font-size:0.85rem;color:var(--muted);margin-bottom:0.75rem">
        Speak your insight — Claude will tag it to your most recent listening session if one exists in the last 4 hours.
      </p>
      <div style="background:#fafafa;border:1px solid var(--border);border-radius:8px;padding:0.75rem;min-height:120px;font-size:0.95rem;line-height:1.5" id="vc-transcript">
        <span style="color:var(--muted)">Listening…</span>
      </div>
      <label style="display:flex;gap:0.5rem;align-items:center;margin-top:0.75rem;font-size:0.85rem">
        <input type="checkbox" id="vc-attach" checked> Attach to most recent listening session if available
      </label>
    `, `
      <button class="btn-secondary" id="vc-cancel">Cancel</button>
      <button class="btn-primary" id="vc-save" disabled>Save</button>
    `);

    const r = new Rec();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-CA';
    let final = '';

    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript + ' ';
        else interim += res[0].transcript + ' ';
      }
      transcript = (final + interim).trim();
      const el = document.getElementById('vc-transcript');
      if (el) el.textContent = transcript || 'Listening…';
      const save = document.getElementById('vc-save');
      if (save) save.disabled = transcript.length < 5;
    };
    r.onerror = () => { /* ignore, will restart on end */ };
    r.onend = () => {
      // If user is still capturing, restart automatically
      if (document.getElementById('vc-transcript')) {
        try { r.start(); } catch (_) {}
      }
    };
    try { r.start(); } catch (e) { toast('Could not start microphone: ' + e.message, 'error'); return; }

    document.getElementById('vc-cancel').onclick = () => {
      try { r.stop(); } catch (_) {}
      closeModal();
    };
    document.getElementById('vc-save').onclick = async () => {
      try { r.stop(); } catch (_) {}
      const attach = document.getElementById('vc-attach').checked;
      try {
        const data = await api('/api/learning/voice-capture', {
          method: 'POST',
          body: JSON.stringify({ transcript, attach_to_recent: attach })
        });
        toast(data.attached ? 'Attached to ' + (data.item.title || 'recent session') : 'Saved as voice memo', 'success');
        closeModal();
        // Auto-analyze the resulting item
        if (data.item?.id) {
          analyze(data.item.id, { silent: true });
        }
        if (typeof window.load === 'function') window.load();
      } catch (e) { toast(e.message, 'error'); }
    };
  }
})();
