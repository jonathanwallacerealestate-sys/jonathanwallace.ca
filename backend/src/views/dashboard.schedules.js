/**
 * Schedules manager — open from Settings drawer. Lets Jonathan create
 * recurring agent jobs, briefings, weekly reviews, gap analyses, and
 * Claude Chrome workflow runs without writing any code.
 */
(function(){
  'use strict';
  const { api, toast, openModal, closeModal } = window.DB;
  const { escapeHtml } = window.DB_UTIL;

  window.DB_SCHED = { openManager };

  const KINDS = [
    { value: 'briefing',         label: 'Morning Briefing' },
    { value: 'gap_analysis',     label: 'What did I forget?' },
    { value: 'weekly_review',    label: 'Weekly Review' },
    { value: 'agent_task',       label: 'Custom Agent Task' },
    { value: 'chrome_workflow',  label: 'Chrome Workflow (emails the prompt)' },
    { value: 'fub_sync',         label: 'FUB sync (tasks + appointments)' },
    { value: 'fub_auto_respond', label: 'FUB auto-respond to new leads' },
    { value: 'fub_attribution',  label: 'FUB lead-source attribution' }
  ];
  const FREQS = [
    { value: 'hourly',  label: 'Every hour' },
    { value: 'daily',   label: 'Every day' },
    { value: 'weekly',  label: 'Every week' },
    { value: 'monthly', label: 'Every month' }
  ];
  const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  async function openManager() {
    let schedules = [];
    try { ({ schedules } = await api('/api/schedules')); }
    catch (e) { toast(e.message, 'error'); return; }

    openModal('Scheduled Jobs', `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
        <p style="font-size:0.8rem;color:var(--muted);margin:0">
          Recurring agent jobs. Each runs at the time you pick (America/Toronto). Results can be sent to your email or surfaced on the dashboard.
        </p>
        <button class="btn-primary" id="sch-new" style="padding:0.4rem 0.8rem;font-size:0.8rem">+ New Schedule</button>
      </div>
      ${schedules.length ? schedules.map(scheduleRow).join('') : '<div class="empty">No schedules yet.</div>'}
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
    `);

    document.getElementById('sch-new').onclick = () => openForm();
    document.querySelectorAll('[data-sch]').forEach(btn => {
      btn.addEventListener('click', () => handle(btn.dataset.sch, btn.dataset.id));
    });
  }

  function scheduleRow(s) {
    const when = describeSchedule(s);
    const next = s.next_run_at ? new Date(s.next_run_at).toLocaleString('en-CA', { timeZone: 'America/Toronto' }) : '—';
    const last = s.last_run_at ? new Date(s.last_run_at).toLocaleString('en-CA', { timeZone: 'America/Toronto' }) : null;
    return `
      <div class="row" style="margin-bottom:0.4rem" data-sch-id="${s.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(s.name)}
            ${s.enabled ? '' : '<span class="badge low" style="margin-left:0.5rem">paused</span>'}
            ${s.last_status === 'failed' ? '<span class="badge failed" style="margin-left:0.5rem">last failed</span>' : ''}
          </div>
          ${s.description ? `<div class="row-sub">${escapeHtml(s.description)}</div>` : ''}
          <div class="row-meta">
            <span>${escapeHtml(kindLabel(s.kind))}</span>
            <span>${escapeHtml(when)}</span>
            ${s.deliver_via && s.deliver_via !== 'dashboard' ? `<span>&#9993; ${escapeHtml(s.deliver_via)}</span>` : ''}
            <span>next: ${escapeHtml(next)}</span>
            ${last ? `<span>last: ${escapeHtml(last)}</span>` : ''}
            ${s.run_count ? `<span>${s.run_count} runs</span>` : ''}
          </div>
        </div>
        <div class="row-actions">
          <button class="primary" data-sch="run" data-id="${s.id}" title="Run now">&#9656;</button>
          <button data-sch="toggle" data-id="${s.id}" title="${s.enabled ? 'Pause' : 'Enable'}">${s.enabled ? '&#10074;&#10074;' : '&#10003;'}</button>
          <button data-sch="edit" data-id="${s.id}" title="Edit">&#9998;</button>
          <button class="danger" data-sch="del" data-id="${s.id}">&times;</button>
        </div>
      </div>`;
  }

  function describeSchedule(s) {
    const t = String(s.run_at_hour ?? 7).padStart(2,'0') + ':' + String(s.run_at_minute ?? 0).padStart(2,'0');
    if (s.frequency === 'hourly') return `Every hour at :${String(s.run_at_minute ?? 0).padStart(2,'0')}`;
    if (s.frequency === 'daily')  return `Daily at ${t}`;
    if (s.frequency === 'weekly') return `${DOW[s.run_at_dow ?? 1]} at ${t}`;
    if (s.frequency === 'monthly') return `Day ${s.run_at_dom ?? 1} of month at ${t}`;
    return s.frequency;
  }

  function kindLabel(k) {
    const f = KINDS.find(x => x.value === k); return f ? f.label : k;
  }

  async function handle(action, id) {
    try {
      switch (action) {
        case 'run':
          await api('/api/schedules/' + id + '/run-now', { method: 'POST', body: '{}' });
          toast('Triggered — refreshing in a moment', 'success');
          setTimeout(() => openManager(), 2500);
          return;
        case 'toggle': {
          const { schedules } = await api('/api/schedules');
          const s = schedules.find(x => x.id == id);
          await api('/api/schedules/' + id, { method: 'PATCH', body: JSON.stringify({ enabled: !s.enabled }) });
          toast(s.enabled ? 'Paused' : 'Enabled');
          openManager();
          return;
        }
        case 'edit':
          return openForm(id);
        case 'del':
          if (!confirm('Delete this schedule?')) return;
          await api('/api/schedules/' + id, { method: 'DELETE' });
          toast('Deleted'); openManager();
          return;
      }
    } catch (e) { toast(e.message, 'error'); }
  }

  async function openForm(id) {
    let s = { kind: 'briefing', frequency: 'daily', run_at_hour: 7, run_at_minute: 0, run_at_dow: 1, run_at_dom: 1, deliver_via: 'dashboard', enabled: true };
    let workflows = [];
    if (id) {
      const { schedules } = await api('/api/schedules');
      s = schedules.find(x => x.id == id) || s;
    }
    try { ({ workflows } = await api('/api/chrome/workflows')); } catch (e) { workflows = []; }

    const wfOptions = ['<option value="">(pick a workflow)</option>'].concat(
      workflows.map(w => `<option value="${w.id}" ${(s.payload && s.payload.workflow_id == w.id) ? 'selected' : ''}>${escapeHtml(w.name)}</option>`)
    ).join('');

    openModal(id ? 'Edit Schedule' : 'New Schedule', `
      <div class="form-field"><label>Name</label>
        <input id="sch-name" value="${escapeAttr(s.name || '')}" placeholder="e.g. Morning briefing"></div>
      <div class="form-field"><label>What should it do?</label>
        <select id="sch-kind">${KINDS.map(k => `<option value="${k.value}" ${s.kind === k.value ? 'selected' : ''}>${k.label}</option>`).join('')}</select></div>

      <div id="sch-payload-agent" class="form-field" style="display:${s.kind === 'agent_task' ? 'block' : 'none'}">
        <label>Agent instruction</label>
        <textarea id="sch-instruction" rows="3" placeholder="e.g. Draft an Instagram post about new SOGB listings this week.">${escapeAttr((s.payload && s.payload.instruction) || '')}</textarea>
      </div>
      <div id="sch-payload-workflow" class="form-field" style="display:${s.kind === 'chrome_workflow' ? 'block' : 'none'}">
        <label>Chrome Workflow</label>
        <select id="sch-wf">${wfOptions}</select>
      </div>

      <div class="form-grid">
        <div class="form-field"><label>Frequency</label>
          <select id="sch-freq">${FREQS.map(f => `<option value="${f.value}" ${s.frequency === f.value ? 'selected' : ''}>${f.label}</option>`).join('')}</select></div>
        <div class="form-field"><label>Time of day (Toronto)</label>
          <div style="display:flex;gap:0.4rem">
            <input id="sch-hour" type="number" min="0" max="23" value="${s.run_at_hour ?? 7}" style="width:60px">
            <span style="align-self:center">:</span>
            <input id="sch-min" type="number" min="0" max="59" value="${s.run_at_minute ?? 0}" style="width:60px">
          </div></div>
        <div id="sch-dow-wrap" class="form-field" style="display:${s.frequency === 'weekly' ? 'block' : 'none'}">
          <label>Day of week</label>
          <select id="sch-dow">${DOW.map((d, i) => `<option value="${i}" ${s.run_at_dow === i ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
        <div id="sch-dom-wrap" class="form-field" style="display:${s.frequency === 'monthly' ? 'block' : 'none'}">
          <label>Day of month</label>
          <input id="sch-dom" type="number" min="1" max="31" value="${s.run_at_dom ?? 1}"></div>
      </div>

      <div class="form-grid">
        <div class="form-field"><label>Deliver via</label>
          <select id="sch-via">
            <option value="dashboard" ${s.deliver_via === 'dashboard' ? 'selected' : ''}>Dashboard only</option>
            <option value="email" ${s.deliver_via === 'email' ? 'selected' : ''}>Email</option>
            <option value="both" ${s.deliver_via === 'both' ? 'selected' : ''}>Both</option>
          </select></div>
        <div class="form-field"><label>Email override (optional)</label>
          <input id="sch-to" type="email" value="${escapeAttr(s.deliver_to || '')}" placeholder="leave blank for default"></div>
      </div>
    `, `
      ${id ? '<button class="btn-danger" id="sch-del-btn">Delete</button>' : ''}
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="sch-save">${id ? 'Update' : 'Create'}</button>
    `);

    // Show/hide payload + dow/dom blocks reactively
    document.getElementById('sch-kind').addEventListener('change', updatePayloadVisibility);
    document.getElementById('sch-freq').addEventListener('change', updateFreqVisibility);

    if (id) document.getElementById('sch-del-btn').onclick = async () => {
      if (!confirm('Delete schedule?')) return;
      await api('/api/schedules/' + id, { method: 'DELETE' });
      toast('Deleted'); closeModal(); openManager();
    };

    document.getElementById('sch-save').onclick = async () => {
      const kind = document.getElementById('sch-kind').value;
      const payload = {};
      if (kind === 'agent_task') payload.instruction = document.getElementById('sch-instruction').value.trim();
      if (kind === 'chrome_workflow') {
        const wfid = document.getElementById('sch-wf').value;
        if (!wfid) return toast('Pick a workflow', 'error');
        payload.workflow_id = parseInt(wfid);
      }
      const body = {
        name: document.getElementById('sch-name').value.trim(),
        kind,
        payload,
        frequency: document.getElementById('sch-freq').value,
        run_at_hour: parseInt(document.getElementById('sch-hour').value) || 0,
        run_at_minute: parseInt(document.getElementById('sch-min').value) || 0,
        run_at_dow: parseInt(document.getElementById('sch-dow').value) || 0,
        run_at_dom: parseInt(document.getElementById('sch-dom').value) || 1,
        deliver_via: document.getElementById('sch-via').value,
        deliver_to: document.getElementById('sch-to').value.trim() || null,
        enabled: true
      };
      if (!body.name) return toast('Name required', 'error');
      try {
        await api('/api/schedules' + (id ? '/' + id : ''), {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(body)
        });
        toast('Saved', 'success'); closeModal(); openManager();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  function updatePayloadVisibility() {
    const k = document.getElementById('sch-kind').value;
    document.getElementById('sch-payload-agent').style.display    = k === 'agent_task' ? 'block' : 'none';
    document.getElementById('sch-payload-workflow').style.display = k === 'chrome_workflow' ? 'block' : 'none';
  }
  function updateFreqVisibility() {
    const f = document.getElementById('sch-freq').value;
    document.getElementById('sch-dow-wrap').style.display = f === 'weekly' ? 'block' : 'none';
    document.getElementById('sch-dom-wrap').style.display = f === 'monthly' ? 'block' : 'none';
  }

  function escapeAttr(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
})();
