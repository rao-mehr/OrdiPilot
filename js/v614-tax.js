/* ===== OrdiPilot V6.14 · Steuer & Belege =====
   Zahlungseingänge (Zufluss), Fahrten mit Kilometergeld und Steuerpaket für den Steuerberater.
   Der Teil bis "Verdrahtung" ist rein funktional und wird von tests/ in Node geprüft. */
(function (root) {
  'use strict';
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const ymOf = e => String((e && e.date) || '').slice(0, 7);
  const firstLine = t =>
    String(t || '')
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean)[0] || '';
  const paidYear = p => (p && p.paidAt ? String(p.paidAt).slice(0, 4) : String((p && p.paidYear) || ''));
  const MONTHS_DE = [
    'Jänner',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ];
  const monthLabel = ym => {
    const [y, m] = String(ym).split('-');
    return `${MONTHS_DE[Number(m) - 1] || m} ${y}`;
  };

  /* input: {entries, parking, invoices, payments, trips, settings, year, fns:{isEarned(e), hours(e), gross(e)}} */
  function yearReport(input) {
    const Y = String(input.year),
      s = input.settings || {},
      fns = input.fns;
    const recipients = Array.isArray(s.recipients) ? s.recipients : [];
    const defaultRid = recipients[0]?.id || 'recipient-primary';
    const recById = id =>
      recipients.find(r => r.id === id) ||
      recipients[0] || { id: defaultRid, name: s.recipientName || '', address: s.recipientAddress || '' };
    const earned = (input.entries || []).filter(e => e && e.date && fns.isEarned(e));
    const parkingAll = (input.parking || []).filter(p => p && !p.excluded);
    const payments = (input.payments || []).filter(p => p && p.key);
    const invoices = (input.invoices || []).filter(i => i && !i.archivedRecord);

    // Leistungen je Monat und Empfänger
    const svc = new Map();
    for (const e of earned) {
      const rid = e.recipientId || defaultRid,
        ym = ymOf(e),
        key = `${ym}::${rid}`;
      const a = svc.get(key) || { key, ym, recipientId: rid, count: 0, hours: 0, gross: 0 };
      a.count++;
      a.hours += Number(fns.hours(e)) || 0;
      a.gross += Number(fns.gross(e)) || 0;
      svc.set(key, a);
    }
    for (const p of payments)
      if (!svc.has(p.key)) {
        const [ym, rid] = p.key.split('::');
        svc.set(p.key, { key: p.key, ym, recipientId: rid || defaultRid, count: 0, hours: 0, gross: 0 });
      }
    const services = [...svc.values()]
      .filter(a => a.ym.startsWith(Y + '-') || payments.some(p => p.key === a.key && paidYear(p) === Y))
      .map(a => {
        const inv =
          invoices.find(i => i.key === a.key) ||
          invoices.find(i => i.key === a.ym && (!i.recipientId || i.recipientId === a.recipientId));
        const pays = payments
          .filter(p => p.key === a.key)
          .sort((x, y) => String(x.paidAt || x.paidYear).localeCompare(String(y.paidAt || y.paidYear)));
        const paid = r2(pays.reduce((t, p) => t + (Number(p.amount) || 0), 0)),
          gross = r2(a.gross),
          open = r2(Math.max(0, gross - paid));
        const rec = recById(a.recipientId);
        return {
          ...a,
          gross,
          hours: r2(a.hours),
          label: monthLabel(a.ym),
          recipientName: rec.name || '',
          invoiceNumber: inv?.number || '',
          invoiceDate: inv?.invoiceDate || '',
          payments: pays,
          paid,
          open,
          status: gross > 0 && paid >= gross - 0.005 ? 'bezahlt' : paid > 0 ? 'teilweise' : 'offen',
        };
      })
      .sort((a, b) => a.ym.localeCompare(b.ym) || a.recipientName.localeCompare(b.recipientName));

    const income = payments
      .filter(p => paidYear(p) === Y)
      .map(p => {
        const sv = services.find(x => x.key === p.key);
        return {
          ...p,
          amount: r2(p.amount),
          label: sv?.label || monthLabel(p.key.split('::')[0]),
          recipientName: sv?.recipientName || recById(p.key.split('::')[1]).name || '',
          invoiceNumber: sv?.invoiceNumber || '',
          invoiceDate: sv?.invoiceDate || '',
        };
      })
      .sort((a, b) => String(a.paidAt || a.paidYear + '-99').localeCompare(String(b.paidAt || b.paidYear + '-99')));
    const servicesY = services.filter(x => x.ym.startsWith(Y + '-'));

    // Parkkosten
    const entryById = new Map((input.entries || []).map(e => [e.id, e]));
    // Nur Parkvorgänge, die einem Einsatz zugeordnet sind, sind Betriebsausgaben; der Rest ist „zu prüfen“
    const parkingYear = parkingAll
      .filter(p => String(p.date || '').startsWith(Y + '-'))
      .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
    const parking = parkingYear.filter(p => p.entryId && entryById.has(p.entryId));
    const parkingUnassigned = parkingYear.filter(p => !(p.entryId && entryById.has(p.entryId)));

    // Fahrten: je abgeschlossenem Einsatz Hin- und Rückfahrt
    const rate =
      Number(String(s.travelRate ?? '').replace(',', '.')) > 0 ? Number(String(s.travelRate).replace(',', '.')) : 0.5;
    const tripByEntry = new Map((input.trips || []).filter(t => t && t.entryId).map(t => [t.entryId, t]));
    const parkedEntries = new Set(parkingAll.map(p => p.entryId).filter(Boolean));
    // Startpunkt je Einsatz: Wohnung (Hin- und Rückfahrt) oder Arbeitsplatz (Arbeit → Ordination → Wohnung)
    const kmOf = v => {
      const n = Number(String(v ?? '').replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const defStart = s.travelDefaultStart === 'work' ? 'work' : 'car';
    const home =
        s.travelHome ||
        String(s.issuerAddress || '')
          .split('\n')
          .map(x => x.trim())
          .filter(Boolean)
          .join(', ') ||
        'Wohnung',
      work = s.travelWork || 'Arbeitsplatz';
    const trips = earned
      .filter(e => e.date.startsWith(Y + '-'))
      .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')))
      .map(e => {
        const rec = recById(e.recipientId || defaultRid),
          o = tripByEntry.get(e.id),
          kmHome = kmOf(rec.travelKm),
          kmWork = kmOf(rec.travelKmWork);
        const mode = o?.mode === 'none' || o?.mode === 'work' || o?.mode === 'car' ? o.mode : defStart;
        const override =
          o &&
          o.km !== null &&
          o.km !== undefined &&
          o.km !== '' &&
          Number.isFinite(Number(String(o.km).replace(',', '.')))
            ? Number(String(o.km).replace(',', '.'))
            : null;
        const base = mode === 'car' ? kmHome * 2 : mode === 'work' ? (kmWork && kmHome ? kmWork + kmHome : 0) : 0;
        const km = mode === 'none' ? 0 : r2(override !== null ? override : base);
        const missing = mode !== 'none' && !km ? (mode === 'work' && !kmWork ? 'work' : 'home') : '';
        const place = [rec.name, firstLine(rec.address)].filter(Boolean).join(', ');
        return {
          entryId: e.id,
          date: e.date,
          recipientId: rec.id,
          recipientName: rec.name || '',
          mode,
          missing,
          from: mode === 'work' ? work : home,
          via: place,
          to: home,
          route: mode === 'work' ? 'Arbeitsplatz → Ordination → Wohnung' : 'Wohnung → Ordination → Wohnung',
          purpose: `Ärztliche Vertretung${rec.name ? ' – ' + rec.name : ''}`,
          km,
          custom: override !== null,
          rate,
          amount: r2(km * rate),
          hasParking: parkedEntries.has(e.id),
        };
      });
    const carTrips = trips.filter(t => t.mode !== 'none' && !t.missing);
    const missingKm = [...new Set(trips.filter(t => t.missing === 'home').map(t => t.recipientId))].map(id =>
      recById(id)
    );
    const missingWorkKm = [...new Set(trips.filter(t => t.missing === 'work').map(t => t.recipientId))].map(id =>
      recById(id)
    );

    // Weitere Betriebsausgaben (erweiterte Option): Betrag × betrieblicher Anteil
    const expenses = (input.expenses || [])
      .filter(x => x && String(x.date || '').startsWith(Y + '-'))
      .map(x => {
        const share = Number(x.share ?? 100);
        const sh = Number.isFinite(share) ? Math.min(100, Math.max(0, share)) : 100;
        return { ...x, amount: r2(x.amount), share: sh, deductible: r2(((Number(x.amount) || 0) * sh) / 100) };
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const totals = {
      income: r2(income.reduce((t, p) => t + p.amount, 0)),
      other: r2(expenses.reduce((t, x) => t + x.deductible, 0)),
      services: r2(servicesY.reduce((t, x) => t + x.gross, 0)),
      open: r2(servicesY.reduce((t, x) => t + x.open, 0)),
      parking: r2(parking.reduce((t, p) => t + (Number(p.amount) || 0), 0)),
      tripKm: r2(carTrips.reduce((t, x) => t + x.km, 0)),
      trips: r2(carTrips.reduce((t, x) => t + x.amount, 0)),
    };
    totals.expenses = r2(totals.parking + totals.trips + totals.other);
    totals.surplus = r2(totals.income - totals.expenses);
    return {
      year: Y,
      rate,
      services,
      servicesY,
      income,
      parkingUnassigned,
      expenses,
      parking: parking.map(p => ({ ...p, entryLabel: entryById.get(p.entryId)?.date || '' })),
      trips,
      carTrips,
      missingKm,
      missingWorkKm,
      fromHome: carTrips.filter(t => t.mode === 'car').length,
      fromWork: carTrips.filter(t => t.mode === 'work').length,
      tripsWithoutParking: carTrips.filter(t => !t.hasParking).length,
      totals,
    };
  }

  // CSV für Excel (Österreich): Semikolon, Dezimalkomma, UTF-8 mit BOM
  const dateAT = iso => {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    return d ? `${d}.${m}.${y}` : String(iso);
  };
  function cell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? r2(v).toFixed(2).replace('.', ',') : '';
    const t = String(v);
    return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }
  const csv = rows => '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
  function csvFiles(rep) {
    const Y = rep.year;
    return {
      [`Einnahmen_${Y}.csv`]: csv([
        [
          'Zahlungsdatum',
          'Zahlungsjahr',
          'Leistungsmonat',
          'Rechnungsempfänger',
          'Honorarnote Nr.',
          'Rechnungsdatum',
          'Betrag (EUR)',
          'Anmerkung',
        ],
        ...rep.income.map(p => [
          p.paidAt ? dateAT(p.paidAt) : 'nicht erfasst',
          paidYear(p),
          p.label,
          p.recipientName,
          p.invoiceNumber,
          dateAT(p.invoiceDate),
          p.amount,
          p.note || (p.paidAt ? '' : 'Zahlungsdatum nicht erfasst'),
        ]),
        [],
        ['Summe', '', '', '', '', '', rep.totals.income, ''],
      ]),
      [`Leistungen_${Y}.csv`]: csv([
        [
          'Leistungsmonat',
          'Rechnungsempfänger',
          'Einsätze',
          'Stunden',
          'Honorar (EUR)',
          'Honorarnote Nr.',
          'Rechnungsdatum',
          'Bezahlt (EUR)',
          'Offen (EUR)',
          'Status',
        ],
        ...rep.servicesY.map(x => [
          x.label,
          x.recipientName,
          String(x.count),
          x.hours,
          x.gross,
          x.invoiceNumber,
          dateAT(x.invoiceDate),
          x.paid,
          x.open,
          x.status,
        ]),
        [],
        ['Summe', '', '', '', rep.totals.services, '', '', '', rep.totals.open, ''],
      ]),
      [`Parkkosten_${Y}.csv`]: csv([
        [
          'Datum',
          'Beginn',
          'Ende',
          'Anbieter',
          'Ort',
          'Zone',
          'Betrag (EUR)',
          'davon USt (EUR)',
          'Beleg',
          'Einsatz am',
        ],
        ...rep.parking.map(p => [
          dateAT(p.date),
          p.start || '',
          p.end || '',
          p.provider || '',
          p.city || '',
          p.zone || '',
          Number(p.amount) || 0,
          Number(p.vat) || 0,
          p.receiptName ||
            String(p.dropboxReceiptPath || '')
              .split('/')
              .pop() ||
            '',
          dateAT(p.entryLabel),
        ]),
        [],
        ['Summe', '', '', '', '', '', rep.totals.parking, '', '', ''],
      ]),
      [`Fahrten_${Y}.csv`]: csv([
        [
          'Datum',
          'Strecke',
          'Start',
          'Einsatzort',
          'Ziel',
          'Zweck',
          'Kilometer gesamt',
          'Satz (EUR/km)',
          'Betrag (EUR)',
          'Kilometer manuell',
          'Parkbeleg vorhanden',
        ],
        ...rep.carTrips.map(t => [
          dateAT(t.date),
          t.route,
          t.from,
          t.via,
          t.to,
          t.purpose,
          t.km,
          t.rate,
          t.amount,
          t.custom ? 'ja' : 'nein',
          t.hasParking ? 'ja' : 'nein',
        ]),
        [],
        ['Summe', '', '', '', '', '', rep.totals.tripKm, '', rep.totals.trips, '', ''],
      ]),
      ...(rep.expenses.length
        ? {
            [`Weitere_Ausgaben_${Y}.csv`]: csv([
              [
                'Datum',
                'Kategorie',
                'Beschreibung',
                'Betrag (EUR)',
                'Betrieblicher Anteil (%)',
                'Absetzbar (EUR)',
                'Beleg',
              ],
              ...rep.expenses.map(x => [
                dateAT(x.date),
                x.category || '',
                x.note || '',
                x.amount,
                String(x.share),
                x.deductible,
                x.receipt || '',
              ]),
              [],
              ['Summe', '', '', '', '', rep.totals.other, ''],
            ]),
          }
        : {}),
    };
  }
  root.OrdiPilotTaxCore = { yearReport, csv, csvFiles, paidYear, monthLabel, r2 };
})(typeof window !== 'undefined' ? window : globalThis);

/* ===== Verdrahtung mit der App ===== */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof state === 'undefined') return;
  const T = window.OrdiPilotTaxCore;
  const ROOT = '/Ordination & Selbständigkeit/Vertretungsdienste';
  const esc = v => escapeHtml(v);
  const eur = n => euro(n);
  const signed = n => (n < 0 ? `− ${euro(-n)}` : euro(n));
  const now = () => new Date().toISOString();
  let year = String(new Date().getFullYear()),
    openPay = null,
    busy = false,
    statusText = '';
  const openSections = new Set(); // aufgeklappte Bereiche bleiben nach jeder Änderung offen

  function ensure() {
    if (!Array.isArray(state.payments)) state.payments = [];
    if (!Array.isArray(state.trips)) state.trips = [];
    if (!state.deletedPayments || typeof state.deletedPayments !== 'object') state.deletedPayments = {};
    if (!state.deletedTrips || typeof state.deletedTrips !== 'object') state.deletedTrips = {};
    if (!Array.isArray(state.expenses)) state.expenses = [];
    if (!state.deletedExpenses || typeof state.deletedExpenses !== 'object') state.deletedExpenses = {};
  }
  function report() {
    ensure();
    return T.yearReport({
      entries: state.entries,
      parking: state.parkingRecords,
      invoices: state.invoices,
      payments: state.payments,
      trips: state.trips,
      expenses: state.settings.expensesEnabled ? state.expenses : [],
      settings: state.settings,
      year,
      fns: { isEarned: e => isEarnedEntry(e), hours: e => entryHours(e) || 0, gross: e => gross(e) || 0 },
    });
  }
  function touchSettings() {
    state.settings._updatedAt = now();
  }
  const EXP_CATS = [
    'Ärztekammer / Wohlfahrtsfonds',
    'Sozialversicherung (SVS)',
    'Berufshaftpflicht',
    'Fortbildung & Kongresse',
    'Fachliteratur',
    'Arbeitsmittel & Kleidung',
    'Telefon & Internet (Anteil)',
    'Steuerberatung',
    'Sonstiges',
  ];
  function save() {
    saveState();
    render();
  }

  // ---- Zahlungen ----
  function addPayment(key, { paidAt = '', paidYear = '', amount = 0, note = '' }) {
    ensure();
    state.payments.push({
      id: uuid('pay'),
      key,
      paidAt,
      paidYear: paidAt ? paidAt.slice(0, 4) : String(paidYear || ''),
      amount: T.r2(amount),
      note,
      updatedAt: now(),
    });
  }
  function removePayments(key) {
    ensure();
    for (const p of state.payments.filter(x => x.key === key)) state.deletedPayments[p.id] = now();
    state.payments = state.payments.filter(x => x.key !== key);
  }

  // ---- Fahrten ----
  function setTrip(entryId, patch) {
    ensure();
    const id = 'trip-' + entryId,
      cur = state.trips.find(t => t.id === id);
    const next = { ...(cur || { id, entryId }), ...patch, updatedAt: now() };
    state.trips = state.trips.filter(t => t.id !== id).concat([next]);
    delete state.deletedTrips[id];
  }

  // ---- Oberfläche ----
  function css() {
    if (document.getElementById('v614-style')) return;
    const st = document.createElement('style');
    st.id = 'v614-style';
    st.textContent = `.v614-card{margin-top:18px;padding:18px;border-radius:var(--r);background:#fff;border:1px solid var(--line);box-shadow:var(--shadow)}
.v614-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}.v614-title{font-size:20px;font-weight:800;letter-spacing:-.01em}.v614-sub{font-size:13px;color:var(--muted)}
.v614-head select{min-height:38px;padding:6px 10px}
.v614-sum{display:grid;gap:0;border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:10px}
.v614-sum>div{display:flex;justify-content:space-between;gap:12px;padding:11px 14px;border-top:1px solid var(--line);font-size:14px}.v614-sum>div:first-child{border-top:0}
.v614-sum small{display:block;color:var(--muted);font-size:12px}.v614-sum b{font-variant-numeric:tabular-nums;white-space:nowrap}.v614-sum .v614-total{background:#f7f9fc;font-weight:750}
.v614-note{font-size:12px;color:var(--muted);margin:6px 2px 12px}.v614-warn{padding:10px 12px;border-radius:12px;background:#fff8e8;border:1px solid #f0dfb5;color:#795b10;font-size:13px;margin:8px 0}
.v614-card details{border:1px solid var(--line);border-radius:14px;margin:10px 0;overflow:hidden}.v614-card summary{list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:13px 14px;cursor:pointer;font-weight:700}
.v614-card summary::-webkit-details-marker{display:none}.v614-card summary span{font-weight:600;color:var(--muted);font-size:13px}.v614-card summary:after{content:"›";color:#9aa3b2;font-size:20px;transform:rotate(90deg);transition:.2s}.v614-card details:not([open]) summary:after{transform:none}
.v614-list{border-top:1px solid var(--line)}.v614-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:11px 14px;border-top:1px solid #f0f2f6}.v614-row:first-child{border-top:0}
.v614-row .t{font-weight:650;font-size:14px}.v614-row .m{font-size:12px;color:var(--muted)}.v614-pill{font-size:11px;font-weight:750;padding:4px 8px;border-radius:999px;white-space:nowrap;border:0}
.v614-pill.ok{background:#edf8ef;color:#248a3d}.v614-pill.open{background:#fff4e5;color:#a35a00}.v614-pill.part{background:#eaf3ff;color:#0066cc}button.v614-pill{cursor:pointer}
.v614-form{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-top:6px}.v614-form label{font-size:12px;color:var(--muted);font-weight:650;display:grid;gap:4px}.v614-form .full{grid-column:1/-1}
.v614-form .chk{display:flex;align-items:center;gap:8px;font-weight:600;color:var(--ink)}.v614-form .chk input{min-height:auto;width:18px;height:18px}
.v614-actions{display:flex;gap:8px;flex-wrap:wrap;grid-column:1/-1}.v614-trip{grid-template-columns:1fr auto auto}.v614-trip select{min-height:36px;padding:5px 8px;font-size:13px}.v614-trip input{width:74px;min-height:36px;padding:5px 8px;font-size:13px;text-align:right}
.v614-settings{display:grid;gap:10px;padding:12px 14px;border-top:1px solid var(--line);background:#fafbfd}.v614-settings label{display:grid;gap:4px;font-size:12px;color:var(--muted);font-weight:650}
.v614-map{float:right;font-weight:650;color:#0066cc;text-decoration:none}.v614-trip select{max-width:118px}
.v614-buttons{display:grid;gap:8px;margin-top:14px}.v614-status{font-size:13px;color:var(--muted);margin-top:8px;min-height:18px}
@media(min-width:700px){.v614-buttons{grid-template-columns:1fr 1fr}}`;
    document.head.appendChild(st);
  }
  function host() {
    let el = document.getElementById('v614Tax');
    if (!el) {
      const panel = document.getElementById('panel-invoice');
      if (!panel) return null;
      el = document.createElement('section');
      el.id = 'v614Tax';
      el.className = 'v614-card no-print';
      (panel.querySelector('.invoice-shell') || panel).appendChild(el);
      bind(el);
    }
    return el;
  }
  function years() {
    const ys = new Set([String(new Date().getFullYear()), year]);
    for (const e of state.entries || []) if (e.date) ys.add(e.date.slice(0, 4));
    for (const p of state.payments || []) {
      const y = T.paidYear(p);
      if (y) ys.add(y);
    }
    return [...ys].sort().reverse();
  }
  function render() {
    const el = host();
    if (!el) return;
    css();
    const rep = report(),
      t = rep.totals,
      s = state.settings,
      recs = s.recipients || [];
    const curYm = todayISO().slice(0, 7);
    const bulk = rep.servicesY.filter(
      x => x.status === 'offen' && x.gross > 0 && x.ym < curYm && !x.ym.endsWith('-12')
    );
    const payRows =
      rep.services
        .map(x => {
          const pill =
            x.status === 'bezahlt'
              ? `<button class="v614-pill ok" data-pay="${esc(x.key)}">bezahlt ${x.payments[0]?.paidAt ? dateAT(x.payments[0].paidAt).slice(0, 6) : x.payments[0]?.paidYear || ''}</button>`
              : x.status === 'teilweise'
                ? `<button class="v614-pill part" data-pay="${esc(x.key)}">${eur(x.paid)} bezahlt</button>`
                : `<button class="v614-pill open" data-pay="${esc(x.key)}">offen · erfassen</button>`;
          const form =
            openPay === x.key
              ? (() => {
                  const p = x.payments[0] || {},
                    unknown = !!(p.id && !p.paidAt);
                  return `<div class="v614-form" data-form="${esc(x.key)}">
        <label>Zahlungseingang am<input type="date" name="date" value="${esc(p.paidAt || todayISO())}" ${unknown ? 'disabled' : ''}></label>
        <label>Betrag (€)<input type="number" step="0.01" inputmode="decimal" name="amount" value="${(p.id ? x.paid : x.open || x.gross).toFixed(2)}"></label>
        <label class="chk full"><input type="checkbox" name="unknown" ${unknown ? 'checked' : ''}> Genaues Datum unbekannt – bezahlt im Jahr <select name="pyear" style="min-height:30px;padding:2px 6px">${[Number(year) - 1, Number(year), Number(year) + 1].map(y => `<option ${String(y) === (p.paidYear || year) ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
        <div class="v614-actions"><button class="btn primary" data-save="${esc(x.key)}">Speichern</button>${p.id ? `<button class="btn danger" data-unpay="${esc(x.key)}">Zahlung entfernen</button>` : ''}<button class="btn" data-cancel>Abbrechen</button></div></div>`;
                })()
              : '';
          return `<div class="v614-row"><div><div class="t">${esc(x.label)}${recs.length > 1 ? ` · ${esc(x.recipientName)}` : ''}</div><div class="m">${eur(x.gross)}${x.invoiceNumber ? ` · Nr. ${esc(x.invoiceNumber)}` : ''}${x.count ? ` · ${x.count} Einsätze` : ''}</div></div>${pill}${form}</div>`;
        })
        .join('') || '<div class="v614-row"><div class="m">Keine abgeschlossenen Einsätze in diesem Jahr.</div></div>';
    const usedRecs = [
      ...new Map(
        rep.trips.map(x => [
          x.recipientId,
          recs.find(r => r.id === x.recipientId) || { id: x.recipientId, name: x.recipientName },
        ])
      ).values(),
    ];
    const homeAddr =
      s.travelHome ||
      String(s.issuerAddress || '')
        .split('\n')
        .map(x => x.trim())
        .filter(Boolean)
        .join(', ');
    const tripRows =
      rep.trips
        .map(
          x => `<div class="v614-row v614-trip"><div><div class="t">${dateAT(x.date)}${x.hasParking ? ' · <span title="Parkbeleg vorhanden">🅿︎</span>' : ''}</div><div class="m">${x.mode === 'none' ? 'nicht mit dem Auto' : x.missing ? (x.missing === 'work' ? 'Entfernung ab Arbeit fehlt' : 'Entfernung fehlt') : `${String(x.km).replace('.', ',')} km${x.custom ? ' (manuell)' : ''} · ${eur(x.amount)}`}</div></div>
      <select data-tripmode="${esc(x.entryId)}" aria-label="Start der Fahrt"><option value="car" ${x.mode === 'car' ? 'selected' : ''}>ab Wohnung</option><option value="work" ${x.mode === 'work' ? 'selected' : ''}>ab Arbeit</option><option value="none" ${x.mode === 'none' ? 'selected' : ''}>kein Auto</option></select>
      <input type="number" step="1" min="0" inputmode="numeric" data-tripkm="${esc(x.entryId)}" value="${x.mode !== 'none' && x.km ? x.km : ''}" ${x.mode === 'none' ? 'disabled' : ''} placeholder="km" aria-label="Kilometer gesamt"></div>`
        )
        .join('') || '<div class="v614-row"><div class="m">Keine abgeschlossenen Einsätze in diesem Jahr.</div></div>';
    const mapsLink = (a, b) =>
      a && b
        ? ` <a class="v614-map" href="https://maps.apple.com/?saddr=${encodeURIComponent(a)}&daddr=${encodeURIComponent(b)}&dirflg=d" target="_blank" rel="noopener">Route prüfen ↗</a>`
        : '';
    const lastExp =
      s.lastTaxExport && s.lastTaxExport.year === year
        ? `Zuletzt erstellt: ${dateAT(String(s.lastTaxExport.at).slice(0, 10))} · ${esc(String(s.lastTaxExport.path).replace(ROOT + '/', ''))}`
        : '';
    el.innerHTML = `<div class="v614-head"><div><div class="v614-title">Steuer &amp; Belege</div><div class="v614-sub">Einnahmen-Ausgaben-Übersicht für den Steuerberater</div></div>
      <select id="v614Year" aria-label="Jahr">${years()
        .map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`)
        .join('')}</select></div>
      <div class="v614-sum">
        <div><span>Einnahmen ${year}<small>Zahlungseingang im Jahr (Zuflussprinzip)</small></span><b>${eur(t.income)}</b></div>
        <div><span>Erbrachte Leistungen ${year}<small>${rep.servicesY.length} Abrechnungsmonate${t.open > 0 ? ` · davon offen ${eur(t.open)}` : ''}</small></span><b>${eur(t.services)}</b></div>
        <div><span>Parkkosten<small>${rep.parking.length} Belege${rep.parkingUnassigned.length ? ` · ${rep.parkingUnassigned.length} ohne Einsatz nicht gezählt (Parken prüfen)` : ''}</small></span><b>− ${eur(t.parking)}</b></div>
        <div><span>Fahrtkosten<small>${rep.carTrips.length} Fahrten${rep.fromWork ? ` (${rep.fromHome} ab Wohnung, ${rep.fromWork} ab Arbeit)` : ''} · ${String(t.tripKm).replace('.', ',')} km × ${String(rep.rate.toFixed(2)).replace('.', ',')} €</small></span><b>− ${eur(t.trips)}</b></div>
        ${s.expensesEnabled ? `<div><span>Weitere Betriebsausgaben<small>${rep.expenses.length} Posten</small></span><b>− ${eur(t.other)}</b></div>` : ''}
        <div class="v614-total"><span>Vorläufiger Überschuss</span><b>${signed(t.surplus)}</b></div>
      </div>
      <div class="v614-note">Nur die Posten aus OrdiPilot – weitere Betriebsausgaben (z. B. Kammer, Versicherung, Fortbildung) und die steuerliche Beurteilung kommen vom Steuerberater.</div>
      ${typeof window.ordipilotTaxExtra === 'function' ? window.ordipilotTaxExtra(rep, year) : ''}
      ${rep.missingKm.length || rep.missingWorkKm.length ? `<div class="v614-warn">Für die Fahrtkosten fehlt ${rep.missingKm.length ? `die Entfernung Wohnung → ${rep.missingKm.map(r => esc(r.name || 'Ordination')).join(', ')}` : ''}${rep.missingKm.length && rep.missingWorkKm.length ? ' und ' : ''}${rep.missingWorkKm.length ? `die Entfernung Arbeit → ${rep.missingWorkKm.map(r => esc(r.name || 'Ordination')).join(', ')}` : ''} – unten unter „Fahrten“ eintragen.</div>` : ''}
      <details ${openPay || openSections.has('v614Pays') ? 'open' : ''} id="v614Pays"><summary>Zahlungseingänge <span>${rep.servicesY.filter(x => x.status === 'bezahlt').length}/${rep.servicesY.filter(x => x.gross > 0).length} bezahlt</span></summary><div class="v614-list">${payRows}</div>
        ${bulk.length > 1 ? `<div class="v614-settings"><button class="btn soft" id="v614Bulk">${bulk.length} ältere offene Monate als bezahlt markieren</button><div class="help">Für Monate, die sicher im Jahr ${year} bezahlt wurden, aber deren genaues Datum du nicht mehr weißt. Für die Jahresrechnung zählt nur das Jahr.</div></div>` : ''}</details>
      <details ${openSections.has('v614Trips') ? 'open' : ''} id="v614Trips"><summary>Fahrten <span>${rep.carTrips.length} · ${eur(t.trips)}${rep.tripsWithoutParking ? ` · ${rep.tripsWithoutParking} ohne Parkbeleg` : ''}</span></summary>
        <div class="v614-settings">
          <label>Wohnadresse (Start und Ende jeder Fahrt)<input id="v614Home" value="${esc(homeAddr)}" placeholder="Straße, PLZ Ort"></label>
          <label>Arbeitsplatz (wenn du direkt von dort fährst)<input id="v614Work" value="${esc(s.travelWork || '')}" placeholder="z. B. Klinik Donaustadt, Langobardenstraße 122, 1220 Wien"></label>
          ${usedRecs
            .map(r => {
              const dest =
                String(r.address || '')
                  .split('\n')
                  .map(x => x.trim())
                  .filter(Boolean)
                  .join(', ') ||
                s.calendarEventLocation ||
                '';
              return `<label>Wohnung → ${esc(r.name || 'Ordination')} (einfache Strecke, km)${mapsLink(homeAddr, dest)}<input type="number" step="0.1" min="0" inputmode="decimal" data-reckm="${esc(r.id)}" value="${esc(r.travelKm ?? '')}" placeholder="km"></label>
          <label>Arbeitsplatz → ${esc(r.name || 'Ordination')} (km)${mapsLink(s.travelWork, dest)}<input type="number" step="0.1" min="0" inputmode="decimal" data-reckmwork="${esc(r.id)}" value="${esc(r.travelKmWork ?? '')}" placeholder="km"></label>`;
            })
            .join('')}
          <label>Standard-Start für Fahrten<select id="v614DefStart"><option value="car" ${s.travelDefaultStart !== 'work' ? 'selected' : ''}>ab Wohnung (hin und zurück)</option><option value="work" ${s.travelDefaultStart === 'work' ? 'selected' : ''}>ab Arbeitsplatz (danach nach Hause)</option></select></label>
          <label>Kilometergeld (€/km)<input id="v614Rate" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(s.travelRate ?? '0.50')}"></label>
          <div class="help">Pro Einsatz gilt der Standard-Start; abweichende Tage unten auf „ab Wohnung“, „ab Arbeit“ oder „kein Auto“ stellen. Ab Arbeit = Arbeitsplatz → Ordination → Wohnung. Kilometer pro Tag lassen sich direkt überschreiben. „Route prüfen“ öffnet die Strecke in Karten. 🅿︎ = Parkbeleg vorhanden.</div>
          <div class="help">Steuerlich offen: ob bei Fahrten ab dem Arbeitsplatz die ganze Strecke oder nur der Umweg gegenüber dem normalen Heimweg zählt – das klärt der Steuerberater. Die App dokumentiert die tatsächlich gefahrene Strecke.</div>
        </div><div class="v614-list">${tripRows}</div></details>
      ${
        s.expensesEnabled
          ? `<details ${openSections.has('v614Exp') ? 'open' : ''} id="v614Exp"><summary>Weitere Betriebsausgaben <span>${rep.expenses.length} · ${eur(t.other)}</span></summary>
        <div class="v614-settings">
          <div class="v614-form" style="padding-top:0">
            <label>Datum<input type="date" id="v616ExpDate" value="${todayISO().startsWith(year) ? todayISO() : year + '-12-31'}"></label>
            <label>Betrag (€)<input type="number" step="0.01" min="0" inputmode="decimal" id="v616ExpAmount" placeholder="0,00"></label>
            <label class="full">Kategorie<select id="v616ExpCat">${EXP_CATS.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
            <label class="full">Beschreibung<input id="v616ExpNote" placeholder="z. B. Jahresbeitrag, Kongress, Fachbuch"></label>
            <label>Betrieblicher Anteil (%)<input type="number" min="0" max="100" step="5" id="v616ExpShare" value="100"></label>
            <div class="v614-actions" style="align-items:end"><button class="btn primary" id="v616ExpAdd">Hinzufügen</button></div>
          </div>
          <div class="help">Nur Ausgaben für die Vertretungstätigkeit. Bei gemischt genutzten Dingen (Handy, Internet) den betrieblichen Anteil eintragen. Was absetzbar ist, entscheidet der Steuerberater.</div>
        </div>
        <div class="v614-list">${rep.expenses.map(x => `<div class="v614-row"><div><div class="t">${esc(x.category)} · ${eur(x.deductible)}</div><div class="m">${dateAT(x.date)}${x.note ? ` · ${esc(x.note)}` : ''}${x.share < 100 ? ` · ${x.share} % von ${eur(x.amount)}` : ''}</div></div><button class="v614-pill open" data-expdel="${esc(x.id)}" aria-label="Entfernen">entfernen</button></div>`).join('') || '<div class="v614-row"><div class="m">Noch keine Ausgaben für dieses Jahr.</div></div>'}</div></details>`
          : `<button class="btn" id="v616ExpOn" style="width:100%;margin-top:4px">+ Weitere Betriebsausgaben erfassen (erweitert)</button>`
      }
      <div class="v614-buttons"><button class="btn primary" id="v614Export">Steuerpaket ${year} in Dropbox erstellen</button><button class="btn soft" id="v614Share">Dateien teilen / herunterladen</button></div>
      <div class="v614-status" id="v614Status">${esc(statusText || lastExp)}</div>`;
  }
  function setStatus(t) {
    statusText = t;
    const el = document.getElementById('v614Status');
    if (el) el.textContent = t;
  }

  function bind(el) {
    el.addEventListener(
      'toggle',
      ev => {
        const d = ev.target;
        if (d.tagName === 'DETAILS' && d.id) {
          if (d.open) openSections.add(d.id);
          else openSections.delete(d.id);
        }
      },
      true
    );
    // Schon beim Antippen merken: läuft gleichzeitig ein Sync und zeichnet neu, bleibt der Bereich trotzdem offen
    el.addEventListener(
      'click',
      ev => {
        const sm = ev.target.closest('summary');
        const d = sm && sm.parentElement;
        if (d && d.tagName === 'DETAILS' && d.id) {
          if (d.open) openSections.delete(d.id);
          else openSections.add(d.id);
        }
      },
      true
    );
    el.addEventListener('change', ev => {
      const t = ev.target;
      if (t.id === 'v614Year') {
        year = t.value;
        openPay = null;
        statusText = '';
        render();
        return;
      }
      if (t.dataset.tripmode) {
        setTrip(t.dataset.tripmode, { mode: t.value, km: null });
        save();
        return;
      }
      if (t.dataset.tripkm) {
        const v = t.value.trim(),
          sel = t.parentElement.querySelector('[data-tripmode]'),
          m = sel && sel.value !== 'none' ? sel.value : 'car';
        setTrip(t.dataset.tripkm, { mode: m, km: v === '' ? null : Number(v.replace(',', '.')) });
        save();
        return;
      }
      if (t.dataset.reckm) {
        const r = (state.settings.recipients || []).find(x => x.id === t.dataset.reckm);
        if (r) {
          r.travelKm = t.value === '' ? '' : Number(t.value.replace(',', '.'));
          touchSettings();
          save();
        }
        return;
      }
      if (t.dataset.reckmwork) {
        const r = (state.settings.recipients || []).find(x => x.id === t.dataset.reckmwork);
        if (r) {
          r.travelKmWork = t.value === '' ? '' : Number(t.value.replace(',', '.'));
          touchSettings();
          save();
        }
        return;
      }
      if (t.id === 'v614Home') {
        state.settings.travelHome = t.value.trim();
        touchSettings();
        save();
        return;
      }
      if (t.id === 'v614Work') {
        state.settings.travelWork = t.value.trim();
        touchSettings();
        save();
        return;
      }
      if (t.id === 'v614DefStart') {
        state.settings.travelDefaultStart = t.value === 'work' ? 'work' : 'car';
        touchSettings();
        save();
        return;
      }
      if (t.id === 'v614Rate') {
        const v = Number(String(t.value).replace(',', '.'));
        state.settings.travelRate = v > 0 ? v : 0.5;
        touchSettings();
        save();
        return;
      }
      if (t.id === 'v616ExpCat') {
        const sh = document.getElementById('v616ExpShare');
        if (sh) sh.value = /Anteil/.test(t.value) ? '50' : '100';
        return;
      }
      if (t.name === 'unknown') {
        const f = t.closest('[data-form]');
        const d = f?.querySelector('[name=date]');
        if (d) d.disabled = t.checked;
      }
    });
    el.addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.pay !== undefined) {
        openPay = openPay === b.dataset.pay ? null : b.dataset.pay;
        render();
        return;
      }
      if (b.hasAttribute('data-cancel')) {
        openPay = null;
        render();
        return;
      }
      if (b.dataset.unpay) {
        if (confirm('Zahlung für diesen Monat entfernen?')) {
          removePayments(b.dataset.unpay);
          openPay = null;
          save();
        }
        return;
      }
      if (b.dataset.save) {
        const f = b.closest('[data-form]'),
          key = b.dataset.save,
          unknown = f.querySelector('[name=unknown]').checked,
          date = f.querySelector('[name=date]').value,
          amount = Number(String(f.querySelector('[name=amount]').value).replace(',', '.'));
        if (!(amount > 0)) {
          alert('Bitte einen Betrag eingeben.');
          return;
        }
        if (!unknown && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          alert('Bitte das Datum des Zahlungseingangs wählen.');
          return;
        }
        removePayments(key);
        addPayment(
          key,
          unknown ? { paidYear: f.querySelector('[name=pyear]').value, amount } : { paidAt: date, amount }
        );
        openPay = null;
        save();
        return;
      }
      if (b.id === 'v614Bulk') {
        const rep = report(),
          curYm = todayISO().slice(0, 7),
          list = rep.servicesY.filter(
            x => x.status === 'offen' && x.gross > 0 && x.ym < curYm && !x.ym.endsWith('-12')
          );
        if (!list.length) return;
        if (
          !confirm(
            `${list.length} Monate (${list[0].label} – ${list[list.length - 1].label}, zusammen ${eur(list.reduce((t, x) => t + x.gross, 0))}) als im Jahr ${year} bezahlt markieren?\n\nDas genaue Datum bleibt „nicht erfasst“. Nur bestätigen, wenn diese Honorare tatsächlich ${year} eingegangen sind.`
          )
        )
          return;
        for (const x of list) addPayment(x.key, { paidYear: year, amount: x.gross });
        save();
        return;
      }
      if (b.id === 'v616ExpOn') {
        state.settings.expensesEnabled = true;
        touchSettings();
        openSections.add('v614Exp');
        save();
        return;
      }
      if (b.id === 'v616ExpAdd') {
        const amount = Number(String(document.getElementById('v616ExpAmount').value).replace(',', '.')),
          date = document.getElementById('v616ExpDate').value;
        if (!(amount > 0)) {
          alert('Bitte einen Betrag eingeben.');
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          alert('Bitte ein Datum wählen.');
          return;
        }
        ensure();
        state.expenses.push({
          id: uuid('exp'),
          date,
          category: document.getElementById('v616ExpCat').value,
          note: document.getElementById('v616ExpNote').value.trim(),
          amount: T.r2(amount),
          share: Math.min(100, Math.max(0, Number(document.getElementById('v616ExpShare').value) || 100)),
          updatedAt: now(),
        });
        save();
        return;
      }
      if (b.dataset.expdel) {
        if (confirm('Diese Ausgabe entfernen?')) {
          ensure();
          state.deletedExpenses[b.dataset.expdel] = now();
          state.expenses = state.expenses.filter(x => x.id !== b.dataset.expdel);
          save();
        }
        return;
      }
      if (b.id === 'v614Export') {
        exportPackage();
        return;
      }
      if (b.id === 'v614Share') {
        shareFiles();
        return;
      }
    });
  }

  // ---- Übersicht als PDF (Standardschrift, kein Nachladen nötig) ----
  const WIN_ANSI_EXTRA = '€‚„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  const pdfSafe = t =>
    String(t ?? '').replace(/[^\x20-\x7e\xa0-\xff]/g, c => (WIN_ANSI_EXTRA.includes(c) ? c : c === '→' ? '->' : ''));
  async function buildPdf(rep) {
    if (!window.PDFLib) throw new Error('PDF_LIB_UNAVAILABLE');
    const { PDFDocument, StandardFonts, rgb } = PDFLib,
      doc = await PDFDocument.create();
    const reg = await doc.embedFont(StandardFonts.Helvetica),
      bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const s = state.settings,
      t = rep.totals,
      W = 595.28,
      H = 841.89,
      L = 56,
      R = W - 56;
    let page = doc.addPage([W, H]),
      y = H - 60;
    const grey = rgb(0.42, 0.45, 0.5),
      ink = rgb(0.09, 0.13, 0.2);
    const text = (x, str, size = 10, f = reg, color = ink) =>
      page.drawText(pdfSafe(str), { x, y, size, font: f, color });
    const right = (x, str, size = 10, f = reg) => {
      const v = pdfSafe(str);
      page.drawText(v, { x: x - f.widthOfTextAtSize(v, size), y, size, font: f, color: ink });
    };
    const need = h => {
      if (y - h < 60) {
        page = doc.addPage([W, H]);
        y = H - 60;
      }
    };
    const line = () => {
      page.drawLine({
        start: { x: L, y: y + 11 },
        end: { x: R, y: y + 11 },
        thickness: 0.5,
        color: rgb(0.85, 0.87, 0.9),
      });
    }; // Trennlinie über der Zeile
    const money = n =>
      signed(n)
        .replace(/[\u00a0\u202f]/g, ' ')
        .replace('−', '-');
    text(L, `Steuerübersicht ${rep.year}`, 18, bold);
    y -= 20;
    text(L, 'Ärztliche Vertretungstätigkeit · Einnahmen-Ausgaben-Übersicht aus OrdiPilot', 10, reg, grey);
    y -= 24;
    for (const l of [
      s.issuerName,
      ...String(s.issuerAddress || '').split('\n'),
      s.taxNumber ? `Steuernummer: ${s.taxNumber}` : '',
    ].filter(Boolean)) {
      text(L, l, 10);
      y -= 13;
    }
    y -= 4;
    text(L, `Stand: ${dateAT(todayISO())}`, 9, reg, grey);
    y -= 26;
    const sumRows = [
      [`Einnahmen ${rep.year} (Zahlungseingang)`, t.income],
      [`Parkkosten (${rep.parking.length} Belege)`, -t.parking],
      [
        `Fahrtkosten (${rep.carTrips.length} Fahrten${rep.fromWork ? `, davon ${rep.fromWork} ab Arbeitsplatz` : ''}, ${String(t.tripKm).replace('.', ',')} km × ${rep.rate.toFixed(2).replace('.', ',')} €)`,
        -t.trips,
      ],
    ];
    text(L, 'Zusammenfassung', 12, bold);
    y -= 18;
    for (const [k, v] of sumRows) {
      line();
      text(L, k);
      right(R, money(v));
      y -= 16;
    }
    if (rep.expenses.length) {
      line();
      text(L, `Weitere Betriebsausgaben (${rep.expenses.length} Posten)`);
      right(R, money(-t.other));
      y -= 16;
    }
    line();
    text(L, 'Vorläufiger Überschuss', 10, bold);
    right(R, money(t.surplus), 10, bold);
    y -= 16;
    y -= 4;
    text(
      L,
      `Erbrachte Leistungen ${rep.year}: ${money(t.services)}${t.open > 0 ? ` · davon noch offen: ${money(t.open)}` : ''}`,
      9,
      reg,
      grey
    );
    y -= 28;
    const table = (title, cols, rows, total) => {
      need(60);
      text(L, title, 12, bold);
      y -= 18;
      const xs = cols.map(c => c[1]);
      need(14);
      cols.forEach(([h, x, al]) => (al === 'r' ? right(x, h, 8.5, bold) : text(x, h, 8.5, bold)));
      y -= 13;
      for (const r of rows) {
        need(14);
        line();
        r.forEach((v, i) =>
          cols[i][2] === 'r' ? right(xs[i], v, 8.5) : text(xs[i], String(v).slice(0, cols[i][3] || 60), 8.5)
        );
        y -= 13;
      }
      if (total) {
        need(14);
        line();
        text(L, 'Summe', 8.5, bold);
        right(R, total, 8.5, bold);
        y -= 13;
      }
      y -= 18;
    };
    table(
      'Einnahmen (Zuflussprinzip)',
      [
        ['Zahlung', L],
        ['Leistungsmonat', L + 68, '', 22],
        ['Empfänger', L + 160, '', 34],
        ['Nr.', L + 345],
        ['Betrag', R, 'r'],
      ],
      rep.income.map(p => [
        p.paidAt ? dateAT(p.paidAt) : `${T.paidYear(p)} (o. D.)`,
        p.label,
        p.recipientName,
        p.invoiceNumber || '–',
        money(p.amount),
      ]),
      money(t.income)
    );
    table(
      `Leistungen ${rep.year} und offene Posten`,
      [
        ['Monat', L, '', 22],
        ['Empfänger', L + 92, '', 30],
        ['Std.', L + 275, 'r'],
        ['Honorar', L + 345, 'r'],
        ['Offen', L + 415, 'r'],
        ['Status', L + 428],
      ],
      rep.servicesY.map(x => [
        x.label,
        x.recipientName,
        String(x.hours).replace('.', ','),
        money(x.gross),
        x.open > 0 ? money(x.open) : '–',
        x.status,
      ]),
      money(t.services)
    );
    if (rep.expenses.length)
      table(
        'Weitere Betriebsausgaben',
        [
          ['Datum', L],
          ['Kategorie', L + 62, '', 30],
          ['Beschreibung', L + 235, '', 34],
          ['Absetzbar', R, 'r'],
        ],
        rep.expenses.map(x => [
          dateAT(x.date),
          x.category,
          x.note + (x.share < 100 ? ` (${x.share} %)` : ''),
          money(x.deductible),
        ]),
        money(t.other)
      );
    need(80);
    text(L, 'Belege und Details', 12, bold);
    y -= 16;
    for (const l of [
      `Einnahmen_${rep.year}.csv, Leistungen_${rep.year}.csv, Parkkosten_${rep.year}.csv, Fahrten_${rep.year}.csv`,
      'Honorarnoten, Parkbelege und Zahlungsnachweise als PDF in den Unterordnern dieses Steuerpakets.',
      'Fahrten: Wohnung – Ordination – Wohnung bzw. Arbeitsplatz – Ordination – Wohnung (tatsächliche Strecke), Kilometergeld lt. obigem Satz.',
      'Vorläufige Aufstellung ohne weitere Betriebsausgaben; steuerliche Beurteilung durch den Steuerberater.',
    ]) {
      need(13);
      text(L, l, 9, reg, grey);
      y -= 13;
    }
    return new Blob([await doc.save()], { type: 'application/pdf' });
  }
  async function buildFiles() {
    const rep = report(),
      files = [];
    for (const [name, content] of Object.entries(T.csvFiles(rep)))
      files.push(new File([content], name, { type: 'text/csv;charset=utf-8' }));
    let pdfNote = '';
    try {
      files.unshift(new File([await buildPdf(rep)], `Steueruebersicht_${rep.year}.pdf`, { type: 'application/pdf' }));
    } catch (e) {
      console.warn(e);
      pdfNote = ' (PDF-Übersicht nicht möglich – keine Internetverbindung?)';
    }
    return { rep, files, pdfNote };
  }
  async function exists(path) {
    try {
      await dbxRpc('files/get_metadata', { path });
      return true;
    } catch (e) {
      if (/not_found/.test(String(e.message || e))) return false;
      throw e;
    }
  }
  async function exportPackage() {
    if (busy) return;
    if (!isDropboxConnected()) {
      alert('Bitte zuerst Dropbox unter Einstellungen verbinden.');
      return;
    }
    busy = true;
    setStatus('Steuerpaket wird erstellt …');
    try {
      const { rep, files, pdfNote } = await buildFiles();
      let base = `${ROOT}/Steuerberater/${rep.year}/Stand_${todayISO()}`;
      if (await exists(base)) base += `_${new Date().toTimeString().slice(0, 5).replace(':', '')}`;
      for (const f of files) {
        setStatus(`Lade ${f.name} hoch …`);
        await dbxUpload(`${base}/${f.name}`, f);
      }
      const notes = [];
      for (const [src, dst, label] of [
        [`${ROOT}/Honorarnoten/${rep.year}`, `${base}/Honorarnoten`, 'Honorarnoten'],
        [`${ROOT}/Parkbelege/${rep.year}`, `${base}/Parkbelege`, 'Parkbelege'],
        [`${ROOT}/Zahlungsnachweise/${rep.year}`, `${base}/Zahlungsnachweise`, 'Zahlungsnachweise'],
      ]) {
        setStatus(`Kopiere ${label} …`);
        try {
          await dbxRpc('files/copy_v2', {
            from_path: src,
            to_path: dst,
            autorename: false,
            allow_ownership_transfer: false,
          });
        } catch (e) {
          if (/not_found/.test(String(e.message || e))) notes.push(`keine ${label} für ${rep.year}`);
          else {
            console.warn(e);
            notes.push(`${label} nicht kopiert`);
          }
        }
      }
      const readme = `Steuerpaket ${rep.year} – erstellt mit OrdiPilot am ${dateAT(todayISO())}\r\n\r\nSteueruebersicht_${rep.year}.pdf – Zusammenfassung\r\nEinnahmen_${rep.year}.csv – Zahlungseingänge (Zuflussprinzip)\r\nLeistungen_${rep.year}.csv – erbrachte Leistungen und offene Posten\r\nParkkosten_${rep.year}.csv – Parkbelege\r\nFahrten_${rep.year}.csv – Fahrten mit Kilometergeld\r\nHonorarnoten/, Parkbelege/, Zahlungsnachweise/ – Belege als PDF\r\n\r\nCSV-Dateien: Semikolon-getrennt, öffnen in Excel per Doppelklick.\r\n`;
      await dbxUpload(`${base}/LIESMICH.txt`, new Blob(['﻿' + readme], { type: 'text/plain;charset=utf-8' }));
      state.settings.lastTaxExport = { year: rep.year, path: base, at: now() };
      touchSettings();
      saveState();
      statusText = `Steuerpaket erstellt: ${base.replace(ROOT + '/', '')}${notes.length ? ` · ${notes.join(', ')}` : ''}${pdfNote}`;
      render();
    } catch (e) {
      console.error(e);
      setStatus('Steuerpaket konnte nicht erstellt werden – bitte später erneut versuchen.');
    } finally {
      busy = false;
    }
  }
  async function shareFiles() {
    if (busy) return;
    busy = true;
    setStatus('Dateien werden vorbereitet …');
    try {
      const { files, pdfNote } = await buildFiles();
      if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
        try {
          await navigator.share({ files, title: `Steuerunterlagen ${year}` });
          setStatus(`Geteilt${pdfNote}`);
          return;
        } catch (e) {
          if (e?.name === 'AbortError') {
            setStatus('');
            return;
          }
        }
      }
      for (const f of files) await downloadBlob(f, f.name);
      setStatus(`${files.length} Dateien heruntergeladen${pdfNote}`);
    } catch (e) {
      console.error(e);
      setStatus('Dateien konnten nicht erstellt werden.');
    } finally {
      busy = false;
    }
  }

  window.ordipilotTax = {
    report,
    render,
    buildFiles,
    exportPackage,
    setYear: y => {
      year = String(y);
      render();
    },
  };
  OrdiPilotExt.extend(
    'refreshAll',
    baseRefresh =>
      function () {
        const out = baseRefresh.apply(this, arguments);
        try {
          render();
        } catch (e) {
          console.warn('Steuer-Ansicht', e);
        }
        return out;
      }
  );
  OrdiPilotBoot.add('v614-tax:1', () => {
    ensure();
    try {
      render();
    } catch (e) {
      console.warn('Steuer-Ansicht', e);
    }
  });
})();
