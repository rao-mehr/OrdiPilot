/* ===== OrdiPilot V7.1 · KI-Ausgaben in der Steuer-Übersicht · Erinnerungen per Mail =====
   1. Die KI-Ausgaben-Automatik (Google Apps Script) legt nach jedem Lauf die gebuchten Belege
      (OpenAI/ChatGPT, Anthropic/Claude) als System/Import/ki-ausgaben.json in Dropbox ab.
      OrdiPilot übernimmt sie beim Sync als Betriebsausgaben mit einstellbarem betrieblichem Anteil.
      Betrag = Brutto (Ärztinnen und Ärzte mit unecht steuerbefreiten Umsätzen haben keinen Vorsteuerabzug).
   2. Einstellungen für die Mail-Erinnerungen, die das Apps Script täglich prüft (Monatsende,
      unbezahlte Honorarnoten). Die App selbst kann bei geschlossenem iPhone nicht erinnern.
   Der Teil bis "Verdrahtung" ist rein funktional und wird von tests/ in Node geprüft. */
(function (root) {
  'use strict';
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const CATEGORY = 'KI-Software (OpenAI/Claude)';
  const DEFAULT_SHARE = 50;
  const clampShare = v => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : DEFAULT_SHARE;
  };

  /* Übernimmt exportierte Belege in die Ausgabenliste.
     exportData: { records: [{ id, date:'YYYY-MM-DD', provider, number, description, gross }] }
     opts: { share, expenses, deleted, now }
     - neue Belege werden angehängt, bestehende (gleiche id) aktualisiert
     - ein von Hand geänderter Anteil (shareManual) bleibt erhalten
     - bewusst entfernte Belege (deleted[id]) kommen nicht wieder */
  function mergeKiExpenses(exportData, opts) {
    const share = clampShare(opts.share ?? DEFAULT_SHARE);
    const deleted = opts.deleted || {};
    const now = opts.now || new Date().toISOString();
    const list = (opts.expenses || []).map(x => ({ ...x }));
    const byId = new Map(list.map(x => [x.id, x]));
    let added = 0,
      updated = 0;
    for (const r of (exportData && exportData.records) || []) {
      if (!r || !r.id || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || ''))) continue;
      const gross = r2(r.gross);
      if (!(gross > 0)) continue;
      const id = 'ki-' + String(r.id).replace(/[^A-Za-z0-9_-]/g, '');
      if (deleted[id]) continue;
      const note = [r.provider, r.number].filter(Boolean).join(' · ');
      const cur = byId.get(id);
      if (!cur) {
        const x = { id, date: r.date, category: CATEGORY, note, amount: gross, share, source: 'ki', updatedAt: now };
        list.push(x);
        byId.set(id, x);
        added++;
        continue;
      }
      const want = { date: r.date, amount: gross, note, share: cur.shareManual ? cur.share : share };
      if (Object.keys(want).some(k => cur[k] !== want[k])) {
        Object.assign(cur, want, { updatedAt: now });
        updated++;
      }
    }
    return { expenses: list, added, updated };
  }

  /* Neuer Standardanteil für alle automatisch übernommenen Belege (ohne Handänderung). */
  function applyShare(expenses, share, now) {
    const s = clampShare(share);
    let n = 0;
    const out = (expenses || []).map(x => {
      if (x.source !== 'ki' || x.shareManual || x.share === s) return x;
      n++;
      return { ...x, share: s, updatedAt: now || new Date().toISOString() };
    });
    return { expenses: out, changed: n };
  }

  root.OrdiPilotKiCore = { mergeKiExpenses, applyShare, clampShare, CATEGORY, DEFAULT_SHARE };
})(typeof window !== 'undefined' ? window : globalThis);

/* ===== Verdrahtung ===== */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof state === 'undefined') return;
  const K = window.OrdiPilotKiCore;
  const KI_PATH = '/Ordination & Selbständigkeit/Vertretungsdienste/System/Import/ki-ausgaben.json';
  const esc = v => escapeHtml(v);
  let note = '';
  const touch = () => {
    state.settings._updatedAt = new Date().toISOString();
  };
  const kiOn = () => state.settings.kiImport !== false;
  const kiShare = () => K.clampShare(state.settings.kiShare ?? K.DEFAULT_SHARE);

  // ---- 1. Import beim Sync ----
  async function importKi() {
    note = '';
    if (!kiOn() || !isDropboxConnected()) return;
    const blob = await dbxDownload(KI_PATH);
    if (!blob) return;
    let data;
    try {
      data = JSON.parse(await blob.text());
    } catch (e) {
      console.warn('KI-Ausgaben: Datei nicht lesbar', e);
      return;
    }
    const r = K.mergeKiExpenses(data, {
      share: kiShare(),
      expenses: state.expenses || [],
      deleted: state.deletedExpenses || {},
    });
    if (!r.added && !r.updated) return;
    state.expenses = r.expenses;
    if (r.added && !state.settings.expensesEnabled) {
      state.settings.expensesEnabled = true;
      touch();
    }
    if (r.added) note = `${r.added} KI-Beleg${r.added === 1 ? '' : 'e'} als Betriebsausgabe übernommen`;
  }
  (window.ordipilotSyncHooksAsync = window.ordipilotSyncHooksAsync || []).push(async () => {
    try {
      await importKi();
    } catch (e) {
      console.warn('KI-Ausgaben', e);
    }
  });
  if (typeof window.ordipilotAutoNote === 'function')
    OrdiPilotExt.extend('ordipilotAutoNote', base => () => [base(), note].filter(Boolean).join(' · '));

  // ---- Einstellungen in der Steuer-Ansicht (Bereich „Weitere Betriebsausgaben“) ----
  window.ordipilotExpenseExtra = function (rep) {
    const n = (rep.expenses || []).filter(x => x.source === 'ki').length;
    return `<div class="v710-ki">
      <label class="v710-check"><input type="checkbox" id="v710KiOn" ${kiOn() ? 'checked' : ''}> KI-Abos (OpenAI, Claude) automatisch übernehmen${n ? ` · ${n} Beleg${n === 1 ? '' : 'e'}` : ''}</label>
      ${kiOn() ? `<label class="v710-row">Betrieblicher Anteil<span><input type="number" id="v710KiShare" min="0" max="100" step="5" value="${kiShare()}"> %</span></label>` : ''}
      <div class="help">Kommt aus der KI-Ausgaben-Automatik (Belege liegen in Dropbox unter Finanzen &amp; Steuern). Betrag brutto, da kein Vorsteuerabzug. Den Anteil mit dem Steuerberater klären – die Tools werden meist auch privat bzw. für die Anstellung genutzt.</div>
    </div>`;
  };
  document.addEventListener('change', ev => {
    const t = ev.target;
    if (t.id === 'v710KiOn') {
      state.settings.kiImport = !!t.checked;
      touch();
      saveState();
      try {
        ordipilotTax.render();
      } catch (_) {}
      if (t.checked && window.ordipilotSync) ordipilotSync().catch(() => {});
    }
    if (t.id === 'v710KiShare') {
      state.settings.kiShare = K.clampShare(t.value);
      touch();
      const r = K.applyShare(state.expenses || [], state.settings.kiShare);
      state.expenses = r.expenses;
      saveState();
      try {
        ordipilotTax.render();
      } catch (_) {}
    }
    if (t.id === 'v710RemindOn') {
      state.settings.reminderMail = !!t.checked;
      touch();
      saveState();
      renderRemind();
    }
    if (t.id === 'v710RemindDays') {
      const d = Math.round(Number(t.value));
      state.settings.reminderPaymentDays = d >= 7 && d <= 90 ? d : 21;
      touch();
      saveState();
      renderRemind();
    }
  });

  // ---- 2. Erinnerungen per Mail (Einstellungen; verschickt werden sie vom Apps Script) ----
  function renderRemind() {
    const anchor = document.getElementById('v618Gmail');
    if (!anchor) return;
    let el = document.getElementById('v710Remind');
    if (!el) {
      el = document.createElement('details');
      el.id = 'v710Remind';
      el.className = 'v618-gmail';
      anchor.insertAdjacentElement('afterend', el);
    }
    const on = state.settings.reminderMail !== false,
      days = state.settings.reminderPaymentDays || 21,
      wasOpen = el.open;
    el.innerHTML = `<summary>Erinnerungen per Mail <span class="${on ? 'ok' : ''}">${on ? 'an' : 'aus'}</span></summary>
      <div class="v618-body">
        <label class="v710-check"><input type="checkbox" id="v710RemindOn" ${on ? 'checked' : ''}> Erinnerungen an mein Gmail schicken</label>
        ${on ? `<label class="v710-row">Unbezahlt-Erinnerung nach<span><input type="number" id="v710RemindDays" min="7" max="90" step="1" value="${esc(days)}"> Tagen</span></label>` : ''}
        <div class="help">Täglich um 18 Uhr prüft dein Google-Skript die Daten in Dropbox: Am Monatsletzten (und nochmals am 3.) kommt eine Mail, wenn die Honorarnote des Monats noch nicht erstellt ist. Ist eine versendete Honorarnote nach ${esc(days)} Tagen nicht als bezahlt erfasst, kommt eine Erinnerung – höchstens einmal pro Woche, dreimal insgesamt.</div>
      </div>`;
    if (wasOpen) el.open = true;
  }
  OrdiPilotExt.extend(
    'renderInvoice',
    base =>
      function () {
        const out = base.apply(this, arguments);
        try {
          renderRemind();
        } catch (e) {
          console.warn('V7.1 Erinnerungen', e);
        }
        return out;
      }
  );

  function css() {
    if (document.getElementById('v710-style')) return;
    const st = document.createElement('style');
    st.id = 'v710-style';
    st.textContent = `.v710-ki{margin:4px 0 10px;padding:12px 14px;border-radius:14px;background:#f4f6ff;border:1px solid #e1e6ff}
.v710-check{display:flex;gap:10px;align-items:flex-start;font-size:14px;font-weight:600}.v710-check input{width:18px;height:18px;min-height:auto;margin-top:2px;flex:0 0 auto}
.v618-body .v710-check,#v710Remind .v710-check{display:flex!important;flex-direction:row;align-items:flex-start;gap:10px;font-size:14px;font-weight:600;color:inherit}
#v710Remind .v710-check input{width:18px!important;height:18px;min-height:auto;margin:2px 0 0;flex:0 0 auto}
#v710Remind .v710-row{display:flex!important;flex-direction:row;justify-content:space-between;align-items:center}
#v710Remind .v710-row span{display:flex;align-items:center;gap:6px}
#v710Remind .v710-row input{width:80px!important;min-height:36px;text-align:right}
.v710-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;font-size:14px;font-weight:600}.v710-row span{display:flex;align-items:center;gap:6px}.v710-row input{width:80px;min-height:36px;text-align:right}`;
    document.head.appendChild(st);
  }
  OrdiPilotBoot.add('v710:1', () => {
    css();
    renderRemind();
  });
})();
