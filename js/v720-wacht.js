/* ===== OrdiPilot V7.2 · Automatik-Status · Zahlungseingänge aus Kontoumsätzen =====
   1. Das Google-Skript schreibt nach jedem KI-Lauf und nach der täglichen Prüfung
      System/Import/automatik-status.json. Die App zeigt daraus, ob alle Automatiken laufen –
      und warnt, wenn sich das Skript selbst nicht mehr meldet.
   2. Kontoumsätze: Ein Umsatz-Export aus George (CSV oder JSON) im Dropbox-Ordner „Kontoumsaetze“
      wird beim Sync gelesen. Gutschriften, die betragsgenau zu einer offenen Honorarnote passen,
      werden als Zahlungseingang mit Buchungsdatum erfasst.
   Der Teil bis "Verdrahtung" ist rein funktional und wird von tests/ in Node geprüft. */
(function (root) {
  'use strict';
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const WATCH = { ki: 26, easypark: 24, check: 26 }; // Stunden ohne Lebenszeichen, bis gewarnt wird
  const STALE_HOURS = 36; // so lange darf die Status-Datei alt sein

  /* status: Inhalt von automatik-status.json; nowMs: aktuelle Zeit;
     firstSeen: { key: ISO } – seit wann die App eine Automatik ohne jede Meldung sieht.
     Noch nie gelaufen zählt erst als Problem, wenn die Frist seit dem ersten Sehen verstrichen ist
     (frisch eingerichtete Automatik → „noch keine Meldung“ statt Fehlalarm).
     → { known, stale, ok, items:[{key,label,last,ok,pending}] } */
  function evaluateStatus(status, nowMs, firstSeen) {
    if (!status || !Array.isArray(status.components)) return { known: false, stale: false, ok: false, items: [] };
    const age = h => (nowMs - new Date(h).getTime()) / 36e5;
    const items = status.components.map(c => {
      const max = WATCH[c.key] || 26;
      if (!c.last) {
        const seen = (firstSeen || {})[c.key];
        const pending = !seen || age(seen) <= max;
        return { key: c.key, label: c.label || c.key, last: '', ok: pending, pending };
      }
      return { key: c.key, label: c.label || c.key, last: c.last, ok: age(c.last) <= max, pending: false };
    });
    const stale = !status.updatedAt || age(status.updatedAt) > STALE_HOURS;
    return { known: true, stale, ok: !stale && items.every(i => i.ok), items, updatedAt: status.updatedAt || '' };
  }

  // ---- Kontoumsätze lesen ----
  function parseAmount(v) {
    if (typeof v === 'number') return v;
    let t = String(v ?? '')
      .replace(/\s|€|EUR/gi, '')
      .replace(/^\+/, '');
    if (!t) return NaN;
    if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    return Number(t);
  }
  function parseDate(v) {
    const s = String(v ?? '').trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return '';
  }
  function splitCsv(text) {
    const lines = String(text || '')
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .filter(l => l.trim());
    if (!lines.length) return [];
    const head = lines[0];
    const delim = [';', '\t', ','].sort((a, b) => head.split(b).length - head.split(a).length)[0];
    return lines.map(line => {
      const out = [];
      let cur = '',
        q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
          if (c === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else if (c === '"') q = false;
          else cur += c;
        } else if (c === '"') q = true;
        else if (c === delim) {
          out.push(cur);
          cur = '';
        } else cur += c;
      }
      out.push(cur);
      return out.map(x => x.trim());
    });
  }
  const str = v => (v === null || v === undefined || typeof v === 'object' ? '' : String(v));
  /* Liefert die Gutschriften (Betrag > 0) eines George-Exports (JSON oder CSV). */
  function parseBank(text) {
    const out = [];
    const push = (date, amount, partner, info) => {
      if (date && amount > 0) out.push({ date, amount: r2(amount), partner: partner.trim(), text: info.trim() });
    };
    let json = null;
    try {
      json = JSON.parse(String(text || '').replace(/^﻿/, ''));
    } catch (_) {}
    if (json) {
      const list = Array.isArray(json) ? json : json.transactions || json.items || json.data || [];
      for (const o of list) {
        if (!o || typeof o !== 'object') continue;
        const a = o.amount;
        const amount =
          a && typeof a === 'object'
            ? Number(a.value) / Math.pow(10, Number(a.precision ?? 2))
            : parseAmount(a ?? o.betrag ?? o.Betrag);
        const date = parseDate(o.booking || o.bookingDate || o.valuation || o.valueDate || o.date || o.buchungsdatum);
        const partner = str(o.partnerName || (o.partner && o.partner.name) || o.senderName || o.auftraggeber);
        const info = [o.reference, o.referenceNumber, o.receiverReference, o.note, o.description, o.bookingInfo]
          .map(str)
          .filter(Boolean)
          .join(' ');
        push(date, amount, partner, info);
      }
      return out;
    }
    const rows = splitCsv(text);
    const hi = rows.findIndex(r => r.some(c => /datum|date/i.test(c)) && r.some(c => /betrag|amount/i.test(c)));
    if (hi < 0) return out;
    const h = rows[hi];
    const col = re => h.findIndex(c => re.test(c));
    const cDate = [col(/^buchungsdatum$|booking date/i), col(/datum|date/i)].find(i => i >= 0);
    const cAmount = col(/^betrag|amount/i);
    const cPartner = col(/partner.*name|^partner$|auftraggeber|zahlungspflichtig|empfänger|^name$/i);
    const cText = h
      .map((c, i) =>
        /zweck|referenz|reference|buchungs.?info|buchungstext|beschreibung|description|notiz/i.test(c) ? i : -1
      )
      .filter(i => i >= 0);
    for (const r of rows.slice(hi + 1))
      push(
        parseDate(r[cDate]),
        parseAmount(r[cAmount]),
        cPartner >= 0 ? r[cPartner] || '' : '',
        cText.map(i => r[i] || '').join(' ')
      );
    return out;
  }

  const norm = s =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  const STOP = new Set([
    'dr',
    'med',
    'univ',
    'prof',
    'mag',
    'ordination',
    'praxis',
    'gmbh',
    'og',
    'kg',
    'facharzt',
    'fur',
  ]);
  /* Ordnet Gutschriften offenen Honorarnoten zu.
     open: [{ key, ym, open, invoiceNumber, recipientName }]
     Regel: Betrag auf den Cent gleich, Buchung nicht vor dem Leistungsmonat. Bei mehreren Kandidaten
     entscheidet die Honorarnoten-Nummer oder der Name im Umsatz; bleibt es mehrdeutig, wird nichts zugeordnet. */
  function matchCredits(credits, open) {
    const used = new Set(),
      out = [];
    for (const c of [...credits].sort((a, b) => a.date.localeCompare(b.date))) {
      const hay = norm(c.partner + ' ' + c.text);
      const cands = open
        .filter(o => !used.has(o.key) && Math.abs(o.open - c.amount) < 0.005 && c.date >= o.ym + '-01')
        .map(o => {
          let score = 0;
          if (o.invoiceNumber && hay.includes(norm(o.invoiceNumber))) score += 3;
          const words = String(o.recipientName || '')
            .split(/[\s,.\-/]+/)
            .map(norm)
            .filter(w => w.length >= 4 && !STOP.has(w));
          if (words.some(w => hay.includes(w))) score += 1;
          return { o, score };
        })
        .sort((a, b) => b.score - a.score || a.o.ym.localeCompare(b.o.ym));
      if (!cands.length) continue;
      if (cands.length > 1 && cands[0].score === cands[1].score) continue; // mehrdeutig
      used.add(cands[0].o.key);
      out.push({ key: cands[0].o.key, credit: c });
    }
    return out;
  }
  function creditId(c) {
    let h = 5381;
    for (const ch of `${c.date}|${c.amount}|${norm(c.partner)}|${norm(c.text)}`)
      h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
    return 'pay-bank-' + c.date + '-' + h.toString(36);
  }

  root.OrdiPilotWatchCore = { evaluateStatus, parseBank, parseAmount, parseDate, matchCredits, creditId };
})(typeof window !== 'undefined' ? window : globalThis);

/* ===== Verdrahtung ===== */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof state === 'undefined') return;
  const W = window.OrdiPilotWatchCore;
  const ROOT = '/Ordination & Selbständigkeit/Vertretungsdienste';
  const STATUS_PATH = ROOT + '/System/Import/automatik-status.json';
  const BANK_DIR = ROOT + '/Kontoumsaetze';
  const STORE = 'ordipilot-automatik-status';
  const esc = v => escapeHtml(v);
  const now = () => new Date().toISOString();
  let status = null,
    note = '',
    bankInfo = '';
  let firstSeen = {};
  try {
    status = JSON.parse(localStorage.getItem(STORE) || 'null');
    firstSeen = JSON.parse(localStorage.getItem(STORE + '-erst') || '{}') || {};
  } catch (_) {}
  function noteFirstSeen() {
    for (const c of (status && status.components) || []) {
      if (c.last) delete firstSeen[c.key];
      else if (!firstSeen[c.key]) firstSeen[c.key] = now();
    }
    try {
      localStorage.setItem(STORE + '-erst', JSON.stringify(firstSeen));
    } catch (_) {}
  }
  const fmt = iso => {
    if (!iso) return '–';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}., ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // ---- 1. Status ----
  async function importStatus() {
    const blob = await dbxDownload(STATUS_PATH);
    if (!blob) return;
    try {
      status = JSON.parse(await blob.text());
      try {
        localStorage.setItem(STORE, JSON.stringify(status));
      } catch (_) {}
      noteFirstSeen();
    } catch (e) {
      console.warn('Automatik-Status nicht lesbar', e);
    }
  }
  function problems() {
    const ev = W.evaluateStatus(status, Date.now(), firstSeen);
    if (!ev.known) return [];
    if (ev.stale) return [`Google-Skript meldet sich seit ${fmt(ev.updatedAt)} nicht`];
    return ev.items.filter(i => !i.ok).map(i => `${i.label} läuft nicht`);
  }

  // ---- 2. Kontoumsätze ----
  function openItems() {
    const T = window.OrdiPilotTaxCore;
    const y = new Date().getFullYear(),
      seen = new Map();
    for (const year of [y - 1, y]) {
      const rep = T.yearReport({
        entries: state.entries,
        parking: state.parkingRecords,
        invoices: state.invoices,
        payments: state.payments,
        trips: state.trips,
        expenses: [],
        settings: state.settings,
        year,
        fns: { isEarned: e => isEarnedEntry(e), hours: e => entryHours(e) || 0, gross: e => gross(e) || 0 },
      });
      for (const x of rep.services)
        if (x.gross > 0 && x.open > 0.005 && !seen.has(x.key))
          seen.set(x.key, {
            key: x.key,
            ym: x.ym,
            open: x.open,
            invoiceNumber: x.invoiceNumber,
            recipientName: x.recipientName,
          });
    }
    return [...seen.values()];
  }
  async function importBank() {
    let entries = [];
    try {
      const r = await dbxRpc('files/list_folder', { path: BANK_DIR, recursive: false });
      entries = (r.entries || []).filter(x => x['.tag'] === 'file' && /\.(csv|json|txt)$/i.test(x.name || ''));
    } catch (e) {
      if (!/not_found/.test(String(e.message || e))) console.warn('Kontoumsätze', e);
      return;
    }
    if (!entries.length) return;
    const credits = [];
    for (const f of entries) {
      const blob = await dbxDownload(f.path_display || `${BANK_DIR}/${f.name}`);
      if (blob) credits.push(...W.parseBank(await blob.text()));
    }
    if (!Array.isArray(state.payments)) state.payments = [];
    const deleted = state.deletedPayments || {};
    const known = new Set(state.payments.map(p => p.id));
    const fresh = credits.filter(c => !known.has(W.creditId(c)) && !deleted[W.creditId(c)]);
    const matches = W.matchCredits(fresh, openItems());
    for (const m of matches) {
      const c = m.credit;
      state.payments.push({
        id: W.creditId(c),
        key: m.key,
        paidAt: c.date,
        paidYear: c.date.slice(0, 4),
        amount: c.amount,
        note: ('automatisch: Kontoumsatz ' + (c.partner || c.text)).slice(0, 120).trim(),
        source: 'bank',
        updatedAt: now(),
      });
    }
    bankInfo = `${credits.length} Gutschrift${credits.length === 1 ? '' : 'en'} gelesen${matches.length ? `, ${matches.length} zugeordnet` : ''}`;
    if (matches.length)
      note = `${matches.length} Zahlung${matches.length === 1 ? '' : 'en'} aus Kontoumsätzen als bezahlt erfasst`;
  }

  (window.ordipilotSyncHooksAsync = window.ordipilotSyncHooksAsync || []).push(async () => {
    note = '';
    if (!isDropboxConnected()) return;
    try {
      await importStatus();
    } catch (e) {
      console.warn('Automatik-Status', e);
    }
    try {
      await importBank();
    } catch (e) {
      console.warn('Kontoumsätze', e);
    }
    try {
      renderWatch();
    } catch (_) {}
  });
  if (typeof window.ordipilotAutoNote === 'function')
    OrdiPilotExt.extend(
      'ordipilotAutoNote',
      base => () => [base(), note, ...problems().map(p => '⚠️ ' + p)].filter(Boolean).join(' · ')
    );

  // ---- Anzeige (Honorar, unter „Erinnerungen per Mail“) ----
  function renderWatch() {
    const anchor = document.getElementById('v710Remind') || document.getElementById('v618Gmail');
    if (!anchor) return;
    let el = document.getElementById('v720Watch');
    if (!el) {
      el = document.createElement('details');
      el.id = 'v720Watch';
      el.className = 'v618-gmail';
      anchor.insertAdjacentElement('afterend', el);
    }
    const ev = W.evaluateStatus(status, Date.now(), firstSeen),
      wasOpen = el.open;
    const probs = problems();
    const badge = !ev.known
      ? ''
      : probs.length
        ? `<span class="v720-warn">${probs.length} Problem${probs.length === 1 ? '' : 'e'}</span>`
        : '<span class="ok">alles ok</span>';
    const rows = ev.known
      ? ev.items
          .map(i =>
            i.pending && !ev.stale
              ? `<div class="v720-row"><span>${esc(i.label)}</span><span>noch keine Meldung</span></div>`
              : `<div class="v720-row"><span>${esc(i.label)}</span><span class="${i.ok && !ev.stale ? 'ok' : 'v720-warn'}">${i.ok && !ev.stale ? '✓' : '!'} ${esc(i.last ? fmt(i.last) : 'nie')}</span></div>`
          )
          .join('') +
        (ev.stale
          ? `<div class="v720-row v720-warn">Das Google-Skript hat sich seit ${esc(fmt(ev.updatedAt))} nicht gemeldet.</div>`
          : '')
      : '<div class="help">Noch keine Meldung vom Google-Skript – erscheint nach dem nächsten KI-Lauf (stündlich).</div>';
    const geo = state.settings.geoLastEvent;
    el.innerHTML = `<summary>Automatiken ${badge}</summary>
      <div class="v618-body">
        ${rows}
        <div class="v720-row"><span>Standort-Signal vom iPhone</span><span>${geo ? esc(geo.slice(8, 10) + '.' + geo.slice(5, 7) + '., ' + geo.slice(11)) : '–'}</span></div>
        <div class="help">Läuft eine Automatik länger als einen Tag nicht, kommt um 18 Uhr eine Mail. An Einsatztagen ohne Standort-Signal ebenso.</div>
        <div class="v720-sub">Zahlungseingänge aus Kontoumsätzen</div>
        <div class="help">In George unter Umsätze „Exportieren“ (CSV oder JSON) wählen und die Datei in Dropbox unter <b>Vertretungsdienste/Kontoumsaetze</b> speichern. Beim nächsten Sync werden Gutschriften, die betragsgenau zu einer offenen Honorarnote passen, mit Buchungsdatum als bezahlt erfasst.${bankInfo ? ` <b>Zuletzt: ${esc(bankInfo)}.</b>` : ''}</div>
      </div>`;
    if (wasOpen) el.open = true;
  }
  OrdiPilotExt.extend(
    'renderInvoice',
    base =>
      function () {
        const out = base.apply(this, arguments);
        try {
          renderWatch();
        } catch (e) {
          console.warn('V7.2 Automatiken', e);
        }
        return out;
      }
  );
  function css() {
    if (document.getElementById('v720-style')) return;
    const st = document.createElement('style');
    st.id = 'v720-style';
    st.textContent = `#v720Watch .v720-row{display:flex;justify-content:space-between;gap:10px;font-size:14px;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.06)}
#v720Watch .v720-row span:last-child{white-space:nowrap;font-variant-numeric:tabular-nums}
#v720Watch .ok{color:#15803d}.v720-warn{color:#b45309;font-weight:700}
#v720Watch .v720-sub{margin-top:14px;font-weight:700;font-size:14px}`;
    document.head.appendChild(st);
  }
  OrdiPilotBoot.add('v720:1', () => {
    css();
    renderWatch();
  });
})();
