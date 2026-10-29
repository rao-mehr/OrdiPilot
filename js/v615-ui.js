/* ===== OrdiPilot V6.15 · Übersichtlichere Einsätze und Parkbelege =====
   Einsätze: fünf klar unterscheidbare Status (geplant, heute, bestätigen, erledigt, abgerechnet) mit Farbe,
   Symbol, Filter und Monatsbalken. Parken: nach Tagen gebündelt, Parkzeit gegen Einsatzzeit, gratis-Vorgänge,
   Parkvorgänge ohne Einsatz und Einsätze ohne Parkbeleg. Rein darstellend – Daten werden nicht verändert. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof state === 'undefined') return;
  const esc = v => escapeHtml(v);
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const wd = iso => {
    const [y, m, d] = String(iso).split('-').map(Number);
    return WD[new Date(y, m - 1, d).getDay()];
  };
  const addDays = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number),
      x = new Date(y, m - 1, d + n);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  const STATUS = {
    open: { label: 'bestätigen', icon: '!', color: '#ff9500', order: 0 },
    today: { label: 'heute', icon: '●', color: '#5e5ce6', order: 1 },
    planned: { label: 'geplant', icon: '○', color: '#0a84ff', order: 2 },
    done: { label: 'erledigt', icon: '✓', color: '#34c759', order: 3 },
    billed: { label: 'abgerechnet', icon: '🔒', color: '#8e8e93', order: 4 },
  };
  const primaryRid = () => (state.settings.recipients || [])[0]?.id || 'recipient-primary';
  function vstatus(e) {
    const st = entryStatus(e);
    if (st === 'done') {
      let locked = false;
      try {
        locked =
          !!window.ordipilotRecipientMonthLocked &&
          window.ordipilotRecipientMonthLocked(e.date.slice(0, 7), e.recipientId || primaryRid());
      } catch (_) {}
      return locked ? 'billed' : 'done';
    }
    return STATUS[st] ? st : 'planned';
  }
  let filter = 'all';

  function css() {
    if (document.getElementById('v615-style')) return;
    const st = document.createElement('style');
    st.id = 'v615-style';
    st.textContent = `
.v611-entry-card.v615{border-width:1px}
.v611-entry-card.v615:before{width:6px}
.v615.vs-open{background:linear-gradient(100deg,#fff1dc 0,#fff 62%);border-color:#ffd59a;box-shadow:0 6px 22px rgba(255,149,0,.16)}
.v615.vs-open:before{background:#ff9500}
.v615.vs-today{background:linear-gradient(100deg,#eeedff 0,#fff 62%);border-color:#cfcdfb}
.v615.vs-today:before{background:#5e5ce6}
.v615.vs-planned{background:linear-gradient(100deg,#eaf3ff 0,#fff 62%);border-color:#cfe2fb}
.v615.vs-planned:before{background:#0a84ff}
.v615.vs-done{background:linear-gradient(100deg,#e8f8ed 0,#fff 62%);border-color:#c6ead2}
.v615.vs-done:before{background:#34c759}
.v615.vs-billed{background:#f6f6f8;border-color:#e5e5ea;box-shadow:none}
.v615.vs-billed:before{background:#aeaeb2}
.v615.vs-billed .v611-entry-amount{color:#6e6e73}
.v615 .v611-status.v615-chip{color:#fff;font-size:11px;padding:4px 9px 4px 7px;display:inline-flex;gap:4px;align-items:center}
.v615.vs-open .v615-chip{background:#ff9500}.v615.vs-today .v615-chip{background:#5e5ce6}.v615.vs-planned .v615-chip{background:#0a84ff}
.v615.vs-done .v615-chip{background:#34c759}.v615.vs-billed .v615-chip{background:#8e8e93}
.v615-wd{font-weight:800;color:#6b7280;margin-right:4px}
.v615-rel{font-size:11px;font-weight:800;color:#5e5ce6;margin-left:6px}
.v611-info-chip.v615-park{background:#e8f8ed;color:#1f7a3d;font-weight:700}
.v611-info-chip.v615-nopark{background:#f2f2f7;color:#8e8e93}
.v615-filter{display:flex;gap:6px;overflow-x:auto;padding:2px 0 12px;scrollbar-width:none}
.v615-filter::-webkit-scrollbar{display:none}
.v615-filter button{flex:0 0 auto;border:1px solid #e3e7ee;background:#fff;border-radius:999px;padding:7px 11px;font-size:13px;font-weight:700;color:#3a3a3c;display:inline-flex;align-items:center;gap:6px;min-height:34px}
.v615-filter button i{width:9px;height:9px;border-radius:50%;display:inline-block}
.v615-filter button.on{background:#1c1c1e;border-color:#1c1c1e;color:#fff}
.v615-filter button b{font-weight:800;opacity:.7}
.v615-bar{display:flex;height:6px;border-radius:99px;overflow:hidden;background:#eef0f4;margin-top:8px;width:min(220px,58vw)}
.v615-bar i{display:block;height:100%}
.v615-counts{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}
.v615-counts span{font-size:11px;font-weight:800;border-radius:999px;padding:2px 7px;color:#fff}
.v615-hidden{display:none!important}
/* Parken nach Tagen */
.v615-day{border:1px solid #e7ebf1;border-radius:16px;background:#fff;margin-bottom:8px;overflow:hidden}
.v615-day.unassigned{border-color:#ffc56b;background:#fffaf0}
.v615-day-head{width:100%;border:0;background:transparent;display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;text-align:left;padding:12px 14px;min-height:56px}
.v615-day-head .d{font-weight:800;font-size:15px}.v615-day-head .s{font-size:12px;color:#6b7280;margin-top:2px}
.v615-day-head .a{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}.v615-day-head .a small{display:block;font-size:11px;color:#8e8e93;font-weight:650}
.v615-cov{display:inline-block;font-size:10.5px;font-weight:800;border-radius:999px;padding:2px 7px;margin-left:6px;vertical-align:1px}
.v615-cov.full{background:#e8f8ed;color:#1f7a3d}.v615-cov.part{background:#fff3dd;color:#966000}
.v615-day-body{padding:0 10px 10px;display:grid;gap:8px}
.v615-day-body[hidden]{display:none}
.v615-day-actions{display:flex;gap:8px;flex-wrap:wrap;padding:0 4px}
.v611-park-amount.v615-free{color:#1f7a3d}
.v615-nopark-card{margin:12px 0}
.v615-nopark-card summary{list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:13px 14px;cursor:pointer;font-weight:750;border:1px solid #e7ebf1;border-radius:16px;background:#fff}
.v615-nopark-card summary::-webkit-details-marker{display:none}
.v615-nopark-card[open] summary{border-radius:16px 16px 0 0}
.v615-nopark-list{border:1px solid #e7ebf1;border-top:0;border-radius:0 0 16px 16px;background:#fff;padding:4px 14px 12px}
.v615-nopark-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #f0f2f6;font-size:14px}
.v615-nopark-row:first-child{border-top:0}
.v615-nopark-row button{border:0;background:#eaf3ff;color:#0066cc;font-weight:700;border-radius:10px;padding:7px 10px;font-size:13px}
`;
    document.head.appendChild(st);
  }

  /* ---------- Einsätze ---------- */
  function monthGroupsLikeV611(arr, sortFn) {
    const groups = new Map();
    arr.forEach(x => {
      const mk = x.date.slice(0, 7);
      if (!groups.has(mk)) groups.set(mk, []);
      groups.get(mk).push(x);
    });
    return [...groups.keys()]
      .sort()
      .reverse()
      .map(mk => ({ mk, items: groups.get(mk).slice().sort(sortFn) }));
  }
  function decorateEntries() {
    const host = document.getElementById('entryCards');
    if (!host) return;
    css();
    const arr = filteredEntries(),
      groups = monthGroupsLikeV611(arr, (a, b) => b.date.localeCompare(a.date));
    const details = [...host.querySelectorAll(':scope>details.v62-month-group')];
    if (details.length !== groups.length) return;
    const today = todayISO(),
      tomorrow = addDays(today, 1),
      counts = { all: arr.length, open: 0, today: 0, planned: 0, done: 0, billed: 0 };
    groups.forEach((g, gi) => {
      const d = details[gi],
        cards = [...d.querySelectorAll('.v611-entry-card')];
      if (cards.length !== g.items.length) return;
      const c = {};
      g.items.forEach((e, i) => {
        const card = cards[i],
          vs = vstatus(e),
          S = STATUS[vs];
        c[vs] = (c[vs] || 0) + 1;
        counts[vs]++;
        card.classList.add('v615', 'vs-' + vs);
        card.dataset.vs = vs;
        card.dataset.entryId = e.id;
        const chip = card.querySelector('.v611-status');
        if (chip) {
          chip.className = 'v611-status v615-chip';
          chip.innerHTML = `<span aria-hidden="true">${S.icon}</span>${S.label}`;
        }
        const date = card.querySelector('.v611-date');
        if (date && !date.querySelector('.v615-wd')) {
          date.insertAdjacentHTML('afterbegin', `<span class="v615-wd">${wd(e.date)}</span>`);
          if (e.date === today || e.date === tomorrow)
            date.insertAdjacentHTML(
              'beforeend',
              `<span class="v615-rel">${e.date === today ? 'heute' : 'morgen'}</span>`
            );
        }
        const info = card.querySelector('.v611-entry-info');
        if (info) {
          const park = [...info.querySelectorAll('.v611-info-chip')].find(x => /^Parken/.test(x.textContent.trim()));
          if (park) park.classList.add('v615-park');
          else if ((vs === 'done' || vs === 'billed') && !info.querySelector('.v615-nopark'))
            info.insertAdjacentHTML('afterbegin', '<span class="v611-info-chip v615-nopark">kein Parkbeleg</span>');
        }
      });
      const meta = d.querySelector('summary .v62-month-group-meta');
      if (meta && !d.querySelector('.v615-bar')) {
        // Klartext statt „x offen“ (das zählte auch geplante Einsätze)
        const hrs = g.items.filter(isEarnedEntry).reduce((t, e) => t + (entryHours(e) || 0), 0);
        meta.textContent = `${g.items.length} ${g.items.length === 1 ? 'Einsatz' : 'Einsätze'}${hrs ? ` · ${dec(hrs, 1)} h` : ''}`;
        const order = Object.keys(STATUS).sort((a, b) => STATUS[a].order - STATUS[b].order);
        meta.insertAdjacentHTML(
          'afterend',
          `<div class="v615-bar" aria-hidden="true">${order
            .filter(k => c[k])
            .map(k => `<i style="flex:${c[k]};background:${STATUS[k].color}"></i>`)
            .join('')}</div>` +
            `<div class="v615-counts">${order
              .filter(k => c[k] && k !== 'billed' && k !== 'done')
              .map(k => `<span style="background:${STATUS[k].color}">${c[k]} ${STATUS[k].label}</span>`)
              .join('')}</div>`
        );
      }
    });
    renderFilter(host, counts);
    applyFilter(host);
  }
  function renderFilter(host, counts) {
    let bar = document.getElementById('v615Filter');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'v615Filter';
      bar.className = 'v615-filter';
      bar.setAttribute('role', 'tablist');
      host.parentNode.insertBefore(bar, host);
      bar.addEventListener('click', ev => {
        const b = ev.target.closest('button[data-f]');
        if (!b) return;
        filter = b.dataset.f;
        try {
          localStorage.setItem('ordipilot-v615-filter', filter);
        } catch (_) {}
        renderEntries();
      });
    }
    const items = [
      ['all', 'Alle', null],
      ['open', 'bestätigen', STATUS.open.color],
      ['planned', 'geplant', STATUS.planned.color],
      ['done', 'erledigt', STATUS.done.color],
      ['billed', 'abgerechnet', STATUS.billed.color],
    ];
    if (counts.today) items.splice(2, 0, ['today', 'heute', STATUS.today.color]);
    if (filter !== 'all' && !counts[filter]) filter = 'all';
    bar.innerHTML = items
      .filter(([k]) => k === 'all' || counts[k] || filter === k)
      .map(
        ([k, l, col]) =>
          `<button type="button" data-f="${k}" class="${filter === k ? 'on' : ''}" role="tab" aria-selected="${filter === k}">${col ? `<i style="background:${col}"></i>` : ''}${l} <b>${counts[k] || 0}</b></button>`
      )
      .join('');
  }
  function applyFilter(host) {
    for (const d of host.querySelectorAll(':scope>details.v62-month-group')) {
      let visible = 0;
      for (const card of d.querySelectorAll('.v611-entry-card')) {
        const show = filter === 'all' || card.dataset.vs === filter;
        card.classList.toggle('v615-hidden', !show);
        if (show) visible++;
      }
      d.classList.toggle('v615-hidden', visible === 0);
      if (filter !== 'all' && visible) d.open = true;
    }
  }
  OrdiPilotBoot.add('v615-ui:1', () => {
    try {
      filter = localStorage.getItem('ordipilot-v615-filter') || 'all';
    } catch (_) {}
  });

  /* ---------- Parken ---------- */
  const tmin = t => {
    if (!t || !/^\d{1,2}:\d{2}/.test(t)) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  function coverage(e, ps) {
    const s = tmin(e.start || e.plannedStart),
      en = tmin(e.end || e.plannedEnd);
    if (s === null || en === null || en <= s) return null;
    const iv = ps
      .map(p => [tmin(p.start), tmin(p.end)])
      .filter(([a, b]) => a !== null && b !== null)
      .map(([a, b]) => [Math.max(a, s), Math.min(b < a ? b + 1440 : b, en)])
      .filter(([a, b]) => b > a)
      .sort((x, y) => x[0] - y[0]);
    let cov = 0,
      cur = null;
    for (const [a, b] of iv) {
      if (!cur || a > cur[1]) {
        if (cur) cov += cur[1] - cur[0];
        cur = [a, b];
      } else cur[1] = Math.max(cur[1], b);
    }
    if (cur) cov += cur[1] - cur[0];
    return { pct: Math.round((cov / (en - s)) * 100), span: `${e.start || e.plannedStart}–${e.end || e.plannedEnd}` };
  }
  const mins = n => {
    const h = Math.floor(n / 60),
      m = n % 60;
    return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
  };
  const openDays = new Set();
  function decorateParking() {
    const host = document.getElementById('parkingCards');
    if (!host) return;
    css();
    for (const d of host.querySelectorAll(':scope>details.v62-month-group')) {
      const body = d.querySelector('.v62-month-group-body');
      if (!body || body.dataset.v615) continue;
      const cards = [...body.querySelectorAll(':scope>.v611-park-card')];
      if (!cards.length) continue;
      const recOf = card => {
        const id = card.querySelector('[data-pedit]')?.dataset.pedit;
        return state.parkingRecords.find(p => p.id === id);
      };
      const byDay = new Map();
      for (const card of cards) {
        const p = recOf(card);
        if (!p) return;
        if (!byDay.has(p.date)) byDay.set(p.date, []);
        byDay.get(p.date).push({ card, p });
        if (Number(p.amount) === 0) {
          const a = card.querySelector('.v611-park-amount');
          if (a) {
            a.textContent = 'gratis';
            a.classList.add('v615-free');
          }
        }
      }
      body.dataset.v615 = '1';
      for (const [date, list] of byDay) {
        const ps = list.map(x => x.p),
          total = ps.reduce((t, p) => t + (Number(p.amount) || 0), 0),
          dur = ps.reduce((t, p) => t + parkingMinutes(p), 0);
        const unassigned = ps.some(p => !p.entryId),
          entries = (state.entries || []).filter(e => e.date === date),
          e = entries.find(x => ps.some(p => p.entryId === x.id)) || entries[0];
        const cov = e ? coverage(e, ps) : null;
        const sub = e
          ? `Einsatz ${cov ? cov.span : entryHours(e) !== null ? dec(entryHours(e), 1) + ' h' : ''} · Parkzeit ${mins(dur)}${cov ? `<span class="v615-cov ${cov.pct >= 90 ? 'full' : 'part'}">${cov.pct >= 90 ? 'Einsatzzeit abgedeckt' : 'deckt ' + cov.pct + ' % ab'}</span>` : ''}`
          : '<b style="color:#a35a00">kein Einsatz an diesem Tag</b>';
        const wrap = document.createElement('div');
        wrap.className = 'v615-day' + (unassigned ? ' unassigned' : '');
        if (unassigned) wrap.dataset.unassigned = '1';
        const open = unassigned || openDays.has(date);
        wrap.innerHTML = `<button type="button" class="v615-day-head" aria-expanded="${open}"><div><div class="d">${wd(date)}, ${dateAT(date)}</div><div class="s">${sub}</div></div><div class="a">${total > 0 ? euro(total) : 'gratis'}<small>${ps.length} ${ps.length === 1 ? 'Vorgang' : 'Vorgänge'} ›</small></div></button><div class="v615-day-body" ${open ? '' : 'hidden'}></div>`;
        const b = wrap.querySelector('.v615-day-body');
        if (unassigned && !entries.length)
          b.insertAdjacentHTML(
            'beforeend',
            `<div class="v615-day-actions"><span class="help" style="flex:1 1 100%">Parkvorgang ohne Einsatz – hattest du an diesem Tag eine Vertretung? Sonst bearbeiten und „nicht berücksichtigen“ wählen.</span><button type="button" class="btn soft" data-v615-newentry="${esc(date)}">Einsatz am ${dateAT(date)} anlegen</button></div>`
          );
        list.forEach(x => b.appendChild(x.card));
        body.appendChild(wrap);
        wrap.querySelector('.v615-day-head').addEventListener('click', () => {
          const h = b.hidden;
          b.hidden = !h;
          wrap.querySelector('.v615-day-head').setAttribute('aria-expanded', String(h));
          if (h) openDays.add(date);
          else openDays.delete(date);
        });
      }
    }
    host
      .querySelectorAll('[data-v615-newentry]')
      .forEach(btn => (btn.onclick = () => openEntry(null, 'plan', btn.dataset.v615newentry)));
    renderNoParking();
  }
  function renderNoParking() {
    const auto = document.querySelector('#panel-parking .v62-auto-card');
    if (!auto) return;
    let el = document.getElementById('v615NoPark');
    const y = (window.parkingYear && parkingYear.value) || String(new Date().getFullYear());
    const parked = new Set((state.parkingRecords || []).filter(p => p.entryId && !p.excluded).map(p => p.entryId));
    const list = (state.entries || [])
      .filter(e => e.date?.startsWith(y + '-') && isEarnedEntry(e) && !parked.has(e.id))
      .sort((a, b) => b.date.localeCompare(a.date));
    if (!list.length) {
      if (el) el.remove();
      return;
    }
    const wasOpen = el?.open;
    if (!el) {
      el = document.createElement('details');
      el.id = 'v615NoPark';
      el.className = 'v615-nopark-card no-print';
      auto.insertAdjacentElement('afterend', el);
    }
    el.innerHTML = `<summary><span>Einsätze ohne Parkbeleg</span><span style="color:#8e8e93;font-weight:650;font-size:13px">${list.length} in ${esc(y)} ›</span></summary><div class="v615-nopark-list"><div class="help" style="padding:8px 0">Gratis geparkt, öffentlich angereist – oder fehlt ein Beleg? Fehlende Belege hier nachtragen; Tage ohne Auto unter Honorar → Fahrten auf „kein Auto“ stellen.</div>${list.map(e => `<div class="v615-nopark-row"><span><b>${wd(e.date)}, ${dateAT(e.date)}</b>${e.start ? ` · ${esc(e.start)}–${esc(e.end || '')}` : ''}</span><button type="button" data-v615-addpark="${esc(e.date)}">Beleg nachtragen</button></div>`).join('')}</div>`;
    if (wasOpen) el.open = true;
    el.querySelectorAll('[data-v615-addpark]').forEach(
      b =>
        (b.onclick = () => {
          openParking();
          try {
            pDate.value = b.dataset.v615addpark;
            pDate.dispatchEvent(new Event('change', { bubbles: true }));
            pDate.dispatchEvent(new Event('input', { bubbles: true }));
          } catch (_) {}
        })
    );
  }

  // Einhängen: nach jeder Darstellung der Listen dekorieren
  OrdiPilotExt.extend(
    'renderEntries',
    baseEntries =>
      function () {
        const out = baseEntries.apply(this, arguments);
        try {
          decorateEntries();
        } catch (e) {
          console.warn('V6.15 Einsätze', e);
        }
        return out;
      }
  );
  OrdiPilotExt.extend(
    'renderParking',
    baseParking =>
      function () {
        const out = baseParking.apply(this, arguments);
        try {
          decorateParking();
        } catch (e) {
          console.warn('V6.15 Parken', e);
        }
        return out;
      }
  );
  // „Offen“-Sprung aus der Übersicht findet den Tag weiterhin
  OrdiPilotExt.extend(
    'focusFirstUnassignedParking',
    baseFocus =>
      function () {
        const el = document.querySelector('#parkingCards .v615-day[data-unassigned="1"]');
        if (el) {
          const d = el.closest('details');
          if (d) d.open = true;
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        return baseFocus.apply(this, arguments);
      }
  );
  window.ordipilotV615 = { vstatus, decorateEntries, decorateParking };
  OrdiPilotBoot.add('v615-ui:2', () => {
    try {
      renderEntries();
      renderParking();
    } catch (e) {
      console.warn('V6.15', e);
    }
  });
})();
