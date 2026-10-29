// OrdiPilot V6.10 – bereinigte Dropbox-Struktur + One-File-ID-Austria-Workflow
(function () {
  const V69 = {
    system: '/Ordination & Selbständigkeit/Vertretungsdienste/System',
    data: '/Ordination & Selbständigkeit/Vertretungsdienste/System/daten.json',
    easyPark: '/Ordination & Selbständigkeit/Vertretungsdienste/System/Import/easypark.json',
    invoices: '/Ordination & Selbständigkeit/Vertretungsdienste/Honorarnoten',
    parking: '/Ordination & Selbständigkeit/Vertretungsdienste/Parkbelege',
    signUrl: 'https://www.a-trust.at/pdfsign',
  };
  const pad2 = v => String(v).padStart(2, '0');
  const finalName = (y, m) =>
    window.ordipilotInvoiceFilename
      ? window.ordipilotInvoiceFilename(y, m)
      : `${y}-${pad2(m)}_Honorarnote_Vakil-Adli.pdf`;
  const finalPath = (y, m) => `${V69.invoices}/${y}/${finalName(y, m)}`;

  function migrateV69State() {
    state.settings = state.settings || {};
    state.settings.dropboxSyncPath = V69.data;
    state.settings.easyParkImportPath = V69.easyPark;
    state.settings.invoiceDropboxBase = V69.invoices;
    state.settings._updatedAt = state.settings._updatedAt || nowISO();
    state.invoices = (state.invoices || []).map(r => {
      if (!r || !r.year || !r.month) return r;
      const name = finalName(r.year, r.month),
        path = finalPath(r.year, r.month);
      const out = { ...r, filename: name };
      if (r.createdAt) out.dropboxPath = path;
      if (r.signedAt) {
        out.signedFilename = name;
        out.signedDropboxPath = path;
      }
      return out;
    });
    saveState(false);
    if (window.setDropboxPath) {
      setDropboxPath.value = V69.data;
      setDropboxPath.readOnly = true;
    }
    if (window.setEasyParkImportPath) {
      setEasyParkImportPath.value = V69.easyPark;
      setEasyParkImportPath.readOnly = true;
    }
    if (window.setInvoiceDropboxBase) {
      setInvoiceDropboxBase.value = V69.invoices;
      setInvoiceDropboxBase.readOnly = true;
    }
  }
  OrdiPilotBoot.add('v69:1', () => {
    migrateV69State();
  });

  // V6.12: Pfadmigration läuft als Hook im Sync-Kern (kein eigener, ungeprüfter Upload mehr).
  OrdiPilotBoot.add('v69:2', () => {
    (window.ordipilotSyncHooks = window.ordipilotSyncHooks || []).push(migrateV69State);
  });

  window.importEasyParkFromDropbox = async function (showResult = false) {
    if (!isDropboxConnected()) {
      if (showResult) alert('Bitte zuerst Dropbox verbinden.');
      return { added: 0, updated: 0, total: 0 };
    }
    const path = V69.easyPark;
    try {
      easyParkStatus.textContent = 'EasyPark-Import wird gelesen…';
      easyParkDot.className = 'dot busy';
      const blob = await dbxDownload(path);
      if (!blob) {
        easyParkStatus.textContent = 'Noch keine EasyPark-Importdatei in Dropbox';
        easyParkDot.className = 'dot';
        return { added: 0, updated: 0, total: 0 };
      }
      const result = mergeEasyParkImport(JSON.parse(await blob.text()));
      easyParkStatus.textContent = `${result.total} Datensätze verfügbar · ${result.added} neu · ${result.updated} aktualisiert`;
      easyParkDot.className = 'dot on';
      if (showResult)
        alert(`EasyPark: ${result.added} neue und ${result.updated} aktualisierte Parkvorgänge übernommen.`);
      return result;
    } catch (e) {
      console.error(e);
      easyParkStatus.textContent = 'EasyPark-Import konnte nicht gelesen werden';
      easyParkDot.className = 'dot busy';
      if (showResult) alert('EasyPark-Import fehlgeschlagen.');
      return { added: 0, updated: 0, total: 0 };
    }
  };
  window.uploadReceiptToDropbox = async function (p, file) {
    const ext = (file.name.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, ''),
      ym = p.date.slice(0, 7).replace('-', '/'),
      safeProv = (p.provider || 'Parken').replace(/[^a-z0-9äöü_-]/gi, '_'),
      path = `${V69.parking}/${ym}/${safeProv}_${p.date}_${(p.start || '0000').replace(':', '')}-${(p.end || '0000').replace(':', '')}_${Number(p.amount).toFixed(2).replace('.', '-')}EUR_${p.id}.${ext}`;
    await dbxUpload(path, file);
    p.dropboxReceiptPath = path;
    p.updatedAt = nowISO();
    return path;
  };

  // Workflow-Darstellung an den neuen Ein-Datei-Prozess anpassen.
  OrdiPilotExt.extend(
    'renderInvoiceWorkflow',
    baseWorkflow =>
      function () {
        baseWorkflow();
        const rec = invoiceRecord(),
          created = !!rec?.createdAt,
          signed = !!rec?.signedAt,
          path = rec ? finalPath(rec.year, rec.month) : '';
        if (invoiceStepCreatedSub)
          invoiceStepCreatedSub.textContent = created
            ? rec.dropboxPath
              ? `Dropbox · ${path}`
              : 'PDF erstellt · Dropbox noch offen'
            : 'Noch nicht erstellt';
        if (invoiceStepCreatedStatus) {
          invoiceStepCreatedStatus.textContent = created ? (rec.dropboxPath ? 'Dropbox ✓' : 'erstellt') : 'offen';
          invoiceStepCreatedStatus.className = 'doc-status-pill ' + (created ? (rec.dropboxPath ? 'ok' : 'blue') : '');
        }
        if (invoiceStepSignedSub)
          invoiceStepSignedSub.textContent = signed
            ? 'Qualifiziert signierte PDF übernommen'
            : 'Persönliche Freigabe über ID Austria erforderlich';
        if (invoiceStepDropboxSub)
          invoiceStepDropboxSub.textContent =
            signed && rec?.signedDropboxPath
              ? `Original ersetzt · ${path}`
              : created && rec?.dropboxPath
                ? `Unsignierte Fassung liegt unter ${path}`
                : 'Wird beim Erstellen automatisch angelegt';
        if (invoiceStepDropboxStatus) {
          invoiceStepDropboxStatus.textContent =
            signed && rec?.signedDropboxPath ? 'ersetzt ✓' : created && rec?.dropboxPath ? 'vorbereitet' : 'offen';
          invoiceStepDropboxStatus.className =
            'doc-status-pill ' + (signed && rec?.signedDropboxPath ? 'ok' : created && rec?.dropboxPath ? 'blue' : '');
        }
        if (invoiceStartSign) {
          invoiceStartSign.textContent = 'Mit ID Austria signieren';
          invoiceStartSign.style.display = created && !signed ? 'inline-flex' : 'none';
        }
        if (invoiceSignedLabel) {
          invoiceSignedLabel.textContent = 'Signierte PDF übernehmen & Original ersetzen';
          invoiceSignedLabel.style.display = created && !signed ? 'inline-flex' : 'none';
        }
        if (invoiceArchiveSigned) invoiceArchiveSigned.style.display = 'none';
        if (invoiceDownloadDraft) {
          invoiceDownloadDraft.textContent = 'PDF öffnen';
          invoiceDownloadDraft.style.display = created ? 'inline-flex' : 'none';
        }
        if (invoiceFileHint && rec)
          invoiceFileHint.textContent = `Datei: ${finalName(rec.year, rec.month)} · Dropbox: Honorarnoten/${rec.year}`;
      }
  );

  syncEasyPark.onclick = async () => {
    await importEasyParkFromDropbox(true);
    saveState();
    refreshAll();
  };

  // Sichtbare Settings sofort auf die bereinigte Struktur setzen.
  OrdiPilotBoot.add('v69:3', () => {
    if (window.setDropboxPath) {
      setDropboxPath.value = V69.data;
      setDropboxPath.readOnly = true;
    }
    if (window.setEasyParkImportPath) {
      setEasyParkImportPath.value = V69.easyPark;
      setEasyParkImportPath.readOnly = true;
    }
    if (window.setInvoiceDropboxBase) {
      setInvoiceDropboxBase.value = V69.invoices;
      setInvoiceDropboxBase.readOnly = true;
    }
    renderInvoice();
  });
})();
