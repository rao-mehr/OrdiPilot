/* ===== OrdiPilot V6.16 · Automatik =====
   1. Standort-Automatik: iPhone-Kurzbefehle schreiben Ankunft/Abfahrt an der Ordination (und „Klinik verlassen“)
      als Zeile in Dropbox. Beim Sync werden daraus Zeiten für den Einsatz, fehlende Einsätze und „ab Arbeit“-Fahrten.
   2. Zahlungsnachweise in Dropbox markieren den Monat automatisch als bezahlt.
   3. Monatsende-Hinweis für die Honorarnote.
   Der Teil bis "Verdrahtung" ist rein funktional und wird von tests/ in Node geprüft. */
(function (root) {
  'use strict';
  const EVENTS = {
    ankunft: 'arrive',
    arrive: 'arrive',
    abfahrt: 'leave',
    leave: 'leave',
    klinik: 'work',
    klinik_ab: 'work',
    arbeit: 'work',
    work: 'work',
  };
  // Zeile: "2026-10-28T08:47:12+01:00 ankunft" oder "28.10.2026, 08:47 ankunft"
  function parseLog(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      let m = line.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})\S*\s+([A-Za-zäöü_]+)/),
        date,
        time,
        word;
      if (m) {
        date = `${m[1]}-${m[2]}-${m[3]}`;
        time = `${m[4].padStart(2, '0')}:${m[5]}`;
        word = m[6];
      } else {
        m = line.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s+(\d{1,2}):(\d{2})\S*\s+([A-Za-zäöü_]+)/);
        if (!m) continue;
        date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        time = `${m[4].padStart(2, '0')}:${m[5]}`;
        word = m[6];
      }
      const type = EVENTS[word.toLowerCase()];
      if (type) out.push({ date, time, type });
    }
    return out;
  }
  const tm = t => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  // Pro Tag: erste Ankunft, letzte Abfahrt danach, „ab Arbeit“ wenn die Klinik höchstens 3 h vor Ankunft verlassen wurde
  function summarize(events) {
    const days = new Map();
    for (const e of events) {
      if (!days.has(e.date)) days.set(e.date, []);
      days.get(e.date).push(e);
    }
    const out = [];
    for (const [date, list] of days) {
      list.sort((a, b) => tm(a.time) - tm(b.time));
      const arrive = list.find(e => e.type === 'arrive');
      if (!arrive) continue;
      const leave = [...list].reverse().find(e => e.type === 'leave' && tm(e.time) > tm(arrive.time));
      const work = [...list]
        .reverse()
        .find(e => e.type === 'work' && tm(e.time) <= tm(arrive.time) && tm(arrive.time) - tm(e.time) <= 180);
      out.push({ date, arrive: arrive.time, leave: leave?.time || '', fromWork: !!work });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  // Texte für die Einrichtung per „Kurzbefehl beschreiben“ (iOS 27) – zum Kopieren
  function guideTexts(log, ord, work) {
    const sc = (name, word) => ({
      name,
      word,
      prompt: `Nimm das aktuelle Datum und formatiere es als ISO 8601 mit Uhrzeit. Erstelle einen Text aus dem formatierten Datum, einem Leerzeichen und dem Wort ${word}. Hänge diesen Text als neue Zeile an die Dropbox-Datei ${log} an.`,
    });
    const shortcuts = [
      sc('OrdiPilot Ankunft', 'ankunft'),
      sc('OrdiPilot Abfahrt', 'abfahrt'),
      sc('OrdiPilot Klinik', 'klinik'),
    ];
    const au = (label, place, verb, name) => ({
      label,
      prompt: `Wenn ich ${place} ${verb}, führe sofort und ohne Nachfrage den Kurzbefehl „${name}“ aus. Keine weiteren Aktionen.`,
    });
    return {
      shortcuts,
      automations: [
        au('Ankommen Ordination', `bei ${ord}`, 'ankomme', 'OrdiPilot Ankunft'),
        au('Verlassen Ordination', ord, 'verlasse', 'OrdiPilot Abfahrt'),
        au('Verlassen Arbeit', work, 'verlasse', 'OrdiPilot Klinik'),
      ],
      monthEnd: 'Zeige am letzten Tag jedes Monats um 18:00 Uhr die Mitteilung „Honorarnote erstellen“.',
    };
  }
  // Zahlungsnachweis-Dateien → bezahlte Monate (Jahr der Zahlung = Jahr, in dem der Nachweis abgelegt wurde)
  function proofsToMonths(files) {
    const out = [];
    for (const f of files || []) {
      const m = String(f.name || '').match(/^(\d{4})-(\d{2})_Zahlungsnachweis/i);
      if (m)
        out.push({
          ym: `${m[1]}-${m[2]}`,
          paidYear: String(f.client_modified || f.server_modified || '').slice(0, 4) || m[1],
          file: f.name,
        });
    }
    return out;
  }
  root.OrdiPilotAutoCore = { parseLog, summarize, proofsToMonths, guideTexts };
})(typeof window !== 'undefined' ? window : globalThis);

/* ===== Verdrahtung mit der App ===== */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof state === 'undefined') return;
  const A = window.OrdiPilotAutoCore;
  const ROOT = '/Ordination & Selbständigkeit/Vertretungsdienste';
  const LOG = ROOT + '/System/Import/standort.txt';
  const esc = v => escapeHtml(v);
  const now = () => new Date().toISOString();
  const primaryRid = () => (state.settings.recipients || [])[0]?.id || 'recipient-primary';
  const locked = e => {
    try {
      return (
        !!window.ordipilotRecipientMonthLocked &&
        window.ordipilotRecipientMonthLocked(e.date.slice(0, 7), e.recipientId || primaryRid())
      );
    } catch (_) {
      return false;
    }
  };
  let lastNote = '';

  // ---- 1. Standort ----
  function applyGeo(days) {
    let created = 0,
      updated = 0,
      work = 0;
    if (!Array.isArray(state.trips)) state.trips = [];
    if (!state.deletedTrips) state.deletedTrips = {};
    for (const d of days) {
      let e = (state.entries || []).find(x => x.date === d.date);
      if (!e) {
        const id = 'geo-' + d.date;
        if (state.deletedEntries && state.deletedEntries[id]) continue; // bewusst gelöscht – nicht wieder anlegen
        e = {
          id,
          date: d.date,
          start: '',
          end: '',
          plannedStart: d.arrive,
          plannedEnd: d.leave || '',
          breakMinutes: 0,
          manualHours: null,
          rate: Number(state.settings.defaultRate || 0),
          note: 'automatisch erkannt (Standort)',
          planningOnly: true,
          confirmedAt: null,
          recipientId: primaryRid(),
          source: 'geo',
          updatedAt: now(),
        };
        state.entries.push(e);
        created++;
      }
      if (e.confirmedAt || locked(e)) continue; // bestätigte/abgerechnete Einsätze bleiben unangetastet
      if (e.geoArrive !== d.arrive || e.geoLeave !== d.leave || e.geoFromWork !== d.fromWork) {
        e.geoArrive = d.arrive;
        e.geoLeave = d.leave;
        e.geoFromWork = d.fromWork;
        e.updatedAt = now();
        updated++;
      }
      if (d.fromWork) {
        const id = 'trip-' + e.id,
          cur = state.trips.find(t => t.id === id);
        if (!cur || (cur.auto && cur.mode !== 'work')) {
          state.trips = state.trips
            .filter(t => t.id !== id)
            .concat([{ id, entryId: e.id, mode: 'work', km: null, auto: true, updatedAt: now() }]);
          delete state.deletedTrips[id];
          work++;
        }
      }
    }
    return { created, updated, work };
  }
  async function importGeo() {
    if (!isDropboxConnected()) return;
    const blob = await dbxDownload(LOG);
    if (!blob) return;
    const days = A.summarize(A.parseLog(await blob.text())).filter(
      d => d.date >= addDaysISO(todayISO(), -60) && d.date <= todayISO()
    );
    const r = applyGeo(days);
    state.settings.geoLastEvent = days.length
      ? days[days.length - 1].date + ' ' + (days[days.length - 1].leave || days[days.length - 1].arrive)
      : state.settings.geoLastEvent || '';
    if (r.created || r.updated)
      lastNote = `Standort: ${r.created ? r.created + ' Einsatz neu erkannt' : ''}${r.created && r.updated ? ', ' : ''}${r.updated ? r.updated + ' Zeiten übernommen' : ''}`;
  }
  function addDaysISO(iso, n) {
    const [y, m, d] = iso.split('-').map(Number),
      x = new Date(y, m - 1, d + n);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }

  // ---- 2. Zahlungsnachweise ----
  async function importProofs() {
    if (!isDropboxConnected()) return;
    if (!Array.isArray(state.payments)) state.payments = [];
    const y = new Date().getFullYear(),
      files = [];
    for (const yr of [y - 1, y]) {
      try {
        const r = await dbxRpc('files/list_folder', { path: `${ROOT}/Zahlungsnachweise/${yr}`, recursive: false });
        files.push(...(r.entries || []).filter(x => x['.tag'] === 'file'));
      } catch (e) {
        if (!/not_found/.test(String(e.message || e))) console.warn(e);
      }
    }
    let n = 0;
    for (const p of A.proofsToMonths(files)) {
      const key = `${p.ym}::${primaryRid()}`;
      if (state.payments.some(x => x.key === key)) continue;
      const id = 'pay-proof-' + p.ym;
      if (state.deletedPayments && state.deletedPayments[id]) continue;
      const gross = (state.entries || [])
        .filter(
          e => e.date?.startsWith(p.ym + '-') && isEarnedEntry(e) && (e.recipientId || primaryRid()) === primaryRid()
        )
        .reduce((t, e) => t + (window.gross(e) || 0), 0);
      if (!(gross > 0)) continue;
      state.payments.push({
        id,
        key,
        paidAt: '',
        paidYear: p.paidYear,
        amount: Math.round(gross * 100) / 100,
        note: `automatisch: ${p.file}`,
        source: 'proof',
        updatedAt: now(),
      });
      n++;
    }
    if (n)
      lastNote =
        (lastNote ? lastNote + ' · ' : '') +
        `${n} Monat${n === 1 ? '' : 'e'} per Zahlungsnachweis als bezahlt markiert`;
  }
  OrdiPilotBoot.add('v616-auto:1', () => {
    (window.ordipilotSyncHooksAsync = window.ordipilotSyncHooksAsync || []).push(async () => {
      lastNote = '';
      try {
        await importGeo();
      } catch (e) {
        console.warn('Standort-Import', e);
      }
      try {
        await importProofs();
      } catch (e) {
        console.warn('Zahlungsnachweise', e);
      }
    });
  });
  window.ordipilotAutoNote = () => lastNote;

  // Bestätigen: erkannte Zeiten vorausfüllen
  OrdiPilotExt.extend(
    'openEntry',
    baseOpen =>
      function (id, mode, date) {
        const out = baseOpen.apply(this, arguments);
        try {
          const e = id && (state.entries || []).find(x => x.id === id);
          // erkannte (tatsächliche) Zeiten haben Vorrang vor der geplanten Zeit, aber nicht vor schon eingetragenen anderen Werten
          const planned = v => !v || v === e.plannedStart || v === e.plannedEnd || v === e.start || v === e.end;
          if (e && e.geoArrive && !e.confirmedAt && window.fStart && planned(fStart.value)) {
            fStart.value = e.geoArrive;
            if (e.geoLeave && window.fEnd && planned(fEnd.value)) fEnd.value = e.geoLeave;
            [fStart, fEnd].forEach(x => x && x.dispatchEvent(new Event('input', { bubbles: true })));
          }
        } catch (_) {}
        return out;
      }
  );

  // Einsatzkarte: Hinweis auf erkannte Zeiten
  OrdiPilotExt.extend(
    'renderEntries',
    base =>
      function () {
        const out = base.apply(this, arguments);
        try {
          for (const card of document.querySelectorAll('#entryCards .v611-entry-card[data-entry-id]')) {
            const e = (state.entries || []).find(x => x.id === card.dataset.entryId);
            if (!e || !e.geoArrive || e.confirmedAt || card.querySelector('.v616-geo')) continue;
            const t = card.querySelector('.v611-time');
            if (t)
              t.insertAdjacentHTML(
                'afterend',
                `<div class="v616-geo">📍 erkannt ${esc(e.geoArrive)}${e.geoLeave ? '–' + esc(e.geoLeave) : ''}${e.geoFromWork ? ' · ab Arbeit' : ''} – zum Übernehmen bestätigen</div>`
              );
          }
        } catch (e) {
          console.warn(e);
        }
        return out;
      }
  );

  // ---- 3. Monatsende ----
  function monthEndBanner() {
    const host = document.getElementById('panel-dashboard');
    if (!host) return;
    let el = document.getElementById('v616MonthEnd');
    const t = todayISO(),
      [y, m, d] = t.split('-').map(Number),
      last = new Date(y, m, 0).getDate();
    let ty = y,
      tm = m;
    if (d <= 7) {
      tm = m - 1;
      if (!tm) {
        tm = 12;
        ty = y - 1;
      }
    }
    const due = d >= last - 2 || d <= 7,
      key = `${ty}-${String(tm).padStart(2, '0')}`;
    const done = (state.entries || []).filter(e => e.date?.startsWith(key + '-') && isEarnedEntry(e)).length;
    const rec = (state.invoices || []).find(r => r.key === `${key}::${primaryRid()}` || r.key === key);
    const show = due && done > 0 && !(rec && (rec.createdAt || rec.signedAt));
    if (!show) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('button');
      el.id = 'v616MonthEnd';
      el.type = 'button';
      el.className = 'v616-monthend';
      const head = host.querySelector('.v6-page-head');
      (head || host.firstChild).insertAdjacentElement('afterend', el);
      el.onclick = () => {
        document.querySelector('[data-tab=invoice]')?.click();
        try {
          invYear.value = String(ty);
          invMonth.value = String(tm).padStart(2, '0');
          invMonth.dispatchEvent(new Event('change'));
        } catch (_) {}
      };
    }
    el.innerHTML = `<b>Monatsende:</b> Honorarnote ${MONTHS[tm - 1]} ${ty} erstellen <span>›</span>`;
  }

  // ---- Einrichtung (Parken → Automatik) ----
  function guide() {
    const auto = document.querySelector('#panel-parking .v62-auto-card');
    if (!auto) return;
    let el = document.getElementById('v616Guide');
    const wasOpen = el?.open;
    if (!el) {
      el = document.createElement('details');
      el.id = 'v616Guide';
      el.className = 'v615-nopark-card no-print';
      (document.getElementById('v615NoPark') || auto).insertAdjacentElement('afterend', el);
    }
    const lastEv = state.settings.geoLastEvent;
    const ord = state.settings.calendarEventLocation || 'Adresse der Ordination';
    const work = state.settings.travelWork || 'Adresse deines Arbeitsplatzes';
    const T = A.guideTexts(LOG, ord, work);
    const copy = (label, text) =>
      `<div class="v618-copy"><div class="v618-copy-label">${esc(label)}</div><div class="v618-copy-row"><code>${esc(text)}</code><button type="button" class="btn soft" data-copy="${esc(text)}">Kopieren</button></div></div>`;
    el.innerHTML = `<summary><span>Standort-Automatik (iPhone)</span><span style="color:#8e8e93;font-weight:650;font-size:13px">${lastEv ? 'zuletzt ' + esc(dateAT(lastEv.slice(0, 10))) + ' ' + esc(lastEv.slice(11)) : 'nicht eingerichtet'} ›</span></summary>
    <div class="v615-nopark-list v616-guide">
      <p>Das iPhone meldet Ankunft und Abfahrt an der Ordination automatisch in Dropbox. OrdiPilot übernimmt daraus beim nächsten Sync die Zeiten, legt vergessene Einsätze zum Bestätigen an und erkennt Fahrten „ab Arbeit“. Alles wird nur kopiert und eingefügt (iOS 27, „Kurzbefehl beschreiben“).</p>
      <p><b>1. Drei Kurzbefehle</b> – je: Kurzbefehle → <b>+</b> → Prompt einfügen → erstellen, dann oben auf den Namen tippen → <b>Umbenennen</b>.</p>
      ${T.shortcuts.map(x => copy('Name', x.name) + copy('Prompt', x.prompt)).join('<hr class="v618-sep">')}
      <p class="help">Prüfen: drei Aktionen – Aktuelles Datum · Datum formatieren · <b>Anfügen</b> mit Dropbox-Symbol, „Neue Zeile erstellen“ an.</p>
      <p><b>2. Drei Automationen</b> – je: Kurzbefehle → <b>+</b> → Prompt einfügen.</p>
      ${T.automations.map(x => copy(x.label, x.prompt)).join('')}
      ${state.settings.travelWork ? '' : '<p class="help">Tipp: Unter <b>Honorar → Fahrten</b> den Arbeitsplatz mit Adresse eintragen, dann steht er hier fertig im Prompt.</p>'}
      <p class="help">Prüfen: einzige Aktion ist „OrdiPilot … ausführen“ (keine Karten-Route), Eingabe leer. Setzt iOS den Ort nicht selbst: <b>+</b> → Auslöser <b>Ankommen</b>/<b>Verlassen</b> → Adresse einfügen → <b>Sofort ausführen</b> → Aktion „Kurzbefehl ausführen“.</p>
      <p><b>3. Ortung erlauben:</b> Einstellungen → Datenschutz → Ortungsdienste → Kurzbefehle → <b>Immer</b>.</p>
      <p><b>4. Test:</b> Bei „OrdiPilot Klinik“ einmal ▶︎ tippen – in Dropbox erscheint eine Zeile in <code>standort.txt</code> (eine einzelne „klinik“-Zeile legt keinen Einsatz an). Nach dem ersten echten Dienst steht oben „zuletzt …“.</p>
      ${copy('Pfad der Datei', LOG)}
      <p class="help">Bestätigte und abgerechnete Einsätze werden nie verändert. Erkannte Zeiten erscheinen beim Einsatz mit 📍 und werden erst beim Bestätigen übernommen. Ein gelöschter, automatisch erkannter Einsatz wird nicht wieder angelegt. Nie mit „ankunft“/„abfahrt“ testen – das würde für heute Zeiten vorschlagen.</p>
      <p class="help"><b>Zahlungsnachweise:</b> Liegt in Dropbox unter Zahlungsnachweise/&lt;Jahr&gt; eine Datei „JJJJ-MM_Zahlungsnachweis…“, wird der Monat automatisch als bezahlt markiert.</p>
      <p class="help"><b>Monatsende:</b> In den letzten Tagen des Monats erinnert die Übersicht an die Honorarnote. Zusätzlich als Kurzbefehl (Kurzbefehle → <b>+</b>):</p>
      ${copy('Prompt Monatsende', T.monthEnd)}
    </div>`;
    if (wasOpen) el.open = true;
    el.querySelectorAll('[data-copy]').forEach(
      b =>
        (b.onclick = async () => {
          const t = b.dataset.copy;
          try {
            await navigator.clipboard.writeText(t);
            b.textContent = 'Kopiert ✓';
            setTimeout(() => {
              b.textContent = 'Kopieren';
            }, 1800);
          } catch (_) {
            prompt('Kopieren:', t);
          }
        })
    );
  }

  // ---- Logo in der Kopfzeile ----
  function logo() {
    const mark = document.querySelector('.logo.brand-mark');
    if (!mark || mark.dataset.v616) return;
    mark.dataset.v616 = '1';
    mark.innerHTML =
      '<svg viewBox="0 0 1024 1024" aria-hidden="true" style="width:84%;height:84%"><path d="M 763.8 503.2 A 252 252 0 1 1 564.4 265.5" fill="none" stroke="#fff" stroke-width="76" stroke-linecap="round"/><path d="M 802.7 268.1 L 698.8 473.7 L 676.9 373.6 L 582.2 334.7 Z" fill="#fff" stroke="#fff" stroke-width="26" stroke-linejoin="round"/><circle cx="512" cy="512" r="56" fill="#fff"/></svg>';
  }

  function css() {
    if (document.getElementById('v616-style')) return;
    const st = document.createElement('style');
    st.id = 'v616-style';
    st.textContent = `.v616-geo{font-size:12px;font-weight:650;color:#5e5ce6;margin-top:4px}
.v616-monthend{width:100%;display:flex;justify-content:space-between;align-items:center;gap:10px;border:0;border-radius:16px;padding:14px 16px;margin:0 0 14px;background:linear-gradient(100deg,#fff1dc,#fff7ec);color:#7a4a00;font-size:15px;text-align:left;box-shadow:0 6px 18px rgba(255,149,0,.16)}
.v616-monthend span{font-size:22px;color:#c77700}
.v616-guide p{margin:8px 0;font-size:14px}.v616-guide ol{margin:6px 0 10px;padding-left:20px;font-size:14px;display:grid;gap:6px}
.v616-guide code{font-size:12px;background:#f2f2f7;border-radius:6px;padding:1px 5px;word-break:break-all}
.v616-path{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.v616-path code{flex:1 1 220px}
.v618-copy{margin:6px 0}.v618-copy-label{font-size:12px;font-weight:700;color:#8e8e93;margin-bottom:2px}.v618-copy-row{display:flex;gap:8px;align-items:center}.v618-copy-row code{flex:1;display:block;padding:6px 8px!important;line-height:1.4;font-family:inherit;font-size:13px!important;word-break:normal!important;overflow-wrap:anywhere;user-select:all;-webkit-user-select:all}.v618-copy-row .btn{flex:0 0 auto;min-height:36px;padding:6px 12px}.v618-sep{border:0;border-top:1px solid #e5e5ea;margin:10px 0}
.logo.brand-mark{background:linear-gradient(135deg,#2f8cff,#3b3fd6)!important}`;
    document.head.appendChild(st);
  }

  OrdiPilotExt.extend(
    'refreshAll',
    baseRefresh =>
      function () {
        const out = baseRefresh.apply(this, arguments);
        try {
          monthEndBanner();
          guide();
        } catch (e) {
          console.warn('V6.16', e);
        }
        return out;
      }
  );
  OrdiPilotBoot.add('v616-auto:2', () => {
    css();
    logo();
    try {
      monthEndBanner();
      guide();
      renderEntries();
    } catch (e) {
      console.warn('V6.16', e);
    }
  });
  window.ordipilotV616 = { applyGeo, importGeo, importProofs, monthEndBanner };
})();
