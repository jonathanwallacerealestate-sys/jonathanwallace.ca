/**
 * Agent Dashboard — client
 * Pulls /api/daily-brief on load, renders each section, and wires up
 * inline add/edit/delete actions for every category.
 */
(function(){
  'use strict';

  const KEY = (window.DB_CONFIG && window.DB_CONFIG.apiKey) || '';
  const BASE = window.location.origin;

  // ---------- HTTP helpers ----------
  async function api(path, opts = {}) {
    const res = await fetch(BASE + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': KEY,
        ...(opts.headers || {})
      }
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
    if (!res.ok) throw new Error(data.error || data.message || ('HTTP ' + res.status));
    return data;
  }

  // ---------- Small utils ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  };
  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const fmtTime = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-CA', {
      timeZone: 'America/Toronto', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  };
  const fmtTimeShort = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('en-CA', {
      timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit'
    });
  };
  const fmtDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-CA', {
      timeZone: 'America/Toronto', month: 'short', day: 'numeric'
    });
  };
  const fmtMoney = (n) => {
    const v = Number(n) || 0;
    return new Intl.NumberFormat('en-CA', {
      style: 'currency', currency: 'CAD', maximumFractionDigits: 0
    }).format(v);
  };
  const dueClass = (due) => {
    if (!due) return '';
    const d = new Date(due); const now = new Date();
    d.setHours(0,0,0,0); now.setHours(0,0,0,0);
    if (d < now) return 'overdue';
    if (d.getTime() === now.getTime()) return 'today';
    return '';
  };

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast ' + kind; }, 2600);
  }

  // ---------- Modal ----------
  function openModal(title, bodyHtml, footerHtml = '') {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    $('#modal-footer').innerHTML = footerHtml;
    $('#modal').classList.add('active');
  }
  function closeModal() { $('#modal').classList.remove('active'); }

  // ---------- State ----------
  const state = {
    brief: null,
    crmFilter: 'all'
  };

  window.DB = { closeModal, openModal, toast, api, state };

  // Make DB object available — renderers are defined in dashboard.render.js
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof initDashboard === 'function') initDashboard();
  });

  // Expose utils to the renderer module
  window.DB_UTIL = {
    $, $$, el, escapeHtml, fmtTime, fmtTimeShort, fmtDate, fmtMoney, dueClass
  };
})();
