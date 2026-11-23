import json
import re
import secrets
import subprocess
import time
import urllib.request
import xml.etree.ElementTree as ET

PACKAGE = "kr.ac.ssu.qletter.debug"
EMAIL = "report73@example.com"


def shell(*args):
    return subprocess.check_output(["adb", "shell", *args], encoding="utf-8", timeout=20)


def visible(view_id, expected_text=""):
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        if "dumped" in shell("uiautomator", "dump", "/sdcard/pr73.xml").lower():
            tree = ET.fromstring(shell("cat", "/sdcard/pr73.xml").strip())
            for node in tree.iter("node"):
                if node.get("resource-id") == PACKAGE + ":id/" + view_id and expected_text in node.get("text", ""):
                    bounds = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
                    if len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
                        return bounds
        time.sleep(0.5)
    raise AssertionError("화면 항목 확인 실패: " + view_id)


def tap(view_id):
    left, top, right, bottom = visible(view_id)
    shell("input", "tap", str((left + right) // 2), str((top + bottom) // 2))


def start():
    shell("am", "start", "-W", "-n", PACKAGE + "/kr.ac.ssu.qletter.auth.AuthActivity")


def report():
    tap("tab_reports")
    visible("report_message", "아직 저장된 리포트가 없어요")


password = secrets.token_hex(16)
request = urllib.request.Request("http://127.0.0.1:3000/v1/auth/registrations",
    data=json.dumps({"email": EMAIL, "password": password, "nickname": "Review73"}).encode(),
    headers={"Content-Type": "application/json"})
with urllib.request.urlopen(request, timeout=30) as response:
    assert response.status == 202
subprocess.run(["bun", "run", "wrangler", "d1", "execute", "DB", "--local", "--command",
    "UPDATE users SET email_verified_at=unixepoch() WHERE email='report73@example.com'"], check=True)
start()
tap("login_email")
shell("input", "text", EMAIL)
tap("login_password")
shell("input", "text", password)
shell("input", "keyevent", "KEYCODE_BACK")
tap("login_submit")
report()
print("PASS 로그인 및 인증된 리포트 빈 목록", flush=True)
shell("am", "force-stop", PACKAGE)
start()
report()
print("PASS 앱 재실행 후 세션 복원", flush=True)
shell("settings", "put", "system", "accelerometer_rotation", "0")
shell("settings", "put", "system", "user_rotation", "1")
visible("report_search")
shell("settings", "put", "system", "font_scale", "2.0")
visible("report_search")
visible("report_search_button")
assert shell("settings", "get", "system", "font_scale").strip() == "2.0"
assert re.search(r"\bland\b", shell("am", "get-config"))
print("PASS 가로 화면·글꼴 2배에서 검색 입력 및 버튼 표시", flush=True)
