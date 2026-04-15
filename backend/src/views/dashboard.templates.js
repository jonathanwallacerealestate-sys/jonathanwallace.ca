/**
 * Nurture templates manager.
 * Lives behind Settings → Nurture Templates → Manage.
 * Exposes window.DB_TEMPLATES.openManager().
 */
(function(){
  'use strict';
  const { api, toast, openModal, closeModal } = window.DB;
  const { escapeHtml } = window.DB_UTIL;

  async function openManager() {
    let templates = [];
    try { ({ templates } = await api('/api/templates')); }
    catch (e) { return toast(e.message, 'error'); }

    const rows = templates.length ? templates.map(t => `
      <div class="row" style="margin-bottom:0.4rem" data-template-id="${t.id}">
        <div class="row-main">
          <div class="row-title">
            ${escapeHtml(t.name)}
            ${t.purpose ? `<span style="margin-left:0.5rem;font-size:0.72rem;color:var(--muted);font-weight:400">${escapeHtml(t.purpose)}</span>` : ''}
          </div>
          <div class="row-sub">${escapeHtml((t.body || '').slice(0, 160))}${(t.body || '').length > 160 ? '…' : ''}</div>
          <div class="row-meta">
            <span class="badge normal">${escapeHtml(t.channel || 'note')}</span>
            ${t.use_count ? `<span>${t.use_count} uses</span>` : '<span>unused</span>'}
            ${t.last_used_at ? `<span>last ${new Date(t.last_used_at).toLocaleDateString('en-CA')}</span>` : ''}
          </div>
        </div>
        <div class="row-actions">
          <button class="primary" data-tpl-edit="${t.id}">Edit</button>
          <button class="danger" data-tpl-del="${t.id}">&times;</button>
        </div>
      </div>
    `).join('') : '<div class="empty">No templates yet. Click + New Template.</div>';

    openModal('Nurture Templates', `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
        <p style="font-size:0.8rem;color:var(--muted);margin:0">
          Reusable message bodies. Pick them in the Contacts card's bulk-action modal.
          Claude personalizes per contact at send time.
        </p>
        <button class="btn-primary" id="tpl-new" style="padding:0.4rem 0.9rem;font-size:0.8rem">+ New Template</button>
      </div>
      ${rows}
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
    `);

    document.getElementById('tpl-new').onclick = () => openEditor(null, templates);
    document.querySelectorAll('[data-tpl-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = templates.find(x => String(x.id) === String(btn.dataset.tplEdit));
        openEditor(t, templates);
      });
    });
    document.querySelectorAll('[data-tpl-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this template?')) return;
        try {
          await api('/api/templates/' + btn.dataset.tplDel, { method: 'DELETE' });
          toast('Deleted');
          openManager();
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  }

  function openEditor(t) {
    const editing = !!t;
    openModal(editing ? 'Edit template' : 'New template', `
      <div class="form-grid">
        <div class="form-field"><label>Name (unique)</label>
          <input id="tpl-name" value="${escapeAttr(t?.name || '')}"></div>
        <div class="form-field"><label>Purpose / tag</label>
          <input id="tpl-purpose" value="${escapeAttr(t?.purpose || '')}" placeholder="e.g. market update, past-client touch"></div>
        <div class="form-field"><label>Default channel</label>
          <select id="tpl-channel">
            <option value="note" ${t?.channel === 'note' ? 'selected' : ''}>Note on contact</option>
            <option value="task" ${t?.channel === 'task' ? 'selected' : ''}>Task on contact</option>
            <option value="email_draft" ${t?.channel === 'email_draft' ? 'selected' : ''}>Gmail draft</option>
            <option value="text" ${t?.channel === 'text' ? 'selected' : ''}>Text / SMS draft</option>
          </select></div>
        <div class="form-field"><label>Subject (for notes / emails)</label>
          <input id="tpl-subject" value="${escapeAttr(t?.subject || '')}"></div>
      </div>
      <div class="form-field"><label>Body</label>
        <textarea id="tpl-body" rows="10">${escapeHtml(t?.body || '')}</textarea></div>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="tpl-save">${editing ? 'Update' : 'Create'}</button>
    `);

    document.getElementById('tpl-save').onclick = async () => {
      const body = {
        name: document.getElementById('tpl-name').value.trim(),
        purpose: document.getElementById('tpl-purpose').value.trim() || null,
        channel: document.getElementById('tpl-channel').value,
        subject: document.getElementById('tpl-subject').value.trim() || null,
        body: document.getElementById('tpl-body').value.trim()
      };
      if (!body.name || !body.body) return toast('Name and body required', 'error');
      try {
        if (editing) await api('/api/templates/' + t.id, { method: 'PATCH', body: JSON.stringify(body) });
        else await api('/api/templates', { method: 'POST', body: JSON.stringify(body) });
        toast(editing ? 'Updated' : 'Created', 'success');
        openManager();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }

  window.DB_TEMPLATES = { openManager };
})();
