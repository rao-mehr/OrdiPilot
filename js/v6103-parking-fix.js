// OrdiPilot V6.10.3 – robuster EasyPark-/Parkbeleg-Import.
// Erkennt PDF-Belege sowohl direkt im Monatsordner als auch in Unterordnern wie "EasyPark".
(function () {
  const P6103 = { root: '/Ordination & Selbständigkeit/Vertretungsdienste/Parkbelege' };

  function normalizeParkingPath6103(path) {
    let p = String(path || '').trim();
    if (!p) return '';
    p = p
      .replace(/^\/Vertretungsdienste\/03 Parkbelege/i, P6103.root)
      .replace(/^\/Vertretungsdienste\/Parkbelege/i, P6103.root)
      .replace(/^\/Vertretungsabrechnung\/Parkscheine/i, P6103.root);
    return p;
  }
  function parkingCandidates6103(path, receiptName, date) {
    const p = normalizeParkingPath6103(path),
      out = [];
    if (p) out.push(p);
    const name = receiptName || p.split('/').pop() || '';
    const d = String(date || '');
    if (name && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [y, m] = d.split('-'),
        base = `${P6103.root}/${y}/${m}`;
      out.push(`${base}/${name}`, `${base}/EasyPark/${name}`);
      // Legacy-Unterordner werden weiterhin gefunden, aber nicht neu angelegt.
      out.push(`${base}/Bestaetigungen/${name}`, `${base}/Belege/${name}`);
    }
    return [...new Set(out.filter(Boolean))];
  }
  function parseEasyParkFilename6103(name) {
    const n = String(name || '');
    let m = n.match(
      /^EasyPark_(?:Bestaetigung_)?(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})-(\d{2})(\d{2})_([0-9]+)-([0-9]{2})EUR(?:_.*)?\.pdf$/i
    );
    if (!m) return null;
    return {
      date: m[1],
      start: `${m[2]}:${m[3]}`,
      end: `${m[4]}:${m[5]}`,
      amount: Number(`${m[6]}.${m[7]}`),
      provider: 'EasyPark',
    };
  }
  function hash6103(s) {
    let h = 2166136261;
    for (const ch of String(s || '')) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }
  function sameParking6103(a, b) {
    return (
      a &&
      b &&
      a.provider === 'EasyPark' &&
      a.date === b.date &&
      (a.start || '') === (b.start || '') &&
      (a.end || '') === (b.end || '') &&
      Math.abs(Number(a.amount || 0) - Number(b.amount || 0)) < 0.005
    );
  }
  function dedupeEasyPark6103() {
    const arr = state.parkingRecords || [],
      keep = [];
    for (const p of arr) {
      if (p.provider !== 'EasyPark') {
        keep.push(p);
        continue;
      }
      const ix = keep.findIndex(x => sameParking6103(x, p));
      if (ix < 0) {
        keep.push(p);
        continue;
      }
      const a = keep[ix],
        prefer = p.sourceMessageId && !a.sourceMessageId ? p : a,
        other = prefer === p ? a : p;
      keep[ix] = {
        ...other,
        ...prefer,
        dropboxReceiptPath: normalizeParkingPath6103(prefer.dropboxReceiptPath || other.dropboxReceiptPath),
        receiptName: prefer.receiptName || other.receiptName,
        officialUrl: prefer.officialUrl || other.officialUrl,
        entryId: prefer.assignmentMode === 'manual' ? prefer.entryId : prefer.entryId || other.entryId || '',
        assignmentMode:
          prefer.assignmentMode === 'manual' ? 'manual' : prefer.assignmentMode || other.assignmentMode || 'auto',
        updatedAt: [prefer.updatedAt, other.updatedAt].filter(Boolean).sort().pop() || nowISO(),
      };
    }
    state.parkingRecords = keep;
  }
  async function listRecursive6103(path) {
    let out = [];
    try {
      let r = await dbxRpc('files/list_folder', { path, recursive: true, include_deleted: false, limit: 500 });
      out.push(...(r.entries || []));
      while (r.has_more) {
        r = await dbxRpc('files/list_folder/continue', { cursor: r.cursor });
        out.push(...(r.entries || []));
      }
      return out;
    } catch (e) {
      if (/not_found/i.test(String(e?.message || e))) return [];
      throw e;
    }
  }
  async function scanParkingReceipts6103() {
    if (!isDropboxConnected()) return { added: 0, updated: 0, files: 0 };
    const years = new Set([String(new Date().getFullYear())]);
    // Aktuelles Jahr immer; zusätzlich das in der Parkansicht gewählte Jahr, falls vorhanden.
    if (window.parkingYear?.value) years.add(String(parkingYear.value));
    let added = 0,
      updated = 0,
      files = 0;
    for (const y of years) {
      const entries = await listRecursive6103(`${P6103.root}/${y}`);
      for (const f of entries) {
        if (f?.['.tag'] !== 'file' && !f?.name) continue;
        const parsed = parseEasyParkFilename6103(f.name);
        if (!parsed) continue;
        files++;
        const path = normalizeParkingPath6103(f.path_display || f.path_lower || '');
        let p = (state.parkingRecords || []).find(x => sameParking6103(x, parsed));
        if (p) {
          const before = p.dropboxReceiptPath || '';
          p.receiptName = p.receiptName || f.name;
          p.dropboxReceiptPath = path || normalizeParkingPath6103(before);
          if (!p.source) p.source = 'EasyPark/Dropbox';
          if (path && path !== before) {
            p.updatedAt = nowISO();
            updated++;
          }
          continue;
        }
        const tmp = { date: parsed.date, start: parsed.start, end: parsed.end },
          best = bestParkingAssignment(tmp);
        p = {
          id: `easypark-pdf-${hash6103(path || f.name)}`,
          ...parsed,
          vat: 0,
          city: '',
          zone: '',
          entryId: best.id || '',
          assignmentMode: 'auto',
          assignmentReason: best.reason || '',
          documentType: 'confirmation',
          source: 'EasyPark/Dropbox',
          receiptName: f.name,
          dropboxReceiptPath: path,
          note: '',
          updatedAt: f.server_modified || nowISO(),
        };
        state.parkingRecords.push(p);
        added++;
      }
    }
    dedupeEasyPark6103();
    reconcileParkingAssignments();
    return { added, updated, files };
  }

  // Alte gespeicherte Pfade sofort auf die bereinigte Ordnerstruktur umstellen.
  OrdiPilotBoot.add('v6103-parking-fix:1', () => {
    (state.parkingRecords || []).forEach(p => {
      if (p.dropboxReceiptPath) p.dropboxReceiptPath = normalizeParkingPath6103(p.dropboxReceiptPath);
    });
    dedupeEasyPark6103();
  });

  OrdiPilotExt.extend(
    'mergeEasyParkImport',
    baseMerge6103 =>
      function (doc) {
        const copy = JSON.parse(JSON.stringify(doc || {})),
          recs = Array.isArray(copy) ? copy : copy.records || [];
        for (const r of recs) {
          if (r?.dropboxReceiptPath) r.dropboxReceiptPath = normalizeParkingPath6103(r.dropboxReceiptPath);
        }
        const result = baseMerge6103(copy);
        dedupeEasyPark6103();
        return result;
      }
  );

  OrdiPilotExt.extend(
    'importEasyParkFromDropbox',
    baseImport6103 =>
      async function (showResult = false) {
        const indexed = await baseImport6103(false);
        let scan = { added: 0, updated: 0, files: 0 };
        try {
          scan = await scanParkingReceipts6103();
        } catch (e) {
          console.warn('Parkbeleg-Folderscan fehlgeschlagen', e);
        }
        if (window.easyParkStatus) {
          easyParkStatus.textContent = `EasyPark: ${indexed.total || 0} Index-Datensätze · ${scan.files || 0} PDFs in Dropbox · ${Number(indexed.added || 0) + scan.added} neu`;
          easyParkDot.className = 'dot on';
        }
        if (showResult)
          alert(
            `EasyPark geprüft: ${Number(indexed.added || 0) + scan.added} neue, ${Number(indexed.updated || 0) + scan.updated} aktualisierte Parkvorgänge. Hauptordner und EasyPark-Unterordner wurden berücksichtigt.`
          );
        return {
          added: Number(indexed.added || 0) + scan.added,
          updated: Number(indexed.updated || 0) + scan.updated,
          total: indexed.total || 0,
          files: scan.files,
        };
      }
  );

  // Beleg öffnen: gespeicherten Pfad versuchen, danach automatisch Hauptordner/EasyPark/Legacy-Unterordner testen.
  OrdiPilotExt.extend(
    'openReceipt',
    baseOpenReceipt6103 =>
      async function (id) {
        const p = (state.parkingRecords || []).find(x => x.id === id);
        if (p && isDropboxConnected() && (p.dropboxReceiptPath || p.receiptName)) {
          for (const candidate of parkingCandidates6103(p.dropboxReceiptPath, p.receiptName, p.date)) {
            try {
              const link = await dropboxTemporaryLink(candidate);
              if (candidate !== p.dropboxReceiptPath) {
                p.dropboxReceiptPath = candidate;
                p.updatedAt = nowISO();
                saveState(false);
              }
              window.open(link, '_blank');
              return;
            } catch (e) {}
          }
        }
        return baseOpenReceipt6103(id);
      }
  );

  OrdiPilotExt.extend(
    'renderParking',
    baseRenderParking6103 =>
      function () {
        baseRenderParking6103();
        if (window.easyParkAutoBadge) {
          const n = (state.parkingRecords || []).filter(p => p.provider === 'EasyPark').length;
          easyParkAutoBadge.textContent = `${n} EasyPark-Vorgänge importiert · Hauptordner + EasyPark-Unterordner`;
        }
      }
  );

  OrdiPilotBoot.add('v6103-parking-fix:2', () => {
    saveState(false);
    try {
      renderParking();
    } catch (e) {}
  });
})();
