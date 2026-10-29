/* OrdiPilot V6.12 · Empfängerspezifische Honorarnoten-Texte (vormals v6113-hotfix.js, jetzt fest eingebaut). */
(function () {
  'use strict';
  const VERSION = '7.2.0';
  const DEFAULT_ROLE = 'Ordinationsinhaberin';
  const DEFAULT_SERVICE = 'Ärztliche Vertretungstätigkeit';

  function recipientList() {
    const s = state.settings || (state.settings = {});
    const fallback = {
      serviceDescription: s.serviceDescription || DEFAULT_SERVICE,
      salutation: s.salutation || '',
      signoffName: s.signoffName || '',
      roleLabel: s.roleLabel || DEFAULT_ROLE,
    };
    let arr = Array.isArray(s.recipients) ? s.recipients : [];
    if (!arr.length) {
      arr = [
        {
          id: 'recipient-primary',
          name: s.recipientName || '',
          qualification: s.recipientQualification || '',
          address: s.recipientAddress || '',
          email: s.recipientEmail || '',
          ...fallback,
        },
      ];
    }
    arr = arr.map((r, i) => ({
      ...r,
      id: String(r?.id || `recipient-${Date.now().toString(36)}-${i}`),
      name: String(r?.name || ''),
      qualification: String(r?.qualification || ''),
      address: String(r?.address || ''),
      email: String(r?.email || ''),
      serviceDescription: String(r?.serviceDescription ?? fallback.serviceDescription ?? DEFAULT_SERVICE),
      salutation: String(r?.salutation ?? fallback.salutation ?? ''),
      signoffName: String(r?.signoffName ?? fallback.signoffName ?? ''),
      roleLabel: String(r?.roleLabel || DEFAULT_ROLE),
    }));
    s.recipients = arr;
    if (!s.activeRecipientId || !arr.some(r => r.id === s.activeRecipientId)) s.activeRecipientId = arr[0].id;
    const primary = arr[0];
    for (const e of state.entries || []) if (!e.recipientId) e.recipientId = primary.id;
    return arr;
  }
  function activeRecipient() {
    const arr = recipientList(),
      id = state.settings.activeRecipientId;
    return arr.find(r => r.id === id) || arr[0];
  }
  function applyRecipientToLegacy() {
    const r = activeRecipient(),
      s = state.settings;
    if (!r) return;
    s.activeRecipientId = r.id;
    s.recipientName = r.name || '';
    s.recipientQualification = r.qualification || '';
    s.recipientAddress = r.address || '';
    s.recipientEmail = r.email || '';
    s.serviceDescription = r.serviceDescription || DEFAULT_SERVICE;
    s.salutation = r.salutation || '';
    s.signoffName = r.signoffName || '';
    s.roleLabel = r.roleLabel || DEFAULT_ROLE;
  }
  function syncRecipientFields() {
    applyRecipientToLegacy();
    const r = activeRecipient();
    if (window.setRecipientName) setRecipientName.value = r.name || '';
    if (window.setRecipientQualification) setRecipientQualification.value = r.qualification || '';
    if (window.setRecipientAddress) setRecipientAddress.value = r.address || '';
    if (window.setRecipientEmail) setRecipientEmail.value = r.email || '';
    if (window.setService) setService.value = r.serviceDescription || DEFAULT_SERVICE;
    if (window.setSalutation) setSalutation.value = r.salutation || '';
    if (window.setSignoffName) setSignoffName.value = r.signoffName || '';
    const role = document.getElementById('setRecipientRole');
    if (role) role.value = r.roleLabel || DEFAULT_ROLE;
  }
  function saveRecipientFields() {
    const r = activeRecipient();
    if (!r) return;
    if (window.setRecipientName) r.name = setRecipientName.value.trim();
    if (window.setRecipientQualification) r.qualification = setRecipientQualification.value.trim();
    if (window.setRecipientAddress) r.address = setRecipientAddress.value.trim();
    if (window.setRecipientEmail) r.email = setRecipientEmail.value.trim();
    if (window.setService) r.serviceDescription = setService.value.trim() || DEFAULT_SERVICE;
    if (window.setSalutation) r.salutation = setSalutation.value.trim();
    if (window.setSignoffName) r.signoffName = setSignoffName.value.trim();
    const role = document.getElementById('setRecipientRole');
    if (role) r.roleLabel = role.value.trim() || DEFAULT_ROLE;
    state.settings._updatedAt = new Date().toISOString();
    applyRecipientToLegacy();
    saveState(false);
  }
  function moveRecipientInvoiceFields() {
    const recipientName = document.getElementById('setRecipientName');
    if (!recipientName) return;
    const card = recipientName.closest('.card');
    const grid = recipientName.closest('.formgrid');
    if (!card || !grid) return;
    if (!document.getElementById('setRecipientRole')) {
      const tpl = document.getElementById('setService')?.closest('.field');
      if (tpl) {
        const f = tpl.cloneNode(true),
          inp = f.querySelector('input');
        inp.id = 'setRecipientRole';
        inp.value = '';
        f.querySelectorAll('.v6113-field-help').forEach(x => x.remove());
        tpl.parentNode.insertBefore(f, tpl);
      }
    }
    const defs = [
      [
        'setRecipientRole',
        'Rolle auf Honorarnote',
        'z. B. Ordinationsinhaberin / Ordinationsinhaber',
        'Überschrift über dem Empfänger auf der Honorarnote.',
      ],
      [
        'setService',
        'Leistungsbezeichnung',
        'z. B. Ärztliche Vertretungstätigkeit',
        'Wird für diesen Rechnungsempfänger auf der Honorarnote verwendet.',
      ],
      [
        'setSalutation',
        'Anrede auf Honorarnote',
        'z. B. Sehr geehrte Frau Dr. …',
        'Individuell pro Rechnungsempfänger.',
      ],
      ['setSignoffName', 'Name unter Grußformel', 'z. B. Dr. Raouf Mehrabi', 'Individuell pro Rechnungsempfänger.'],
    ];
    for (const [id, label, placeholder, help] of defs) {
      const input = document.getElementById(id);
      if (!input) continue;
      const field = input.closest('.field');
      if (!field) continue;
      const lab = field.querySelector('label');
      if (lab) lab.textContent = label;
      input.placeholder = placeholder;
      let h = field.querySelector('.v6113-field-help');
      if (!h) {
        h = document.createElement('div');
        h.className = 'help v6113-field-help';
        field.appendChild(h);
      }
      h.textContent = help;
      grid.appendChild(field);
    }
    const menu = document.getElementById('v611SettingsMenu');
    if (menu) {
      for (const row of menu.querySelectorAll('.v611-settings-row')) {
        const title = row.querySelector('strong')?.textContent.trim();
        const small = row.querySelector('small');
        if (title === 'Abrechnung' && small) small.textContent = 'Stundensatz, Rücklage und steuerliche Hinweise';
        if (title === 'Rechnungsempfänger' && small)
          small.textContent = 'Empfänger, Anrede und Honorarnoten-Texte verwalten';
      }
    }
  }

  OrdiPilotBoot.add('v612-recipients:1', () => {
    recipientList();
    applyRecipientToLegacy();
    moveRecipientInvoiceFields();
    syncRecipientFields();

    [
      'setRecipientName',
      'setRecipientQualification',
      'setRecipientAddress',
      'setRecipientEmail',
      'setService',
      'setSalutation',
      'setSignoffName',
      'setRecipientRole',
    ].forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.dataset.v6113Bound) return;
      el.dataset.v6113Bound = '1';
      el.addEventListener('change', () => {
        saveRecipientFields();
        try {
          renderInvoice();
        } catch (_) {}
      });
    });
    document.addEventListener(
      'click',
      ev => {
        if (ev.target.closest('[data-v611-recipient],[data-v611-invoice-recipient],#v611AddRecipient')) {
          setTimeout(() => {
            recipientList();
            applyRecipientToLegacy();
            syncRecipientFields();
            try {
              renderInvoice();
            } catch (_) {}
          }, 0);
        }
      },
      false
    );
  });

  OrdiPilotExt.extend(
    'loadSettingsForm',
    baseLoadSettings =>
      function () {
        const out = baseLoadSettings.apply(this, arguments);
        recipientList();
        moveRecipientInvoiceFields();
        syncRecipientFields();
        return out;
      }
  );

  window.renderInvoiceBase = function () {
    applyRecipientToLegacy();
    const y = invYear.value || String(state.settings.year),
      m = invMonth.value || '01',
      es = currentInvoiceEntries(),
      s = state.settings,
      total = es.reduce((a, e) => a + gross(e), 0),
      hrs = es.reduce((a, e) => a + entryHours(e), 0);
    invoiceWarning.style.display =
      !s.issuerQualification || !s.issuerAddress || !s.recipientAddress || !s.iban ? 'block' : 'none';
    invoiceWarning.textContent =
      'Für das Vorlagen-Layout bitte Rechnungsdaten, Empfänger und IBAN vollständig hinterlegen.';
    const recipientLines = (s.recipientAddress || '').split('\n').filter(Boolean),
      issuerLines = (s.issuerAddress || '').split('\n').filter(Boolean),
      service = s.serviceDescription || 'ärztliche Vertretungstätigkeit';
    invoicePreview.innerHTML = `<div class="hn-title">Honorarnote für ${escapeHtml(service)}</div><div class="hn-number">Honorarnote Nummer: ${escapeHtml(invNumber.value || defaultInvoiceNumber(y, m))}</div><div class="hn-date">Wien, ${dateAT(invDate.value)}</div><hr class="hn-rule"><div class="hn-section-title">${escapeHtml(s.roleLabel || DEFAULT_ROLE)}:</div><div class="hn-name">${escapeHtml(s.recipientName || '')}</div>${s.recipientQualification ? `<div class="hn-qualification">${escapeHtml(s.recipientQualification)}</div>` : ''}${recipientLines.map(line => `<div class="hn-address-line">${escapeHtml(line)}</div>`).join('')}<div class="hn-block-gap"></div><div class="hn-section-title">Vertretender Arzt:</div><div class="hn-name">${escapeHtml(s.issuerName || '')}</div>${s.issuerQualification ? `<div class="hn-qualification">${escapeHtml(s.issuerQualification)}</div>` : ''}${issuerLines.map(line => `<div class="hn-address-line">${escapeHtml(line)}</div>`).join('')}<div class="hn-iban">IBAN: ${escapeHtml(s.iban || '')}</div><hr class="hn-rule"><div class="hn-body"><p>${escapeHtml(s.salutation || '')}</p><p class="hn-intro">Anbei übermittle ich die monatliche Honorarnote für ${escapeHtml(service)}<br>für den Monat <strong>${MONTHS[Number(m) - 1]} ${y}</strong>.</p><div class="hn-summary"><div>-</div><div>Leistungszeitraum:</div><div>${escapeHtml(modelPeriod(y, m))}</div><div>-</div><div>Gesamtstunden:</div><div>${escapeHtml(invoiceRateText(es, hrs))}</div><div class="spacer"></div><div>-</div><div>Gesamthonorar:</div><div>${escapeHtml(modelMoney(total))}</div></div><div class="hn-legal"><p>${escapeHtml(s.taxNote || '')}</p><p>${escapeHtml(s.paymentText || '')}</p></div><div class="hn-signoff"><div>Mit freundlichen Grüßen,</div><div>${escapeHtml(s.signoffName || '')}</div></div></div>`;
  };

  window.createInvoicePdfBlob = async function () {
    applyRecipientToLegacy();
    const es = currentInvoiceEntries();
    if (!es.length) throw new Error('NO_ENTRIES');
    const s = state.settings,
      y = invYear.value,
      m = invMonth.value,
      num = invNumber.value || defaultInvoiceNumber(y, m),
      total = es.reduce((a, e) => a + gross(e), 0),
      hrs = es.reduce((a, e) => a + entryHours(e), 0),
      recipientLines = (s.recipientAddress || '').split('\n').filter(Boolean),
      issuerLines = (s.issuerAddress || '').split('\n').filter(Boolean);
    if (!window.PDFLib || !window.fontkit) throw new Error('FONT_ENGINE_UNAVAILABLE');
    const { PDFDocument, rgb } = PDFLib,
      pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const base = 'https://cdn.jsdelivr.net/fontsource/fonts/carlito@5.3.0/';
    const [regBytes, boldBytes] = await Promise.all([
      fetch(base + 'latin-400-normal.ttf').then(r => {
        if (!r.ok) throw new Error('FONT_LOAD');
        return r.arrayBuffer();
      }),
      fetch(base + 'latin-700-normal.ttf').then(r => {
        if (!r.ok) throw new Error('FONT_LOAD');
        return r.arrayBuffer();
      }),
    ]);
    const reg = await pdf.embedFont(regBytes, { subset: true }),
      bold = await pdf.embedFont(boldBytes, { subset: true }),
      page = pdf.addPage([595.28, 841.89]),
      black = rgb(0, 0, 0);
    const draw = (x, y, size, text, isBold = false) =>
      page.drawText(String(text ?? ''), { x, y, size, font: isBold ? bold : reg, color: black });
    const right = (y, size, text, rightX = 523, isBold = false) => {
      const f = isBold ? bold : reg;
      draw(rightX - f.widthOfTextAtSize(String(text), size), y, size, text, isBold);
    };
    const line = (x1, y1, x2, y2, w = 0.6) =>
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color: black });
    const wrap = (text, size, maxWidth, isBold = false) => {
      const f = isBold ? bold : reg,
        words = String(text || '')
          .trim()
          .split(/\s+/)
          .filter(Boolean),
        out = [];
      let cur = '';
      for (const word of words) {
        const t = cur ? cur + ' ' + word : word;
        if (!cur || f.widthOfTextAtSize(t, size) <= maxWidth) cur = t;
        else {
          out.push(cur);
          cur = word;
        }
      }
      if (cur) out.push(cur);
      return out;
    };
    const service = (s.serviceDescription || 'ärztliche Vertretungstätigkeit').trim(),
      title = `Honorarnote für ${service}`,
      titleSize = Math.max(11.5, Math.min(16, 16 * (451 / Math.max(451, bold.widthOfTextAtSize(title, 16)))));
    draw((595.28 - bold.widthOfTextAtSize(title, titleSize)) / 2, 754, titleSize, title, true);
    const ntext = `Honorarnote Nummer: ${num}`;
    draw((595.28 - bold.widthOfTextAtSize(ntext, 12)) / 2, 728, 12, ntext, true);
    right(705, 12, `Wien, ${dateAT(invDate.value)}`, 523, true);
    line(72, 700, 523, 700, 0.6);
    draw(72, 678, 14, `${s.roleLabel || DEFAULT_ROLE}:`, true);
    draw(72, 653, 12, s.recipientName || '', true);
    let yr = 631;
    if (s.recipientQualification) {
      draw(72, yr, 11.7, s.recipientQualification);
      yr -= 20;
    }
    recipientLines.forEach(t => {
      draw(72, yr, 11.7, t);
      yr -= 18;
    });
    draw(72, 555, 14, 'Vertretender Arzt:', true);
    draw(72, 531, 12, s.issuerName || '', true);
    let yi = 509;
    if (s.issuerQualification) {
      draw(72, yi, 11.7, s.issuerQualification);
      yi -= 20;
    }
    issuerLines.forEach(t => {
      draw(72, yi, 11.7, t);
      yi -= 18;
    });
    draw(72, 460, 12, `IBAN: ${s.iban || ''}`, true);
    line(72, 455, 523, 455, 0.6);
    draw(72, 411, 11.7, s.salutation || '');
    const introLines = wrap(`Anbei übermittle ich die monatliche Honorarnote für ${service}`, 11.7, 451);
    introLines.slice(0, 2).forEach((t, i) => draw(72, 388 - i * 17, 11.7, t));
    const monthY = 371 - Math.max(0, Math.min(2, introLines.length) - 1) * 17;
    draw(72, monthY, 11.7, 'für den Monat ');
    const monthLabel = `${MONTHS[Number(m) - 1]} ${y}`,
      monthX = 72 + reg.widthOfTextAtSize('für den Monat ', 11.7);
    draw(monthX, monthY, 11.7, monthLabel, true);
    draw(monthX + bold.widthOfTextAtSize(monthLabel, 11.7), monthY, 11.7, '.');
    draw(90, 324, 11.7, '-');
    draw(108, 324, 11.7, 'Leistungszeitraum:', true);
    draw(216, 324, 11.7, modelPeriod(y, m), true);
    draw(90, 308, 11.7, '-');
    draw(108, 308, 11.7, 'Gesamtstunden:', true);
    draw(216, 308, 11.7, invoiceRateText(es, hrs), true);
    draw(90, 276, 11.7, '-');
    draw(108, 276, 11.7, 'Gesamthonorar:', true);
    draw(216, 276, 11.7, modelMoney(total), true);
    let yy = 229;
    for (const t of wrap(s.taxNote || '', 11.7, 451)) {
      draw(72, yy, 11.7, t);
      yy -= 17;
    }
    yy -= 7;
    for (const t of wrap(s.paymentText || '', 11.7, 451)) {
      draw(72, yy, 11.7, t);
      yy -= 17;
    }
    draw(72, 118, 11.7, 'Mit freundlichen Grüßen,');
    draw(72, 94, 11.7, s.signoffName || '');
    return new Blob([await pdf.save()], { type: 'application/pdf' });
  };

  window.invoiceSnapshotV63 = function () {
    applyRecipientToLegacy();
    const es = currentInvoiceEntries(),
      entries = es.map(e => ({
        id: e.id,
        date: e.date,
        start: e.start || '',
        end: e.end || '',
        breakMinutes: Number(e.breakMinutes || 0),
        manualHours: e.manualHours === null ? null : Number(e.manualHours),
        rateCents: Math.round(Number(e.rate || 0) * 100),
        grossCents: grossCentsV63(e),
        confirmedAt: e.confirmedAt || '',
        updatedAt: e.updatedAt || '',
      })),
      s = state.settings,
      r = activeRecipient(),
      invoiceSettings = {
        issuerName: s.issuerName || '',
        issuerQualification: s.issuerQualification || '',
        issuerAddress: s.issuerAddress || '',
        recipientId: r?.id || '',
        recipientName: s.recipientName || '',
        recipientQualification: s.recipientQualification || '',
        recipientAddress: s.recipientAddress || '',
        iban: s.iban || '',
        serviceDescription: r?.serviceDescription || s.serviceDescription || '',
        salutation: r?.salutation || s.salutation || '',
        signoffName: r?.signoffName || s.signoffName || '',
        taxNote: s.taxNote || '',
        paymentText: s.paymentText || '',
        invoiceNumber: invNumber.value || '',
        invoiceDate: invDate.value || '',
      };
    return {
      version: 2,
      entries,
      totalCents: entries.reduce((sum, e) => sum + (e.grossCents || 0), 0),
      hoursHundredths: Math.round(es.reduce((sum, e) => sum + (entryHours(e) || 0), 0) * 100),
      invoiceSettings,
    };
  };
  window.invoiceSnapshotHashV63 = function () {
    return JSON.stringify(invoiceSnapshotV63());
  };

  window.shareSignedInvoice = async function () {
    applyRecipientToLegacy();
    const rec = invoiceRecord();
    if (!rec?.signedAt) {
      alert('Bitte zuerst die signierte PDF übernehmen.');
      return;
    }
    const blob = await getInvoiceBlob(`signed:${rec.key}`);
    if (!blob) {
      alert('Die signierte PDF ist auf diesem Gerät nicht mehr vorhanden.');
      return;
    }
    const r = activeRecipient(),
      to = r.email || '',
      subject = `Honorarnote ${MONTHS[Number(rec.month) - 1]} ${rec.year} – Dr. Raouf Mehrabi`,
      body = `Guten Tag,\n\nanbei übermittle ich meine Honorarnote für ${r.serviceDescription || 'ärztliche Vertretungstätigkeit'} im ${MONTHS[Number(rec.month) - 1]} ${rec.year}.\n\nMit freundlichen Grüßen\n${r.signoffName || state.settings.issuerName || 'Dr. Raouf Mehrabi'}`,
      file = new File([blob], rec.filename || invoiceFilename(), { type: 'application/pdf' }),
      shortcut = (state.settings.invoiceMailShortcut || '').trim();
    if (isIOSDevice() && shortcut && rec.signedDropboxPath && isDropboxConnected()) {
      try {
        const fileUrl = await dropboxTemporaryLink(rec.signedDropboxPath),
          payload = { to, subject, body, fileUrl, fileName: file.name, invoiceKey: rec.key };
        upsertInvoiceRecord({ key: rec.key, mailOpenedAt: nowISO() });
        renderInvoice();
        window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(shortcut)}&input=text&text=${encodeURIComponent(JSON.stringify(payload))}`;
        return;
      } catch (err) {
        console.warn(err);
      }
    }
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      try {
        await navigator.share({ files: [file], title: subject, text: to ? `Empfänger: ${to}\n\n${body}` : body });
        upsertInvoiceRecord({ key: rec.key, mailOpenedAt: nowISO() });
        renderInvoice();
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    await downloadBlob(blob, file.name);
    upsertInvoiceRecord({ key: rec.key, mailOpenedAt: nowISO() });
    renderInvoice();
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n\nDie signierte PDF wurde auf das Gerät geladen und kann angehängt werden.')}`;
  };
  OrdiPilotBoot.add('v612-recipients:2', () => {
    if (window.invoiceSendMail) invoiceSendMail.onclick = shareSignedInvoice;
  });

  OrdiPilotExt.extend(
    'renderInvoice',
    baseRenderInvoice =>
      function () {
        applyRecipientToLegacy();
        return baseRenderInvoice.apply(this, arguments);
      }
  );

  window.ordipilotRoleLabel = () => activeRecipient()?.roleLabel || DEFAULT_ROLE;
  // Nach jedem Cloud-Merge Empfängerfelder normalisieren (wird vom Sync-Kern aufgerufen).
  OrdiPilotBoot.add('v612-recipients:3', () => {
    (window.ordipilotSyncHooks = window.ordipilotSyncHooks || []).push(() => {
      recipientList();
      applyRecipientToLegacy();
    });

    document.querySelectorAll('.footer-note').forEach(el => {
      if (/Version/i.test(el.textContent))
        el.textContent = el.textContent.replace(/Version\s*[0-9.]+/i, `Version ${VERSION}`);
    });
  });
  document.documentElement.dataset.ordipilotVersion = VERSION;
  OrdiPilotBoot.add('v612-recipients:4', () => {
    try {
      renderInvoice();
    } catch (_) {}
    saveState(false);
  });
})();
