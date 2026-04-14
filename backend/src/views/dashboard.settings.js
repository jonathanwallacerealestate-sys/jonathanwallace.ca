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
