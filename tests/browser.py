"""Run against a fresh isolated backend, using installed Python Playwright and Chromium."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
from tempfile import TemporaryDirectory
import time
from urllib.request import urlopen
from uuid import uuid4

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
IMAGE = ROOT / "icon-192.png"


def eventually(page, condition):
    for _ in range(100):
        if page.evaluate(condition):
            return
        page.wait_for_timeout(75)
    raise AssertionError(condition)


def exercise(browser, origin, password, tmp):
    errors = []
    console = []
    context = browser.new_context(viewport={"width": 390, "height": 844}, accept_downloads=True)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda entry: console.append(entry.text) if entry.type == "error" else None)
    page.on("dialog", lambda dialog: dialog.dismiss() if "مایل هستید" in dialog.message else dialog.accept())
    page.goto(origin + "/privacy.html")
    page.evaluate("Promise.all([caches.open('transit-fuel-pwa-old'), caches.open('other-app-cache')]).then(() => true)")
    page.goto(origin)
    eventually(page, "storageReady && Boolean(navigator.serviceWorker.controller)")
    assert page.evaluate("caches.keys()").count("other-app-cache") == 1
    assert "transit-fuel-pwa-old" not in page.evaluate("caches.keys()")
    page.locator("[data-action=openInstallGuideModal]").click()
    expect(page.locator("#installGuideModal")).to_have_class("modal-backdrop open")
    page.locator("#installGuideModal button.close-btn").click()
    assert page.evaluate("document.documentElement.dir") == "rtl"
    for width in (320, 390, 768, 1366):
        page.set_viewport_size({"width": width, "height": 900})
        assert page.evaluate("document.documentElement.scrollWidth === innerWidth"), width
    assert page.evaluate("new Set([...document.querySelectorAll('[id]')].map(e=>e.id)).size === document.querySelectorAll('[id]').length")
    assert abs(page.evaluate("calculateMetrics().totalConsumed") - 831.2) < 1e-8
    page.locator("#tripTitle").fill("سفر پذیرش")
    page.locator("#initialFuel").fill("1300")
    page.locator("#bfAmount").fill("75")
    page.evaluate("addBorderFuelItem()")
    page.locator("#expTitle").fill("رسید آزمایشی")
    page.locator("#expAmount").fill("100")
    page.locator("#expReceiptInput").set_input_files(IMAGE)
    eventually(page, "pendingReceiptDataUrl.startsWith('data:image/jpeg')")
    page.evaluate("addTripExpenseItem()")
    page.locator("#tripExpenseTableBody .receipt-thumb").click()
    expect(page.locator("#imageModal")).to_have_class("modal-backdrop open")
    page.evaluate("closeImageModal()")
    page.locator("#fbMessage").fill("بازخورد محلی")
    page.evaluate("submitUserFeedback()")
    expect(page.locator("#feedbackListContainer")).to_contain_text("بازخورد محلی")
    for export, ext in [("Txt", "txt"), ("Csv", "csv"), ("Png", "png")]:
        with page.expect_download() as info:
            page.evaluate(f"shareOrDownload{export}Report()")
        data = Path(info.value.path()).read_bytes()
        assert info.value.suggested_filename.endswith("." + ext) and len(data) > 40
        if ext == "txt":
            assert "محرمانه" in data.decode()
        if ext == "png":
            assert data.startswith(b"\x89PNG")
    page.evaluate("window.printCalled=false; const append = document.body.appendChild.bind(document.body); document.body.appendChild=(frame)=>{if(frame.tagName==='IFRAME'){const loaded=frame.onload;frame.onload=()=>{frame.contentWindow.print=()=>{window.printCalled=frame.contentDocument.body.innerText.includes('سفر پذیرش')};loaded()}}return append(frame)}; void 0")
    page.get_by_role("button", name="چاپ گزارش").click()
    eventually(page, "window.printCalled")
    with page.expect_download() as info:
        page.get_by_role("button", name="پشتیبان کامل").click()
    backup = Path(tmp) / "backup.json"
    info.value.save_as(backup)
    assert json.loads(backup.read_text())["draft"]["tripExpenses"][0]["receiptImage"].startswith("data:image/jpeg")
    page.evaluate("saveCurrentTripToArchive()")
    expect(page.locator("#archiveCountBadge")).to_have_text("۱")
    page.evaluate("openArchiveModal()")
    page.locator("#archiveSearch").fill("no such trip")
    expect(page.locator("#archiveListContainer .archive-item")).to_have_count(0)
    page.locator("#archiveSearch").fill("پذیرش")
    page.locator("#archiveModal").get_by_role("button", name="بارگذاری").click()
    page.locator("#tripTitle").fill("ویرایش سفر")
    page.evaluate("saveCurrentTripToArchive()")
    eventually(page, "loadArchive()[0].data.tripTitle === 'ویرایش سفر'")
    assert page.evaluate("loadArchive().length") == 1
    page.locator("input[accept='.json']").set_input_files(backup)
    expect(page.locator("#tripTitle")).to_have_value("سفر پذیرش")
    eventually(page, "loadArchive().length === 0")
    page.reload()
    eventually(page, "storageReady")
    expect(page.locator("#tripTitle")).to_have_value("سفر پذیرش")
    expect(page.locator("#tripExpenseTableBody img")).to_have_count(1)

    def login(username):
        form = page.locator("#companyLogin")
        form.locator("[name=username]").fill(username)
        form.locator("[name=password]").fill(password)
        form.get_by_role("button", name="ورود").click()
        expect(page.locator("#companyWorkspace")).to_be_visible()

    def company(name):
        return page.locator("#companyWorkspace").get_by_role("button", name=name, exact=True)

    login("driver")
    expect(company("ارسال سفر فعلی")).to_be_visible()
    context.set_offline(True)
    page.reload(wait_until="load")
    eventually(page, "storageReady")
    expect(page.locator("#tripTitle")).to_have_value("سفر پذیرش")
    context.set_offline(False)
    expect(company("ارسال سفر فعلی")).to_be_visible()
    context.set_offline(True)
    company("ارسال سفر فعلی").click()
    expect(page.locator("#companyWorkspace")).to_contain_text("در صف ارسال: سفر پذیرش")
    context.set_offline(False)
    submitted = page.locator("#companyWorkspace").get_by_role("button", name="ارسال‌شده", exact=False)
    expect(submitted).to_be_visible(timeout=12000)
    expect(page.locator("#companyWorkspace")).not_to_contain_text("در صف ارسال:")
    company("خروج").click()
    login("accounts")
    expect(submitted).to_be_visible()
    submitted.click()
    expect(company("تصویر سند")).to_be_visible()
    company("تصویر سند").click()
    expect(page.locator("#imageModal")).to_have_class("modal-backdrop open")
    page.evaluate("closeImageModal()")
    company("بازبینی").click()
    page.locator("#companyWorkspace").get_by_role("button", name="بازبینی‌شده", exact=False).click()
    company("تأیید").click()
    page.locator("#companyWorkspace").get_by_role("button", name="تأییدشده", exact=False).click()
    page.get_by_text("یادداشت حسابداری", exact=False).locator("input").fill("شماره رسید آزمون")
    company("ثبت تسویه").click()
    expect(page.locator("#companyWorkspace").get_by_role("button", name="تسویه‌شده", exact=False)).to_be_visible()
    assert not errors, errors
    unexpected = [entry for entry in console if not any(ok in entry for ok in ("ERR_INTERNET_DISCONNECTED", "ERR_FAILED"))]
    assert not unexpected, unexpected
    context.close()


def migration(browser, origin):
    context = browser.new_context()
    page = context.new_page()
    page.add_init_script("""if (!localStorage.getItem('legacy-test')) {
        localStorage.setItem('legacy-test','1');
        localStorage.setItem('transit_fuel_app_current_v5', JSON.stringify({tripTitle:'سفر قدیمی',initialFuel:950}));
        localStorage.setItem('transit_fuel_app_archive_v5', JSON.stringify([{archiveId:'legacy',data:{tripTitle:'آرشیو قدیمی'}}]));
        localStorage.setItem('transit_fuel_user_feedbacks_v1', JSON.stringify([{id:'old',message:'بازخورد قدیمی'}]));
    }""")
    page.goto(origin)
    eventually(page, "storageReady")
    expect(page.locator("#tripTitle")).to_have_value("سفر قدیمی")
    assert page.evaluate("loadArchive()[0].archiveId") == "legacy"
    assert page.evaluate("loadUserFeedbacks()[0].id") == "old"
    page.locator("#tripTitle").fill("پس از مهاجرت")
    eventually(page, "document.getElementById('lastSavedLabel').textContent.includes('ذخیره خودکار')")
    page.reload()
    eventually(page, "storageReady")
    expect(page.locator("#tripTitle")).to_have_value("پس از مهاجرت")
    assert "سفر قدیمی" in page.evaluate("localStorage.getItem('transit_fuel_app_current_v5')")
    context.close()


if __name__ == "__main__":
    with TemporaryDirectory(prefix="transit-browser-") as temp:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        origin = f"http://127.0.0.1:{port}"
        password = str(uuid4())
        db = str(Path(temp) / "app.sqlite")
        env = {**os.environ, "TRANSIT_DB": db, "TRANSIT_PORT": str(port), "TRANSIT_ORIGIN": origin}
        seed = """const {openDatabase,insertUser}=require('./server/app');
          const fs=require('node:fs'), cp=require('node:crypto'), db=openDatabase(process.env.TRANSIT_DB);
          const password=fs.readFileSync(0,'utf8');
          for(const [username,role] of [['driver','driver'],['accounts','accounting']])
            insertUser(db,{username,name:username,role,password});
          db.prepare('INSERT INTO vehicles (id,plate) VALUES (?,?)').run(cp.randomUUID(),'خودروی آزمون');db.close();"""
        subprocess.run(["node", "-e", seed], cwd=ROOT, env=env, input=password, text=True, check=True)
        server = subprocess.Popen(["node", "server/app.js"], cwd=ROOT, env=env)
        try:
            for _ in range(80):
                try:
                    with urlopen(origin + "/api/health", timeout=1) as response:
                        assert response.status == 200
                    break
                except OSError:
                    if server.poll() is not None:
                        raise RuntimeError("Backend exited")
                    time.sleep(0.05)
            else:
                raise RuntimeError("Backend health check timed out")
            with sync_playwright() as playwright:
                chromium = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
                browser = playwright.chromium.launch(executable_path=chromium, args=["--no-proxy-server"])
                migration(browser, origin)
                print("PASS: localStorage migration and IndexedDB precedence", flush=True)
                exercise(browser, origin, password, temp)
                print("PASS: RTL viewports, receipts, reports, archive, backup/restore, offline queue and settlement", flush=True)
        finally:
            server.terminate()
            server.wait(timeout=10)
