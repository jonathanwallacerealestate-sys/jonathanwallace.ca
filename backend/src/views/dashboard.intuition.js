/**
 * Intuition manager — simple modal to view/edit Jonathan's vocabulary
 * and long-term memory. Surfaced from the Settings drawer.
 */
(function(){
  'use strict';
  const { api, toast, openModal, closeModal } = window.DB;
  const { escapeHtml } = window.DB_UTIL;

  // Expose on window so Settings drawer can call
  window.DB_INTUITION = { openManager };

  async function openManager(initialTab = 'vocab') {
    let vocabRows = [], memRows = [];
    try {
      const [v, m] = await Promise.all([api('/api/intuition/vocabulary'), api('/api/intuition/memory')]);
      vocabRows = v.vocabulary; memRows = m.memory;
    } catch (e) { toast(e.message, 'error'); return; }

    openModal('Agent Intuition', tabs(initialTab, vocabRows, memRows), `
      <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
    `);
    wireTabSwitchers();
    wireRowButtons();
  }

  function tabs(active, vocab, memory) {
    return `
      <div style="display:flex;gap:0.25rem;margin-bottom:1rem;border-bottom:1px solid var(--border)">
        <button class="tab-btn ${active === 'vocab' ? 'active' : ''}" data-tab="vocab"
          style="background:none;border:none;padding:0.5rem 0.9rem;cursor:pointer;font-weight:600;color:${active === 'vocab' ? 'var(--text)' : 'var(--muted)'};border-bottom:2px solid ${active === 'vocab' ? 'var(--accent)' : 'transparent'}">
          Vocabulary (${vocab.length})
        </button>
        <button class="tab-btn ${active === 'memory' ? 'active' : ''}" data-tab="memory"
          style="background:none;border:none;padding:0.5rem 0.9rem;cursor:pointer;font-weight:600;color:${active === 'memory' ? 'var(--text)' : 'var(--muted)'};border-bottom:2px solid ${active === 'memory' ? 'var(--accent)' : 'transparent'}">
          Memory (${memory.length})
        </button>
      </div>
      <div id="tab-vocab" style="display:${active === 'vocab' ? 'block' : 'none'}">
        ${addForm('vocab')}
        ${vocab.length ? vocab.map(vocabRow).join('') : '<div class="empty">No vocabulary yet.</div>'}
      </div>
      <div id="tab-memory" style="display:${active === 'memory' ? 'block' : 'none'}">
        ${addForm('memory')}
        ${memory.length ? memory.map(memoryRow).join('') : '<div class="empty">No memory entries yet.</div>'}
      </div>
    `;
  }

  function addForm(kind) {
    if (kind === 'vocab') {
      return `
        <div style="background:#fafafa;border:1px solid var(--border);border-radius:8px;padding:0.75rem;margin-bottom:0.75rem;display:grid;grid-template-columns:1fr 2fr 100px auto;gap:0.5rem;align-items:center">
          <input id="v-term" placeholder="Term (e.g. LOO)" style="padding:0.5rem;border:1px solid var(--border);border-radius:6px;font-size:0.85rem">
          <input id="v-exp" placeholder="Expansion / definition" style="padding:0.5rem;border:1px solid var(--border);border-radius:6px;font-size:0.85rem">
          <input id="v-cat" placeholder="Category" style="padding:0.5rem;border:1px solid var(--border);border-radius:6px;font-size:0.85rem">
          <button class="btn-primary" onclick="window.DB_INTUITION_ACTIONS.addVocab()" style="padding:0.5rem 0.8rem;font-size:0.8rem">Add</button>
        </div>`;
    }
    return `
      <div style="background:#fafafa;border:1px solid var(--border);border-radius:8px;padding:0.75rem;margin-bottom:0.75rem;display:grid;grid-template-columns:1fr 2fr 110px auto;gap:0.5rem;align-items:center">
        <input id="m-key" placeholder="Key (short name)" style="padding:0.5rem;border:1px solid var(--border);border-radius:6px;font-size:0.85rem">
        <input id="m-val" placeholder="What you want Claude to remember" style="padding:0.5rem;border:1px solid var(--border);border-radius:6px;font-size:0.85rem">
        <select id="m-cat" style="padding:0.5rem;border:1px solid var(--border);border-radius:6px;font-size:0.85rem">
          <option value="preference">preference</option>
          <option value="voice">voice</option>
          <option value="operations">operations</option>
          <option value="client">client</option>
          <option value="brand">brand</option>
        </select>
        <button class="btn-primary" onclick="window.DB_INTUITION_ACTIONS.addMemory()" style="padding:0.5rem 0.8rem;font-size:0.8rem">Add</button>
      </div>`;
  }

  function vocabRow(v) {
    return `
      <div class="row" style="margin-bottom:0.4rem" data-vocab="${v.id}">
        <div class="row-main">
          <div class="row-title" style="font-size:0.9rem"><strong>${escapeHtml(v.term)}</strong>
            <span style="font-weight:400;color:var(--muted);margin-left:0.4rem">— ${escapeHtml(v.expansion)}</span>
          </div>
          <div class="row-meta">
            <span>${escapeHtml(v.category)}</span>
            <span>weight ${v.weight}</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="danger" data-intuition="del-vocab" data-id="${v.id}">&times;</button>
        </div>
      </div>`;
  }
  function memoryRow(m) {
    return `
      <div class="row" style="margin-bottom:0.4rem" data-memory="${m.id}">
        <div class="row-main">
          <div class="row-title" style="font-size:0.9rem"><strong>${escapeHtml(m.key)}</strong></div>
          <div class="row-sub">${escapeHtml(m.value)}</div>
          <div class="row-meta">
            <span>${escapeHtml(m.category)}</span>
            <span>importance ${m.importance}</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="danger" data-intuition="del-memory" data-id="${m.id}">&times;</button>
        </div>
      </div>`;
  }

  function wireTabSwitchers() {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.addEventListener('click', () => {
        const target = b.dataset.tab;
        document.getElementById('tab-vocab').style.display = target === 'vocab' ? 'block' : 'none';
        document.getElementById('tab-memory').style.display = target === 'memory' ? 'block' : 'none';
        document.querySelectorAll('.tab-btn').forEach(x => {
          x.style.color = 'var(--muted)';
          x.style.borderBottomColor = 'transparent';
        });
        b.style.color = 'var(--text)';
        b.style.borderBottomColor = 'var(--accent)';
      });
    });
  }

  function wireRowButtons() {
    document.querySelectorAll('[data-intuition]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete?')) return;
        const id = btn.dataset.id;
        const kind = btn.dataset.intuition === 'del-vocab' ? 'vocabulary' : 'memory';
        try {
          await api('/api/intuition/' + kind + '/' + id, { method: 'DELETE' });
          toast('Deleted');
          openManager(kind === 'vocabulary' ? 'vocab' : 'memory');
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  }

  // Inline add handlers exposed to the modal's onclick
  window.DB_INTUITION_ACTIONS = {
    async addVocab() {
      const term = document.getElementById('v-term').value.trim();
      const expansion = document.getElementById('v-exp').value.trim();
      const category = document.getElementById('v-cat').value.trim() || 'real_estate';
      if (!term || !expansion) return toast('Term and expansion required', 'error');
      try {
        await api('/api/intuition/vocabulary', { method: 'POST', body: JSON.stringify({ term, expansion, category }) });
        toast('Added', 'success'); openManager('vocab');
      } catch (e) { toast(e.message, 'error'); }
    },
    async addMemory() {
      const key = document.getElementById('m-key').value.trim();
      const value = document.getElementById('m-val').value.trim();
      const category = document.getElementById('m-cat').value;
      if (!key || !value) return toast('Key and value required', 'error');
      try {
        await api('/api/intuition/memory', { method: 'POST', body: JSON.stringify({ key, value, category }) });
        toast('Added', 'success'); openManager('memory');
      } catch (e) { toast(e.message, 'error'); }
    }
  };
})();
