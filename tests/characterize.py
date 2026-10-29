"""Charakterisierungs-Test: hält das sichtbare und gespeicherte Verhalten der App fest.

Die App wird mit festen Testdaten, fester Uhrzeit (29.10.2026, 10:00 Wien) und festem Zufall
durch alle Bereiche geführt. Alles Sichtbare (Texte je Ansicht, Formulare, Honorarnote,
PDF-Text) und alles Gespeicherte (Dropbox-Datei nach dem Sync, Steuerpaket, Versand-Aufruf)
wird gesammelt und mit tests/snapshots/characterization.json verglichen.

Zweck: Umbauten am Code dürfen das Verhalten nicht verändern. Ist eine Änderung gewollt,
wird der Stand bewusst neu geschrieben:  UPDATE_SNAPSHOT=1 python3 tests/characterize.py
"""
import io, json, os, re, sys, difflib, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from browser_smoke import FakeDropbox, serve, vendor, until, ROOT, SYSTEM, DATA, VENDOR  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

SNAP = os.environ.get("CHAR_SNAP") or os.path.join(ROOT, "tests", "snapshots", "characterization.json")
BASE_DIR = "/Ordination & Selbständigkeit/Vertretungsdienste"
NOW = "2026-10-29T10:00:00+01:00"

# Fester Zufall und feste Zeit für reproduzierbare IDs und Zeitstempel
INIT = """
(()=>{let s=20261029;const rnd=()=>{s=(s*1103515245+12345)%2147483648;return s/2147483648};
Math.random=rnd;
if(window.crypto){try{crypto.randomUUID=()=>'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(rnd()*16);return (c==='x'?r:(r&3|8)).toString(16)})}catch(e){}}
try{if(!localStorage.getItem('vertretungsabrechnung-dropbox-auth'))localStorage.setItem('vertretungsabrechnung-dropbox-auth',JSON.stringify({accessToken:'test-token',expiresAt:0}))}catch(e){}
})();
"""


def fixture():
    rid = "recipient-primary"
    rec2 = "recipient-zweit"
    settings = {
        "defaultRate": 170, "year": 2026, "_updatedAt": "2026-10-20T08:00:00Z", "_v613AutoSyncDefault": True, "dropboxAutoSync": False,
        "issuerName": "Dr. Test Arzt", "issuerQualification": "Facharzt für Orthopädie", "issuerAddress": "Teststraße 1\n1010 Wien",
        "iban": "AT00 0000 0000 0000 0000", "taxNote": "Der Betrag ist umsatzsteuerfrei gem. § 6 Abs 1 Z 19 UStG.",
        "recipients": [
            {"id": rid, "name": "Dr. med. Erika Muster", "qualification": "Fachärztin", "address": "Ordinationsweg 2\n2100 Korneuburg",
             "email": "praxis@example.org", "salutation": "Liebe Erika,", "signoffName": "Dr. Test Arzt", "serviceDescription": "Ärztliche Vertretungstätigkeit",
             "travelKm": 23, "travelKmWork": 18},
            {"id": rec2, "name": "Dr. Max Zweit", "address": "Platz 3\n3400 Klosterneuburg", "email": "zweit@example.org", "requiresSignature": True},
        ],
        "activeRecipientId": rid, "calendarEventLocation": "Ordinationsweg 2, 2100 Korneuburg",
        "travelHome": "Teststraße 1, 1010 Wien", "travelWork": "Spital, Hauptstraße 1, 1220 Wien", "travelRate": 0.5,
        "expensesEnabled": True, "taxReservePct": 40, "estPrepayments": True, "invoiceMailShortcut": "Honorarnote senden",
        "dropboxSyncPath": DATA,
    }
    E = []
    def e(i, date, start, end, brk=0, **kw):
        d = {"id": f"e{i}", "date": date, "start": start, "end": end, "breakMinutes": brk, "manualHours": None, "rate": 170,
             "recipientId": rid, "updatedAt": "2026-10-01T10:00:00Z"}
        d.update(kw); E.append(d)
    e(1, "2026-07-07", "08:00", "13:00", confirmedAt="2026-07-07T14:00:00Z")
    e(2, "2026-07-21", "09:00", "17:30", 30, confirmedAt="2026-07-21T18:00:00Z")
    e(3, "2026-08-04", "08:30", "12:00", confirmedAt="2026-08-04T13:00:00Z")
    e(4, "2026-08-18", "09:00", "18:00", 30, confirmedAt="2026-08-18T19:00:00Z", travelMode="work")
    e(5, "2026-09-08", "09:00", "12:30", confirmedAt="2026-09-08T13:00:00Z")
    e(6, "2026-09-22", "09:00", "16:00", 0, confirmedAt="2026-09-22T17:00:00Z")
    e(7, "2026-10-05", "09:30", "13:00", confirmedAt="2026-10-05T14:00:00Z")
    e(8, "2026-10-20", "09:00", "12:30")
    e(9, "2026-10-27", "", "", plannedStart="10:00", plannedEnd="12:30", status="planned")
    e(10, "2026-11-03", "", "", plannedStart="09:00", plannedEnd="13:00", status="planned")
    e(11, "2026-09-15", "08:00", "12:00", recipientId=rec2, confirmedAt="2026-09-15T13:00:00Z")
    parking = [
        {"id": "p1", "date": "2026-07-07", "start": "07:50", "end": "13:10", "amount": 4.2, "provider": "EasyPark", "updatedAt": "2026-07-07T14:00:00Z"},
        {"id": "p2", "date": "2026-08-04", "start": "08:20", "end": "12:10", "amount": 3.1, "provider": "EasyPark", "updatedAt": "2026-08-04T13:00:00Z"},
        {"id": "p3", "date": "2026-09-22", "start": "08:50", "end": "16:10", "amount": 6.4, "provider": "EasyPark", "updatedAt": "2026-09-22T17:00:00Z"},
        {"id": "p4", "date": "2026-10-11", "start": "10:00", "end": "11:00", "amount": 1.5, "provider": "EasyPark", "updatedAt": "2026-10-11T12:00:00Z"},
    ]
    invoices = [
        {"key": f"2026-07::{rid}", "year": "2026", "month": "07", "number": "2026-006", "recipientId": rid, "createdAt": "2026-08-01T10:00:00Z",
         "confirmedAt": "2026-08-01T10:00:00Z", "finalizedAt": "2026-08-01T10:00:00Z", "mailOpenedAt": "2026-08-01T10:05:00Z",
         "updatedAt": "2026-08-01T10:05:00Z", "filename": "2026-07_Honorarnote_Muster.pdf"},
    ]
    payments = [{"id": "pay1", "key": f"2026-07::{rid}", "paidAt": "2026-08-12", "amount": 2295.0, "updatedAt": "2026-08-12T10:00:00Z"}]
    expenses = [{"id": "x1", "date": "2026-09-01", "category": "Fortbildung", "note": "Kurs", "amount": 120, "share": 100, "updatedAt": "2026-09-01T10:00:00Z"}]
    cloud = {"entries": E, "parkingRecords": parking, "invoices": invoices, "payments": payments, "trips": [], "expenses": expenses,
             "deletedEntries": {}, "deletedParking": {}, "settings": settings}
    return cloud


def norm_text(t):
    return re.sub(r"[ \t ]+", " ", re.sub(r"\n\s*\n+", "\n", t or "")).strip()


def pdf_text(data):
    from pypdf import PdfReader
    try:
        # ohne Leerraum: Inhalt und Reihenfolge zählen, nicht Zeilenumbrüche (hängen von der Schrift ab)
        return re.sub(r"\s+", "", "".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages))
    except Exception as exc:  # pragma: no cover
        return f"<PDF nicht lesbar: {exc}>"


def main():
    cloud = fixture()
    if os.environ.get("CHAR_DATA"):  # lokal mit echten Daten (bleiben außerhalb des Repositorys)
        cloud = json.load(open(os.environ["CHAR_DATA"], encoding="utf8"))
        cloud["settings"]["dropboxAutoSync"] = False
    snap = {}
    srv = serve(ROOT)
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(timezone_id="Europe/Vienna", locale="de-AT", viewport={"width": 430, "height": 900})
        if VENDOR:
            ctx.route("https://cdn.jsdelivr.net/**", vendor)
        dbx = FakeDropbox()
        dbx.put(DATA, json.dumps(cloud).encode())
        dbx.put(SYSTEM + "/Import/standort.txt", b"2026-10-20T08:52:00+02:00 ankunft\n2026-10-20T12:41:00+02:00 abfahrt\n2026-10-27T09:10:00+01:00 klinik\n2026-10-27T09:55:00+01:00 ankunft\n2026-10-27T12:35:00+01:00 abfahrt\n")
        dbx.put(BASE_DIR + "/Zahlungsnachweise/2026/2026-08_Zahlungsnachweis_Muster.pdf", b"%PDF-1.4 test", modified="2026-09-10T10:00:00Z")
        ctx.route("https://api.dropboxapi.com/**", dbx.handle)
        ctx.route("https://content.dropboxapi.com/**", dbx.handle)
        calls = []

        def webapp(route, request):
            d = json.loads(request.post_data or "{}"); calls.append(d)
            body = {"ok": True, "account": "arzt@example.org"} if d.get("action") == "ping" else {"ok": True, "sentAt": "2026-10-29T09:00:00.000Z", "to": d.get("to")}
            route.fulfill(status=200, headers={"content-type": "application/json", "access-control-allow-origin": "*"}, body=json.dumps(body))
        ctx.route("https://script.google.com/**", webapp)
        ctx.add_init_script(INIT)
        page = ctx.new_page()
        page.clock.set_fixed_time(datetime.datetime.fromisoformat(NOW))
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message[:160]), d.accept()))
        page.goto(base + "/index.html")
        page.wait_for_function("()=>!!window.ordipilotSync", timeout=15000)
        page.wait_for_timeout(500)

        # 1) Sync mit Dropbox
        ok = page.evaluate("()=>syncWithDropbox({interactive:true})")
        snap["sync_ok"] = ok
        snap["sync_status"] = norm_text(page.evaluate("()=>document.getElementById('dropboxStatus')?.textContent||''"))
        after = dbx.get(DATA)
        snap["cloud_after_sync"] = after
        snap["dropbox_files_after_sync"] = sorted(d for d, *_ in dbx.files.values())

        # 2) Alle Ansichten
        def view(tab):
            page.evaluate(f"()=>document.querySelector('[data-tab={tab}]').click()")
            page.wait_for_timeout(250)
            return page.evaluate("""(tab)=>{const p=document.getElementById('panel-'+tab);
              for(const d of p.querySelectorAll('details'))d.open=true;
              return {text:p.innerText, ids:[...p.querySelectorAll('[id]')].map(e=>e.id).filter(i=>!/^(chart|tmp)/.test(i)).sort(),
                      buttons:[...p.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.textContent.trim()).filter(Boolean)}}""", tab)
        for tab in ["dashboard", "entries", "parking", "invoice", "settings"]:
            v = view(tab)
            # Details öffnen verändert den Text – nach dem Öffnen erneut lesen
            v["text"] = norm_text(page.evaluate("(tab)=>document.getElementById('panel-'+tab).innerText", tab))
            snap[f"view_{tab}"] = v
        snap["header_footer"] = norm_text(page.evaluate("()=>[...document.querySelectorAll('header,.footer-note')].map(e=>e.innerText).join('\\n')"))

        # 3) Einsatz öffnen (unbestätigt, mit erkannten Zeiten)
        page.evaluate("()=>document.querySelector('[data-tab=entries]').click()")
        snap["entry_form"] = page.evaluate("""()=>{openEntry('e8');const f=document.querySelector('#entryDialog, dialog[open], .sheet.open')||document.body;
            return [...document.querySelectorAll('input,select,textarea')].filter(i=>i.id&&/^f[A-Z]/.test(i.id)).map(i=>i.id+'='+(i.type==='checkbox'?i.checked:i.value))}""")
        page.keyboard.press("Escape")
        page.evaluate("()=>{try{closeEntry&&closeEntry()}catch(e){}}")

        # 4) Honorarnote September: Vorschau, erstellen & senden (Teilen-Dialog)
        page.evaluate("()=>{window.__shared=null;navigator.canShare=()=>true;navigator.share=async d=>{window.__shared={files:d.files.map(f=>f.name),title:d.title,text:d.text}}}")
        page.evaluate("()=>{document.querySelector('[data-tab=invoice]').click();invYear.value='2026';invMonth.value='09';invMonth.dispatchEvent(new Event('change'));renderInvoice()}")
        page.wait_for_timeout(300)
        snap["invoice_09_preview"] = norm_text(page.evaluate("()=>document.getElementById('invoicePreview')?.innerText||''"))
        snap["invoice_09_panel"] = norm_text(page.evaluate("()=>document.getElementById('panel-invoice').innerText"))
        snap["invoice_09_button"] = page.evaluate("()=>({text:makePdf.textContent.trim(),disabled:makePdf.disabled})")
        if not snap["invoice_09_button"]["disabled"]:
            page.click("#makePdf")
            until(page, lambda: page.evaluate("()=>!!window.__shared"), 20)
        snap["invoice_09_shared"] = page.evaluate("()=>window.__shared")
        pdfs = {d: data for d, data, *_ in dbx.files.values() if d.lower().endswith(".pdf") and "/Honorarnoten/" in d}
        snap["invoice_09_pdfs"] = {d: pdf_text(data) for d, data in sorted(pdfs.items())}
        snap["invoice_09_record"] = page.evaluate("()=>invoiceRecord()")
        snap["invoice_09_panel_after"] = norm_text(page.evaluate("()=>document.getElementById('panel-invoice').innerText"))

        # 5) Gmail-Versand August
        page.evaluate("()=>{state.settings.gmailSendUrl='https://script.google.com/macros/s/TEST/exec';state.settings.gmailSendToken='geheim';saveState(false)}")
        page.evaluate("()=>{invYear.value='2026';invMonth.value='08';invMonth.dispatchEvent(new Event('change'));renderInvoice()}")
        page.wait_for_timeout(300)
        snap["invoice_08_preview"] = norm_text(page.evaluate("()=>document.getElementById('invoicePreview')?.innerText||''"))
        snap["invoice_08_button"] = page.evaluate("()=>({text:makePdf.textContent.trim(),disabled:makePdf.disabled})")
        if not snap["invoice_08_button"]["disabled"]:
            page.click("#makePdf")
            until(page, lambda: bool((page.evaluate("()=>invoiceRecord()") or {}).get("mailOpenedAt")), 20)
        snap["gmail_calls"] = [{k: v for k, v in c.items()} for c in calls]
        snap["invoice_08_record"] = page.evaluate("()=>invoiceRecord()")

        # 6) Zweiter Empfänger mit Signatur: Ablauf-Ansicht
        page.evaluate("()=>{state.settings.activeRecipientId='recipient-zweit';saveState(false);invYear.value='2026';invMonth.value='09';invMonth.dispatchEvent(new Event('change'));renderInvoice()}")
        page.wait_for_timeout(300)
        snap["invoice_sig_panel"] = norm_text(page.evaluate("()=>document.getElementById('panel-invoice').innerText"))
        page.evaluate("()=>{state.settings.activeRecipientId='recipient-primary';saveState(false);renderInvoice()}")

        # 7) Steuer
        page.evaluate("()=>ordipilotTax.setYear(2026)")
        snap["tax_report"] = page.evaluate("()=>ordipilotTax.report()")
        files = page.evaluate("""async()=>{const r=await ordipilotTax.buildFiles();const out={};
            for(const f of r.files){out[f.name]=f.name.endsWith('.csv')?await f.text():f.size>0}return out}""")
        snap["tax_files"] = {k: (v if isinstance(v, str) else "<binär>") for k, v in files.items()}

        # 8) Sync danach: alles Gespeicherte
        page.evaluate("()=>syncWithDropbox({interactive:true})")
        snap["cloud_final"] = dbx.get(DATA)
        snap["dropbox_files_final"] = sorted(d for d, *_ in dbx.files.values())
        snap["local_final"] = page.evaluate("()=>JSON.parse(localStorage.getItem('vertretungsabrechnung-v3')||'null')")
        snap["dialogs"] = dialogs
        snap["js_errors"] = errors
        browser.close()
    srv.shutdown()

    out = json.dumps(snap, ensure_ascii=False, indent=1, sort_keys=True)
    if os.environ.get("UPDATE_SNAPSHOT") or not os.path.exists(SNAP):
        os.makedirs(os.path.dirname(SNAP), exist_ok=True)
        open(SNAP, "w", encoding="utf8").write(out + "\n")
        print("Snapshot geschrieben:", SNAP)
        return 0
    old = open(SNAP, encoding="utf8").read().rstrip("\n")
    if old == out:
        print("Verhalten unverändert ✓ (" + str(len(snap)) + " Bereiche)")
        return 0
    diff = list(difflib.unified_diff(old.splitlines(), out.splitlines(), "erwartet", "jetzt", n=2, lineterm=""))
    print("Verhalten hat sich geändert:\n" + "\n".join(diff[:300]))
    if os.environ.get("GITHUB_ACTIONS"):
        print("::error title=Charakterisierung::Verhalten hat sich geändert – siehe Protokoll")
    return 1


if __name__ == "__main__":
    sys.exit(main())
