// OrdiPilot V6.8 – Schnellplanung + konsistente Honorarnotenablage
(function () {
  // Alte versehentlich erzeugte Ablage nicht weiterverwenden.
  OrdiPilotBoot.add('v68:1', () => {
    if (!state.settings.invoiceDropboxBase || /\/02 Honorarnoten\/?$/.test(state.settings.invoiceDropboxBase)) {
      state.settings.invoiceDropboxBase = '/Ordination & Selbständigkeit/Vertretungsdienste/Honorarnoten';
      state.settings._updatedAt = nowISO();
      saveState(false);
    }
    if (window.setInvoiceDropboxBase) {
      setInvoiceDropboxBase.value = '/Ordination & Selbständigkeit/Vertretungsdienste/Honorarnoten';
      setInvoiceDropboxBase.readOnly = true;
    }
  });

  function v68Month(v) {
    return String(v).padStart(2, '0');
  }
  function v68FinalInvoiceName(y, m) {
    return window.ordipilotInvoiceFilename
      ? window.ordipilotInvoiceFilename(y, m)
      : `${y}-${v68Month(m)}_Honorarnote_Vakil-Adli.pdf`;
  }

  OrdiPilotExt.extend(
    'renderInvoiceWorkflow',
    oldWorkflow =>
      function () {
        oldWorkflow();
        if (window.invoiceFileHint) {
          const y = invYear.value,
            m = invMonth.value;
          invoiceFileHint.textContent = `Datei: ${v68FinalInvoiceName(y, m)} · Archiv: Honorarnoten/${y}`;
        }
      }
  );

  // Multi-Day planner – V6.11: intelligente Einzelauswahl / Mehrfachauswahl, Notiz je Tag
  let qpCursor = new Date(),
    qpSelected = new Set(),
    qpPreset =
      localStorage.getItem('ordipilot-v610-preset') || localStorage.getItem('ordipilot-v68-preset') || 'morning',
    qpTimes = new Map(),
    qpNotes = new Map(),
    qpRecipients = new Map();
  function qpISO(d) {
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }
  function qpSetCursor(iso) {
    const d = new Date((iso || todayISO()) + 'T12:00:00');
    qpCursor = new Date(d.getFullYear(), d.getMonth(), 1, 12);
  }
  function qpDefs() {
    return timePresetDefinitions();
  }
  function qpDefaultTime() {
    const defs = qpDefs(),
      d = defs[qpPreset] || defs.morning;
    return { start: d[0], end: d[1] };
  }
  function qpEnsureTime(iso) {
    if (!qpTimes.has(iso)) qpTimes.set(iso, qpDefaultTime());
    return qpTimes.get(iso);
  }
  function qpRecipientsList() {
    const arr = Array.isArray(state.settings?.recipients) ? state.settings.recipients : [];
    return arr.length
      ? arr
      : [{ id: 'recipient-primary', name: state.settings?.recipientName || 'Rechnungsempfänger' }];
  }
  function qpDefaultRecipient() {
    const arr = qpRecipientsList(),
      active = state.settings?.activeRecipientId;
    return arr.some(r => r.id === active) ? active : arr[0].id;
  }
  function qpEnsureRecipient(iso) {
    if (!qpRecipients.has(iso)) qpRecipients.set(iso, qpDefaultRecipient());
    return qpRecipients.get(iso);
  }
  function qpEnsureNote(iso) {
    if (!qpNotes.has(iso)) qpNotes.set(iso, '');
    return qpNotes.get(iso);
  }
  function qpPresetName(t) {
    const defs = qpDefs();
    for (const [name, d] of Object.entries(defs)) if (t && t.start === d[0] && t.end === d[1]) return name;
    return '';
  }
  function qpApplyPreset(name, dates = null) {
    const d = qpDefs()[name];
    if (!d) return;
    qpPreset = name;
    localStorage.setItem('ordipilot-v610-preset', name);
    localStorage.setItem('ordipilot-v68-preset', name);
    const target = dates || [...qpSelected];
    target.forEach(iso => qpTimes.set(iso, { start: d[0], end: d[1] }));
    qpUpdatePresetUI();
    qpRenderTimes();
  }
  function qpUpdatePresetUI() {
    const defs = qpDefs(),
      arr = [...qpSelected],
      single = arr.length === 1;
    v68PresetBar.style.display = single ? 'grid' : 'none';
    if (window.v610BulkLabel) v610BulkLabel.style.display = single ? 'block' : 'none';
    v68PresetBar.querySelectorAll('[data-v68-preset]').forEach(b => {
      const d = defs[b.dataset.v68Preset];
      b.classList.toggle(
        'active',
        single &&
          arr.every(iso => {
            const t = qpEnsureTime(iso);
            return t.start === d[0] && t.end === d[1];
          })
      );
    });
    v68MorningText.textContent = `${defs.morning[0]}–${defs.morning[1]}`;
    v68AfternoonText.textContent = `${defs.afternoon[0]}–${defs.afternoon[1]}`;
    v68FullDayText.textContent = `${defs.fullday[0]}–${defs.fullday[1]}`;
  }
  function qpHumanDay(iso) {
    const d = new Date(iso + 'T12:00:00'),
      wd = new Intl.DateTimeFormat('de-AT', { weekday: 'long' }).format(d);
    return { main: `${wd}, ${dateAT(iso)}`, sub: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
  }
  function qpRenderTimes() {
    const root = document.getElementById('v610DayTimes'),
      arr = [...qpSelected].sort();
    if (!root) return;
    if (!arr.length) {
      root.innerHTML = '<div class="v610-empty">Wähle oben zuerst einen oder mehrere Tage.</div>';
      qpUpdatePresetUI();
      return;
    }
    const recipients = qpRecipientsList(),
      showRecipient = recipients.length > 1;
    root.innerHTML = arr
      .map(iso => {
        const t = qpEnsureTime(iso),
          h = qpHumanDay(iso),
          active = qpPresetName(t),
          note = qpEnsureNote(iso),
          rid = qpEnsureRecipient(iso),
          recipientSelect = showRecipient
            ? `<label class="v611-recipient-inline">Rechnungsempfänger<select data-v611-recipient-date="${iso}">${recipients.map(r => `<option value="${escapeHtml(r.id)}" ${r.id === rid ? 'selected' : ''}>${escapeHtml(r.name || 'Empfänger')}</option>`).join('')}</select></label>`
            : '';
        return `<div class="v610-day-card v611-day-card" data-v610-card="${iso}"><div class="v610-day-head"><div class="v610-day-date">${escapeHtml(h.main)}<small>${escapeHtml(h.sub)}</small></div><button type="button" class="v610-day-remove" data-v610-remove="${iso}" aria-label="Tag entfernen">×</button></div>${recipientSelect}${arr.length > 1 ? `<div class="v610-row-presets"><button type="button" class="v610-row-preset ${active === 'morning' ? 'active' : ''}" data-v610-date="${iso}" data-v610-preset="morning">Vormittag</button><button type="button" class="v610-row-preset ${active === 'afternoon' ? 'active' : ''}" data-v610-date="${iso}" data-v610-preset="afternoon">Nachmittag</button><button type="button" class="v610-row-preset ${active === 'fullday' ? 'active' : ''}" data-v610-date="${iso}" data-v610-preset="fullday">Ganztags</button></div>` : ''}<div class="v610-row-times"><div><label>Beginn</label><input type="time" step="300" value="${escapeHtml(t.start)}" data-v610-time-date="${iso}" data-v610-field="start"></div><div><label>Ende</label><input type="time" step="300" value="${escapeHtml(t.end)}" data-v610-time-date="${iso}" data-v610-field="end"></div></div><div class="v611-note-row ${note ? 'show' : ''}" data-v611-note-row="${iso}"><input type="text" value="${escapeHtml(note)}" data-v611-note-date="${iso}" placeholder="Bemerkung zu diesem Einsatz"><button type="button" class="v611-note-plus" data-v611-note-toggle="${iso}" aria-label="Bemerkung hinzufügen">${note ? '−' : '+'}</button></div></div>`;
      })
      .join('');
    root
      .querySelectorAll('[data-v610-preset]')
      .forEach(b => (b.onclick = () => qpApplyPreset(b.dataset.v610Preset, [b.dataset.v610Date])));
    root.querySelectorAll('[data-v610-remove]').forEach(
      b =>
        (b.onclick = () => {
          const iso = b.dataset.v610Remove;
          qpSelected.delete(iso);
          qpTimes.delete(iso);
          qpNotes.delete(iso);
          qpRecipients.delete(iso);
          qpRender();
          qpSummary();
        })
    );
    root.querySelectorAll('[data-v610-time-date]').forEach(inp =>
      inp.addEventListener('change', () => {
        const iso = inp.dataset.v610TimeDate,
          t = qpEnsureTime(iso);
        t[inp.dataset.v610Field] = inp.value;
        qpTimes.set(iso, t);
        qpRenderTimes();
        qpUpdatePresetUI();
      })
    );
    root.querySelectorAll('[data-v611-note-toggle]').forEach(
      b =>
        (b.onclick = () => {
          const iso = b.dataset.v611NoteToggle,
            row = root.querySelector(`[data-v611-note-row="${iso}"]`),
            input = row?.querySelector('input');
          row?.classList.toggle('show');
          if (row?.classList.contains('show')) {
            b.textContent = '−';
            setTimeout(() => input?.focus(), 20);
          } else if (!input?.value) {
            b.textContent = '+';
          }
        })
    );
    root
      .querySelectorAll('[data-v611-note-date]')
      .forEach(inp => inp.addEventListener('input', () => qpNotes.set(inp.dataset.v611NoteDate, inp.value)));
    root
      .querySelectorAll('[data-v611-recipient-date]')
      .forEach(sel => sel.addEventListener('change', () => qpRecipients.set(sel.dataset.v611RecipientDate, sel.value)));
    qpUpdatePresetUI();
  }
  function qpSummary() {
    const arr = [...qpSelected].sort(),
      n = arr.length;
    if (!n) {
      v68SelectedSummary.innerHTML = '<strong>Noch kein Tag gewählt.</strong>';
      v68PlanSave.textContent = 'Einsätze eintragen';
      qpRenderTimes();
      return;
    }
    const show = arr
        .slice(0, 5)
        .map(x => dateAT(x))
        .join(' · '),
      more = n > 5 ? ` · +${n - 5} weitere` : '';
    v68SelectedSummary.innerHTML = `<strong>${n} ${n === 1 ? 'Tag' : 'Tage'} gewählt</strong><br>${show}${more}`;
    v68PlanSave.textContent = n === 1 ? '1 Einsatz eintragen' : `${n} Einsätze eintragen`;
    qpRenderTimes();
  }
  function qpToggleDate(iso) {
    if (qpSelected.has(iso)) {
      qpSelected.delete(iso);
      qpTimes.delete(iso);
      qpNotes.delete(iso);
      qpRecipients.delete(iso);
    } else {
      qpSelected.add(iso);
      qpEnsureTime(iso);
      qpEnsureNote(iso);
      qpEnsureRecipient(iso);
    }
  }
  function qpRender() {
    const y = qpCursor.getFullYear(),
      m = qpCursor.getMonth();
    v68PlanMonthTitle.textContent = `${MONTHS[m]} ${y}`;
    const first = new Date(y, m, 1, 12),
      start = new Date(y, m, 1 - ((first.getDay() + 6) % 7), 12);
    let html = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = qpISO(d),
        inMonth = d.getMonth() === m,
        existing = entriesOnDate(iso).length > 0,
        selected = qpSelected.has(iso),
        cls = [
          'v68-day',
          inMonth ? '' : 'out',
          iso === todayISO() ? 'today' : '',
          selected ? 'selected' : '',
          existing ? 'has-existing' : '',
        ]
          .filter(Boolean)
          .join(' ');
      html += `<button type="button" class="${cls}" data-v68-date="${iso}" ${existing ? 'disabled' : ''}>${d.getDate()}</button>`;
    }
    v68PlanGrid.innerHTML = html;
    v68PlanGrid.querySelectorAll('[data-v68-date]:not(:disabled)').forEach(
      b =>
        (b.onclick = () => {
          qpToggleDate(b.dataset.v68Date);
          qpRender();
          qpSummary();
        })
    );
    qpSummary();
  }
  function qpSelectWeekday(jsDay) {
    const y = qpCursor.getFullYear(),
      m = qpCursor.getMonth(),
      days = new Date(y, m + 1, 0).getDate();
    let candidates = [];
    for (let d = 1; d <= days; d++) {
      const dt = new Date(y, m, d, 12),
        iso = qpISO(dt);
      if (dt.getDay() === jsDay && !entriesOnDate(iso).length) candidates.push(iso);
    }
    const allOn = candidates.length && candidates.every(x => qpSelected.has(x));
    candidates.forEach(iso => {
      if (allOn) {
        qpSelected.delete(iso);
        qpTimes.delete(iso);
        qpNotes.delete(iso);
        qpRecipients.delete(iso);
      } else {
        qpSelected.add(iso);
        qpEnsureTime(iso);
        qpEnsureNote(iso);
        qpEnsureRecipient(iso);
      }
    });
    qpRender();
    qpSummary();
  }
  function openQuickPlanner(preferredDate = null) {
    qpSelected = new Set();
    qpTimes = new Map();
    qpNotes = new Map();
    qpRecipients = new Map();
    qpSetCursor(preferredDate || todayISO());
    if (preferredDate && !entriesOnDate(preferredDate).length) {
      qpSelected.add(preferredDate);
      qpEnsureTime(preferredDate);
      qpEnsureNote(preferredDate);
      qpEnsureRecipient(preferredDate);
    }
    v68Note.value = '';
    qpUpdatePresetUI();
    qpRender();
    qpSummary();
    if (!v68PlanDialog.open) v68PlanDialog.showModal();
  }
  window.openQuickPlanner = openQuickPlanner;
  v68PlanPrev.onclick = () => {
    qpCursor = new Date(qpCursor.getFullYear(), qpCursor.getMonth() - 1, 1, 12);
    qpRender();
  };
  v68PlanNext.onclick = () => {
    qpCursor = new Date(qpCursor.getFullYear(), qpCursor.getMonth() + 1, 1, 12);
    qpRender();
  };
  v68PlanToday.onclick = () => {
    qpSetCursor(todayISO());
    qpRender();
  };
  v68PlanClose.onclick = v68PlanCancel.onclick = () => v68PlanDialog.close();
  OrdiPilotBoot.add('v68:2', () => {
    v68PresetBar
      .querySelectorAll('[data-v68-preset]')
      .forEach(b => (b.onclick = () => qpApplyPreset(b.dataset.v68Preset)));
    v68WeekdayPicks
      .querySelectorAll('[data-v68-weekday]')
      .forEach(b => (b.onclick = () => qpSelectWeekday(Number(b.dataset.v68Weekday))));
  });
  v68PlanSave.onclick = () => {
    const dates = [...qpSelected].sort();
    if (!dates.length) {
      alert('Bitte mindestens einen Arbeitstag auswählen.');
      return;
    }
    for (const date of dates) {
      const t = qpEnsureTime(date),
        a = timeMinutes(t.start),
        b = timeMinutes(t.end);
      if (!t.start || !t.end || a === null || b === null || a === b) {
        alert(`Bitte für ${dateAT(date)} eine gültige Beginn- und Endzeit wählen.`);
        return;
      }
      const rid = qpEnsureRecipient(date);
      if (window.ordipilotRecipientMonthLocked && ordipilotRecipientMonthLocked(date.slice(0, 7), rid)) {
        alert(`Für ${dateAT(date)} ist die Honorarnote dieses Rechnungsempfängers bereits abgeschlossen.`);
        return;
      }
    }
    const rate = Number(state.settings.defaultRate || 170),
      created = [];
    for (const date of dates) {
      if (entriesOnDate(date).length) continue;
      const t = qpEnsureTime(date),
        obj = {
          id: uuid(),
          date,
          plannedStart: t.start,
          plannedEnd: t.end,
          start: '',
          end: '',
          breakMinutes: 0,
          manualHours: null,
          rate,
          note: (qpNotes.get(date) || '').trim(),
          recipientId: qpEnsureRecipient(date),
          planningOnly: true,
          confirmedAt: null,
          source: 'App',
          updatedAt: nowISO(),
        };
      state.entries.push(obj);
      created.push(obj);
    }
    if (!created.length) {
      alert('Für die ausgewählten Tage sind bereits Einsätze vorhanden.');
      return;
    }
    saveState();
    v68PlanDialog.close();
    refreshAll();
    if (created.length === 1 && state.settings.calendarAutoSync !== false)
      runIOSCalendarShortcut(created[0], 'upsert', false);
    else if (created.length > 1)
      setTimeout(
        () => alert(`${created.length} Einsätze wurden mit ihren jeweiligen Uhrzeiten und Bemerkungen geplant.`),
        120
      );
  };
  if (window.addEntry) {
    addEntry.onclick = () => openQuickPlanner();
  }
  OrdiPilotExt.extend(
    'renderV67Day',
    oldDay =>
      function () {
        oldDay();
        const root = document.getElementById('v67DayDetail'),
          b = root?.querySelector('[data-v67-add]');
        if (b)
          b.onclick = () => {
            document.getElementById('v67CalendarDialog').close();
            openQuickPlanner(b.dataset.v67Add);
          };
      }
  );
  OrdiPilotBoot.add('v68:3', () => {
    if (window.addEntry) addEntry.textContent = '+ Einsätze planen';
    renderInvoice();
  });
})();
