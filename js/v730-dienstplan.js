/* ===== OrdiPilot V7.3 · Dienstplan-Import (Klinikdienste) =====
   Dienstplan-PDF der Abteilung hochladen → die eigene Zeile wird über den Namen aus den Einstellungen erkannt
   → Dienste erscheinen in der App (Hinweis beim Planen von Einsätzen) und im Apple-Kalender.
   Kalender: Schreiben und Löschen laufen über den gemeinsamen Kalender-Dienst von DienstSaldo
   (POST /api/plan-push, Bearer-Token). Er legt nie etwas doppelt an: steht Datum + Titel schon im Kalender,
   bleibt der Eintrag unverändert und die App meldet „bereits vorhanden“.
   Gleiche Kürzel, gleiche Kalendertitel und gleiche Regeln wie DienstSaldo.
   Der Teil bis "Verdrahtung" ist rein funktional und wird von tests/ in Node geprüft. */
(function (root) {
  'use strict';
  const MONTHS = {
    jän: 1,
    jan: 1,
    feb: 2,
    mär: 3,
    mar: 3,
    apr: 4,
    mai: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    okt: 10,
    nov: 11,
    dez: 12,
  };
  const DUTY = new Set(['HO', 'HT', 'OA', 'S', 'A1', 'A2', 'A4', 'LO', 'LT']);
  const DUTY_25H = new Set(['HO', 'HT', 'OA', 'S', 'A1', 'A2']);
  // Diese Kürzel werden gemerkt (für Hinweise beim Planen); alles andere im Plan (#, Spezial, Zahlen, Fachrichtung) nicht.
  const KEEP = new Set([...DUTY, 'U', 'C', 'SU', 'WR', 'AD', 'DF']);
  // Nur diese kommen in den Kalender (wie DienstSaldo: keine Wochenruhe, kein Kongress).
  // Urlaub steht in einem eigenen iCloud-Kalender ("Urlaub Raouf", von–bis) und wird von dort gelesen, nicht geschrieben.
  const CALENDAR = new Set([...DUTY]);
  // Feste Kalendertitel – identisch mit DienstSaldo, damit beide Apps dieselben Termine erkennen.
  const TITLES = Object.freeze({
    HO: '25 Stunden Dienst (Hauptdienst Orthopädie)',
    S: '25 Stunden Dienst (Schockdienst)',
    HT: '25 Stunden Dienst (Hauptdienst Trauma)',
    OA: '25 Stunden Dienst (Oberarztdienst)',
    A1: '25 Stunden Dienst (Ambulanzdienst A1)',
    A2: '25 Stunden Dienst (Ambulanzdienst A2)',
    A4: 'Langer Dienst (A4)',
    LT: 'Langer Dienst (LT)',
    LO: 'Langer Dienst (LO)',
    U: 'Urlaub Raouf',
  });
  const LABELS = Object.freeze({
    WR: 'Wochenruhe',
    AD: 'Außer Dienst (nach Dienst)',
    C: 'Kongress',
    SU: 'Sonderurlaub',
    DF: 'Dienstfrei',
  });

  const pad = n => String(n).padStart(2, '0');
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cx = w => w.x + (w.w || 0) / 2;

  function detectMonth(items) {
    for (const it of items) {
      const m = /^(Jän|Jan|Feb|Mär|Mar|Apr|Mai|Jun|Jul|Aug|Sep|Okt|Nov|Dez)[a-z]*\.?\s*(\d{2}|\d{4})$/i.exec(
        String(it.str).trim()
      );
      if (m) {
        const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
        return `${y}-${pad(MONTHS[m[1].toLowerCase().normalize('NFC')])}`;
      }
    }
    return null;
  }
  const isPreliminary = items => items.some(i => /VORL[ÄA]UFIG/i.test(String(i.str)));

  /* items: Textelemente {str, x, w, top} einer Seite. → {month, days:{1:['S'],…}} oder null,
     wenn die Seite kein Plan ist oder keine Zeile mit dem Namen enthält. Spalten kommen aus der Tageskopfzeile 01..31. */
  function parsePage(items, name) {
    const month = detectMonth(items);
    if (!month) return null;
    const [y, mo] = month.split('-').map(Number),
      n = daysIn(y, mo);
    const nums = items.filter(i => /^\d\d$/.test(String(i.str).trim())).sort((a, b) => a.top - b.top || a.x - b.x);
    const rows = [];
    for (const w of nums) {
      const r = rows.find(r => Math.abs(r.top - w.top) < 3);
      if (r) r.items.push(w);
      else rows.push({ top: w.top, items: [w] });
    }
    let seq = null;
    for (const r of rows.sort((a, b) => a.top - b.top)) {
      const s = [];
      let exp = 1;
      for (const w of r.items.sort((a, b) => a.x - b.x)) {
        if (Number(w.str) === exp && exp <= n) {
          s.push({ c: cx(w), d: exp });
          exp++;
        }
      }
      if (s.length === n) {
        seq = s;
        break;
      }
    }
    if (!seq) return null;
    const pitch = (seq[n - 1].c - seq[0].c) / (n - 1);
    const nm = String(name || '')
      .trim()
      .toLowerCase();
    if (!nm) return null;
    const me = items.find(i => String(i.str).trim().toLowerCase().startsWith(nm));
    if (!me) return null;
    const days = {};
    for (const w of items) {
      if (Math.abs(w.top - me.top) >= 3 || w === me) continue;
      const c = cx(w);
      if (c < seq[0].c - pitch * 0.6 || c > seq[n - 1].c + pitch * 0.6) continue;
      for (const tok of String(w.str).split(/\s+/).filter(Boolean)) {
        const col = seq.reduce((b, s) => (Math.abs(s.c - c) < Math.abs(b.c - c) ? s : b), seq[0]);
        (days[col.d] ||= []).push(tok);
      }
    }
    return { month, days };
  }

  /* parsed → {month, entries:[{date, code}], unknown:[…]} – nur Kürzel, die die App kennt. */
  function toEntries(parsed) {
    const entries = [],
      unknown = new Set();
    for (const [d, codes] of Object.entries(parsed.days)) {
      const date = `${parsed.month}-${pad(d)}`;
      for (const c of codes) {
        if (KEEP.has(c)) entries.push({ date, code: c });
        else if (c === '#' || c === 'Spezial' || c === 'FA' || c === 'Endo' || /^\d+$/.test(c)) continue;
        else unknown.add(c);
      }
    }
    entries.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
    return { month: parsed.month, entries, unknown: [...unknown] };
  }

  const keyOf = e => e.date + '|' + e.code;
  /* Einträge können von Hand geändert sein: m = von Hand eingetragen (bleibt beim erneuten PDF-Import erhalten),
     x = von Hand entfernt (Merker, damit ein erneuter Import den Dienst nicht wieder anlegt). */
  /* Vergleich Plan-Import ↔ gespeicherter Plan eines Monats.
     add: neu im Plan · same: steht schon da (keine Änderung) · drop: war gespeichert, steht im neuen Plan nicht mehr. */
  function diffMonth(stored, incoming) {
    const have = new Set((stored || []).map(keyOf)),
      want = new Set((incoming || []).map(keyOf)),
      gone = new Set((stored || []).filter(e => e.x).map(keyOf));
    return {
      add: (incoming || []).filter(e => !have.has(keyOf(e))),
      same: (incoming || []).filter(e => have.has(keyOf(e)) && !gone.has(keyOf(e))),
      drop: (stored || []).filter(e => !want.has(keyOf(e)) && !e.m && !e.x),
    };
  }
  /* Gespeicherter Monat nach einem PDF-Import: Plan-Einträge, die nicht mehr im Plan stehen, entfallen;
     von Hand Eingetragenes und von Hand Entferntes (solange es im Plan steht) bleibt. */
  function mergeMonth(stored, incoming) {
    const want = new Set((incoming || []).map(keyOf)),
      have = new Set((stored || []).map(keyOf));
    const kept = (stored || []).filter(e => want.has(keyOf(e)) || e.m);
    const add = (incoming || []).filter(e => !have.has(keyOf(e)));
    return [...kept, ...add].sort(order);
  }
  const order = (a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code);

  /* Handänderungen (unveränderlich: liefern einen neuen Plan) */
  const monthOf = iso => String(iso).slice(0, 7);
  function addEntry(plan, date, code) {
    if (!/^\d{4}-\d\d-\d\d$/.test(date) || !(DUTY.has(code) || code === 'U')) return plan;
    const m = monthOf(date),
      list = (plan[m] || []).slice(),
      i = list.findIndex(e => e.date === date && e.code === code);
    if (i >= 0) {
      if (!list[i].x) return plan;
      list[i] = { date, code }; // Merker „entfernt“ aufheben: der Plan-Eintrag gilt wieder
    } else list.push({ date, code, m: 1 });
    return { ...plan, [m]: list.sort(order) };
  }
  function removeEntry(plan, date, code) {
    const m = monthOf(date),
      list = (plan[m] || []).slice(),
      i = list.findIndex(e => e.date === date && e.code === code && !e.x);
    if (i < 0) return plan;
    if (list[i].m) list.splice(i, 1);
    else list[i] = { date, code, x: 1 };
    return { ...plan, [m]: list.sort(order) };
  }
  const replaceEntry = (plan, date, from, to) =>
    from === to ? plan : addEntry(removeEntry(plan, date, from), date, to);

  /* plan: { 'JJJJ-MM': [{date, code}] } → flache Liste, nach Datum sortiert */
  const flatten = plan =>
    Object.keys(plan || {})
      .sort()
      .flatMap(m => (plan[m] || []).filter(e => !e.x));

  const uidOf = e => `op-${e.date}-${e.code}@ordipilot`;
  const hashOf = ev => JSON.stringify(['v1', ev.summary, ev.date]);

  /* Welche Kalendereinträge sind zu schreiben/zu löschen? written: { uid: hash } – was diese App schon geschrieben hat.
     → { put:[{uid,summary,date,allDay}], del:[{uid,summary,date}], next } */
  function calendarPlan(plan, written) {
    const events = flatten(plan)
      .filter(e => CALENDAR.has(e.code) && /^\d{4}-\d\d-\d\d$/.test(e.date))
      .map(e => ({ uid: uidOf(e), summary: TITLES[e.code], date: e.date, allDay: true }));
    const next = {};
    for (const ev of events) next[ev.uid] = hashOf(ev);
    const w = written || {};
    const put = events.filter(ev => w[ev.uid] !== next[ev.uid]);
    const del = Object.keys(w)
      .filter(u => !(u in next))
      .map(u => {
        try {
          const h = JSON.parse(w[u]);
          return { uid: u, summary: h[1], date: h[2] };
        } catch {
          return { uid: u };
        }
      });
    return { put, del, next };
  }

  /* Was steht am Tag im Plan? → { codes:[…], text } für den Hinweis beim Planen eines Einsatzes. */
  function dayInfo(plan, iso) {
    const codes = (plan[(iso || '').slice(0, 7)] || []).filter(e => e.date === iso && !e.x).map(e => e.code);
    if (!codes.length) return { codes: [], text: '' };
    const names = codes.map(c => TITLES[c] || LABELS[c] || c);
    return {
      codes,
      text: names.join(' · '),
      busy: codes.some(c => DUTY.has(c) || c === 'U' || c === 'C' || c === 'SU'),
    };
  }

  /* ---- Urlaub aus dem zweiten Kalender (nur gelesen) ---- */
  const unfold = t => String(t).replace(/\r?\n[ \t]/g, '');
  const plusDay = (iso, n) => {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const isLeaveTitle = t =>
    /^urlaub(?:\s+raouf)?$/i.test(
      String(t || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
    );
  /* ICS-Text → Liste der Urlaubstage (nur Ganztagstermine „Urlaub Raouf“, auch über mehrere Tage). Alles andere wird ignoriert. */
  function leaveDates(ics, now) {
    const text = String(ics || '');
    if (!text.includes('BEGIN:VCALENDAR') || text.length > 1300000) return [];
    const base = now ? new Date(now) : new Date();
    const low = plusDay(base.toISOString().slice(0, 10), -60),
      high = plusDay(base.toISOString().slice(0, 10), 395);
    const out = new Set();
    let cur = null;
    for (const line of unfold(text).split(/\r?\n/)) {
      if (line.trim() === 'BEGIN:VEVENT') cur = {};
      else if (line.trim() === 'END:VEVENT') {
        if (
          cur &&
          cur.title &&
          isLeaveTitle(cur.title) &&
          cur.start &&
          cur.start.length === 8 &&
          !cur.cancelled &&
          !cur.rrule
        ) {
          const d8 = v => v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
          const first = d8(cur.start);
          let last = cur.end && cur.end.length === 8 && d8(cur.end) > first ? plusDay(d8(cur.end), -1) : first;
          if (last > plusDay(first, 89)) last = plusDay(first, 89);
          for (let d = first; d <= last; d = plusDay(d, 1)) if (d >= low && d <= high) out.add(d);
        }
        cur = null;
      } else if (cur) {
        const i = line.indexOf(':');
        if (i < 1) continue;
        const lhs = line.slice(0, i),
          key = lhs.split(';')[0].toUpperCase(),
          val = line.slice(i + 1);
        if (key === 'SUMMARY') cur.title = val.replace(/\\([,;\\])/g, '$1').trim();
        else if (key === 'DTSTART' && /VALUE=DATE(?:;|$)/i.test(lhs.slice(key.length) + ';')) cur.start = val.trim();
        else if (key === 'DTEND') cur.end = /VALUE=DATE(?:;|$)/i.test(lhs.slice(key.length) + ';') ? val.trim() : '';
        else if (key === 'STATUS' && /CANCELLED/i.test(val)) cur.cancelled = true;
        else if (key === 'RRULE') cur.rrule = true;
      }
    }
    return [...out].sort();
  }
  /* Urlaubstage aus dem Kalender als Plan-Einträge (c = aus dem Kalender, werden nie gespeichert). Handentfernte bleiben entfernt. */
  function withLeave(plan, dates) {
    if (!dates || !dates.length) return plan || {};
    const next = { ...(plan || {}) };
    for (const d of dates) {
      if (!/^\d{4}-\d\d-\d\d$/.test(d)) continue;
      const m = monthOf(d),
        list = (next[m] || []).slice();
      if (list.some(e => e.date === d && e.code === 'U')) continue;
      list.push({ date: d, code: 'U', c: 1 });
      next[m] = list.sort(order);
    }
    return next;
  }
  function stripLeave(plan) {
    const next = {};
    for (const m of Object.keys(plan || {})) {
      const list = (plan[m] || []).filter(e => !e.c);
      if (list.length) next[m] = list;
    }
    return next;
  }

  const api = {
    leaveDates,
    withLeave,
    stripLeave,
    DUTY,
    DUTY_25H,
    CALENDAR,
    DISPLAY: new Set([...DUTY, 'U']),
    TITLES,
    LABELS,
    detectMonth,
    isPreliminary,
    parsePage,
    toEntries,
    diffMonth,
    mergeMonth,
    addEntry,
    removeEntry,
    replaceEntry,
    PICKER: Object.freeze(['HO', 'HT', 'OA', 'S', 'A1', 'A2', 'A4', 'LO', 'LT']),
    groupOf: c => (c === 'U' ? 'leave' : DUTY_25H.has(c) ? 'g25' : DUTY.has(c) ? 'long' : 'other'),
    flatten,
    calendarPlan,
    dayInfo,
    uidOf,
  };
  root.OrdiPilotPlanCore = api;
})(typeof globalThis === 'object' ? globalThis : this);

/* ===== Verdrahtung ===== */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof OrdiPilotBoot === 'undefined') return;
  const P = window.OrdiPilotPlanCore;
  const TOKEN_KEY = 'ordipilot-plan-token'; // nur auf diesem Gerät – wird nicht in Dropbox synchronisiert
  const $ = id => document.getElementById(id);
  const esc = s =>
    String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const getToken = () => {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  };
  const setToken = v => {
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* Speicher gesperrt: Token bleibt leer */
    }
  };
  // Lesen legt nichts an (der gespeicherte Stand bleibt unverändert, solange nichts importiert wurde).
  const rawPlan = () => state.settings.klinikPlan || {};
  const plan = () => P.withLeave(rawPlan(), state.settings.klinikLeave || []);
  const written = () => state.settings.klinikCal || {};
  // Einstellungen tragen einen Zeitstempel, nach dem der Dropbox-Abgleich den neueren Stand wählt.
  const saveSettings = () => {
    state.settings._updatedAt = nowISO();
    saveState();
  };
  const fmtDay = iso =>
    new Date(iso + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const monthName = m => new Date(m + '-15T12:00:00').toLocaleDateString('de-AT', { month: 'long', year: 'numeric' });
  const baseUrl = () => {
    const raw = String(state.settings.planApiUrl || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw);
      return u.protocol === 'https:' && !u.username && !u.password ? u.origin : '';
    } catch {
      return '';
    }
  };
  const calendarReady = () => !!(baseUrl() && getToken());

  function setStatus(text, bad) {
    const el = $('v730Status');
    if (!el) return;
    el.textContent = text;
    el.style.color = bad ? '#b3261e' : '';
  }

  /* ---- PDF lesen (pdf.js liegt lokal in vendor/, nichts wird hochgeladen) ---- */
  async function readPdfPages(file) {
    const pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', document.baseURI).href;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false })
      .promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p),
        H = page.view[3],
        tc = await page.getTextContent();
      pages.push(
        tc.items
          .filter(i => String(i.str).trim())
          .map(i => ({ str: i.str, x: i.transform[4], w: i.width, top: H - i.transform[5] - (i.height || 0) }))
      );
    }
    return pages;
  }

  /* ---- Kalender: schreiben/löschen über den gemeinsamen Dienst ---- */
  async function syncCalendar() {
    if (!calendarReady()) return { skippedSetup: true };
    const p = P.calendarPlan(rawPlan(), written());
    if (!p.put.length && !p.del.length) return { put: 0, skipped: [], deleted: 0, errors: [], idle: true };
    const r = await fetch(baseUrl() + '/api/plan-push', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
      body: JSON.stringify({ events: p.put.slice(0, 400), delete: p.del.slice(0, 400) }),
    });
    let body = {};
    try {
      body = await r.json();
    } catch {
      /* keine JSON-Antwort */
    }
    if (!r.ok) throw new Error(body.error || 'Kalender-Dienst antwortet mit Fehler ' + r.status + '.');
    if (!body.errors?.length && p.put.length <= 400 && p.del.length <= 400) {
      state.settings.klinikCal = p.next;
      saveSettings();
    }
    return body;
  }
  const calendarSummary = r => {
    if (r.skippedSetup) return 'Kalender nicht eingerichtet – Dienste sind nur in der App gespeichert.';
    if (r.idle) return 'Kalender ist aktuell – nichts zu schreiben.';
    const bits = [`${r.put} neu im Kalender`];
    if (r.skipped?.length) bits.push(`${r.skipped.length} bereits vorhanden (nicht verändert)`);
    if (r.deleted) bits.push(`${r.deleted} gelöscht`);
    if (r.errors?.length) bits.push(`${r.errors.length} Fehler`);
    return bits.join(' · ');
  };
  /* ---- Urlaub aus dem zweiten iCloud-Kalender lesen (über den gemeinsamen Dienst, nur Lesen) ---- */
  const LEAVE_KEY = 'ordipilot-leave-feed'; // geheimer Kalenderlink: nur auf diesem Gerät
  const getLeaveUrl = () => {
    try {
      return localStorage.getItem(LEAVE_KEY) || '';
    } catch {
      return '';
    }
  };
  const setLeaveUrl = v => {
    try {
      if (v) localStorage.setItem(LEAVE_KEY, v);
      else localStorage.removeItem(LEAVE_KEY);
    } catch {
      /* Speicher gesperrt */
    }
  };
  let leaveBusy = false;
  async function syncLeave() {
    const url = getLeaveUrl();
    if (!url || !calendarReady() || leaveBusy) return;
    leaveBusy = true;
    try {
      const r = await fetch(baseUrl() + '/api/plan-push', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ read: url }),
      });
      if (!r.ok) {
        let b = {};
        try {
          b = await r.json();
        } catch {
          /* keine JSON-Antwort */
        }
        throw new Error(b.error || 'Urlaub-Kalender nicht lesbar (' + r.status + ').');
      }
      const dates = P.leaveDates(await r.text());
      if (JSON.stringify(dates) !== JSON.stringify(state.settings.klinikLeave || [])) {
        state.settings.klinikLeave = dates;
        saveSettings();
        renderList();
        if (typeof renderV67Calendar === 'function') renderV67Calendar();
      }
      setStatus(`Urlaub-Kalender gelesen · ${dates.length} Urlaubstage.`);
    } catch (e) {
      setStatus('Urlaub-Kalender: ' + (e.message || 'Fehler') + ' Bisherige Urlaubstage bleiben.', true);
    } finally {
      leaveBusy = false;
    }
  }
  setTimeout(() => void syncLeave(), 2500);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void syncLeave();
  });
  let syncing = null;
  async function runCalendar() {
    if (syncing) return syncing; // ein Abgleich zur Zeit – parallele Aufrufe warten auf denselben
    syncing = (async () => {
      let res;
      try {
        void syncLeave();
        const r = await syncCalendar();
        res = { text: calendarSummary(r), bad: !!r.errors?.length, raw: r };
      } catch (e) {
        res = { text: 'Kalender: ' + (e.message || 'Fehler') + ' Die Dienste sind in der App gespeichert.', bad: true };
      }
      setStatus(res.text, res.bad);
      document.dispatchEvent(new CustomEvent('ordipilot:plan-sync', { detail: res }));
      return res;
    })();
    try {
      return await syncing;
    } finally {
      syncing = null;
    }
  }
  /* Schnittstelle für die Kalender-Ansicht (v740) */
  window.OrdiPilotPlan = {
    plan,
    setPlan(next) {
      state.settings.klinikPlan = P.stripLeave(next);
      saveSettings();
      renderList();
    },
    sync: runCalendar,
    ready: calendarReady,
    pending: () => P.calendarPlan(rawPlan(), written()),
    syncLeave: () => syncLeave(),
    lastName: async () => (await lastPlan.get())?.name || null,
    reread: async () => {
      const r = await lastPlan.get();
      if (!r) return false;
      handleFile(new File([r.b], r.name || 'Dienstplan.pdf', { type: 'application/pdf' }));
      return true;
    },
    upload: () => {
      buildCard();
      $('v730Upload')?.click();
    },
  };

  /* ---- Vorschau-Dialog ---- */
  function askConfirm(html) {
    return new Promise(resolve => {
      const d = document.createElement('dialog');
      d.className = 'v730-dialog';
      d.innerHTML = `<form method="dialog" class="modal"><div class="v730-body">${html}</div><div class="modal-actions"><button class="btn" value="cancel">Abbrechen</button><button class="btn primary" value="ok">Übernehmen</button></div></form>`;
      d.addEventListener('close', () => {
        resolve(d.returnValue === 'ok');
        d.remove();
      });
      document.body.appendChild(d);
      d.showModal();
    });
  }

  /* Zuletzt gelesenen Plan merken: ein Tipp liest ihn erneut, ohne Dateiauswahl. */
  const lastPlan = {
    open: () =>
      new Promise((ok, no) => {
        const r = indexedDB.open('op-lastplan', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('f');
        r.onsuccess = () => ok(r.result);
        r.onerror = () => no(r.error);
      }),
    async put(f) {
      try {
        const d = await lastPlan.open();
        d.transaction('f', 'readwrite').objectStore('f').put({ b: f, name: f.name }, 'last');
      } catch {
        /* optional */
      }
    },
    async get() {
      try {
        const d = await lastPlan.open();
        return await new Promise(ok => {
          const q = d.transaction('f').objectStore('f').get('last');
          q.onsuccess = () => ok(q.result || null);
          q.onerror = () => ok(null);
        });
      } catch {
        return null;
      }
    },
  };
  async function handleFile(file) {
    const name = String(state.settings.planName || '').trim();
    if (!name) {
      setStatus('Bitte zuerst oben deinen Namen im Dienstplan eintragen (Nachname genügt).', true);
      $('v730Name')?.focus();
      return;
    }
    setStatus('Dienstplan wird gelesen …');
    try {
      const pages = await readPdfPages(file);
      const parsed = [];
      let prelim = false;
      for (const items of pages) {
        const r = P.parsePage(items, name);
        if (r) {
          parsed.push(P.toEntries(r));
          prelim = prelim || P.isPreliminary(items);
        }
      }
      if (!parsed.length) {
        setStatus(`Keine Plan-Zeile für „${name}“ gefunden. Name prüfen (Schreibweise wie im Plan).`, true);
        return;
      }
      const unknown = [...new Set(parsed.flatMap(p => p.unknown))];
      const diffs = parsed.map(p => ({ ...p, ...P.diffMonth(rawPlan()[p.month], p.entries) }));
      const count = list => {
        const duty = list.filter(e => P.DUTY.has(e.code)).length,
          leave = list.filter(e => e.code === 'U').length,
          rest = list.length - duty - leave;
        return [duty && `${duty} Dienste`, leave && `${leave} Urlaubstage`, rest && `${rest} Wochenruhe/AD/sonstige`]
          .filter(Boolean)
          .join(', ');
      };
      const lines = diffs.map(d => {
        const bits = [`<b>${esc(monthName(d.month))}</b>: ${d.add.length ? 'neu ' + count(d.add) : 'nichts Neues'}`];
        if (d.same.length) bits.push(`bereits vorhanden: ${count(d.same)}`);
        if (d.drop.length) bits.push(`nicht mehr im Plan, wird entfernt: ${count(d.drop)}`);
        return `<p>${bits.join(' · ')}</p>`;
      });
      const nothing = diffs.every(d => !d.add.length && !d.drop.length);
      if (nothing) {
        setStatus('Alle Dienste dieses Plans sind bereits vorhanden – nichts zu tun.');
        return;
      }
      const html =
        `<h3>Dienstplan übernehmen?</h3>${lines.join('')}` +
        (prelim
          ? '<p class="help">Achtung: Der Plan ist als „vorläufig“ gekennzeichnet. Spätere Änderungen kannst du erneut hochladen – es wird nur das Geänderte ergänzt bzw. entfernt.</p>'
          : '') +
        (unknown.length ? `<p class="help">Unbekannte Kürzel (ignoriert): ${esc(unknown.join(', '))}</p>` : '') +
        `<p class="help">${calendarReady() ? 'Neue Dienste werden anschließend in den Apple-Kalender eingetragen; was dort schon steht, bleibt unberührt.' : 'Der Kalender ist nicht eingerichtet – die Dienste werden nur in der App gespeichert.'}</p>`;
      if (!(await askConfirm(html))) {
        setStatus('Abgebrochen – nichts verändert.');
        return;
      }
      const next = { ...rawPlan() };
      for (const d of diffs) {
        next[d.month] = P.mergeMonth(next[d.month], d.entries);
      }
      state.settings.klinikPlan = next;
      saveSettings();
      renderList();
      setStatus('Dienste gespeichert.');
      if (state.settings.planCalendarAuto !== false) await runCalendar();
    } catch (e) {
      console.error(e);
      setStatus('Dienstplan konnte nicht gelesen werden.', true);
    }
  }

  /* ---- Einstellungen ---- */
  function upcoming() {
    const today = todayISO();
    return P.flatten(plan())
      .filter(e => e.date >= today && P.DUTY.has(e.code))
      .slice(0, 6);
  }
  function renderList() {
    const el = $('v730List');
    if (!el) return;
    const list = upcoming();
    el.innerHTML = list.length
      ? list
          .map(
            e => `<div class="v730-row"><span>${esc(fmtDay(e.date))}</span><span>${esc(P.TITLES[e.code])}</span></div>`
          )
          .join('')
      : '<div class="help">Noch keine kommenden Dienste gespeichert.</div>';
  }
  function buildCard() {
    const card = $('v730Card');
    if (!card || card.dataset.ready) return;
    card.dataset.ready = '1';
    const s = state.settings;
    card.insertAdjacentHTML(
      'beforeend',
      `<div class="cloud-box">
<div class="help">Einmal Namen eintragen, dann den Dienstplan als PDF hochladen: Deine Dienste werden erkannt, in der App angezeigt und in den Apple-Kalender eingetragen. Steht ein Termin dort schon, bleibt er unverändert.</div>
<div class="formgrid">
<div class="field wide"><label>Mein Name im Dienstplan</label><input id="v730Name" autocomplete="off" placeholder="Nachname wie in der Plan-Zeile" value="${esc(s.planName || '')}"></div>
<div class="field wide"><label>Kalender-Dienst (Adresse)</label><input id="v730Url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://dienstsaldo-rm.pages.dev" value="${esc(s.planApiUrl || '')}"></div>
<div class="field wide"><label>Zugangstoken (nur auf diesem Gerät)</label><input id="v730Token" type="password" autocomplete="off" placeholder="${getToken() ? '•••••••• gespeichert' : 'Token einfügen'}"><div class="help">Diese Adresse muss im Kalender-Dienst freigegeben sein: <code>${esc(location.origin)}</code></div></div>
<div class="field wide"><label>Urlaub-Kalender (iCloud-Link, nur auf diesem Gerät)</label><input id="v730Leave" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${getLeaveUrl() ? '•••••••• gespeichert' : 'webcal://p…-caldav.icloud.com/published/2/…'}"><div class="help">Gelesen wird nur „Urlaub Raouf“ (von–bis). Alles andere in diesem Kalender wird ignoriert.</div></div>
<div class="field wide"><label><input id="v730Auto" type="checkbox" style="min-height:auto;width:auto;margin-right:7px"${s.planCalendarAuto === false ? '' : ' checked'}> Neue Dienste automatisch in den Apple-Kalender eintragen</label></div>
</div>
<div class="v730-actions"><button class="btn primary" type="button" id="v730Upload">Dienstplan hochladen (PDF)</button><button class="btn" type="button" id="v730Resync">Kalender abgleichen</button></div>
<div class="help" id="v730Status" role="status" aria-live="polite"></div>
<div class="v730-sub">Nächste Dienste</div><div id="v730List"></div></div>`
    );
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'application/pdf,.pdf';
    file.hidden = true;
    card.appendChild(file);
    $('v730Name').addEventListener('change', e => {
      const v = e.target.value.trim();
      if (v) state.settings.planName = v;
      else delete state.settings.planName;
      saveSettings();
      setStatus(v ? 'Name gespeichert.' : 'Name entfernt.');
    });
    $('v730Url').addEventListener('change', e => {
      const v = e.target.value.trim();
      if (v) state.settings.planApiUrl = v;
      else delete state.settings.planApiUrl;
      saveSettings();
      setStatus(!v || baseUrl() ? 'Adresse gespeichert.' : 'Adresse muss mit https:// beginnen.', !!v && !baseUrl());
    });
    $('v730Token').addEventListener('change', e => {
      const v = e.target.value.trim();
      if (v) {
        setToken(v);
        e.target.value = '';
        e.target.placeholder = '•••••••• gespeichert';
        setStatus('Token auf diesem Gerät gespeichert.');
      }
    });
    $('v730Leave').addEventListener('change', e => {
      const v = e.target.value.trim();
      if (!v) {
        setLeaveUrl('');
        delete state.settings.klinikLeave;
        saveSettings();
        setStatus('Urlaub-Kalender getrennt.');
        return;
      }
      if (
        !/^(?:webcal|https):\/\/p\d{1,3}-(?:caldav|calendarws)\.icloud\.com\/published\/2\/[A-Za-z0-9._~%-]{15,1500}$/i.test(
          v
        )
      ) {
        setStatus('Das ist kein veröffentlichter iCloud-Kalenderlink (webcal://…).', true);
        return;
      }
      setLeaveUrl(v);
      e.target.value = '';
      e.target.placeholder = '•••••••• gespeichert';
      setStatus('Urlaub-Kalender gespeichert, wird gelesen …');
      void syncLeave();
    });
    $('v730Auto').addEventListener('change', e => {
      state.settings.planCalendarAuto = e.target.checked;
      saveSettings();
    });
    $('v730Upload').addEventListener('click', () => file.click());
    $('v730Resync').addEventListener('click', () => {
      setStatus('Kalender wird abgeglichen …');
      runCalendar();
    });
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (f) {
        lastPlan.put(f);
        handleFile(f);
      }
    });
    renderList();
  }

  /* ---- Hinweis beim Planen eines Einsatzes ---- */
  function showConflict() {
    const host = $('entryDateHuman');
    if (!host) return;
    let el = $('v730Conflict');
    if (!el) {
      el = document.createElement('div');
      el.id = 'v730Conflict';
      el.className = 'v730-conflict';
      host.insertAdjacentElement('afterend', el);
    }
    const info = P.dayInfo(plan(), fDate.value);
    el.textContent = info.text ? (info.busy ? '⚠︎ Klinik: ' : 'Klinik: ') + info.text : '';
    el.style.display = info.text ? 'block' : 'none';
  }
  OrdiPilotExt.extend(
    'updateEntryDateUI',
    base =>
      function () {
        const out = base.apply(this, arguments);
        try {
          showConflict();
        } catch (e) {
          console.error('v730 Hinweis', e);
        }
        return out;
      }
  );

  function css() {
    if ($('v730-style')) return;
    const st = document.createElement('style');
    st.id = 'v730-style';
    st.textContent = `#v730Card .v730-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
#v730Card .v730-sub{margin-top:14px;font-weight:700;font-size:14px}
#v730Card .v730-row{display:flex;justify-content:space-between;gap:10px;font-size:14px;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.08)}
#v730Card .v730-row span:first-child{white-space:nowrap;font-variant-numeric:tabular-nums}
.v730-conflict{margin-top:6px;padding:8px 10px;border-radius:10px;background:#fff4e5;color:#8a4b00;font-size:13px;font-weight:600}
.v730-dialog{border:0;border-radius:16px;padding:0;max-width:min(92vw,420px)}
.v730-dialog .modal{padding:16px}
.v730-dialog p{margin:6px 0}`;
    document.head.appendChild(st);
  }
  OrdiPilotBoot.add('v730:1', () => {
    css();
    buildCard();
  });
})();
