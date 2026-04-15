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

  window.DB_FUB = { openAddTask, openPersonDetail, loadPeople, openAddLead };

  // Boot the People browser card once the DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    const host = document.getElementById('fub-people-list');
    if (!host) return;
    loadStages();
    loadSmartLists();
    loadPeople();

    const refreshBtn = document.getElementById('fub-people-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', loadPeople);
    const addBtn = document.getElementById('fub-people-add');
    if (addBtn) addBtn.addEventListener('click', () => openAddLead());

    const searchInput = document.getElementById('fub-people-search');
    let peopleSearchDebounce = null;
    if (searchInput) searchInput.addEventListener('input', () => {
      clearTimeout(peopleSearchDebounce);
      peopleSearchDebounce = setTimeout(loadPeople, 400);
    });
    const stageSel = document.getElementById('fub-people-stage');
    if (stageSel) stageSel.addEventListener('change', loadPeople);
    const smartSel = document.getElementById('fub-people-smartlist');
    const bulkBtn = document.getElementById('fub-people-bulk');
    if (smartSel) smartSel.addEventListener('change', () => {
      loadPeople();
      if (bulkBtn) bulkBtn.style.display = smartSel.value ? '' : 'none';
    });
    if (bulkBtn) bulkBtn.addEventListener('click', openBulkActionModal);
  });

  async function loadStages() {
    const sel = document.getElementById('fub-people-stage');
    if (!sel) return;
    try {
      const data = await api('/api/fub/stages');
      const stages = data.stages || [];
      sel.innerHTML = '<option value="">All stages</option>' +
        stages.map(s => `<option value="${escapeAttr(s.name)}">${escapeHtml(s.name)}</option>`).join('');
    } catch (e) {
      // Silently leave as "All stages" only
    }
  }

  async function loadSmartLists() {
    const sel = document.getElementById('fub-people-smartlist');
    if (!sel) return;
    try {
      const data = await api('/api/fub/smart-lists');
      const lists = data.smartlists || data.smartLists || data.lists || [];
      sel.innerHTML = '<option value="">No smart list</option>' +
        lists.map(l => `<option value="${l.id}">${escapeHtml(l.name || ('List ' + l.id))}</option>`).join('');
    } catch (e) {
      // Leave as default
    }
  }

  async function loadPeople() {
    const host = document.getElementById('fub-people-list');
    const stats = document.getElementById('fub-people-stats');
    if (!host) return;
    const search = (document.getElementById('fub-people-search')?.value || '').trim();
    const stage = document.getElementById('fub-people-stage')?.value || '';
    const smartListId = document.getElementById('fub-people-smartlist')?.value || '';
    host.innerHTML = '<div class="empty">Loading from FUB…</div>';
    try {
      const qs = new URLSearchParams({ limit: '30' });
      if (search) qs.set('search', search);
      if (stage) qs.set('stage', stage);
      if (smartListId) qs.set('smartListId', smartListId);
      const data = await api('/api/fub/people?' + qs.toString());
      const people = data.people || [];
      const total = (data._metadata && data._metadata.total) || people.length;
      if (stats) stats.innerHTML = `<span class="chip-stat">${people.length} shown${total > people.length ? ` of ${total}` : ''}</span>`;
      if (!people.length) {
        host.innerHTML = '<div class="empty">No contacts found.</div>';
        return;
      }
      host.innerHTML = people.map(p => {
        const email = p.emails?.[0]?.value || '';
        const phone = p.phones?.[0]?.value || '';
        const lastActivity = p.lastActivity ? new Date(p.lastActivity).toLocaleDateString('en-CA') : '';
        return `
          <div class="row" data-fub-person-row="${p.id}">
            <div class="row-main" style="cursor:pointer" data-action="view-fub-person" data-id="${p.id}">
              <div class="row-title">${escapeHtml(p.name || '(no name)')}</div>
              <div class="row-meta">
                ${p.stage ? `<span class="badge normal">${escapeHtml(p.stage)}</span>` : ''}
                ${email ? `<span>${escapeHtml(email)}</span>` : ''}
                ${phone ? `<span>${escapeHtml(phone)}</span>` : ''}
                ${p.source ? `<span>${escapeHtml(p.source)}</span>` : ''}
                ${lastActivity ? `<span>Active ${escapeHtml(lastActivity)}</span>` : ''}
              </div>
            </div>
            <div class="row-actions">
              <button data-action="view-fub-person" data-id="${p.id}" title="Open detail">&#8599;</button>
            </div>
          </div>`;
      }).join('');
    } catch (e) {
      if (e.message && e.message.includes('not configured')) {
        host.innerHTML = '<div class="empty">Follow Up Boss isn\'t configured yet. Open Settings (⚙) → Follow Up Boss → paste your API key.</div>';
        if (stats) stats.innerHTML = '';
      } else {
        host.innerHTML = '<div class="empty">Could not load: ' + escapeHtml(e.message) + '</div>';
      }
    }
  }

  function openAddLead() {
    openModal('Add new lead to FUB', `
      <div class="form-grid">
        <div class="form-field"><label>First name *</label>
          <input id="fubl-first" required></div>
        <div class="form-field"><label>Last name</label>
          <input id="fubl-last"></div>
        <div class="form-field"><label>Email</label>
          <input id="fubl-email" type="email"></div>
        <div class="form-field"><label>Phone</label>
          <input id="fubl-phone" type="tel"></div>
        <div class="form-field"><label>Source</label>
          <input id="fubl-source" placeholder="e.g. Open House, Website, Referral"></div>
        <div class="form-field"><label>Stage</label>
          <input id="fubl-stage" placeholder="e.g. Lead, New Lead"></div>
        <div class="form-field" style="grid-column:1/-1"><label>First-contact note (optional)</label>
          <textarea id="fubl-note" rows="3" placeholder="How you met, what they're looking for, etc."></textarea></div>
      </div>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="fubl-save">Create in FUB</button>
    `);
    document.getElementById('fubl-save').onclick = async () => {
      const first = v('fubl-first');
      if (!first) return toast('First name required', 'error');
      const body = {
        firstName: first,
        lastName: v('fubl-last') || null,
        source: v('fubl-source') || 'Dashboard Agent',
        stage: v('fubl-stage') || 'Lead'
      };
      const email = v('fubl-email');
      const phone = v('fubl-phone');
      if (email) body.emails = [{ value: email, type: 'primary' }];
      if (phone) body.phones = [{ value: phone, type: 'mobile' }];
      try {
        const r = await api('/api/fub/people', { method: 'POST', body: JSON.stringify(body) });
        const note = v('fubl-note');
        if (note && r.person && r.person.id) {
          try { await api('/api/fub/notes', { method: 'POST', body: JSON.stringify({ personId: r.person.id, body: note }) }); } catch (_) {}
        }
        toast('Lead created: ' + (r.person?.name || first), 'success');
        closeModal();
        loadPeople();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

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

  // ---------- Contact detail drill-in ----------

  async function openPersonDetail(personId) {
    if (!personId) return toast('No FUB person id', 'error');
    openModal('Loading contact…', '<div class="empty">Loading from FUB…</div>', `
      <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
    `);
    try {
      const data = await api('/api/fub/people/' + personId);
      renderPersonDetail(data);
    } catch (e) {
      openModal('Contact', '<p style="color:#991b1b">' + escapeHtml(e.message) + '</p>', `
        <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
      `);
    }
  }

  function renderPersonDetail(data) {
    const p = data.person || {};
    const events = data.events || [];
    const notes = data.notes || [];
    const tasks = data.tasks || [];
    const name = p.name || [p.firstName, p.lastName].filter(Boolean).join(' ') || '(no name)';
    const email = p.emails?.[0]?.value || '';
    const phone = p.phones?.[0]?.value || '';
    const stage = p.stage || '—';
    const source = p.source || '—';
    const assigned = p.assignedUserName || '—';

    const meta = `
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;font-size:0.82rem;color:var(--muted);margin-bottom:0.9rem">
        ${email ? `<span>✉ ${escapeHtml(email)}</span>` : ''}
        ${phone ? `<span>☎ ${escapeHtml(phone)}</span>` : ''}
        <span>Stage: <strong>${escapeHtml(stage)}</strong></span>
        <span>Source: ${escapeHtml(source)}</span>
        <span>Assigned: ${escapeHtml(assigned)}</span>
      </div>`;

    const taskBlock = tasks.length ? `
      <h4 style="margin:1rem 0 0.4rem;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">Open tasks</h4>
      ${tasks.slice(0, 8).map(t => `
        <div class="row" style="margin-bottom:0.3rem">
          <div class="row-main">
            <div class="row-title" style="font-size:0.9rem">${escapeHtml(t.name || '(task)')}</div>
            <div class="row-meta">
              ${t.type ? `<span class="badge normal">${escapeHtml(t.type)}</span>` : ''}
              ${t.dueDate ? `<span>Due ${new Date(t.dueDate).toLocaleDateString('en-CA')}</span>` : ''}
              ${t.status ? `<span>${escapeHtml(t.status)}</span>` : ''}
            </div>
          </div>
          <div class="row-actions">
            <button class="primary" data-fub-complete="${t.id}" title="Mark done">&#10003;</button>
          </div>
        </div>`).join('')}
    ` : '';

    const noteBlock = notes.length ? `
      <h4 style="margin:1rem 0 0.4rem;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">Recent notes</h4>
      ${notes.slice(0, 5).map(n => `
        <div style="padding:0.5rem 0.7rem;border-left:3px solid #8b5cf6;background:#fafafa;border-radius:4px;margin-bottom:0.4rem;font-size:0.85rem">
          <div style="color:var(--muted);font-size:0.72rem">${n.created ? new Date(n.created).toLocaleString('en-CA') : ''}${n.subject ? ' · ' + escapeHtml(n.subject) : ''}</div>
          <div style="margin-top:0.25rem;line-height:1.5">${escapeHtml((n.body || '').replace(/<[^>]*>/g, '').slice(0, 400))}</div>
        </div>`).join('')}
    ` : '';

    const eventBlock = events.length ? `
      <h4 style="margin:1rem 0 0.4rem;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">Recent activity</h4>
      <div style="font-size:0.78rem;color:var(--muted);line-height:1.7">
        ${events.slice(0, 12).map(e => {
          const when = e.created ? new Date(e.created).toLocaleString('en-CA', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : '';
          return `<div>• <span>${escapeHtml(when)}</span> — <span style="color:var(--text)">${escapeHtml(e.type || '')}</span>${e.description ? ': ' + escapeHtml(e.description.slice(0, 120)) : ''}</div>`;
        }).join('')}
      </div>` : '';

    const quickActions = `
      <div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--border)">
        <h4 style="margin:0 0 0.5rem;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">Quick add note</h4>
        <textarea id="fubd-note" rows="3" placeholder="What did we discuss / decide / need to do next?" style="width:100%;padding:0.6rem;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap">
          <button class="btn-primary" id="fubd-save-note" style="padding:0.5rem 0.9rem;font-size:0.85rem">Save Note to FUB</button>
          <button class="btn-secondary" id="fubd-add-task" style="padding:0.5rem 0.9rem;font-size:0.85rem">+ Task for this contact</button>
          <button class="btn-secondary" id="fubd-enrich" data-person-id="${p.id}" style="padding:0.5rem 0.9rem;font-size:0.85rem">🔍 Research this contact</button>
        </div>
        <div id="fubd-enrich-result" style="margin-top:0.75rem"></div>
      </div>`;

    openModal(name, meta + taskBlock + noteBlock + eventBlock + quickActions, `
      <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
    `);

    document.querySelectorAll('[data-fub-complete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.fubComplete;
        btn.disabled = true;
        try {
          await api('/api/fub/tasks/' + id + '/complete', { method: 'POST', body: '{}' });
          toast('Task completed in FUB', 'success');
          btn.closest('.row').style.opacity = '0.5';
        } catch (e) { toast(e.message, 'error'); }
      });
    });

    document.getElementById('fubd-save-note').onclick = async () => {
      const body = document.getElementById('fubd-note').value.trim();
      if (!body) return toast('Type a note first', 'error');
      try {
        await api('/api/fub/notes', { method: 'POST', body: JSON.stringify({ personId: p.id, body }) });
        toast('Note saved to FUB', 'success');
        document.getElementById('fubd-note').value = '';
      } catch (e) { toast(e.message, 'error'); }
    };

    document.getElementById('fubd-add-task').onclick = () => {
      openAddTask({ person_id: p.id, person_label: name });
    };

    // Research / enrich contact
    const enrichBtn = document.getElementById('fubd-enrich');
    if (enrichBtn) enrichBtn.onclick = async () => {
      const resultHost = document.getElementById('fubd-enrich-result');
      enrichBtn.disabled = true;
      enrichBtn.textContent = 'Claude is thinking…';
      resultHost.innerHTML = `<div style="padding:0.75rem;color:var(--muted);font-size:0.85rem">Building research note…</div>`;
      try {
        const r = await api('/api/fub/people/' + p.id + '/enrich', {
          method: 'POST', body: JSON.stringify({ push_note: false })
        });
        const rendered = r.rendered || '(no output)';
        resultHost.innerHTML = `
          <div style="padding:0.8rem 1rem;background:#fafafa;border-left:3px solid #c9a96e;border-radius:4px;font-size:0.88rem;line-height:1.55;white-space:pre-wrap">${escapeHtml(rendered)}</div>
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
            <button class="btn-primary" id="fubd-enrich-push" style="padding:0.4rem 0.9rem;font-size:0.8rem">Save as FUB note</button>
            <button class="btn-secondary" id="fubd-enrich-speak" style="padding:0.4rem 0.9rem;font-size:0.8rem">🔊 Speak it</button>
          </div>
        `;
        document.getElementById('fubd-enrich-push').onclick = async () => {
          try {
            await api('/api/fub/people/' + p.id + '/enrich', {
              method: 'POST', body: JSON.stringify({ push_note: true })
            });
            toast('Saved as FUB note', 'success');
          } catch (e) { toast(e.message, 'error'); }
        };
        document.getElementById('fubd-enrich-speak').onclick = () => {
          if (window.DB_VOICE && window.DB_VOICE.speak) window.DB_VOICE.speak(rendered);
        };
      } catch (e) {
        resultHost.innerHTML = `<div style="color:#991b1b;font-size:0.85rem">${escapeHtml(e.message)}</div>`;
      } finally {
        enrichBtn.disabled = false;
        enrichBtn.textContent = '🔍 Research this contact';
      }
    };
  }

  // ---------- Bulk action on a smart list ----------
  async function openBulkActionModal() {
    const smartSel = document.getElementById('fub-people-smartlist');
    const smartListId = smartSel?.value;
    const smartListName = smartSel?.options[smartSel.selectedIndex]?.text || '';
    if (!smartListId) return toast('Pick a smart list first', 'error');

    openModal(`Bulk action · ${smartListName}`, `
      <p style="font-size:0.85rem;color:var(--muted);margin-bottom:0.75rem">
        Claude will rewrite your template for each contact in the list, using their
        name, stage, source and recent activity. Always runs a dry-run preview
        first — nothing is pushed to FUB until you click <strong>Execute</strong>.
      </p>

      <div class="form-field">
        <label>Action</label>
        <select id="ba-action">
          <option value="note">Add a note to each contact</option>
          <option value="task">Create a task on each contact</option>
          <option value="email_draft">Create a Gmail draft to each contact</option>
        </select>
      </div>

      <div class="form-field"><label>Subject</label>
        <input id="ba-subject" placeholder="e.g. Georgian Bay market update"></div>

      <div id="ba-task-fields" class="form-grid" style="display:none">
        <div class="form-field"><label>Task type</label>
          <select id="ba-task-type">
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="text">Text</option>
            <option value="meeting">Meeting</option>
            <option value="showing">Showing</option>
          </select></div>
        <div class="form-field"><label>Due in (days)</label>
          <input id="ba-due" type="number" min="0" value="3"></div>
      </div>

      <div class="form-field"><label>Template <span style="color:var(--muted);font-weight:400">(Claude personalizes per contact)</span></label>
        <textarea id="ba-template" rows="7" placeholder="e.g. Quick market update — prices in Midland are holding steady but sellers are more flexible than 60 days ago. If you've been thinking about moving, happy to pull comps for your neighborhood."></textarea></div>

      <div class="form-field"><label>Contact limit</label>
        <input id="ba-limit" type="number" min="1" max="100" value="20">
        <div style="font-size:0.72rem;color:var(--muted);margin-top:0.2rem">Max 100 per batch. Start small — dry-run first, review, then execute.</div>
      </div>

      <div id="ba-preview" style="margin-top:0.75rem;max-height:260px;overflow-y:auto;display:none"></div>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-secondary" id="ba-dry-btn">Dry-run preview</button>
      <button class="btn-primary" id="ba-exec-btn" disabled>Execute</button>
    `);

    // Show/hide task-specific fields based on action
    const actionSel = document.getElementById('ba-action');
    const taskFields = document.getElementById('ba-task-fields');
    function toggleTaskFields() {
      taskFields.style.display = actionSel.value === 'task' ? 'grid' : 'none';
    }
    actionSel.addEventListener('change', toggleTaskFields);
    toggleTaskFields();

    document.getElementById('ba-dry-btn').onclick = () => runBulk(smartListId, true);
    document.getElementById('ba-exec-btn').onclick = () => runBulk(smartListId, false);
  }

  async function runBulk(smartListId, dryRun) {
    const action = document.getElementById('ba-action').value;
    const template = document.getElementById('ba-template').value.trim();
    const subject = document.getElementById('ba-subject').value.trim() || null;
    const limit = Math.max(1, Math.min(100, parseInt(document.getElementById('ba-limit').value) || 20));
    const task_type = document.getElementById('ba-task-type')?.value;
    const due_in_days = parseInt(document.getElementById('ba-due')?.value) || 3;

    if (!template) return toast('Template required', 'error');

    const dryBtn = document.getElementById('ba-dry-btn');
    const execBtn = document.getElementById('ba-exec-btn');
    const preview = document.getElementById('ba-preview');

    dryBtn.disabled = true; execBtn.disabled = true;
    const origText = dryRun ? dryBtn.textContent : execBtn.textContent;
    (dryRun ? dryBtn : execBtn).textContent = 'Working…';
    preview.style.display = 'block';
    preview.innerHTML = `<div style="padding:0.75rem;color:var(--muted);font-size:0.85rem">${dryRun ? 'Claude is personalizing each message…' : 'Pushing to FUB…'}</div>`;

    try {
      const r = await api('/api/fub/smart-lists/' + smartListId + '/bulk-action', {
        method: 'POST',
        body: JSON.stringify({ action, template, subject, task_type, due_in_days, limit, dry_run: dryRun })
      });

      const rows = (r.results || []).map((x, i) => `
        <div style="border:1px solid var(--border);border-radius:6px;padding:0.6rem 0.75rem;margin-bottom:0.5rem">
          <div style="font-weight:600;font-size:0.85rem">
            ${escapeHtml(x.name || ('Contact ' + x.person_id))}
            ${x.pushed ? `<span class="badge completed" style="margin-left:0.4rem">${x.pushed}</span>` : (dryRun ? '<span class="badge normal" style="margin-left:0.4rem">preview</span>' : '')}
          </div>
          ${x.email ? `<div style="font-size:0.72rem;color:var(--muted)">${escapeHtml(x.email)}</div>` : ''}
          <div style="font-size:0.82rem;line-height:1.5;white-space:pre-wrap;margin-top:0.3rem">${escapeHtml(x.rendered || '')}</div>
        </div>
      `).join('');
      const errorRows = (r.errors || []).length
        ? `<div style="margin-top:0.5rem;padding:0.5rem;background:#fee2e2;color:#991b1b;border-radius:6px;font-size:0.8rem">
             Errors: ${r.errors.length}. ${r.errors.map(e => escapeHtml((e.name || e.person_id) + ': ' + e.error)).join(' · ')}
           </div>`
        : '';
      preview.innerHTML = `
        <div style="font-size:0.8rem;color:var(--muted);margin-bottom:0.5rem">
          ${dryRun ? 'Dry-run preview' : 'Executed'} · ${r.total || 0} contacts · ${r.pushed || 0} pushed
        </div>
        ${rows}
        ${errorRows}
      `;

      if (dryRun) {
        execBtn.disabled = false;
        toast(`Previewed ${r.total} — review, then Execute`, 'success');
      } else {
        toast(`Pushed ${r.pushed} to FUB`, 'success');
      }
    } catch (e) {
      preview.innerHTML = `<div style="padding:0.75rem;color:#991b1b;font-size:0.85rem">${escapeHtml(e.message)}</div>`;
      toast(e.message, 'error');
    } finally {
      dryBtn.disabled = false;
      (dryRun ? dryBtn : execBtn).textContent = origText;
    }
  }

  function v(id) { const el = document.getElementById(id); return el && el.value.trim() ? el.value.trim() : null; }
  function todayIso() { return new Date().toISOString().slice(0, 10); }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
})();
