"""Firefox end-to-end SMS authentication with a local-only fake sender."""
import json
import os
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix="transit-firefox-") as tmp:
        capture = Path(tmp) / "codes.json"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        origin = f"http://localhost:{port}"
        env = os.environ.copy()
        env.update(TEST_SMS_CAPTURE_FILE=str(capture), TEST_SMS_PORT=str(port))
        proc = subprocess.Popen(
            ["node", str(ROOT / "tests" / "fixture-sms-server.js")],
            cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
        )
        try:
            for _ in range(100):
                if proc.poll() is not None:
                    raise AssertionError(f"Fixture exited unexpectedly: {proc.stdout.read()}")
                try:
                    with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as response:
                        assert json.load(response)["authMode"] == "sms"
                    break
                except Exception:
                    time.sleep(0.15)
            else:
                raise AssertionError("Fixture did not become ready")

            with sync_playwright() as playwright:
                browser = playwright.firefox.launch(headless=True)
                context = browser.new_context(viewport={"width": 1080, "height": 900})
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(origin, wait_until="domcontentloaded")
                expect(page.locator("#driverPhoneLogin")).to_be_visible(timeout=12000)
                expect(page.locator("#companyLogin")).to_be_visible()
                def get_code(phone):
                    for _ in range(80):
                        if capture.exists():
                            codes = json.loads(capture.read_text())
                            if phone in codes:
                                return codes[phone]
                        time.sleep(0.1)
                    raise AssertionError("OTP was not dispatched in test fixture")
                def verify(phone):
                    code = get_code(phone)
                    expect(page.locator("#companyOtp")).to_be_visible()
                    page.locator("#companyOtp [name=code]").fill(code)
                    page.locator("#companyOtp button[type=submit]").click()
                    expect(page.locator("#companyWorkspace")).to_be_visible(timeout=12000)

                # Driver: no password required, Persian digit input accepted.
                page.locator("#driverPhoneLogin [name=phone]").fill("۰۹۱۲۱۲۳۴۵۶۷")
                page.locator("#driverPhoneLogin button[type=submit]").click()
                verify("+989121234567")
                expect(page.locator("#companyWorkspace")).to_contain_text("راننده")
                page.locator("#companyWorkspace").get_by_role("button", name="خروج", exact=True).click()
                expect(page.locator("#companyLogin")).to_be_visible()

                for username, phone, role_label in [
                    ("accounts", "+905321234567", "حسابداری"),
                    ("admin", "+989121234568", "مدیر شرکت"),
                ]:
                    page.locator("#companyLogin [name=username]").fill(username)
                    page.locator("#companyLogin [name=password]").fill("fixture-password-123456")
                    page.locator("#companyLogin button[type=submit], #companyLogin button").first.click()
                    expect(page.locator("#companyWorkspace")).to_be_hidden()
                    verify(phone)
                    expect(page.locator("#companyWorkspace")).to_contain_text(role_label)
                    page.locator("#companyWorkspace").get_by_role("button", name="خروج", exact=True).click()
                    expect(page.locator("#companyLogin")).to_be_visible()
                assert not errors, errors
                context.close()
                browser.close()
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()


if __name__ == "__main__":
    main()
