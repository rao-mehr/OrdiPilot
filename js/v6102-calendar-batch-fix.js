(function () {
  const base = () => location.href.split('#')[0].split('?')[0];
  function cleanUrl(u) {
    u.searchParams.delete('calendarBatch');
    u.searchParams.delete('calendarBatchName');
    u.searchParams.delete('calendarBatchTotal');
    u.searchParams.delete('calendarBatchDone');
    u.searchParams.delete('calendarBatchComplete');
    u.searchParams.delete('calendarBatchStopped');
    try {
      history.replaceState(null, '', u.pathname + (u.search || '') + (u.hash || ''));
    } catch (e) {}
  }
  function launch(payloads, name, total = payloads.length, done = 0) {
    if (!payloads.length) return;
    const first = payloads[0],
      rest = payloads.slice(1),
      root = base();
    let success;
    if (rest.length) {
      const p = new URLSearchParams();
      p.set('calendarBatch', JSON.stringify(rest));
      p.set('calendarBatchName', name);
      p.set('calendarBatchTotal', String(total));
      p.set('calendarBatchDone', String(done + 1));
      success = root + '?' + p.toString();
    } else success = root + `?calendarBatchComplete=1&calendarBatchTotal=${total}`;
    const stop = root + `?calendarBatchStopped=1&calendarBatchTotal=${total}&calendarBatchDone=${done}`;
    showV65CalendarToast(`Apple Kalender · ${done + 1}/${total}`);
    window.location.href = `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(JSON.stringify(first))}&x-success=${encodeURIComponent(success)}&x-cancel=${encodeURIComponent(stop)}&x-error=${encodeURIComponent(stop)}`;
  }
  function resume() {
    let u;
    try {
      u = new URL(location.href);
    } catch (e) {
      return;
    }
    if (u.searchParams.has('calendarBatch')) {
      let rest = [];
      try {
        rest = JSON.parse(u.searchParams.get('calendarBatch') || '[]');
      } catch (e) {}
      const name = u.searchParams.get('calendarBatchName') || 'Vertretung Familienkalender',
        total = Number(u.searchParams.get('calendarBatchTotal') || rest.length),
        done = Number(u.searchParams.get('calendarBatchDone') || 0);
      cleanUrl(u);
      if (rest.length) setTimeout(() => launch(rest, name, total, done), 250);
      return;
    }
    if (u.searchParams.get('calendarBatchComplete') === '1') {
      const total = Number(u.searchParams.get('calendarBatchTotal') || 0);
      cleanUrl(u);
      setTimeout(() => showV65CalendarToast(`Apple Kalender synchronisiert · ${total}/${total}`), 100);
      return;
    }
    if (u.searchParams.get('calendarBatchStopped') === '1') {
      const total = Number(u.searchParams.get('calendarBatchTotal') || 0),
        done = Number(u.searchParams.get('calendarBatchDone') || 0);
      cleanUrl(u);
      setTimeout(
        () => alert(`Kalendersynchronisierung abgebrochen. ${done} von ${total} Terminen wurden verarbeitet.`),
        120
      );
    }
  }
  const b = document.getElementById('v68PlanSave');
  OrdiPilotBoot.add('v6102-calendar-batch-fix:1', () => {
    if (b)
      b.addEventListener(
        'click',
        () => {
          const before = new Set((state.entries || []).map(e => e.id));
          setTimeout(() => {
            if (state.settings.calendarAutoSync === false) return;
            const added = (state.entries || []).filter(e => !before.has(e.id));
            if (added.length > 1) {
              const payloads = added.map(e => entryCalendarPayload(e, 'upsert'));
              launch(payloads, calendarShortcutName());
            }
          }, 350);
        },
        true
      );
    setTimeout(resume, 0);
  });
})();
