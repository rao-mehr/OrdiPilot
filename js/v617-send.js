/* ===== OrdiPilot V6.17 · Honorarnote ohne Signatur: erstellen, ablegen, senden – ein Tipp =====
   Pro Rechnungsempfänger einstellbar: „Signatur mit ID Austria erforderlich“ (Standard: nein).
   Ohne Signatur: Knopf „Erstellen & senden“ → PDF erzeugen (falls nötig/veraltet) → in Dropbox ablegen
   → Mail per Kurzbefehl bzw. Teilen-Dialog. Nach dem Versand ist der Monat abgerechnet (gesperrt). */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof state === 'undefined') return;
  const esc = v => escapeHtml(v);
  const recipient = () => {
    const arr = state.settings.recipients || [];
    return arr.find(r => r.id === state.settings.activeRecipientId) || arr[0] || {};
  };
  const needsSignature = () => !!recipient().requiresSignature;
  let busy = false;
  const gmailReady = () => !!(state.settings.gmailSendUrl && state.settings.gmailSendToken);
  async function gmailCall(payload) {
    try {
      // text/plain vermeidet die CORS-Vorabanfrage, die Apps Script nicht beantwortet
      const r = await fetch(state.settings.gmailSendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, token: state.settings.gmailSendToken }),
        redirect: 'follow',
      });
      const t = await r.text();
      try {
        return JSON.parse(t);
      } catch (_) {
        return { ok: false, error: 'Antwort nicht lesbar (' + r.status + ') – Bereitstellung „Zugriff: Jeder“?' };
      }
    } catch (e) {
      return { ok: false, error: 'Keine Verbindung: ' + (e.message || e) };
    }
  }
  function setSendStatus(t) {
    const el = document.getElementById('v618Status');
    if (el) el.textContent = t;
  }
  const PENDING = 'ordipilot-v617-pending-send';
  // Die Erstell-Funktion aus V6.11 ist nicht global – beim Laden vom Knopf übernehmen
  const createInvoice = window.makePdf && typeof makePdf.onclick === 'function' ? makePdf.onclick : null;

  async function ensureCreated() {
    let rec = invoiceRecord();
    if (!rec?.createdAt || invoiceIsStaleV63(rec)) {
      if (rec?.mailOpenedAt) {
        alert('Diese Honorarnote wurde bereits versendet. Für Änderungen bitte „Korrektur anlegen“.');
        return null;
      }
      if (!createInvoice) {
        alert('Erstellen nicht verfügbar.');
        return null;
      }
      await createInvoice();
      rec = invoiceRecord();
      if (!rec?.createdAt || invoiceIsStaleV63(rec)) return null;
    }
    return rec;
  }
  async function sendDirect() {
    if (busy) return;
    busy = true;
    try {
      let rec = invoiceRecord();
      if (
        rec?.mailOpenedAt &&
        !confirm(
          `Diese Honorarnote wurde am ${dateAT(String(rec.mailOpenedAt).slice(0, 10))} bereits versendet. Erneut senden?`
        )
      )
        return;
      rec = await ensureCreated();
      if (!rec) return;
      const blob = await getInvoiceBlob(`draft:${rec.key}`);
      if (!blob) {
        alert('Die PDF ist auf diesem Gerät nicht mehr vorhanden. Bitte Honorarnote erneut erstellen.');
        return;
      }
      // In Dropbox ablegen (falls beim Erstellen offline)
      let path = rec.dropboxPath;
      if (isDropboxConnected() && !path) {
        try {
          path = `/Ordination & Selbständigkeit/Vertretungsdienste/Honorarnoten/${rec.year}/${rec.filename || invoiceFilename()}`;
          await dbxUpload(path, blob);
          upsertInvoiceRecord({ key: rec.key, dropboxPath: path, unsignedDropboxPath: path });
        } catch (e) {
          console.warn(e);
          path = '';
        }
      }
      upsertInvoiceRecord({
        key: rec.key,
        confirmedAt: rec.confirmedAt || nowISO(),
        finalizedAt: nowISO(),
        signatureRequired: false,
      });
      const r = recipient(),
        [y, m] = [rec.year, rec.month],
        to = r.email || state.settings.recipientEmail || '';
      const subject = `Honorarnote ${MONTHS[Number(m) - 1]} ${y} – ${state.settings.issuerName || 'Vertretung'}`;
      const body = `${r.salutation || 'Guten Tag,'}\n\nanbei übermittle ich meine Honorarnote ${rec.number || ''} für ${r.serviceDescription || 'ärztliche Vertretungstätigkeit'} im ${MONTHS[Number(m) - 1]} ${y}.\n\nMit freundlichen Grüßen\n${r.signoffName || state.settings.issuerName || ''}`;
      const file = new File([blob], rec.filename || invoiceFilename(), { type: 'application/pdf' });
      const shortcut = (state.settings.invoiceMailShortcut || '').trim();
      // 0. Direkt über Gmail (Apps-Script-Web-App): kein App-Wechsel, echte Versandbestätigung
      if (gmailReady() && path) {
        if (!to) {
          alert('Beim Rechnungsempfänger ist keine E-Mail-Adresse hinterlegt.');
          return;
        }
        if (
          !confirm(
            `Honorarnote ${rec.number || ''} für ${MONTHS[Number(m) - 1]} ${y} jetzt über Gmail senden?\n\nAn: ${to}\nBetreff: ${subject}\nAnhang: ${file.name}`
          )
        )
          return;
        setSendStatus('Wird über Gmail gesendet …');
        const r = await gmailCall({
          action: 'send',
          path,
          to,
          subject,
          body,
          fileName: file.name,
          senderName: state.settings.issuerName || '',
        });
        if (r.ok) {
          upsertInvoiceRecord({
            key: rec.key,
            mailOpenedAt: r.sentAt || nowISO(),
            mailSentVia: 'gmail',
            mailSentTo: to,
          });
          setSendStatus('');
          renderInvoice();
          try {
            refreshAll(false);
          } catch (_) {}
          return;
        }
        setSendStatus('');
        if (
          !confirm(
            `Senden über Gmail fehlgeschlagen:\n${r.error || 'unbekannter Fehler'}\n\nStattdessen per Mail-App/Teilen senden?`
          )
        )
          return;
      }
      const done = () => {
        upsertInvoiceRecord({ key: rec.key, mailOpenedAt: nowISO() });
        renderInvoice();
        try {
          refreshAll(false);
        } catch (_) {}
      };
      // 1. iPhone-Kurzbefehl: Mail mit Anhang direkt aus Dropbox
      if (isIOSDevice() && shortcut && path && isDropboxConnected()) {
        try {
          const fileUrl = await dropboxTemporaryLink(path);
          // Ob die Mail wirklich rausging, weiß nur der Nutzer: beim Zurückkehren nachfragen statt sofort sperren
          try {
            localStorage.setItem(PENDING, JSON.stringify({ key: rec.key, number: rec.number || '', at: Date.now() }));
          } catch (_) {}
          window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(shortcut)}&input=text&text=${encodeURIComponent(JSON.stringify({ to, subject, body, fileUrl, fileName: file.name, invoiceKey: rec.key }))}`;
          return;
        } catch (e) {
          console.warn(e);
        }
      }
      // 2. Teilen-Dialog (Mail, mit Anhang)
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        try {
          await navigator.share({ files: [file], title: subject, text: to ? `An: ${to}\n\n${body}` : body });
          done();
          return;
        } catch (e) {
          if (e?.name === 'AbortError') return;
        }
      }
      // 3. Fallback: herunterladen + Mailprogramm
      await downloadBlob(blob, file.name);
      done();
      window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n\n(PDF wurde heruntergeladen und kann angehängt werden.)')}`;
    } catch (e) {
      console.error(e);
      alert('Senden fehlgeschlagen. Die Honorarnote ist gespeichert – bitte erneut versuchen.');
    } finally {
      busy = false;
      try {
        render();
      } catch (_) {}
    }
  }

  function css() {
    if (document.getElementById('v617-style')) return;
    const st = document.createElement('style');
    st.id = 'v617-style';
    st.textContent = `.v617-toggle{display:flex;align-items:center;gap:10px;margin:10px 2px 0;font-size:13px;color:#6b7280;font-weight:600}
.v617-toggle input{width:18px;height:18px;min-height:auto}
.v617-sent{margin-top:10px;padding:10px 12px;border-radius:12px;background:#edf8ef;color:#1f7a3d;font-size:13px;font-weight:650}
.v617-reset{border:0;background:none;padding:6px 0 0;color:#0066cc;font-weight:650;font-size:13px}
.v618-status{font-size:13px;color:#0066cc;font-weight:650;margin-top:6px;min-height:0}
.v618-gmail{margin-top:10px;border:1px solid var(--line);border-radius:12px;background:#fff}
.v618-gmail summary{list-style:none;display:flex;justify-content:space-between;padding:10px 12px;font-size:13px;font-weight:700;cursor:pointer}
.v618-gmail summary::-webkit-details-marker{display:none}.v618-gmail summary span{color:#8e8e93;font-weight:650}.v618-gmail summary span.ok{color:#1f7a3d}
.v618-body{display:grid;gap:8px;padding:0 12px 12px}.v618-body label{display:grid;gap:4px;font-size:12px;color:var(--muted);font-weight:650}
#v618TestResult.ok{color:#1f7a3d;font-weight:700;font-size:13px}#v618TestResult.err{color:#b42318;font-weight:700;font-size:13px}`;
    document.head.appendChild(st);
  }
  function render() {
    css();
    const make = document.getElementById('makePdf');
    if (!make) return;
    const sig = needsSignature(),
      rec = invoiceRecord();
    // Schalter je Empfänger
    let tg = document.getElementById('v617Toggle');
    if (!tg) {
      tg = document.createElement('label');
      tg.id = 'v617Toggle';
      tg.className = 'v617-toggle';
      make.insertAdjacentElement('afterend', tg);
      tg.addEventListener('change', ev => {
        const r = recipient();
        r.requiresSignature = !!ev.target.checked;
        state.settings._updatedAt = nowISO();
        saveState();
        renderInvoice();
      });
    }
    tg.innerHTML = `<input type="checkbox" ${sig ? 'checked' : ''}> ${esc(recipient().name || 'Empfänger')} verlangt eine Signatur mit ID Austria`;
    let gm = document.getElementById('v618Gmail');
    if (!gm) {
      gm = document.createElement('details');
      gm.id = 'v618Gmail';
      gm.className = 'v618-gmail';
      tg.insertAdjacentElement('afterend', gm);
      gm.addEventListener('change', ev => {
        const t = ev.target;
        if (t.id === 'v618Url') {
          state.settings.gmailSendUrl = t.value.trim();
          state.settings._updatedAt = nowISO();
          saveState();
        }
        if (t.id === 'v618Token') {
          state.settings.gmailSendToken = t.value.trim();
          state.settings._updatedAt = nowISO();
          saveState();
        }
      });
      gm.addEventListener('click', async ev => {
        if (ev.target.id !== 'v618Test') return;
        ev.preventDefault();
        const st = gm.querySelector('#v618TestResult');
        st.textContent = 'Teste …';
        const r = await gmailCall({ action: 'ping' });
        st.textContent = r.ok ? `✓ Verbunden mit ${r.account || 'Gmail'}` : `✗ ${r.error || 'Fehler'}`;
        st.className = r.ok ? 'ok' : 'err';
      });
    }
    const ready = gmailReady(),
      wasOpen = gm.open;
    gm.innerHTML = `<summary>Versand über Gmail <span class="${ready ? 'ok' : ''}">${ready ? 'eingerichtet ✓' : 'nicht eingerichtet'}</span></summary>
      <div class="v618-body">
        <label>Web-App-URL<input id="v618Url" value="${esc(state.settings.gmailSendUrl || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
        <label>Schlüssel<input id="v618Token" value="${esc(state.settings.gmailSendToken || '')}" placeholder="aus dem Apps-Script-Protokoll" autocomplete="off"></label>
        <button type="button" class="btn soft" id="v618Test">Verbindung testen</button> <span id="v618TestResult"></span>
        <div class="help">Einrichtung: Datei „Honorarnote_Versand.gs“ ins Apps-Script-Projekt der EasyPark-Automatik einfügen, „setupHonorarnoteVersand“ ausführen, als Web-App bereitstellen (Ausführen als: Ich, Zugriff: Jeder). Ist der Versand eingerichtet, geht die Mail direkt aus deinem Gmail raus – ohne Kurzbefehl, mit Versandbestätigung.</div>
      </div>`;
    if (wasOpen) gm.open = true;
    let ss = document.getElementById('v618Status');
    if (!ss) {
      ss = document.createElement('div');
      ss.id = 'v618Status';
      ss.className = 'v618-status';
      make.insertAdjacentElement('afterend', ss);
    }
    let sent = document.getElementById('v617Sent');
    if (!sig) {
      make.textContent = rec?.mailOpenedAt ? 'Erneut senden' : 'Honorarnote erstellen & senden';
      make.onclick = sendDirect;
      for (const id of [
        'invoiceStepSigned',
        'invoiceStepDropbox',
        'invoiceStartSign',
        'invoiceSignedLabel',
        'invoiceArchiveSigned',
      ]) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      }
      const mailName = document.querySelector('#invoiceStepMail .invoice-step-name');
      if (mailName) mailName.textContent = 'Per E-Mail gesendet';
      const mailSub = document.getElementById('invoiceStepMailSub');
      if (mailSub)
        mailSub.textContent = rec?.mailOpenedAt
          ? `am ${dateAT(String(rec.mailOpenedAt).slice(0, 10))}`
          : 'Mit „Erstellen & senden“ in einem Schritt';
      const mailSt = document.getElementById('invoiceStepMailStatus');
      if (mailSt) {
        mailSt.textContent = rec?.mailOpenedAt ? 'gesendet ✓' : 'offen';
        mailSt.className = 'doc-status-pill' + (rec?.mailOpenedAt ? ' ok' : '');
      }
      const dot = document.querySelector('#invoiceStepMail .invoice-step-dot');
      if (dot) dot.textContent = '2';
      if (window.invoiceSendMail) {
        invoiceSendMail.onclick = sendDirect;
        invoiceSendMail.textContent = rec?.mailOpenedAt ? 'Erneut senden' : 'Senden';
      }
      if (rec?.mailOpenedAt) {
        if (!sent) {
          sent = document.createElement('div');
          sent.id = 'v617Sent';
          sent.className = 'v617-sent';
          tg.insertAdjacentElement('afterend', sent);
        }
        sent.innerHTML = `${rec.mailSentVia === 'gmail' ? `Über Gmail gesendet an ${esc(rec.mailSentTo || '')} am` : 'Versendet am'} ${dateAT(String(rec.mailOpenedAt).slice(0, 10))} · abgelegt in Dropbox unter Honorarnoten/${esc(rec.year)}<br><button type="button" class="v617-reset" id="v617Reset">Doch nicht gesendet? Zurücksetzen</button>`;
        sent.querySelector('#v617Reset').onclick = resetSent;
      } else if (sent) sent.remove();
    } else {
      make.textContent = 'Honorarnote erstellen';
      make.onclick = createInvoice;
      for (const id of ['invoiceStepSigned', 'invoiceStepDropbox', 'invoiceStartSign', 'invoiceSignedLabel']) {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      }
      const dot = document.querySelector('#invoiceStepMail .invoice-step-dot');
      if (dot) dot.textContent = '4';
      if (window.invoiceSendMail) {
        invoiceSendMail.onclick = shareSignedInvoice;
        invoiceSendMail.textContent = 'E-Mail senden';
      }
      if (sent) sent.remove();
    }
  }
  function askPending() {
    let p = null;
    try {
      p = JSON.parse(localStorage.getItem(PENDING) || 'null');
    } catch (_) {}
    if (!p) return;
    if (Date.now() - p.at > 6 * 3600e3) {
      try {
        localStorage.removeItem(PENDING);
      } catch (_) {}
      return;
    }
    if (Date.now() - p.at < 2500) return; // noch beim Öffnen des Kurzbefehls
    try {
      localStorage.removeItem(PENDING);
    } catch (_) {}
    if (
      confirm(
        `Wurde die Honorarnote ${p.number} per E-Mail gesendet?\n\nOK = ja, als versendet markieren\nAbbrechen = nein, noch nicht`
      )
    ) {
      upsertInvoiceRecord({ key: p.key, mailOpenedAt: nowISO() });
      renderInvoice();
      try {
        refreshAll(false);
      } catch (_) {}
    }
  }
  OrdiPilotBoot.add('v617-send:1', () => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') setTimeout(askPending, 400);
    });
    window.addEventListener('pageshow', () => setTimeout(askPending, 600));
  });
  function resetSent() {
    const rec = invoiceRecord();
    if (!rec?.mailOpenedAt || rec.signedAt) return;
    if (
      !confirm(
        `Honorarnote ${rec.number || ''} wieder auf „nicht versendet“ setzen?\n\nDer Monat wird entsperrt, die Nummer bleibt. Danach Einsätze ergänzen und erneut „Erstellen & senden“.`
      )
    )
      return;
    upsertInvoiceRecord({ key: rec.key, mailOpenedAt: null, finalizedAt: null });
    renderInvoice();
    try {
      refreshAll(false);
    } catch (_) {}
  }
  OrdiPilotExt.extend(
    'renderInvoice',
    base =>
      function () {
        const out = base.apply(this, arguments);
        try {
          render();
        } catch (e) {
          console.warn('V6.17', e);
        }
        return out;
      }
  );
  window.ordipilotSendInvoice = sendDirect;
  window.ordipilotAskPendingSend = askPending;
  window.ordipilotResetSent = resetSent;
  OrdiPilotBoot.add('v617-send:2', () => {
    try {
      render();
    } catch (e) {
      console.warn('V6.17', e);
    }
  });
})();
