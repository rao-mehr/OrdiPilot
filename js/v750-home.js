/* OrdiPilot V7.5.0 – Kalender ist das Hauptfenster: Start im Kalender, Monate fließend wischen, Import direkt darunter.
   Der Kalender (früher Dialog) liegt jetzt im Tab „Kalender“; alle bestehenden Funktionen laufen unverändert weiter. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const dlg = $('v67CalendarDialog'),
    panel = $('panel-calendar');
  if (!panel) return;

  // Aufrufer, die früher den Dialog öffneten, landen jetzt im Kalender-Tab (und „offen“ heißt: Tab sichtbar).
  if (dlg) {
    dlg.showModal = () => {
      if (typeof switchTab === 'function') switchTab('calendar');
    };
    Object.defineProperty(dlg, 'open', { get: () => panel.classList.contains('active'), configurable: true });
  }

  /* ---- Monate wischen: Spur mit Vor-/Hauptmonat/Nachmonat, Einrasten, Anzeige läuft mit ---- */
  let track = null,
    busy = false,
    settling = null;
  function mountTrack() {
    const grid = $('v67MonthGrid');
    if (!grid || track) return;
    track = document.createElement('div');
    track.className = 'v750-track';
    const mk = id => {
      const g = document.createElement('div');
      g.className = grid.className + ' v750-pane';
      if (id) g.id = id;
      return g;
    };
    const prev = mk(''),
      next = mk('');
    grid.parentNode.insertBefore(track, grid);
    track.append(prev, grid, next);
    grid.classList.add('v750-pane');
    track.addEventListener(
      'scroll',
      () => {
        const w = track.clientWidth || 1,
          i = Math.round(track.scrollLeft / w),
          cur = new Date(v67CalendarCursor.getFullYear(), v67CalendarCursor.getMonth() + (i - 1), 1);
        const t = $('v67MonthTitle');
        if (t) t.textContent = `${MONTHS[cur.getMonth()]} ${cur.getFullYear()}`;
        clearTimeout(settling);
        settling = setTimeout(() => {
          const j = Math.round(track.scrollLeft / w);
          if (j === 1 || busy) return;
          shift(j === 0 ? -1 : 1);
        }, 110);
      },
      { passive: true }
    );
  }
  function shift(n) {
    v67CalendarCursor = new Date(v67CalendarCursor.getFullYear(), v67CalendarCursor.getMonth() + n, 1);
    const t = todayISO(),
      c = v67CalendarCursor;
    const inMonth = iso => iso.slice(0, 7) === `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}`;
    v67SelectedDate = inMonth(t) ? t : `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-01`;
    renderV67Calendar();
  }
  /* Nach jedem Monats-Rendern: Nachbarmonate in die Seitenflächen schreiben und auf die Mitte zurückrasten. */
  function fillSides() {
    if (!track || busy) return;
    busy = true;
    try {
      const main = $('v67MonthGrid'),
        title = $('v67MonthTitle'),
        keepTitle = title ? title.textContent : '',
        keep = v67CalendarCursor;
      [track.children[0], track.children[2]].forEach((side, k) => {
        const off = k === 0 ? -1 : 1;
        v67CalendarCursor = new Date(keep.getFullYear(), keep.getMonth() + off, 1);
        main.id = '';
        side.id = 'v67MonthGrid';
        try {
          renderV67Month();
        } finally {
          side.id = '';
          main.id = 'v67MonthGrid';
        }
      });
      v67CalendarCursor = keep;
      if (title) title.textContent = keepTitle;
    } finally {
      busy = false;
    }
    const center = () => {
      if (track.clientWidth) track.scrollLeft = track.clientWidth;
    };
    center();
    requestAnimationFrame(center);
  }
  OrdiPilotExt.extend(
    'renderV67Month',
    base =>
      function () {
        const out = base.apply(this, arguments);
        if (!busy) {
          try {
            mountTrack();
            fillSides();
          } catch (e) {
            console.error('v750 Wischen', e);
          }
        }
        return out;
      }
  );

  /* ---- Import direkt unter dem Kalender ---- */
  function buildImport() {
    const host = $('v750Import');
    if (!host || host.dataset.ready) return;
    host.dataset.ready = '1';
    host.innerHTML = `<div class="v750-imp-head"><strong>Importieren</strong><small>Dienstplan &amp; Kalender</small></div>
<div class="v750-imp-row">
<button type="button" class="btn" data-v750="pdf"><b>Dienstplan (PDF)</b><small>automatisch auslesen</small></button>
<button type="button" class="btn" data-v750="last" hidden><b>Letzter Plan</b><small>erneut lesen</small></button>
<button type="button" class="btn" data-v750="cal"><b>Kalender verbinden</b><small>Dienste &amp; Urlaub</small></button>
</div><div class="help" id="v750Status" role="status" aria-live="polite"></div>`;
    window.OrdiPilotPlan?.lastName?.().then(n => {
      const b = host.querySelector('[data-v750="last"]');
      if (n && b) {
        b.hidden = false;
        b.querySelector('small').textContent = n.slice(0, 22);
      }
    });
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-v750]');
      if (!b) return;
      if (b.dataset.v750 === 'pdf') window.OrdiPilotPlan?.upload?.();
      else if (b.dataset.v750 === 'last') {
        window.OrdiPilotPlan?.reread?.().then(ok => {
          if ($('v750Status') && !ok)
            $('v750Status').textContent = 'Noch kein Plan gespeichert – bitte einmal „Dienstplan (PDF)“ wählen.';
        });
      } else {
        switchTab('settings');
        setTimeout(() => {
          const card = $('v730Card');
          if (card) {
            card.querySelector('details')?.setAttribute('open', '');
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 150);
      }
    });
    document.addEventListener('ordipilot:plan-sync', ev => {
      const el = $('v750Status');
      if (el && ev.detail?.text) el.textContent = ev.detail.text;
    });
  }

  /* ---- Liste: Klinikdienste (und Urlaub) der nächsten Wochen oberhalb der Einsätze ---- */
  function klinikList() {
    const P = window.OrdiPilotPlanCore,
      A = window.OrdiPilotPlan,
      root = $('v67ListView');
    if (!P || !A || !root) return;
    root.querySelector('.v750-klinik')?.remove();
    const rows = [];
    const d = new Date();
    for (let i = 0; i < 45; i++) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const codes = P.dayInfo(A.plan(), iso).codes.filter(c => P.DISPLAY.has(c));
      if (codes.length)
        rows.push(
          `<div class="v67-agenda-row"><div><div class="v67-agenda-time">${d.toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'short' })}</div></div><div>${codes.map(c => `<span class="v740-chip ${P.groupOf(c)}">${c}</span>`).join(' ')}</div></div>`
        );
      d.setDate(d.getDate() + 1);
    }
    if (!rows.length) return;
    const box = document.createElement('div');
    box.className = 'v67-agenda-group v750-klinik';
    box.innerHTML = `<div class="v67-agenda-date">Klinikdienste · nächste 6 Wochen</div>${rows.join('')}`;
    root.prepend(box);
  }
  OrdiPilotExt.extend(
    'renderV67Agenda',
    base =>
      function () {
        const out = base.apply(this, arguments);
        try {
          klinikList();
        } catch (e) {
          console.error('v750 Liste', e);
        }
        return out;
      }
  );

  function css() {
    if ($('v750-style')) return;
    const st = document.createElement('style');
    st.id = 'v750-style';
    st.textContent = `.v750-track{display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;overscroll-behavior-x:contain}
.v750-track::-webkit-scrollbar{display:none}
.v750-pane{flex:0 0 100%;min-width:0;scroll-snap-align:center;scroll-snap-stop:always}
.v750-import{margin-top:14px;padding:14px;border-radius:18px;background:var(--card,#fff);border:1px solid rgba(0,0,0,.06)}
.v750-imp-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
.v750-imp-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.v750-imp-row .btn{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;min-height:62px;padding:10px 12px}
.v750-imp-row small{opacity:.7;font-weight:500}
#panel-calendar .v67-cal-body{padding:0}
.tabs{display:grid!important;grid-template-columns:repeat(6,minmax(0,1fr))}
.tabs .tab{min-width:0;padding-left:2px;padding-right:2px}
.tabs .tab-label{font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}`;
    document.head.appendChild(st);
  }

  OrdiPilotBoot.add('app:dashboard', () => {
    css();
    buildImport();
    if (typeof v67SetCursor === 'function') {
      v67SelectedDate = todayISO();
      v67SetCursor(v67SelectedDate);
    }
    renderV67Calendar();
  });
})();
