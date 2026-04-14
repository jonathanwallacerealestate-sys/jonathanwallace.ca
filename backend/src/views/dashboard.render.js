/**
 * Dashboard renderers — one function per section, each consuming a slice of
 * /api/daily-brief and mutating the DOM inside its card.
 */
(function(){
  'use strict';
  const { $, $$, el, escapeHtml, fmtTime, fmtTimeShort, fmtDate, fmtMoney, dueClass } = window.DB_UTIL;
  const { api, toast, openModal, closeModal } = window.DB;
  const state = window.DB.state;

  // ---------- Section nav ----------
  function renderNav() {
    const sections = [
      { id: 'tasks', label: 'Tasks' },
      { id: 'emails', label: 'Emails' },
      { id: 'crm', label: 'CRM' },
      { id: 'calendar', label: 'Calendar' },
      { id: 'closings', label: 'P&L' },
      { id: 'personal', label: 'Personal' },
      { id: 'workouts', label: 'Workout' },
      { id: 'meals', label: 'Meals' },
      { id: 'marketing', label: 'Marketing' },
      { id: 'custom-root', label: 'Custom' }
    ];
    const nav = $('#section-nav');
    nav.innerHTML = sections.map(s =>
      `<button data-target="${s.id}">${s.label}</button>`
    ).join('');
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-target]');
      if (!btn) return;
      $$('#section-nav button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const el = document.querySelector('[data-section="' + btn.dataset.target + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ---------- Agent tasks ----------
  function renderTasks(brief) {
    const s = brief.tasks.stats || {};
    $('#task-stats').innerHTML = `
      <span class="chip-stat">${s.total || 0} total</span>
      <span class="chip-stat warn">${s.pending || 0} pending</span>
      <span class="chip-stat info">${s.processing || 0} active</span>
      <span class="chip-stat success">${s.completed || 0} done</span>
    `;
    const list = $('#task-list');
    if (!brief.tasks.recent.length) {
      list.innerHTML = '<div class="empty">No recent agent tasks.</div>';
      return;
    }
    list.innerHTML = brief.tasks.recent.map(t => `
      <div class="row" data-task="${t.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(t.instruction.substring(0, 120))}${t.instruction.length > 120 ? '…' : ''}</div>
          <div class="row-meta">
            <span class="badge ${t.status}">${t.status}</span>
            <span>${escapeHtml(t.type.replace(/_/g, ' '))}</span>
            <span>${fmtTime(t.created_at)}</span>
          </div>
        </div>
        <div class="row-actions">
          <button data-action="view-task" data-id="${t.id}" title="View">View</button>
        </div>
      </div>
    `).join('');
  }

  async function viewTask(id) {
    try {
      const { task } = await api('/api/tasks/' + id);
      let body = '';
      if (task.result && task.result.content) {
        body = typeof marked !== 'undefined'
          ? marked.parse(task.result.content)
          : '<pre>' + escapeHtml(task.result.content) + '</pre>';
      } else if (task.error) {
        body = '<p style="color:#991b1b">Error: ' + escapeHtml(task.error) + '</p>';
      } else {
        body = '<p>Still processing — refresh in a moment.</p>';
      }
      openModal(task.type.replace(/_/g, ' ') + ' — ' + task.status, body,
        `<button class="btn-secondary" onclick="DB.closeModal()">Close</button>
         ${task.result && task.result.content ? `<button class="btn-primary" onclick="navigator.clipboard.writeText(${JSON.stringify(task.result.content)});DB.toast('Copied','success')">Copy</button>` : ''}`);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function submitAgent() {
    const btn = $('#agent-submit');
    const ta = $('#agent-instruction');
    const fb = $('#agent-feedback');
    const text = ta.value.trim();
    if (!text) return;
    btn.disabled = true; btn.textContent = 'Sending…';
    fb.className = 'feedback';
    try {
      const r = await api('/api/tasks/quick', {
        method: 'POST',
        body: JSON.stringify({ text, source: 'dashboard' })
      });
      fb.className = 'feedback show success';
      fb.textContent = r.message + ' (Task #' + r.task_id + ')';
      ta.value = '';
      setTimeout(load, 1500);
    } catch (e) {
      fb.className = 'feedback show error';
      fb.textContent = e.message;
    }
    btn.disabled = false; btn.textContent = 'Send to Agent';
  }

  // ---------- Emails ----------
  function renderEmails(brief) {
    const s = brief.emails.stats || {};
    $('#email-stats').innerHTML = `
      <span class="chip-stat ${s.urgent > 0 ? 'danger' : ''}">${s.urgent || 0} urgent</span>
      <span class="chip-stat warn">${s.needs_reply || 0} to reply</span>
      <span class="chip-stat success">${s.handled_today || 0} handled today</span>
    `;
    const list = $('#email-list');
    if (!brief.emails.list.length) {
      list.innerHTML = '<div class="empty">Inbox zero. Nothing flagged.</div>';
      return;
    }
    list.innerHTML = brief.emails.list.map(e => `
      <div class="row" data-email="${e.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(e.subject || '(no subject)')}</div>
          <div class="row-meta">
            <span class="badge ${e.priority || 'normal'}">${e.priority || 'normal'}</span>
            <span>${escapeHtml(e.from_name || e.from_address || '')}</span>
            <span>${fmtTime(e.received_at)}</span>
          </div>
          ${e.snippet ? `<div class="row-sub">${escapeHtml(e.snippet.substring(0, 150))}${e.snippet.length > 150 ? '…' : ''}</div>` : ''}
        </div>
        <div class="row-actions">
          <button class="primary" data-action="handle-email" data-id="${e.id}" title="Mark handled">&#10003;</button>
          <button class="danger" data-action="delete-email" data-id="${e.id}" title="Dismiss">&times;</button>
        </div>
      </div>
    `).join('');
  }

  // ---------- CRM Follow-ups ----------
  function renderCrm(brief) {
    const s = brief.crm.stats || {};
    $('#crm-stats').innerHTML = `
      <span class="chip-stat ${s.overdue > 0 ? 'danger' : ''}">${s.overdue || 0} overdue</span>
      <span class="chip-stat warn">${s.due_today || 0} today</span>
      <span class="chip-stat info">${s.this_week || 0} this week</span>
      <span class="chip-stat">${s.open_total || 0} open</span>
    `;
    const list = $('#crm-list');
    let items = brief.crm.list || [];
    const f = state.crmFilter;
    const today = new Date(); today.setHours(0,0,0,0);
    if (f === 'today') items = items.filter(x => x.due_date && new Date(x.due_date).setHours(0,0,0,0) === today.getTime());
    else if (f === 'overdue') items = items.filter(x => x.due_date && new Date(x.due_date) < today);
    else if (f === 'week') {
      const weekOut = new Date(today); weekOut.setDate(weekOut.getDate() + 7);
      items = items.filter(x => x.due_date && new Date(x.due_date) >= today && new Date(x.due_date) <= weekOut);
    }
    if (!items.length) {
      list.innerHTML = '<div class="empty">No follow-ups in this view.</div>';
      return;
    }
    list.innerHTML = items.map(c => `
      <div class="row ${dueClass(c.due_date)}" data-crm="${c.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(c.contact_name || c.contact_email || 'Unknown contact')}</div>
          <div class="row-meta">
            ${c.stage ? `<span>${escapeHtml(c.stage)}</span>` : ''}
            ${c.follow_up_type ? `<span>${escapeHtml(c.follow_up_type)}</span>` : ''}
            ${c.due_date ? `<span>Due ${fmtDate(c.due_date)}</span>` : ''}
            ${c.lead_source ? `<span>${escapeHtml(c.lead_source)}</span>` : ''}
          </div>
          ${c.notes ? `<div class="row-sub">${escapeHtml(c.notes.substring(0, 180))}</div>` : ''}
        </div>
        <div class="row-actions">
          <button class="primary" data-action="complete-crm" data-id="${c.id}" title="Mark done">&#10003;</button>
          <button data-action="edit-crm" data-id="${c.id}" title="Edit">&#9998;</button>
        </div>
      </div>
    `).join('');
  }

  // ---------- Calendar ----------
  function renderCalendar(brief) {
    const events = brief.calendar.today || [];
    $('#calendar-stats').innerHTML = `<span class="chip-stat info">${events.length} today</span>`;
    const list = $('#calendar-list');
    if (!events.length) {
      list.innerHTML = '<div class="empty">Nothing scheduled today. Plan wisely.</div>';
      return;
    }
    list.innerHTML = events.map(e => `
      <div class="row">
        <div class="row-main">
          <div class="row-title">${escapeHtml(e.title)}</div>
          <div class="row-meta">
            <span>${e.all_day ? 'All day' : (fmtTimeShort(e.start_time) + (e.end_time ? ' – ' + fmtTimeShort(e.end_time) : ''))}</span>
            ${e.location ? `<span>&#128205; ${escapeHtml(e.location)}</span>` : ''}
            ${e.event_type ? `<span class="badge normal">${escapeHtml(e.event_type)}</span>` : ''}
          </div>
          ${e.meeting_link ? `<div class="row-sub"><a href="${escapeHtml(e.meeting_link)}" target="_blank" rel="noopener">Join meeting</a></div>` : ''}
        </div>
      </div>
    `).join('');
  }

  // ---------- Closings & P&L ----------
  function renderClosings(brief) {
    const ytd = brief.closings.ytd || {};
    const upcoming = brief.closings.upcoming || [];
    $('#pnl-stats').innerHTML = `<span class="chip-stat">${upcoming.length} upcoming</span>`;
    $('#pnl-kpis').innerHTML = `
      <div class="kpi"><div class="label">YTD Deals</div><div class="value">${ytd.deals || 0}</div></div>
      <div class="kpi"><div class="label">Sales Volume</div><div class="value">${fmtMoney(ytd.sale_volume)}</div></div>
      <div class="kpi"><div class="label">Gross Commission</div><div class="value">${fmtMoney(ytd.gross_commission)}</div></div>
      <div class="kpi"><div class="label">Net Profit</div><div class="value" style="color:#10b981">${fmtMoney(ytd.net_profit)}</div></div>
    `;
    const list = $('#closing-list');
    if (!upcoming.length) {
      list.innerHTML = '<div class="empty">No upcoming closings. Go find one.</div>';
      return;
    }
    list.innerHTML = upcoming.map(c => `
      <div class="row" data-closing="${c.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(c.property_address)}${c.city ? ', ' + escapeHtml(c.city) : ''}</div>
          <div class="row-meta">
            <span class="badge ${c.status}">${c.status}</span>
            ${c.transaction_side ? `<span>${escapeHtml(c.transaction_side)}</span>` : ''}
            ${c.client_name ? `<span>&#128100; ${escapeHtml(c.client_name)}</span>` : ''}
            ${c.closing_date ? `<span>Closes ${fmtDate(c.closing_date)}</span>` : ''}
          </div>
          <div class="row-sub">
            Sale ${fmtMoney(c.sale_price)} · GCI ${fmtMoney(c.gross_commission)} · Net ${fmtMoney(c.net_profit)}
          </div>
        </div>
        <div class="row-actions">
          <button data-action="edit-closing" data-id="${c.id}" title="Edit">&#9998;</button>
        </div>
      </div>
    `).join('');
  }

  // ---------- Personal Tasks ----------
  function renderPersonal(brief) {
    const items = brief.personal.list || [];
    const overdue = items.filter(x => x.due_date && new Date(x.due_date) < new Date(new Date().toDateString())).length;
    const today = items.filter(x => x.due_date && fmtDate(x.due_date) === fmtDate(new Date())).length;
    $('#personal-stats').innerHTML = `
      ${overdue ? `<span class="chip-stat danger">${overdue} overdue</span>` : ''}
      <span class="chip-stat warn">${today} today</span>
      <span class="chip-stat">${items.length} total</span>
    `;
    const list = $('#personal-list');
    if (!items.length) {
      list.innerHTML = '<div class="empty">Nothing on your personal list.</div>';
      return;
    }
    list.innerHTML = items.map(p => `
      <div class="row ${dueClass(p.due_date)} ${p.status === 'done' ? 'done' : ''}" data-personal="${p.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(p.title)}</div>
          <div class="row-meta">
            <span>${escapeHtml(p.category || 'personal')}</span>
            ${p.due_date ? `<span>Due ${fmtDate(p.due_date)}</span>` : ''}
            ${p.priority >= 4 ? `<span class="badge high">P${p.priority}</span>` : ''}
          </div>
          ${p.notes ? `<div class="row-sub">${escapeHtml(p.notes)}</div>` : ''}
        </div>
        <div class="row-actions">
          <button class="primary" data-action="complete-personal" data-id="${p.id}" title="Done">&#10003;</button>
          <button class="danger" data-action="delete-personal" data-id="${p.id}" title="Delete">&times;</button>
        </div>
      </div>
    `).join('');
  }

  // ---------- Workouts ----------
  function renderWorkouts(brief) {
    const items = brief.workouts.today || [];
    const done = items.filter(w => w.completed).length;
    $('#workout-stats').innerHTML = `
      <span class="chip-stat ${done ? 'success' : ''}">${done}/${items.length} done</span>
    `;
    const list = $('#workout-list');
    if (!items.length) {
      list.innerHTML = '<div class="empty">No workout logged today.</div>';
      return;
    }
    list.innerHTML = items.map(w => `
      <div class="row ${w.completed ? 'done' : ''}" data-workout="${w.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(w.title || w.workout_type || 'Workout')}</div>
          <div class="row-meta">
            ${w.workout_type ? `<span>${escapeHtml(w.workout_type)}</span>` : ''}
            ${w.duration_minutes ? `<span>${w.duration_minutes} min</span>` : ''}
            ${w.intensity ? `<span>${escapeHtml(w.intensity)}</span>` : ''}
            ${w.calories_burned ? `<span>${w.calories_burned} kcal</span>` : ''}
          </div>
          ${w.notes ? `<div class="row-sub">${escapeHtml(w.notes)}</div>` : ''}
        </div>
        <div class="row-actions">
          <button class="primary" data-action="complete-workout" data-id="${w.id}" title="Complete">&#10003;</button>
          <button class="danger" data-action="delete-workout" data-id="${w.id}" title="Delete">&times;</button>
        </div>
      </div>
    `).join('');
  }

  // ---------- Meals ----------
  function renderMeals(brief) {
    const items = brief.meals.today || [];
    const t = brief.meals.totals || {};
    $('#meal-stats').innerHTML = `
      <span class="chip-stat">${Math.round(t.calories || 0)} kcal</span>
      <span class="chip-stat info">${Math.round(t.protein_g || 0)}p</span>
      <span class="chip-stat">${Math.round(t.carbs_g || 0)}c</span>
      <span class="chip-stat">${Math.round(t.fat_g || 0)}f</span>
    `;
    const list = $('#meal-list');
    if (!items.length) {
      list.innerHTML = '<div class="empty">No meals planned today.</div>';
      return;
    }
    const label = {
      breakfast: 'Breakfast', snack_morning: 'AM Snack', lunch: 'Lunch',
      snack_afternoon: 'PM Snack', dinner: 'Dinner', snack_evening: 'Evening'
    };
    list.innerHTML = items.map(m => `
      <div class="row ${m.prepped ? 'done' : ''}" data-meal="${m.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(label[m.meal_type] || m.meal_type)} — ${escapeHtml(m.name || '—')}</div>
          <div class="row-meta">
            ${m.calories ? `<span>${m.calories} kcal</span>` : ''}
            ${m.protein_g ? `<span>${m.protein_g}g protein</span>` : ''}
            ${m.carbs_g ? `<span>${m.carbs_g}g carbs</span>` : ''}
            ${m.fat_g ? `<span>${m.fat_g}g fat</span>` : ''}
          </div>
          ${m.prep_notes ? `<div class="row-sub">${escapeHtml(m.prep_notes)}</div>` : ''}
        </div>
        <div class="row-actions">
          <button class="primary" data-action="prep-meal" data-id="${m.id}" title="Prepped">&#10003;</button>
          <button class="danger" data-action="delete-meal" data-id="${m.id}" title="Delete">&times;</button>
        </div>
      </div>
    `).join('');
  }

  // ---------- Marketing ----------
  function renderMarketing(brief) {
    const items = brief.marketing.upcoming || [];
    $('#marketing-stats').innerHTML = `<span class="chip-stat">${items.length} queued</span>`;
    const list = $('#marketing-list');
    if (!items.length) {
      list.innerHTML = '<div class="empty">Nothing scheduled. Tell the agent to make something.</div>';
      return;
    }
    list.innerHTML = items.map(m => `
      <div class="row" data-marketing="${m.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(m.title)}</div>
          <div class="row-meta">
            <span class="badge ${m.status}">${m.status}</span>
            ${m.platform ? `<span>${escapeHtml(m.platform)}</span>` : ''}
            ${m.scheduled_for ? `<span>${fmtTime(m.scheduled_for)}</span>` : ''}
            ${m.listing_address ? `<span>&#127969; ${escapeHtml(m.listing_address)}</span>` : ''}
          </div>
          ${m.content ? `<div class="row-sub">${escapeHtml(m.content.substring(0, 160))}${m.content.length > 160 ? '…' : ''}</div>` : ''}
        </div>
        <div class="row-actions">
          <button data-action="edit-marketing" data-id="${m.id}" title="Edit">&#9998;</button>
          <button class="danger" data-action="delete-marketing" data-id="${m.id}" title="Delete">&times;</button>
        </div>
      </div>
    `).join('');
  }

  // ---------- Custom categories ----------
  function renderCustom(brief) {
    const cats = (brief.categories || []).filter(c => !c.is_builtin);
    const host = $('#custom-sections');
    if (!cats.length) {
      host.innerHTML = '<div class="empty">No custom sections yet. Click "+ New Section" above.</div>';
      return;
    }
    host.innerHTML = cats.map(c => {
      const items = (brief.custom_items[c.slug] || []);
      const rows = items.length
        ? items.map(i => `
            <div class="row ${dueClass(i.due_date)} ${i.status === 'done' ? 'done' : ''}" data-custom-item="${i.id}" data-slug="${c.slug}">
              <div class="row-main">
                <div class="row-title">${escapeHtml(i.title)}</div>
                ${i.details ? `<div class="row-sub">${escapeHtml(i.details)}</div>` : ''}
                ${i.due_date ? `<div class="row-meta"><span>Due ${fmtDate(i.due_date)}</span></div>` : ''}
              </div>
              <div class="row-actions">
                <button class="primary" data-action="complete-custom" data-slug="${c.slug}" data-id="${i.id}">&#10003;</button>
                <button class="danger" data-action="delete-custom" data-slug="${c.slug}" data-id="${i.id}">&times;</button>
              </div>
            </div>`).join('')
        : '<div class="empty">Nothing here yet.</div>';
      return `
        <div class="card" style="box-shadow:none;border:1px solid var(--border);margin-top:0.75rem;padding:1rem">
          <div class="card-header">
            <h2><span class="dot" style="background:${escapeHtml(c.color || '#64748b')}"></span>${escapeHtml(c.name)}</h2>
            <div class="card-stats">
              <button class="btn-secondary" data-action="add-custom-item" data-slug="${c.slug}">+ Add</button>
              <button class="btn-secondary" data-action="manage-category" data-slug="${c.slug}">Settings</button>
            </div>
          </div>
          <div class="list">${rows}</div>
        </div>`;
    }).join('');
  }

  // Expose renderers
  window.DB_RENDER = {
    renderNav, renderTasks, renderEmails, renderCrm, renderCalendar,
    renderClosings, renderPersonal, renderWorkouts, renderMeals,
    renderMarketing, renderCustom, viewTask, submitAgent
  };
})();

/**
 * Global wiring — event delegation, loader, modals. Defined outside the IIFE
 * so the HTML's DOMContentLoaded hook finds it.
 */
async function load() {
  try {
    const brief = await window.DB.api('/api/daily-brief');
    window.DB.state.brief = brief;
    document.getElementById('today-label').textContent =
      new Date(brief.generated_at).toLocaleDateString('en-CA', {
        timeZone: brief.timezone, weekday: 'long', month: 'long', day: 'numeric'
      });
    const R = window.DB_RENDER;
    R.renderTasks(brief);
    R.renderEmails(brief);
    R.renderCrm(brief);
    R.renderCalendar(brief);
    R.renderClosings(brief);
    R.renderPersonal(brief);
    R.renderWorkouts(brief);
    R.renderMeals(brief);
    R.renderMarketing(brief);
    R.renderCustom(brief);
  } catch (e) {
    window.DB.toast('Load failed: ' + e.message, 'error');
  }
}

function initDashboard() {
  window.DB_RENDER.renderNav();
  load();

  // Refresh button
  document.getElementById('refresh-btn').addEventListener('click', load);
  document.getElementById('sync-btn').addEventListener('click', async () => {
    window.DB.toast('Triggering sync…');
    try {
      // This is a hook point. Make.com should expose a scenario trigger URL
      // stored server-side; for now we just reload the data.
      await load();
      window.DB.toast('Refreshed from database', 'success');
    } catch (e) { window.DB.toast(e.message, 'error'); }
  });

  // Agent submit
  document.getElementById('agent-submit').addEventListener('click', window.DB_RENDER.submitAgent);
  document.getElementById('agent-instruction').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') window.DB_RENDER.submitAgent();
  });

  // Voice input + hotkeys are owned by dashboard.voice.js (loaded after this file)

  // CRM filter chips
  document.querySelector('[data-section="crm"] .toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip'); if (!btn) return;
    document.querySelectorAll('[data-section="crm"] .chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    window.DB.state.crmFilter = btn.dataset.filter;
    window.DB_RENDER.renderCrm(window.DB.state.brief);
  });

  // Quick-add handlers
  bindQuickAdds();

  // Delegated click handling
  document.body.addEventListener('click', handleAction);

  // Auto refresh every 2 minutes (safety net)
  setInterval(load, 120000);

  // Live updates via SSE — reload when Make.com pushes or the worker finishes
  setupEventStream();
}

let _sseDebounce = null;
function setupEventStream() {
  try {
    const key = (window.DB_CONFIG && window.DB_CONFIG.apiKey) || '';
    if (!key) return;
    const url = '/api/events/stream?key=' + encodeURIComponent(key);
    const es = new EventSource(url);
    es.addEventListener('sync', (e) => { queueReload(parseSection(e)); });
    es.addEventListener('task', (e) => { queueReload('tasks'); });
    es.addEventListener('error', () => { /* EventSource retries itself */ });
    window._dashboardStream = es;
  } catch (e) { /* no-op: SSE unsupported */ }
}
function parseSection(e) {
  try { return (JSON.parse(e.data) || {}).section; } catch { return null; }
}
function queueReload(sectionHint) {
  if (_sseDebounce) clearTimeout(_sseDebounce);
  _sseDebounce = setTimeout(() => {
    window.DB.toast(sectionHint ? 'Updated: ' + sectionHint : 'Live update');
    if (typeof load === 'function') load();
  }, 500);
}
window.initDashboard = initDashboard;
