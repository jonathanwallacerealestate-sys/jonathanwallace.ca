/**
 * Lead Generation + Hour of Power.
 *
 * Surfaces:
 *   - Daily activity counters with progress bars vs goals
 *   - Quick-log buttons for call/email/text/drop-by
 *   - Hour of Power session control: start/pause/end + countdown timer
 *   - Per-call recording flow: name -> record -> auto-end -> Claude analyzes
 *   - Claude returns summary, sentiment, commitments, follow-ups (auto-CRM),
 *     coaching notes
 *   - End-of-session debrief modal, spoken aloud
 *
 * Recording stack:
 *   - Web Speech API for live transcription (no external service)
 *   - Optional MediaRecorder for an audio blob (kept in browser for now)
 *   - One-time consent checkbox stored in localStorage (Ontario one-party)
 */
(function(){
  'use strict';

  const { api, toast, openModal, closeModal } = window.DB;
  const { escapeHtml } = window.DB_UTIL;

  // ---------- State ----------
  const state = {
    activeSession: null,
    activeCall: null,
    timerInterval: null,
    recog: null,
    recording: false,
    transcript: '',
    consentGiven: false
  };

  document.addEventListener('DOMContentLoaded', () => {
    state.consentGiven = localStorage.getItem('jw_recording_consent') === 'yes';
    hookIntoLoadCycle();
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
    await Promise.all([renderGoals(), renderPowerHour(), renderListingMatchBanner()]);
  }

  // Cache matches for 10 min to avoid hitting FUB on every render
  let _matchCache = { at: 0, data: null };
  async function renderListingMatchBanner() {
    const host = document.getElementById('listing-match-banner');
    if (!host) return;
    const now = Date.now();
    let data = _matchCache.data;
    if (!data || (now - _matchCache.at) > 10 * 60 * 1000) {
      try {
        data = await api('/api/fub/listing-matches?days=14');
        _matchCache = { at: now, data };
      } catch (e) {
        host.style.display = 'none';
        return;
      }
    }
    if (!data || !data.match_count) { host.style.display = 'none'; return; }
    const top = (data.matches || []).slice(0, 3);
    host.style.display = '';
    host.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:0.75rem">
        <div style="font-size:1.2rem;line-height:1.2">🎯</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;margin-bottom:0.25rem">
            ${data.match_count} recent lead${data.match_count === 1 ? '' : 's'} match your active listings
          </div>
          <div style="font-size:0.8rem;color:#92400e;line-height:1.5">
            ${top.map(m => {
              const firstListing = m.listings[0];
              return `<strong>${escapeHtml(m.person.name || 'Unknown')}</strong>
                      <span style="color:#78350f">&nbsp;↔&nbsp; ${escapeHtml(firstListing.address)}${firstListing.city ? ', ' + escapeHtml(firstListing.city) : ''}</span>`;
            }).join(' &nbsp;·&nbsp; ')}
            ${data.match_count > 3 ? `<span style="color:#78350f"> &nbsp;·&nbsp; +${data.match_count - 3} more</span>` : ''}
          </div>
          <button class="btn-secondary" data-leadgen="show-listing-matches" style="margin-top:0.5rem;padding:0.3rem 0.7rem;font-size:0.75rem">See all matches</button>
        </div>
      </div>
    `;
  }


  // ---------- Activity goals ----------
  async function renderGoals() {
    const host = document.getElementById('leadgen-goals');
    const stats = document.getElementById('leadgen-stats');
    if (!host) return;
    try {
      const { goals } = await api('/api/activity/goals');
      const totalToday = goals.reduce((a, g) => a + (g.daily_actual || 0), 0);
      const onTrack = goals.filter(g => g.daily_pct >= 50).length;
      if (stats) {
        stats.innerHTML = `
          <span class="chip-stat">${totalToday} touches today</span>
          <span class="chip-stat ${onTrack === goals.length ? 'success' : ''}">${onTrack}/${goals.length} goals on track</span>
        `;
      }
      host.innerHTML = goals.map(g => {
        const pct = g.daily_pct;
        const color = pct >= 100 ? '#10b981' : pct >= 60 ? '#c9a96e' : pct >= 30 ? '#f59e0b' : '#ef4444';
        return `
          <div class="kpi" style="position:relative;overflow:hidden">
            <div class="label">${escapeHtml(prettyGoal(g.goal_type))}</div>
            <div class="value" style="color:${color}">${g.daily_actual}<span style="font-size:0.85rem;color:var(--muted);font-weight:500"> / ${g.daily_target}</span></div>
            <div class="sub">${g.weekly_actual} / ${g.weekly_target} this week</div>
            <div style="position:absolute;left:0;right:0;bottom:0;height:3px;background:#e5e7eb">
              <div style="height:100%;width:${Math.min(100, pct)}%;background:${color};transition:width 0.3s ease"></div>
            </div>
          </div>`;
      }).join('');
    } catch (e) {
      host.innerHTML = '<div class="empty">Could not load goals: ' + escapeHtml(e.message) + '</div>';
    }
  }

  function prettyGoal(slug) {
    const map = {
      calls: 'Calls',
      connected_calls: 'Connected',
      emails: 'Emails',
      contacts_added: 'Contacts',
      follow_ups_completed: 'Follow-ups Done'
    };
    return map[slug] || slug.replace(/_/g, ' ');
  }

  // ---------- Click delegation ----------
  async function handleClick(e) {
    const quick = e.target.closest('[data-quick-log]');
    if (quick) return logQuick(quick.dataset.quickLog);
    const action = e.target.closest('[data-leadgen]');
    if (!action) return;
    const id = action.dataset.id;
    try {
      switch (action.dataset.leadgen) {
        case 'start-power':   return startSession();
        case 'pause-power':   return pauseSession(id);
        case 'resume-power':  return resumeSession(id);
        case 'end-power':     return endSession(id);
        case 'start-call':    return startCall();
        case 'end-call':      return endCall();
        case 'view-call':     return viewCall(id);
        case 'view-debrief':  return viewDebrief(id);
        case 'analyze-call':  return reanalyzeCall(id);
        case 'consent':       return showConsent();
        case 'show-listing-matches': return openListingMatchesModal();
      }
    } catch (e) { toast(e.message, 'error'); }
  }

  async function openListingMatchesModal() {
    const data = _matchCache.data || await api('/api/fub/listing-matches?days=30');
    _matchCache = { at: Date.now(), data };
    const matches = data.matches || [];
    if (!matches.length) return toast('No active listing matches right now', 'error');

    const rows = matches.map(m => `
      <div style="padding:0.75rem 0.9rem;border:1px solid var(--border);border-radius:8px;margin-bottom:0.5rem">
        <div style="font-weight:600;font-size:0.9rem">
          ${escapeHtml(m.person.name || 'Unknown')}
          ${m.person.stage ? `<span class="badge normal" style="margin-left:0.4rem">${escapeHtml(m.person.stage)}</span>` : ''}
          ${m.person.source ? `<span style="color:var(--muted);font-size:0.72rem;font-weight:400;margin-left:0.3rem">· ${escapeHtml(m.person.source)}</span>` : ''}
        </div>
        <div style="margin-top:0.35rem">
          ${m.listings.map(L => `
            <div style="font-size:0.82rem;padding:0.3rem 0;border-top:1px dashed var(--border)">
              <strong>${escapeHtml(L.address)}</strong>${L.city ? ', ' + escapeHtml(L.city) : ''}
              ${L.price ? `<span style="color:var(--muted);margin-left:0.3rem">— $${Number(L.price).toLocaleString()}</span>` : ''}
              <div style="color:var(--muted);font-size:0.7rem;margin-top:0.1rem">matched: ${escapeHtml(L.signals.join(' · '))}</div>
            </div>
          `).join('')}
        </div>
        <div style="margin-top:0.4rem">
          <button class="btn-secondary" data-action="view-fub-person" data-id="${m.person.id}" style="padding:0.3rem 0.7rem;font-size:0.75rem">Open contact</button>
        </div>
      </div>
    `).join('');

    openModal(`Listing ↔ lead matches · last ${data.leads_scanned} leads vs ${data.listings_scanned} active listings`, rows, `
      <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
    `);
  }

  async function logQuick(type) {
    const name = (document.getElementById('quick-contact')?.value || '').trim();
    try {
      await api('/api/activity', {
        method: 'POST',
        body: JSON.stringify({ activity_type: type, contact_name: name || null, source: 'manual' })
      });
      toast('Logged ' + type, 'success');
      const el = document.getElementById('quick-contact'); if (el) el.value = '';
      if (typeof window.load === 'function') window.load();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------- Hour of Power ----------
  async function renderPowerHour() {
    const host = document.getElementById('power-hour-host');
    if (!host) return;
    try {
      const data = await api('/api/power-hour/active');
      state.activeSession = data.session;
      if (!data.session) {
        renderInactivePowerHour(host);
        return;
      }
      renderActivePowerHour(host, data.session, data.calls || []);
    } catch (e) {
      host.innerHTML = '<div class="empty">Could not load Hour of Power: ' + escapeHtml(e.message) + '</div>';
    }
  }

  function renderActivePowerHour(host, session, calls) {
    const target = new Date(new Date(session.started_at).getTime() + (session.planned_duration_minutes * 60000));
    const isPaused = session.status === 'paused';
    host.innerHTML = `
      <div style="background:linear-gradient(135deg,#0a1628,#1a1a2e);color:#fff;border-radius:12px;padding:1.25rem">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap">
          <div>
            <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:1px;color:#c9a96e;margin-bottom:0.3rem">
              Hour of Power · ${escapeHtml(isPaused ? 'paused' : 'active')}
            </div>
            <div id="ph-timer" style="font-size:2.4rem;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-1px;color:#fff;line-height:1.1">--:--</div>
            <div style="font-size:0.8rem;color:#9ca3af;margin-top:0.25rem">Started ${new Date(session.started_at).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' })} · ${session.planned_duration_minutes} min planned</div>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
            ${state.recording
              ? `<button class="btn-primary" data-leadgen="end-call" style="background:#ef4444;color:#fff">&#9632; End Call</button>`
              : `<button class="btn-primary" data-leadgen="start-call">&#127908; Start Call</button>`}
            ${isPaused
              ? `<button class="btn-secondary" data-leadgen="resume-power" data-id="${session.id}">Resume</button>`
              : `<button class="btn-secondary" data-leadgen="pause-power" data-id="${session.id}">Pause</button>`}
            <button class="btn-danger" data-leadgen="end-power" data-id="${session.id}">End Session</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:0.5rem;margin-top:1rem">
          <div style="background:rgba(255,255,255,0.06);padding:0.6rem 0.8rem;border-radius:8px">
            <div style="font-size:0.65rem;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px">Calls</div>
            <div style="font-size:1.4rem;font-weight:700">${session.calls_count}</div>
          </div>
          <div style="background:rgba(255,255,255,0.06);padding:0.6rem 0.8rem;border-radius:8px">
            <div style="font-size:0.65rem;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px">Connected</div>
            <div style="font-size:1.4rem;font-weight:700;color:#10b981">${session.connected_count}</div>
          </div>
          <div style="background:rgba(255,255,255,0.06);padding:0.6rem 0.8rem;border-radius:8px">
            <div style="font-size:0.65rem;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px">Connect Rate</div>
            <div style="font-size:1.4rem;font-weight:700">${session.calls_count ? Math.round((session.connected_count / session.calls_count) * 100) : 0}%</div>
          </div>
        </div>

        ${state.recording ? renderLiveRecorder() : ''}

        ${calls.length ? `
          <div style="margin-top:1rem;background:rgba(255,255,255,0.04);border-radius:8px;padding:0.75rem">
            <div style="font-size:0.7rem;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.5rem">Recent calls</div>
            ${calls.slice(0, 5).map(callRowHtml).join('')}
          </div>` : ''}
      </div>
    `;
    startTimerLoop(target, session.status);
  }

  function callRowHtml(c) {
    const sentColor = { hot: '#ef4444', warm: '#f59e0b', cold: '#6b7280' }[c.sentiment] || '#9ca3af';
    return `
      <div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.85rem;color:#e5e7eb;cursor:pointer" data-leadgen="view-call" data-id="${c.id}">
        <span style="width:8px;height:8px;border-radius:50%;background:${sentColor};flex-shrink:0"></span>
        <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          <strong>${escapeHtml(c.contact_name || 'Unknown')}</strong>
          ${c.summary ? '<span style="color:#9ca3af"> — ' + escapeHtml(c.summary.slice(0, 80)) + (c.summary.length > 80 ? '…' : '') + '</span>' : ''}
        </span>
        ${c.outcome ? `<span style="font-size:0.7rem;color:#9ca3af">${escapeHtml(c.outcome)}</span>` : ''}
      </div>`;
  }

  function renderLiveRecorder() {
    return `
      <div style="margin-top:1rem;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);border-radius:8px;padding:0.85rem">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
          <div style="width:10px;height:10px;border-radius:50%;background:#ef4444;animation:pulse 1.2s ease-in-out infinite"></div>
          <strong style="color:#fff">Recording…</strong>
          <span style="color:#9ca3af;font-size:0.8rem">${escapeHtml(state.activeCall?.contact_name || 'unnamed')}</span>
          <span style="margin-left:auto;color:#9ca3af;font-size:0.8rem" id="ph-call-timer">00:00</span>
        </div>
        <div id="ph-live-transcript" style="font-size:0.85rem;color:#d1d5db;max-height:140px;overflow-y:auto;line-height:1.5"></div>
      </div>
    `;
  }

  function startTimerLoop(target, status) {
    if (state.timerInterval) clearInterval(state.timerInterval);
    function tick() {
      const el = document.getElementById('ph-timer');
      if (!el) return;
      const ms = target.getTime() - Date.now();
      const totalSec = Math.max(0, Math.round(ms / 1000));
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      el.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
      if (status === 'paused') el.style.color = '#9ca3af';
      else if (totalSec === 0) el.style.color = '#ef4444';
      else if (totalSec < 300) el.style.color = '#f59e0b';
      else el.style.color = '#fff';

      if (state.activeCall && state.activeCall.startedAt) {
        const callEl = document.getElementById('ph-call-timer');
        if (callEl) {
          const cs = Math.floor((Date.now() - state.activeCall.startedAt) / 1000);
          callEl.textContent = (cs >= 60 ? Math.floor(cs / 60) + ':' : '0:') + (cs % 60 < 10 ? '0' : '') + (cs % 60);
        }
      }
    }
    tick();
    state.timerInterval = setInterval(tick, 500);
  }

  // ---------- Session lifecycle ----------
  async function startSession() {
    const dur = parseInt(document.getElementById('ph-duration')?.value) || 60;
    try {
      await api('/api/power-hour/start', { method: 'POST', body: JSON.stringify({ planned_duration_minutes: dur }) });
      toast('Hour of Power started — go!', 'success');
      if (typeof window.load === 'function') window.load();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function pauseSession(id) {
    await api('/api/power-hour/' + id + '/pause', { method: 'POST', body: '{}' });
    if (typeof window.load === 'function') window.load();
  }
  async function resumeSession(id) {
    await api('/api/power-hour/' + id + '/resume', { method: 'POST', body: '{}' });
    if (typeof window.load === 'function') window.load();
  }
  async function endSession(id) {
    if (!confirm('End this Hour of Power session?')) return;
    if (state.recording) await endCall();
    toast('Closing session and generating debrief…');
    try {
      const data = await api('/api/power-hour/' + id + '/end', { method: 'POST', body: '{}' });
      if (state.timerInterval) clearInterval(state.timerInterval);
      state.activeSession = null;
      state.activeCall = null;
      if (typeof window.load === 'function') await window.load();
      if (data.debrief) showDebrief(data.session, data.debrief);
    } catch (e) { toast(e.message, 'error'); }
  }

  function renderInactivePowerHour(host) {
    host.innerHTML = `
      <div style="background:linear-gradient(135deg,#0a1628,#1a1a2e);color:#fff;border-radius:12px;padding:1.25rem">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">
          <div>
            <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:1px;color:#c9a96e;margin-bottom:0.3rem">Hour of Power</div>
            <div style="font-size:1.05rem;font-weight:600">Ready when you are.</div>
            <div style="font-size:0.8rem;color:#9ca3af;margin-top:0.25rem">Block out time, dial through your list, let Claude take notes.</div>
          </div>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <select id="ph-duration" style="padding:0.5rem;border-radius:8px;border:1px solid #374151;background:#0a1628;color:#fff;font-size:0.85rem">
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60" selected>60 min</option>
              <option value="90">90 min</option>
              <option value="120">2 hours</option>
            </select>
            <button class="btn-primary" data-leadgen="start-power" style="padding:0.65rem 1.1rem">Start</button>
          </div>
        </div>
        ${state.consentGiven ? '' : `
          <div style="margin-top:0.75rem;padding:0.6rem 0.8rem;background:rgba(245,158,11,0.15);border-radius:6px;font-size:0.78rem;color:#fbbf24">
            Tip: Recording uses your microphone for live transcription. <a href="#" data-leadgen="consent" style="color:#fbbf24;text-decoration:underline">Set consent preference</a>.
          </div>
        `}
      </div>
    `;
  }

  // ---------- Per-call recording ----------
  async function startCall() {
    if (!state.activeSession) return toast('No active Hour of Power', 'error');
    if (!state.consentGiven) return showConsent();
    openStartCallModal();
  }

  function openStartCallModal() {
    openModal('Start call', `
      <p style="font-size:0.85rem;color:var(--muted);margin-bottom:0.75rem">
        Who are you calling? Search your FUB contacts or type a name for a
        freestanding call (no CRM link).
      </p>
      <div class="form-field">
        <label>Contact</label>
        <input id="phc-search" placeholder="Type 2+ characters — name / email / phone" autocomplete="off">
        <div id="phc-results" style="margin-top:0.4rem;max-height:180px;overflow-y:auto;border-radius:6px"></div>
      </div>
      <div class="form-field">
        <label>Or use just a name (no FUB link)</label>
        <input id="phc-freetext" placeholder="e.g. Sarah from open house">
      </div>
      <div id="phc-brief" style="margin-top:1rem"></div>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-secondary" id="phc-brief-btn" style="display:none">Pre-call brief</button>
      <button class="btn-primary" id="phc-start-btn">Start recording</button>
    `);

    let chosen = null; // { person_id, name, email, phone }
    let debounceTimer = null;

    const searchInput = document.getElementById('phc-search');
    const resultsHost = document.getElementById('phc-results');
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      if (q.length < 2) { resultsHost.innerHTML = ''; resultsHost.style.border = ''; return; }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          const data = await api('/api/fub/people?limit=6&search=' + encodeURIComponent(q));
          const people = data.people || [];
          if (!people.length) { resultsHost.innerHTML = '<div style="padding:0.5rem;color:var(--muted);font-size:0.8rem">No FUB matches.</div>'; return; }
          resultsHost.style.border = '1px solid var(--border)';
          resultsHost.innerHTML = people.map(p => {
            const email = p.emails?.[0]?.value || '';
            const phone = p.phones?.[0]?.value || '';
            return `
              <div class="phc-row" data-id="${p.id}" data-name="${escapeAttr(p.name || email || phone || '')}" data-email="${escapeAttr(email)}" data-phone="${escapeAttr(phone)}"
                   style="padding:0.5rem 0.6rem;cursor:pointer;border-bottom:1px solid var(--border);font-size:0.85rem">
                <div style="font-weight:600">${escapeHtml(p.name || '(no name)')}</div>
                <div style="color:var(--muted);font-size:0.72rem">
                  ${email ? escapeHtml(email) : ''}${email && phone ? ' · ' : ''}${phone ? escapeHtml(phone) : ''}${p.stage ? ' · ' + escapeHtml(p.stage) : ''}
                </div>
              </div>`;
          }).join('');
          resultsHost.querySelectorAll('.phc-row').forEach(row => {
            row.addEventListener('click', () => {
              chosen = {
                person_id: Number(row.dataset.id),
                name: row.dataset.name,
                email: row.dataset.email || null,
                phone: row.dataset.phone || null
              };
              resultsHost.innerHTML = '<div style="padding:0.5rem;color:var(--success);font-size:0.85rem">Selected: <strong>' + escapeHtml(chosen.name) + '</strong></div>';
              searchInput.value = chosen.name;
              document.getElementById('phc-brief-btn').style.display = '';
              document.getElementById('phc-freetext').value = '';
              document.getElementById('phc-freetext').disabled = true;
            });
          });
        } catch (e) {
          // If FUB not configured, let the user freetype
          resultsHost.innerHTML = '<div style="padding:0.5rem;color:var(--muted);font-size:0.75rem">FUB not configured — use the freetext field below.</div>';
        }
      }, 280);
    });

    document.getElementById('phc-brief-btn').onclick = async () => {
      if (!chosen) return;
      const host = document.getElementById('phc-brief');
      host.innerHTML = `<div style="padding:0.75rem;background:#fafafa;border-left:3px solid var(--accent);border-radius:4px;font-size:0.88rem;color:var(--muted)">Generating pre-call brief…</div>`;
      try {
        const r = await api('/api/power-hour/pre-call-brief?person_id=' + chosen.person_id);
        host.innerHTML = `<div style="padding:0.75rem;background:#fafafa;border-left:3px solid var(--accent);border-radius:4px;font-size:0.9rem;line-height:1.55">${escapeHtml(r.brief)}</div>`;
        if (window.DB_VOICE && window.DB_VOICE.speak) window.DB_VOICE.speak(r.brief);
      } catch (e) {
        host.innerHTML = `<div style="padding:0.75rem;color:#991b1b;font-size:0.85rem">${escapeHtml(e.message)}</div>`;
      }
    };

    document.getElementById('phc-start-btn').onclick = async () => {
      const freeText = document.getElementById('phc-freetext').value.trim();
      const body = chosen
        ? { contact_name: chosen.name, contact_email: chosen.email, contact_phone: chosen.phone, fub_person_id: chosen.person_id }
        : { contact_name: freeText || null };
      if (!chosen && !freeText) return toast('Pick a contact or type a name first', 'error');

      let call;
      try {
        const r = await api('/api/power-hour/' + state.activeSession.id + '/calls', {
          method: 'POST', body: JSON.stringify(body)
        });
        call = r.call;
      } catch (e) { return toast(e.message, 'error'); }

      closeModal();

      state.activeCall = {
        id: call.id,
        contact_name: call.contact_name,
        fub_person_id: chosen ? chosen.person_id : null,
        startedAt: Date.now(),
        transcript: ''
      };
      state.transcript = '';
      state.recording = true;

      if (!startTranscription()) {
        toast('Voice transcription unsupported on this browser — call started without live transcript', 'error');
      }
      if (typeof window.load === 'function') window.load();
    };
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }

  async function endCall() {
    if (!state.activeCall) return;
    stopTranscription();
    const callId = state.activeCall.id;
    const transcript = (state.transcript || '').trim();

    let outcome = null;
    if (transcript.length < 30) {
      // Heuristic: short or empty transcript usually means voicemail / no answer
      outcome = window.prompt('Quick outcome? (connected / voicemail / no_answer / wrong_number / not_interested)', 'voicemail');
    } else {
      outcome = 'connected';
    }

    state.recording = false;
    state.activeCall = null;
    if (typeof window.load === 'function') window.load();

    toast('Call ended — Claude is reviewing…');
    try {
      const data = await api('/api/power-hour/calls/' + callId + '/end', {
        method: 'POST',
        body: JSON.stringify({ transcript: transcript || null, outcome, analyze: transcript.length >= 30 })
      });
      if (data.analysis) showCallAnalysis(callId, data.analysis);
      else toast('Call logged', 'success');
      if (typeof window.load === 'function') window.load();
    } catch (e) { toast(e.message, 'error'); }
  }

  function startTranscription() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) return false;
    const r = new Rec();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-CA';

    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) state.transcript += res[0].transcript + ' ';
        else interim += res[0].transcript + ' ';
      }
      const el = document.getElementById('ph-live-transcript');
      if (el) {
        el.textContent = (state.transcript + interim).trim();
        el.scrollTop = el.scrollHeight;
      }
    };
    r.onerror = (e) => {
      console.warn('speech recognition error', e.error);
      // Some browsers stop on no-speech; restart automatically while recording
      if (state.recording && e.error !== 'not-allowed') {
        try { r.stop(); } catch (_) {}
        setTimeout(() => { if (state.recording) startTranscription(); }, 500);
      }
    };
    r.onend = () => {
      if (state.recording) {
        // Auto-restart Web Speech (it stops every 60s on some browsers)
        try { r.start(); } catch (_) {}
      }
    };
    try { r.start(); state.recog = r; return true; }
    catch (e) { return false; }
  }

  function stopTranscription() {
    if (state.recog) { try { state.recog.stop(); } catch (_) {} state.recog = null; }
  }

  // ---------- Analysis + debrief modals ----------
  function showCallAnalysis(callId, a) {
    const fu = (a.follow_ups || []).map(f =>
      `<li><strong>${escapeHtml(f.type || 'task')}:</strong> ${escapeHtml(f.subject || '')} ${f.due_in_days != null ? '<span style="color:var(--muted)"> · in ' + f.due_in_days + ' day' + (f.due_in_days === 1 ? '' : 's') + '</span>' : ''}${f.notes ? '<div style="color:var(--muted);font-size:0.8rem;margin-left:0.5rem">' + escapeHtml(f.notes) + '</div>' : ''}</li>`
    ).join('');
    const jc = (a.jonathan_commitments || []).map(x => `<li>${escapeHtml(x)}</li>`).join('');
    const cc = (a.client_commitments || []).map(x => `<li>${escapeHtml(x)}</li>`).join('');
    const sentColor = { hot: '#ef4444', warm: '#f59e0b', cold: '#6b7280' }[a.sentiment] || '#6b7280';

    openModal('Call analyzed', `
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">
        <span class="badge" style="background:${sentColor};color:#fff">${escapeHtml(a.sentiment || 'warm')}</span>
        ${a.outcome ? `<span class="badge normal">${escapeHtml(a.outcome)}</span>` : ''}
        ${a.created_followup_ids?.length ? `<span style="font-size:0.75rem;color:var(--success)">+${a.created_followup_ids.length} follow-up${a.created_followup_ids.length === 1 ? '' : 's'} created in CRM</span>` : ''}
      </div>
      ${a.summary ? `<p style="font-size:0.95rem;line-height:1.55;margin-bottom:0.75rem">${escapeHtml(a.summary)}</p>` : ''}
      ${jc ? `<h4 style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin:0.75rem 0 0.3rem">You committed to</h4><ul style="margin:0 0 0 1.25rem;font-size:0.9rem;line-height:1.5">${jc}</ul>` : ''}
      ${cc ? `<h4 style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin:0.75rem 0 0.3rem">They committed to</h4><ul style="margin:0 0 0 1.25rem;font-size:0.9rem;line-height:1.5">${cc}</ul>` : ''}
      ${fu ? `<h4 style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin:0.75rem 0 0.3rem">Suggested follow-ups</h4><ul style="margin:0 0 0 1.25rem;font-size:0.9rem;line-height:1.5">${fu}</ul>` : ''}
      ${a.coaching_notes ? `<div style="margin-top:1rem;padding:0.75rem;background:#fafafa;border-left:3px solid var(--accent);border-radius:4px;font-size:0.88rem;line-height:1.5"><strong>Coaching:</strong> ${escapeHtml(a.coaching_notes)}</div>` : ''}
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
    `);
  }

  function showDebrief(session, debrief) {
    openModal('Hour of Power · Debrief', `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:0.5rem;margin-bottom:1rem">
        <div class="kpi"><div class="label">Calls</div><div class="value">${session.calls_count}</div></div>
        <div class="kpi"><div class="label">Connected</div><div class="value" style="color:var(--success)">${session.connected_count}</div></div>
        <div class="kpi"><div class="label">Connect Rate</div><div class="value">${session.calls_count ? Math.round((session.connected_count/session.calls_count)*100) : 0}%</div></div>
        <div class="kpi"><div class="label">Duration</div><div class="value">${session.ended_at && session.started_at ? Math.round((new Date(session.ended_at) - new Date(session.started_at))/60000) : '?'} min</div></div>
      </div>
      <div style="font-size:0.95rem;line-height:1.6">${debrief.split(/\n{2,}/).map(p => '<p style="margin:0 0 0.6rem">' + escapeHtml(p.trim()) + '</p>').join('')}</div>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Close</button>
    `);
    // Auto-speak
    if (window.DB_VOICE && window.DB_VOICE.speak) window.DB_VOICE.speak(debrief);
  }

  async function viewCall(id) {
    try {
      // No dedicated GET, but we have the call data in active session — re-pull
      const data = state.activeSession
        ? await api('/api/power-hour/active')
        : { calls: [] };
      let call = (data.calls || []).find(c => c.id == id);
      if (!call && state.activeSession) {
        const det = await api('/api/power-hour/' + state.activeSession.id);
        call = det.calls.find(c => c.id == id);
      }
      if (!call) return toast('Call not found', 'error');
      const analysis = {
        summary: call.summary,
        sentiment: call.sentiment,
        outcome: call.outcome,
        jonathan_commitments: call.jonathan_commitments || [],
        client_commitments: call.client_commitments || [],
        follow_ups: call.follow_ups || [],
        coaching_notes: call.coaching_notes,
        created_followup_ids: []
      };
      showCallAnalysis(id, analysis);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function reanalyzeCall(id) {
    try {
      toast('Re-analyzing…');
      const data = await api('/api/power-hour/calls/' + id + '/analyze', { method: 'POST', body: '{}' });
      showCallAnalysis(id, data.analysis);
      if (typeof window.load === 'function') window.load();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function viewDebrief(sessionId) {
    try {
      const { session } = await api('/api/power-hour/' + sessionId);
      if (session.debrief) showDebrief(session, session.debrief);
      else toast('No debrief on this session yet');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------- Consent ----------
  function showConsent() {
    openModal('Recording consent', `
      <p style="font-size:0.9rem;line-height:1.55">
        The Hour of Power feature uses your device microphone to live-transcribe
        your prospecting calls so Claude can summarize them, extract follow-ups,
        and coach you afterwards.
      </p>
      <p style="font-size:0.9rem;line-height:1.55;margin-top:0.5rem">
        In Ontario, Canada you may legally record a conversation you are a
        party to (one-party consent). Best practice is still to inform the
        other party — or use the dashboard for live note-taking only.
      </p>
      <p style="font-size:0.9rem;line-height:1.55;margin-top:0.5rem">
        Audio is processed in your browser via the Web Speech API; only the
        text transcript is sent to Claude / stored on the server.
      </p>
      <label style="display:flex;gap:0.5rem;align-items:center;margin-top:1rem;font-size:0.9rem">
        <input type="checkbox" id="consent-check" ${state.consentGiven ? 'checked' : ''}>
        I understand and consent to using the microphone for transcription.
      </label>
    `, `
      <button class="btn-secondary" onclick="DB.closeModal()">Cancel</button>
      <button class="btn-primary" id="consent-save">Save</button>
    `);
    document.getElementById('consent-save').onclick = () => {
      const ok = document.getElementById('consent-check').checked;
      state.consentGiven = ok;
      try { localStorage.setItem('jw_recording_consent', ok ? 'yes' : 'no'); } catch (e) {}
      toast(ok ? 'Consent saved' : 'Consent cleared');
      closeModal();
      if (typeof window.load === 'function') window.load();
    };
  }
})();
