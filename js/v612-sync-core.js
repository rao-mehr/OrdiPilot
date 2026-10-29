/* ===== OrdiPilot V6.12 · Sync-Kern =====
   Eine einzige Sync-Funktion. Regeln:
   1. Kein Upload, wenn Dropbox nicht sauber gelesen werden konnte.
   2. Upload nur gegen die gelesene Revision (Dropbox lehnt ab, wenn ein anderes Gerät zwischenzeitlich geschrieben hat).
   3. Fehlt die Datendatei, wird sie nur nach ausdrücklicher Bestätigung neu angelegt – nie mit leerem Stand.
   4. Leere Einstellungsfelder überschreiben nie gefüllte.
   5. Kein Datensatz aus der Cloud geht verloren (außer durch eine bewusste Löschung).
   6. Vor dem Schreiben wird der Cloud-Stand einmal täglich als backup_JJJJ-MM-TT.json gesichert.
   Der Teil bis "Verdrahtung" ist rein funktional und wird von tests/ in Node geprüft. */
(function (root) {
  'use strict';
  const isBlank = v =>
    v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
  const stamp = v => {
    const t = new Date(v || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  };

  // Feldweises Zusammenführen: der neuere Stand gewinnt, aber nie mit einem leeren Wert gegen einen gefüllten.
  function mergeFields(newer, older) {
    const out = { ...(older || {}), ...(newer || {}) };
    for (const k of Object.keys(older || {})) {
      if (isBlank(out[k]) && !isBlank(older[k])) out[k] = older[k];
    }
    return out;
  }
  function mergeRecipients(newerArr, olderArr) {
    const newer = Array.isArray(newerArr) ? newerArr : [],
      older = Array.isArray(olderArr) ? olderArr : [];
    const byId = new Map(older.filter(r => r && r.id).map(r => [r.id, r]));
    const out = newer.filter(Boolean).map(r => mergeFields(r, byId.get(r.id)));
    const seen = new Set(out.map(r => r.id));
    for (const r of older) if (r && r.id && !seen.has(r.id)) out.push(r);
    return out;
  }
  function mergeSettings(local, remote) {
    const l = local || {},
      r = remote || {},
      localNewer = stamp(l._updatedAt) >= stamp(r._updatedAt);
    const newer = localNewer ? l : r,
      older = localNewer ? r : l;
    const out = mergeFields(newer, older);
    out.recipients = mergeRecipients(newer.recipients, older.recipients);
    if (!out.recipients.length) delete out.recipients;
    out._updatedAt = newer._updatedAt || older._updatedAt;
    return out;
  }

  const counts = s => ({
    entries: (s?.entries || []).length,
    parking: (s?.parkingRecords || []).length,
    invoices: (s?.invoices || []).length,
  });
  const isEmptyState = s => {
    const c = counts(s);
    return c.entries + c.parking + c.invoices === 0;
  };

  // Prüft, ob jeder Cloud-Datensatz im Ergebnis noch vorhanden ist – außer er wurde bewusst gelöscht (Grabstein).
  function assertNothingLost(remote, merged) {
    if (!remote) return;
    const check = (list, mergedList, deleted, key, label) => {
      const have = new Set((mergedList || []).map(x => x && x[key]).filter(Boolean)),
        del = deleted || {};
      // Honorarnoten: alter Schlüssel "2026-09" gilt als vorhanden, wenn er auf "2026-09::<Empfänger>" migriert wurde.
      const present = k =>
        have.has(k) ||
        (key === 'key' && !String(k).includes('::') && [...have].some(h => String(h).startsWith(k + '::')));
      const missing = (list || []).filter(x => x && x[key] && !present(x[key]) && !del[x[key]]);
      if (missing.length) throw new Error(`SYNC_GUARD_${label}:${missing.length}`);
    };
    check(remote.entries, merged.entries, merged.deletedEntries, 'id', 'ENTRIES');
    check(remote.parkingRecords, merged.parkingRecords, merged.deletedParking, 'id', 'PARKING');
    check(remote.invoices, merged.invoices, {}, 'key', 'INVOICES');
    check(remote.payments, merged.payments, merged.deletedPayments, 'id', 'PAYMENTS');
    check(remote.trips, merged.trips, merged.deletedTrips, 'id', 'TRIPS');
    check(remote.expenses, merged.expenses, merged.deletedExpenses, 'id', 'EXPENSES');
    if (!isEmptyState(remote) && isEmptyState(merged)) throw new Error('SYNC_GUARD_EMPTY_MERGE');
  }

  const isConflict = err => /conflict/i.test(String((err && err.message) || err));

  /* deps: {
       isConnected():bool, getState():state, setState(state), path():string,
       readCloud(path) -> {data,rev} | null (nur bei "nicht gefunden"; jeder andere Fehler wirft),
       writeCloud(path,data,{rev}|{create:true}) -> wirft bei Konflikt (Fehlertext enthält "conflict"),
       merge(local,remote)->state, afterMerge(state) (Migrationen, EasyPark-Import), clone(x),
       backup(remoteData) (darf fehlschlagen), confirmCreate(path)->bool, status(text,kind), persist(), refresh()
     } */
  function createSync(deps) {
    let inflight = null,
      lastStatus = null;
    const baseStatus = deps.status;
    deps = {
      ...deps,
      status: (t, k) => {
        lastStatus = [t, k];
        baseStatus(t, k);
      },
    };
    async function attempt(opts) {
      const before = deps.clone(deps.getState()),
        path = deps.path();
      let remote;
      try {
        remote = await deps.readCloud(path);
      } catch (err) {
        deps.status('Synchronisierung abgebrochen – Dropbox nicht lesbar, nichts hochgeladen', 'warn');
        return { ok: false, reason: 'read', error: err };
      }
      if (remote && (typeof remote.data !== 'object' || !remote.data || !Array.isArray(remote.data.entries))) {
        deps.status('Synchronisierung abgebrochen – Cloud-Datei ungültig, nichts überschrieben', 'warn');
        return { ok: false, reason: 'invalid' };
      }
      if (!remote) {
        if (isEmptyState(before)) {
          deps.status('Keine Datendatei in Dropbox und keine Daten auf diesem Gerät – nichts zu tun', 'warn');
          return { ok: false, reason: 'nothing' };
        }
        if (!(await deps.confirmCreate(path, opts))) {
          deps.status('Synchronisierung abgebrochen – Datendatei nicht gefunden', 'warn');
          return { ok: false, reason: 'not_found' };
        }
      } else {
        try {
          await deps.backup(remote.data);
        } catch (e) {
          /* Sicherung ist best effort, der Sync bleibt geschützt */
        }
      }
      // Mit dem AKTUELLEN Stand zusammenführen: Änderungen, die während des Lesens gemacht wurden, bleiben erhalten.
      const pre = deps.clone(deps.getState());
      try {
        let merged = remote ? deps.merge(deps.clone(pre), deps.clone(remote.data)) : deps.clone(pre);
        deps.setState(merged);
        await deps.afterMerge(deps.getState(), remote && remote.data);
        assertNothingLost(remote && remote.data, deps.getState());
        await deps.writeCloud(path, deps.getState(), remote ? { rev: remote.rev } : { create: true });
      } catch (err) {
        if (isConflict(err)) {
          deps.setState(pre);
          return { ok: false, reason: 'conflict', error: err };
        }
        deps.setState(pre);
        deps.status('Synchronisierung gestoppt – Daten geschützt, nichts überschrieben', 'warn');
        return { ok: false, reason: 'guard', error: err };
      }
      deps.persist();
      return { ok: true };
    }
    async function run(opts = {}) {
      if (!deps.isConnected()) {
        deps.status('Nicht verbunden');
        return false;
      }
      deps.status('Synchronisiere…', 'busy');
      let res = await attempt(opts);
      if (!res.ok && res.reason === 'conflict') res = await attempt(opts); // anderes Gerät hat zwischenzeitlich geschrieben: neu lesen, neu zusammenführen
      if (!res.ok && res.reason === 'conflict') {
        deps.status(
          'Synchronisierung abgebrochen – gleichzeitige Änderung auf anderem Gerät, bitte erneut versuchen',
          'warn'
        );
      }
      try {
        deps.refresh(res);
      } catch (e) {
        console.warn(e);
      }
      if (res.ok)
        deps.status(
          `Synchronisiert · ${new Date().toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}`,
          'on'
        );
      else if (lastStatus) deps.status(lastStatus[0], lastStatus[1]); // Aktualisierung der Oberfläche überschreibt sonst die Fehlermeldung
      if (!res.ok && res.error) console.error('OrdiPilot-Sync:', res.reason, res.error);
      return res.ok;
    }
    let again = false;
    return function sync(opts) {
      // Läuft bereits ein Sync, wird danach genau einmal nachsynchronisiert – so geht keine spätere Änderung unter.
      if (inflight) {
        again = true;
        return inflight;
      }
      inflight = run(opts)
        .then(async ok => {
          while (again) {
            again = false;
            ok = await run(opts);
          }
          return ok;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    };
  }

  // Ausgefallene Rechnungsdaten aus dem jüngsten Backup ergänzen, in dem sie gefüllt sind (nur leere Felder).
  const CRITICAL_KEYS = [
    'issuerName',
    'issuerQualification',
    'issuerAddress',
    'issuerEmail',
    'issuerPhone',
    'iban',
    'bic',
    'taxNumber',
    'recipientName',
    'recipientQualification',
    'recipientAddress',
    'recipientEmail',
    'serviceDescription',
    'salutation',
    'signoffName',
    'taxNote',
    'paymentText',
  ];
  const settingsLookWiped = s => !!s && isBlank(s.issuerName) && isBlank(s.iban);
  const titleOnly = v => /^\s*((dr|med|univ|prof|doz|mag|prim)\.?\s*)+$/i.test(String(v || ''));
  const activeRec = s =>
    Array.isArray(s?.recipients) && s.recipients.length
      ? s.recipients.find(x => x.id === s.activeRecipientId) || s.recipients[0]
      : null;
  // Reparatur nötig, wenn Rechnungsdaten fehlen oder der Empfänger nur noch aus einem Titel besteht bzw. keine Adresse hat.
  function settingsNeedRepair(s) {
    if (!s) return false;
    if (settingsLookWiped(s)) return true;
    const r = activeRec(s);
    return !!r && (isBlank(r.name) || titleOnly(r.name) || isBlank(r.address));
  }
  const backupUsable = b =>
    !!b &&
    !settingsLookWiped(b) &&
    !isBlank(b.recipientName || activeRec(b)?.name) &&
    !titleOnly(b.recipientName || activeRec(b)?.name);
  // Doppelte Honorarnoten (gleicher Schlüssel nach Migration) zusammenfassen – der jüngste Stand gewinnt.
  function dedupeInvoices(list) {
    const ts = r => stamp(r.updatedAt || r.mailOpenedAt || r.signedAt || r.createdAt),
      map = new Map(),
      out = [];
    for (const r of list || []) {
      if (!r || !r.key) {
        out.push(r);
        continue;
      }
      const cur = map.get(r.key);
      if (!cur || ts(r) >= ts(cur)) map.set(r.key, { ...(cur || {}), ...r });
    }
    return [...out, ...map.values()];
  }
  function repairSettingsFrom(settings, backup) {
    const s = settings,
      b = backup || {},
      filled = [];
    for (const k of CRITICAL_KEYS)
      if (isBlank(s[k]) && !isBlank(b[k])) {
        s[k] = b[k];
        filled.push(k);
      }
    // Legacy-Empfängerfelder auf den aktiven Empfänger übertragen, sofern dort leer bzw. nur ein Titel steht.
    if (Array.isArray(s.recipients) && s.recipients.length) {
      const r = activeRec(s),
        src = activeRec(b) || {};
      const map = {
        name: 'recipientName',
        qualification: 'recipientQualification',
        address: 'recipientAddress',
        email: 'recipientEmail',
        serviceDescription: 'serviceDescription',
        salutation: 'salutation',
        signoffName: 'signoffName',
      };
      for (const [rk, bk] of Object.entries(map)) {
        const cur = String(r[rk] || '').trim(),
          val = !isBlank(src[rk]) && !(rk === 'name' && titleOnly(src[rk])) ? src[rk] : b[bk];
        if (
          (isBlank(cur) || (rk === 'name' && titleOnly(cur))) &&
          !isBlank(val) &&
          !(rk === 'name' && titleOnly(val))
        ) {
          r[rk] = val;
          filled.push('recipient.' + rk);
        }
      }
    }
    return filled;
  }

  root.OrdiPilotSyncCore = {
    isBlank,
    mergeFields,
    mergeRecipients,
    mergeSettings,
    assertNothingLost,
    isEmptyState,
    createSync,
    settingsLookWiped,
    settingsNeedRepair,
    backupUsable,
    dedupeInvoices,
    repairSettingsFrom,
    CRITICAL_KEYS,
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* ===== Verdrahtung mit der App ===== */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof state === 'undefined') return;
  const C = window.OrdiPilotSyncCore;
  const SYSTEM = '/Ordination & Selbständigkeit/Vertretungsdienste/System';
  const DATA = SYSTEM + '/daten.json';
  const LAST_OK = 'ordipilot-last-sync-ok';

  async function dbxMeta(path) {
    const token = await ensureAccessToken();
    const r = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (r.status === 409) {
      const t = await r.text();
      if (/not_found/.test(t)) return null;
      throw new Error(t);
    }
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function readCloud(path) {
    const meta = await dbxMeta(path);
    if (!meta) return null;
    const blob = await dbxDownload('rev:' + meta.rev); // exakt die geprüfte Revision lesen
    if (!blob) throw new Error('Revision ' + meta.rev + ' nicht lesbar');
    const data = JSON.parse(await blob.text());
    return { data, rev: meta.rev };
  }
  async function writeCloud(path, data, how) {
    const token = await ensureAccessToken();
    if (how.create) await ensureDropboxFolders(path);
    const mode = how.create ? 'add' : { '.tag': 'update', update: how.rev };
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': dbxArg({ path, mode, autorename: false, mute: true, strict_conflict: true }),
      },
      body: new Blob([JSON.stringify(cleanStateForCloud(data), null, 2)], { type: 'application/json' }),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function backup(remoteData) {
    const day = todayISO(),
      key = 'vertretungsabrechnung-last-cloud-backup';
    let last = '';
    try {
      last = localStorage.getItem(key) || '';
    } catch (e) {}
    if (last === day) return;
    const token = await ensureAccessToken();
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': dbxArg({ path: `${SYSTEM}/backup_${day}.json`, mode: 'add', autorename: false, mute: true }),
      },
      body: new Blob([JSON.stringify(remoteData, null, 2)], { type: 'application/json' }),
    });
    if (r.ok || r.status === 409) {
      try {
        localStorage.setItem(key, day);
      } catch (e) {}
    } // 409 = Sicherung von heute existiert bereits
  }
  async function listSystemBackups() {
    const res = await dbxRpc('files/list_folder', { path: SYSTEM, recursive: false });
    return (res.entries || [])
      .filter(e => e['.tag'] === 'file' && /^backup.*\.json$/i.test(e.name))
      .sort((a, b) => String(b.server_modified).localeCompare(String(a.server_modified)));
  }
  let repairNote = '';
  async function repairWipedSettings(s) {
    if (!C.settingsNeedRepair(s)) return;
    try {
      for (const f of await listSystemBackups()) {
        const blob = await dbxDownload(f.path_lower || f.path_display);
        if (!blob) continue;
        let b;
        try {
          b = JSON.parse(await blob.text());
        } catch (e) {
          continue;
        }
        if (!C.backupUsable(b?.settings)) continue;
        const filled = C.repairSettingsFrom(s, b.settings);
        if (filled.length) {
          s._updatedAt = new Date().toISOString();
          s._v612RepairedFrom = f.name;
          repairNote = `Rechnungsdaten aus ${f.name} wiederhergestellt`;
        }
        return;
      }
    } catch (e) {
      console.warn('Wiederherstellung der Rechnungsdaten nicht möglich', e);
    }
  }
  function hooks() {
    return Array.isArray(window.ordipilotSyncHooks) ? window.ordipilotSyncHooks : [];
  }

  const sync = C.createSync({
    isConnected: () => isDropboxConnected(),
    getState: () => state,
    setState: s => {
      state = s;
    },
    path: () => {
      const p = state.settings && state.settings.dropboxSyncPath;
      return p && p.startsWith('/Ordination & Selbständigkeit/') ? p : DATA;
    },
    readCloud,
    writeCloud,
    backup,
    clone: x => JSON.parse(JSON.stringify(x)),
    merge: (local, remote) => {
      const settings = C.mergeSettings(local.settings, remote.settings);
      const out = mergeStates(local, remote);
      out.settings = settings;
      // V6.14: Zahlungseingänge und Fahrten (mit Lösch-Grabsteinen) wie Einsätze zusammenführen
      for (const [k, d] of [
        ['payments', 'deletedPayments'],
        ['trips', 'deletedTrips'],
        ['expenses', 'deletedExpenses'],
      ]) {
        const m = mergeCollections(local[k] || [], remote[k] || [], local[d] || {}, remote[d] || {});
        out[k] = m.items;
        out[d] = m.deleted;
      }
      return normalizeState(out);
    },
    afterMerge: async () => {
      for (const h of hooks()) {
        try {
          h();
        } catch (e) {
          console.warn('Sync-Hook', e);
        }
      }
      await repairWipedSettings(state.settings);
      for (const h of hooks()) {
        try {
          h();
        } catch (e) {}
      } // Empfänger nach Reparatur erneut normalisieren
      state.invoices = C.dedupeInvoices(state.invoices);
      await importEasyParkFromDropbox(false);
      for (const h of Array.isArray(window.ordipilotSyncHooksAsync) ? window.ordipilotSyncHooksAsync : []) {
        try {
          await h();
        } catch (e) {
          console.warn('Sync-Hook', e);
        }
      }
      reconcileParkingAssignments();
    },
    confirmCreate: async (p, opts) =>
      !!(opts && opts.interactive) &&
      confirm(
        `Die Datendatei wurde in Dropbox nicht gefunden:\n${p}\n\nNur bestätigen, wenn du sie bewusst mit den Daten dieses Geräts neu anlegen willst. Im Zweifel abbrechen.`
      ),
    status: (t, k) => {
      const extra =
        k === 'on'
          ? [repairNote, window.ordipilotAutoNote ? window.ordipilotAutoNote() : ''].filter(Boolean).join(' · ')
          : '';
      setDropboxStatus(extra ? `${t} · ${extra}` : t, k);
    },
    persist: () => {
      saveState(false);
      try {
        localStorage.setItem(LAST_OK, new Date().toISOString());
      } catch (e) {}
      updateSyncReminder();
    },
    refresh: () => {
      try {
        loadSettingsForm();
      } catch (e) {}
      try {
        if (typeof renderRecipientManager === 'function') renderRecipientManager();
      } catch (e) {}
      try {
        refreshAll(false);
      } catch (e) {}
    },
  });
  window.ordipilotSync = sync;
  window.syncWithDropbox = sync;
  if (window.syncDropbox) syncDropbox.onclick = () => sync({ interactive: true });

  // V6.13: Automatisches Synchronisieren ist Standard (seit V6.12 abgesichert).
  // Einmalig für bestehende Installationen einschalten; wer es danach bewusst abschaltet, bleibt dabei.
  OrdiPilotBoot.add('v612-sync-core:1', () => {
    if (!state.settings._v613AutoSyncDefault) {
      state.settings._v613AutoSyncDefault = true;
      state.settings.dropboxAutoSync = true;
      state.settings._updatedAt = new Date().toISOString();
      saveState(false);
      try {
        if (window.setDropboxAuto) setDropboxAuto.checked = true;
      } catch (e) {}
    }
  });
  let lastAutoSync = 0;
  function autoSyncSoon(reason) {
    if (!state.settings.dropboxAutoSync || !isDropboxConnected()) return;
    if (Date.now() - lastAutoSync < 60000) return; // höchstens einmal pro Minute
    lastAutoSync = Date.now();
    sync().catch(e => console.warn('Auto-Sync (' + reason + ')', e));
  }
  window.ordipilotAutoSyncSoon = autoSyncSoon;
  // Beim Start, beim Zurückkehren in die App und wenn wieder Netz da ist.
  OrdiPilotBoot.add('v612-sync-core:2', () => {
    setTimeout(() => {
      if (!new URLSearchParams(location.search).get('code')) autoSyncSoon('start');
    }, 1200);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') autoSyncSoon('vordergrund');
    });
    window.addEventListener('online', () => autoSyncSoon('online'));
  });

  // Hinweis, wenn länger nicht synchronisiert wurde – damit nichts nur auf dem iPhone liegt.
  function updateSyncReminder() {
    let el = document.getElementById('v612SyncReminder');
    let last = null;
    try {
      last = localStorage.getItem(LAST_OK);
    } catch (e) {}
    const days = last ? (Date.now() - new Date(last).getTime()) / 864e5 : Infinity;
    const show = isDropboxConnected() && days > 3;
    if (!show) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('button');
      el.id = 'v612SyncReminder';
      el.type = 'button';
      el.style.cssText =
        'position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 8px);z-index:9999;border:0;border-radius:999px;padding:9px 16px;background:#ff9f0a;color:#1c1c1e;font:600 14px -apple-system,system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.18)';
      el.onclick = () => sync({ interactive: true });
      document.body.appendChild(el);
    }
    el.textContent = last
      ? `Seit ${Math.floor(days)} Tagen nicht gesichert · Jetzt synchronisieren`
      : 'Noch nie mit Dropbox gesichert · Jetzt synchronisieren';
  }
  window.ordipilotUpdateSyncReminder = updateSyncReminder;
  OrdiPilotBoot.add('v612-sync-core:3', () => {
    setTimeout(updateSyncReminder, 1500);
  });
})();
