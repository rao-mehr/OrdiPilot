const DROPBOX_APP_KEY = 'nn8s58mxbb5sbp5';
const INITIAL_STATE = {
  entries: [],
  settings: {
    defaultRate: 170,
    reservePct: 50,
    year: 2026,
    morningStart: '08:00',
    morningEnd: '13:00',
    afternoonStart: '13:00',
    afternoonEnd: '18:00',
    fullDayStart: '08:00',
    fullDayEnd: '17:00',
    issuerName: '',
    issuerQualification: '',
    issuerAddress: '',
    issuerEmail: '',
    issuerPhone: '',
    iban: '',
    bic: '',
    taxNumber: '',
    recipientName: '',
    recipientQualification: '',
    recipientAddress: '',
    serviceDescription: 'Ärztliche Vertretungstätigkeit',
    paymentText:
      'Ich erkläre, für die steuerliche und sozialversicherungsrechtliche Erfassung des Betrages der o.a. Leistung selbst zu sorgen.',
    taxNote: 'Der Betrag ist umsatzsteuerfrei gem. § 6 Abs 1 Z 19 UStG.',
    dropboxAppKey: 'nn8s58mxbb5sbp5',
    dropboxSyncPath: '/Ordination & Selbständigkeit/Vertretungsdienste/System/daten.json',
    dropboxAutoSync: true,
    _updatedAt: '2026-09-10T21:45:00.000Z',
    salutation: '',
    signoffName: '',
    easyParkImportPath: '/Ordination & Selbständigkeit/Vertretungsdienste/System/Import/easypark.json',
    iosShortcutName: 'Vertretung Familienkalender',
    calendarEventTitle: 'Vertretung Dr. Vakil-Adli',
    calendarEventLocation: 'Stockerauer Str. 5/6, 2100 Korneuburg',
    calendarTargetName: 'Vertretung Ordination',
    calendarGroupName: 'Familienkalender',
    calendarAutoSync: true,
    calendarAutoDelete: true,
    calendarButtonEnabled: true,
    recipientEmail: '',
    invoiceMailShortcut: 'Honorarnote senden',
    invoiceDropboxBase: '/Ordination & Selbständigkeit/Vertretungsdienste/Honorarnoten',
  },
  parkingRecords: [],
  invoices: [],
};
const MONTHS = [
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
const KEY = 'vertretungsabrechnung-v3',
  OLD_KEYS = ['vertretungsabrechnung-v2', 'vertretungsabrechnung-v1'],
  AUTH_KEY = 'vertretungsabrechnung-dropbox-auth';
let state = loadState(),
  editingId = null,
  editingParkingId = null,
  pendingReceiptFile = null,
  syncTimer = null,
  entryDialogMode = 'plan',
  entryPlannerCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  parkingFocusUnassigned = false;
function clone(x) {
  return JSON.parse(JSON.stringify(x));
}
function nowISO() {
  return new Date().toISOString();
}
function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
function splitLegacyQualification(settings, prefix) {
  const qKey = prefix + 'Qualification',
    aKey = prefix + 'Address',
    raw = String(settings[aKey] || '').trim();
  if (String(settings[qKey] || '').trim() || !raw.includes('\n')) return;
  const lines = raw
      .split(/\n+/)
      .map(x => x.trim())
      .filter(Boolean),
    first = lines[0] || '';
  if (
    /^(facharzt|fachärzt|arzt|ärzt|oberarzt|oberärzt|primar|prof\.|universitätsprof|ordination|specialist)/i.test(first)
  ) {
    settings[qKey] = first;
    settings[aKey] = lines.slice(1).join('\n');
  }
}

function loadState() {
  try {
    const cur = JSON.parse(localStorage.getItem(KEY));
    if (cur?.entries && cur?.settings) return normalizeState(cur);
    for (const k of OLD_KEYS) {
      const old = JSON.parse(localStorage.getItem(k));
      if (old?.entries && old?.settings) return normalizeState(old);
    }
  } catch (e) {}
  return normalizeState(clone(INITIAL_STATE));
}

function euro(n) {
  return new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
}
function dec(n, d = 2) {
  return new Intl.NumberFormat('de-AT', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n || 0));
}
function dateAT(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function todayISO() {
  const d = new Date(),
    z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function uuid(prefix = 'e') {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function monthKey(e) {
  return e.date ? e.date.slice(0, 7) : '';
}

function years() {
  const s = new Set([...state.entries, ...state.parkingRecords].map(e => e.date?.slice(0, 4)).filter(Boolean));
  s.add(String(new Date().getFullYear()));
  s.add(String(state.settings.year || 2026));
  return [...s].sort();
}
function fillSelect(sel, vals, value) {
  const cur = value ?? sel.value;
  sel.innerHTML = '';
  vals.forEach(v => {
    const o = document.createElement('option');
    o.value = String(v.value ?? v);
    o.textContent = String(v.label ?? v);
    sel.appendChild(o);
  });
  if ([...sel.options].some(o => o.value === String(cur))) sel.value = String(cur);
}
function setupSelectors() {
  const ys = years().map(y => ({ value: y, label: y }));
  ['dashYear', 'entryYear', 'parkingYear', 'invYear'].forEach(id =>
    fillSelect(
      document.getElementById(id),
      ys,
      document.getElementById(id).value || String(state.settings.year || 2026)
    )
  );
  for (const id of ['entryMonth', 'parkingMonth']) {
    const el = document.getElementById(id),
      prev = el.value;
    el.innerHTML = '<option value="">Alle Monate</option>';
    MONTHS.forEach((m, i) =>
      el.insertAdjacentHTML('beforeend', `<option value="${String(i + 1).padStart(2, '0')}">${m}</option>`)
    );
    el.value = prev;
  }
  const im = invMonth,
    p = im.value;
  im.innerHTML = '';
  MONTHS.forEach((m, i) =>
    im.insertAdjacentHTML('beforeend', `<option value="${String(i + 1).padStart(2, '0')}">${m}</option>`)
  );
  im.value = p || String(new Date().getMonth() + 1).padStart(2, '0');
}
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  if (name === 'invoice') renderInvoice();
  if (name === 'entries') renderEntries();
  if (name === 'parking') renderParking();
  if (name === 'dashboard') {
    renderOverviewV6();
    setTimeout(renderCharts, 30);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
function timeMinutes(t) {
  if (!t || !/^[0-2]\d:[0-5]\d$/.test(t)) return null;
  const [a, b] = t.split(':').map(Number);
  return a * 60 + b;
}
function parkingMinutes(p) {
  const a = timeMinutes(p.start),
    b = timeMinutes(p.end);
  if (a === null || b === null) return 0;
  let d = b - a;
  if (d < 0) d += 1440;
  return d;
}
function entryStatus(e) {
  const t = todayISO();
  if (e.confirmedAt) return 'done';
  if (e.date > t) return 'planned';
  if (e.planningOnly) return e.date === t ? 'today' : 'open';
  return entryHours(e) !== null ? 'done' : 'open';
}
function isEarnedEntry(e) {
  return entryStatus(e) === 'done';
}

function yearForecast(y, data) {
  const today = todayISO(),
    earnedEntries = state.entries.filter(e => e.date?.startsWith(y + '-') && e.date <= today && entryHours(e) !== null),
    avgH = earnedEntries.length ? earnedEntries.reduce((s, e) => s + entryHours(e), 0) / earnedEntries.length : 0,
    future = state.entries.filter(e => e.date?.startsWith(y + '-') && e.date > today);
  let futureGross = 0,
    estimated = 0;
  for (const e of future) {
    const h = entryHours(e);
    if (h !== null) futureGross += h * Number(e.rate || state.settings.defaultRate || 0);
    else if (avgH > 0) {
      futureGross += avgH * Number(e.rate || state.settings.defaultRate || 0);
      estimated++;
    }
  }
  const earned = earnedEntries.reduce((s, e) => s + gross(e), 0);
  return { total: earned + futureGross, futureCount: future.length, estimated, avgH };
}

function isoFromDate(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function daysBetweenISO(a, b) {
  const A = new Date(a + 'T12:00:00'),
    B = new Date(b + 'T12:00:00');
  return Math.round((B - A) / 86400000);
}
function prettyDate(v, withYear = false) {
  if (!v) return '';
  const [y, m, d] = v.split('-').map(Number),
    dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(
    'de-AT',
    withYear
      ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      : { weekday: 'long', day: 'numeric', month: 'long' }
  );
}
function entriesOnDate(date) {
  return state.entries
    .filter(e => e.date === date)
    .sort((a, b) => (entryPlannedStart(a) || a.start || '').localeCompare(entryPlannedStart(b) || b.start || ''));
}

function drawBarChart(canvas, values, labels, formatter) {
  const rect = canvas.getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, rect.width * dpr);
  canvas.height = Math.max(180, rect.height * dpr);
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  const w = canvas.width / dpr,
    h = canvas.height / dpr,
    p = { l: 44, r: 10, t: 12, b: 30 },
    cw = w - p.l - p.r,
    ch = h - p.t - p.b,
    max = Math.max(...values, 1);
  c.clearRect(0, 0, w, h);
  c.font = '11px Segoe UI,Arial';
  c.fillStyle = '#6b7280';
  c.strokeStyle = '#e5e7eb';
  c.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = p.t + (ch * i) / 3;
    c.beginPath();
    c.moveTo(p.l, y);
    c.lineTo(w - p.r, y);
    c.stroke();
    const val = max * (1 - i / 3);
    c.fillText(formatter(val), 2, y + 4);
  }
  const gap = 5,
    bw = Math.max(4, (cw - gap * 11) / 12);
  values.forEach((v, i) => {
    const x = p.l + i * (bw + gap),
      bh = ch * (v / max),
      y = p.t + ch - bh;
    c.fillStyle = '#1f4f8f';
    c.fillRect(x, y, bw, bh);
    c.fillStyle = '#6b7280';
    c.fillText(labels[i], x + Math.max(0, bw / 2 - 4), h - 8);
  });
}
function drawComboChart(canvas, hours, parking, labels) {
  const rect = canvas.getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, rect.width * dpr);
  canvas.height = Math.max(180, rect.height * dpr);
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  const w = canvas.width / dpr,
    h = canvas.height / dpr,
    p = { l: 38, r: 12, t: 12, b: 30 },
    cw = w - p.l - p.r,
    ch = h - p.t - p.b,
    maxH = Math.max(...hours, 1),
    maxP = Math.max(...parking, 1);
  c.clearRect(0, 0, w, h);
  c.strokeStyle = '#e5e7eb';
  for (let i = 0; i < 4; i++) {
    const y = p.t + (ch * i) / 3;
    c.beginPath();
    c.moveTo(p.l, y);
    c.lineTo(w - p.r, y);
    c.stroke();
  }
  const step = cw / 12;
  parking.forEach((v, i) => {
    const bh = ch * 0.45 * (v / maxP),
      x = p.l + i * step + step * 0.18;
    c.fillStyle = '#dbe5f3';
    c.fillRect(x, p.t + ch - bh, step * 0.64, bh);
  });
  c.beginPath();
  hours.forEach((v, i) => {
    const x = p.l + i * step + step / 2,
      y = p.t + ch - (v / maxH) * ch * 0.95;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.strokeStyle = '#1f4f8f';
  c.lineWidth = 2.2;
  c.stroke();
  hours.forEach((v, i) => {
    const x = p.l + i * step + step / 2,
      y = p.t + ch - (v / maxH) * ch * 0.95;
    c.beginPath();
    c.arc(x, y, 2.6, 0, Math.PI * 2);
    c.fillStyle = '#1f4f8f';
    c.fill();
  });
  c.font = '11px Segoe UI,Arial';
  c.fillStyle = '#6b7280';
  labels.forEach((l, i) => c.fillText(l, p.l + i * step + step / 2 - 4, h - 8));
  c.fillText('h', 3, 15);
  c.fillText('Park €', w - 44, 15);
}

function drawLineChart(canvas, values, labels, formatter) {
  const rect = canvas.getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, rect.width * dpr);
  canvas.height = Math.max(180, rect.height * dpr);
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  const w = canvas.width / dpr,
    h = canvas.height / dpr,
    p = { l: 44, r: 10, t: 12, b: 30 },
    cw = w - p.l - p.r,
    ch = h - p.t - p.b,
    max = Math.max(...values, 1);
  c.clearRect(0, 0, w, h);
  c.strokeStyle = '#e5e7eb';
  c.fillStyle = '#6b7280';
  c.font = '11px Segoe UI,Arial';
  for (let i = 0; i < 4; i++) {
    const yy = p.t + (ch * i) / 3;
    c.beginPath();
    c.moveTo(p.l, yy);
    c.lineTo(w - p.r, yy);
    c.stroke();
    c.fillText(formatter(max * (1 - i / 3)), 2, yy + 4);
  }
  const step = cw / Math.max(1, values.length - 1);
  c.beginPath();
  values.forEach((v, i) => {
    const x = p.l + i * step,
      yy = p.t + ch - (v / max) * ch;
    i ? c.lineTo(x, yy) : c.moveTo(x, yy);
  });
  c.strokeStyle = '#1f4f8f';
  c.lineWidth = 2.3;
  c.stroke();
  values.forEach((v, i) => {
    const x = p.l + i * step,
      yy = p.t + ch - (v / max) * ch;
    c.beginPath();
    c.arc(x, yy, 2.6, 0, Math.PI * 2);
    c.fillStyle = '#1f4f8f';
    c.fill();
    c.fillStyle = '#6b7280';
    c.fillText(labels[i], x - 4, h - 8);
  });
}
function renderCharts() {
  if (!document.getElementById('grossChart')) return;
  const y = dashYear.value || String(state.settings.year),
    data = monthlyData(y),
    labels = MONTHS.map(m => m.slice(0, 1)),
    grossVals = data.map(x => x.g);
  drawBarChart(grossChart, grossVals, labels, v => Math.round(v / 1000) + 'k');
  drawComboChart(
    hoursChart,
    data.map(x => x.h),
    data.map(x => x.parking),
    labels
  );
  let sum = 0;
  const cumulative = grossVals.map(v => (sum += v));
  drawLineChart(cumulativeChart, cumulative, labels, v => Math.round(v / 1000) + 'k');
  const wd = [0, 0, 0, 0, 0, 0, 0],
    wdLabels = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  state.entries
    .filter(e => e.date?.startsWith(y + '-') && entryHours(e) !== null)
    .forEach(e => {
      wd[new Date(e.date + 'T12:00:00').getDay()]++;
    });
  drawBarChart(weekdayChart, wd, wdLabels, v => String(Math.round(v)));
}
window.addEventListener('resize', () => {
  if (document.getElementById('panel-dashboard').classList.contains('active')) renderCharts();
});
function filteredEntries() {
  const y = entryYear.value,
    m = entryMonth.value,
    q = entrySearch.value.trim().toLowerCase();
  return state.entries
    .filter(
      e =>
        (!y || e.date?.startsWith(y + '-')) &&
        (!m || e.date?.slice(5, 7) === m) &&
        (!q || dateAT(e.date).includes(q) || (e.note || '').toLowerCase().includes(q))
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}
function isIOSDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
function showV65CalendarToast(text = 'Kalender wird aktualisiert …') {
  const el = document.getElementById('v65CalendarToast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(showV65CalendarToast._t);
  showV65CalendarToast._t = setTimeout(() => el.classList.remove('show'), 2200);
}
function entryCalendarPayload(e, action = 'upsert') {
  const ps = entryPlannedStart(e) || e.start,
    pe = entryPlannedEnd(e) || e.end;
  if (!e || !e.date || (action !== 'delete' && (!ps || !pe))) throw new Error('TIMES_REQUIRED');
  let start = null,
    end = null;
  if (action !== 'delete') {
    start = new Date(`${e.date}T${ps}:00`);
    end = new Date(`${e.date}T${pe}:00`);
    if (end <= start) end.setDate(end.getDate() + 1);
  }
  return {
    schema: 'vertretungsabrechnung-calendar-v1',
    action,
    calendarName: state.settings.calendarTargetName || 'Vertretung Ordination',
    calendarGroup: state.settings.calendarGroupName || 'Familienkalender',
    title: state.settings.calendarEventTitle || 'Vertretung Dr. Vakil-Adli',
    startISO: start ? start.toISOString() : null,
    endISO: end ? end.toISOString() : null,
    startLocal: action !== 'delete' ? `${e.date}T${ps}:00` : null,
    endLocal:
      action !== 'delete'
        ? `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}T${pe}:00`
        : null,
    location: state.settings.calendarEventLocation || 'Stockerauer Str. 5/6, 2100 Korneuburg',
    notes: [e.note || '', `Vertretungsabrechnung-ID: ${e.id}`].filter(Boolean).join(' · '),
    entryId: e.id,
    timeToLeave: true,
  };
}
function calendarShortcutName() {
  const raw = String(state.settings.iosShortcutName || '').trim(),
    bad = [
      'Familienkalender: Vertretung Ordination',
      'Vertretung Ordination',
      'Familienkalender → Vertretung Ordination',
    ],
    name = !raw || bad.includes(raw) ? 'Vertretung Familienkalender' : raw;
  if (state.settings.iosShortcutName !== name) {
    state.settings.iosShortcutName = name;
    state.settings._updatedAt = nowISO();
    saveState(false);
  }
  return name;
}
function runIOSCalendarShortcut(e, action = 'upsert', manual = false) {
  if (!e) return false;
  if (action !== 'delete' && (!(entryPlannedStart(e) || e.start) || !(entryPlannedEnd(e) || e.end))) {
    if (manual) alert('Für den Kalendereintrag bitte zuerst Beginn und Ende beim Einsatz eintragen.');
    return false;
  }
  const name = calendarShortcutName();
  if (!name) {
    if (manual) alert('Bitte unter Einstellungen den Namen des Apple-Kurzbefehls eintragen.');
    return false;
  }
  if (!isIOSDevice()) {
    if (manual && action === 'upsert') {
      downloadEntryICS(e);
      return true;
    }
    if (manual && action === 'delete')
      alert('Automatisches Löschen aus Apple Kalender ist nur über den iOS-Kurzbefehl möglich.');
    return false;
  }
  let payload;
  try {
    payload = entryCalendarPayload(e, action);
  } catch (err) {
    if (manual) alert('Kalendereintrag konnte nicht vorbereitet werden.');
    return false;
  }
  showV65CalendarToast(action === 'delete' ? 'Kalendereintrag wird entfernt …' : 'Apple Kalender wird aktualisiert …');
  const callback = location.href.split('#')[0].split('?')[0] + '?calendarCallback=1';
  window.location.href = `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(JSON.stringify(payload))}&x-success=${encodeURIComponent(callback)}&x-cancel=${encodeURIComponent(callback + '&status=cancel')}&x-error=${encodeURIComponent(callback + '&status=error')}`;
  return true;
}
function addEntryToIOSCalendar(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  runIOSCalendarShortcut(e, 'upsert', true);
}
function downloadEntryICS(e) {
  const ps = entryPlannedStart(e) || e.start,
    pe = entryPlannedEnd(e) || e.end;
  if (!ps || !pe) {
    alert('Für einen Kalendereintrag sind Beginn und Ende erforderlich.');
    return;
  }
  const pad = n => String(n).padStart(2, '0'),
    fmt = d =>
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`,
    esc = v => {
      let x = String(v || '');
      x = x.split('\\').join('\\\\');
      x = x.split('\n').join('\\n');
      x = x.split(',').join('\\,');
      x = x.split(';').join('\\;');
      return x;
    };
  const start = new Date(`${e.date}T${ps}:00`),
    end = new Date(`${e.date}T${pe}:00`);
  if (end <= start) end.setDate(end.getDate() + 1);
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Vertretungsabrechnung//DE\r\nBEGIN:VEVENT\r\nUID:${esc(e.id)}@vertretungsabrechnung\r\nDTSTAMP:${fmt(new Date())}\r\nDTSTART:${fmt(start)}\r\nDTEND:${fmt(end)}\r\nSUMMARY:${esc(state.settings.calendarEventTitle || 'Vertretung')}\r\nLOCATION:${esc(state.settings.calendarEventLocation || '')}\r\nDESCRIPTION:${esc([e.breakMinutes ? `Pause: ${e.breakMinutes} Minuten` : '', e.note || ''].filter(Boolean).join(' · '))}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = `Vertretung_${e.date}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function entryParkingRecords(id) {
  return state.parkingRecords.filter(p => p.entryId === id);
}
function entryParkingTotal(id) {
  return entryParkingRecords(id).reduce((s, p) => s + parkAmount(p), 0);
}
function entryPlannedStart(e) {
  return e.plannedStart || (entryStatus(e) === 'planned' || entryStatus(e) === 'today' ? e.start : '') || '';
}
function entryPlannedEnd(e) {
  return e.plannedEnd || (entryStatus(e) === 'planned' || entryStatus(e) === 'today' ? e.end : '') || '';
}
function entryPlannedTime(e) {
  const a = entryPlannedStart(e),
    b = entryPlannedEnd(e);
  return a || b ? `${a || '–'}${b ? '–' + b : ''}` : 'Zeit offen';
}
function entryActualTime(e) {
  return e.start || e.end ? `${e.start || '–'}${e.end ? '–' + e.end : ''}` : '–';
}

function renderEntries() {
  const arr = filteredEntries();
  entryRows.innerHTML = '';
  arr.forEach(e => {
    const st = entryStatus(e),
      h = entryHours(e),
      g = isEarnedEntry(e) ? gross(e) : null,
      park = entryParkingTotal(e.id),
      tr = document.createElement('tr'),
      planned = entryPlannedTime(e),
      actual = isEarnedEntry(e) ? entryActualTime(e) : '–';
    tr.innerHTML = `<td>${dateAT(e.date)}</td><td>${planned}</td><td>${actual}</td><td class="num">${h === null || !isEarnedEntry(e) ? '–' : dec(h, 2)}</td><td class="num">${g === null ? '–' : euro(g)}</td><td class="num">${park ? euro(park) : '–'}</td><td>${statusBadge(e)}</td><td>${escapeHtml(e.note || '')}</td><td class="right nowrap">${(st === 'today' || st === 'open') && e.planningOnly ? `<button class="iconbtn" data-confirm="${e.id}" title="Einsatz bestätigen">✓</button>` : ''}${state.settings.calendarButtonEnabled && entryPlannedStart(e) && entryPlannedEnd(e) ? `<button class="iconbtn" data-cal="${e.id}" title="Zum Familienkalender hinzufügen">📅</button>` : ''}<button class="iconbtn" data-edit="${e.id}">✎</button><button class="iconbtn" data-del="${e.id}">🗑</button></td>`;
    entryRows.appendChild(tr);
  });
  const currentMk = todayISO().slice(0, 7),
    groups = new Map();
  arr.forEach(e => {
    const mk = e.date.slice(0, 7);
    if (!groups.has(mk)) groups.set(mk, []);
    groups.get(mk).push(e);
  });
  const keys = [...groups.keys()].sort().reverse();
  entryCards.innerHTML = keys.length
    ? keys
        .map(mk => {
          const es = groups.get(mk),
            [yy, mm] = mk.split('-'),
            done = es.filter(isEarnedEntry),
            pending = es.filter(e => !isEarnedEntry(e)),
            grossSum = done.reduce((sum, e) => sum + (gross(e) || 0), 0),
            open = mk === currentMk || entryMonth.value === mm;
          return `<details class="v62-month-group" ${open ? 'open' : ''}><summary><div><div class="v62-month-group-title">${MONTHS[Number(mm) - 1]} ${yy}</div><div class="v62-month-group-meta">${done.length} erledigt · ${pending.length} geplant/offen · ${dec(
            done.reduce((sum, e) => sum + (entryHours(e) || 0), 0),
            1
          )} h</div></div><div class="v62-month-group-total">${euro(grossSum)}</div></summary><div class="v62-month-group-body">${es
            .sort((a, b) => b.date.localeCompare(a.date))
            .map(entryCardHtml)
            .join('')}</div></details>`;
        })
        .join('')
    : '<div class="v6-open-empty">Keine Einsätze im ausgewählten Jahr.</div>';
  bindEntryActions();
}
function bindEntryActions() {
  document.querySelectorAll('[data-cal]').forEach(b => (b.onclick = () => addEntryToIOSCalendar(b.dataset.cal)));
  document.querySelectorAll('[data-confirm]').forEach(b => (b.onclick = () => openEntry(b.dataset.confirm, 'confirm')));
  document.querySelectorAll('[data-edit]').forEach(b => (b.onclick = () => openEntry(b.dataset.edit)));
  document.querySelectorAll('[data-del]').forEach(b => (b.onclick = () => deleteEntry(b.dataset.del)));
}
function setEntryPlannerCursor(v) {
  if (!v) return;
  const [y, m] = v.split('-').map(Number);
  entryPlannerCursor = new Date(y, m - 1, 1);
}
function renderEntryPlannerCalendar() {
  if (!window.entryPlannerGrid || entryDialogMode !== 'plan') return;
  const y = entryPlannerCursor.getFullYear(),
    m = entryPlannerCursor.getMonth();
  entryCalTitle.textContent = `${MONTHS[m]} ${y}`;
  const first = new Date(y, m, 1),
    start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = isoFromDate(d),
      inMonth = d.getMonth() === m,
      has = entriesOnDate(iso).length > 0,
      cls = [
        'entry-plan-day',
        inMonth ? '' : 'out',
        iso === todayISO() ? 'today' : '',
        iso === fDate.value ? 'selected' : '',
        has ? 'has-entry' : '',
      ]
        .filter(Boolean)
        .join(' ');
    html += `<button type="button" class="${cls}" data-entry-cal-date="${iso}">${d.getDate()}</button>`;
  }
  entryPlannerGrid.innerHTML = html;
  entryPlannerGrid.querySelectorAll('[data-entry-cal-date]').forEach(
    b =>
      (b.onclick = () => {
        fDate.value = b.dataset.entryCalDate;
        const dt = new Date(fDate.value + 'T12:00:00');
        entryPlannerCursor = new Date(dt.getFullYear(), dt.getMonth(), 1);
        updateEntryDateUI();
        renderEntryPlannerCalendar();
      })
  );
}
function entryDateLabel(v) {
  if (!v) return '';
  const [y, m, d] = v.split('-').map(Number),
    dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('de-AT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}
function entryDateShort(v) {
  if (!v) return '–';
  const [y, m, d] = v.split('-').map(Number),
    dt = new Date(y, m - 1, d);
  return dt
    .toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' })
    .replace(',', ',');
}
function updateEntryDateUI() {
  const isToday = fDate.value === todayISO();
  entryTodayBadge.style.display = isToday ? 'inline-flex' : 'none';
  entryDateHuman.textContent = entryDateLabel(fDate.value);
  entryDateDisplay.textContent = entryDateShort(fDate.value);
}
function timePresetDefinitions() {
  const st = state.settings || {};
  return {
    morning: [st.morningStart || '08:00', st.morningEnd || '13:00'],
    afternoon: [st.afternoonStart || '13:00', st.afternoonEnd || '18:00'],
    fullday: [st.fullDayStart || '08:00', st.fullDayEnd || '17:00'],
  };
}

function updateTimePresetActive() {
  if (!window.timePresetBar) return;
  const d = timePresetDefinitions();
  timePresetBar.querySelectorAll('[data-time-preset]').forEach(b => {
    const v = d[b.dataset.timePreset] || [];
    b.classList.toggle('active', !!fStart.value && !!fEnd.value && fStart.value === v[0] && fEnd.value === v[1]);
  });
}
function applyTimePreset(name) {
  const d = timePresetDefinitions()[name];
  if (!d) return;
  fStart.value = d[0];
  fEnd.value = d[1];
  updateTimePresetActive();
  updateCalc();
}

[fStart, fEnd, fBreak, fManual, fRate].forEach(x => x.addEventListener('input', updateCalc));
fDate.addEventListener('change', () => {
  updateEntryDateUI();
  setEntryPlannerCursor(fDate.value);
  renderEntryPlannerCalendar();
});
saveEntry.addEventListener('click', ev => {
  ev.preventDefault();
  if (!fDate.value || !fRate.value) {
    alert('Bitte Datum und Stundensatz eintragen.');
    return;
  }
  const old = editingId ? state.entries.find(x => x.id === editingId) : null,
    isPlan = entryDialogMode === 'plan',
    check = validateEntryFormV63(isPlan);
  if (!check.ok) {
    alert(check.message);
    return;
  }
  if (
    check.overnight &&
    !confirm(`Das Ende liegt am Folgetag. Berechnete Dauer: ${dec(check.hours, 2)} h. So übernehmen?`)
  )
    return;
  if (
    check.longShift &&
    !confirm(
      `Die berechnete Arbeitszeit beträgt ${dec(check.hours, 2)} h. Bitte bestätige, dass diese lange Dauer korrekt ist.`
    )
  )
    return;
  if (old && monthLockedV63(old.date.slice(0, 7))) {
    alert('Dieser Monat ist bereits signiert/abgeschlossen. Lege unter Dokumente zuerst eine Korrektur an.');
    return;
  }
  if (monthLockedV63(fDate.value.slice(0, 7))) {
    alert('Der Zielmonat ist bereits signiert/abgeschlossen. Lege unter Dokumente zuerst eine Korrektur an.');
    return;
  }
  let obj;
  if (isPlan) {
    obj = {
      ...(old || {}),
      id: editingId || uuid(),
      date: fDate.value,
      plannedStart: fStart.value,
      plannedEnd: fEnd.value,
      start: old && isEarnedEntry(old) ? old.start || '' : '',
      end: old && isEarnedEntry(old) ? old.end || '' : '',
      breakMinutes: old && isEarnedEntry(old) ? Number(old.breakMinutes || 0) : 0,
      manualHours: old && isEarnedEntry(old) ? old.manualHours : null,
      rate: Number(fRate.value),
      note: fNote.value.trim(),
      planningOnly: true,
      confirmedAt: null,
      source: old?.source || 'App',
      updatedAt: nowISO(),
    };
  } else {
    obj = {
      ...(old || {}),
      id: editingId || uuid(),
      date: fDate.value,
      plannedStart: old?.plannedStart || old?.start || '',
      plannedEnd: old?.plannedEnd || old?.end || '',
      start: fStart.value,
      end: fEnd.value,
      breakMinutes: Number(fBreak.value || 0),
      manualHours: fManual.value === '' ? null : Number(fManual.value),
      rate: Number(fRate.value),
      note: fNote.value.trim(),
      planningOnly: false,
      confirmedAt: old?.confirmedAt || nowISO(),
      source: old?.source || 'App',
      updatedAt: nowISO(),
    };
  }
  if (editingId) {
    state.entries[state.entries.findIndex(x => x.id === editingId)] = obj;
  } else state.entries.push(obj);
  reconcileParkingAssignments();
  saveState();
  entryDialog.close();
  refreshAll();
  if (isPlan && state.settings.calendarAutoSync !== false) runIOSCalendarShortcut(obj, 'upsert', false);
});
function deleteEntry(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  if (monthLockedV63(e.date.slice(0, 7))) {
    alert('Dieser Monat ist bereits signiert/abgeschlossen. Lege unter Dokumente zuerst eine Korrektur an.');
    return;
  }
  if (confirm(`Einsatz am ${dateAT(e.date)} wirklich löschen?`)) {
    const shouldDeleteCalendar = state.settings.calendarAutoDelete !== false;
    state.deletedEntries[id] = nowISO();
    state.entries = state.entries.filter(x => x.id !== id);
    reconcileParkingAssignments();
    saveState();
    refreshAll();
    if (shouldDeleteCalendar) runIOSCalendarShortcut(e, 'delete', false);
  }
}
// IndexedDB for local receipt blobs
function openReceiptDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('VertretungsabrechnungReceipts', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('receipts');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function putReceipt(id, file) {
  const db = await openReceiptDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('receipts', 'readwrite');
    tx.objectStore('receipts').put(file, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function getReceipt(id) {
  const db = await openReceiptDb();
  return new Promise((res, rej) => {
    const r = db.transaction('receipts').objectStore('receipts').get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}
async function delReceipt(id) {
  const db = await openReceiptDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('receipts', 'readwrite');
    tx.objectStore('receipts').delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
function entryLabel(id) {
  const e = state.entries.find(x => x.id === id);
  return e ? `${dateAT(e.date)} · ${entryHours(e) === null ? 'ohne Stunden' : dec(entryHours(e), 1) + ' h'}` : '–';
}
function filteredParking() {
  const y = parkingYear.value,
    m = parkingMonth.value,
    pf = parkingProviderFilter.value;
  return state.parkingRecords
    .filter(p => (!y || p.date?.startsWith(y + '-')) && (!m || p.date?.slice(5, 7) === m) && (!pf || p.provider === pf))
    .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
}

function bindParkingActions() {
  document.querySelectorAll('[data-pedit]').forEach(b => (b.onclick = () => openParking(b.dataset.pedit)));
  document.querySelectorAll('[data-pdel]').forEach(b => (b.onclick = () => deleteParking(b.dataset.pdel)));
  document.querySelectorAll('[data-pview]').forEach(b => (b.onclick = () => openReceipt(b.dataset.pview)));
}
function focusFirstUnassignedParking() {
  const el = document.querySelector('#parkingCards [data-unassigned="1"]');
  if (el) {
    const d = el.closest('details');
    if (d) d.open = true;
    el.classList.add('v62-focus-ring');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => el.classList.remove('v62-focus-ring'), 1700);
  }
  parkingFocusUnassigned = false;
}
function fillParkingEntryOptions(selected = '', date = '') {
  pEntryId.innerHTML = '<option value="">automatisch / keine Zuordnung</option>';
  state.entries
    .filter(e => !date || e.date === date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(e => {
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = entryLabel(e.id);
      pEntryId.appendChild(o);
    });
  if ([...pEntryId.options].some(o => o.value === selected)) pEntryId.value = selected;
}
let parkingPlannerCursor = new Date();
function setParkingPlannerCursor(v) {
  if (!v) return;
  const [y, m] = v.split('-').map(Number);
  parkingPlannerCursor = new Date(y, m - 1, 1);
}
function renderParkingCalendar() {
  if (!window.parkingCalGrid) return;
  const y = parkingPlannerCursor.getFullYear(),
    m = parkingPlannerCursor.getMonth();
  parkingCalTitle.textContent = `${MONTHS[m]} ${y}`;
  const first = new Date(y, m, 1),
    start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = isoFromDate(d),
      cls = [
        'parking-cal-day',
        d.getMonth() === m ? '' : 'out',
        iso === todayISO() ? 'today' : '',
        iso === pDate.value ? 'selected' : '',
      ]
        .filter(Boolean)
        .join(' ');
    html += `<button type="button" class="${cls}" data-parking-date="${iso}">${d.getDate()}</button>`;
  }
  parkingCalGrid.innerHTML = html;
  parkingCalGrid.querySelectorAll('[data-parking-date]').forEach(
    b =>
      (b.onclick = () => {
        pDate.value = b.dataset.parkingDate;
        setParkingPlannerCursor(pDate.value);
        fillParkingEntryOptions(pEntryId.value, pDate.value);
        renderParkingCalendar();
      })
  );
}
async function detectParkingPosition() {
  if (!navigator.geolocation) {
    parkingLocationStatus.textContent = 'Standorterkennung wird auf diesem Gerät nicht unterstützt.';
    return;
  }
  parkingLocationStatus.textContent = 'Standort wird ermittelt …';
  detectParkingLocation.disabled = true;
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const lat = pos.coords.latitude,
        lon = pos.coords.longitude;
      let label = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1&accept-language=de`
        );
        if (r.ok) {
          const j = await r.json(),
            a = j.address || {},
            place = a.city || a.town || a.village || a.municipality || a.suburb || '',
            street = [a.road || a.pedestrian || a.footway || '', a.house_number || ''].filter(Boolean).join(' ');
          label = [street, place].filter(Boolean).join(', ') || j.display_name || label;
        }
      } catch (e) {}
      pCity.value = label;
      parkingLocationStatus.textContent = `Erkannt · Genauigkeit ca. ${Math.round(pos.coords.accuracy || 0)} m`;
      detectParkingLocation.disabled = false;
    },
    err => {
      parkingLocationStatus.textContent =
        err.code === 1
          ? 'Standortzugriff nicht erlaubt. Du kannst den Ort weiterhin manuell eingeben.'
          : 'Standort konnte nicht ermittelt werden.';
      detectParkingLocation.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}
function openParking(id = null) {
  editingParkingId = id;
  pendingReceiptFile = null;
  const p = id
    ? state.parkingRecords.find(x => x.id === id)
    : {
        date: todayISO(),
        amount: '',
        provider: 'HANDYPARKEN',
        entryId: '',
        start: '',
        end: '',
        city: '',
        zone: '',
        vat: 0,
        documentType: 'manual',
        note: '',
        assignmentMode: 'auto',
        excluded: false,
      };
  parkingModalTitle.textContent = id ? 'Parkvorgang bearbeiten' : 'Neuer Parkvorgang';
  pDate.value = p.date || todayISO();
  pAmount.value = p.amount ?? '';
  pProvider.value = p.provider || 'HANDYPARKEN';
  pStart.value = p.start || '';
  pEnd.value = p.end || '';
  pCity.value = p.city || '';
  pZone.value = p.zone || '';
  pVat.value = p.vat ?? '';
  pDocumentType.value = p.documentType || 'manual';
  pExcluded.value = p.excluded ? 'excluded' : 'counted';
  pNote.value = p.note || '';
  pReceipt.value = '';
  pReceiptInfo.textContent = p.receiptName
    ? `Vorhanden: ${p.receiptName}`
    : p.dropboxReceiptPath
      ? `Dropbox: ${p.dropboxReceiptPath}`
      : 'Kein Beleg ausgewählt.';
  parkingLocationStatus.textContent = 'Optional: per GPS erkennen oder manuell eintragen.';
  fillParkingEntryOptions(p.excluded ? '' : p.entryId || '', p.date);
  pEntryId.disabled = !!p.excluded;
  setParkingPlannerCursor(pDate.value);
  renderParkingCalendar();
  parkingDialog.showModal();
}
pDate.addEventListener('change', () => {
  fillParkingEntryOptions(pEntryId.value, pDate.value);
  setParkingPlannerCursor(pDate.value);
  renderParkingCalendar();
});
pExcluded.addEventListener('change', () => {
  const excluded = pExcluded.value === 'excluded';
  pEntryId.disabled = excluded;
  if (excluded) pEntryId.value = '';
});
pReceipt.addEventListener('change', () => {
  pendingReceiptFile = pReceipt.files?.[0] || null;
  pReceiptInfo.textContent = pendingReceiptFile
    ? `${pendingReceiptFile.name} · ${(pendingReceiptFile.size / 1024).toFixed(0)} KB`
    : 'Kein Beleg ausgewählt.';
});
saveParking.addEventListener('click', async ev => {
  ev.preventDefault();
  if (!pDate.value || pAmount.value === '') {
    alert('Bitte Datum und Betrag eintragen.');
    return;
  }
  const old = editingParkingId ? state.parkingRecords.find(x => x.id === editingParkingId) : null,
    id = editingParkingId || uuid('p'),
    excluded = pExcluded.value === 'excluded',
    manualEntry = excluded ? '' : pEntryId.value,
    obj = {
      id,
      date: pDate.value,
      amount: Number(pAmount.value),
      provider: pProvider.value,
      entryId: manualEntry,
      start: pStart.value,
      end: pEnd.value,
      city: pCity.value.trim(),
      zone: pZone.value.trim(),
      vat: Number(pVat.value || 0),
      documentType: pDocumentType.value,
      note: pNote.value.trim(),
      excluded,
      source: old?.source || 'App',
      receiptName: pendingReceiptFile?.name || old?.receiptName || '',
      receiptType: pendingReceiptFile?.type || old?.receiptType || '',
      dropboxReceiptPath: old?.dropboxReceiptPath || '',
      assignmentMode: excluded ? 'excluded' : manualEntry ? 'manual' : 'auto',
      assignmentReason: excluded ? 'privat / nicht berücksichtigt' : manualEntry ? 'manuell gewählt' : '',
      updatedAt: nowISO(),
    };
  if (!manualEntry && !excluded) {
    const best = bestParkingAssignment(obj);
    obj.entryId = best.id;
    obj.assignmentReason = best.reason;
  }
  if (pendingReceiptFile) {
    try {
      await putReceipt(id, pendingReceiptFile);
    } catch (e) {
      alert('Der Beleg konnte lokal nicht gespeichert werden.');
    }
  }
  if (editingParkingId) state.parkingRecords[state.parkingRecords.findIndex(x => x.id === id)] = obj;
  else state.parkingRecords.push(obj);
  saveState();
  parkingDialog.close();
  refreshAll();
  if (pendingReceiptFile && isDropboxConnected()) {
    try {
      await uploadReceiptToDropbox(obj, pendingReceiptFile);
      saveState(false);
      renderParking();
    } catch (e) {
      console.warn(e);
      setDropboxStatus('Beleg lokal gespeichert; Dropbox-Upload fehlgeschlagen.', 'warn');
    }
  }
});
async function deleteParking(id) {
  const p = state.parkingRecords.find(x => x.id === id);
  if (p && confirm(`Parkvorgang ${dateAT(p.date)} (${euro(p.amount)}) löschen?`)) {
    state.deletedParking[id] = nowISO();
    state.parkingRecords = state.parkingRecords.filter(x => x.id !== id);
    try {
      await delReceipt(id);
    } catch (e) {}
    saveState();
    refreshAll();
  }
}
async function openReceipt(id) {
  const p = state.parkingRecords.find(x => x.id === id);
  if (!p) return;
  if (p.dropboxReceiptPath && isDropboxConnected()) {
    try {
      const link = await dropboxTemporaryLink(p.dropboxReceiptPath);
      window.open(link, '_blank');
      return;
    } catch (e) {
      console.warn(e);
    }
  }
  const blob = await getReceipt(id);
  if (blob) {
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else
    alert(
      'Auf diesem Gerät ist kein lokaler Beleg gespeichert. Wenn der Beleg in Dropbox liegt, verbinde zuerst Dropbox.'
    );
}

function monthEndDay(y, m) {
  return new Date(Number(y), Number(m), 0).getDate();
}
function modelMoney(n) {
  return `${Number(n || 0)
    .toFixed(2)
    .replace('.', ',')} €`;
}
function modelHours(n) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100).replace('.', ',');
}

function modelPeriod(y, m) {
  const mm = String(m).padStart(2, '0'),
    last = String(monthEndDay(y, m)).padStart(2, '0');
  return `01.${mm}.${y} – ${last}.${mm}.${y}`;
}
function invoiceRateText(es, hrs) {
  const rates = [...new Set(es.map(e => Number(e.rate || 0)))];
  return rates.length === 1 ? `${modelHours(hrs)} Stunden à ${modelMoney(rates[0])}` : `${modelHours(hrs)} Stunden`;
}

[invYear, invMonth].forEach(x => x.addEventListener('change', invoicePeriodChanged));
[invNumber, invDate].forEach(x => x.addEventListener('change', renderInvoice));
invNumber.addEventListener('input', renderInvoice);

function buildPdf(content) {
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>';
  objs[4] = `<< /Length ${content.length} >>\nstream\n${content}endstream`;
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  let pdf = '%PDF-1.4\n',
    off = [0];
  for (let i = 1; i < objs.length; i++) {
    off[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) pdf += String(off[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

function upsertInvoiceRecord(patch) {
  state.invoices = state.invoices || [];
  const key = patch.key || invoiceKey(),
    ix = state.invoices.findIndex(r => r.key === key),
    base = ix >= 0 ? state.invoices[ix] : { key, year: invYear.value, month: invMonth.value };
  const rec = { ...base, ...patch, key, updatedAt: nowISO() };
  if (ix >= 0) state.invoices[ix] = rec;
  else state.invoices.push(rec);
  saveState();
  return rec;
}
function openInvoiceDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('VertretungsabrechnungDocuments', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function putInvoiceBlob(key, blob) {
  const db = await openInvoiceDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('documents', 'readwrite');
    tx.objectStore('documents').put(blob, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function getInvoiceBlob(key) {
  const db = await openInvoiceDb();
  return new Promise((res, rej) => {
    const rq = db.transaction('documents').objectStore('documents').get(key);
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => rej(rq.error);
  });
}

function setStep(el, statusEl, done, active, label) {
  el.classList.toggle('done', !!done);
  el.classList.toggle('active', !!active);
  statusEl.textContent = label || (done ? 'erledigt' : 'offen');
  statusEl.className = 'doc-status-pill' + (done ? ' ok' : active ? ' blue' : '');
}

async function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const DROPBOX_PKCE_KEY = 'vertretungsabrechnung-dropbox-pkce';
function redirectURL() {
  const u = new URL('./', location.href);
  return u.origin + u.pathname;
}
function authData() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function saveAuth(a) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(a));
}
function isDropboxConnected() {
  const a = authData();
  return !!(a.refreshToken || a.accessToken);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
function randomVerifier() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~',
    a = new Uint8Array(64);
  crypto.getRandomValues(a);
  return Array.from(a, b => chars[b % chars.length]).join('');
}
function savePkce(data) {
  localStorage.setItem(DROPBOX_PKCE_KEY, JSON.stringify(data));
  sessionStorage.setItem('dropboxCodeVerifier', data.verifier || '');
}
function loadPkce() {
  try {
    return JSON.parse(localStorage.getItem(DROPBOX_PKCE_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function clearPkce() {
  localStorage.removeItem(DROPBOX_PKCE_KEY);
  sessionStorage.removeItem('dropboxCodeVerifier');
}
async function connectDropboxFlow() {
  const appKey = DROPBOX_APP_KEY;
  setDropboxAppKey.value = DROPBOX_APP_KEY;
  state.settings.dropboxAppKey = DROPBOX_APP_KEY;
  if (!appKey) {
    alert('Dropbox App Key ist nicht verfügbar.');
    return;
  }
  if (!window.isSecureContext || !crypto?.subtle) {
    alert('Dropbox-Verbindung benötigt die veröffentlichte HTTPS-Version der App.');
    return;
  }
  state.settings.dropboxAppKey = appKey;
  state.settings.dropboxSyncPath =
    setDropboxPath.value.trim() || '/Ordination & Selbständigkeit/Vertretungsdienste/System/daten.json';
  state.settings._updatedAt = nowISO();
  saveState(false);
  const verifier = randomVerifier(),
    digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    challenge = base64url(digest),
    redir = redirectURL();
  savePkce({ verifier, appKey, redirectUri: redir, createdAt: Date.now() });
  const qs = new URLSearchParams({
      client_id: appKey,
      response_type: 'code',
      redirect_uri: redir,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      token_access_type: 'offline',
    }),
    authUrl = 'https://www.dropbox.com/oauth2/authorize?' + qs.toString();
  const w = window.open(authUrl, '_blank');
  if (!w) {
    location.assign(authUrl);
  }
}
async function tokenRequest(params) {
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function handleDropboxCallback() {
  const q = new URLSearchParams(location.search),
    code = q.get('code'),
    err = q.get('error');
  if (err) {
    setDropboxStatus('Dropbox-Verbindung abgebrochen.', 'warn');
    history.replaceState({}, document.title, location.pathname);
    return;
  }
  if (!code) return;
  const pkce = loadPkce(),
    appKey = state.settings.dropboxAppKey || pkce.appKey || DROPBOX_APP_KEY,
    ver = pkce.verifier || sessionStorage.getItem('dropboxCodeVerifier'),
    redir = pkce.redirectUri || redirectURL();
  if (pkce.appKey && !state.settings.dropboxAppKey) {
    state.settings.dropboxAppKey = pkce.appKey;
    saveState(false);
  }
  if (!appKey || !ver) {
    setDropboxStatus(
      'Dropbox-Rückleitung erkannt, aber die iOS-Anmeldedaten fehlen. Bitte erneut auf „Mit Dropbox verbinden“ tippen.',
      'warn'
    );
    return;
  }
  try {
    setDropboxStatus('Dropbox wird verbunden…', 'busy');
    const r = await tokenRequest({
      code,
      grant_type: 'authorization_code',
      client_id: appKey,
      redirect_uri: redir,
      code_verifier: ver,
    });
    saveAuth({
      accessToken: r.access_token,
      refreshToken: r.refresh_token || '',
      expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : 0,
    });
    history.replaceState({}, document.title, location.pathname);
    clearPkce();
    setDropboxStatus('Dropbox verbunden.', 'on');
    await syncWithDropbox();
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'vertretung-dropbox-connected' }, location.origin);
        setTimeout(() => window.close(), 450);
      }
    } catch (_) {}
  } catch (e) {
    console.error(e);
    setDropboxStatus('Dropbox-Verbindung fehlgeschlagen.', 'warn');
  }
}
window.addEventListener('message', ev => {
  if (ev.origin === location.origin && ev.data?.type === 'vertretung-dropbox-connected') {
    loadSettingsForm();
    setDropboxStatus('Dropbox verbunden.', 'on');
    setTimeout(() => syncWithDropbox(), 250);
  }
});
/* V6.12: Dropbox verlangt reines ASCII im Header – Umlaute (z. B. "Selbständigkeit") als \uXXXX maskieren. */
function dbxArg(o) {
  return JSON.stringify(o).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
async function ensureAccessToken() {
  const a = authData(),
    appKey = state.settings.dropboxAppKey || DROPBOX_APP_KEY;
  if (!appKey) throw new Error('Dropbox App Key fehlt');
  if (a.accessToken && (!a.expiresAt || a.expiresAt > Date.now() + 60000)) return a.accessToken;
  if (a.refreshToken) {
    const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: a.refreshToken, client_id: appKey });
    const next = { ...a, accessToken: r.access_token, expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : 0 };
    saveAuth(next);
    return next.accessToken;
  }
  throw new Error('Dropbox-Anmeldung abgelaufen');
}
async function dbxRpc(endpoint, arg) {
  const token = await ensureAccessToken(),
    r = await fetch('https://api.dropboxapi.com/2/' + endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(arg || {}),
    });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function dbxDownload(path) {
  const token = await ensureAccessToken(),
    r = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Dropbox-API-Arg': dbxArg({ path }) },
    });
  if (r.status === 409) {
    const txt = await r.text();
    if (txt.includes('not_found')) return null;
    throw new Error(txt);
  }
  if (!r.ok) throw new Error(await r.text());
  return r.blob();
}
async function ensureDropboxFolders(path) {
  const parts = String(path || '')
    .split('/')
    .filter(Boolean)
    .slice(0, -1);
  let cur = '';
  for (const part of parts) {
    cur += '/' + part;
    try {
      await dbxRpc('files/create_folder_v2', { path: cur, autorename: false });
    } catch (e) {
      if (!String(e.message || e).includes('conflict')) throw e;
    }
  }
}
async function dbxUpload(path, blob) {
  await ensureDropboxFolders(path);
  const token = await ensureAccessToken(),
    r = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': dbxArg({ path, mode: 'overwrite', autorename: false, mute: true, strict_conflict: false }),
      },
      body: blob,
    });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
function cleanStateForCloud(s) {
  return clone(s);
}
function mergeCollections(local, remote, deletedL, deletedR) {
  const del = { ...(deletedR || {}) };
  for (const [id, t] of Object.entries(deletedL || {})) {
    if (!del[id] || new Date(t) > new Date(del[id])) del[id] = t;
  }
  const map = new Map();
  for (const obj of [...(remote || []), ...(local || [])]) {
    const cur = map.get(obj.id);
    if (!cur || new Date(obj.updatedAt || 0) > new Date(cur.updatedAt || 0)) map.set(obj.id, obj);
  }
  for (const [id, t] of Object.entries(del)) {
    const obj = map.get(id);
    if (obj && new Date(t) >= new Date(obj.updatedAt || 0)) map.delete(id);
  }
  return { items: [...map.values()], deleted: del };
}
function mergeInvoices(local = [], remote = []) {
  const map = new Map(),
    stamp = r => new Date(r.updatedAt || r.mailOpenedAt || r.signedAt || r.createdAt || 0).getTime();
  for (const r of [...remote, ...local]) {
    if (!r?.key) continue;
    const cur = map.get(r.key);
    if (!cur || stamp(r) >= stamp(cur)) map.set(r.key, r);
  }
  return [...map.values()];
}
function mergeStates(local, remote) {
  remote = normalizeState(remote);
  const em = mergeCollections(local.entries, remote.entries, local.deletedEntries, remote.deletedEntries),
    pm = mergeCollections(local.parkingRecords, remote.parkingRecords, local.deletedParking, remote.deletedParking),
    ls = local.settings || {},
    rs = remote.settings || {},
    settings = new Date(ls._updatedAt || 0) >= new Date(rs._updatedAt || 0) ? ls : rs,
    invoices = mergeInvoices(local.invoices, remote.invoices);
  return normalizeState({
    entries: em.items,
    parkingRecords: pm.items,
    invoices,
    deletedEntries: em.deleted,
    deletedParking: pm.deleted,
    settings,
  });
}

function mergeEasyParkImport(doc) {
  const recs = Array.isArray(doc) ? doc : doc?.records || [];
  let added = 0,
    updated = 0;
  for (const r of recs) {
    if (!r || !r.messageId || !r.date) continue;
    const id = 'easypark-' + String(r.messageId).replace(/[^a-zA-Z0-9_-]/g, ''),
      existing = state.parkingRecords.find(p => p.id === id),
      tmp = { date: r.date, start: r.start || '', end: r.end || '' },
      best = bestParkingAssignment(tmp);
    const incoming = {
      id,
      date: r.date,
      start: r.start || '',
      end: r.end || '',
      amount: Number(r.amount || 0),
      vat: Number(r.vat || 0),
      provider: 'EasyPark',
      city: r.city || '',
      zone: r.zone || '',
      entryId: existing?.assignmentMode === 'manual' ? existing.entryId : r.entryId || best.id || '',
      assignmentMode: existing?.assignmentMode === 'manual' ? 'manual' : 'auto',
      assignmentReason: existing?.assignmentMode === 'manual' ? existing.assignmentReason : best.reason || '',
      documentType: r.documentType || 'confirmation',
      source: 'EasyPark/Gmail',
      sourceMessageId: r.messageId,
      receiptName: r.receiptName || '',
      dropboxReceiptPath: r.dropboxReceiptPath || '',
      officialUrl: r.officialUrl || '',
      note: r.note || '',
      updatedAt: r.updatedAt || r.importedAt || nowISO(),
    };
    const ix = state.parkingRecords.findIndex(p => p.id === id);
    if (ix < 0) {
      state.parkingRecords.push(incoming);
      added++;
    } else if (
      new Date(incoming.updatedAt) > new Date(state.parkingRecords[ix].updatedAt || 0) ||
      state.parkingRecords[ix].assignmentMode === 'auto'
    ) {
      state.parkingRecords[ix] = { ...state.parkingRecords[ix], ...incoming };
      updated++;
    }
  }
  reconcileParkingAssignments();
  return { added, updated, total: recs.length };
}

function scheduleDropboxSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncWithDropbox(), 1800);
}

async function dropboxTemporaryLink(path) {
  const r = await dbxRpc('files/get_temporary_link', { path });
  return r.link;
}
reassignParking.onclick = () => {
  const r = reconcileParkingAssignments(true);
  saveState();
  refreshAll();
  alert(
    `Parkzuordnung neu berechnet: ${r.assigned} Vorgänge zugeordnet${r.changed ? ` · ${r.changed} geändert` : ''}.`
  );
};
connectDropbox.onclick = connectDropboxFlow;

disconnectDropbox.onclick = () => {
  if (confirm('Dropbox-Verbindung nur auf diesem Gerät löschen? Die Dateien in Dropbox bleiben erhalten.')) {
    localStorage.removeItem(AUTH_KEY);
    setDropboxStatus('Nicht verbunden');
  }
};
openIOSShortcut.onclick = () => {
  const name = calendarShortcutName();
  if (!isIOSDevice()) {
    alert(
      'Der Apple-Kurzbefehl wird auf iPhone/iPad verwendet. Auf anderen Geräten erzeugt die Kalender-Schaltfläche stattdessen eine .ics-Datei.'
    );
    return;
  }
  window.location.href = `shortcuts://open-shortcut?name=${encodeURIComponent(name)}`;
};
function loadSettingsForm() {
  const s = state.settings;
  setRate.value = s.defaultRate;
  setReserve.value = s.reservePct;
  setMorningStart.value = s.morningStart || '08:00';
  setMorningEnd.value = s.morningEnd || '13:00';
  setAfternoonStart.value = s.afternoonStart || '13:00';
  setAfternoonEnd.value = s.afternoonEnd || '18:00';
  setFullDayStart.value = s.fullDayStart || '08:00';
  setFullDayEnd.value = s.fullDayEnd || '17:00';
  setService.value = s.serviceDescription || '';
  setSalutation.value = s.salutation || '';
  setSignoffName.value = s.signoffName || '';
  setPayment.value = s.paymentText || '';
  setTaxNote.value = s.taxNote || '';
  setIssuerName.value = s.issuerName || '';
  setIssuerQualification.value = s.issuerQualification || '';
  setIssuerAddress.value = s.issuerAddress || '';
  setIssuerEmail.value = s.issuerEmail || '';
  setIssuerPhone.value = s.issuerPhone || '';
  setIban.value = s.iban || '';
  setBic.value = s.bic || '';
  setTaxNumber.value = s.taxNumber || '';
  setRecipientName.value = s.recipientName || '';
  setRecipientQualification.value = s.recipientQualification || '';
  setRecipientAddress.value = s.recipientAddress || '';
  setRecipientEmail.value = s.recipientEmail || '';
  setInvoiceMailShortcut.value = s.invoiceMailShortcut || 'Honorarnote senden';
  setInvoiceDropboxBase.value = s.invoiceDropboxBase || '/Ordination & Selbständigkeit/Vertretungsdienste/Honorarnoten';
  setDropboxAppKey.value = DROPBOX_APP_KEY;
  setDropboxPath.value = s.dropboxSyncPath || '/Ordination & Selbständigkeit/Vertretungsdienste/System/daten.json';
  setEasyParkImportPath.value =
    s.easyParkImportPath || '/Ordination & Selbständigkeit/Vertretungsdienste/System/Import/easypark.json';
  setIOSShortcutName.value = s.iosShortcutName || 'Vertretung Familienkalender';
  setCalendarTargetName.value = s.calendarTargetName || 'Vertretung Ordination';
  setCalendarEventTitle.value = s.calendarEventTitle || 'Vertretung Dr. Vakil-Adli';
  setCalendarEventLocation.value = s.calendarEventLocation || 'Stockerauer Str. 5/6, 2100 Korneuburg';
  setCalendarAutoSync.checked = s.calendarAutoSync !== false;
  setCalendarAutoDelete.checked = s.calendarAutoDelete !== false;
  setCalendarButtonEnabled.checked = s.calendarButtonEnabled !== false;
  setDropboxAuto.checked = !!s.dropboxAutoSync;
  redirectUri.textContent = redirectURL();
  setDropboxStatus(
    isDropboxConnected() ? 'Auf diesem Gerät verbunden' : 'Nicht verbunden',
    isDropboxConnected() ? 'on' : 'off'
  );
}
function saveSettingsForm() {
  Object.assign(state.settings, {
    defaultRate: Number(setRate.value || 170),
    reservePct: Number(setReserve.value || 0),
    morningStart: setMorningStart.value || '08:00',
    morningEnd: setMorningEnd.value || '13:00',
    afternoonStart: setAfternoonStart.value || '13:00',
    afternoonEnd: setAfternoonEnd.value || '18:00',
    fullDayStart: setFullDayStart.value || '08:00',
    fullDayEnd: setFullDayEnd.value || '17:00',
    serviceDescription: setService.value.trim(),
    salutation: setSalutation.value.trim(),
    signoffName: setSignoffName.value.trim(),
    paymentText: setPayment.value.trim(),
    taxNote: setTaxNote.value.trim(),
    issuerName: setIssuerName.value.trim(),
    issuerQualification: setIssuerQualification.value.trim(),
    issuerAddress: setIssuerAddress.value.trim(),
    issuerEmail: setIssuerEmail.value.trim(),
    issuerPhone: setIssuerPhone.value.trim(),
    iban: setIban.value.trim(),
    bic: setBic.value.trim(),
    taxNumber: setTaxNumber.value.trim(),
    recipientName: setRecipientName.value.trim(),
    recipientQualification: setRecipientQualification.value.trim(),
    recipientAddress: setRecipientAddress.value.trim(),
    recipientEmail: setRecipientEmail.value.trim(),
    invoiceMailShortcut: setInvoiceMailShortcut.value.trim() || 'Honorarnote senden',
    invoiceDropboxBase:
      setInvoiceDropboxBase.value.trim() || '/Ordination & Selbständigkeit/Vertretungsdienste/Honorarnoten',
    dropboxAppKey: DROPBOX_APP_KEY,
    dropboxSyncPath:
      setDropboxPath.value.trim() || '/Ordination & Selbständigkeit/Vertretungsdienste/System/daten.json',
    easyParkImportPath:
      setEasyParkImportPath.value.trim() ||
      '/Ordination & Selbständigkeit/Vertretungsdienste/System/Import/easypark.json',
    iosShortcutName: setIOSShortcutName.value.trim() || 'Vertretung Familienkalender',
    calendarTargetName: setCalendarTargetName.value.trim() || 'Vertretung Ordination',
    calendarGroupName: 'Familienkalender',
    calendarEventTitle: setCalendarEventTitle.value.trim() || 'Vertretung Dr. Vakil-Adli',
    calendarEventLocation: setCalendarEventLocation.value.trim() || 'Stockerauer Str. 5/6, 2100 Korneuburg',
    calendarAutoSync: setCalendarAutoSync.checked,
    calendarAutoDelete: setCalendarAutoDelete.checked,
    calendarButtonEnabled: setCalendarButtonEnabled.checked,
    dropboxAutoSync: setDropboxAuto.checked,
    _updatedAt: nowISO(),
  });
  saveState();
  refreshAll(false);
}
[
  'setRate',
  'setReserve',
  'setMorningStart',
  'setMorningEnd',
  'setAfternoonStart',
  'setAfternoonEnd',
  'setFullDayStart',
  'setFullDayEnd',
  'setService',
  'setSalutation',
  'setSignoffName',
  'setPayment',
  'setTaxNote',
  'setIssuerName',
  'setIssuerQualification',
  'setIssuerAddress',
  'setIssuerEmail',
  'setIssuerPhone',
  'setIban',
  'setBic',
  'setTaxNumber',
  'setRecipientName',
  'setRecipientQualification',
  'setRecipientAddress',
  'setRecipientEmail',
  'setInvoiceMailShortcut',
  'setInvoiceDropboxBase',
  'setDropboxAppKey',
  'setDropboxPath',
  'setEasyParkImportPath',
  'setIOSShortcutName',
  'setCalendarTargetName',
  'setCalendarEventTitle',
  'setCalendarEventLocation',
  'setCalendarAutoSync',
  'setCalendarAutoDelete',
  'setCalendarButtonEnabled',
  'setDropboxAuto',
].forEach(id => document.getElementById(id).addEventListener('change', saveSettingsForm));

/* ===== V6.3 Hardening & Polish ===== */
function normalizeState(x) {
  const base = clone(INITIAL_STATE),
    out = x && x.entries && x.settings ? x : base;
  out.entries = (out.entries || []).map(e => {
    const n = {
        plannedStart: '',
        plannedEnd: '',
        planningOnly: false,
        confirmedAt: null,
        ...e,
        updatedAt: e.updatedAt || '2026-09-10T20:00:00.000Z',
      },
      noRecordedHours = e.manualHours === null || e.manualHours === '' || e.manualHours === undefined,
      legacyPlanned = e.planningOnly === undefined && !e.confirmedAt && e.date >= todayISO() && noRecordedHours;
    if (legacyPlanned) {
      n.plannedStart = n.plannedStart || e.start || '';
      n.plannedEnd = n.plannedEnd || e.end || '';
      n.start = '';
      n.end = '';
      n.planningOnly = true;
    }
    return n;
  });
  out.parkingRecords = (out.parkingRecords || []).map(p => ({
    start: '',
    end: '',
    city: '',
    zone: '',
    vat: 0,
    documentType: p.provider === 'EasyPark' ? 'confirmation' : 'manual',
    source: 'App',
    assignmentMode: p.assignmentMode || (p.source === 'EasyPark/Gmail' ? 'auto' : p.entryId ? 'manual' : 'auto'),
    assignmentReason: p.assignmentReason || '',
    excluded: false,
    ...p,
    updatedAt: p.updatedAt || '2026-09-10T20:00:00.000Z',
  }));
  out.invoices = (out.invoices || []).map(i => ({ ...i }));
  out.deletedEntries = out.deletedEntries || {};
  out.deletedParking = out.deletedParking || {};
  out.settings = { ...base.settings, ...(out.settings || {}) };
  if (!out.settings.dropboxAppKey) out.settings.dropboxAppKey = DROPBOX_APP_KEY;
  splitLegacyQualification(out.settings, 'issuer');
  splitLegacyQualification(out.settings, 'recipient');
  if (!out.settings.calendarEventTitle || out.settings.calendarEventTitle === 'Vertretung')
    out.settings.calendarEventTitle = 'Vertretung Dr. Vakil-Adli';
  if (!out.settings.calendarEventLocation) out.settings.calendarEventLocation = 'Stockerauer Str. 5/6, 2100 Korneuburg';
  out.settings.calendarTargetName = out.settings.calendarTargetName || 'Vertretung Ordination';
  out.settings.calendarGroupName = out.settings.calendarGroupName || 'Familienkalender';
  {
    const sn = String(out.settings.iosShortcutName || '').trim(),
      bad = [
        'Familienkalender: Vertretung Ordination',
        'Vertretung Ordination',
        'Familienkalender → Vertretung Ordination',
      ];
    if (!sn || bad.includes(sn)) out.settings.iosShortcutName = 'Vertretung Familienkalender';
  }
  if (out.settings.calendarAutoSync === undefined) out.settings.calendarAutoSync = true;
  if (out.settings.calendarAutoDelete === undefined) out.settings.calendarAutoDelete = true;
  out.settings._updatedAt = out.settings._updatedAt || '2026-09-10T20:00:00.000Z';
  return out;
}
function v63LocalSnapshot() {
  try {
    const last = Number(localStorage.getItem('vertretungsabrechnung-last-local-snapshot') || 0),
      now = Date.now();
    if (now - last < 300000) return;
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    let arr = JSON.parse(localStorage.getItem('vertretungsabrechnung-local-snapshots-v1') || '[]');
    arr.unshift({ at: new Date().toISOString(), data: JSON.parse(raw) });
    arr = arr.slice(0, 6);
    localStorage.setItem('vertretungsabrechnung-local-snapshots-v1', JSON.stringify(arr));
    localStorage.setItem('vertretungsabrechnung-last-local-snapshot', String(now));
  } catch (e) {
    console.warn('Lokales Backup nicht möglich', e);
  }
}
function saveState(auto = true) {
  v63LocalSnapshot();
  localStorage.setItem(KEY, JSON.stringify(state));
  if (window.globalSyncStatus) {
    if (!navigator.onLine) {
      globalSyncStatus.textContent = 'Offline · Änderungen lokal gespeichert';
      globalSyncStatus.className = 'sub v63-sync-warn';
    } else if (isDropboxConnected()) {
      globalSyncStatus.textContent = 'Änderungen lokal gespeichert · Sync ausstehend';
      globalSyncStatus.className = 'sub v63-sync-warn';
    } else {
      globalSyncStatus.textContent = 'Lokal gespeichert · Dropbox nicht verbunden';
      globalSyncStatus.className = 'sub v63-sync-off';
    }
  }
  if (auto && state.settings.dropboxAutoSync) scheduleDropboxSync();
}
function grossCentsV63(e) {
  const h = entryHours(e);
  if (h === null) return null;
  const rateCents = Math.round(Number(e.rate || state.settings.defaultRate || 0) * 100);
  return Math.round(h * rateCents);
}
function parkingCentsV63(p) {
  return Math.round(Number(p.amount || 0) * 100);
}
function entryHours(e) {
  if (
    e.manualHours !== null &&
    e.manualHours !== '' &&
    e.manualHours !== undefined &&
    !Number.isNaN(Number(e.manualHours))
  )
    return Math.max(0, Number(e.manualHours));
  if (!e.start || !e.end) return null;
  const a = timeMinutes(e.start),
    b = timeMinutes(e.end);
  if (a === null || b === null || a === b) return null;
  let mins = b - a;
  if (mins < 0) mins += 1440;
  const br = Number(e.breakMinutes || 0);
  if (br < 0 || br >= mins) return null;
  return (mins - br) / 60;
}
function gross(e) {
  const c = grossCentsV63(e);
  return c === null ? null : c / 100;
}
function parkAmount(p) {
  return parkingCentsV63(p) / 100;
}
function isParkingCountedV63(p) {
  return !p.excluded && !!p.entryId && state.entries.some(e => e.id === p.entryId);
}

function monthlyData(y) {
  return MONTHS.map((m, i) => {
    const mk = y + '-' + String(i + 1).padStart(2, '0'),
      es = state.entries.filter(e => monthKey(e) === mk),
      ds = es.filter(isEarnedEntry),
      pending = es.filter(e => !isEarnedEntry(e)),
      ps = state.parkingRecords.filter(p => monthKey(p) === mk),
      countedPs = ps.filter(isParkingCountedV63);
    const h = ds.reduce((s, e) => s + (entryHours(e) || 0), 0),
      gc = ds.reduce((s, e) => s + (grossCentsV63(e) || 0), 0),
      pc = countedPs.reduce((s, p) => s + parkingCentsV63(p), 0),
      g = gc / 100,
      r = Math.round((gc * Number(state.settings.reservePct || 0)) / 100) / 100,
      parking = pc / 100,
      parkMins = countedPs.reduce((s, p) => s + parkingMinutes(p), 0);
    return {
      m,
      mk,
      es,
      ds,
      pending,
      ps,
      countedPs,
      h,
      g,
      r,
      a: g - r,
      parking,
      parkMins,
      after: g - r - parking,
      perHour: h ? g / h : 0,
      unassigned: ps.filter(p => !p.excluded && !p.entryId),
      excluded: ps.filter(p => p.excluded),
    };
  });
}
function validateEntryFormV63(isPlan) {
  const manual = fManual.value !== '' ? Number(fManual.value) : null;
  if (!isPlan && manual !== null) {
    if (!Number.isFinite(manual) || manual <= 0)
      return { ok: false, message: 'Die direkt eingetragenen Stunden müssen größer als 0 sein.' };
    return { ok: true, hours: manual, longShift: manual > 18, overnight: false };
  }
  const s = fStart.value,
    e = fEnd.value;
  if (!s && !e)
    return isPlan
      ? { ok: true, hours: null, overnight: false, longShift: false }
      : { ok: false, message: 'Bitte tatsächlichen Beginn und Ende eintragen oder die Stunden direkt angeben.' };
  if (!s || !e) return { ok: false, message: 'Bitte Beginn und Ende vollständig eintragen.' };
  const a = timeMinutes(s),
    b = timeMinutes(e);
  if (a === null || b === null) return { ok: false, message: 'Bitte gültige Uhrzeiten eintragen.' };
  if (a === b)
    return {
      ok: false,
      message:
        'Beginn und Ende sind identisch. Das würde fälschlich wie 24 Stunden wirken – bitte die Zeiten korrigieren.',
    };
  let raw = b - a,
    overnight = false;
  if (raw < 0) {
    raw += 1440;
    overnight = true;
  }
  const br = isPlan ? 0 : Number(fBreak.value || 0);
  if (br < 0) return { ok: false, message: 'Die Pause darf nicht negativ sein.' };
  if (br >= raw)
    return { ok: false, message: 'Die Pause ist gleich lang oder länger als die Arbeitszeit. Bitte korrigieren.' };
  const hours = (raw - br) / 60;
  return { ok: true, hours, overnight, longShift: hours > 18 };
}

function updateCalc() {
  const check = validateEntryFormV63(entryDialogMode === 'plan'),
    h = check.ok ? check.hours : null,
    rate = Number(fRate.value || state.settings.defaultRate || 0),
    isPlan = entryDialogMode === 'plan';
  calcHours.textContent = h === null ? '–' : dec(h, 2) + ' h';
  calcGross.innerHTML = isPlan
    ? '–<small>noch nicht verrechnet</small>'
    : (h === null ? '–' : euro(Math.round(h * Math.round(rate * 100)) / 100)) + '<small>Honorar</small>';
  calcExplain.textContent = !check.ok
    ? check.message
    : isPlan
      ? h !== null
        ? `${fStart.value}–${fEnd.value}${check.overnight ? ' · Ende am Folgetag' : ''} · voraussichtlich`
        : 'Beginn und Ende können auch später ergänzt werden.'
      : fManual.value !== ''
        ? 'Direkte Stundenangabe'
        : h !== null
          ? `${fStart.value}–${fEnd.value}${check.overnight ? ' · Folgetag' : ''} · ${Number(fBreak.value || 0)} Min Pause`
          : 'Bitte tatsächliche Zeiten ergänzen.';
  calcExplain.classList.toggle('v63-validation', !check.ok);
}
function openEntry(id = null, mode = null, preferredDate = null) {
  editingId = id;
  const existing = id ? state.entries.find(x => x.id === id) : null;
  if (existing && monthLockedV63(existing.date.slice(0, 7))) {
    alert('Dieser Monat ist bereits signiert und gesperrt. Lege unter Dokumente zuerst eine Korrektur an.');
    editingId = null;
    return;
  }
  const autoMode =
    mode || (existing ? (isEarnedEntry(existing) ? 'edit' : existing.date <= todayISO() ? 'confirm' : 'plan') : 'plan');
  entryDialogMode = autoMode;
  const e = existing || {
    date: preferredDate || todayISO(),
    start: '',
    end: '',
    plannedStart: '',
    plannedEnd: '',
    breakMinutes: 0,
    manualHours: null,
    rate: state.settings.defaultRate,
    note: '',
    planningOnly: true,
  };
  const isPlan = autoMode === 'plan';
  entryModalTitle.textContent = isPlan
    ? id
      ? 'Geplanten Einsatz bearbeiten'
      : 'Einsatz planen'
    : autoMode === 'confirm'
      ? 'Einsatz bestätigen'
      : 'Einsatz bearbeiten';
  entryModalSub.textContent = isPlan
    ? 'Tag im Kalender wählen und die voraussichtliche Zeit festlegen.'
    : 'Tatsächliche Arbeitszeit und Pause prüfen und bestätigen.';
  fDate.value = e.date || preferredDate || todayISO();
  fStart.value = isPlan ? entryPlannedStart(e) || '' : e.start || entryPlannedStart(e) || '';
  fEnd.value = isPlan ? entryPlannedEnd(e) || '' : e.end || entryPlannedEnd(e) || '';
  fBreak.value = isPlan ? 0 : e.breakMinutes || 0;
  fManual.value = isPlan ? '' : (e.manualHours ?? '');
  fRate.value = e.rate ?? state.settings.defaultRate;
  fNote.value = e.note || '';
  entryTimeLabel.textContent = isPlan ? 'Voraussichtliche Arbeitszeit' : 'Tatsächliche Arbeitszeit';
  entryPlanHint.style.display = isPlan ? 'block' : 'none';
  entryPlannerCalendar.style.display = isPlan ? 'block' : 'none';
  entryWheelHint.style.display = 'block';
  entryBreakRow.style.display = isPlan ? 'none' : 'grid';
  manualHoursField.style.display = isPlan ? 'none' : 'flex';
  manualHoursHelp.style.display = isPlan ? 'none' : 'block';
  entrySummary.classList.toggle('plan', isPlan);
  entrySummaryLabel.textContent = isPlan ? 'Geplant' : 'Verrechenbar';
  entryConfirmBanner.classList.toggle('show', !isPlan && !!existing?.planningOnly);
  entryConfirmBanner.textContent =
    !isPlan && existing?.planningOnly
      ? `Geplant: ${entryPlannedTime(existing)}. Bitte tatsächliche Zeit und Pause bestätigen.`
      : '';
  saveEntry.textContent = isPlan
    ? 'Einsatz planen'
    : autoMode === 'confirm'
      ? 'Einsatz bestätigen'
      : 'Änderungen speichern';
  updateEntryDateUI();
  setEntryPlannerCursor(fDate.value);
  renderEntryPlannerCalendar();
  updateCalc();
  entryDialog.showModal();
}
function statusBadge(e) {
  const locked = monthLockedV63(e.date.slice(0, 7)),
    st = entryStatus(e),
    base =
      st === 'done'
        ? '<span class="done">erledigt</span>'
        : st === 'planned'
          ? '<span class="planned">geplant</span>'
          : st === 'today'
            ? '<span class="badge auto">heute</span>'
            : '<span class="badge warn">Bestätigung offen</span>';
  return locked ? base + ' <span class="badge auto">abgerechnet 🔒</span>' : base;
}
function entryCardHtml(e) {
  const st = entryStatus(e),
    h = entryHours(e),
    g = isEarnedEntry(e) ? gross(e) : null,
    park = entryParkingTotal(e.id),
    planned = entryPlannedTime(e),
    actual = isEarnedEntry(e) ? entryActualTime(e) : '–',
    amount = g === null ? (st === 'planned' ? 'geplant' : st === 'today' ? 'heute' : 'offen') : euro(g),
    locked = monthLockedV63(e.date.slice(0, 7));
  return `<div class="mobile-card"><div class="top"><div><div class="main">${dateAT(e.date)}</div><div class="meta">${planned}${isEarnedEntry(e) ? ` · tatsächlich ${actual}` : ''}</div></div><div class="amount">${amount}</div></div><div class="row"><span>${statusBadge(e)}${isEarnedEntry(e) && h !== null ? ` <span class="badge">${dec(h, 2)} h</span>` : ''}</span><span>${locked ? '<span class="v63-lock-note">gesperrt</span>' : `${(st === 'today' || st === 'open') && e.planningOnly ? `<button class="iconbtn" data-confirm="${e.id}" title="Einsatz bestätigen">✓</button>` : ''}${state.settings.calendarButtonEnabled && entryPlannedStart(e) && entryPlannedEnd(e) ? `<button class="iconbtn" data-cal="${e.id}" title="Zum Familienkalender hinzufügen">📅</button>` : ''}<button class="iconbtn" data-edit="${e.id}" title="Bearbeiten">✎</button><button class="iconbtn" data-del="${e.id}" title="Löschen">🗑</button>`}</span></div>${park ? `<div class="meta" style="margin-top:8px">Parken: ${euro(park)} · ${entryParkingRecords(e.id).length} Vorgang/Vorgänge</div>` : ''}${e.note ? `<div class="meta" style="margin-top:8px">${escapeHtml(e.note)}</div>` : ''}</div>`;
}
function bestParkingAssignment(p) {
  if (p.excluded) return { id: '', reason: 'privat / nicht berücksichtigt', score: -1 };
  const same = state.entries.filter(e => e.date === p.date);
  if (!same.length) return { id: '', reason: 'kein Einsatz an diesem Datum', score: -1 };
  if (same.length === 1) return { id: same[0].id, reason: 'eindeutig: einziger Einsatz an diesem Tag', score: 100 };
  const ps = timeMinutes(p.start),
    pe0 = timeMinutes(p.end);
  if (ps === null || pe0 === null)
    return { id: '', reason: 'mehrere Einsätze am selben Tag – Zeitdaten zur Zuordnung fehlen', score: -1 };
  let pe = pe0;
  if (pe < ps) pe += 1440;
  const scored = same
    .map(e => {
      const es = timeMinutes(isEarnedEntry(e) ? e.start : entryPlannedStart(e)),
        ee0 = timeMinutes(isEarnedEntry(e) ? e.end : entryPlannedEnd(e));
      if (es === null || ee0 === null) return { id: e.id, score: -1, reason: 'Einsatzzeit fehlt' };
      let ee = ee0;
      if (ee < es) ee += 1440;
      const overlap = Math.max(0, Math.min(pe, ee) - Math.max(ps, es));
      return {
        id: e.id,
        score: overlap,
        reason: overlap ? `eindeutige Zeitüberlappung ${overlap} min` : 'keine Zeitüberlappung',
      };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0],
    second = scored[1];
  if (best && best.score >= 15 && (!second || best.score > second.score + 10)) return best;
  return { id: '', reason: 'mehrere mögliche Einsätze – bitte manuell prüfen', score: -1 };
}
function reconcileParkingAssignments(force = false) {
  let changed = 0,
    assigned = 0;
  for (const p of state.parkingRecords) {
    if (p.excluded) {
      if (p.entryId || p.assignmentMode !== 'excluded') {
        p.entryId = '';
        p.assignmentMode = 'excluded';
        p.assignmentReason = 'privat / nicht berücksichtigt';
        p.updatedAt = nowISO();
        changed++;
      }
      continue;
    }
    if (p.assignmentMode === 'manual' && p.entryId && state.entries.some(e => e.id === p.entryId)) {
      assigned++;
      continue;
    }
    const currentExists = p.entryId && state.entries.some(e => e.id === p.entryId),
      auto = force || p.assignmentMode === 'auto' || p.source === 'EasyPark/Gmail' || !p.entryId || !currentExists;
    if (!auto) continue;
    const best = bestParkingAssignment(p),
      next = best.id || '';
    if (p.entryId !== next || p.assignmentReason !== best.reason || p.assignmentMode !== 'auto') {
      p.entryId = next;
      p.assignmentMode = 'auto';
      p.assignmentReason = best.reason;
      p.updatedAt = nowISO();
      changed++;
    }
    if (next) assigned++;
  }
  return { changed, assigned };
}
function parkingCardHtml(p) {
  const receipt = p.dropboxReceiptPath
      ? '<span class="badge ok">Dropbox PDF</span>'
      : p.receiptName
        ? '<span class="badge">lokal</span>'
        : '<span class="badge missing">kein Beleg</span>',
    time = p.start || p.end ? `${p.start || '?'}–${p.end || '?'}` : 'Zeit offen',
    place = [p.city, p.zone].filter(Boolean).join(' · ') || 'Ort offen',
    excluded = !!p.excluded;
  return `<div class="mobile-card" ${!excluded && !p.entryId ? 'data-unassigned="1"' : ''}><div class="top"><div><div class="main">${dateAT(p.date)} · ${escapeHtml(p.provider || '')}</div><div class="meta">${time} · ${escapeHtml(place)}</div></div><div class="amount">${euro(p.amount)}</div></div><div class="row"><span>${excluded ? '<span class="badge v63-private">privat · nicht berücksichtigt</span>' : p.entryId ? `<span class="badge ${p.assignmentMode === 'manual' ? 'manual' : 'auto'}">${p.assignmentMode === 'manual' ? 'manuell' : 'automatisch'} zugeordnet</span>` : '<span class="badge missing">Zuordnung offen</span>'}</span><span><button class="iconbtn" data-pview="${p.id}" title="Beleg öffnen">📎</button><button class="iconbtn" data-pedit="${p.id}" title="Bearbeiten">✎</button><button class="iconbtn" data-pdel="${p.id}" title="Löschen">🗑</button></span></div><div class="meta" style="margin-top:8px">${excluded ? 'Dieser Vorgang verändert die Finanzzahlen nicht.' : p.entryId ? `→ ${escapeHtml(entryLabel(p.entryId))}` : 'Kein sicher passender Einsatz zugeordnet'}${p.assignmentReason ? ` · ${escapeHtml(p.assignmentReason)}` : ''}</div><div class="meta" style="margin-top:5px">${receipt}</div></div>`;
}
function renderParking() {
  const arr = filteredParking(),
    counted = arr.filter(isParkingCountedV63),
    sum = counted.reduce((s, p) => s + parkAmount(p), 0),
    receipts = arr.filter(p => p.receiptName || p.dropboxReceiptPath).length,
    autoAssigned = arr.filter(p => p.entryId && p.assignmentMode === 'auto').length,
    unassigned = arr.filter(p => !p.excluded && !p.entryId).length,
    excluded = arr.filter(p => p.excluded).length;
  parkingTotal.textContent = euro(sum);
  parkingCount.textContent = String(arr.length);
  if (window.parkingReceiptValue) parkingReceiptValue.textContent = `${receipts}/${arr.length}`;
  if (window.parkingUnassignedValue) parkingUnassignedValue.textContent = String(unassigned);
  parkingReceiptBadge.textContent = `Belege: ${receipts}/${arr.length}`;
  easyParkAutoBadge.textContent = `${arr.filter(p => p.source === 'EasyPark/Gmail').length} EasyPark-Vorgänge automatisch importiert`;
  parkingAssignedBadge.textContent = `${autoAssigned} sicher automatisch zugeordnet · ${excluded} nicht berücksichtigt`;
  parkingUnassignedBadge.textContent = unassigned
    ? `${unassigned} Vorgang/Vorgänge brauchen Prüfung – sie werden noch nicht abgezogen`
    : 'Alle beruflichen Vorgänge geklärt';
  parkingRows.innerHTML = '';
  arr.forEach(p => {
    const receipt = p.dropboxReceiptPath
        ? '<span class="badge ok">Dropbox PDF</span>'
        : p.receiptName
          ? '<span class="badge">lokal</span>'
          : '–',
      time = p.start || p.end ? `${p.start || '?'}–${p.end || '?'}` : '–',
      place = [p.city, p.zone].filter(Boolean).join(' · ') || '–',
      dtype =
        p.documentType === 'receipt' ? 'Quittung' : p.documentType === 'confirmation' ? 'Parkbestätigung' : 'Beleg',
      assign = p.excluded
        ? '<span class="badge v63-private">nicht berücksichtigt</span>'
        : p.entryId
          ? `<span class="badge ${p.assignmentMode === 'manual' ? 'manual' : 'auto'}">${p.assignmentMode === 'manual' ? 'manuell' : 'auto'}</span><div class="small">${escapeHtml(entryLabel(p.entryId))}</div><div class="small muted">${escapeHtml(p.assignmentReason || '')}</div>`
          : '<span class="badge missing">nicht zugeordnet</span>',
      tr = document.createElement('tr');
    tr.innerHTML = `<td>${dateAT(p.date)}</td><td>${time}</td><td>${escapeHtml(p.provider || '')}</td><td>${escapeHtml(place)}</td><td class="num">${euro(p.amount)}</td><td>${assign}</td><td>${receipt}<div class="small muted">${dtype}</div></td><td>${escapeHtml(p.note || '')}</td><td class="right nowrap"><button class="iconbtn" data-pview="${p.id}" title="Beleg öffnen">📎</button><button class="iconbtn" data-pedit="${p.id}">✎</button><button class="iconbtn" data-pdel="${p.id}">🗑</button></td>`;
    parkingRows.appendChild(tr);
  });
  const currentMk = todayISO().slice(0, 7),
    groups = new Map();
  arr.forEach(p => {
    const mk = p.date.slice(0, 7);
    if (!groups.has(mk)) groups.set(mk, []);
    groups.get(mk).push(p);
  });
  const keys = [...groups.keys()].sort().reverse();
  parkingCards.innerHTML = keys.length
    ? keys
        .map(mk => {
          const ps = groups.get(mk),
            [yy, mm] = mk.split('-'),
            total = ps.filter(isParkingCountedV63).reduce((a, p) => a + parkAmount(p), 0),
            open = mk === currentMk,
            op = ps.filter(p => !p.excluded && !p.entryId).length,
            ex = ps.filter(p => p.excluded).length;
          return `<details class="v62-month-group" ${open ? 'open' : ''}><summary><div><div class="v62-month-group-title">${MONTHS[Number(mm) - 1]} ${yy}</div><div class="v62-month-group-meta">${ps.length} Vorgänge · ${ps.filter(p => p.receiptName || p.dropboxReceiptPath).length} Belege${op ? ` · ${op} offen` : ''}${ex ? ` · ${ex} privat` : ''}</div></div><div class="v62-month-group-total">${euro(total)}</div></summary><div class="v62-month-group-body">${ps
            .sort((a, b) => (b.date + (b.start || '')).localeCompare(a.date + (a.start || '')))
            .map(parkingCardHtml)
            .join('')}</div></details>`;
        })
        .join('')
    : '<div class="v6-open-empty">Keine Parkvorgänge im ausgewählten Jahr.</div>';
  bindParkingActions();
  if (parkingFocusUnassigned) setTimeout(focusFirstUnassignedParking, 60);
}
function renderDashboard() {
  const y = dashYear.value || String(state.settings.year),
    data = monthlyData(y),
    h = data.reduce((s, x) => s + x.h, 0),
    gc = data.reduce((s, x) => s + Math.round(x.g * 100), 0),
    g = gc / 100,
    r = Math.round((gc * Number(state.settings.reservePct || 0)) / 100) / 100,
    a = g - r,
    pc = data.reduce((s, x) => s + Math.round(x.parking * 100), 0),
    parking = pc / 100,
    done = data.reduce((s, x) => s + x.ds.length, 0),
    planned = data.reduce((s, x) => s + x.pending.length, 0),
    parks = data.flatMap(x => x.ps),
    countedParks = parks.filter(isParkingCountedV63),
    withReceipt = parks.filter(p => p.dropboxReceiptPath || p.receiptName).length,
    workdays = new Set(data.flatMap(x => x.ds.map(e => e.date))).size,
    parkHours = countedParks.reduce((s, p) => s + parkingMinutes(p), 0) / 60,
    unassigned = parks.filter(p => !p.excluded && !p.entryId).length,
    forecast = yearForecast(y, data);
  kpiHours.textContent = dec(h, 1) + ' h';
  kpiGross.textContent = euro(g);
  kpiReserve.textContent = euro(r);
  kpiAvailable.textContent = euro(a);
  kpiParking.textContent = euro(parking);
  kpiAfterParking.textContent = euro(a - parking);
  reserveHint.textContent = dec(state.settings.reservePct, 0) + ' %';
  kpiDoneCount.textContent = String(done);
  kpiPlannedCount.textContent = String(planned);
  kpiAvgHours.textContent = done ? dec(h / done, 2) + ' h' : '–';
  kpiAvgGross.textContent = done ? euro(g / done) : '–';
  kpiAvgParking.textContent = done ? euro(parking / done) : '–';
  kpiReceiptRate.textContent = parks.length ? dec((withReceipt / parks.length) * 100, 0) + ' %' : '–';
  kpiWorkdays.textContent = String(workdays);
  kpiGrossPerHour.textContent = h ? euro(g / h) : '–';
  kpiParkingPerHour.textContent = h ? euro(parking / h) : '–';
  kpiParkingHours.textContent = parkHours ? dec(parkHours, 1) + ' h' : '–';
  kpiUnassignedParking.textContent = String(unassigned);
  kpiForecast.textContent = euro(forecast.total);
  forecastHint.textContent = forecast.futureCount
    ? `${forecast.futureCount} zukünftige Termine${forecast.estimated ? ` · ${forecast.estimated} mit Ø ${dec(forecast.avgH, 1)} h geschätzt` : ''}`
    : 'keine zukünftigen Termine erfasst';
  monthRows.innerHTML = '';
  monthCards.innerHTML = '';
  data.forEach(x => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${x.m}</td><td class="num">${x.h ? dec(x.h, 1) : '–'}</td><td class="num">${x.g ? euro(x.g) : '–'}</td><td class="num">${x.g ? euro(x.r) : '–'}</td><td class="num">${x.g ? euro(x.a) : '–'}</td><td class="num">${x.parking ? euro(x.parking) : '–'}</td><td class="num">${x.countedPs.length || '–'}</td><td class="num">${x.h ? euro(x.perHour) : '–'}</td><td class="num">${x.g || x.parking ? euro(x.after) : '–'}</td><td class="num">${x.ds.length}</td><td class="num">${x.pending.length}</td>`;
    monthRows.appendChild(tr);
    if (x.es.length || x.ps.length) {
      monthCards.insertAdjacentHTML(
        'beforeend',
        `<div class="mobile-card"><div class="top"><div><div class="main">${x.m}</div><div class="meta">${x.ds.length} erledigt · ${x.pending.length} geplant/offen · ${dec(x.h, 1)} h · ${x.countedPs.length} berücksichtigte Parkvorgänge${x.unassigned.length ? ` · ${x.unassigned.length} ungeklärt` : ''}</div></div><div class="amount">${euro(x.g)}</div></div><div class="row"><span class="meta">Parken ${euro(x.parking)} · ${x.h ? euro(x.perHour) + '/h' : '–'}</span><strong>nach Rücklage & Parken ${euro(x.after)}</strong></div></div>`
      );
    }
  });
  renderOverviewV6();
  renderCharts();
  renderV67Dashboard(); // Kalender-Übersicht (früher als V6.7-Erweiterung angehängt)
}
function renderOverviewV6() {
  const now = new Date(),
    y = String(now.getFullYear()),
    m = String(now.getMonth() + 1).padStart(2, '0'),
    md = monthlyData(y)[now.getMonth()] || { h: 0, g: 0, parking: 0, es: [], ds: [], pending: [] },
    read = monthReadinessV63(y, m),
    monthName = MONTHS[now.getMonth()] || 'Aktueller Monat';
  if (window.v6MonthTitle) v6MonthTitle.textContent = `${monthName} ${y}`;
  if (window.v6MonthGross) v6MonthGross.textContent = euro(md.g || 0);
  if (window.v6MonthHours) v6MonthHours.textContent = `${dec(md.h || 0, 1)} h verrechenbar`;
  if (window.v6MonthParking) v6MonthParking.textContent = euro(md.parking || 0);
  if (window.v6MonthCount) {
    v6MonthCount.textContent = read.pending.length
      ? `${read.done.length} erledigt · ${read.pending.length} geplant`
      : String(read.done.length);
    v6MonthCount.classList.toggle('compact', !!read.pending.length);
  }
  if (window.v63MonthStatus) {
    v63MonthStatus.className = 'v63-month-status ' + (read.locked ? 'locked' : read.ready ? 'ready' : 'warn');
    v63MonthStatus.textContent = read.locked
      ? '✓ Monat abgerechnet'
      : read.ready
        ? '✓ Bereit zur Abrechnung'
        : read.reasons.join(' · ');
  }
  if (window.quickPdf)
    quickPdf.textContent = read.ready
      ? 'Honorarnote erstellen'
      : read.locked
        ? 'Honorarnote ansehen'
        : 'Abrechnung prüfen';
  const yearData = monthlyData(y),
    yh = yearData.reduce((s, x) => s + x.h, 0),
    yg = yearData.reduce((s, x) => s + x.g, 0),
    yr = (yg * Number(state.settings.reservePct || 0)) / 100,
    yp = yearData.reduce((s, x) => s + x.parking, 0);
  if (window.v6YearTitle) v6YearTitle.textContent = `${y} bisher`;
  if (window.v6YearGross) v6YearGross.textContent = euro(yg);
  if (window.v6YearHours) v6YearHours.textContent = dec(yh, 1) + ' h';
  if (window.v6YearReserve) v6YearReserve.textContent = euro(yr);
  if (window.v6YearAfter) v6YearAfter.textContent = euro(yg - yr - yp);
  if (window.v6OverviewEntries) {
    const today = todayISO(),
      sorted = [...state.entries].sort((a, b) => a.date.localeCompare(b.date)),
      future = sorted.filter(e => e.date >= today).slice(0, 4),
      past = sorted
        .filter(e => e.date < today)
        .slice(-2)
        .reverse(),
      show = (future.length ? future : past).slice(0, 3);
    v6OverviewEntries.innerHTML = show.length
      ? show
          .map(e => {
            const h = entryHours(e),
              g = isEarnedEntry(e) ? gross(e) : null,
              park = entryParkingTotal(e.id),
              st = entryStatus(e),
              time = isEarnedEntry(e) ? entryActualTime(e) : entryPlannedTime(e),
              amount = g !== null ? euro(g) : st === 'today' ? 'heute' : st === 'planned' ? 'geplant' : 'offen';
            return `<button class="v6-list-row" type="button" data-v6-entry="${e.id}" style="width:100%;border-left:0;border-right:0;border-bottom:0;background:#fff;text-align:left;color:inherit"><div class="v6-row-main"><div class="v6-row-title">${dateAT(e.date)}</div><div class="v6-row-sub">${time}${isEarnedEntry(e) && h !== null ? ` · ${dec(h, 1)} h` : ''}${park ? ` · Parken ${euro(park)}` : ''}</div></div><div class="v6-row-right"><div class="v6-row-amount">${amount}</div><span class="v6-chevron">›</span></div></button>`;
          })
          .join('')
      : '<div class="v6-open-empty">Noch keine Einsätze vorhanden.</div>';
    v6OverviewEntries.querySelectorAll('[data-v6-entry]').forEach(
      b =>
        (b.onclick = () => {
          const e = state.entries.find(x => x.id === b.dataset.v6Entry);
          openEntry(e.id, e.planningOnly && e.date <= todayISO() ? 'confirm' : null);
        })
    );
  }
  if (window.v6OpenItems) {
    const openEntries = state.entries.filter(e => entryStatus(e) === 'open' || entryStatus(e) === 'today'),
      unassigned = state.parkingRecords.filter(p => !p.excluded && !p.entryId),
      items = [];
    if (openEntries.length)
      items.push(
        `<button type="button" class="v6-list-row v6-action-row" data-open-dashboard="entries"><div class="v6-row-main"><div class="v6-row-title">${openEntries.length} Einsatz${openEntries.length === 1 ? '' : 'e'} mit ausständiger Bestätigung</div><div class="v6-row-sub">Antippen und tatsächliche Zeit bestätigen</div></div><div class="v6-row-right"><span class="badge warn">offen</span><span class="v6-chevron">›</span></div></button>`
      );
    if (unassigned.length)
      items.push(
        `<button type="button" class="v6-list-row v6-action-row" data-open-dashboard="parking"><div class="v6-row-main"><div class="v6-row-title">${unassigned.length} Parkvorgang${unassigned.length === 1 ? '' : 'e'} ohne sichere Zuordnung</div><div class="v6-row-sub">Noch nicht von deinen Finanzzahlen abgezogen</div></div><div class="v6-row-right"><span class="badge missing">prüfen</span><span class="v6-chevron">›</span></div></button>`
      );
    v6OpenItems.innerHTML = items.length ? items.join('') : '<div class="v6-open-empty">Aktuell nichts offen.</div>';
    v6OpenItems
      .querySelectorAll('[data-open-dashboard="entries"]')
      .forEach(b => (b.onclick = () => switchTab('entries')));
    v6OpenItems.querySelectorAll('[data-open-dashboard="parking"]').forEach(
      b =>
        (b.onclick = () => {
          parkingFocusUnassigned = true;
          switchTab('parking');
          setTimeout(focusFirstUnassignedParking, 120);
        })
    );
    if (window.v6OpenSection) v6OpenSection.style.display = items.length ? 'block' : 'none';
  }
  renderNextShiftV61();
  renderV67Dashboard(); // Kalender-Übersicht (früher als V6.7-Erweiterung angehängt)
}
function renderNextShiftV61() {
  if (!window.v61NextShift) return;
  const today = todayISO(),
    overdue = [...state.entries]
      .filter(e => e.planningOnly && e.date < today)
      .sort((a, b) => a.date.localeCompare(b.date)),
    future = [...state.entries]
      .filter(e => e.date >= today && !isEarnedEntry(e))
      .sort(
        (a, b) => a.date.localeCompare(b.date) || (entryPlannedStart(a) || '').localeCompare(entryPlannedStart(b) || '')
      ),
    e = overdue[0] || future[0];
  v61NextShift.classList.remove('state-today', 'state-overdue', 'state-upcoming');
  v61NextActions.innerHTML = '';
  if (!e) {
    v61NextShift.classList.add('is-empty');
    v61NextKicker.textContent = 'NÄCHSTER EINSATZ';
    v61NextTitle.textContent = 'Kein Einsatz geplant';
    v61NextMeta.textContent = 'Neue Termine planst du unter „Einsätze“.';
    return;
  }
  v61NextShift.classList.remove('is-empty');
  const diff = daysBetweenISO(today, e.date),
    planned = entryPlannedTime(e);
  if (e.date < today) {
    v61NextShift.classList.add('state-overdue');
    v61NextKicker.textContent = 'BESTÄTIGUNG OFFEN';
    v61NextTitle.textContent = prettyDate(e.date, false);
    v61NextMeta.textContent = `${planned} · Einsatz noch nicht bestätigt`;
  } else if (diff === 0) {
    v61NextShift.classList.add('state-today');
    v61NextKicker.textContent = 'HEUTIGER EINSATZ';
    v61NextTitle.textContent = planned;
    v61NextMeta.textContent = prettyDate(e.date, true);
  } else {
    v61NextShift.classList.add('state-upcoming');
    v61NextKicker.textContent = diff === 1 ? 'MORGEN' : diff <= 7 ? `IN ${diff} TAGEN` : 'NÄCHSTER EINSATZ';
    v61NextTitle.textContent = prettyDate(e.date, false);
    v61NextMeta.textContent = `${planned}${e.note ? ` · ${e.note}` : ''}`;
  }
}

function invoiceIsStaleV63(rec) {
  if (!rec?.createdAt || rec.signedAt) return false;
  if (!rec.snapshotHash) return true;
  return rec.snapshotHash !== invoiceSnapshotHashV63();
}
function invoiceNumberOwnerV63(number, key) {
  return (state.invoices || []).find(r => r.number === number && r.key !== key);
}

function invoicePeriodChanged() {
  const rec = invoiceRecord(invYear.value, invMonth.value);
  invNumber.value = rec?.number || defaultInvoiceNumber(invYear.value, invMonth.value);
  renderInvoice();
}
function renderInvoiceReadinessV63() {
  if (!window.v63InvoiceReadiness) return;
  const read = monthReadinessV63(invYear.value, invMonth.value),
    rec = invoiceRecord(),
    stale = invoiceIsStaleV63(rec);
  v63InvoiceReadiness.className = 'v63-readiness ' + (read.locked ? 'locked' : read.ready ? 'ready' : 'warn');
  if (read.locked)
    v63InvoiceReadiness.textContent = `✓ ${MONTHS[Number(invMonth.value) - 1]} ${invYear.value} ist signiert und gegen versehentliche Änderungen gesperrt.`;
  else if (stale)
    v63InvoiceReadiness.textContent =
      '⚠ Abrechnungsdaten wurden seit der PDF-Erstellung geändert. Bitte die Honorarnote neu erstellen.';
  else if (read.ready)
    v63InvoiceReadiness.textContent =
      '✓ Alle erfassten Einsätze sind bestätigt und alle beruflichen Parkvorgänge geklärt.';
  else
    v63InvoiceReadiness.textContent = `Noch nicht vollständig: ${read.reasons.join(' · ')}. Vorzeitige Erstellung ist nur nach ausdrücklicher Bestätigung möglich.`;
}
function renderInvoiceHistoryV63() {
  if (!window.v63InvoiceHistory) return;
  const period = invoiceKey(),
    history = (state.invoices || [])
      .filter(r => r.archivedRecord && r.originalPeriodKey === period)
      .sort((a, b) =>
        String(b.finalizedAt || b.updatedAt || '').localeCompare(String(a.finalizedAt || a.updatedAt || ''))
      );
  if (!history.length) {
    v63InvoiceHistory.className = 'v63-invoice-history';
    v63InvoiceHistory.innerHTML = '';
    return;
  }
  v63InvoiceHistory.className = 'v63-invoice-history show';
  v63InvoiceHistory.innerHTML = `<div class="v63-history-title">Frühere endgültige Versionen</div>${history.map(r => `<div class="v63-history-row"><span><strong>${escapeHtml(r.number || '–')}</strong> · ${r.signedAt ? 'signiert' : 'erstellt'}${r.signedDropboxPath ? ' · Dropbox' : ''}</span><span>${r.finalizedAt ? new Date(r.finalizedAt).toLocaleDateString('de-AT') : ''}</span></div>`).join('')}`;
}
function renderInvoiceWorkflow() {
  const rec = invoiceRecord(),
    es = currentInvoiceEntries(),
    hrs = es.reduce((a, e) => a + (entryHours(e) || 0), 0),
    total = es.reduce((a, e) => a + (gross(e) || 0), 0),
    read = monthReadinessV63(invYear.value, invMonth.value);
  invoiceTotalValue.textContent = modelMoney(total);
  invoiceTotalMeta.textContent = `${modelHours(hrs)} Stunden · ${es.length} Einsatz${es.length === 1 ? '' : 'e'}`;
  invoiceNumberDisplay.textContent = invNumber.value || defaultInvoiceNumber(invYear.value, invMonth.value);
  renderInvoiceReadinessV63();
  renderInvoiceHistoryV63();
  if (!rec?.createdAt) {
    invoiceFlowCard.classList.remove('active');
    invoiceDocBadge.textContent = read.ready ? 'Bereit' : 'Entwurf';
    invoiceDocBadge.className = 'doc-status-pill ' + (read.ready ? 'ok' : 'blue');
    makePdf.textContent = read.ready ? 'Honorarnote erstellen' : 'Honorarnote vorzeitig erstellen';
    invoiceUnlockCorrection.style.display = 'none';
    return;
  }
  const stale = invoiceIsStaleV63(rec);
  invoiceFlowCard.classList.add('active');
  invoiceFlowTitle.textContent = `Honorarnote ${rec.number || invoiceNumberDisplay.textContent} · ${MONTHS[Number(invMonth.value) - 1]} ${invYear.value}`;
  setStep(invoiceStepCreated, invoiceStepCreatedStatus, !stale, stale, stale ? 'veraltet' : 'erstellt');
  invoiceStepCreatedSub.textContent = stale
    ? 'Einsätze oder Abrechnungsdaten haben sich geändert – PDF neu erstellen'
    : `${rec.filename || invoiceFilename(false)} · ${rec.createdAt ? new Date(rec.createdAt).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}`;
  const signed = !!rec.signedAt,
    archived = !!rec.signedDropboxPath,
    mail = !!rec.mailOpenedAt;
  setStep(invoiceStepSigned, invoiceStepSignedStatus, signed, !signed && !stale, 'signiert');
  invoiceStepSignedSub.textContent = signed
    ? 'Signierte PDF übernommen'
    : stale
      ? 'Erst aktualisierte PDF erstellen'
      : 'ID Austria persönlich freigeben und signierte PDF zurück übernehmen';
  setStep(
    invoiceStepDropbox,
    invoiceStepDropboxStatus,
    archived,
    signed && !archived,
    archived ? 'gespeichert' : 'offen'
  );
  invoiceStepDropboxSub.textContent = archived
    ? rec.signedDropboxPath
    : signed
      ? isDropboxConnected()
        ? 'Upload erneut versuchen'
        : 'Dropbox nicht verbunden'
      : 'Nach Übernahme der signierten PDF automatisch';
  setStep(invoiceStepMail, invoiceStepMailStatus, mail, archived && !mail, mail ? 'vorbereitet' : 'offen');
  invoiceStepMailSub.textContent = mail
    ? 'Versand-/Teilen-Dialog wurde geöffnet'
    : archived
      ? `Bereit für ${state.settings.recipientEmail || 'Empfänger'}`
      : signed
        ? 'Zuerst sicher in Dropbox archivieren'
        : 'Nach Signatur verfügbar';
  invoiceStartSign.disabled = stale || signed;
  invoiceSignedLabel.style.opacity = rec.signatureStartedAt && !stale && !signed ? '1' : '.72';
  invoiceArchiveSigned.disabled = !signed || archived;
  invoiceArchiveSigned.style.display = signed && !archived ? 'inline-flex' : 'none';
  invoiceSendMail.disabled = !signed || !archived;
  invoiceUnlockCorrection.style.display = signed ? 'inline-flex' : 'none';
  makePdf.textContent = stale
    ? 'Honorarnote aktualisieren'
    : signed
      ? 'Honorarnote abgeschlossen'
      : 'PDF neu erstellen';
  makePdf.disabled = !!signed;
  invoiceDocBadge.textContent = stale
    ? 'Daten geändert'
    : signed
      ? archived
        ? 'Signiert · Dropbox'
        : 'Signiert'
      : 'PDF erstellt';
  invoiceDocBadge.className = 'doc-status-pill ' + (stale ? 'warn' : signed ? 'ok' : 'blue');
}
function renderInvoice() {
  renderInvoiceBase();
  const s = state.settings,
    missing = [];
  if (!s.issuerName || !s.issuerQualification || !s.issuerAddress) missing.push('Absender inkl. Bezeichnung');
  if (!s.recipientName || !s.recipientAddress) missing.push('Empfänger');
  if (!s.iban) missing.push('IBAN');
  invoiceWarning.style.display = missing.length ? 'block' : 'none';
  invoiceWarning.textContent = missing.length ? `Noch ergänzen: ${missing.join(', ')}.` : '';
  renderInvoiceWorkflow();
}

function unlockInvoiceCorrectionV63() {
  const rec = invoiceRecord();
  if (!rec?.signedAt) return;
  if (
    !confirm(
      `Die signierte Honorarnote ${rec.number} bleibt unverändert archiviert. Für diesen Monat wird eine neue Korrektur-Honorarnote mit neuer Nummer angelegt. Fortfahren?`
    )
  )
    return;
  const periodKey = rec.key,
    archiveKey = `${periodKey}#${rec.number}#${Date.now()}`,
    ix = state.invoices.findIndex(r => r.key === periodKey),
    archived = {
      ...rec,
      key: archiveKey,
      archivedRecord: true,
      originalPeriodKey: periodKey,
      finalizedAt: rec.finalizedAt || rec.signedAt || nowISO(),
      updatedAt: nowISO(),
    };
  if (ix >= 0) state.invoices[ix] = archived;
  const next = defaultInvoiceNumber(rec.year, rec.month);
  state.invoices.push({
    key: periodKey,
    year: rec.year,
    month: rec.month,
    number: next,
    invoiceDate: todayISO(),
    correctionOf: rec.number,
    correctionUnlockedAt: nowISO(),
    updatedAt: nowISO(),
  });
  invNumber.value = next;
  invDate.value = todayISO();
  saveState();
  renderInvoice();
  refreshAll(false);
  alert(`Korrekturmodus aktiviert. Die ursprüngliche Honorarnote ${rec.number} bleibt erhalten. Neue Nummer: ${next}.`);
}
function setDropboxStatus(text, type = 'off') {
  if (window.dropboxStatus) dropboxStatus.textContent = text;
  if (window.dropboxDot)
    dropboxDot.className = 'dot' + (type === 'on' ? ' on' : type === 'busy' || type === 'warn' ? ' busy' : '');
  if (window.globalSyncStatus) {
    globalSyncStatus.textContent = (type === 'on' ? 'Dropbox · ' : type === 'busy' ? 'Dropbox · ' : '') + text;
    globalSyncStatus.className =
      'sub ' + (type === 'on' ? 'v63-sync-ok' : type === 'busy' || type === 'warn' ? 'v63-sync-warn' : 'v63-sync-off');
  }
}

async function syncWithDropbox(opts) {
  /* V6.12: Logik im Sync-Kern (#v612-sync-core) */ return window.ordipilotSync ? window.ordipilotSync(opts) : false;
}
function v63OnlineStatus() {
  if (!navigator.onLine) {
    if (window.globalSyncStatus) {
      globalSyncStatus.textContent = 'Offline · Änderungen lokal gespeichert';
      globalSyncStatus.className = 'sub v63-sync-warn';
    }
  } else if (!isDropboxConnected()) {
    setDropboxStatus('Lokal gespeichert · Dropbox nicht verbunden', 'off');
  }
}
function init() {
  setupSelectors();
  dashYear.value = String(state.settings.year || 2026);
  entryYear.value = String(state.settings.year || 2026);
  parkingYear.value = String(state.settings.year || 2026);
  invYear.value = String(state.settings.year || 2026);
  invDate.value = todayISO();
  invMonth.value = String(new Date().getMonth() + 1).padStart(2, '0');
  const rec = invoiceRecord(invYear.value, invMonth.value);
  invNumber.value = rec?.number || defaultInvoiceNumber(invYear.value, invMonth.value);
  loadSettingsForm();
  refreshAll(false);
  if (window.invoiceUnlockCorrection) invoiceUnlockCorrection.onclick = unlockInvoiceCorrectionV63;
  window.addEventListener('online', v63OnlineStatus);
  window.addEventListener('offline', v63OnlineStatus);
  v63OnlineStatus();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http'))
    navigator.serviceWorker.register('service-worker.js').catch(console.warn);
  handleDropboxCallback().then(() => {
    /* V6.13: Start-Sync übernimmt der Sync-Kern (gedrosselt) */ void 0;
  });
}

function setupSettingsAccordions() {
  document.querySelectorAll('.settings-grid>.card').forEach(card => {
    if (card.dataset.accordionReady) return;
    const h = card.querySelector(':scope>h3');
    if (!h) return;
    card.dataset.accordionReady = '1';
    const body = document.createElement('div');
    body.className = 'settings-accordion-body';
    while (h.nextSibling) body.appendChild(h.nextSibling);
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'settings-accordion-head';
    head.innerHTML = `<span>${escapeHtml(h.textContent)}</span><span class="chev">›</span>`;
    h.replaceWith(head);
    body.hidden = true;
    card.appendChild(body);
    head.onclick = () => {
      const open = !card.classList.contains('settings-open');
      card.classList.toggle('settings-open', open);
      body.hidden = !open;
    };
  });
}
setupSettingsAccordions();
if (window.entryCloseTop) entryCloseTop.onclick = () => entryDialog.close();
if (window.parkingCloseTop) parkingCloseTop.onclick = () => parkingDialog.close();
if (window.timePresetBar)
  timePresetBar
    .querySelectorAll('[data-time-preset]')
    .forEach(b => (b.onclick = () => applyTimePreset(b.dataset.timePreset)));
[fStart, fEnd].forEach(el =>
  el.addEventListener('change', () => {
    updateTimePresetActive();
    updateCalc();
  })
);
if (window.parkingCalPrev)
  parkingCalPrev.onclick = () => {
    parkingPlannerCursor = new Date(parkingPlannerCursor.getFullYear(), parkingPlannerCursor.getMonth() - 1, 1);
    renderParkingCalendar();
  };
if (window.parkingCalNext)
  parkingCalNext.onclick = () => {
    parkingPlannerCursor = new Date(parkingPlannerCursor.getFullYear(), parkingPlannerCursor.getMonth() + 1, 1);
    renderParkingCalendar();
  };
if (window.parkingCalToday)
  parkingCalToday.onclick = () => {
    pDate.value = todayISO();
    setParkingPlannerCursor(pDate.value);
    fillParkingEntryOptions(pEntryId.value, pDate.value);
    renderParkingCalendar();
  };
if (window.detectParkingLocation) detectParkingLocation.onclick = detectParkingPosition;
[dashYear, entryYear, entryMonth, parkingYear, parkingMonth, parkingProviderFilter].forEach(x =>
  x.addEventListener('change', () => {
    renderDashboard();
    renderEntries();
    renderParking();
  })
);
entrySearch.addEventListener('input', renderEntries);

quickPdf.onclick = () => {
  switchTab('invoice');
  setTimeout(renderInvoice, 0);
};

addParking.onclick = () => openParking();
if (window.v6ShowEntries) v6ShowEntries.onclick = () => switchTab('entries');
entryCalPrev.onclick = () => {
  entryPlannerCursor = new Date(entryPlannerCursor.getFullYear(), entryPlannerCursor.getMonth() - 1, 1);
  renderEntryPlannerCalendar();
};
entryCalNext.onclick = () => {
  entryPlannerCursor = new Date(entryPlannerCursor.getFullYear(), entryPlannerCursor.getMonth() + 1, 1);
  renderEntryPlannerCalendar();
};
entryCalToday.onclick = () => {
  fDate.value = todayISO();
  setEntryPlannerCursor(fDate.value);
  updateEntryDateUI();
  renderEntryPlannerCalendar();
};

function refreshAll(rebuildSelectors = true) {
  if (rebuildSelectors) setupSelectors();
  renderDashboard();
  renderEntries();
  renderParking();
  renderInvoice();
}
OrdiPilotBoot.add('app:init', init);

/* ===== V6.7 Dashboard + Calendar ===== */
let v67SelectedDate = todayISO(),
  v67CalendarCursor = new Date(),
  v67CalendarView = 'month';
function v67DateFromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}
function v67ISO(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function v67DayShort(iso) {
  return new Intl.DateTimeFormat('de-AT', { weekday: 'short' }).format(v67DateFromISO(iso)).replace('.', '');
}
function v67StatusLabel(e) {
  const s = entryStatus(e);
  return s === 'done' ? 'erledigt' : s === 'today' ? 'heute' : s === 'open' ? 'bestätigen' : 'geplant';
}
function v67StatusClass(e) {
  const s = entryStatus(e);
  return s === 'done' ? 'done' : s === 'open' || s === 'today' ? 'open' : 'planned';
}
function renderV67Week() {
  const root = document.getElementById('v67WeekStrip');
  if (!root) return;
  const base = v67DateFromISO(todayISO());
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const iso = v67ISO(d),
      es = entriesOnDate(iso),
      today = i === 0,
      hasDone = es.some(e => entryStatus(e) === 'done'),
      hasOpen = es.some(e => ['open', 'today'].includes(entryStatus(e))),
      cls = [
        'v67-week-day',
        today ? 'today' : '',
        es.length ? 'has-entry' : '',
        hasDone ? 'has-done' : '',
        hasOpen ? 'has-open' : '',
      ]
        .filter(Boolean)
        .join(' ');
    html += `<button type="button" class="${cls}" data-v67-week="${iso}"><span>${i === 0 ? 'Heute' : v67DayShort(iso)}</span><strong>${d.getDate()}</strong>${es.length ? '<i class="v67-week-dot"></i>' : ''}</button>`;
  }
  root.innerHTML = html;
  root.querySelectorAll('[data-v67-week]').forEach(b => (b.onclick = () => openV67Calendar(b.dataset.v67Week)));
}
function renderV67Close() {
  const status = document.getElementById('v67CloseStatus'),
    steps = document.getElementById('v67CloseSteps');
  if (!status || !steps) return;
  const now = new Date(),
    y = String(now.getFullYear()),
    m = String(now.getMonth() + 1).padStart(2, '0'),
    r = monthReadinessV63(y, m),
    rec = invoiceRecord(y, m);
  status.className = 'v67-close-status ' + (r.locked ? 'locked' : r.ready ? 'ready' : '');
  status.textContent = r.locked ? 'abgeschlossen' : r.ready ? 'bereit' : 'noch offen';
  const s1 = r.pending.length === 0 && r.done.length > 0,
    s2 = r.unassigned.length === 0,
    s3 = !!(rec && rec.createdAt);
  steps.innerHTML = `<div class="v67-close-step ${s1 ? 'ok' : 'warn'}"><span class="dot">${s1 ? '✓' : '!'}</span><strong>Einsätze</strong><small>${s1 ? `${r.done.length} bestätigt` : r.pending.length ? `${r.pending.length} offen` : 'noch keine'}</small></div><div class="v67-close-step ${s2 ? 'ok' : 'warn'}"><span class="dot">${s2 ? '✓' : '!'}</span><strong>Parken</strong><small>${s2 ? 'geklärt' : `${r.unassigned.length} offen`}</small></div><div class="v67-close-step ${rec?.signedAt ? 'ok' : s3 ? 'blue' : ''}"><span class="dot">${rec?.signedAt ? '✓' : s3 ? '•' : '3'}</span><strong>Honorarnote</strong><small>${rec?.signedAt ? 'signiert' : s3 ? 'erstellt' : 'ausständig'}</small></div>`;
}
function renderV67Dashboard() {
  renderV67Week();
  renderV67Close();
}
function v67SetCursor(iso) {
  const d = v67DateFromISO(iso);
  v67CalendarCursor = new Date(d.getFullYear(), d.getMonth(), 1);
}
function openV67Calendar(iso) {
  v67SelectedDate = iso || todayISO();
  v67SetCursor(v67SelectedDate);
  v67CalendarView = 'month';
  document
    .querySelectorAll('[data-v67-view]')
    .forEach(b => b.classList.toggle('active', b.dataset.v67View === 'month'));
  document.getElementById('v67MonthView')?.classList.remove('hidden');
  document.getElementById('v67ListView')?.classList.remove('active');
  renderV67Calendar();
  const dlg = document.getElementById('v67CalendarDialog');
  if (dlg && !dlg.open) dlg.showModal();
}
function renderV67Calendar() {
  renderV67Month();
  renderV67Day();
  renderV67Agenda();
}
function renderV67Month() {
  const grid = document.getElementById('v67MonthGrid'),
    title = document.getElementById('v67MonthTitle');
  if (!grid || !title) return;
  const y = v67CalendarCursor.getFullYear(),
    m = v67CalendarCursor.getMonth();
  title.textContent = `${MONTHS[m]} ${y}`;
  const first = new Date(y, m, 1, 12),
    start = new Date(y, m, 1 - ((first.getDay() + 6) % 7), 12);
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = v67ISO(d),
      es = entriesOnDate(iso),
      dots = es
        .slice(0, 3)
        .map(e => `<i class="${v67StatusClass(e)}"></i>`)
        .join(''),
      cls = [
        'v67-cal-day',
        d.getMonth() === m ? '' : 'out',
        iso === todayISO() ? 'today' : '',
        iso === v67SelectedDate ? 'selected' : '',
      ]
        .filter(Boolean)
        .join(' ');
    html += `<button type="button" class="${cls}" data-v67-date="${iso}"><span class="v67-day-num">${d.getDate()}</span><span class="v67-dots">${dots}</span></button>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('[data-v67-date]').forEach(
    b =>
      (b.onclick = () => {
        v67SelectedDate = b.dataset.v67Date;
        const d = v67DateFromISO(v67SelectedDate);
        if (d.getMonth() !== v67CalendarCursor.getMonth() || d.getFullYear() !== v67CalendarCursor.getFullYear())
          v67SetCursor(v67SelectedDate);
        renderV67Month();
        renderV67Day();
      })
  );
}
function renderV67Day() {
  const root = document.getElementById('v67DayDetail');
  if (!root) return;
  const es = entriesOnDate(v67SelectedDate).sort((a, b) =>
      (entryPlannedStart(a) || '').localeCompare(entryPlannedStart(b) || '')
    ),
    head = `<div class="v67-day-head"><strong>${escapeHtml(prettyDate(v67SelectedDate, true))}</strong><small>${es.length ? `${es.length} Einsatz${es.length === 1 ? '' : 'e'}` : 'Noch nichts geplant'}</small></div>`;
  if (!es.length) {
    root.innerHTML =
      head +
      `<div class="v67-empty-day">Für diesen Tag ist kein Einsatz eingetragen.<button type="button" class="btn soft v67-empty-add" data-v67-add="${v67SelectedDate}">+ Einsatz an diesem Tag planen</button></div>`;
    root.querySelector('[data-v67-add]').onclick = () => {
      document.getElementById('v67CalendarDialog').close();
      openEntry(null, 'plan', v67SelectedDate);
    };
    return;
  }
  root.innerHTML =
    head +
    es
      .map(e => {
        const s = v67StatusClass(e),
          time = isEarnedEntry(e) ? entryActualTime(e) : entryPlannedTime(e),
          h = entryHours(e),
          park = entryParkingTotal(e.id),
          meta = [
            isEarnedEntry(e) && h !== null ? `${dec(h, 1)} h` : '',
            park ? `Parken ${euro(park)}` : '',
            e.note || '',
          ]
            .filter(Boolean)
            .join(' · ');
        return `<div class="v67-day-entry"><div class="v67-entry-top"><div><div class="v67-entry-time">${escapeHtml(time)}</div><div class="v67-entry-meta">${escapeHtml(meta || 'Vertretung Dr. Vakil-Adli')}</div></div><span class="v67-entry-status ${s}">${v67StatusLabel(e)}</span></div><div class="v67-entry-actions"><button type="button" class="primary" data-v67-edit="${e.id}">${e.planningOnly && e.date <= todayISO() ? 'Bestätigen' : 'Bearbeiten'}</button><button type="button" data-v67-cal="${e.id}">Apple Kalender</button><button type="button" class="route" data-v67-route="1">Route starten</button></div></div>`;
      })
      .join('');
  root.querySelectorAll('[data-v67-edit]').forEach(
    b =>
      (b.onclick = () => {
        const e = state.entries.find(x => x.id === b.dataset.v67Edit);
        document.getElementById('v67CalendarDialog').close();
        openEntry(e.id, e.planningOnly && e.date <= todayISO() ? 'confirm' : null);
      })
  );
  root.querySelectorAll('[data-v67-cal]').forEach(b => (b.onclick = () => addEntryToIOSCalendar(b.dataset.v67Cal)));
  root.querySelectorAll('[data-v67-route]').forEach(b => (b.onclick = v67OpenRoute));
}
function v67OpenRoute() {
  const q = (state.settings.calendarEventLocation || '').trim();
  if (!q) {
    alert('Unter Mehr → Apple Kalender ist noch keine Ordinationsadresse hinterlegt.');
    return;
  }
  window.location.href = `https://maps.apple.com/?daddr=${encodeURIComponent(q)}&dirflg=d`;
}
function renderV67Agenda() {
  const root = document.getElementById('v67ListView');
  if (!root) return;
  const arr = [...state.entries].sort(
      (a, b) => a.date.localeCompare(b.date) || (entryPlannedStart(a) || '').localeCompare(entryPlannedStart(b) || '')
    ),
    today = todayISO(),
    future = arr.filter(e => e.date >= today).slice(0, 30),
    past = arr.filter(e => e.date < today).slice(-8),
    show = future.length ? future : past.reverse();
  if (!show.length) {
    root.innerHTML = '<div class="v67-empty-day">Noch keine Einsätze vorhanden.</div>';
    return;
  }
  const groups = {};
  show.forEach(e => (groups[e.date] ??= []).push(e));
  root.innerHTML = Object.entries(groups)
    .map(
      ([date, es]) =>
        `<div class="v67-agenda-group"><div class="v67-agenda-date">${escapeHtml(prettyDate(date, true))}</div>${es.map(e => `<div class="v67-agenda-row"><div><div class="v67-agenda-time">${escapeHtml(isEarnedEntry(e) ? entryActualTime(e) : entryPlannedTime(e))}</div><small>${v67StatusLabel(e)}${e.note ? ` · ${escapeHtml(e.note)}` : ''}</small></div><button type="button" class="v67-agenda-open" data-v67-agenda="${e.id}">Öffnen</button></div>`).join('')}</div>`
    )
    .join('');
  root.querySelectorAll('[data-v67-agenda]').forEach(
    b =>
      (b.onclick = () => {
        const e = state.entries.find(x => x.id === b.dataset.v67Agenda);
        v67SelectedDate = e.date;
        v67SetCursor(e.date);
        v67CalendarView = 'month';
        document
          .querySelectorAll('[data-v67-view]')
          .forEach(x => x.classList.toggle('active', x.dataset.v67View === 'month'));
        document.getElementById('v67MonthView').classList.remove('hidden');
        root.classList.remove('active');
        renderV67Month();
        renderV67Day();
      })
  );
}
function setupV67() {
  const next = document.getElementById('v61NextShift');
  if (next) {
    next.onclick = () => {
      const today = todayISO(),
        overdue = [...state.entries]
          .filter(e => e.planningOnly && e.date < today)
          .sort((a, b) => a.date.localeCompare(b.date)),
        future = [...state.entries]
          .filter(e => e.date >= today && !isEarnedEntry(e))
          .sort(
            (a, b) =>
              a.date.localeCompare(b.date) || (entryPlannedStart(a) || '').localeCompare(entryPlannedStart(b) || '')
          ),
        e = overdue[0] || future[0];
      openV67Calendar(e?.date || today);
    };
    next.onkeydown = ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        next.click();
      }
    };
  }
  document
    .getElementById('v67CalClose')
    ?.addEventListener('click', () => document.getElementById('v67CalendarDialog').close());
  document.getElementById('v67PrevMonth')?.addEventListener('click', () => {
    v67CalendarCursor = new Date(v67CalendarCursor.getFullYear(), v67CalendarCursor.getMonth() - 1, 1);
    renderV67Month();
  });
  document.getElementById('v67NextMonth')?.addEventListener('click', () => {
    v67CalendarCursor = new Date(v67CalendarCursor.getFullYear(), v67CalendarCursor.getMonth() + 1, 1);
    renderV67Month();
  });
  document.getElementById('v67Today')?.addEventListener('click', () => {
    v67SelectedDate = todayISO();
    v67SetCursor(v67SelectedDate);
    renderV67Month();
    renderV67Day();
  });
  document.querySelectorAll('[data-v67-view]').forEach(
    b =>
      (b.onclick = () => {
        v67CalendarView = b.dataset.v67View;
        document.querySelectorAll('[data-v67-view]').forEach(x => x.classList.toggle('active', x === b));
        document.getElementById('v67MonthView').classList.toggle('hidden', v67CalendarView !== 'month');
        document.getElementById('v67ListView').classList.toggle('active', v67CalendarView === 'list');
        if (v67CalendarView === 'list') renderV67Agenda();
      })
  );
  document.getElementById('v67CloseCard')?.addEventListener('click', () => switchTab('invoice'));
  renderV67Dashboard();
}
OrdiPilotBoot.add('app:dashboard', setupV67);
