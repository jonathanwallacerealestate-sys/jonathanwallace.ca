/**
 * Seller Forms + Letters of Opinion (LOO) dashboard section.
 * Pulls from /api/seller-form and /api/letters, renders cards, and wires
 * the one-click "Convert to LOO" action.
 */
(function(){
  'use strict';
  const { $, $$, escapeHtml, fmtDate, fmtMoney } = window.DB_UTIL;
  const { api, toast, openModal, closeModal } = window.DB;

  // Re-render on each dashboard load cycle
  document.addEventListener('DOMContentLoaded', () => {
    hookIntoLoadCycle();
    const addBtn = document.getElementById('add-letter-btn');
    if (addBtn) addBtn.addEventListener('click', () => openLetterForm());
    document.body.addEventListener('click', handleClick);
  });

  function hookIntoLoadCycle() {
    const orig = window.load;
    if (typeof orig !== 'function') { setTimeout(render, 1000); return; }
    window.load = async function() {
      await orig.apply(this, arguments);
      await render();
    };
  }

  async function render() {
    await Promise.all([renderSellerForms(), renderLetters()]);
  }

  // ---------- Seller Forms ----------
  async function renderSellerForms() {
    const host = document.getElementById('seller-form-list');
    const stats = document.getElementById('seller-form-stats');
    if (!host) return;
    try {
      const { forms } = await api('/api/seller-form');
      if (stats) {
        const bySt = forms.reduce((a, f) => { a[f.status || 'draft'] = (a[f.status || 'draft'] || 0) + 1; return a; }, {});
        stats.innerHTML = `
          <span class="chip-stat">${forms.length} total</span>
          ${bySt.submitted ? `<span class="chip-stat info">${bySt.submitted} submitted</span>` : ''}
          ${bySt.draft ? `<span class="chip-stat warn">${bySt.draft} draft</span>` : ''}
        `;
      }
      if (!forms.length) {
        host.innerHTML = '<div class="empty">No seller forms yet. Submissions from the website will appear here.</div>';
        return;
      }
      host.innerHTML = forms.slice(0, 20).map(f => `
        <div class="row" data-seller-form="${f.id}">
          <div class="row-main">
            <div class="row-title">${escapeHtml(f.property_address || '(no address)')}${f.city ? ', ' + escapeHtml(f.city) : ''}</div>
            <div class="row-meta">
              <span class="badge ${f.status}">${escapeHtml(f.status || 'draft')}</span>
              ${f.owner_name ? `<span>${escapeHtml(f.owner_name)}</span>` : ''}
              ${f.email ? `<span>${escapeHtml(f.email)}</span>` : ''}
              <span>${fmtDate(f.updated_at)}</span>
            </div>
          </div>
          <div class="row-actions">
            <button data-action="view-seller-form" data-id="${f.id}" data-session="${escapeHtml(f.session_id)}" title="View">View</button>
            <button class="primary" data-action="convert-to-loo" data-id="${f.id}" title="Generate LOO">+ LOO</button>
          </div>
        </div>
      `).join('');
    } catch (e) {
      host.innerHTML = '<div class="empty">Could not load seller forms: ' + escapeHtml(e.message) + '</div>';
    }
  }

  async function viewSellerForm(id, session) {
    try {
      const { form } = await api('/api/seller-form/' + encodeURIComponent(session));
      const f = form;
      const field = (label, value) => value ? `<tr><th style="text-align:left;padding:4px 8px 4px 0;color:var(--muted);font-weight:500;white-space:nowrap;vertical-align:top">${label}</th><td style="padding:4px 0">${escapeHtml(String(value))}</td></tr>` : '';
      openModal('Seller Form — ' + (f.property_address || ''), `
        <table style="width:100%;font-size:0.9rem;line-height:1.5">
          ${field('Owner', f.owner_name)}
          ${field('Email', f.email)}
          ${field('Phone', f.phone)}
          ${field('Address', f.property_address)}
          ${field('City', f.city)}
          ${field('Postal', f.postal_code)}
          ${field('Type', f.property_type)}
          ${field('Bedrooms', f.bedrooms)}
          ${field('Bathrooms', f.bathrooms)}
          ${field('Sq Ft', f.square_footage)}
          ${field('Lot', f.lot_size)}
          ${field('Year Built', f.year_built)}
          ${field('Condition', f.condition_rating)}
          ${field('Timeline', f.timeline)}
          ${field('Price Expectation', f.price_expectation)}
          ${field('Upgrades', f.upgrades)}
          ${field('Additional Notes', f.additional_notes)}
        </table>
      `, `
        <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
        <button class="btn-primary" id="modal-convert-loo">Generate LOO</button>
      `);
      document.getElementById('modal-convert-loo').onclick = () => {
        closeModal();
        convertToLoo(id);
      };
    } catch (e) { toast(e.message, 'error'); }
  }

  async function convertToLoo(sellerFormId) {
    toast('Drafting LOO…');
    try {
      const data = await api('/api/letters/generate-from-seller-form/' + sellerFormId, { method: 'POST', body: '{}' });
      toast('LOO draft ready', 'success');
      openLetterForm(data.letter.id);
      if (typeof window.load === 'function') window.load();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------- Letters of Opinion ----------
  async function renderLetters() {
    const host = document.getElementById('letter-list');
    if (!host) return;
    try {
      const { letters } = await api('/api/letters');
      if (!letters.length) {
        host.innerHTML = '<div class="empty">No Letters of Opinion yet. Create one from a seller form above or click "+ New LOO".</div>';
        return;
      }
      host.innerHTML = letters.slice(0, 15).map(l => {
        const value = l.opinion_mid ? fmtMoney(l.opinion_mid)
                    : (l.opinion_low && l.opinion_high) ? `${fmtMoney(l.opinion_low)}–${fmtMoney(l.opinion_high)}`
                    : '—';
        return `
          <div class="row" data-letter="${l.id}">
            <div class="row-main">
              <div class="row-title">${escapeHtml(l.property_address)}${l.city ? ', ' + escapeHtml(l.city) : ''}</div>
              <div class="row-meta">
                <span class="badge ${l.status}">${escapeHtml(l.status)}</span>
                ${l.client_name ? `<span>${escapeHtml(l.client_name)}</span>` : ''}
                <span>${fmtDate(l.prepared_date)}</span>
                <span>Value: <strong>${value}</strong></span>
              </div>
            </div>
            <div class="row-actions">
              <button data-action="edit-letter" data-id="${l.id}">Edit</button>
              <button class="primary" data-action="print-letter" data-id="${l.id}">Print</button>
              <button class="danger" data-action="delete-letter" data-id="${l.id}">&times;</button>
            </div>
          </div>`;
      }).join('');
    } catch (e) {
      host.innerHTML = '<div class="empty">Could not load letters: ' + escapeHtml(e.message) + '</div>';
    }
  }

  async function openLetterForm(id) {
    let l = { status: 'draft' };
    if (id) {
      const { letters } = await api('/api/letters');
      l = letters.find(x => x.id == id) || l;
    }
    const g = (k, v = '') => l[k] == null ? v : l[k];

    openModal(id ? 'Edit Letter of Opinion' : 'New Letter of Opinion', `
      <div class="form-grid">
        <div class="form-field" style="grid-column:1/-1"><label>Property Address *</label>
          <input id="loo-address" value="${escAttr(g('property_address'))}"></div>
        <div class="form-field"><label>City</label><input id="loo-city" value="${escAttr(g('city'))}"></div>
        <div class="form-field"><label>Postal</label><input id="loo-postal" value="${escAttr(g('postal_code'))}"></div>
        <div class="form-field"><label>Client Name</label><input id="loo-client" value="${escAttr(g('client_name'))}"></div>
        <div class="form-field"><label>Client Email</label><input id="loo-email" type="email" value="${escAttr(g('client_email'))}"></div>
        <div class="form-field"><label>Prepared For</label><input id="loo-prep" value="${escAttr(g('prepared_for'))}"></div>
        <div class="form-field"><label>Prepared Date</label><input id="loo-date" type="date" value="${g('prepared_date','') ? g('prepared_date').slice(0,10) : new Date().toISOString().slice(0,10)}"></div>
        <div class="form-field"><label>Property Type</label><input id="loo-ptype" value="${escAttr(g('property_type'))}"></div>
        <div class="form-field"><label>Bedrooms</label><input id="loo-bed" type="number" value="${g('bedrooms','')}"></div>
        <div class="form-field"><label>Bathrooms</label><input id="loo-bath" type="number" step="0.5" value="${g('bathrooms','')}"></div>
        <div class="form-field"><label>Sq Ft</label><input id="loo-sqft" type="number" value="${g('square_footage','')}"></div>
        <div class="form-field"><label>Lot Size</label><input id="loo-lot" value="${escAttr(g('lot_size'))}"></div>
        <div class="form-field"><label>Year Built</label><input id="loo-year" type="number" value="${g('year_built','')}"></div>
        <div class="form-field"><label>Opinion — Low</label><input id="loo-low" type="number" step="0.01" value="${g('opinion_low','')}"></div>
        <div class="form-field"><label>Opinion — Mid</label><input id="loo-mid" type="number" step="0.01" value="${g('opinion_mid','')}"></div>
        <div class="form-field"><label>Opinion — High</label><input id="loo-high" type="number" step="0.01" value="${g('opinion_high','')}"></div>
        <div class="form-field"><label>Status</label>
          <select id="loo-status">
            ${['draft','final','delivered','archived'].map(s => `<option ${l.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></div>
        <div class="form-field" style="grid-column:1/-1"><label>Rationale / Notes</label>
          <textarea id="loo-rationale" rows="2">${escAttr(g('rationale'))}</textarea></div>
        <div class="form-field" style="grid-column:1/-1">
          <label style="display:flex;justify-content:space-between;align-items:center">
            <span>Letter Body</span>
            <button type="button" class="btn-secondary" id="loo-gen" style="padding:0.3rem 0.7rem;font-size:0.75rem">${id ? 'Regenerate with Claude' : 'Generate with Claude'}</button>
          </label>
          <textarea id="loo-body" rows="12" style="font-family:Georgia, 'Times New Roman', serif;font-size:0.9rem">${escAttr(g('letter_body'))}</textarea>
        </div>
      </div>
    `, `
      ${id ? '<button class="btn-danger" id="loo-del">Delete</button>' : ''}
      ${id ? '<button class="btn-secondary" id="loo-print">Print / PDF</button>' : ''}
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="loo-save">${id ? 'Update' : 'Create'}</button>
    `);

    if (id) {
      document.getElementById('loo-del').onclick = async () => {
        if (!confirm('Delete this letter?')) return;
        await api('/api/letters/' + id, { method: 'DELETE' });
        toast('Deleted'); closeModal();
        if (typeof window.load === 'function') window.load();
      };
      document.getElementById('loo-print').onclick = () => {
        const key = (window.DB_CONFIG && window.DB_CONFIG.apiKey) || '';
        window.open('/api/letters/' + id + '/print?key=' + encodeURIComponent(key), '_blank');
      };
    }

    document.getElementById('loo-gen').onclick = async () => {
      const btn = document.getElementById('loo-gen');
      btn.disabled = true; btn.textContent = 'Drafting…';
      try {
        let letterId = id;
        if (!letterId) {
          // Save first to create a row, then generate
          const saved = await saveLetterFromForm(null);
          if (!saved) { btn.disabled = false; btn.textContent = 'Generate with Claude'; return; }
          letterId = saved.id;
        }
        const res = await api('/api/letters/' + letterId + '/generate-body', { method: 'POST', body: '{}' });
        document.getElementById('loo-body').value = res.letter.letter_body || '';
        toast('Letter body generated', 'success');
        if (typeof window.load === 'function') window.load();
      } catch (e) { toast(e.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = 'Regenerate with Claude'; }
    };

    document.getElementById('loo-save').onclick = async () => {
      const saved = await saveLetterFromForm(id);
      if (saved) { toast('Saved', 'success'); closeModal(); if (typeof window.load === 'function') window.load(); }
    };
  }

  async function saveLetterFromForm(id) {
    const body = {
      property_address: document.getElementById('loo-address').value.trim(),
      city: v('loo-city'), postal_code: v('loo-postal'),
      client_name: v('loo-client'), client_email: v('loo-email'),
      prepared_for: v('loo-prep'),
      prepared_date: document.getElementById('loo-date').value || null,
      property_type: v('loo-ptype'),
      bedrooms: num('loo-bed'), bathrooms: num('loo-bath'),
      square_footage: num('loo-sqft'), lot_size: v('loo-lot'),
      year_built: num('loo-year'),
      opinion_low: num('loo-low'), opinion_mid: num('loo-mid'), opinion_high: num('loo-high'),
      rationale: v('loo-rationale'),
      letter_body: document.getElementById('loo-body').value || null,
      status: document.getElementById('loo-status').value
    };
    if (!body.property_address) { toast('Address required', 'error'); return null; }
    try {
      const res = await api('/api/letters' + (id ? '/' + id : ''), {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(body)
      });
      return res.letter;
    } catch (e) {
      toast(e.message, 'error');
      return null;
    }
  }

  async function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const session = btn.dataset.session;
    try {
      switch (btn.dataset.action) {
        case 'view-seller-form': return viewSellerForm(id, session);
        case 'convert-to-loo':   return convertToLoo(id);
        case 'edit-letter':      return openLetterForm(id);
        case 'print-letter': {
          const key = (window.DB_CONFIG && window.DB_CONFIG.apiKey) || '';
          return window.open('/api/letters/' + id + '/print?key=' + encodeURIComponent(key), '_blank');
        }
        case 'delete-letter':
          if (!confirm('Delete this letter?')) return;
          await api('/api/letters/' + id, { method: 'DELETE' });
          toast('Deleted');
          if (typeof window.load === 'function') window.load();
          return;
      }
    } catch (err) { toast(err.message, 'error'); }
  }

  function v(id) { const el = document.getElementById(id); return el && el.value.trim() ? el.value.trim() : null; }
  function num(id) { const el = document.getElementById(id); const n = el && el.value !== '' ? Number(el.value) : null; return Number.isFinite(n) ? n : null; }
  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }
})();
