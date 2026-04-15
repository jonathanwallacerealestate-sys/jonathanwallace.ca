/**
 * Follow Up Boss client-side helpers.
 *
 * Currently exposes:
 *   - window.DB_FUB.openAddTask()   — add-task modal with live person search
 *
 * More features can live here later (contact-detail modal that pulls the
 * full FUB person + event history, deal view, etc.). Kept separate so the
 * CRM card rendering stays focused on the dashboard's own crm_followups
 * table while FUB-specific actions branch off cleanly.
 */
(function(){
  'use strict';
  const { api, toast, openModal, closeModal } = window.DB;
  const { escapeHtml } = window.DB_UTIL;

  window.DB_FUB = { openAddTask };

  let selectedPersonId = null;
  let selectedPersonLabel = '';
  let searchDebounce = null;

  function openAddTask(prefill = {}) {
    selectedPersonId = prefill.person_id || null;
    selectedPersonLabel = prefill.person_label || '';

    openModal('New FUB follow-up task', `
      <div class="form-field">
        <label>Contact</label>
        <input id="fubt-search" placeholder="Type 2+ characters of name / email / phone" value="${escapeAttr(selectedPersonLabel)}" autocomplete="off">
        <div id="fubt-results" style="margin-top:0.4rem;max-height:180px;overflow-y:auto;border:1px solid transparent;border-radius:6px"></div>
      </div>
      <div class="form-grid">
        <div class="form-field" style="grid-column:1/-1"><label>Task name</label>
          <input id="fubt-name" placeholder="e.g. Call about Midland lakefront"></div>
        <div class="form-field"><label>Type</label>
          <select id="fubt-type">
            <option>Call</option>
            <option>Email</option>
            <option>Text</option>
            <option>Meeting</option>
            <option>Showing</option>
            <option>Other</option>
          </select></div>
        <div class="form-field"><label>Due date</label>
          <input id="fubt-due" type="date" value="${todayIso()}"></div>
        <div class="form-field" style="grid-column:1/-1"><label>Description (optional)</label>
          <textarea id="fubt-desc" rows="3"></textarea></div>
      </div>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="fubt-save">Create in FUB</button>
    `);

    // Live search
    const searchInput = document.getElementById('fubt-search');
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      if (q.length < 2) { document.getElementById('fubt-results').innerHTML = ''; return; }
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(async () => {
        try {
          const data = await api('/api/fub/people?limit=8&search=' + encodeURIComponent(q));
          renderResults(data.people || []);
        } catch (e) { toast(e.message, 'error'); }
      }, 280);
    });

    document.getElementById('fubt-save').onclick = async () => {
      if (!selectedPersonId) return toast('Pick a contact from the search results first', 'error');
      const body = {
        personId: selectedPersonId,
        name: v('fubt-name'),
        type: document.getElementById('fubt-type').value,
        dueDate: document.getElementById('fubt-due').value
          ? new Date(document.getElementById('fubt-due').value + 'T09:00:00').toISOString()
          : null,
        description: v('fubt-desc')
      };
      if (!body.name) return toast('Task name required', 'error');
      try {
        await api('/api/fub/tasks', { method: 'POST', body: JSON.stringify(body) });
        toast('Task created in FUB', 'success');
        closeModal();
        // Trigger a quick sync so it appears in the CRM card
        try { await api('/api/fub/sync', { method: 'POST', body: '{}' }); } catch (_) {}
        if (typeof window.load === 'function') window.load();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  function renderResults(people) {
    const host = document.getElementById('fubt-results');
    if (!host) return;
    if (!people.length) {
      host.innerHTML = '<div style="padding:0.5rem;color:var(--muted);font-size:0.8rem">No matches.</div>';
      return;
    }
    host.style.border = '1px solid var(--border)';
    host.innerHTML = people.map(p => {
      const email = p.emails?.[0]?.value || '';
      const phone = p.phones?.[0]?.value || '';
      const stage = p.stage || '';
      return `
        <div class="fubt-row" data-id="${p.id}" data-label="${escapeAttr(p.name || email || phone || ('#' + p.id))}"
             style="padding:0.5rem 0.6rem;cursor:pointer;border-bottom:1px solid var(--border);font-size:0.85rem">
          <div style="font-weight:600">${escapeHtml(p.name || '(no name)')}</div>
          <div style="color:var(--muted);font-size:0.75rem">
            ${email ? escapeHtml(email) : ''}${email && phone ? ' · ' : ''}${phone ? escapeHtml(phone) : ''}${stage ? ' · ' + escapeHtml(stage) : ''}
          </div>
        </div>`;
    }).join('');
    host.querySelectorAll('.fubt-row').forEach(row => {
      row.addEventListener('click', () => {
        selectedPersonId = Number(row.dataset.id);
        selectedPersonLabel = row.dataset.label;
        document.getElementById('fubt-search').value = selectedPersonLabel;
        host.innerHTML = '<div style="padding:0.4rem 0.6rem;font-size:0.8rem;color:var(--success)">Selected: ' + escapeHtml(selectedPersonLabel) + '</div>';
      });
    });
  }

  function v(id) { const el = document.getElementById(id); return el && el.value.trim() ? el.value.trim() : null; }
  function todayIso() { return new Date().toISOString().slice(0, 10); }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
})();
