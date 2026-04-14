/**
 * Claude Chrome manager — credentials vault + named browser workflows.
 * Accessed from Settings drawer.
 *
 * Run flow:
 *   1. Click "Run" on a workflow
 *   2. Backend returns the composed prompt + decrypted credential
 *   3. Dashboard copies the prompt to clipboard and opens the target URL
 *      in a new tab. Paste into Claude Chrome to kick off the workflow.
 */
(function(){
  'use strict';
  const { api, toast, openModal, closeModal } = window.DB;
  const { escapeHtml } = window.DB_UTIL;

  window.DB_CHROME = { openManager };

  async function openManager(initialTab = 'workflows') {
    let creds = [], flows = [];
    try {
      const [c, w] = await Promise.all([api('/api/chrome/credentials'), api('/api/chrome/workflows')]);
      creds = c.credentials; flows = w.workflows;
    } catch (e) { toast(e.message, 'error'); return; }

    openModal('Claude Chrome Workflows', renderTabs(initialTab, creds, flows), `
      <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
    `);
    wireTabs();
    wireButtons();
  }

  function renderTabs(active, creds, flows) {
    return `
      <div style="display:flex;gap:0.25rem;margin-bottom:1rem;border-bottom:1px solid var(--border)">
        <button class="ct-tab ${active === 'workflows' ? 'active' : ''}" data-tab="workflows"
          style="background:none;border:none;padding:0.5rem 0.9rem;cursor:pointer;font-weight:600;color:${active === 'workflows' ? 'var(--text)' : 'var(--muted)'};border-bottom:2px solid ${active === 'workflows' ? 'var(--accent)' : 'transparent'}">
          Workflows (${flows.length})
        </button>
        <button class="ct-tab ${active === 'creds' ? 'active' : ''}" data-tab="creds"
          style="background:none;border:none;padding:0.5rem 0.9rem;cursor:pointer;font-weight:600;color:${active === 'creds' ? 'var(--text)' : 'var(--muted)'};border-bottom:2px solid ${active === 'creds' ? 'var(--accent)' : 'transparent'}">
          Credentials (${creds.length})
        </button>
      </div>

      <div id="ct-pane-workflows" style="display:${active === 'workflows' ? 'block' : 'none'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
          <p style="font-size:0.8rem;color:var(--muted);margin:0">Named multi-step browser workflows. Click Run to copy a Claude Chrome prompt and open the target URL.</p>
          <button class="btn-primary" data-ct="new-flow" style="padding:0.4rem 0.8rem;font-size:0.8rem">+ New Workflow</button>
        </div>
        ${flows.length ? flows.map(flowRow).join('') : '<div class="empty">No workflows yet.</div>'}
      </div>

      <div id="ct-pane-creds" style="display:${active === 'creds' ? 'block' : 'none'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
          <p style="font-size:0.8rem;color:var(--muted);margin:0">Encrypted credential vault. Passwords are AES-256-GCM encrypted at rest and only decrypted on Run or explicit reveal.</p>
          <button class="btn-primary" data-ct="new-cred" style="padding:0.4rem 0.8rem;font-size:0.8rem">+ New Credential</button>
        </div>
        ${creds.length ? creds.map(credRow).join('') : '<div class="empty">No credentials yet.</div>'}
      </div>
    `;
  }

  function flowRow(w) {
    const steps = Array.isArray(w.steps) ? w.steps : [];
    const stepCount = steps.length;
    return `
      <div class="row" style="margin-bottom:0.4rem" data-flow-id="${w.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(w.name)}</div>
          ${w.description ? `<div class="row-sub">${escapeHtml(w.description)}</div>` : ''}
          <div class="row-meta">
            ${w.target_url ? `<span>&#128279; ${escapeHtml(trim(w.target_url, 40))}</span>` : ''}
            ${w.credential_name ? `<span>&#128274; ${escapeHtml(w.credential_name)}</span>` : ''}
            <span>${stepCount} step${stepCount === 1 ? '' : 's'}</span>
            ${w.last_run_at ? `<span>last run ${new Date(w.last_run_at).toLocaleDateString('en-CA')}</span>` : ''}
            ${w.run_count ? `<span>${w.run_count} runs</span>` : ''}
          </div>
        </div>
        <div class="row-actions">
          <button class="primary" data-ct="run" data-id="${w.id}" title="Run via Claude Chrome">Run</button>
          <button data-ct="edit-flow" data-id="${w.id}">Edit</button>
          <button class="danger" data-ct="del-flow" data-id="${w.id}">&times;</button>
        </div>
      </div>`;
  }

  function credRow(c) {
    return `
      <div class="row" style="margin-bottom:0.4rem" data-cred-id="${c.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(c.name)}</div>
          <div class="row-meta">
            ${c.url ? `<span>&#128279; ${escapeHtml(trim(c.url, 40))}</span>` : ''}
            ${c.username ? `<span>&#128100; ${escapeHtml(c.username)}</span>` : ''}
            <span>${c.has_password ? '&#128274; password saved' : '&#9888; no password'}</span>
            ${c.use_count ? `<span>${c.use_count} uses</span>` : ''}
          </div>
          ${c.mfa_hint ? `<div class="row-sub">MFA: ${escapeHtml(c.mfa_hint)}</div>` : ''}
        </div>
        <div class="row-actions">
          <button data-ct="reveal" data-id="${c.id}" title="Reveal password">Reveal</button>
          <button data-ct="edit-cred" data-id="${c.id}">Edit</button>
          <button class="danger" data-ct="del-cred" data-id="${c.id}">&times;</button>
        </div>
      </div>`;
  }

  function wireTabs() {
    document.querySelectorAll('.ct-tab').forEach(b => {
      b.addEventListener('click', () => {
        const t = b.dataset.tab;
        document.getElementById('ct-pane-workflows').style.display = t === 'workflows' ? 'block' : 'none';
        document.getElementById('ct-pane-creds').style.display = t === 'creds' ? 'block' : 'none';
        document.querySelectorAll('.ct-tab').forEach(x => { x.style.color = 'var(--muted)'; x.style.borderBottomColor = 'transparent'; });
        b.style.color = 'var(--text)';
        b.style.borderBottomColor = 'var(--accent)';
      });
    });
  }

  function wireButtons() {
    document.querySelectorAll('[data-ct]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.ct;
        const id = btn.dataset.id;
        try {
          switch (action) {
            case 'new-flow':   return openFlowForm();
            case 'edit-flow':  return openFlowForm(id);
            case 'new-cred':   return openCredForm();
            case 'edit-cred':  return openCredForm(id);
            case 'del-flow':
              if (!confirm('Delete this workflow?')) return;
              await api('/api/chrome/workflows/' + id, { method: 'DELETE' });
              toast('Deleted'); openManager('workflows'); return;
            case 'del-cred':
              if (!confirm('Delete this credential?')) return;
              await api('/api/chrome/credentials/' + id, { method: 'DELETE' });
              toast('Deleted'); openManager('creds'); return;
            case 'reveal':
              return revealCredential(id);
            case 'run':
              return runWorkflow(id);
          }
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  }

  async function revealCredential(id) {
    try {
      const data = await api('/api/chrome/credentials/' + id + '/reveal?confirm=true');
      openModal('Credential — ' + data.name, `
        <div class="form-field"><label>Username</label>
          <input readonly value="${escapeHtml(data.username || '')}" onclick="this.select()"></div>
        <div class="form-field"><label>Password</label>
          <input readonly value="${escapeHtml(data.password || '')}" onclick="this.select()"
                 style="font-family:monospace"></div>
        <p style="font-size:0.8rem;color:var(--muted);margin-top:0.5rem">Click a field to select and copy.</p>
      `, `<button class="btn-secondary" onclick="DB.closeModal()">Close</button>`);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function runWorkflow(id) {
    try {
      const data = await api('/api/chrome/workflows/' + id + '/run', { method: 'POST', body: '{}' });
      let copied = false;
      try {
        await navigator.clipboard.writeText(data.prompt);
        copied = true;
      } catch (e) { /* fallback below */ }

      const previewText = data.prompt.length > 800 ? data.prompt.slice(0, 800) + '…' : data.prompt;
      openModal('Workflow ready for Claude Chrome', `
        <p style="font-size:0.9rem;margin-bottom:0.75rem">
          ${copied ? '<span style="color:var(--success)">&#10003; Prompt copied to clipboard.</span>' : '<span style="color:#92400e">Copy the prompt below manually — clipboard access was denied.</span>'}
        </p>
        ${data.target_url ? `<p style="font-size:0.9rem;margin-bottom:0.75rem">
          Target URL: <a href="${escapeHtml(data.target_url)}" target="_blank" rel="noopener">${escapeHtml(data.target_url)}</a>
        </p>` : ''}
        <label style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Claude Chrome Prompt</label>
        <textarea readonly rows="14" style="width:100%;padding:0.75rem;border:1px solid var(--border);border-radius:8px;font-family:monospace;font-size:0.8rem;margin-top:0.25rem" onclick="this.select()">${escapeHtml(previewText)}</textarea>
        <p style="font-size:0.8rem;color:var(--muted);margin-top:0.75rem">
          Next: open Claude Chrome (extension icon), paste the prompt, and Claude will drive the browser through the steps.
        </p>
      `, `
        <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
        ${data.target_url ? `<button class="btn-primary" id="ct-open-url">Open URL</button>` : ''}
        <button class="btn-primary" id="ct-copy-again">Copy Again</button>
      `);
      const openBtn = document.getElementById('ct-open-url');
      if (openBtn) openBtn.onclick = () => window.open(data.target_url, '_blank', 'noopener');
      document.getElementById('ct-copy-again').onclick = async () => {
        try { await navigator.clipboard.writeText(data.prompt); toast('Copied', 'success'); }
        catch (e) { toast('Clipboard blocked', 'error'); }
      };
    } catch (e) { toast(e.message, 'error'); }
  }

  async function openFlowForm(id) {
    let w = { steps: [] };
    if (id) {
      const { workflows } = await api('/api/chrome/workflows');
      w = workflows.find(x => x.id == id) || w;
    }
    const { credentials } = await api('/api/chrome/credentials');
    const stepsText = Array.isArray(w.steps) ? w.steps.join('\n') : '';
    const credOpts = ['<option value="">(none)</option>'].concat(
      credentials.map(c => `<option value="${escapeHtml(c.name)}" ${w.credential_name === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    ).join('');

    openModal(id ? 'Edit Workflow' : 'New Workflow', `
      <div class="form-field"><label>Name</label>
        <input id="wf-name" value="${escapeAttr(w.name || '')}" placeholder="e.g. Refresh MLS comps for Midland"></div>
      <div class="form-field"><label>Description</label>
        <input id="wf-desc" value="${escapeAttr(w.description || '')}" placeholder="What is the goal of this workflow?"></div>
      <div class="form-field"><label>Target URL</label>
        <input id="wf-url" value="${escapeAttr(w.target_url || '')}" placeholder="https://..."></div>
      <div class="form-field"><label>Credential</label>
        <select id="wf-cred">${credOpts}</select></div>
      <div class="form-field"><label>Steps <span style="color:var(--muted);font-weight:400">(one per line — plain English)</span></label>
        <textarea id="wf-steps" rows="8" placeholder="Click the Search tab
Filter by Midland, sold in the last 90 days
Export the top 10 results as CSV
Email the CSV to jonathanwallacerealestate@gmail.com">${escapeAttr(stepsText)}</textarea></div>
      <div class="form-field"><label>Expected Output</label>
        <input id="wf-out" value="${escapeAttr(w.expected_output || '')}" placeholder="What should Claude report back?"></div>
    `, `
      ${id ? '<button class="btn-danger" id="wf-del">Delete</button>' : ''}
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="wf-save">${id ? 'Update' : 'Create'}</button>
    `);
    if (id) {
      document.getElementById('wf-del').onclick = async () => {
        if (!confirm('Delete workflow?')) return;
        await api('/api/chrome/workflows/' + id, { method: 'DELETE' });
        toast('Deleted'); closeModal(); openManager('workflows');
      };
    }
    document.getElementById('wf-save').onclick = async () => {
      const body = {
        name: v('wf-name'),
        description: v('wf-desc'),
        target_url: v('wf-url'),
        credential_name: v('wf-cred'),
        steps: (document.getElementById('wf-steps').value || '').split('\n').map(s => s.trim()).filter(Boolean),
        expected_output: v('wf-out')
      };
      if (!body.name) return toast('Name required', 'error');
      try {
        await api('/api/chrome/workflows' + (id ? '/' + id : ''), {
          method: id ? 'PATCH' : 'POST', body: JSON.stringify(body)
        });
        toast('Saved', 'success'); closeModal(); openManager('workflows');
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  async function openCredForm(id) {
    let c = {};
    if (id) {
      const { credentials } = await api('/api/chrome/credentials');
      c = credentials.find(x => x.id == id) || c;
    }
    openModal(id ? 'Edit Credential' : 'New Credential', `
      <div class="form-field"><label>Name (used to reference from workflows)</label>
        <input id="cr-name" value="${escapeAttr(c.name || '')}" placeholder="e.g. matrix_mls"></div>
      <div class="form-field"><label>Site / Service</label>
        <input id="cr-site" value="${escapeAttr(c.site || '')}" placeholder="e.g. Matrix MLS"></div>
      <div class="form-field"><label>URL</label>
        <input id="cr-url" value="${escapeAttr(c.url || '')}" placeholder="https://..."></div>
      <div class="form-field"><label>Username</label>
        <input id="cr-user" value="${escapeAttr(c.username || '')}" autocomplete="off"></div>
      <div class="form-field"><label>Password ${id ? '<span style="color:var(--muted);font-weight:400">(leave blank to keep existing)</span>' : ''}</label>
        <input id="cr-pass" type="password" autocomplete="new-password"></div>
      <div class="form-field"><label>MFA Hint</label>
        <input id="cr-mfa" value="${escapeAttr(c.mfa_hint || '')}" placeholder="Authenticator app / SMS / etc."></div>
      <div class="form-field"><label>Notes</label>
        <textarea id="cr-notes" rows="2">${escapeAttr(c.notes || '')}</textarea></div>
    `, `
      ${id ? '<button class="btn-danger" id="cr-del">Delete</button>' : ''}
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="cr-save">${id ? 'Update' : 'Create'}</button>
    `);
    if (id) {
      document.getElementById('cr-del').onclick = async () => {
        if (!confirm('Delete credential?')) return;
        await api('/api/chrome/credentials/' + id, { method: 'DELETE' });
        toast('Deleted'); closeModal(); openManager('creds');
      };
    }
    document.getElementById('cr-save').onclick = async () => {
      const body = {
        name: v('cr-name'), site: v('cr-site'), url: v('cr-url'),
        username: v('cr-user'), password: document.getElementById('cr-pass').value || null,
        mfa_hint: v('cr-mfa'), notes: v('cr-notes')
      };
      if (!body.name) return toast('Name required', 'error');
      try {
        await api('/api/chrome/credentials', { method: 'POST', body: JSON.stringify(body) });
        toast('Saved', 'success'); closeModal(); openManager('creds');
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  function v(id) { const el = document.getElementById(id); return el && el.value.trim() ? el.value.trim() : null; }
  function trim(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
})();
