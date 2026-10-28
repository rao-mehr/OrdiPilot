"""Browser-Test der kompletten App mit simulierter Dropbox (Chromium/Playwright).

Start:  python3 tests/browser_smoke.py
Optional mit echten Daten (bleiben lokal, werden nie committet):
        REAL_DATA=/pfad/daten.json REAL_BACKUP=/pfad/backup.json python3 tests/browser_smoke.py
"""
import json, os, re, shutil, subprocess, sys, tempfile, threading, time, http.server, functools, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SYSTEM = "/Ordination & Selbständigkeit/Vertretungsdienste/System"
DATA = SYSTEM + "/daten.json"
_m = re.search(r"ordipilot-v(\d+)-(\d+)-(\d+)", open(os.path.join(ROOT, "service-worker.js")).read())
VERSION, CACHE_NAME = ".".join(_m.groups()), _m.group(0)
VERSION_RE = VERSION.replace(".", "\\.")


def fixture():
    entries = [{"id": f"e{i}", "date": f"2026-0{1 + i % 9}-1{i % 9}", "start": "08:00", "end": "16:00", "breakMinutes": 0,
                "manualHours": None, "rate": 170, "confirmedAt": "2026-09-01T10:00:00Z", "updatedAt": "2026-09-01T10:00:00Z"} for i in range(12)]
    parking = [{"id": f"p{i}", "date": "2026-09-1%d" % i, "start": "08:00", "end": "11:00", "amount": 3.1, "provider": "Test",
                "updatedAt": "2026-09-01T10:00:00Z"} for i in range(4)]
    invoices = [{"key": "2026-09::recipient-primary", "year": "2026", "month": "09", "number": "2026-008", "recipientId": "recipient-primary",
                 "createdAt": "2026-10-01T10:00:00Z", "updatedAt": "2026-10-01T10:00:00Z", "filename": "2026-09_Honorarnote_Muster.pdf"}]
    good_settings = {"defaultRate": 170, "reservePct": 50, "year": 2026, "_updatedAt": "2026-10-13T20:37:51Z",
                     "issuerName": "Dr. Test Arzt", "issuerAddress": "Teststraße 1\n1010 Wien", "iban": "AT00 0000 0000 0000 0000",
                     "recipientName": "Dr. med. Erika Muster", "recipientAddress": "Ordinationsweg 2\n2100 Korneuburg",
                     "recipientEmail": "praxis@example.org", "salutation": "Sehr geehrte Frau Dr. Muster,", "signoffName": "Dr. Test Arzt",
                     "taxNote": "Der Betrag ist umsatzsteuerfrei gem. § 6 Abs 1 Z 19 UStG.", "dropboxSyncPath": DATA}
    wiped = dict(good_settings, issuerName="", issuerAddress="", iban="", recipientName="", recipientAddress="", recipientEmail="",
                 salutation="", signoffName="", _updatedAt="2026-10-13T22:11:21Z",
                 recipients=[{"id": "recipient-primary", "name": "Dr. med.", "qualification": "", "address": "", "email": ""}],
                 activeRecipientId="recipient-primary")
    cloud = {"entries": entries, "parkingRecords": parking, "invoices": invoices, "deletedEntries": {}, "deletedParking": {}, "settings": wiped}
    backup = {"entries": entries, "parkingRecords": parking, "invoices": invoices, "settings": good_settings}
    return cloud, backup


class FakeDropbox:
    def __init__(self):
        self.files = {}      # lower path -> (display, bytes, rev)
        self.revs = {}       # rev -> bytes
        self.uploads = []
        self.copies = []
        self.fail_metadata = False
        self.n = 0

    def put(self, path, data, modified="2026-10-14T20:00:00Z"):
        self.n += 1
        rev = "%09x" % (0x100000000 + self.n)
        self.files[path.lower()] = (path, data, rev, modified)
        self.revs[rev] = data
        return rev

    def get(self, path):
        f = self.files.get(path.lower())
        return json.loads(f[1]) if f else None

    def handle(self, route, request):
        url = request.url
        cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "Dropbox-API-Result"}
        if request.method == "OPTIONS":
            return route.fulfill(status=204, headers=cors)
        endpoint = url.split("/2/", 1)[1]
        arg = json.loads(request.headers.get("dropbox-api-arg", "{}") or "{}")
        body = request.post_data_buffer or b""

        def js(status, obj):
            route.fulfill(status=status, headers={**cors, "content-type": "application/json"}, body=json.dumps(obj))

        if endpoint == "files/get_metadata":
            if self.fail_metadata:
                return js(500, {"error_summary": "internal"})
            p = json.loads(body)["path"]
            f = self.files.get(p.lower())
            if not f:
                if any(k.startswith(p.lower().rstrip("/") + "/") for k in self.files):
                    return js(200, {".tag": "folder", "name": p.split("/")[-1], "path_lower": p.lower(), "path_display": p})
                return js(409, {"error_summary": "path/not_found/.."})
            return js(200, {".tag": "file", "name": f[0].split("/")[-1], "path_lower": p.lower(), "path_display": f[0], "rev": f[2], "server_modified": f[3]})
        if endpoint == "files/download":
            p = arg["path"]
            if p.startswith("rev:"):
                data = self.revs.get(p[4:])
                if data is None:
                    return js(409, {"error_summary": "path/not_found/"})
            else:
                f = self.files.get(p.lower())
                if not f:
                    return js(409, {"error_summary": "path/not_found/.."})
                data = f[1]
            return route.fulfill(status=200, headers={**cors, "content-type": "application/octet-stream"}, body=data)
        if endpoint == "files/upload":
            p, mode = arg["path"], arg.get("mode", "add")
            cur = self.files.get(p.lower())
            if mode == "add" and cur:
                return js(409, {"error_summary": "path/conflict/file/"})
            if isinstance(mode, dict) and mode.get(".tag") == "update" and (not cur or cur[2] != mode["update"]):
                return js(409, {"error_summary": "path/conflict/file/"})
            rev = self.put(p, body)
            self.uploads.append((p, mode))
            return js(200, {"path_display": p, "rev": rev})
        if endpoint == "files/list_folder":
            folder = json.loads(body)["path"].lower().rstrip("/") + "/"
            entries = [{".tag": "file", "name": d.split("/")[-1], "path_lower": k, "path_display": d, "rev": r, "server_modified": m}
                       for k, (d, _, r, m) in self.files.items() if k.startswith(folder) and "/" not in k[len(folder):]]
            return js(200, {"entries": entries, "has_more": False})
        if endpoint == "files/copy_v2":
            a = json.loads(body); src = a["from_path"].lower().rstrip("/") + "/"; dst = a["to_path"]
            items = [(k, v) for k, v in list(self.files.items()) if k.startswith(src)]
            if not items:
                return js(409, {"error_summary": "from_lookup/not_found/"})
            if any(k.startswith(dst.lower().rstrip("/") + "/") for k in self.files):
                return js(409, {"error_summary": "to/conflict/folder/"})
            for k, (d, data, r, m) in items:
                self.put(dst + d[len(src) - 1:], data)
            self.copies.append((a["from_path"], dst))
            return js(200, {"metadata": {".tag": "folder", "path_display": dst}})
        if endpoint == "files/create_folder_v2":
            return js(409, {"error_summary": "path/conflict/folder/"})
        return js(200, {})


def serve(directory):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=directory)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


VENDOR = os.environ.get("VENDOR_DIR")


def vendor(route, request):
    url = request.url
    for key, rel in [("pdf-lib.min.js", "pdf-lib/dist/pdf-lib.min.js"), ("fontkit.umd.min.js", "@pdf-lib/fontkit/dist/fontkit.umd.min.js")]:
        if key in url:
            return route.fulfill(status=200, headers={"content-type": "application/javascript", "access-control-allow-origin": "*"}, body=open(os.path.join(VENDOR, "node_modules", rel), "rb").read())
    if url.endswith(".ttf"):
        return route.fulfill(status=200, headers={"content-type": "font/ttf", "access-control-allow-origin": "*"}, body=open("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "rb").read())
    return route.fulfill(status=404, body="")


def new_page(browser, base, dbx, local_state=None):
    ctx = browser.new_context(accept_downloads=True)
    if VENDOR:
        ctx.route("https://cdn.jsdelivr.net/**", vendor)
    ctx.route("https://api.dropboxapi.com/**", dbx.handle)
    ctx.route("https://content.dropboxapi.com/**", dbx.handle)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "try{if(!localStorage.getItem('vertretungsabrechnung-dropbox-auth'))localStorage.setItem('vertretungsabrechnung-dropbox-auth',JSON.stringify({accessToken:'test-token',expiresAt:0}));"
        + (f"if(!localStorage.getItem('vertretungsabrechnung-v3'))localStorage.setItem('vertretungsabrechnung-v3',{json.dumps(json.dumps(local_state))});" if local_state else "")
        + "}catch(e){}")
    page.goto(base + "/index.html")
    page.wait_for_function("()=>!!window.ordipilotSync", timeout=15000)
    return ctx, page, errors


results = []


def until(page, fn, seconds=10.0, step=250):
    """Wartet, bis fn() wahr ist (statt fester Wartezeiten). page.wait_for_timeout statt time.sleep,
    damit Playwright währenddessen die simulierten Dropbox-Anfragen beantworten kann."""
    end = time.time() + seconds
    while time.time() < end:
        try:
            if fn():
                return True
        except Exception:
            pass
        page.wait_for_timeout(step)
    return bool(fn())


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("  ✓ " if cond else "  ✗ ") + name + (f"  [{detail}]" if detail and not cond else ""))
    if not cond and os.environ.get("GITHUB_ACTIONS"):
        # als Annotation sichtbar machen (im Pull Request lesbar, ohne das Protokoll zu öffnen)
        print(f"::error title=Browser-Test::{name} {str(detail)[:300]}".replace("\n", " "))


def main():
    cloud, backup = fixture()
    if os.environ.get("REAL_DATA"):
        cloud = json.load(open(os.environ["REAL_DATA"], encoding="utf8"))
        backup = json.load(open(os.environ["REAL_BACKUP"], encoding="utf8")) if os.environ.get("REAL_BACKUP") else backup
        print("Mit echten Daten (lokal):", len(cloud["entries"]), "Einsätze")
    today = datetime.date.today().isoformat()
    srv = serve(ROOT)
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    with sync_playwright() as p:
        browser = p.chromium.launch()

        print("1) Neues Gerät (leerer Speicher), Cloud mit gelöschten Rechnungsdaten")
        dbx = FakeDropbox()
        dbx.put(DATA, json.dumps(cloud).encode())
        dbx.put(SYSTEM + "/backup_2026-10-13.json", json.dumps(backup).encode(), modified="2026-10-13T21:00:00Z")
        ctx, page, errors = new_page(browser, base, dbx)
        ok = page.evaluate("()=>syncWithDropbox({interactive:true})")
        after = dbx.get(DATA)
        check("Sync erfolgreich", ok is True)
        check("Keine Einsätze verloren", len(after["entries"]) == len(cloud["entries"]), f"{len(after['entries'])} vs {len(cloud['entries'])}")
        check("Keine Parkvorgänge verloren", len(after["parkingRecords"]) == len(cloud["parkingRecords"]))
        check("Honorarnoten erhalten", len(after["invoices"]) == len(cloud["invoices"]))
        check("Upload nur gegen gelesene Revision", all(isinstance(m, dict) and m.get(".tag") == "update" for pth, m in dbx.uploads if pth == DATA), str(dbx.uploads))
        check("IBAN aus Backup wiederhergestellt", bool(after["settings"].get("iban")) and after["settings"]["iban"] == backup["settings"].get("iban"))
        check("Eigener Name wiederhergestellt", after["settings"].get("issuerName") == backup["settings"].get("issuerName"))
        r0 = (after["settings"].get("recipients") or [{}])[0]
        check("Empfänger-Name repariert (nicht nur Titel)", r0.get("name") == backup["settings"].get("recipientName"), r0.get("name", "")[:12])
        check("Empfänger-Adresse repariert", r0.get("address") == backup["settings"].get("recipientAddress"))
        check(f"Tagessicherung backup_{today}.json angelegt", dbx.get(f"{SYSTEM}/backup_{today}.json") is not None)
        check("Sicherung enthält den Cloud-Stand vor dem Schreiben", (dbx.get(f"{SYSTEM}/backup_{today}.json") or {}).get("settings", {}).get("iban", "") == cloud["settings"].get("iban", ""))
        icon_check = page.evaluate("""async()=>{
          const m=await (await fetch('manifest.webmanifest')).json();
          const srcs=[...m.icons.map(i=>i.src),...[...document.querySelectorAll('link[rel*=icon]')].map(l=>l.getAttribute('href'))];
          const out=[];
          for(const src of srcs){
            const img=new Image();img.src=src;try{await img.decode()}catch(e){out.push(src+': lädt nicht');continue}
            const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.drawImage(img,0,0,64,64);
            const d=x.getImageData(0,0,64,64).data;let blue=0,white=0;
            for(let i=0;i<d.length;i+=4){if(d[i+2]>200&&d[i]<120)blue++;if(d[i]>240&&d[i+1]>240&&d[i+2]>240)white++}
            if(blue<64*64*0.4||white<20)out.push(src+': blau '+blue+', weiß '+white);
          }
          return out}""")
        check("App-Icons sind nicht leer (blau mit weißem Logo)", icon_check == [], str(icon_check))
        check(f"Version {VERSION} sichtbar", page.evaluate("()=>[...document.querySelectorAll('.footer-note')].some(e=>/"+VERSION_RE+"/.test(e.textContent))"))
        check("Kein Hotfix-Skript eingeschleust", page.evaluate("()=>!document.querySelector('script[src*=v6113]')"))
        check("Keine JavaScript-Fehler", not errors, "; ".join(errors)[:300])
        uploads_before = len(dbx.uploads)
        page.evaluate("()=>syncDropbox.onclick()")
        until(page, lambda: len(dbx.uploads) > uploads_before, 10)
        check("Sync-Button läuft über den neuen Kern", len(dbx.uploads) > uploads_before and isinstance(dbx.uploads[-1][1], dict))
        # Rolle + Anrede pro Empfänger bleiben nach Neuladen erhalten
        page.evaluate("()=>{const r=document.getElementById('setRecipientRole');r.value='Ordinationsinhaber';r.dispatchEvent(new Event('change'));const s=document.getElementById('setSalutation');s.value='Sehr geehrter Herr Kollege,';s.dispatchEvent(new Event('change'))}")
        page.reload(); page.wait_for_function("()=>!!window.ordipilotSync")
        r = page.evaluate("()=>{const a=state.settings.recipients.find(x=>x.id===state.settings.activeRecipientId);return {role:a.roleLabel,sal:a.salutation,field:document.getElementById('setRecipientRole')?.value}}")
        check("Rolle pro Empfänger gespeichert", r["role"] == "Ordinationsinhaber" and r["field"] == "Ordinationsinhaber", str(r))
        check("Anrede pro Empfänger gespeichert", r["sal"] == "Sehr geehrter Herr Kollege,", str(r))
        check("Rolle erscheint in der Honorarnoten-Vorschau", page.evaluate("()=>{try{renderInvoice()}catch(e){};return (document.getElementById('invoicePreview')?.innerHTML||'').includes('Ordinationsinhaber:')}"))
        ctx.close()

        print("2) Dropbox nicht lesbar")
        dbx = FakeDropbox(); dbx.put(DATA, json.dumps(cloud).encode()); dbx.fail_metadata = True
        local = json.loads(json.dumps(cloud)); local["entries"] = local["entries"][:1]
        ctx, page, errors = new_page(browser, base, dbx, local)
        ok = page.evaluate("()=>syncWithDropbox({interactive:true})")
        check("Sync abgebrochen", ok is False)
        check("Nichts hochgeladen", len(dbx.uploads) == 0, str(dbx.uploads))
        check("Status nennt den Abbruch", "nichts hochgeladen" in page.evaluate("()=>document.getElementById('dropboxStatus')?.textContent||''"))
        ctx.close()

        print("3) Datendatei fehlt")
        dbx = FakeDropbox()
        ctx, page, errors = new_page(browser, base, dbx)
        ok = page.evaluate("()=>syncWithDropbox()")
        check("Leeres Gerät legt keine leere Datei an", ok is False and dbx.get(DATA) is None)
        ctx.close()
        dbx = FakeDropbox()
        ctx, page, errors = new_page(browser, base, dbx, cloud)
        ok = page.evaluate("()=>syncWithDropbox()")
        check("Automatischer Sync legt ohne Bestätigung nichts an", ok is False and dbx.get(DATA) is None)
        page.on("dialog", lambda d: d.accept())
        ok = page.evaluate("()=>syncWithDropbox({interactive:true})")
        check("Nach Bestätigung angelegt (Modus add)", ok is True and dbx.get(DATA) is not None and dbx.uploads[-1][1] == "add")
        ctx.close()

        print("5) Automatisches Synchronisieren")
        dbx = FakeDropbox(); dbx.put(DATA, json.dumps(cloud).encode())
        local = json.loads(json.dumps(cloud)); local["settings"]["dropboxAutoSync"] = False; local["settings"].pop("_v613AutoSyncDefault", None)
        local["entries"].append({"id": "auto1", "date": "2026-10-26", "start": "08:00", "end": "12:00", "breakMinutes": 0, "manualHours": None, "rate": 170, "updatedAt": "2026-10-26T12:00:00Z"})
        ctx, page, errors = new_page(browser, base, dbx, local)
        until(page, lambda: any(e["id"] == "auto1" for e in (dbx.get(DATA) or {}).get("entries", [])), 12)
        check("Bestehende Installation: Auto-Sync einmalig eingeschaltet", page.evaluate("()=>state.settings.dropboxAutoSync===true&&state.settings._v613AutoSyncDefault===true"))
        check("Beim Start automatisch synchronisiert (neuer Einsatz in Dropbox)", any(e["id"] == "auto1" for e in (dbx.get(DATA) or {}).get("entries", [])))
        n = len(dbx.uploads)
        page.evaluate("()=>{state.entries.push({id:'auto2',date:'2026-10-27',start:'08:00',end:'12:00',breakMinutes:0,manualHours:null,rate:170,updatedAt:new Date().toISOString()});saveState()}")
        until(page, lambda: any(e["id"] == "auto2" for e in dbx.get(DATA)["entries"]), 12)
        check("Nach einer Änderung automatisch gesichert", any(e["id"] == "auto2" for e in dbx.get(DATA)["entries"]) and len(dbx.uploads) > n)
        page.evaluate("()=>{state.settings.dropboxAutoSync=false;state.settings._updatedAt=new Date().toISOString();saveState(false)}")
        page.reload(); page.wait_for_function("()=>!!window.ordipilotSync"); page.wait_for_timeout(2000)
        check("Bewusst abgeschaltet bleibt abgeschaltet", page.evaluate("()=>state.settings.dropboxAutoSync===false"))
        check("Keine JavaScript-Fehler (Auto-Sync)", not errors, "; ".join(errors)[:300])
        ctx.close()

        print("6) Steuer & Belege")
        dbx = FakeDropbox(); dbx.put(DATA, json.dumps(cloud).encode())
        for i in range(3):
            dbx.put(f"/Ordination & Selbständigkeit/Vertretungsdienste/Parkbelege/2026/09/Beleg_{i}.pdf", b"%PDF-1.4 test")
        dbx.put("/Ordination & Selbständigkeit/Vertretungsdienste/Honorarnoten/2026/2026-09_Honorarnote_Muster.pdf", b"%PDF-1.4 test")
        local = json.loads(json.dumps(cloud)); local["settings"] = dict(backup["settings"], **{k: v for k, v in local["settings"].items() if v})
        ctx, page, errors = new_page(browser, base, dbx, local)
        page.wait_for_timeout(2500)
        page.evaluate("()=>{document.querySelector('[data-tab=invoice]').click();ordipilotTax.setYear(2026)}")
        page.wait_for_timeout(300)
        rep = page.evaluate("()=>ordipilotTax.report()")
        exp_services = round(sum(x["gross"] for x in rep["servicesY"]), 2)
        check("Steuer-Karte im Honorar-Bereich sichtbar", page.is_visible("#v614Tax"))
        check("Leistungen = Summe der abgeschlossenen Einsätze", rep["totals"]["services"] == exp_services and exp_services > 0, str(rep["totals"]))
        check("Ohne erfasste Zahlungen: Einnahmen 0, alles offen", rep["totals"]["income"] == 0 and rep["totals"]["open"] == rep["totals"]["services"])
        check("Fehlende Entfernung wird angezeigt", page.is_visible("text=fehlt die Entfernung"))
        # Zahlung über die Oberfläche erfassen
        page.click("#v614Pays summary")
        page.locator("[data-pay]").first.click()
        page.fill("[data-form] [name=date]", "2026-10-03")
        page.locator("[data-save]").first.click()
        rep = page.evaluate("()=>ordipilotTax.report()")
        first = rep["servicesY"][0]
        check("Zahlung erfasst: Monat bezahlt, Einnahme zählt", first["status"] == "bezahlt" and rep["totals"]["income"] == first["gross"], str(first["status"]))
        # Sammelmarkierung
        page.on("dialog", lambda d: d.accept())
        if page.is_visible("#v614Bulk"):
            page.click("#v614Bulk")
        rep = page.evaluate("()=>ordipilotTax.report()")
        check("Sammelmarkierung: ältere Monate bezahlt (Datum offen)", sum(1 for p in rep["income"] if not p.get("paidAt")) >= 1)
        # Entfernung + Fahrt anpassen
        page.click("#v614Trips summary")
        page.locator("[data-reckm]").first.fill("23"); page.locator("[data-reckm]").first.dispatch_event("change")
        rep = page.evaluate("()=>ordipilotTax.report()")
        n_car = len(rep["carTrips"])
        check("Fahrten: je Einsatz 46 km × 0,50 €", n_car == len(rep["trips"]) and all(t["km"] == 46 and t["amount"] == 23 for t in rep["carTrips"]), str(rep["carTrips"][:1]))
        eid = rep["trips"][0]["entryId"]
        page.select_option(f"[data-tripmode='{eid}']", "none")
        rep = page.evaluate("()=>ordipilotTax.report()")
        check("Einsatz ohne Auto zählt nicht", len(rep["carTrips"]) == n_car - 1)
        page.fill("#v614Home", "Teststraße 1, 1050 Wien"); page.locator("#v614Home").dispatch_event("change")
        page.fill("#v614Work", "Klinik Donaustadt, Langobardenstraße 122, 1220 Wien"); page.locator("#v614Work").dispatch_event("change")
        page.locator("[data-reckmwork]").first.fill("25"); page.locator("[data-reckmwork]").first.dispatch_event("change")
        eid2 = rep["trips"][1]["entryId"]
        page.select_option(f"[data-tripmode='{eid2}']", "work")
        rep = page.evaluate("()=>ordipilotTax.report()")
        t2 = next(t for t in rep["trips"] if t["entryId"] == eid2)
        check("Fahrt ab Arbeit: 25 + 23 = 48 km", t2["mode"] == "work" and t2["km"] == 48 and t2["from"].startswith("Klinik"), str(t2)[:200])
        check("Link zum Prüfen der Route vorhanden", page.locator("a.v614-map").count() >= 1)
        page.locator(f"[data-tripkm='{eid2}']").fill("52"); page.locator(f"[data-tripkm='{eid2}']").dispatch_event("change")
        t2 = next(t for t in page.evaluate("()=>ordipilotTax.report()")["trips"] if t["entryId"] == eid2)
        check("Manuelle km behalten den Start ab Arbeit", t2["mode"] == "work" and t2["km"] == 52 and t2["custom"])
        check("Überschuss = Einnahmen − Parken − Fahrten", abs(rep["totals"]["surplus"] - (rep["totals"]["income"] - rep["totals"]["parking"] - rep["totals"]["trips"])) < 0.01)
        # Sync behält Zahlungen und Fahrten
        ok = page.evaluate("()=>syncWithDropbox({interactive:true})")
        cl = dbx.get(DATA)
        check("Sync überträgt Zahlungen und Fahrten", ok and len(cl.get("payments", [])) == len(page.evaluate("()=>state.payments")) and len(cl.get("trips", [])) == 2)
        # Export
        page.click("#v614Export")
        page.wait_for_function("()=>/Steuerpaket erstellt|nicht erstellt/.test(document.getElementById('v614Status').textContent)", timeout=20000)
        status = page.inner_text("#v614Status")
        base_dir = next((k for k in dbx.files if "/steuerberater/2026/stand_" in k), "")
        exported = sorted(dbx.files[k][0].split("/")[-1] for k in dbx.files if "/steuerberater/2026/" in k and k.count("/") == base_dir.count("/"))
        check("Steuerpaket erstellt", "Steuerpaket erstellt" in status, status)
        check("Paket enthält PDF, 4 CSVs und LIESMICH", all(any(n.startswith(p) for n in exported) for p in ["Steueruebersicht_2026.pdf", "Einnahmen_2026.csv", "Leistungen_2026.csv", "Parkkosten_2026.csv", "Fahrten_2026.csv", "LIESMICH.txt"]), str(exported))
        check("Belege in das Paket kopiert", len(dbx.copies) == 2 and "Zahlungsnachweise" in status and any(k.endswith("/parkbelege/09/beleg_0.pdf") and "/steuerberater/" in k for k in dbx.files), str(dbx.copies))
        pdf = next((v[1] for k, v in dbx.files.items() if k.endswith("steueruebersicht_2026.pdf")), b"")
        check("PDF ist gültig", pdf.startswith(b"%PDF") and len(pdf) > 1500, str(len(pdf)))
        csvb = next((v[1] for k, v in dbx.files.items() if k.endswith("einnahmen_2026.csv") and "/steuerberater/" in k), b"")
        csvt = csvb.decode("utf-8-sig")
        check("CSV für Excel: BOM, Semikolon, Dezimalkomma", csvb.startswith(b"\xef\xbb\xbf") and ";" in csvt and "," in csvt.splitlines()[1])
        page.click("#v614Export")
        until(page, lambda: len({k.split("/stand_")[1].split("/")[0] for k in dbx.files if "/stand_" in k}) == 2 and "Steuerpaket erstellt" in page.inner_text("#v614Status"), 15)
        check("Zweiter Export überschreibt nichts (eigener Ordner)", len({k.split("/stand_")[1].split("/")[0] for k in dbx.files if "/stand_" in k}) == 2)
        check("Keine JavaScript-Fehler (Steuer)", not errors, "; ".join(errors)[:300])
        ctx.close()

        print("7) Übersicht Einsätze und Parken")
        dbx = FakeDropbox(); dbx.put(DATA, json.dumps(cloud).encode())
        local = json.loads(json.dumps(cloud))
        local["entries"].append({"id": "plan1", "date": "2099-01-05", "plannedStart": "09:00", "plannedEnd": "13:00", "start": "", "end": "", "planningOnly": True, "breakMinutes": 0, "manualHours": None, "rate": 170, "updatedAt": "2026-10-01T00:00:00Z"})
        local["entries"].append({"id": "conf1", "date": "2026-10-01", "plannedStart": "09:00", "plannedEnd": "13:00", "start": "", "end": "", "planningOnly": True, "breakMinutes": 0, "manualHours": None, "rate": 170, "updatedAt": "2026-10-01T00:00:00Z"})
        local["parkingRecords"].append({"id": "pfree", "date": "2026-09-14", "start": "08:00", "end": "09:00", "amount": 0, "provider": "EasyPark", "entryId": "e4", "updatedAt": "2026-09-01T10:00:00Z"})
        local["parkingRecords"].append({"id": "porphan", "date": "2026-06-22", "start": "15:53", "end": "16:53", "amount": 2.55, "provider": "EasyPark", "entryId": "", "updatedAt": "2026-09-01T10:00:00Z"})
        ctx, page, errors = new_page(browser, base, dbx, local)
        page.evaluate("()=>{document.querySelector('[data-tab=entries]').click();entryYear.value='';renderEntries()}")
        vs = page.evaluate("()=>[...document.querySelectorAll('#entryCards .v611-entry-card')].map(c=>c.dataset.vs+':'+c.dataset.entryId)")
        check("Jeder Einsatz hat einen Status", len(vs) >= len(local["entries"]) - 1 and all(v.split(':')[0] in ("open","today","planned","done","billed") for v in vs), str(vs[:4]))
        check("Geplant und zu bestätigen unterscheiden sich", "planned:plan1" in vs and "open:conf1" in vs, str([v for v in vs if 'plan1' in v or 'conf1' in v]))
        page.evaluate("()=>document.querySelector('#v615Filter [data-f=open]').click()")
        shown = page.evaluate("()=>[...document.querySelectorAll('#entryCards .v611-entry-card:not(.v615-hidden)')].map(c=>c.dataset.entryId)")
        check("Filter „bestätigen“ zeigt nur diese Einsätze", shown == ["conf1"], str(shown))
        page.evaluate("()=>document.querySelector('#v615Filter [data-f=all]').click()")
        page.evaluate("()=>{document.querySelector('[data-tab=parking]').click();parkingYear.value='2026';renderParking()}")
        days = page.evaluate("()=>[...document.querySelectorAll('#parkingCards .v615-day')].length")
        cards = page.evaluate("()=>document.querySelectorAll('#parkingCards .v611-park-card').length")
        check("Parkvorgänge nach Tagen gebündelt, keiner verloren", days > 0 and cards == len([p for p in local["parkingRecords"] if p["date"].startswith("2026")]), f"{days} Tage, {cards} Karten")
        check("Gratis-Parken als „gratis“ markiert", page.evaluate("()=>[...document.querySelectorAll('.v615-free')].length") >= 1)
        check("Parkvorgang ohne Einsatz: Einsatz anlegen möglich", page.locator("[data-v615-newentry='2026-06-22']").count() == 1)
        check("Einsätze ohne Parkbeleg werden gelistet", page.locator("#v615NoPark").count() == 1)
        page.evaluate("()=>{document.querySelector('[data-tab=invoice]').click();ordipilotTax.setYear(2026)}")
        trep = page.evaluate("()=>ordipilotTax.report()")
        check("Steuer: Parkvorgang ohne Einsatz wird nicht abgezogen", any(p["id"] == "porphan" for p in trep["parkingUnassigned"]) and not any(p["id"] == "porphan" for p in trep["parking"]))
        check("Keine JavaScript-Fehler (Übersicht)", not errors, "; ".join(errors)[:300])
        ctx.close()

        print("8) Automatik: Standort, Zahlungsnachweise, Betriebsausgaben, Logo")
        import datetime as _dt
        today = _dt.date.today(); d1 = (today - _dt.timedelta(days=2)).isoformat(); d2 = (today - _dt.timedelta(days=1)).isoformat()
        dbx = FakeDropbox(); dbx.put(DATA, json.dumps(cloud).encode())
        dbx.put(SYSTEM + "/Import/standort.txt", f"{d1}T08:47:10+01:00 ankunft\n{d1}T13:05:00+01:00 abfahrt\n{d2}T13:40:00+01:00 klinik\n{d2}T14:20:00+01:00 ankunft\n{d2}T18:02:00+01:00 abfahrt\n".encode())
        dbx.put("/Ordination & Selbständigkeit/Vertretungsdienste/Zahlungsnachweise/2026/2026-03_Zahlungsnachweis_Muster.pdf", b"%PDF")
        local = json.loads(json.dumps(cloud))
        local["entries"].append({"id": "plan-d2", "date": d2, "plannedStart": "14:00", "plannedEnd": "18:00", "start": "", "end": "", "planningOnly": True, "breakMinutes": 0, "manualHours": None, "rate": 170, "updatedAt": "2026-10-01T00:00:00Z"})
        ctx, page, errors = new_page(browser, base, dbx, local)
        ok = page.evaluate("()=>syncWithDropbox({interactive:true})")
        st = page.evaluate("()=>state")
        g1 = next((e for e in st["entries"] if e["date"] == d1), None)
        g2 = next((e for e in st["entries"] if e["id"] == "plan-d2"), None)
        check("Standort: vergessener Einsatz automatisch angelegt", ok and g1 is not None and g1["id"] == "geo-" + d1 and g1.get("geoArrive") == "08:47" and g1.get("geoLeave") == "13:05", str(g1)[:200])
        check("Standort: Zeiten beim geplanten Einsatz hinterlegt", g2 and g2.get("geoArrive") == "14:20" and g2.get("geoLeave") == "18:02" and g2.get("geoFromWork") is True)
        check("Standort: Fahrt nach Klinik-Abfahrt = „ab Arbeit“", any(t["entryId"] == "plan-d2" and t["mode"] == "work" and t.get("auto") for t in st.get("trips", [])))
        check("Standort: in Dropbox gesichert", any(e["id"] == "geo-" + d1 for e in dbx.get(DATA)["entries"]))
        page.evaluate("()=>{document.querySelector('[data-tab=entries]').click();entryYear.value='';renderEntries()}")
        check("Erkannte Zeiten am Einsatz sichtbar", page.locator(".v616-geo").count() >= 2)
        page.evaluate("()=>openEntry('plan-d2','confirm')")
        check("Bestätigen übernimmt die erkannten Zeiten", page.evaluate("()=>fStart.value+'-'+fEnd.value") == "14:20-18:02")
        page.evaluate("()=>{try{entryModal.close()}catch(e){};document.querySelectorAll('dialog[open]').forEach(d=>d.close())}")
        check("Zahlungsnachweis markiert den Monat als bezahlt", any(p["key"].startswith("2026-03::") and p.get("source") == "proof" for p in st.get("payments", [])))
        # gelöschter Auto-Einsatz kommt nicht zurück
        page.evaluate(f"()=>{{state.deletedEntries=state.deletedEntries||{{}};state.deletedEntries['geo-{d1}']=new Date().toISOString();state.entries=state.entries.filter(e=>e.id!=='geo-{d1}');saveState(false)}}")
        page.evaluate("()=>syncWithDropbox({interactive:true})")
        check("Gelöschter erkannter Einsatz wird nicht wieder angelegt", not any(e["id"] == "geo-" + d1 for e in page.evaluate("()=>state.entries")))
        # Betriebsausgaben
        page.evaluate("()=>{document.querySelector('[data-tab=invoice]').click();ordipilotTax.setYear(2026)}")
        page.click("#v616ExpOn")
        page.fill("#v616ExpDate", "2026-03-15"); page.fill("#v616ExpAmount", "480"); page.select_option("#v616ExpCat", "Telefon & Internet (Anteil)")
        page.fill("#v616ExpNote", "Handy"); page.click("#v616ExpAdd")
        trep = page.evaluate("()=>ordipilotTax.report()")
        check("Betriebsausgabe mit Anteil (50 % von 480 € = 240 €)", trep["totals"]["other"] == 240 and trep["expenses"][0]["share"] == 50, str(trep["totals"]))
        check("Überschuss berücksichtigt weitere Ausgaben", abs(trep["totals"]["surplus"] - (trep["totals"]["income"] - trep["totals"]["parking"] - trep["totals"]["trips"] - 240)) < 0.01)
        files = page.evaluate("async()=>{const r=await ordipilotTax.buildFiles();return r.files.map(f=>f.name)}")
        check("Steuerpaket enthält Weitere_Ausgaben_2026.csv", "Weitere_Ausgaben_2026.csv" in files, str(files))
        page.evaluate("()=>syncWithDropbox({interactive:true})")
        check("Betriebsausgaben werden synchronisiert", len(dbx.get(DATA).get("expenses", [])) == 1)
        check("Neues Logo in der Kopfzeile", page.evaluate("()=>document.querySelector('.logo.brand-mark').dataset.v616==='1'"))
        check("Standort-Anleitung vorhanden", page.evaluate("()=>!!document.getElementById('v616Guide')"))
        check("Keine JavaScript-Fehler (Automatik)", not errors, "; ".join(errors)[:300])
        ctx.close()

        print("9) Honorarnote ohne Signatur: erstellen, ablegen, senden")
        dbx = FakeDropbox(); dbx.put(DATA, json.dumps(cloud).encode())
        local = json.loads(json.dumps(cloud)); local["settings"] = dict(backup["settings"], issuerQualification="Facharzt", recipients=[{"id": "recipient-primary", "name": "Dr. med. Erika Muster", "address": "Ordinationsweg 2\n2100 Korneuburg", "email": "praxis@example.org", "salutation": "Sehr geehrte Frau Dr. Muster,", "signoffName": "Dr. Test Arzt"}], activeRecipientId="recipient-primary", _updatedAt="2026-10-20T00:00:00Z")
        for e in local["entries"]:
            e["recipientId"] = "recipient-primary"
        ctx, page, errors = new_page(browser, base, dbx, local)
        page.evaluate("()=>{window.__shared=null;navigator.canShare=()=>true;navigator.share=async d=>{window.__shared=d.files.map(f=>f.name)}}")
        page.on("dialog", lambda d: d.accept())
        page.evaluate("()=>{document.querySelector('[data-tab=invoice]').click();invYear.value='2026';invMonth.value='03';invMonth.dispatchEvent(new Event('change'));renderInvoice()}")
        label = page.inner_text("#makePdf")
        check("Ohne Signatur: ein Knopf „erstellen & senden“", "senden" in label.lower() and not page.is_visible("#invoiceStartSign"), label)
        page.click("#makePdf")
        until(page, lambda: page.evaluate("()=>!!window.__shared"), 20)
        rec = page.evaluate("()=>invoiceRecord()")
        shared = page.evaluate("()=>window.__shared")
        stored = [k for k in dbx.files if "/honorarnoten/2026/" in k]
        check("PDF erstellt und im Mail-/Teilen-Dialog angehängt", bool(shared) and shared[0].endswith(".pdf"), str(shared))
        check("Automatisch in Dropbox abgelegt (Honorarnoten/2026)", len(stored) == 1 and dbx.files[stored[0]][1].startswith(b"%PDF"), str(stored))
        check("Als versendet markiert, Monat abgerechnet", bool(rec and rec.get("mailOpenedAt")) and page.evaluate("()=>ordipilotRecipientMonthLocked('2026-03','recipient-primary')"))
        check("Anzeige „Versendet am …“", page.locator("#v617Sent").count() == 1)
        page.click("#v617Reset")
        check("„Doch nicht gesendet“ entsperrt den Monat, Nummer bleibt", page.evaluate("()=>!invoiceRecord().mailOpenedAt&&!ordipilotRecipientMonthLocked('2026-03','recipient-primary')&&invoiceRecord().number===%s" % json.dumps(rec.get("number"))))
        # Kurzbefehl: erst nach Rückfrage als gesendet
        page.evaluate("()=>{localStorage.setItem('ordipilot-v617-pending-send',JSON.stringify({key:invoiceRecord().key,number:'X',at:Date.now()-5000}))}")
        page.evaluate("()=>ordipilotAskPendingSend()")
        check("Nach Rückkehr vom Kurzbefehl: Rückfrage, dann als gesendet markiert", page.evaluate("()=>!!invoiceRecord().mailOpenedAt"))
        page.evaluate("()=>{document.querySelector('#v617Toggle input').click()}")
        check("Signatur je Empfänger wieder einschaltbar", page.is_visible("#invoiceStartSign") and page.evaluate("()=>state.settings.recipients[0].requiresSignature===true"))
        check("Keine JavaScript-Fehler (Senden)", not errors, "; ".join(errors)[:300])
        ctx.close()

        print("10) Versand direkt über Gmail (Apps-Script-Web-App)")
        dbx = FakeDropbox(); dbx.put(DATA, json.dumps(cloud).encode())
        local = json.loads(json.dumps(cloud)); local["settings"] = dict(backup["settings"], issuerQualification="Facharzt", recipients=[{"id": "recipient-primary", "name": "Dr. med. Erika Muster", "address": "Ordinationsweg 2\n2100 Korneuburg", "email": "praxis@example.org", "salutation": "Sehr geehrte Frau Dr. Muster,", "signoffName": "Dr. Test Arzt"}], activeRecipientId="recipient-primary", _updatedAt="2026-10-20T00:00:00Z")
        for e in local["entries"]:
            e["recipientId"] = "recipient-primary"
        ctx, page, errors = new_page(browser, base, dbx, local)
        calls = []; gmail_fail = {"on": False}
        def webapp(route, request):
            d = json.loads(request.post_data or "{}"); calls.append(d)
            if d.get("token") != "geheim": body = {"ok": False, "error": "Schlüssel ungültig"}
            elif d.get("action") == "ping": body = {"ok": True, "account": "arzt@example.org"}
            elif gmail_fail["on"]: body = {"ok": False, "error": "Tageslimit erreicht"}
            else: body = {"ok": True, "sentAt": "2026-10-28T19:30:00.000Z", "to": d.get("to")}
            route.fulfill(status=200, headers={"content-type": "application/json", "access-control-allow-origin": "*"}, body=json.dumps(body))
        ctx.route("https://script.google.com/**", webapp)
        page.evaluate("()=>{window.__shared=null;navigator.canShare=()=>true;navigator.share=async d=>{window.__shared=d.files.map(f=>f.name)}}")
        page.on("dialog", lambda d: d.accept())
        page.evaluate("()=>{document.querySelector('[data-tab=invoice]').click();invYear.value='2026';invMonth.value='04';invMonth.dispatchEvent(new Event('change'));renderInvoice()}")
        page.evaluate("()=>document.getElementById('v618Gmail').open=true")
        page.fill("#v618Url", "https://script.google.com/macros/s/TEST/exec"); page.locator("#v618Url").dispatch_event("change")
        page.fill("#v618Token", "geheim"); page.locator("#v618Token").dispatch_event("change")
        page.click("#v618Test")
        until(page, lambda: "Verbunden" in page.inner_text("#v618TestResult"), 10)
        check("Gmail-Versand: Verbindung testen", "arzt@example.org" in page.inner_text("#v618TestResult"))
        page.click("#makePdf")
        until(page, lambda: bool((page.evaluate("()=>invoiceRecord()") or {}).get("mailOpenedAt")), 20)
        rec = page.evaluate("()=>invoiceRecord()")
        send = next((c for c in calls if c.get("action") == "send"), {})
        check("Gmail-Versand: Mail mit Pfad, Empfänger und Betreff an die Web-App", send.get("to") == "praxis@example.org" and send.get("path", "").endswith(".pdf") and "/Honorarnoten/2026/" in send.get("path", "") and "April 2026" in send.get("subject", ""), str(send)[:250])
        check("Gmail-Versand: sofort als gesendet markiert, ohne Teilen-Dialog", rec.get("mailSentVia") == "gmail" and page.evaluate("()=>window.__shared") is None)
        check("Gmail-Versand: PDF liegt in Dropbox, bevor gesendet wird", any(k.endswith(".pdf") and "/honorarnoten/2026/" in k for k in dbx.files))
        # Fehlerfall → Rückfall auf Teilen
        page.evaluate("()=>ordipilotResetSent()")
        gmail_fail["on"] = True
        page.click("#makePdf")
        until(page, lambda: page.evaluate("()=>!!window.__shared"), 20)
        check("Gmail-Fehler: verständliche Meldung und Rückfall auf Teilen", bool(page.evaluate("()=>window.__shared")))
        check("Keine JavaScript-Fehler (Gmail-Versand)", not errors, "; ".join(errors)[:300])
        ctx.close()

        print("4) Update-Pfad vom alten Service Worker (6.11.3) auf die aktuelle Version")
        tmp = tempfile.mkdtemp()
        old = os.path.join(tmp, "app"); os.makedirs(old)
        # Stand 6.11.3 = letzter Commit vor V6.12 (Hash hat sich durch die Historien-Bereinigung geändert)
        old_rev = subprocess.run(["git", "-C", ROOT, "log", "--all", "-1", "--format=%H", "--grep=Fix legacy path assertion in release validator"], capture_output=True, text=True).stdout.strip()
        if not old_rev or subprocess.run(["git", "-C", ROOT, "archive", old_rev, "-o", os.path.join(tmp, "old.tar")]).returncode != 0:
            print("  (übersprungen: Stand 6.11.3 nicht im Checkout)"); browser.close(); srv.shutdown(); return finish()
        subprocess.run(["tar", "-xf", os.path.join(tmp, "old.tar"), "-C", old], check=True)
        srv2 = serve(old); base2 = f"http://127.0.0.1:{srv2.server_address[1]}"
        dbx = FakeDropbox(); dbx.put(DATA, json.dumps(cloud).encode())
        ctx = browser.new_context(); ctx.route("https://*.dropboxapi.com/**", dbx.handle)
        page = ctx.new_page(); errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base2 + "/index.html"); page.wait_for_function("()=>navigator.serviceWorker.controller||false", timeout=15000)
        page.reload(); page.wait_for_timeout(800)
        check("Alte Version: Hotfix wird eingeschleust (Ausgangslage)", page.evaluate("()=>!!document.querySelector('script[src*=v6113]')"))
        for f in ["index.html", "service-worker.js", "manifest.webmanifest"]:
            shutil.copy(os.path.join(ROOT, f), os.path.join(old, f))
        shutil.copytree(os.path.join(ROOT, "icons"), os.path.join(old, "icons"), dirs_exist_ok=True)
        page.reload(); page.wait_for_timeout(1500)
        check("Übergang: alter Worker schleust nichts mehr ein", page.evaluate("()=>!document.querySelector('script[src*=v6113]')"))
        page.wait_for_function("()=>navigator.serviceWorker.getRegistration().then(r=>!!r&&!!r.active&&r.active.scriptURL.includes('service-worker'))")
        page.reload(); page.wait_for_function("()=>!!window.ordipilotSync")
        until(page, lambda: page.evaluate("()=>caches.keys()") == [CACHE_NAME], 15)
        cache = page.evaluate("()=>caches.keys()")
        check("Neuer Worker aktiv, alter Cache gelöscht", cache == [CACHE_NAME], str(cache))
        check(f"Danach Version {VERSION}", page.evaluate("()=>[...document.querySelectorAll('.footer-note')].some(e=>/"+VERSION_RE+"/.test(e.textContent))"))
        check("Keine JavaScript-Fehler im Update-Pfad", not errors, "; ".join(errors)[:300])
        ctx.close(); srv2.shutdown()
        browser.close()
    srv.shutdown()
    finish()


def finish():
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} Prüfungen bestanden")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        print(tb)
        if os.environ.get("GITHUB_ACTIONS"):
            last = [l.strip() for l in tb.strip().splitlines() if l.strip()][-6:]
            print("::error title=Browser-Test abgebrochen::" + " | ".join(last).replace("\n", " ")[:900])
        sys.exit(1)
