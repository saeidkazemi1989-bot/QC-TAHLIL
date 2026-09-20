#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E2E: اجرای کامل run_gui با tkinter شبیه‌سازی‌شده (بدون نمایشگر)"""
import os
import queue
import sys
import threading
import types
from pathlib import Path

import qc as B

_real_threading = threading
BUTTONS = []
ENTRIES = []
# شبیه‌سازی پنجرهٔ فعال‌سازی: اگر activate=True، wait_window کلید را وارد و «فعال‌سازی» را می‌زند
DIALOG_SIM = {"activate": False, "key": None}


class _W:
    def __init__(self, *a, **k):
        self._k = k
        self.v = k.get("text", "")
        if "command" in k:
            self.cmd = k["command"]

    def pack(self, *a, **k): pass
    def grid(self, *a, **k): pass
    def config(self, *a, **k):
        if "command" in k:
            self.cmd = k["command"]
    def get(self):
        return self.v or ""
    def __bool__(self): return True
    def __str__(self): return self.v or ""
    def __getattr__(self, n):
        def f(*a, **k): return ""
        return f


class _Btn(_W):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        BUTTONS.append(self)


class _Entry:
    def __init__(self, *a, **k):
        self.v = ""
        ENTRIES.append(self)

    def insert(self, i, s, *a2): self.v += s
    def delete(self, *a): self.v = ""
    def get(self): return self.v
    def pack(self, *a, **k): pass
    def config(self, *a, **k): pass
    def __getattr__(self, n):
        def f(*a, **k): return ""
        return f


class _Text:
    def __init__(self, *a, **k):
        self.v = ""

    def insert(self, *a): pass
    def get(self, *a): return self.v
    def yview(self, *a): return (0, 1)
    def __getattr__(self, n):
        def f(*a, **k): return ""
        return f


class _Misc:
    def __init__(self, *a, **k): pass
    def title(self, *a): self._title = a[0] if a else ""
    def geometry(self, *a): pass
    def destroy(self): pass
    def update_idletasks(self): pass
    def update(self): pass
    def after(self, ms, f=None, *a): return 1
    def mainloop(self): pass
    def wait_window(self, *a):
        # شبیه‌سازی کاربر: اگر فعال‌سازی خواسته شد، کلید را در آخرین فیلد بزن
        if DIALOG_SIM.get("activate") and DIALOG_SIM.get("key"):
            if ENTRIES:
                ENTRIES[-1].v = DIALOG_SIM["key"]
            for b in reversed(BUTTONS):
                if b.v.replace("\u200c", "") == "فعالسازی":
                    b.cmd()
                    break
        return ""
    def __getattr__(self, n):
        def f(*a, **k):
            if n == "photoimage":
                raise RuntimeError("no display")
            return _W(*a, **k)
        return f


_REPO_ROOT = Path(__file__).resolve().parent
_BY_TITLE = {
    "اطلاعات جامع کیفیت حین تولید:": str(_REPO_ROOT / "اطلاعات جامع کیفیت حین تولید (9).xlsx"),
    "گزارش عیب های سند بازرسی:": str(_REPO_ROOT / "گزارش عیب های سند بازرسی (8).xlsx"),
    "گزارش تعداد تولید به تفکیک سند عملکرد:": str(_REPO_ROOT / "گزارش تعداد تولید به تفکیک سند عملکرد (2).xlsx"),
    "گروه بندی محصولات:": str(_REPO_ROOT / "گروه بندی محصولات.xlsx"),
    "رپورت ماه قبل (برای ادامه بدون تکرار):": "",
}
OUT = "/tmp/gui_brand_out.xlsx"


def _fd():
    class FD:
        def askopenfilename(self, *a, **k): return _BY_TITLE.get(k.get("title", ""), "")
        def asksaveasfilename(self, *a, **k): return OUT
    return FD()


tk = types.ModuleType("tkinter")
tk.Tk = _Misc
tk.Frame = _W
tk.Label = _W
tk.Entry = _Entry
tk.Button = _Btn
tk.Checkbutton = _W
tk.Toplevel = _W
tk.Text = _Text
tk.Scrollbar = _W
tk.CHECKBUTTON = "check"
tk.END = "end"
tk.PhotoImage = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no display"))
tk.StringVar = _W
tk.BooleanVar = _W
tk.IntVar = _W
tk.DoubleVar = _W

tkd = types.ModuleType("tkinter.filedialog")
tkd.askopenfilename = _fd().askopenfilename
tkd.asksaveasfilename = _fd().asksaveasfilename
tkm = types.ModuleType("tkinter.messagebox")
WARNINGS = []
tkm.showinfo = lambda *a, **k: "ok"
tkm.showwarning = lambda *a, **k: WARNINGS.append((a, k)) or "w"
tkm.showerror = lambda *a, **k: (_ for _ in ()).throw(RuntimeError(str(a[1])))

sys.modules["tkinter"] = tk
sys.modules["tkinter.filedialog"] = tkd
sys.modules["tkinter.messagebox"] = tkm


class _FakeThread(threading.Thread):
    """Thread که target را هم‌زمان روی رشتهٔ فراخوان اجرا می‌کند"""
    def start(self):
        if self._target:
            self._target(*self._args, **(self._kwargs or {}))


def fake_threading_module():
    m = types.ModuleType("threading")
    for n in dir(_real_threading):
        if not n.startswith("_"):
            setattr(m, n, getattr(_real_threading, n))
    m.Thread = _FakeThread   # بعد از حلقه، تا با Thread واقعی جابه‌جا نشود
    return m


_QINST = []
_REAL_QUEUE = queue.Queue


class _TrackedQueue(_REAL_QUEUE):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        _QINST.append(self)


def _click_and_build():
    """پرکردن فایل‌ها + تولید رپورت (فرض: main UI ساخته شده)"""
    run_btns = [b for b in BUTTONS if b.v == "تولید رپورت"]
    assert run_btns, "main UI ساخته نشد"
    for b in [x for x in BUTTONS if x.v == "انتخاب..."]:
        b.cmd()
    run_btns[0].cmd()
    done = False
    for q in _QINST:
        while True:
            try:
                item = q.get_nowait()
            except queue.Empty:
                break
            if isinstance(item, tuple):
                tag, msg = item
                if tag == "__error__":
                    raise RuntimeError("خطای run_build: " + msg)
                if tag == "__done__":
                    done = True
    assert done, "worker کامل نشد"


def _run_gui_guarded():
    orig = sys.modules["threading"]
    sys.modules["threading"] = fake_threading_module()
    queue.Queue = _TrackedQueue
    try:
        B.run_gui()
    finally:
        sys.modules["threading"] = orig
        queue.Queue = _REAL_QUEUE


def _reset_ui_state():
    BUTTONS.clear()
    ENTRIES.clear()
    _QINST.clear()
    WARNINGS.clear()


def _license_file():
    import os
    return os.path.join(os.path.dirname(os.path.abspath(B.__file__)), B.LICENSE_FILE)


def test_license_pure():
    import datetime
    key, exp = B.make_license_key("شرکت تست", days=365)
    info = B.validate_license(key)
    assert info["ok"], info
    assert info["company"] == "شرکت تست", info
    # با فاصله/خط تیره و کوچیک‌نویسی هم خوانده شود
    assert B.validate_license(" " + key.lower().replace("-", "  ") + " ")["ok"]
    # منقضی‌شده
    k_old, _ = B.make_license_key("قدیمی", date=datetime.date(2020, 1, 1))
    assert not B.validate_license(k_old)["ok"], "باید منقضی بشناسد"
    # دست‌کاری‌شده (یک کاراکتر عوض)
    tampered = key[:-1] + ("A" if key[-1] != "A" else "B")
    assert not B.validate_license(tampered)["ok"], "باید نامعتبر بشناسد"
    assert not B.validate_license("")["ok"]
    assert not B.validate_license("SPPQ-GARBAGE-GARBAGE")["ok"]
    print("license pure OK | expiry:", exp.isoformat())


def test_input_dedup_checks_all_source_columns():
    """فقط دو ردیف ورودیِ کاملاً یکسان حذف می‌شوند، نه خروجی‌های مشابه."""
    cfg = next(c for c in B.SHEETS if c["name"] == "FULTELE")
    base = {
        "شماره سفارش تولید": "SO-001",
        "تاریخ سفارش": "1405/05/01",
        "شیفت": "شیفت صبح",
        "کد محصول": "1211643",
        "نام محصول": "نمونه",
        "عنوان عملیات آزمایش": "وان قلع",
        "کد ایراد": "TS-08(ف)",
        "شرح ایراد": "اتصال کوتاه و تار عنکبوتی(ف)",
        "تعداد ایراد": 3,
        "ایستگاه": "وان قلع و کنترل ماشینی پس از وان",
    }
    different_count = dict(base, **{"تعداد ایراد": 2})
    # شماره سفارش در خروجی نیست؛ پس خروجی مشابه است اما ورودی متفاوت و باید بماند.
    different_order = dict(base, **{"شماره سفارش تولید": "SO-002"})
    # کد/شرح بعد از نرمال‌سازی خروجی یکسان‌اند، اما خود ورودی متفاوت است.
    counterpart_suffix = dict(base, **{
        "کد ایراد": "TS-08(01)",
        "شرح ایراد": "اتصال کوتاه و تار عنکبوتی (1)",
    })
    exact_copy = dict(base)

    data, _, _, details = B.build_sheet(
        cfg, [], [base, different_count, different_order, counterpart_suffix, exact_copy],
        [], {}, {}, None, dedup=True)
    assert len(data) == 4, data
    assert len(details) == 1, details
    assert details[0]["first_input_row"] == 2, details
    assert details[0]["duplicate_input_row"] == 6, details
    assert details[0]["input_row"] == exact_copy, details
    # سه ردیف خروجی با وجود شباهت کامل، چون ورودی‌هایشان فرق دارد، حفظ شده‌اند.
    assert data[0] == data[2] == data[3], data
    assert data[1][11] == 2, data[1]
    print("input-report all-columns dedup guard OK")


def test_fultele_excludes_qv_and_normalizes_counterpart_suffixes():
    cfg = next(c for c in B.SHEETS if c["name"] == "FULTELE")
    base = {
        "تاریخ سفارش": "1405/05/01",
        "شیفت": "شیفت صبح",
        "کد محصول": "1211643",
        "نام محصول": "نمونه",
        "کد ایراد": "TS-08(ف)",
        "شرح ایراد": "اتصال کوتاه و تار عنکبوتی (ف)",
        "تعداد ایراد": 3,
        "ایستگاه": "وان قلع و کنترل ماشینی پس از وان",
    }
    qv_row = dict(base, **{"عنوان عملیات آزمایش": "qv"})
    real_row = dict(base, **{"عنوان عملیات آزمایش": "وان قلع"})
    # QV حتی اگر نسخهٔ همتای غیر-QV نداشته باشد، نباید به FULTELE برود.
    qv_data, _, _, _ = B.build_sheet(cfg, [], [qv_row], [], {}, {}, None)
    assert qv_data == [], qv_data
    real_data, _, _, _ = B.build_sheet(cfg, [], [real_row], [], {}, {}, None)
    assert len(real_data) == 1, real_data
    assert real_data[0][9] == "TS-08", real_data[0]
    assert real_data[0][10] == "اتصال کوتاه و تار عنکبوتی", real_data[0]
    # FULTELE فقط کدهای محصول 121 و 122 را می‌پذیرد.
    other_code_row = dict(real_row, **{"کد محصول": "3206133"})
    other_data, _, _, _ = B.build_sheet(cfg, [], [other_code_row], [], {}, {}, None)
    assert other_data == [], other_data
    # پرانتزِ توضیحی و معنادار پاک نمی‌شود.
    assert B.norm_defect_description("BEZEL(لک/موج/خش)") == "BEZEL(لک/موج/خش)"
    print("FULTELE QV exclusion + defect suffix normalization OK")


def main():
    # آزمون نباید لایسنس واقعی کنار برنامه را تغییر دهد. مسیر موقت را فقط
    # برای این اجرا جایگزین می‌کنیم و در پایان مقدار اصلی را برمی‌گردانیم.
    original_license_file = B.LICENSE_FILE
    B.LICENSE_FILE = f"/tmp/test_qui_license_{os.getpid()}.key"
    lic_path = _license_file()
    try:
        test_license_pure()
        test_input_dedup_checks_all_source_columns()
        test_fultele_excludes_qv_and_normalizes_counterpart_suffixes()

        if os.path.exists(lic_path):
            os.remove(lic_path)
        if os.path.exists(OUT):
            os.remove(OUT)

        # سناریوی ۱: لایسنس ذخیره‌شده → پنجرهٔ اصلی مستقیم
        k1, _ = B.make_license_key("شرکت الفبا", days=365)
        assert B.save_license(k1)
        assert B.validate_license(B.load_license())["ok"]
        _reset_ui_state()
        DIALOG_SIM.update(activate=False, key=None)
        _run_gui_guarded()
        _click_and_build()
        assert os.path.exists(OUT), "سناریؤ ۱: خروجی ساخته نشد"
        if os.path.exists(OUT):
            os.remove(OUT)
        print("scenario 1 (saved license) OK")

        # سناریوی ۲: بدون لایسنس + پنجرهٔ فعال‌سازی با کلید معتبر → موفق
        if os.path.exists(lic_path):
            os.remove(lic_path)
        k2, _ = B.make_license_key("شرکت برزنت", days=180)
        _reset_ui_state()
        DIALOG_SIM.update(activate=True, key=k2)
        _run_gui_guarded()
        _click_and_build()
        assert os.path.exists(OUT), "سناریؤ ۲: خروجی ساخته نشد"
        assert os.path.exists(lic_path), "سناریؤ ۲: لایسنس ذخیره نشد"
        if os.path.exists(OUT):
            os.remove(OUT)
        print("scenario 2 (activation dialog, valid key) OK")

        # سناریوی ۳: بدون لایسنس + پنجرهٔ فعال‌سازی با کلید نامعتبر → بسته می‌شود
        if os.path.exists(lic_path):
            os.remove(lic_path)
        _reset_ui_state()
        DIALOG_SIM.update(activate=True, key="SPPQ-FAKE-FAKE-FAKE-FAKE")
        _run_gui_guarded()
        assert not any(b.v == "تولید رپورت" for b in BUTTONS), "سناریؤ ۳: main UI نباید ساخته شود"
        assert not os.path.exists(OUT), "سناریؤ ۳: خروجی نباید ساخته شود"
        print("scenario 3 (activation dialog, invalid key) OK")

        # سناریوی ۴: بدون لایسنس و بدون پنجرهٔ فعال‌سازی (خروج) → بسته می‌شود
        _reset_ui_state()
        DIALOG_SIM.update(activate=False, key=None)
        _run_gui_guarded()
        assert not any(b.v == "تولید رپورت" for b in BUTTONS), "سناریؤ ۴: main UI نباید ساخته شود"
        print("scenario 4 (no license, dialog closed) OK")

        assert B.APP_OWNER == "سعید کاظمی‌پور", B.APP_OWNER
        assert B.APP_PHONE == "09216895359", B.APP_PHONE
        print("E2E GUI + برندینگ + لایسنس OK")
    finally:
        if os.path.exists(lic_path):
            os.remove(lic_path)
        if os.path.exists(OUT):
            os.remove(OUT)
        B.LICENSE_FILE = original_license_file


if __name__ == "__main__":
    main()