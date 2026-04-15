/**
 * Event delegation for all row actions + modals.
 * Exposes bindQuickAdds() and handleAction() used by dashboard.render.js.
 */
(function(){
  'use strict';
  const { api, toast, openModal, closeModal } = window.DB;

  function bindQuickAdds() {
    // Personal tasks quick-add
    document.getElementById('personal-add').addEventListener('click', async () => {
      const title = document.getElementById('personal-input').value.trim();
      if (!title) return;
      const category = document.getElementById('personal-category').value;
      const due = document.getElementById('personal-due').value;
      try {
        await api('/api/personal-tasks', {
          method: 'POST',
          body: JSON.stringify({ title, category, due_date: due || null })
        });
        document.getElementById('personal-input').value = '';
        document.getElementById('personal-due').value = '';
        toast('Added', 'success');
        load();
      } catch (e) { toast(e.message, 'error'); }
    });

    // Workouts quick-add
    document.getElementById('workout-add').addEventListener('click', async () => {
      const title = document.getElementById('workout-title').value.trim();
      const workout_type = document.getElementById('workout-type').value;
      const duration_minutes = parseInt(document.getElementById('workout-duration').value) || null;
      if (!title && !workout_type) return;
      try {
        await api('/api/workouts', {
          method: 'POST',
          body: JSON.stringify({
            workout_date: new Date().toISOString().slice(0,10),
            title, workout_type, duration_minutes
          })
        });
        document.getElementById('workout-title').value = '';
        document.getElementById('workout-duration').value = '';
        toast('Logged', 'success');
        load();
      } catch (e) { toast(e.message, 'error'); }
    });

    // Meals quick-add
    document.getElementById('meal-add').addEventListener('click', async () => {
      const name = document.getElementById('meal-name').value.trim();
      const meal_type = document.getElementById('meal-type').value;
      const calories = parseInt(document.getElementById('meal-calories').value) || null;
      if (!name) return;
      try {
        await api('/api/meals', {
          method: 'POST',
          body: JSON.stringify({
            meal_date: new Date().toISOString().slice(0,10),
            meal_type, name, calories
          })
        });
        document.getElementById('meal-name').value = '';
        document.getElementById('meal-calories').value = '';
        toast('Added', 'success');
        load();
      } catch (e) { toast(e.message, 'error'); }
    });

    // Modal triggers
    document.getElementById('add-closing-btn').addEventListener('click', () => openClosingForm());
    document.getElementById('add-marketing-btn').addEventListener('click', () => openMarketingForm());
    document.getElementById('add-category-btn').addEventListener('click', () => openCategoryForm());
  }
  window.bindQuickAdds = bindQuickAdds;

  // ---------- Delegated row actions ----------
  async function handleAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const slug = btn.dataset.slug;

    try {
      switch (btn.dataset.action) {
        case 'view-task':       return window.DB_RENDER.viewTask(id);

        case 'handle-email':
          await api('/api/emails/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'handled' })});
          toast('Marked handled', 'success'); return load();

        case 'delete-email':
          await api('/api/emails/' + id, { method: 'DELETE' });
          toast('Dismissed'); return load();

        case 'complete-crm':
          await api('/api/follow-ups/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'done' })});
          toast('Follow-up done', 'success'); return load();

        case 'edit-crm':
          return openFollowupForm(id);

        case 'view-fub-person':
          if (window.DB_FUB && window.DB_FUB.openPersonDetail) return window.DB_FUB.openPersonDetail(id);
          return toast('FUB UI not loaded', 'error');

        case 'edit-closing':
          return openClosingForm(id);

        case 'complete-personal':
          await api('/api/personal-tasks/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'done' })});
          toast('Done', 'success'); return load();

        case 'delete-personal':
          await api('/api/personal-tasks/' + id, { method: 'DELETE' });
          toast('Deleted'); return load();

        case 'complete-workout':
          await api('/api/workouts/' + id, { method: 'PATCH', body: JSON.stringify({ completed: true })});
          toast('Crushed it', 'success'); return load();

        case 'delete-workout':
          await api('/api/workouts/' + id, { method: 'DELETE' });
          toast('Deleted'); return load();

        case 'prep-meal':
          await api('/api/meals/' + id, { method: 'PATCH', body: JSON.stringify({ prepped: true })});
          toast('Prepped', 'success'); return load();

        case 'delete-meal':
          await api('/api/meals/' + id, { method: 'DELETE' });
          toast('Deleted'); return load();

        case 'edit-marketing':
          return openMarketingForm(id);

        case 'delete-marketing':
          await api('/api/marketing/' + id, { method: 'DELETE' });
          toast('Deleted'); return load();

        case 'add-custom-item':
          return openCustomItemForm(slug);

        case 'complete-custom':
          await api('/api/categories/' + slug + '/items/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'done' })});
          toast('Done', 'success'); return load();

        case 'delete-custom':
          await api('/api/categories/' + slug + '/items/' + id, { method: 'DELETE' });
          toast('Deleted'); return load();

        case 'manage-category':
          return openCategoryForm(slug);
      }
    } catch (err) {
      toast(err.message || 'Action failed', 'error');
    }
  }
  window.handleAction = handleAction;

  // ---------- Modal forms ----------
  async function openClosingForm(id) {
    let c = { property_address: '', status: 'pending' };
    if (id) {
      const { closings } = await api('/api/closings');
      c = closings.find(x => x.id == id) || c;
    }
    const g = (k, v = '') => c[k] == null ? v : c[k];
    openModal(id ? 'Edit Closing' : 'Add Closing', `
      <div class="form-grid">
        <div class="form-field" style="grid-column:1/-1"><label>Property Address</label>
          <input id="f-address" value="${escapeAttr(g('property_address'))}" required></div>
        <div class="form-field"><label>City</label><input id="f-city" value="${escapeAttr(g('city'))}"></div>
        <div class="form-field"><label>Client Name</label><input id="f-client" value="${escapeAttr(g('client_name'))}"></div>
        <div class="form-field"><label>Side</label>
          <select id="f-side">
            <option value="">—</option>
            <option ${c.transaction_side === 'buy' ? 'selected' : ''}>buy</option>
            <option ${c.transaction_side === 'sell' ? 'selected' : ''}>sell</option>
            <option ${c.transaction_side === 'both' ? 'selected' : ''}>both</option>
          </select></div>
        <div class="form-field"><label>Status</label>
          <select id="f-status">
            ${['pending','firm','closed','cancelled'].map(s => `<option ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></div>
        <div class="form-field"><label>Sale Price</label><input id="f-sale" type="number" step="0.01" value="${g('sale_price','')}"></div>
        <div class="form-field"><label>Commission %</label><input id="f-rate" type="number" step="0.01" value="${g('commission_rate','')}"></div>
        <div class="form-field"><label>Brokerage Split</label><input id="f-split" type="number" step="0.01" value="${g('brokerage_split','')}"></div>
        <div class="form-field"><label>Referral Fees</label><input id="f-ref" type="number" step="0.01" value="${g('referral_fees','0')}"></div>
        <div class="form-field"><label>Marketing Spend</label><input id="f-mkt" type="number" step="0.01" value="${g('marketing_expense','0')}"></div>
        <div class="form-field"><label>Other Expenses</label><input id="f-other" type="number" step="0.01" value="${g('other_expenses','0')}"></div>
        <div class="form-field"><label>Offer Date</label><input id="f-offer" type="date" value="${g('offer_date','') ? g('offer_date').slice(0,10) : ''}"></div>
        <div class="form-field"><label>Firm Date</label><input id="f-firm" type="date" value="${g('firm_date','') ? g('firm_date').slice(0,10) : ''}"></div>
        <div class="form-field"><label>Closing Date</label><input id="f-close" type="date" value="${g('closing_date','') ? g('closing_date').slice(0,10) : ''}"></div>
        <div class="form-field" style="grid-column:1/-1"><label>Notes</label>
          <textarea id="f-notes" rows="3">${escapeAttr(g('notes'))}</textarea></div>
      </div>
    `, `
      ${id ? '<button class="btn-danger" id="del-closing">Delete</button>' : ''}
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="save-closing">${id ? 'Update' : 'Create'}</button>
    `);
    if (id) {
      document.getElementById('del-closing').onclick = async () => {
        if (!confirm('Delete this closing?')) return;
        await api('/api/closings/' + id, { method: 'DELETE' });
        toast('Deleted'); closeModal(); load();
      };
    }
    document.getElementById('save-closing').onclick = async () => {
      const body = {
        property_address: document.getElementById('f-address').value.trim(),
        city: document.getElementById('f-city').value.trim() || null,
        client_name: document.getElementById('f-client').value.trim() || null,
        transaction_side: document.getElementById('f-side').value || null,
        status: document.getElementById('f-status').value,
        sale_price: parseFloat(document.getElementById('f-sale').value) || null,
        commission_rate: parseFloat(document.getElementById('f-rate').value) || null,
        brokerage_split: parseFloat(document.getElementById('f-split').value) || null,
        referral_fees: parseFloat(document.getElementById('f-ref').value) || 0,
        marketing_expense: parseFloat(document.getElementById('f-mkt').value) || 0,
        other_expenses: parseFloat(document.getElementById('f-other').value) || 0,
        offer_date: document.getElementById('f-offer').value || null,
        firm_date: document.getElementById('f-firm').value || null,
        closing_date: document.getElementById('f-close').value || null,
        notes: document.getElementById('f-notes').value.trim() || null
      };
      if (!body.property_address) return toast('Address required', 'error');
      try {
        await api('/api/closings' + (id ? '/' + id : ''), {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(body)
        });
        toast('Saved', 'success'); closeModal(); load();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  async function openMarketingForm(id) {
    let m = { status: 'draft' };
    if (id) {
      const { items } = await api('/api/marketing');
      m = items.find(x => x.id == id) || m;
    }
    const g = (k, v = '') => m[k] == null ? v : m[k];
    openModal(id ? 'Edit Marketing' : 'Schedule Marketing', `
      <div class="form-grid">
        <div class="form-field" style="grid-column:1/-1"><label>Title</label>
          <input id="mk-title" value="${escapeAttr(g('title'))}"></div>
        <div class="form-field"><label>Platform</label>
          <select id="mk-platform">
            ${['','instagram','facebook','tiktok','linkedin','youtube','email','google','print']
              .map(p => `<option ${m.platform === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select></div>
        <div class="form-field"><label>Type</label>
          <select id="mk-type">
            ${['','post','reel','story','ad','email_blast','newsletter','video','open_house']
              .map(p => `<option ${m.campaign_type === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select></div>
        <div class="form-field"><label>Status</label>
          <select id="mk-status">
            ${['draft','scheduled','posted','paused','archived']
              .map(s => `<option ${m.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></div>
        <div class="form-field"><label>Scheduled For</label>
          <input id="mk-sched" type="datetime-local" value="${m.scheduled_for ? new Date(m.scheduled_for).toISOString().slice(0,16) : ''}"></div>
        <div class="form-field" style="grid-column:1/-1"><label>Content</label>
          <textarea id="mk-content" rows="5">${escapeAttr(g('content'))}</textarea></div>
      </div>
    `, `
      ${id ? '<button class="btn-danger" id="del-mk">Delete</button>' : ''}
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="save-mk">${id ? 'Update' : 'Create'}</button>
    `);
    if (id) {
      document.getElementById('del-mk').onclick = async () => {
        if (!confirm('Delete?')) return;
        await api('/api/marketing/' + id, { method: 'DELETE' });
        toast('Deleted'); closeModal(); load();
      };
    }
    document.getElementById('save-mk').onclick = async () => {
      const sched = document.getElementById('mk-sched').value;
      const body = {
        title: document.getElementById('mk-title').value.trim(),
        platform: document.getElementById('mk-platform').value || null,
        campaign_type: document.getElementById('mk-type').value || null,
        status: document.getElementById('mk-status').value,
        scheduled_for: sched ? new Date(sched).toISOString() : null,
        content: document.getElementById('mk-content').value.trim() || null
      };
      if (!body.title) return toast('Title required', 'error');
      try {
        await api('/api/marketing' + (id ? '/' + id : ''), {
          method: id ? 'PATCH' : 'POST', body: JSON.stringify(body)
        });
        toast('Saved', 'success'); closeModal(); load();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  async function openFollowupForm(id) {
    const { followups } = await api('/api/follow-ups');
    const c = followups.find(x => x.id == id);
    if (!c) return toast('Not found', 'error');
    const g = (k, v = '') => c[k] == null ? v : c[k];
    openModal('Edit Follow-up', `
      <div class="form-grid">
        <div class="form-field" style="grid-column:1/-1"><label>Contact</label>
          <input id="fu-name" value="${escapeAttr(g('contact_name'))}"></div>
        <div class="form-field"><label>Email</label><input id="fu-email" value="${escapeAttr(g('contact_email'))}"></div>
        <div class="form-field"><label>Phone</label><input id="fu-phone" value="${escapeAttr(g('contact_phone'))}"></div>
        <div class="form-field"><label>Stage</label><input id="fu-stage" value="${escapeAttr(g('stage'))}"></div>
        <div class="form-field"><label>Type</label><input id="fu-type" value="${escapeAttr(g('follow_up_type'))}"></div>
        <div class="form-field"><label>Due Date</label><input id="fu-due" type="date" value="${g('due_date','') ? g('due_date').slice(0,10) : ''}"></div>
        <div class="form-field"><label>Status</label>
          <select id="fu-status">
            ${['open','snoozed','done'].map(s => `<option ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></div>
        <div class="form-field" style="grid-column:1/-1"><label>Notes</label>
          <textarea id="fu-notes" rows="4">${escapeAttr(g('notes'))}</textarea></div>
      </div>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="save-fu">Update</button>
    `);
    document.getElementById('save-fu').onclick = async () => {
      const body = {
        stage: document.getElementById('fu-stage').value.trim() || null,
        follow_up_type: document.getElementById('fu-type').value.trim() || null,
        due_date: document.getElementById('fu-due').value || null,
        status: document.getElementById('fu-status').value,
        notes: document.getElementById('fu-notes').value.trim() || null
      };
      try {
        await api('/api/follow-ups/' + id, { method: 'PATCH', body: JSON.stringify(body) });
        toast('Saved', 'success'); closeModal(); load();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  async function openCategoryForm(slug) {
    let c = { name: '', icon: 'star', color: '#64748b', sort_order: 100, is_builtin: false };
    if (slug) {
      const { categories } = await api('/api/categories');
      c = categories.find(x => x.slug === slug) || c;
    }
    const g = (k, v = '') => c[k] == null ? v : c[k];
    openModal(slug ? 'Edit Section' : 'New Section', `
      <div class="form-grid">
        <div class="form-field" style="grid-column:1/-1"><label>Name</label>
          <input id="ct-name" value="${escapeAttr(g('name'))}"></div>
        <div class="form-field"><label>Color</label><input id="ct-color" type="color" value="${escapeAttr(g('color','#64748b'))}"></div>
        <div class="form-field"><label>Icon</label><input id="ct-icon" value="${escapeAttr(g('icon','star'))}"></div>
        <div class="form-field"><label>Sort Order</label><input id="ct-sort" type="number" value="${g('sort_order', 100)}"></div>
        <div class="form-field"><label>Enabled</label>
          <select id="ct-enabled">
            <option value="true" ${c.enabled !== false ? 'selected' : ''}>Yes</option>
            <option value="false" ${c.enabled === false ? 'selected' : ''}>No</option>
          </select></div>
      </div>
    `, `
      ${slug && !c.is_builtin ? '<button class="btn-danger" id="del-ct">Delete</button>' : ''}
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="save-ct">${slug ? 'Update' : 'Create'}</button>
    `);
    if (slug && !c.is_builtin) {
      document.getElementById('del-ct').onclick = async () => {
        if (!confirm('Delete this section and all its items?')) return;
        await api('/api/categories/' + slug, { method: 'DELETE' });
        toast('Deleted'); closeModal(); load();
      };
    }
    document.getElementById('save-ct').onclick = async () => {
      const body = {
        name: document.getElementById('ct-name').value.trim(),
        color: document.getElementById('ct-color').value,
        icon: document.getElementById('ct-icon').value.trim(),
        sort_order: parseInt(document.getElementById('ct-sort').value) || 100,
        enabled: document.getElementById('ct-enabled').value === 'true'
      };
      if (!body.name) return toast('Name required', 'error');
      try {
        if (slug) {
          await api('/api/categories/' + slug, { method: 'PATCH', body: JSON.stringify(body) });
        } else {
          await api('/api/categories', { method: 'POST', body: JSON.stringify(body) });
        }
        toast('Saved', 'success'); closeModal(); load();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  async function openCustomItemForm(slug) {
    openModal('Add to ' + slug, `
      <div class="form-field"><label>Title</label><input id="ci-title"></div>
      <div class="form-field"><label>Details</label><textarea id="ci-details" rows="3"></textarea></div>
      <div class="form-field"><label>Due Date</label><input id="ci-due" type="date"></div>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="save-ci">Add</button>
    `);
    document.getElementById('save-ci').onclick = async () => {
      const body = {
        title: document.getElementById('ci-title').value.trim(),
        details: document.getElementById('ci-details').value.trim() || null,
        due_date: document.getElementById('ci-due').value || null
      };
      if (!body.title) return toast('Title required', 'error');
      try {
        await api('/api/categories/' + slug + '/items', {
          method: 'POST', body: JSON.stringify(body)
        });
        toast('Added', 'success'); closeModal(); load();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }
})();
