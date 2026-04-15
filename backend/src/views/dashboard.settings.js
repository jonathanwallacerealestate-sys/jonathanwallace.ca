/**
 * Settings drawer — lets Jonathan edit every piece of runtime configuration
 * (webhook URLs, timezone, nutrition targets, greeting) from the browser.
 * Everything is stored in Postgres via /api/settings and survives deploys.
 */
(function(){
  'use strict';

  // Wait until DOMContentLoaded so the top bar exists
  document.addEventListener('DOMContentLoaded', () => {
    injectSettingsButton();
  });

  function injectSettingsButton() {
    const actions = document.querySelector('.topbar-actions');
    if (!actions || document.getElementById('settings-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'settings-btn';
    btn.className = 'icon-btn';
    btn.title = 'Settings';
    btn.innerHTML = '&#9881;';
    btn.addEventListener('click', openSettingsDrawer);
    actions.insertBefore(btn, actions.firstChild);
  }

  async function openSettingsDrawer() {
    const { openModal, closeModal, api, toast } = window.DB;
    try {
      const { settings } = await api('/api/settings');

      const field = (key, label, type = 'text', placeholder = '') => {
        const v = settings[key] ? settings[key].value : null;
        const val = v == null ? '' : (typeof v === 'string' ? v : JSON.stringify(v));
        const help = settings[key] && settings[key].description ? settings[key].description : '';
        return `
          <div class="form-field">
            <label>${label}</label>
            <input data-setting="${key}" type="${type}" placeholder="${placeholder}" value="${escapeAttr(val)}" />
            ${help ? `<div style="font-size:0.7rem;color:var(--muted);margin-top:0.25rem">${escapeAttr(help)}</div>` : ''}
          </div>`;
      };

      const html = `
        <h3 style="margin:0.5rem 0 0.75rem;font-size:0.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">
          Integrations
        </h3>
        <div class="form-grid">
          ${field('make_webhook_agent', 'Make.com — Agent Output Webhook', 'url', 'https://hook.make.com/...')}
          ${field('make_webhook_marketing', 'Make.com — Marketing Publisher', 'url', 'https://hook.make.com/...')}
          ${field('make_webhook_crm', 'Make.com — Write back to FUB', 'url', 'https://hook.make.com/...')}
        </div>

        <h3 style="margin:1.25rem 0 0.75rem;font-size:0.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">
          Follow Up Boss
        </h3>
        <div class="form-grid">
          <div class="form-field" style="grid-column:1/-1">
            <label>FUB API Key <span style="color:var(--muted);font-weight:400;font-size:0.75rem">(FUB → Admin → API → Create API Key)</span></label>
            <input data-setting="fub_api_key" type="password" placeholder="fka_..." value="${escapeAttr(strVal(settings.fub_api_key))}" autocomplete="off" />
            <div style="font-size:0.72rem;color:var(--muted);margin-top:0.25rem">
              Overridden by <code>FUB_API_KEY</code> env var if set in Railway (preferred for production).
            </div>
          </div>
          <div class="form-field" style="grid-column:1/-1">
            <div style="display:flex;gap:0.5rem;align-items:center;padding:0.6rem 0.8rem;background:#f9fafb;border:1px solid var(--border);border-radius:8px">
              <span id="fub-status-label" style="font-size:0.85rem;color:var(--muted);flex:1">Check connection status…</span>
              <button type="button" class="btn-secondary" id="fub-test-btn" style="padding:0.4rem 0.8rem;font-size:0.8rem">Test Connection</button>
              <button type="button" class="btn-secondary" id="fub-sync-btn" style="padding:0.4rem 0.8rem;font-size:0.8rem">Sync Now</button>
            </div>
          </div>
        </div>

        <h3 style="margin:1.25rem 0 0.75rem;font-size:0.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">
          Daily Targets
        </h3>
        <div class="form-grid">
          ${field('daily_goal_calories', 'Calories / day', 'number')}
          ${field('daily_goal_protein', 'Protein / day (g)', 'number')}
          ${field('workout_week_target', 'Workouts / week', 'number')}
          ${field('timezone', 'Timezone (IANA)', 'text', 'America/Toronto')}
        </div>

        <h3 style="margin:1.25rem 0 0.75rem;font-size:0.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">
          Personalization
        </h3>
        <div class="form-grid">
          <div class="form-field" style="grid-column:1/-1">
            <label>Dashboard Greeting</label>
            <input data-setting="dashboard_greeting" type="text" value="${escapeAttr(strVal(settings.dashboard_greeting))}" />
          </div>
        </div>

        <h3 style="margin:1.25rem 0 0.75rem;font-size:0.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">
          Agent Intuition
        </h3>
        <div style="display:flex;gap:0.5rem;align-items:center;padding:0.75rem 1rem;background:#f9fafb;border:1px solid var(--border);border-radius:8px">
          <span style="font-size:0.85rem;color:var(--muted);flex:1">Vocabulary, abbreviations, and long-term memory Claude uses for every request.</span>
          <button class="btn-secondary" onclick="window.DB_INTUITION && window.DB_INTUITION.openManager()">Manage</button>
        </div>

        <h3 style="margin:1.25rem 0 0.75rem;font-size:0.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">
          Scheduled Jobs
        </h3>
        <div style="display:flex;gap:0.5rem;align-items:center;padding:0.75rem 1rem;background:#f9fafb;border:1px solid var(--border);border-radius:8px">
          <span style="font-size:0.85rem;color:var(--muted);flex:1">Recurring briefings, weekly reviews, gap analyses, agent tasks, and Chrome workflow reminders.</span>
          <button class="btn-secondary" onclick="window.DB_SCHED && window.DB_SCHED.openManager()">Manage</button>
        </div>

        <h3 style="margin:1.25rem 0 0.75rem;font-size:0.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">
          Nurture Templates
        </h3>
        <div style="display:flex;gap:0.5rem;align-items:center;padding:0.75rem 1rem;background:#f9fafb;border:1px solid var(--border);border-radius:8px">
          <span style="font-size:0.85rem;color:var(--muted);flex:1">Reusable message bodies. Used in Contacts → Bulk action. Claude personalizes per contact.</span>
          <button class="btn-secondary" onclick="window.DB_TEMPLATES && window.DB_TEMPLATES.openManager()">Manage</button>
        </div>

        <h3 style="margin:1.25rem 0 0.75rem;font-size:0.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">
          Claude Chrome Workflows
        </h3>
        <div style="display:flex;gap:0.5rem;align-items:center;padding:0.75rem 1rem;background:#f9fafb;border:1px solid var(--border);border-radius:8px">
          <span style="font-size:0.85rem;color:var(--muted);flex:1">Saved browser workflows + encrypted credentials for sites without APIs.</span>
          <button class="btn-secondary" onclick="window.DB_CHROME && window.DB_CHROME.openManager()">Manage</button>
        </div>

        <h3 style="margin:1.25rem 0 0.75rem;font-size:0.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">
          Hotkeys
        </h3>
        <div style="font-size:0.85rem;color:var(--text);line-height:1.8;background:#f9fafb;padding:0.75rem 1rem;border-radius:8px;border:1px solid var(--border)">
          <div><kbd style="background:#fff;border:1px solid var(--border);padding:2px 6px;border-radius:4px;font-family:inherit;font-size:0.75rem">F5</kbd> tap — focus agent input + start voice recording</div>
          <div><kbd style="background:#fff;border:1px solid var(--border);padding:2px 6px;border-radius:4px;font-family:inherit;font-size:0.75rem">F5</kbd> hold — push-to-talk; release to auto-send. Claude speaks back.</div>
          <div><kbd style="background:#fff;border:1px solid var(--border);padding:2px 6px;border-radius:4px;font-family:inherit;font-size:0.75rem">F6</kbd> — Brief Me (morning briefing)</div>
          <div><kbd style="background:#fff;border:1px solid var(--border);padding:2px 6px;border-radius:4px;font-family:inherit;font-size:0.75rem">Esc</kbd> — stop recording, stop speaking, close modal</div>
        </div>

        <h3 style="margin:1.25rem 0 0.75rem;font-size:0.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">
          Device
        </h3>
        <div class="form-grid">
          <div class="form-field" style="grid-column:1/-1">
            <label>Signed-in on this device</label>
            <div style="display:flex;gap:0.5rem;align-items:center">
              <span style="font-size:0.85rem;color:var(--muted);flex:1">API key is stored in this browser's local storage.</span>
              <button class="btn-secondary" id="sign-out-btn">Sign Out</button>
            </div>
          </div>
        </div>
      `;

      openModal('Settings', html, `
        <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
        <button class="btn-primary" id="save-settings-btn">Save All</button>
      `);

      document.getElementById('save-settings-btn').onclick = async () => {
        const inputs = document.querySelectorAll('[data-setting]');
        const payload = {};
        inputs.forEach(el => {
          const key = el.dataset.setting;
          let value = el.value;
          if (el.type === 'number') value = value === '' ? null : Number(value);
          else if (value === '') value = null;
          payload[key] = value;
        });
        try {
          await api('/api/settings/bulk', { method: 'POST', body: JSON.stringify({ settings: payload }) });
          toast('Settings saved', 'success');
          closeModal();
        } catch (e) { toast(e.message, 'error'); }
      };

      document.getElementById('sign-out-btn').onclick = () => {
        try { localStorage.removeItem('jw_api_key'); } catch(e) {}
        location.replace('/dashboard');
      };

      // ---- FUB connection status + test + sync buttons ----
      async function updateFubStatus() {
        const label = document.getElementById('fub-status-label');
        if (!label) return;
        label.textContent = 'Checking…';
        try {
          const s = await api('/api/fub/status');
          if (!s.configured) { label.innerHTML = '<span style="color:#f59e0b">Not configured</span> — paste your FUB API key above and click Save All'; return; }
          if (!s.connected)  { label.innerHTML = '<span style="color:#ef4444">Configured but connection failed.</span> ' + (s.error ? ('(' + escapeAttr(s.error.slice(0,120)) + ')') : ''); return; }
          label.innerHTML = '<span style="color:#10b981">Connected</span>' + (s.whoami?.name ? (' as ' + escapeAttr(s.whoami.name)) : '');
        } catch (e) {
          label.innerHTML = '<span style="color:#ef4444">Error:</span> ' + escapeAttr(e.message);
        }
      }
      updateFubStatus();

      const testBtn = document.getElementById('fub-test-btn');
      if (testBtn) testBtn.onclick = async () => {
        testBtn.disabled = true; testBtn.textContent = 'Testing…';
        try { await api('/api/fub/test', { method: 'POST', body: '{}' }); toast('FUB connected', 'success'); await updateFubStatus(); }
        catch (e) { toast(e.message, 'error'); }
        finally { testBtn.disabled = false; testBtn.textContent = 'Test Connection'; }
      };

      const syncBtn = document.getElementById('fub-sync-btn');
      if (syncBtn) syncBtn.onclick = async () => {
        syncBtn.disabled = true; syncBtn.textContent = 'Syncing…';
        try {
          const r = await api('/api/fub/sync', { method: 'POST', body: '{}' });
          toast('Synced ' + (r.upserted || 0) + ' tasks from FUB', 'success');
          if (typeof window.load === 'function') window.load();
        } catch (e) { toast(e.message, 'error'); }
        finally { syncBtn.disabled = false; syncBtn.textContent = 'Sync Now'; }
      };
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function strVal(s) { if (!s || s.value == null) return ''; return typeof s.value === 'string' ? s.value : JSON.stringify(s.value); }
  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }
})();
