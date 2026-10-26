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


def new_page(browser, base, dbx, local_state=None):
    ctx = browser.new_context()
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
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("  ✓ " if cond else "  ✗ ") + name + (f"  [{detail}]" if detail and not cond else ""))


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
        check(f"Version {VERSION} sichtbar", page.evaluate("()=>[...document.querySelectorAll('.footer-note')].some(e=>/"+VERSION_RE+"/.test(e.textContent))"))
        check("Kein Hotfix-Skript eingeschleust", page.evaluate("()=>!document.querySelector('script[src*=v6113]')"))
        check("Keine JavaScript-Fehler", not errors, "; ".join(errors)[:300])
        uploads_before = len(dbx.uploads)
        page.evaluate("()=>syncDropbox.onclick()")
        page.wait_for_timeout(1500)
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
        page.wait_for_timeout(3500)
        check("Bestehende Installation: Auto-Sync einmalig eingeschaltet", page.evaluate("()=>state.settings.dropboxAutoSync===true&&state.settings._v613AutoSyncDefault===true"))
        check("Beim Start automatisch synchronisiert (neuer Einsatz in Dropbox)", any(e["id"] == "auto1" for e in (dbx.get(DATA) or {}).get("entries", [])))
        n = len(dbx.uploads)
        page.evaluate("()=>{state.entries.push({id:'auto2',date:'2026-10-27',start:'08:00',end:'12:00',breakMinutes:0,manualHours:null,rate:170,updatedAt:new Date().toISOString()});saveState()}")
        page.wait_for_timeout(3500)
        check("Nach einer Änderung automatisch gesichert", any(e["id"] == "auto2" for e in dbx.get(DATA)["entries"]) and len(dbx.uploads) > n)
        page.evaluate("()=>{state.settings.dropboxAutoSync=false;state.settings._updatedAt=new Date().toISOString();saveState(false)}")
        page.reload(); page.wait_for_function("()=>!!window.ordipilotSync"); page.wait_for_timeout(2000)
        check("Bewusst abgeschaltet bleibt abgeschaltet", page.evaluate("()=>state.settings.dropboxAutoSync===false"))
        check("Keine JavaScript-Fehler (Auto-Sync)", not errors, "; ".join(errors)[:300])
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
        page.reload(); page.wait_for_timeout(1500)
        check("Übergang: alter Worker schleust nichts mehr ein", page.evaluate("()=>!document.querySelector('script[src*=v6113]')"))
        page.wait_for_function("()=>navigator.serviceWorker.getRegistration().then(r=>!!r&&!!r.active&&r.active.scriptURL.includes('service-worker'))")
        page.reload(); page.wait_for_function("()=>!!window.ordipilotSync")
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
    main()
