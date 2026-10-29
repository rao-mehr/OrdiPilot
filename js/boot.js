/* OrdiPilot · Start-Reihenfolge
   Alle Module werden zuerst vollständig geladen (Funktionen definiert, Erweiterungen installiert).
   Was beim Start ausgeführt werden soll (Daten migrieren, Ansichten zeichnen, Ereignisse verbinden),
   meldet jedes Modul hier an. js/main.js führt das am Ende in der Ladereihenfolge aus.
   So läuft beim Start immer die endgültige Fassung jeder Funktion – nie eine Zwischenstufe. */
window.OrdiPilotBoot = {
  queue: [],
  done: false,
  add(name, fn) {
    if (this.done) return this.exec(name, fn); // spät nachgeladen: sofort ausführen
    this.queue.push({ name, fn });
  },
  exec(name, fn) {
    // Ein Fehler stoppt nur diesen Schritt (wie früher nur das betroffene Modul) und bleibt als Fehler sichtbar.
    const report = e =>
      setTimeout(() => {
        throw e;
      });
    try {
      const r = fn();
      if (r && typeof r.catch === 'function') r.catch(report);
    } catch (e) {
      console.error('Start ' + name, e);
      report(e);
    }
  },
  run() {
    if (this.done) return;
    this.done = true;
    for (const { name, fn } of this.queue.splice(0)) this.exec(name, fn);
  },
};

/* Erweiterungen bestehender Funktionen – der einzige erlaubte Weg, eine globale Funktion zu verändern.
   OrdiPilotExt.extend('renderInvoice', base => function () { const out = base.apply(this, arguments); …; return out; });
   Die Reihenfolge entspricht der Ladereihenfolge; OrdiPilotExt.list() zeigt alle Erweiterungen. */
window.OrdiPilotExt = {
  items: [],
  extend(name, wrap) {
    const base = window[name];
    if (typeof base !== 'function') throw new Error('OrdiPilotExt: ' + name + ' ist keine Funktion');
    const fn = wrap(base);
    if (typeof fn !== 'function') throw new Error('OrdiPilotExt: Erweiterung von ' + name + ' liefert keine Funktion');
    window[name] = fn;
    const src = (document.currentScript && document.currentScript.getAttribute('src')) || '';
    this.items.push({ name, module: src.replace(/\?.*$/, '') });
    return fn;
  },
  list() {
    return this.items.map(x => x.name + ' ← ' + x.module);
  },
};
