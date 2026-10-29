/* ===== OrdiPilot V6.19 · Steuer-Rücklage und Vorauszahlungstermine =====
   Orientierung, keine Steuerberechnung: Rücklage = eigener Prozentsatz × vorläufiger Überschuss.
   Optional Erinnerung an die ESt-Vorauszahlungen (15.2., 15.5., 15.8., 15.11.), wenn das Finanzamt welche vorschreibt.
   Der Teil bis "Verdrahtung" ist rein funktional und wird von tests/ in Node geprüft. */
(function (root) {
  'use strict';
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  function pct(v) {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 0;
  }
  function reserve(surplus, percent) {
    const p = pct(percent);
    return p ? r2((Math.max(0, Number(surplus) || 0) * p) / 100) : 0;
  }
  const DUE = ['02-15', '05-15', '08-15', '11-15'];
  const parseDone = v =>
    String(v || '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);
  // Nächster offener Vorauszahlungstermin, wenn er höchstens `days` Tage entfernt ist (oder schon fällig und nicht erledigt, bis 10 Tage danach)
  function dueSoon(todayIso, done, days = 14) {
    const [y] = todayIso.split('-').map(Number),
      t = Date.parse(todayIso + 'T00:00:00Z'),
      d = parseDone(done);
    for (const yy of [y - 1, y, y + 1])
      for (const md of DUE) {
        const iso = `${yy}-${md}`,
          diff = Math.round((Date.parse(iso + 'T00:00:00Z') - t) / 864e5);
        if (diff <= days && diff >= -10 && !d.includes(iso)) return { date: iso, inDays: diff };
      }
    return null;
  }
  root.OrdiPilotReserveCore = { pct, reserve, dueSoon, parseDone, DUE };
})(typeof window !== 'undefined' ? window : globalThis);

/* ===== Verdrahtung ===== */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof state === 'undefined') return;
  const R = window.OrdiPilotReserveCore;
  const esc = v => escapeHtml(v);
  const eur = n => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
  const dAT = iso => {
    const [y, m, d] = String(iso).split('-');
    return `${d}.${m}.${y}`;
  };
  const touch = () => {
    state.settings._updatedAt = new Date().toISOString();
    saveState();
    try {
      window.ordipilotAutoSyncSoon && ordipilotAutoSyncSoon('einstellung');
    } catch (_) {}
  };

  window.ordipilotTaxExtra = function (rep, year) {
    const s = state.settings,
      p = R.pct(s.taxReservePct),
      t = rep.totals;
    const amount = R.reserve(t.surplus, p);
    return `<div class="v619-card" id="v619Reserve">
      <div class="v619-head"><span>Rücklage für Steuern &amp; Abgaben</span>${p ? `<b>${eur(amount)}</b>` : ''}</div>
      <label class="v619-row">Anteil vom Überschuss<span><input id="v619Pct" type="number" min="0" max="100" step="1" inputmode="decimal" value="${p || ''}" placeholder="z. B. 45"> %</span></label>
      ${p ? `<div class="v619-sub">${p} % von ${eur(Math.max(0, t.surplus))} vorläufigem Überschuss ${esc(year)}${t.open > 0 ? ` · offene Honorare (${eur(t.open)}) zählen erst bei Zahlungseingang` : ''}</div>` : '<div class="v619-sub">Prozentsatz eintragen, dann zeigt OrdiPilot, wie viel du zurücklegen solltest.</div>'}
      <label class="v619-check"><input type="checkbox" id="v619Est" ${s.estPrepayments ? 'checked' : ''}> Ich leiste Einkommensteuer-Vorauszahlungen – zum 15.2., 15.5., 15.8. und 15.11. erinnern</label>
      <div class="v619-hint">Orientierung, keine Steuerberechnung. Das Vertretungshonorar kommt zu deinem Gehalt dazu und wird deshalb meist mit deinem höchsten Steuersatz besteuert; dazu können Beiträge (z. B. Wohlfahrtsfonds, Sozialversicherung) kommen. Den Prozentsatz am besten mit dem Steuerberater festlegen.</div>
    </div>`;
  };
  OrdiPilotBoot.add('v619-reserve:1', () => {
    document.addEventListener('change', ev => {
      const t = ev.target;
      if (t.id === 'v619Pct') {
        state.settings.taxReservePct = R.pct(t.value) || 0;
        touch();
        try {
          ordipilotTax.render();
        } catch (_) {}
      }
      if (t.id === 'v619Est') {
        state.settings.estPrepayments = !!t.checked;
        touch();
        try {
          ordipilotTax.render();
        } catch (_) {}
        banner();
      }
    });
  });

  // Hinweis in der Übersicht vor dem Vorauszahlungstermin
  function banner() {
    const host = document.getElementById('panel-dashboard');
    if (!host) return;
    let el = document.getElementById('v619Due');
    const due = state.settings.estPrepayments ? R.dueSoon(todayISO(), state.settings.estDone) : null;
    if (!due) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'v619Due';
      el.className = 'v619-due no-print';
      const head = host.querySelector('.v6-page-head');
      (head || host.firstChild).insertAdjacentElement('afterend', el);
    }
    const when =
      due.inDays > 1
        ? `in ${due.inDays} Tagen`
        : due.inDays === 1
          ? 'morgen'
          : due.inDays === 0
            ? 'heute'
            : `seit ${-due.inDays} Tag${due.inDays === -1 ? '' : 'en'}`;
    const p = R.pct(state.settings.taxReservePct);
    el.innerHTML = `<div><b>ESt-Vorauszahlung ${when} fällig</b> (${dAT(due.date)})<small>Betrag laut Vorauszahlungsbescheid bzw. Erinnerung des Finanzamts${p ? ' · Rücklage siehe Honorar → Steuer' : ''}</small></div><button type="button" class="btn soft" id="v619Done">Erledigt</button>`;
    el.querySelector('#v619Done').onclick = () => {
      state.settings.estDone = [...R.parseDone(state.settings.estDone), due.date].slice(-12).join(',');
      touch();
      banner();
    };
  }
  function css() {
    if (document.getElementById('v619-style')) return;
    const st = document.createElement('style');
    st.id = 'v619-style';
    st.textContent = `.v619-card{margin:12px 0;padding:14px 16px;border-radius:16px;background:#f4f6ff;border:1px solid #e1e6ff}
.v619-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-weight:700;font-size:15px}.v619-head b{font-size:18px;color:#3a3fbf}
.v619-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;font-size:14px;font-weight:600}.v619-row span{display:flex;align-items:center;gap:6px}.v619-row input{width:84px;min-height:36px;text-align:right}
.v619-sub{font-size:13px;color:#6b7280;margin-top:6px}.v619-check{display:flex;gap:10px;align-items:flex-start;margin-top:12px;font-size:14px}.v619-check input{width:18px;height:18px;min-height:auto;margin-top:2px;flex:0 0 auto}
.v619-hint{font-size:12px;color:#8e8e93;margin-top:10px;line-height:1.4}
.v619-due{display:flex;justify-content:space-between;align-items:center;gap:12px;border-radius:16px;padding:12px 16px;margin:0 0 14px;background:#eef1ff;color:#2c2f8f;font-size:15px}.v619-due small{display:block;font-size:12px;color:#5b5f9f;margin-top:2px}.v619-due .btn{flex:0 0 auto;min-height:36px}`;
    document.head.appendChild(st);
  }
  OrdiPilotBoot.add('v619-reserve:2', () => {
    css();
  });
  OrdiPilotExt.extend(
    'refreshAll',
    baseRefresh =>
      function () {
        const out = baseRefresh.apply(this, arguments);
        try {
          banner();
        } catch (e) {
          console.warn('V6.19', e);
        }
        return out;
      }
  );
  OrdiPilotBoot.add('v619-reserve:3', () => {
    try {
      banner();
    } catch (e) {
      console.warn('V6.19', e);
    }
  });
})();
