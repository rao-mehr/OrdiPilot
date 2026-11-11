/* OrdiPilot V7.4.0 – Einheitlicher Kalender: Klinikdienste als Kürzel im Monat, Tippen zum Ändern/Entfernen/Eintragen.
   Jede Änderung geht über den gemeinsamen Kalender-Dienst (v730) in den Apple-Kalender; DienstSaldo liest ihn von dort. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof OrdiPilotBoot === 'undefined') return;
  const P = window.OrdiPilotPlanCore;
  const API = () => window.OrdiPilotPlan;
  const $ = id => document.getElementById(id);
  const esc = s =>
    String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const shift = (iso, n) => {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const prettyDay = iso =>
    new Date(iso + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' });
  const dutyCodes = iso => P.dayInfo(API().plan(), iso).codes.filter(c => P.DISPLAY.has(c));
  const chip = (code, big) =>
    `<span class="v740-chip ${P.groupOf(code)}${big ? ' big' : ''}" aria-hidden="true">${esc(code)}</span>`;

  /* ---- Monat: Kürzel statt Punkte ---- */
  function decorateMonth() {
    const grid = $('v67MonthGrid');
    if (!grid || !API()) return;
    grid.querySelectorAll('[data-v67-date]').forEach(b => {
      const iso = b.dataset.v67Date,
        codes = dutyCodes(iso),
        dots = b.querySelector('.v67-dots'),
        nV = dots ? dots.children.length : 0,
        after25 = dutyCodes(shift(iso, -1)).some(c => P.DUTY_25H.has(c));
      b.querySelector('.v740-chips')?.remove();
      if (dots) dots.style.display = 'none';
      let html = codes.map(c => chip(c)).join('');
      if (nV) html += `<span class="v740-chip vertr" aria-hidden="true">V${nV > 1 ? '×' + nV : ''}</span>`;
      if (after25) html += '<i class="v740-cont" aria-hidden="true"></i>';
      if (html) b.insertAdjacentHTML('beforeend', `<span class="v740-chips">${html}</span>`);
      const names = codes.map(c => P.TITLES[c]);
      if (nV) names.push(nV > 1 ? `${nV} Vertretungen` : 'Vertretung');
      const date = prettyDay(iso);
      b.setAttribute('aria-label', names.length ? `${date}: ${names.join(', ')}` : date);
    });
  }

  /* ---- Tag: Klinikdienste mit Status und Schaltflächen ---- */
  function pendingUids() {
    try {
      return new Set(
        API()
          .pending()
          .put.map(e => e.uid)
      );
    } catch {
      return new Set();
    }
  }
  function statusFor(code, iso, pending) {
    if (!API().ready()) return { cls: 'idle', text: 'Nur in der App (Kalender nicht eingerichtet)' };
    return pending.has(P.uidOf({ date: iso, code }))
      ? { cls: 'wait', text: 'Noch nicht im Apple-Kalender' }
      : { cls: 'ok', text: 'Im Apple-Kalender' };
  }
  function decorateDay() {
    const root = $('v67DayDetail');
    if (!root || !API()) return;
    root.querySelector('.v740-day')?.remove();
    const iso = v67SelectedDate,
      codes = dutyCodes(iso),
      pending = pendingUids();
    const rows = codes
      .map(c => {
        const st = statusFor(c, iso, pending);
        return `<div class="v740-duty">${chip(c, true)}<div class="v740-duty-main"><div class="v740-duty-title">${esc(
          P.TITLES[c]
        )}</div><div class="v740-duty-sync ${st.cls}">${esc(st.text)}</div></div><div class="v740-duty-actions"><button type="button" class="btn soft" data-v740-edit="${esc(
          c
        )}">Ändern</button><button type="button" class="btn" data-v740-del="${esc(c)}">Entfernen</button></div></div>`;
      })
      .join('');
    const html = `<div class="v740-day">${rows}<button type="button" class="btn soft v740-add" data-v740-add="1">+ Klinikdienst eintragen</button></div>`;
    const head = root.querySelector('.v67-day-head');
    (head || root).insertAdjacentHTML(head ? 'afterend' : 'afterbegin', html);
    const small = head && head.querySelector('small');
    if (small && codes.length && /Noch nichts geplant/.test(small.textContent))
      small.textContent = codes.length === 1 ? '1 Klinikdienst' : `${codes.length} Klinikdienste`;
    const empty = root.querySelector('.v67-empty-day');
    if (empty && codes.length && empty.firstChild && empty.firstChild.nodeType === 3)
      empty.firstChild.textContent = 'Keine Vertretung an diesem Tag.';
    root.querySelectorAll('[data-v740-edit]').forEach(b => (b.onclick = () => openEditor(iso, b.dataset.v740Edit)));
    root.querySelectorAll('[data-v740-del]').forEach(b => (b.onclick = () => confirmRemove(iso, b.dataset.v740Del)));
    root.querySelector('[data-v740-add]').onclick = () => openEditor(iso, null);
  }

  /* ---- Änderungen speichern + in den Kalender schreiben ---- */
  function refresh() {
    if (typeof renderV67Calendar === 'function') renderV67Calendar();
    updateBar();
  }
  async function commit(next) {
    API().setPlan(next);
    refresh();
    await API().sync(); // meldet das Ergebnis über das Ereignis „ordipilot:plan-sync“
  }

  /* ---- Dialoge ---- */
  function dialog(html, onClose) {
    const d = document.createElement('dialog');
    d.className = 'v730-dialog v740-dialog';
    d.innerHTML = `<form method="dialog" class="modal">${html}</form>`;
    d.addEventListener('close', () => {
      onClose(d.returnValue, d);
      d.remove();
    });
    document.body.appendChild(d);
    d.showModal();
    return d;
  }
  function leaveInfo(iso) {
    dialog(
      `<div class="v730-body"><h3>Urlaub</h3><p>${esc(
        prettyDay(iso)
      )}</p><p class="help">Urlaub liest die App aus dem iCloud-Kalender „Urlaub Raouf“ (von–bis). Bitte dort ändern oder löschen – hier wird es beim nächsten Abgleich übernommen.</p></div><div class="modal-actions"><button class="btn primary" value="ok">OK</button></div>`,
      () => {}
    );
  }
  function openEditor(iso, from) {
    if (from === 'U') return leaveInfo(iso);
    let pick = from;
    const buttons = P.PICKER.map(
      c =>
        `<button type="button" class="v740-pick${c === from ? ' on' : ''}" data-v740-pick="${c}" aria-pressed="${
          c === from
        }">${chip(c, true)}<span>${esc(P.TITLES[c].replace(/^25 Stunden Dienst /, '25 h '))}</span></button>`
    ).join('');
    const d = dialog(
      `<div class="v730-body"><h3>${from ? 'Dienst ändern' : 'Klinikdienst eintragen'}</h3><p class="help">${esc(
        prettyDay(iso)
      )}</p><div class="v740-picks">${buttons}</div><p class="help" id="v740PickInfo"></p></div><div class="modal-actions"><button class="btn" value="cancel">Abbrechen</button><button class="btn primary" value="ok" id="v740Save" disabled>Speichern</button></div>`,
      ret => {
        if (ret !== 'ok' || !pick || pick === from) return;
        const plan = API().plan();
        commit(from ? P.replaceEntry(plan, iso, from, pick) : P.addEntry(plan, iso, pick));
      }
    );
    const info = d.querySelector('#v740PickInfo'),
      save = d.querySelector('#v740Save');
    const sync = () => {
      d.querySelectorAll('[data-v740-pick]').forEach(b => {
        const on = b.dataset.v740Pick === pick;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      const taken = pick && pick !== from && dutyCodes(iso).includes(pick);
      info.textContent = taken
        ? 'Dieser Dienst steht an diesem Tag schon im Plan.'
        : pick
          ? `Kalendereintrag: „${P.TITLES[pick]}“ (ganztägig am ${prettyDay(iso)}).`
          : 'Bitte Dienst wählen.';
      save.disabled = !pick || pick === from || taken;
    };
    d.querySelectorAll('[data-v740-pick]').forEach(b => (b.onclick = () => ((pick = b.dataset.v740Pick), sync())));
    sync();
  }
  function confirmRemove(iso, code) {
    if (code === 'U') return leaveInfo(iso);
    dialog(
      `<div class="v730-body"><h3>Dienst entfernen?</h3><p><b>${esc(P.TITLES[code])}</b><br>${esc(
        prettyDay(iso)
      )}</p><p class="help">Der Eintrag wird auch aus dem Apple-Kalender gelöscht. In DienstSaldo verschwindet er beim nächsten Abgleich mit dem Kalender.</p></div><div class="modal-actions"><button class="btn" value="cancel">Abbrechen</button><button class="btn primary" value="ok">Entfernen</button></div>`,
      ret => {
        if (ret === 'ok') commit(P.removeEntry(API().plan(), iso, code));
      }
    );
  }

  /* ---- Statuszeile über dem Tag ---- */
  let lastError = '';
  function updateBar() {
    const view = $('v67MonthView');
    if (!view || !API()) return;
    let el = $('v740Sync');
    if (!el) {
      el = document.createElement('div');
      el.id = 'v740Sync';
      el.className = 'v740-sync';
      el.setAttribute('role', 'status');
      const card = view.querySelector('.v67-month-card');
      (card || view).insertAdjacentElement(card ? 'afterend' : 'afterbegin', el);
    }
    let cls = 'ok',
      text = 'Apple-Kalender abgeglichen',
      action = '';
    if (!API().ready()) {
      cls = 'idle';
      text = 'Apple-Kalender nicht eingerichtet – nur in der App gespeichert.';
    } else {
      const p = API().pending(),
        n = p.put.length + p.del.length;
      if (lastError) {
        cls = 'wait';
        text = lastError;
        action = 'Erneut versuchen';
      } else if (n) {
        cls = 'wait';
        text = n === 1 ? '1 Änderung noch nicht im Apple-Kalender' : `${n} Änderungen noch nicht im Apple-Kalender`;
        action = 'Jetzt abgleichen';
      }
    }
    el.className = 'v740-sync ' + cls;
    el.innerHTML = `<span class="v740-dot"></span><span class="v740-sync-text">${esc(text)}</span>${
      action ? `<button type="button" class="btn soft" id="v740Retry">${action}</button>` : ''
    }`;
    const r = $('v740Retry');
    if (r) r.onclick = () => API().sync();
  }
  document.addEventListener('ordipilot:plan-sync', ev => {
    lastError = ev.detail && ev.detail.bad ? ev.detail.text : '';
    updateBar();
    if (typeof renderV67Day === 'function' && $('v67CalendarDialog')?.open) renderV67Day();
  });

  /* Offene Änderungen automatisch nachreichen (App öffnen, wieder online, Kalender öffnen) */
  function catchUp() {
    try {
      if (!API() || !API().ready()) return;
      if (state.settings.planCalendarAuto === false) return;
      const p = API().pending();
      if (p.put.length || p.del.length) API().sync();
    } catch (e) {
      console.error('v740 Nachreichen', e);
    }
  }
  window.addEventListener('online', catchUp);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && catchUp());

  function css() {
    const s = document.createElement('style');
    s.textContent = `
.v740-chips{display:flex;flex-direction:column;align-items:center;gap:2px;width:100%}
.v740-chip{display:block;min-width:36px;text-align:center;border-radius:7px;padding:2px 4px;font-size:10.5px;font-weight:800;line-height:1.35;box-sizing:border-box;border:1.5px solid transparent}
.v740-chip.g25{background:#155ac4;color:#fff;border-color:#155ac4}
.v740-chip.long{background:#fbd38d;color:#4a2e00;border-color:#e6a23c}
.v740-chip.leave{background:#17734b;color:#fff;border-color:#17734b}
.v740-chip.vertr{background:#fff;color:#5b34b0;border-color:#7c4ddb}
.v740-chip.big{min-width:44px;padding:6px 4px;font-size:13px;border-radius:9px}
.v740-cont{display:block;width:26px;height:4px;border-radius:2px;background:#9dbff0}
.v67-cal-day{min-height:58px;height:auto}
.v740-day{display:flex;flex-direction:column;gap:8px;margin:8px 0}
.v740-duty{display:flex;align-items:center;gap:10px;background:#f4f7fb;border-radius:14px;padding:10px 12px;flex-wrap:wrap}
.v740-duty-main{flex:1;min-width:140px}
.v740-duty-title{font-size:14px;font-weight:700;line-height:1.3}
.v740-duty-sync{font-size:12px;margin-top:2px}
.v740-duty-sync.ok{color:#17734b}.v740-duty-sync.wait{color:#8a5a00}.v740-duty-sync.idle{color:#4b5563}
.v740-duty-actions{display:flex;gap:6px}
.v740-duty-actions .btn,.v740-add,.v740-sync .btn{min-height:44px}
.v740-picks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}
.v740-pick{display:flex;align-items:center;gap:8px;min-height:48px;padding:6px 8px;border:1.5px solid #d1d5db;border-radius:12px;background:#fff;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.v740-pick.on{border-color:#0a84ff;background:#eaf4ff}
.v740-sync{display:flex;align-items:center;gap:8px;margin:8px 0 0;padding:8px 12px;border-radius:12px;font-size:12.5px;font-weight:600}
.v740-sync.ok{background:#eaf7f0;color:#17734b}.v740-sync.wait{background:#fff8eb;color:#4a2e00;border:1.5px solid #e6a23c}.v740-sync.idle{background:#f2f2f7;color:#4b5563}
.v740-sync-text{flex:1}
.v740-dot{width:9px;height:9px;border-radius:50%;background:currentColor;flex:none}
`;
    document.head.appendChild(s);
  }

  OrdiPilotExt.extend(
    'renderV67Month',
    base =>
      function () {
        const out = base.apply(this, arguments);
        try {
          decorateMonth();
        } catch (e) {
          console.error('v740 Monat', e);
        }
        return out;
      }
  );
  OrdiPilotExt.extend(
    'renderV67Day',
    base =>
      function () {
        const out = base.apply(this, arguments);
        try {
          decorateDay();
        } catch (e) {
          console.error('v740 Tag', e);
        }
        return out;
      }
  );
  OrdiPilotExt.extend(
    'openV67Calendar',
    base =>
      function () {
        const out = base.apply(this, arguments);
        try {
          updateBar();
          catchUp();
        } catch (e) {
          console.error('v740 Öffnen', e);
        }
        return out;
      }
  );

  OrdiPilotBoot.add('v740:1', () => {
    css();
    setTimeout(catchUp, 4000);
  });
})();
