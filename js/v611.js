(function () {
  const V611 = {
    version: '6.11.0',
    invoiceRoot: '/Ordination & Selbständigkeit/Vertretungsdienste/Honorarnoten',
    signUrl: 'https://www.a-trust.at/pdfsign',
  };
  const esc = typeof escapeHtml === 'function' ? escapeHtml : v => String(v ?? '');
  const pad = v => String(v).padStart(2, '0');
  const icon = name => {
    const d = {
      edit: '<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
      trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
      car: '<path d="m5 16 1-5 2-3h8l2 3 1 5M4 16h16v3H4z"/><circle cx="7" cy="19" r="1"/><circle cx="17" cy="19" r="1"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
      money:
        '<circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.7-.7-1.7-1-3-1-1.7 0-3 .8-3 2s1 1.8 3 2.2 3 1 3 2.3-1.3 2.3-3 2.3c-1.4 0-2.5-.4-3.2-1.2M12 5v14"/>',
      cloud: '<path d="M7 18h10a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.2 8.5 4.5 4.5 0 0 0 7 18Z"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12h2M3 12h2M12 3v2M12 19v2M17 7l1.5-1.5M5.5 18.5 7 17M17 17l1.5 1.5M5.5 5.5 7 7"/>',
      send: '<path d="m3 11 18-8-8 18-2-8-8-2Z"/><path d="m11 13 10-10"/>',
      time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/>',
      back: '<path d="m15 18-6-6 6-6"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${d[name] || ''}</svg>`;
  };

  function normalizeRecipient(raw, i = 0) {
    return {
      ...(raw && typeof raw === 'object' ? raw : {}),
      id: String(raw?.id || `recipient-${Date.now().toString(36)}-${i}`),
      name: String(raw?.name || ''),
      qualification: String(raw?.qualification || ''),
      address: String(raw?.address || ''),
      email: String(raw?.email || ''),
    };
  }
  function ensureRecipients() {
    const s = state.settings || (state.settings = {});
    let arr = Array.isArray(s.recipients) ? s.recipients.map(normalizeRecipient) : [];
    if (!arr.length) {
      arr = [
        normalizeRecipient({
          id: 'recipient-primary',
          name: s.recipientName || '',
          qualification: s.recipientQualification || '',
          address: s.recipientAddress || '',
          email: s.recipientEmail || '',
        }),
      ];
    }
    s.recipients = arr;
    if (!s.activeRecipientId || !arr.some(r => r.id === s.activeRecipientId)) s.activeRecipientId = arr[0].id;
    const primary = arr[0];
    for (const e of state.entries || []) if (!e.recipientId) e.recipientId = primary.id;
    for (const r of state.invoices || []) {
      if (r.archivedRecord) continue;
      if (!r.recipientId) r.recipientId = primary.id;
      if (r.key && !r.key.includes('::')) r.key = `${r.key}::${r.recipientId}`;
    }
    applyRecipientToLegacy(s.activeRecipientId, false);
    return arr;
  }
  function recipients() {
    return ensureRecipients();
  }
  function recipientById(id) {
    return recipients().find(r => r.id === id) || recipients()[0];
  }
  function activeRecipient() {
    return recipientById(state.settings.activeRecipientId);
  }
  function applyRecipientToLegacy(id, save = true) {
    const r = (state.settings.recipients || []).find(x => x.id === id) || (state.settings.recipients || [])[0];
    if (!r) return;
    state.settings.activeRecipientId = r.id;
    state.settings.recipientName = r.name || '';
    state.settings.recipientQualification = r.qualification || '';
    state.settings.recipientAddress = r.address || '';
    state.settings.recipientEmail = r.email || '';
    if (save) saveState(false);
  }
  function selectRecipient(id, { render = true } = {}) {
    applyRecipientToLegacy(id, false);
    if (window.setRecipientName) {
      setRecipientName.value = state.settings.recipientName || '';
      setRecipientQualification.value = state.settings.recipientQualification || '';
      setRecipientAddress.value = state.settings.recipientAddress || '';
      setRecipientEmail.value = state.settings.recipientEmail || '';
    }
    saveState();
    if (window.invNumber)
      invNumber.value = invoiceRecord()?.number || defaultInvoiceNumber(invYear.value, invMonth.value);
    renderRecipientManager();
    if (render) {
      renderInvoice();
      renderEntries();
    }
  }
  window.ordipilotActiveRecipientId = () => activeRecipient().id;
  window.ordipilotRecipientMonthLocked = (mk, rid) => {
    const key = `${mk}::${rid}`;
    const rec = (state.invoices || []).find(x => x.key === key && !x.archivedRecord);
    return !!(rec && (rec.signedAt || rec.mailOpenedAt));
  };
  OrdiPilotBoot.add('v611:1', () => {
    ensureRecipients();
    repairInvoiceRecordsV611();
    saveState(false);
  });

  // Multi-recipient invoice model. Existing single-recipient data is migrated to the primary recipient.
  window.invoiceKey = function (y = invYear.value, m = invMonth.value, rid = state.settings.activeRecipientId) {
    return `${y}-${pad(m)}::${rid || activeRecipient().id}`;
  };
  window.invoiceRecord = function (y = invYear.value, m = invMonth.value, rid = state.settings.activeRecipientId) {
    const key = invoiceKey(y, m, rid);
    return (state.invoices || []).find(r => r.key === key && !r.archivedRecord) || null;
  };
  window.currentInvoiceEntries = function () {
    const y = invYear.value,
      m = pad(invMonth.value),
      rid = activeRecipient().id;
    return (state.entries || [])
      .filter(e => e.date?.startsWith(`${y}-${m}-`) && isEarnedEntry(e) && e.recipientId === rid)
      .sort((a, b) => a.date.localeCompare(b.date));
  };
  window.defaultInvoiceNumber = function (y, m) {
    const rec = invoiceRecord(y, m);
    if (rec?.number) return rec.number;
    const yy = Number(y),
      nums = (state.invoices || [])
        .filter(r => Number(r.year) === yy && r.number)
        .map(r => Number(String(r.number).split('-').pop()))
        .filter(Number.isFinite),
      usedMax = nums.length ? Math.max(...nums) : 0,
      legacy = yy === 2026 && Number(m) >= 2 ? Number(m) - 1 : Number(m),
      next = Math.max(usedMax + 1, legacy, 1);
    return `${yy}-${String(next).padStart(3, '0')}`;
  };
  window.monthReadinessV63 = function (y, m) {
    const mm = pad(m),
      mk = `${y}-${mm}`,
      rid = activeRecipient().id,
      es = (state.entries || []).filter(e => monthKey(e) === mk && e.recipientId === rid),
      done = es.filter(isEarnedEntry),
      pending = es.filter(e => !isEarnedEntry(e)),
      entryIds = new Set(es.map(e => e.id)),
      unassigned = (state.parkingRecords || []).filter(
        p =>
          monthKey(p) === mk &&
          !p.excluded &&
          (!p.entryId || (entryIds.has(p.entryId) && !state.entries.some(e => e.id === p.entryId)))
      ),
      rec = invoiceRecord(y, m, rid),
      locked = !!(rec && (rec.signedAt || rec.mailOpenedAt)),
      reasons = [];
    if (!done.length) reasons.push('keine abgeschlossenen Einsätze');
    if (pending.length)
      reasons.push(`${pending.length} ${pending.length === 1 ? 'Einsatz' : 'Einsätze'} noch offen/geplant`);
    if (unassigned.length)
      reasons.push(`${unassigned.length} ${unassigned.length === 1 ? 'Parkvorgang' : 'Parkvorgänge'} ungeklärt`);
    return {
      mk,
      es,
      done,
      pending,
      unassigned,
      ready: done.length > 0 && pending.length === 0 && unassigned.length === 0,
      locked,
      reasons,
      rec,
    };
  };
  window.monthLockedV63 = function () {
    return false;
  }; // Neue Einsätze bleiben für andere Empfänger planbar; Eintrags-Sperre erfolgt recipient-spezifisch.

  function recipientToken(r) {
    let raw = String(r?.name || 'Empfaenger')
        .replace(/\b(Dr|Doz|OA|FA|Prim|med)\.?\b/gi, ' ')
        .trim(),
      last = raw.split(/\s+/).filter(Boolean).pop() || 'Empfaenger',
      x = last
        .replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return x || 'Empfaenger';
  }
  window.invoiceFilename = function () {
    return `${invYear.value}-${pad(invMonth.value)}_Honorarnote_${recipientToken(activeRecipient())}.pdf`;
  };
  function invoicePath(rec = invoiceRecord()) {
    const y = rec?.year || invYear.value;
    return `${V611.invoiceRoot}/${y}/${rec?.filename || invoiceFilename()}`;
  }
  function repairInvoiceRecordsV611() {
    for (const rec of state.invoices || []) {
      if (!rec || !rec.year || !rec.month) continue;
      const rid = rec.recipientId || state.settings.recipients?.[0]?.id;
      if (!rid) continue;
      rec.recipientId = rid;
      const r = recipientById(rid),
        name = `${rec.year}-${pad(rec.month)}_Honorarnote_${recipientToken(r)}.pdf`,
        p = `${V611.invoiceRoot}/${rec.year}/${name}`;
      if (!rec.archivedRecord) rec.key = `${rec.year}-${pad(rec.month)}::${rid}`;
      rec.filename = name;
      if (rec.createdAt) {
        rec.dropboxPath = p;
        rec.unsignedDropboxPath = p;
      }
      if (rec.signedAt) {
        rec.signedFilename = name;
        rec.signedDropboxPath = rec.signedDropboxPath ? p : rec.signedDropboxPath;
      }
    }
  }

  // Settings: Empfänger persistent verwalten.
  function renderRecipientManager() {
    const host = document.getElementById('v611RecipientManager');
    if (!host) return;
    const arr = recipients(),
      active = activeRecipient();
    host.innerHTML = `<div class="v611-recipient-toolbar"><div><strong>Gespeicherte Empfänger</strong><div class="help">Einmal erfassen – danach bei Einsätzen und Honorarnoten auswählbar.</div></div><button type="button" class="v611-add-recipient" id="v611AddRecipient">+ Empfänger</button></div><div class="v611-recipient-list">${arr.map(r => `<div class="v611-recipient-card ${r.id === active.id ? 'active' : ''}" data-v611-recipient="${esc(r.id)}"><div><strong>${esc(r.name || 'Neuer Empfänger')}</strong><small>${esc(r.qualification || r.email || 'Daten ergänzen')}</small></div>${arr.length > 1 ? `<button class="v611-recipient-delete" type="button" data-v611-recipient-delete="${esc(r.id)}" aria-label="Empfänger entfernen">×</button>` : ''}</div>`).join('')}</div>`;
    host.querySelectorAll('[data-v611-recipient]').forEach(
      el =>
        (el.onclick = ev => {
          if (ev.target.closest('[data-v611-recipient-delete]')) return;
          selectRecipient(el.dataset.v611Recipient);
        })
    );
    host.querySelectorAll('[data-v611-recipient-delete]').forEach(
      b =>
        (b.onclick = ev => {
          ev.stopPropagation();
          const id = b.dataset.v611RecipientDelete,
            used =
              (state.entries || []).some(e => e.recipientId === id) ||
              (state.invoices || []).some(i => i.recipientId === id);
          if (used) {
            alert(
              'Dieser Empfänger ist bereits mit Einsätzen oder Honorarnoten verknüpft und kann nicht gelöscht werden.'
            );
            return;
          }
          if (!confirm('Diesen Rechnungsempfänger entfernen?')) return;
          state.settings.recipients = state.settings.recipients.filter(r => r.id !== id);
          if (state.settings.activeRecipientId === id)
            state.settings.activeRecipientId = state.settings.recipients[0].id;
          applyRecipientToLegacy(state.settings.activeRecipientId, false);
          saveState();
          loadSettingsForm();
          renderRecipientManager();
          renderInvoice();
        })
    );
    document.getElementById('v611AddRecipient').onclick = () => {
      const id = `recipient-${Date.now().toString(36)}`;
      state.settings.recipients.push({ id, name: '', qualification: '', address: '', email: '' });
      selectRecipient(id);
      setTimeout(() => setRecipientName?.focus(), 60);
    };
  }
  function installRecipientManager() {
    const cards = [...document.querySelectorAll('#panel-settings .settings-grid>.card')],
      card = cards.find(
        c =>
          c.querySelector('.settings-accordion-head span')?.textContent.trim() === 'Rechnungsempfänger' ||
          c.querySelector('h3')?.textContent.trim() === 'Rechnungsempfänger'
      );
    if (!card) return;
    const body = card.querySelector('.settings-accordion-body') || card;
    let host = document.getElementById('v611RecipientManager');
    if (!host) {
      host = document.createElement('div');
      host.id = 'v611RecipientManager';
      host.className = 'v611-recipient-manager';
      body.prepend(host);
    }
    renderRecipientManager();
  }
  OrdiPilotBoot.add('v611:2', () => {
    installRecipientManager();
    [setRecipientName, setRecipientQualification, setRecipientAddress, setRecipientEmail].filter(Boolean).forEach(el =>
      el.addEventListener('change', () => {
        const r = activeRecipient();
        r.name = setRecipientName.value.trim();
        r.qualification = setRecipientQualification.value.trim();
        r.address = setRecipientAddress.value.trim();
        r.email = setRecipientEmail.value.trim();
        applyRecipientToLegacy(r.id, false);
        saveState();
        renderRecipientManager();
        renderInvoice();
      })
    );
  });

  // Settings wie eine native App: Menü -> eigene Detailansicht -> zurück.
  function setupSettingsNavigation() {
    const panel = document.getElementById('panel-settings'),
      grid = panel?.querySelector('.settings-grid');
    if (!panel || !grid || document.getElementById('v611SettingsMenu')) return;
    const meta = {
      Abrechnung: ['money', 'Stundensatz, Rücklage und Honorarnoten-Texte', 'Abrechnung & Honorar'],
      'Meine Rechnungsdaten': ['user', 'Absender, Bank- und Steuerdaten', 'Abrechnung & Honorar'],
      Rechnungsempfänger: ['user', 'Empfänger speichern, hinzufügen und auswählen', 'Abrechnung & Honorar'],
      'Honorarnote · Versand': ['send', 'Versand, Ablage und Kurzbefehl', 'Abrechnung & Honorar'],
      'Zeitprofile für Einsätze': ['time', 'Vormittag, Nachmittag und Ganztag', 'Einsätze'],
      'Dropbox-Synchronisierung': ['cloud', 'Daten zwischen Geräten synchronisieren', 'Verbindungen'],
      'EasyPark-Automatik': ['car', 'Parkbelege automatisch übernehmen', 'Verbindungen'],
      'Apple Kalender · Vertretungen': ['calendar', 'Kalender-Synchronisierung und Navigation', 'Verbindungen'],
    };
    const cards = [...grid.querySelectorAll(':scope>.card')],
      menu = document.createElement('div');
    menu.id = 'v611SettingsMenu';
    menu.className = 'v611-settings-menu';
    const pages = document.createElement('div');
    pages.id = 'v611SettingsPages';
    const grouped = {};
    cards.forEach((card, i) => {
      const head = card.querySelector('.settings-accordion-head'),
        title =
          head?.querySelector('span')?.textContent.trim() ||
          card.querySelector('h3')?.textContent.trim() ||
          `Einstellung ${i + 1}`,
        [ico, desc, group] = meta[title] || ['gear', 'Einstellungen', 'Weitere'];
      (grouped[group] || (grouped[group] = [])).push({ title, ico, desc, i });
      const body = card.querySelector('.settings-accordion-body');
      if (body) body.hidden = false;
      const detail = document.createElement('div');
      detail.className = 'v611-settings-detail';
      detail.dataset.v611SettingsPage = String(i);
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'v611-settings-back';
      back.innerHTML = '‹ Einstellungen';
      back.onclick = () => showSettingsMenu();
      detail.appendChild(back);
      detail.appendChild(card);
      pages.appendChild(detail);
    });
    Object.entries(grouped).forEach(([group, items]) => {
      menu.insertAdjacentHTML('beforeend', `<div class="v611-settings-group-title">${esc(group)}</div>`);
      items.forEach(x =>
        menu.insertAdjacentHTML(
          'beforeend',
          `<button type="button" class="v611-settings-row" data-v611-settings-open="${x.i}"><span class="v611-settings-icon">${icon(x.ico)}</span><span class="v611-settings-copy"><strong>${esc(x.title)}</strong><small>${esc(x.desc)}</small></span><span class="v611-settings-chevron">›</span></button>`
        )
      );
    });
    grid.remove();
    panel.appendChild(menu);
    panel.appendChild(pages);
    menu
      .querySelectorAll('[data-v611-settings-open]')
      .forEach(b => (b.onclick = () => openSettingsPage(b.dataset.v611SettingsOpen)));
    window.showSettingsMenu = showSettingsMenu;
    window.openSettingsPage = openSettingsPage;
    function showSettingsMenu() {
      menu.style.display = 'grid';
      pages.querySelectorAll('.v611-settings-detail').forEach(p => p.classList.remove('active'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function openSettingsPage(i) {
      menu.style.display = 'none';
      pages
        .querySelectorAll('.v611-settings-detail')
        .forEach(p => p.classList.toggle('active', p.dataset.v611SettingsPage === String(i)));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
  OrdiPilotBoot.add('v611:3', () => {
    setupSettingsNavigation();
  });

  OrdiPilotExt.extend(
    'switchTab',
    baseSwitchV611 =>
      function (name) {
        baseSwitchV611(name);
        if (name === 'settings' && window.showSettingsMenu) showSettingsMenu();
        if (name === 'invoice') renderInvoiceRecipientTiles();
      }
  );

  // Invoice recipient tiles.
  function invoiceEntriesForRecipient(rid, y = invYear.value, m = invMonth.value) {
    return (state.entries || []).filter(
      e => e.date?.startsWith(`${y}-${pad(m)}-`) && isEarnedEntry(e) && e.recipientId === rid
    );
  }
  function renderInvoiceRecipientTiles() {
    let host = document.getElementById('v611InvoiceRecipients');
    const shell = document.querySelector('#panel-invoice .invoice-shell');
    if (!shell) return;
    if (!host) {
      host = document.createElement('div');
      host.id = 'v611InvoiceRecipients';
      host.className = 'v611-invoice-recipients no-print';
      shell.prepend(host);
    }
    const active = activeRecipient().id;
    host.innerHTML = recipients()
      .map(r => {
        const es = invoiceEntriesForRecipient(r.id),
          sum = es.reduce((a, e) => a + (gross(e) || 0), 0),
          hrs = es.reduce((a, e) => a + (entryHours(e) || 0), 0),
          rec = invoiceRecord(invYear.value, invMonth.value, r.id),
          stateLabel = rec?.signedAt
            ? 'signiert'
            : rec?.createdAt
              ? 'PDF erstellt'
              : es.length
                ? 'bereit'
                : 'keine Einsätze',
          cls = rec?.signedAt ? 'ok' : rec?.createdAt || es.length ? 'blue' : '';
        return `<button type="button" class="v611-invoice-recipient ${r.id === active ? 'active' : ''}" data-v611-invoice-recipient="${esc(r.id)}"><strong>${esc(r.name || 'Empfänger')}</strong><div class="sum">${euro(sum)}</div><small>${dec(hrs, 1)} h · ${es.length} ${es.length === 1 ? 'Einsatz' : 'Einsätze'}</small><span class="state ${cls}">${stateLabel}</span></button>`;
      })
      .join('');
    host.querySelectorAll('[data-v611-invoice-recipient]').forEach(
      b =>
        (b.onclick = () => {
          selectRecipient(b.dataset.v611InvoiceRecipient, { render: false });
          invNumber.value = invoiceRecord()?.number || defaultInvoiceNumber(invYear.value, invMonth.value);
          renderInvoice();
          renderInvoiceRecipientTiles();
        })
    );
  }

  OrdiPilotExt.extend(
    'renderInvoice',
    baseRenderInvoiceV611 =>
      function () {
        applyRecipientToLegacy(state.settings.activeRecipientId, false);
        baseRenderInvoiceV611();
        renderInvoiceRecipientTiles();
        const r = activeRecipient();
        const title = document.querySelector('.invoice-create-title');
        if (title) title.textContent = `Honorarnote · ${r.name || 'Empfänger'}`;
      }
  );
  OrdiPilotExt.extend(
    'renderInvoiceWorkflow',
    baseWorkflowV611 =>
      function () {
        baseWorkflowV611();
        const rec = invoiceRecord(),
          path = rec ? invoicePath(rec) : invoicePath({ year: invYear.value, filename: invoiceFilename() });
        if (window.invoiceFileHint)
          invoiceFileHint.textContent = `Datei: ${rec?.filename || invoiceFilename()} · Dropbox: Honorarnoten/${rec?.year || invYear.value}`;
        if (window.invoiceStepCreatedSub && rec?.createdAt)
          invoiceStepCreatedSub.textContent = rec.dropboxPath
            ? `Dropbox · ${path}`
            : 'PDF erstellt · Dropbox noch offen';
        if (window.invoiceStepDropboxSub && rec?.signedDropboxPath)
          invoiceStepDropboxSub.textContent = `Original ersetzt · ${path}`;
        if (window.invoiceFlowTitle && rec?.createdAt)
          invoiceFlowTitle.textContent = `${activeRecipient().name || 'Honorarnote'} · ${rec.number || invoiceNumberDisplay.textContent} · ${MONTHS[Number(invMonth.value) - 1]} ${invYear.value}`;
      }
  );

  async function createInvoiceV611() {
    const es = currentInvoiceEntries();
    if (!es.length) {
      alert('Für diesen Rechnungsempfänger gibt es in diesem Monat noch keine abgeschlossenen Einsätze.');
      return;
    }
    const s = state.settings;
    if (
      !s.issuerName ||
      !s.issuerQualification ||
      !s.issuerAddress ||
      !s.recipientName ||
      !s.recipientAddress ||
      !s.iban
    ) {
      alert('Bitte zuerst Rechnungsdaten, Rechnungsempfänger und IBAN vollständig hinterlegen.');
      return;
    }
    const read = monthReadinessV63(invYear.value, invMonth.value),
      existing = invoiceRecord();
    if (existing?.signedAt) {
      alert('Diese Honorarnote ist bereits signiert und gesperrt.');
      return;
    }
    if (
      !read.ready &&
      !confirm(
        `Der Monat ist für ${s.recipientName || 'diesen Empfänger'} noch nicht vollständig abrechnungsbereit:\n\n${read.reasons.join('\n')}\n\nHonorarnote trotzdem vorzeitig erstellen?`
      )
    )
      return;
    const y = invYear.value,
      m = invMonth.value,
      key = invoiceKey(y, m),
      num = invNumber.value || defaultInvoiceNumber(y, m),
      owner = invoiceNumberOwnerV63(num, key);
    if (owner) {
      alert(`Die Honorarnummer ${num} ist bereits vergeben.`);
      return;
    }
    let blob;
    try {
      blob = await createInvoicePdfBlob();
    } catch (err) {
      console.error(err);
      alert('Die PDF konnte nicht erstellt werden.');
      return;
    }
    const filename = invoiceFilename(),
      snapshot = invoiceSnapshotV63(),
      snapshotHash = JSON.stringify(snapshot);
    await putInvoiceBlob(`draft:${key}`, blob);
    upsertInvoiceRecord({
      key,
      year: y,
      month: m,
      recipientId: activeRecipient().id,
      recipientName: activeRecipient().name,
      number: num,
      invoiceDate: invDate.value,
      filename,
      createdAt: nowISO(),
      confirmedAt: null,
      signatureStartedAt: null,
      signedAt: null,
      signedDropboxPath: null,
      mailOpenedAt: null,
      snapshot,
      snapshotHash,
      readinessAtCreation: { ready: read.ready, reasons: read.reasons },
      correctionOf: existing?.correctionOf || null,
    });
    let rec = invoiceRecord();
    if (isDropboxConnected()) {
      try {
        const p = invoicePath(rec);
        setDropboxStatus('Honorarnote wird in Dropbox gespeichert…', 'busy');
        await dbxUpload(p, blob);
        upsertInvoiceRecord({ key: rec.key, dropboxPath: p, unsignedDropboxPath: p, filename });
        setDropboxStatus(`Honorarnote gespeichert · ${p}`, 'on');
      } catch (e) {
        console.error(e);
        setDropboxStatus('PDF erstellt · Dropbox-Upload fehlgeschlagen', 'warn');
      }
    }
    renderInvoice();
    refreshAll(false);
  }
  window.downloadInvoicePdf = createInvoiceV611;
  makePdf.onclick = createInvoiceV611;

  window.startInvoiceSignature = async function () {
    let rec = invoiceRecord();
    if (!rec?.createdAt) {
      await createInvoiceV611();
      rec = invoiceRecord();
      if (!rec?.createdAt) return;
    }
    if (invoiceIsStaleV63(rec)) {
      alert('Die Abrechnungsdaten haben sich geändert. Bitte die Honorarnote zuerst aktualisieren.');
      return;
    }
    if (rec.signedAt) {
      alert('Diese Honorarnote ist bereits signiert.');
      return;
    }
    const blob = await getInvoiceBlob(`draft:${rec.key}`);
    if (!blob) {
      alert('Die PDF ist auf diesem Gerät nicht mehr vorhanden. Bitte Honorarnote erneut erstellen.');
      return;
    }
    if (isDropboxConnected() && !rec.dropboxPath) {
      try {
        const p = invoicePath(rec);
        await dbxUpload(p, blob);
        upsertInvoiceRecord({ key: rec.key, dropboxPath: p, unsignedDropboxPath: p });
      } catch (e) {
        console.warn(e);
      }
    }
    upsertInvoiceRecord({ key: rec.key, confirmedAt: nowISO(), signatureStartedAt: nowISO() });
    renderInvoice();
    try {
      const file = new File([blob], rec.filename || invoiceFilename(), { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({
          files: [file],
          title: 'Honorarnote mit ID Austria signieren',
          text: 'Nach der Signatur die signierte PDF wieder in OrdiPilot übernehmen.',
        });
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.warn(err);
    }
    window.open(V611.signUrl, '_blank', 'noopener');
  };
  invoiceStartSign.onclick = startInvoiceSignature;

  window.acceptSignedInvoice = async function (file) {
    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('Bitte eine signierte PDF auswählen.');
      return;
    }
    const rec = invoiceRecord();
    if (!rec?.createdAt) {
      alert('Bitte zuerst die Honorarnote erstellen.');
      return;
    }
    if (invoiceIsStaleV63(rec)) {
      alert('Die Daten haben sich seit der PDF-Erstellung geändert. Bitte zuerst eine neue PDF erzeugen.');
      return;
    }
    const blob = file.slice(0, file.size, 'application/pdf'),
      p = invoicePath(rec);
    await putInvoiceBlob(`signed:${rec.key}`, blob);
    if (!isDropboxConnected()) {
      upsertInvoiceRecord({
        key: rec.key,
        signedAt: nowISO(),
        finalizedAt: nowISO(),
        signedFilename: rec.filename,
        signedDropboxPath: null,
      });
      alert('Signierte PDF lokal übernommen. Dropbox ist noch nicht verbunden.');
      renderInvoice();
      return;
    }
    try {
      setDropboxStatus('Signierte PDF ersetzt die unsignierte Fassung…', 'busy');
      await dbxUpload(p, blob);
      upsertInvoiceRecord({
        key: rec.key,
        signedAt: nowISO(),
        finalizedAt: nowISO(),
        signedFilename: rec.filename,
        filename: rec.filename,
        dropboxPath: p,
        unsignedDropboxPath: p,
        signedDropboxPath: p,
      });
      setDropboxStatus(`Signiert · Original ersetzt · ${p}`, 'on');
      renderInvoice();
      refreshAll(false);
    } catch (e) {
      console.error(e);
      setDropboxStatus('Signatur übernommen · Dropbox-Ersetzen fehlgeschlagen', 'warn');
    }
  };
  invoiceSignedFile.onchange = async ev => {
    const f = ev.target.files?.[0];
    if (f) await acceptSignedInvoice(f);
    ev.target.value = '';
  };
  window.archiveSignedInvoice = async function () {
    const rec = invoiceRecord();
    if (!rec?.signedAt) {
      alert('Bitte zuerst die signierte PDF übernehmen.');
      return false;
    }
    if (!isDropboxConnected()) {
      alert('Bitte Dropbox zuerst unter Einstellungen verbinden.');
      return false;
    }
    const blob = await getInvoiceBlob(`signed:${rec.key}`);
    if (!blob) {
      alert('Die signierte PDF ist auf diesem Gerät nicht mehr vorhanden.');
      return false;
    }
    try {
      const p = invoicePath(rec);
      await dbxUpload(p, blob);
      upsertInvoiceRecord({ key: rec.key, dropboxPath: p, signedDropboxPath: p });
      renderInvoice();
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };
  invoiceArchiveSigned.onclick = archiveSignedInvoice;
  invoiceDownloadDraft.onclick = async () => {
    const rec = invoiceRecord();
    if (!rec?.createdAt) {
      alert('Bitte Honorarnote zuerst erstellen.');
      return;
    }
    const p = invoicePath(rec);
    if (isDropboxConnected() && rec.dropboxPath) {
      try {
        const link = await dropboxTemporaryLink(p);
        window.open(link, '_blank', 'noopener');
        return;
      } catch (e) {
        console.warn(e);
      }
    }
    const blob = await getInvoiceBlob(`draft:${rec.key}`);
    if (blob) await downloadBlob(blob, rec.filename || invoiceFilename());
    else alert('PDF nicht verfügbar.');
  };

  // Recipient selector in single-entry editor; old entries remain editable and linked correctly.
  function installEntryRecipient() {
    const content = document.querySelector('#entryDialog .entry-content');
    if (!content || document.getElementById('fRecipient')) return;
    const block = document.createElement('div');
    block.className = 'field v611-entry-recipient-field';
    block.innerHTML = '<label>Rechnungsempfänger</label><select id="fRecipient"></select>';
    const note = document.querySelector('#entryDialog .entry-note');
    content.insertBefore(block, note);
    window.fRecipient = document.getElementById('fRecipient');
  }
  OrdiPilotBoot.add('v611:4', () => {
    installEntryRecipient();
  });
  function fillEntryRecipient(selected) {
    if (!window.fRecipient) return;
    const arr = recipients();
    fRecipient.innerHTML = arr.map(r => `<option value="${esc(r.id)}">${esc(r.name || 'Empfänger')}</option>`).join('');
    fRecipient.value = arr.some(r => r.id === selected) ? selected : activeRecipient().id;
    fRecipient.parentElement.style.display = arr.length > 1 ? 'flex' : 'none';
  }
  OrdiPilotExt.extend(
    'openEntry',
    baseOpenEntryV611 =>
      function (id = null, mode = null, preferredDate = null) {
        const e = id ? (state.entries || []).find(x => x.id === id) : null;
        if (e && ordipilotRecipientMonthLocked(e.date.slice(0, 7), e.recipientId || activeRecipient().id)) {
          alert(
            'Die Honorarnote dieses Rechnungsempfängers ist bereits abgeschlossen. Für Änderungen bitte eine Korrektur-Honorarnote anlegen.'
          );
          return;
        }
        baseOpenEntryV611(id, mode, preferredDate);
        fillEntryRecipient(e?.recipientId || activeRecipient().id);
      }
  );
  OrdiPilotBoot.add('v611:5', () => {
    saveEntry.addEventListener(
      'click',
      ev => {
        const old = editingId ? (state.entries || []).find(e => e.id === editingId) : null,
          rid = window.fRecipient?.value || old?.recipientId || activeRecipient().id,
          date = fDate.value;
        if (ordipilotRecipientMonthLocked(date.slice(0, 7), rid)) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          alert('Für diesen Rechnungsempfänger ist der Monat bereits abgeschlossen.');
          return;
        }
        const before = new Set((state.entries || []).map(e => e.id));
        setTimeout(() => {
          let target = old && state.entries.find(e => e.id === old.id);
          if (!target)
            target = (state.entries || [])
              .filter(e => !before.has(e.id))
              .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
          if (target && target.recipientId !== rid) {
            target.recipientId = rid;
            target.updatedAt = nowISO();
            saveState();
            refreshAll(false);
          }
        }, 60);
      },
      true
    );
  });

  function recipientNameForEntry(e) {
    return recipientById(e.recipientId || recipients()[0].id)?.name || 'Empfänger';
  }
  function actionButton(name, idAttr, id, title, cls = '') {
    return `<button class="v611-iconbtn ${cls}" ${idAttr}="${esc(id)}" title="${esc(title)}">${icon(name)}</button>`;
  }
  function entryCard611(e) {
    const st = entryStatus(e),
      h = entryHours(e),
      g = isEarnedEntry(e) ? gross(e) : null,
      park = entryParkingTotal(e.id),
      planned = entryPlannedTime(e),
      actual = isEarnedEntry(e) ? entryActualTime(e) : '',
      amount = g === null ? '–' : euro(g),
      locked = ordipilotRecipientMonthLocked(e.date.slice(0, 7), e.recipientId || activeRecipient().id),
      multi = recipients().length > 1;
    return `<div class="v611-entry-card status-${st}"><div class="v611-entry-main"><div><div class="v611-date-line"><span class="v611-date">${dateAT(e.date)}</span><span class="v611-status ${st}">${st === 'done' ? 'erledigt' : st === 'today' ? 'heute' : st === 'open' ? 'bestätigen' : 'geplant'}</span></div><div class="v611-time">${esc(planned)}${actual ? ` · tatsächlich ${esc(actual)}` : ''}</div></div><div class="v611-entry-amount">${amount}<small>${h !== null && isEarnedEntry(e) ? `${dec(h, 2)} h` : 'noch offen'}</small></div></div><div class="v611-entry-info">${multi ? `<span class="v611-info-chip">${esc(recipientNameForEntry(e))}</span>` : ''}${park ? `<span class="v611-info-chip">Parken ${euro(park)} · ${entryParkingRecords(e.id).length}×</span>` : ''}<span class="v611-info-chip">${euro(Number(e.rate || state.settings.defaultRate || 0))}/h</span></div>${e.note ? `<div class="v611-entry-note">${esc(e.note)}</div>` : ''}<div class="v611-entry-footer"><span class="left">${locked ? 'Honorarnote abgeschlossen' : e.planningOnly ? 'Planung' : 'Abrechnung'}</span><span class="v611-actions">${locked ? '' : `${(st === 'today' || st === 'open') && e.planningOnly ? actionButton('check', 'data-confirm', e.id, 'Einsatz bestätigen', 'ok') : ''}${state.settings.calendarButtonEnabled && entryPlannedStart(e) && entryPlannedEnd(e) ? actionButton('calendar', 'data-cal', e.id, 'Apple Kalender', 'primary') : ''}${actionButton('edit', 'data-edit', e.id, 'Bearbeiten')}${actionButton('trash', 'data-del', e.id, 'Löschen', 'danger')}`}</span></div></div>`;
  }
  OrdiPilotExt.extend(
    'deleteEntry',
    baseDeleteEntryV611 =>
      function (id) {
        const e = (state.entries || []).find(x => x.id === id);
        if (e && ordipilotRecipientMonthLocked(e.date.slice(0, 7), e.recipientId || activeRecipient().id)) {
          alert(
            'Die Honorarnote dieses Rechnungsempfängers ist bereits abgeschlossen. Der Einsatz kann nicht gelöscht werden.'
          );
          return;
        }
        return baseDeleteEntryV611(id);
      }
  );
  OrdiPilotExt.extend(
    'renderEntries',
    baseRenderEntriesV611 =>
      function () {
        baseRenderEntriesV611();
        const arr = filteredEntries(),
          currentMk = todayISO().slice(0, 7),
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
                  open = mk === currentMk;
                return `<details class="v62-month-group" ${open ? 'open' : ''}><summary><div><div class="v62-month-group-title">${MONTHS[Number(mm) - 1]} ${yy}</div><div class="v62-month-group-meta">${es.length} Einsätze · ${done.length} erledigt · ${pending.length} offen</div></div><div class="v62-month-group-total">${euro(grossSum)}</div></summary><div class="v62-month-group-body">${es
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map(entryCard611)
                  .join('')}</div></details>`;
              })
              .join('')
          : '<div class="v6-open-empty">Keine Einsätze im ausgewählten Jahr.</div>';
        bindEntryActions();
      }
  );

  function durationLabel(p) {
    const mins = parkingMinutes(p);
    if (!mins) return 'Dauer offen';
    const h = Math.floor(mins / 60),
      m = mins % 60;
    return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
  }
  function parkingCard611(p) {
    const time = p.start || p.end ? `${p.start || '?'}–${p.end || '?'}` : 'Zeit offen',
      place = [p.city, p.zone].filter(Boolean).join(' · ') || 'Ort offen',
      assigned = p.entryId ? entryLabel(p.entryId) : 'nicht zugeordnet',
      hasDoc = !!(p.dropboxReceiptPath || p.receiptName || p.officialUrl),
      docType =
        p.documentType === 'receipt'
          ? 'Beleg / Quittung'
          : p.documentType === 'confirmation'
            ? 'Parkbestätigung'
            : 'Dokument';
    return `<div class="v611-park-card ${p.entryId ? '' : 'unassigned'}" ${!p.entryId ? 'data-unassigned="1"' : ''}><div class="v611-park-top"><div><div class="v611-park-date">${dateAT(p.date)}</div><div class="v611-park-provider">${esc(p.provider || 'Parken')} · ${p.assignmentMode === 'manual' ? 'manuell' : 'automatisch'}</div></div><div class="v611-park-amount">${euro(p.amount)}</div></div><div class="v611-park-detail"><div class="v611-park-line">${icon('clock')}<span>${esc(time)} · <strong>${durationLabel(p)}</strong></span></div><div class="v611-park-line">${icon('pin')}<span>${esc(place)}</span></div><div class="v611-park-line">${icon('car')}<span>${esc(assigned)}</span></div></div><div class="v611-park-doc">${hasDoc ? `<button class="v611-eye" data-pview="${esc(p.id)}" title="Dokument ansehen">${icon('eye')}</button>` : `<span class="v611-eye" style="opacity:.35">${icon('eye')}</span>`}<div class="v611-doc-meta"><strong>${docType}</strong><span>${dateAT(p.date)} · ${esc(time)} · ${durationLabel(p)}</span></div><div class="v611-actions">${actionButton('edit', 'data-pedit', p.id, 'Bearbeiten')}${actionButton('trash', 'data-pdel', p.id, 'Löschen', 'danger')}</div></div>${p.note ? `<div class="v611-entry-note">${esc(p.note)}</div>` : ''}</div>`;
  }
  OrdiPilotExt.extend(
    'renderParking',
    baseRenderParkingV611 =>
      function () {
        baseRenderParkingV611();
        const arr = filteredParking(),
          currentMk = todayISO().slice(0, 7),
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
                  total = ps.reduce((a, p) => a + parkAmount(p), 0),
                  open = mk === currentMk;
                return `<details class="v62-month-group" ${open ? 'open' : ''}><summary><div><div class="v62-month-group-title">${MONTHS[Number(mm) - 1]} ${yy}</div><div class="v62-month-group-meta">${ps.length} Vorgänge · ${ps.filter(p => p.receiptName || p.dropboxReceiptPath || p.officialUrl).length} Dokumente${ps.some(p => !p.entryId) ? ` · ${ps.filter(p => !p.entryId).length} offen` : ''}</div></div><div class="v62-month-group-total">${euro(total)}</div></summary><div class="v62-month-group-body">${ps
                  .sort((a, b) => (b.date + (b.start || '')).localeCompare(a.date + (a.start || '')))
                  .map(parkingCard611)
                  .join('')}</div></details>`;
              })
              .join('')
          : '<div class="v6-open-empty">Keine Parkvorgänge im ausgewählten Jahr.</div>';
        bindParkingActions();
        if (parkingFocusUnassigned) setTimeout(focusFirstUnassignedParking, 60);
      }
  );

  // Cloud merges may bring legacy records: normalize recipients immediately afterwards.
  OrdiPilotBoot.add('v611:6', () => {
    (window.ordipilotSyncHooks = window.ordipilotSyncHooks || []).push(() => {
      ensureRecipients();
      repairInvoiceRecordsV611();
    });
  });
  window.renderRecipientManager = renderRecipientManager;
  window.ordipilotInvoiceFilename = (y, m) => `${y}-${pad(m)}_Honorarnote_${recipientToken(activeRecipient())}.pdf`;

  // UI copy and version.
  const help = document.querySelector('#panel-entries .v6-page-sub');
  OrdiPilotBoot.add('v611:7', () => {
    if (help)
      help.textContent =
        'Einsätze nach Monaten klar gegliedert – Status, Zeit, Honorar, Parken und Bemerkung auf einen Blick.';
    document.querySelectorAll('.footer-note').forEach(el => {
      if (/Version/i.test(el.textContent))
        el.textContent = el.textContent.replace(/Version\s*[0-9.]+/i, 'Version 7.2.0');
    });
    applyRecipientToLegacy(state.settings.activeRecipientId, false);
    if (window.setRecipientName) {
      setRecipientName.value = state.settings.recipientName || '';
      setRecipientQualification.value = state.settings.recipientQualification || '';
      setRecipientAddress.value = state.settings.recipientAddress || '';
      setRecipientEmail.value = state.settings.recipientEmail || '';
    }
  });
  invNumber.value = invoiceRecord()?.number || defaultInvoiceNumber(invYear.value, invMonth.value);
  OrdiPilotBoot.add('v611:8', () => {
    renderRecipientManager();
    renderEntries();
    renderParking();
    renderInvoice();
    saveState(false);
  });
})();
