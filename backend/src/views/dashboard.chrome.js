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
    let creds = [], flows = [], toolGroups = [], toolCount = 0;
    try {
      const [c, w, t] = await Promise.all([
        api('/api/chrome/credentials'),
        api('/api/chrome/workflows'),
        api('/api/tools')
      ]);
      creds = c.credentials; flows = w.workflows;
      toolGroups = t.groups || []; toolCount = t.count || 0;
    } catch (e) { toast(e.message, 'error'); return; }

    openModal('Claude Chrome Workflows', renderTabs(initialTab, creds, flows, toolGroups, toolCount), `
      <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
    `);
    wireTabs();
    wireButtons();
  }

  function tabBtn(label, key, active) {
    const isActive = active === key;
    return `<button class="ct-tab ${isActive ? 'active' : ''}" data-tab="${key}"
      style="background:none;border:none;padding:0.5rem 0.9rem;cursor:pointer;font-weight:600;color:${isActive ? 'var(--text)' : 'var(--muted)'};border-bottom:2px solid ${isActive ? 'var(--accent)' : 'transparent'}">
      ${label}
    </button>`;
  }

  function renderTabs(active, creds, flows, toolGroups, toolCount) {
    return `
      <div style="display:flex;gap:0.25rem;margin-bottom:1rem;border-bottom:1px solid var(--border);overflow-x:auto">
        ${tabBtn(`Workflows (${flows.length})`, 'workflows', active)}
        ${tabBtn(`Credentials (${creds.length})`, 'creds', active)}
        ${tabBtn(`Tools (${toolCount})`, 'tools', active)}
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

      <div id="ct-pane-tools" style="display:${active === 'tools' ? 'block' : 'none'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;gap:0.5rem;flex-wrap:wrap">
          <p style="font-size:0.8rem;color:var(--muted);margin:0;flex:1;min-width:200px">
            Every tool you use for business — imported from your Chrome bookmarks. Click any tool to add a credential or have Claude draft a starter workflow.
          </p>
          <button class="btn-primary" data-ct="import-bookmarks" style="padding:0.4rem 0.8rem;font-size:0.8rem">Import Bookmarks</button>
          <button class="btn-secondary" data-ct="add-tool" style="padding:0.4rem 0.8rem;font-size:0.8rem">+ Add Tool</button>
        </div>
        ${toolGroups.length ? toolGroups.map(toolGroup).join('') : '<div class="empty">No tools yet. Click <strong>Import Bookmarks</strong> to load your Chrome bookmark export.</div>'}
      </div>
    `;
  }

  function toolGroup(g) {
    const folder = g.folder || '/';
    const items = g.items || [];
    return `
      <div style="margin-bottom:1rem">
        <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.4rem;font-weight:600">
          ${escapeHtml(folder)} <span style="color:var(--border);margin-left:0.4rem">${items.length}</span>
        </div>
        ${items.map(toolRow).join('')}
      </div>`;
  }

  function toolRow(t) {
    const host = (() => { try { return new URL(t.url).hostname.replace(/^www\./, ''); } catch (e) { return t.url; } })();
    const credBadge = t.credential_name
      ? `<span class="badge ${t.credential_has_password ? 'completed' : 'pending'}">&#128274; ${escapeHtml(t.credential_name)}${t.credential_has_password ? '' : ' (no pwd)'}</span>`
      : '<span class="badge low">no credential</span>';
    const wfCount = Array.isArray(t.external_workflow_ids) ? t.external_workflow_ids.length : 0;
    return `
      <div class="row" data-tool-id="${t.id}" style="margin-bottom:0.35rem">
        <div class="row-main">
          <div class="row-title" style="display:flex;align-items:center;gap:0.5rem">
            ${t.favicon_url ? `<img src="${escapeHtml(t.favicon_url)}" alt="" style="width:14px;height:14px;flex-shrink:0">` : ''}
            <span>${escapeHtml(t.name)}</span>
          </div>
          <div class="row-meta">
            <span>&#128279; ${escapeHtml(host)}</span>
            ${credBadge}
            ${wfCount ? `<span>${wfCount} workflow${wfCount === 1 ? '' : 's'}</span>` : ''}
          </div>
        </div>
        <div class="row-actions">
          <button data-ct="open-tool" data-id="${t.id}" data-url="${escapeHtml(t.url)}" title="Open in tab">&#8599;</button>
          ${t.credential_name ? '' : `<button data-ct="tool-add-cred" data-id="${t.id}" title="Add credential">&#128274;</button>`}
          <button class="primary" data-ct="tool-make-workflow" data-id="${t.id}" title="Draft workflow with Claude">&#9889;</button>
          <button class="danger" data-ct="del-tool" data-id="${t.id}" title="Remove">&times;</button>
        </div>
      </div>`;
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
    const panes = ['workflows', 'creds', 'tools'];
    document.querySelectorAll('.ct-tab').forEach(b => {
      b.addEventListener('click', () => {
        const t = b.dataset.tab;
        panes.forEach(p => {
          const el = document.getElementById('ct-pane-' + p);
          if (el) el.style.display = t === p ? 'block' : 'none';
        });
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
            case 'import-bookmarks':
              return openImportDialog();
            case 'add-tool':
              return openToolForm();
            case 'open-tool':
              return window.open(btn.dataset.url, '_blank', 'noopener');
            case 'tool-add-cred':
              return openToolCredentialDialog(id);
            case 'tool-make-workflow':
              return makeWorkflowFromTool(id);
            case 'del-tool':
              if (!confirm('Remove this tool from the catalog?')) return;
              await api('/api/tools/' + id, { method: 'DELETE' });
              toast('Removed'); openManager('tools'); return;
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
        <input id="wf-name" value="${escapeAttr(w.name || '')}" placeholder="e.g. Realm — SOGB sold comps for 2 Water St"></div>
      <div class="form-field"><label>Description</label>
        <input id="wf-desc" value="${escapeAttr(w.description || '')}" placeholder="What is the goal of this workflow?"></div>
      <div class="form-field"><label>Target URL</label>
        <input id="wf-url" value="${escapeAttr(w.target_url || '')}" placeholder="https://tools.proptx.ca/onepoint"></div>
      <div class="form-field"><label>Credential</label>
        <select id="wf-cred">${credOpts}</select></div>
      <div class="form-field"><label>Steps <span style="color:var(--muted);font-weight:400">(one per line — plain English)</span></label>
        <textarea id="wf-steps" rows="8" placeholder="Log in via AMP SSO using the credential provided
Open Realm search from OnePoint
Filter by Midland, sold in the last 90 days
Capture the top 10 with address, sold price, DOM
Report the average $/sqft and median sold price">${escapeAttr(stepsText)}</textarea></div>
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
        <input id="cr-name" value="${escapeAttr(c.name || '')}" placeholder="e.g. realm"></div>
      <div class="form-field"><label>Site / Service</label>
        <input id="cr-site" value="${escapeAttr(c.site || '')}" placeholder="e.g. Realm — PropTx OnePoint"></div>
      <div class="form-field"><label>URL</label>
        <input id="cr-url" value="${escapeAttr(c.url || '')}" placeholder="https://tools.proptx.ca/onepoint"></div>
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

  // ---------- Tools: import / add / make-credential / make-workflow ----------
  function openImportDialog() {
    openModal('Import Chrome Bookmarks', `
      <p style="font-size:0.85rem;color:var(--muted);margin-bottom:0.75rem">
        In Chrome: <strong>Bookmarks → Bookmark manager → ⋮ menu → Export bookmarks</strong>.
        Pick the saved HTML file below — only bookmarks whose folder path matches the optional filter will be imported.
      </p>
      <div class="form-field">
        <label>Bookmarks HTML file</label>
        <input id="ct-import-file" type="file" accept=".html,.htm,text/html">
      </div>
      <div class="form-field">
        <label>Folder filter (optional, case-insensitive)</label>
        <input id="ct-import-filter" placeholder="e.g. Business, Real Estate, Tools">
      </div>
      <p style="font-size:0.8rem;color:var(--muted);margin:1rem 0 0.5rem">— or —</p>
      <div class="form-field">
        <label>Paste a list of URLs (one per line)</label>
        <textarea id="ct-import-urls" rows="6" placeholder="https://app.followupboss.com
https://hook.us2.make.com
Realm — https://tools.proptx.ca/onepoint
[Buffer](https://buffer.com)"></textarea>
      </div>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="ct-do-import">Import</button>
    `);

    document.getElementById('ct-do-import').onclick = async () => {
      const file = document.getElementById('ct-import-file').files[0];
      const filter = document.getElementById('ct-import-filter').value.trim() || null;
      const urls = document.getElementById('ct-import-urls').value.trim() || null;
      if (!file && !urls) { toast('Pick a file or paste URLs', 'error'); return; }

      let html = null;
      if (file) {
        try { html = await readFile(file); }
        catch (e) { toast('Could not read file', 'error'); return; }
      }
      const btn = document.getElementById('ct-do-import');
      btn.disabled = true; btn.textContent = 'Importing…';
      try {
        const r = await api('/api/tools/import', {
          method: 'POST',
          body: JSON.stringify({ html, urls, folderFilter: filter })
        });
        toast(`Imported: ${r.inserted} new, ${r.updated} updated`, 'success');
        closeModal();
        openManager('tools');
      } catch (e) { toast(e.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = 'Import'; }
    };
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });
  }

  async function openToolForm(id) {
    let t = {};
    if (id) {
      const { tools } = await api('/api/tools');
      t = tools.find(x => x.id == id) || t;
    }
    openModal(id ? 'Edit Tool' : 'New Tool', `
      <div class="form-field"><label>Name</label>
        <input id="tl-name" value="${escapeAttr(t.name || '')}"></div>
      <div class="form-field"><label>URL</label>
        <input id="tl-url" value="${escapeAttr(t.url || '')}" placeholder="https://..."></div>
      <div class="form-field"><label>Folder Path</label>
        <input id="tl-folder" value="${escapeAttr(t.folder_path || '/Manual')}"></div>
      <div class="form-field"><label>Description</label>
        <textarea id="tl-desc" rows="2">${escapeAttr(t.description || '')}</textarea></div>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="tl-save">${id ? 'Update' : 'Create'}</button>
    `);
    document.getElementById('tl-save').onclick = async () => {
      const body = {
        name: v('tl-name'), url: v('tl-url'),
        folder_path: v('tl-folder'), description: v('tl-desc')
      };
      if (!body.url) return toast('URL required', 'error');
      try {
        await api('/api/tools' + (id ? '/' + id : ''), {
          method: id ? 'PATCH' : 'POST', body: JSON.stringify(body)
        });
        toast('Saved', 'success'); closeModal(); openManager('tools');
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  function openToolCredentialDialog(toolId) {
    openModal('Add credential for tool', `
      <p style="font-size:0.85rem;color:var(--muted);margin-bottom:0.75rem">
        We'll create an encrypted credential and link it to this tool. Leave password blank to fill in later.
      </p>
      <div class="form-field"><label>Slug (used to reference from workflows)</label>
        <input id="tcr-name" placeholder="auto-generated from tool name"></div>
      <div class="form-field"><label>Username</label>
        <input id="tcr-user" autocomplete="off"></div>
      <div class="form-field"><label>Password</label>
        <input id="tcr-pass" type="password" autocomplete="new-password"></div>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="tcr-save">Create</button>
    `);
    document.getElementById('tcr-save').onclick = async () => {
      try {
        await api('/api/tools/' + toolId + '/make-credential', {
          method: 'POST',
          body: JSON.stringify({
            name: v('tcr-name') || undefined,
            username: v('tcr-user'),
            password: document.getElementById('tcr-pass').value || null
          })
        });
        toast('Credential linked', 'success'); closeModal(); openManager('tools');
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  async function makeWorkflowFromTool(toolId) {
    let goal = window.prompt('What should this workflow do? (e.g. "Pull active listings in Midland")');
    if (goal === null) return; // cancelled
    goal = goal.trim();
    toast('Drafting workflow with Claude…');
    try {
      const r = await api('/api/tools/' + toolId + '/make-workflow', {
        method: 'POST', body: JSON.stringify({ goal: goal || undefined })
      });
      toast('Workflow ready: ' + (r.workflow.name || 'unnamed'), 'success');
      openManager('workflows');
    } catch (e) { toast(e.message, 'error'); }
  }

  function v(id) { const el = document.getElementById(id); return el && el.value.trim() ? el.value.trim() : null; }
  function trim(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
})();
