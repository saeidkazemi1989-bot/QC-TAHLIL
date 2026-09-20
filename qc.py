#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
سازندهٔ رپورت QC راهکاران
==========================
سه فایل سایت + جدول گروه‌بندی محصولات را می‌گیرد و فایل
«QC Report راهکاران» را با 8 شیت تولید می‌کند:
    FULT EMS | QC EMS | ICT | QC ELE | SMD REPORT | FULTELE | qv | پلیمر
    (به‌علاوه شیت «گروه بندی محصولات» در پایان، همان فایل گروه‌بندی)

تقسیم‌بندی کد کالا (پیشوند کد محصول):
    1* = الکترونیک   120 SMD | 121 مونتاژ/وان قلع (qv و فالت) |
                     122 تکمیل کاری (فقط خانوادهٔ نود + عیب ICT_01 → ICT) |
                     123 کنترل نهایی | 130 محصول کامل (شامل عیب/تحلیل نمی‌شود)
    2* = پلیمر       221 چاپ/لیزر دایال | 222 تزریق و کنترل نهایی دایال |
                     225 قطعات نیمه‌ساخته | 232 و 233 تزریق اشتهارد/مهرکام
    3* = EMS         320 | 331 | 332
کدهای 7* (دسته‌سیم) و 130* (محصول کامل) در هیچ شیتی نمی‌آیند.
منطق هر شیت:
  شیت        | کد محصول | منبع عیب‌ها        | فیلتر عیب‌ها                                          | تعداد تولید (مرکز کاری)
  -----------|----------|---------------------|---------------------------------------------------------|------------------------------------------
  qv         | 121*     | اطلاعات جامع کیفیت | همه عیب‌های 121                                           | 3 مرکز مونتاژ/وان (بدون «قبل از وان»)
  SMD REPORT | 120*     | اطلاعات جامع کیفیت | همه عیب‌های 120، ایستگاه «-»                            | سامسونگ 1/2 + ماشین میرایی
  ICT        | 122*     | اطلاعات جامع کیفیت | فقط کد عیب ICT_01، ایستگاه «ICT»                        | فقط «تکمیل کاری نود ها» (همه ردیف‌ها)
  QC ELE     | 123*     | اطلاعات جامع کیفیت | همه عیب‌های 123، ایستگاه «کنترل نهایی»                  | 3 مرکز کنترل نهایی
  FULTELE    | 121+122* | عیب‌های سند بازرسی  | همه فرآیندهایی که QV نیستند (وان قلع، قطعه‌گذاری و     | 6 مرکز مونتاژ/وان/تکمیل کاری
             |          |                     | لحیم‌کاری، تکمیل کاری و ...)؛ ICT_01 مستثنا است           |
  FULT EMS   | 320*     | عیب‌های سند بازرسی  | همه عیب‌های 320 در 4 ایستگاه تست/مونتاژ،                 | فقط «تکمیل کاری ECU» و «تست و کنترل ECU»
             |          |                     | به‌جز ECU-07 دو کد ECU (آن‌ها می‌روند QC EMS)             |
  QC EMS     | 331+332* | عیب‌های سند بازرسی  | همه عیب‌های 33 + ECU-07 دو کد 3206133/3206134،           | همه کدهای 33
             |          |                     | ایستگاه «کنترل نهایی»                                    |
نکات مشترک:
  - کد گروه محصول = کد کالای منبع؛ کد محصول = نام کالای منبع
  - نام محصول/خانواده/ترکیبی/نهایی/برنچ از جدول گروه‌بندی (اولین ردیف تکراری،
    مثل VLOOKUP اکسل)؛ اگر کد نبود → #N/A
  - ردیف عیب: تعداد کل = 0؛ ردیف تولید: کد/شرح ایراد = «-»، تعداد ایراد = 0،
    تعداد کل = مقدار سالم
  - کد عیب نرمال‌سازی می‌شود: TS-08(ف) / TS-08(01) / TS-01.  →  TS-08 / TS-01
  - پسوند همتاسازِ شرح عیب نیز حذف می‌شود: «اتصال کوتاه و تار عنکبوتی(ف)»
    و «... (1)» → «اتصال کوتاه و تار عنکبوتی».
  - شیفت: عیب‌های سند بازرسی از ستون شیفت آن گزارش؛ بقیه «-»
  - FULTELE فقط عیب‌های کد محصول 121* و 122* با عنوان عملیات غیر-QV را
    می‌گیرد. عیب‌های QV فقط از «اطلاعات جامع کیفیت» در شیت qv می‌آیند.
  - ردیف‌های تولید فقط برای کدهای موجود در جدول گروه‌بندی می‌آیند
    (شیت ICT مستثنا است و همه ردیف‌های مرکز خودش را می‌گیرد).
  - ردیف‌ها بر اساس کد محصول (ترتیب حضور) و داخل هر کد بر اساس تاریخ مرتب می‌شوند.
قالب و نکات خاص شیت‌ها (دقیقاً مطابق رپورت ماه قبل):
  - شیت SMD REPORT قالب 68 ستونه دارد: بعد از تاریخ یک ستون «ماه»، بعد از
    «نام قطعه» ستون «جانمایی قطعه معیوب در فرآیند SMD» (از ستون جانمایی
    گزارش کیفیت) و در انتها 13 ستون اپراتور/ماشین SMD. در ردیف‌های تولید
    SMD هزینه تعمیرات 0 و «ماشین Paste SMD» = مرکز کاری است؛ در ردیف‌های
    عیب، «رفع عیب»/«تست مجدد» خالی با «-» نوشته می‌شود.
  - ردیف‌های تولید ICT: هزینه و سه زمان تعمیرات «-» است.
  - در FULTELE شیفت ردیف‌های تولید مراکز «تکمیل کاری» خالی و بقیه «-» است.
  - مقدار خالی در ستون‌های متنی عیب، «-» نوشته می‌شود.
حالت «ادامه از رپورت ماه قبل» (مهم):
  --history "رپورت ماه قبل.xlsx"
    1) جدول گروه‌بندی داخل رپورت قبلی را هم می‌خواند و برای کدهایی که در فایل
       گروه‌بندی فعلی نیستند، اطلاعاتشان را از آنجا می‌گیرد.
    2) ردیف‌هایی که قبلاً در رپورت قبل ثبت شده‌اند (عیب یا تولید) را تکرار
       نمی‌کند؛ یعنی اگر فایل جدید شما برای یک محصول تا 28 و برای محصول دیگر
       فقط تا 20 داده دارد، دقیقاً همان ردیف‌های جدیدی که گزارش نداشته‌ایم
       اضافه می‌شوند و بقیه نادیده گرفته می‌شوند.
نحوه اجرا:
  python qc.py \
      --quality "اطلاعات جامع کیفیت حین تولید.xlsx" \
      --defect  "گزارش عیب های سند بازرسی.xlsx" \
      --prod    "گزارش تعداد تولید به تفکیک سند عملکرد.xlsx" \
      --grouping "گروه بندی محصولات.xlsx" \
      --history "QC Report راهکاران - ماه قبل.xlsx" \
      --out "QC Report راهکاران - 1405/06.xlsx"
    --month 1405/06        (اختیاری) فقط ردیف‌های یک ماه خاص
    --validate فایل.xlsx   (اختیاری) مقایسه خروجی با یک رپورت موجود
    --dedup                (اختیاری) فقط رکوردهای کاملاً تکراری در گزارش‌های
                           ورودی را جدا می‌کند: همهٔ ستون‌های ورودی باید
                           یکسان باشند؛ شباهت خروجی کافی نیست
    --gui                  حالت گرافیکی: فایل‌ها و مسیر خروجی از روی
                           پنجره انتخاب می‌شوند (بدون بقیهٔ پارامترها)
"""
import argparse
import os
import re
import sys
from collections import Counter, defaultdict
try:
    import openpyxl
    from openpyxl.styles import Font
except ModuleNotFoundError:
    print("کتابخانهٔ openpyxl نصب نیست. ابتدا install_windows.bat را اجرا کنید.")
    sys.exit(1)
# ---------------------------------------------------------------------------
# اطلاعات نسخهٔ اختصاصی — در پنجرهٔ برنامه نمایش داده می‌شوند
# ---------------------------------------------------------------------------
APP_TITLE = "سازندهٔ رپورت QC راهکاران"
APP_OWNER = "سعید کاظمی‌پور"
APP_PHONE = "09216895359"
# ---------------------------------------------------------------------------
# سیستم لایسنس (آفلاین؛ امضای دیجیتال روی کد)
# ساخت کد (فقط مالک):
#   python qc.py --make-license "نام شرکت" --days 365
# ---------------------------------------------------------------------------
import base64
import datetime
import hashlib
import hmac
LICENSE_PREFIX = "SPPQ1"
LICENSE_SECRET = "saeid-kazemi-pour|saze-pouyesh|qc|09216895359|2026"
LICENSE_FILE = "license.key"
def _b32_clean(s):
    return s.upper().strip().rstrip("=")
def make_license_key(company, days=365, date=None):
    """ساخت کد لایسنس: نام شرکت + تاریخ انقضا + امضای HMAC"""
    expiry = date if date is not None else (
        datetime.date.today() + datetime.timedelta(days=days))
    company_b = base64.urlsafe_b64encode(company.encode("utf-8")).decode().rstrip("=")
    rand = hashlib.sha256(os.urandom(16) + company.encode("utf-8")).hexdigest()[:6]
    payload = f"{LICENSE_PREFIX}|{company_b}|{expiry.isoformat()}|{rand}"
    sig = hmac.new(LICENSE_SECRET.encode("utf-8"), payload.encode("utf-8"),
                   hashlib.sha256).digest()[:8]
    blob = payload + "|" + base64.b32encode(sig).decode().rstrip("=")
    key = base64.b32encode(blob.encode("ascii")).decode().rstrip("=")
    return "-".join(key[i:i + 5] for i in range(0, len(key), 5)), expiry
def validate_license(key):
    """بررسی کد لایسنس؛ نتیجه: dict(ok, company, expiry, reason)"""
    info = {"ok": False, "company": None, "expiry": None, "reason": None}
    if not key or not key.strip():
        info["reason"] = "کد لایسنس یافت نشد."
        return info
    try:
        k = _b32_clean("".join(key.split()).replace("-", ""))
        blob = base64.b32decode(k + "=" * ((-len(k)) % 8)).decode("ascii")
        parts = blob.split("|")
        if len(parts) != 5 or parts[0] != LICENSE_PREFIX:
            raise ValueError("bad format")
        payload = "|".join(parts[:4])
        expected = base64.b32encode(
            hmac.new(LICENSE_SECRET.encode("utf-8"), payload.encode("utf-8"),
                     hashlib.sha256).digest()[:8]).decode().rstrip("=")
        if not hmac.compare_digest(expected, _b32_clean(parts[4])):
            info["reason"] = "کد لایسنس نامعتبر است (امضا نادرست)."
            return info
        company = base64.urlsafe_b64decode(
            parts[1] + "=" * ((-len(parts[1])) % 4)).decode("utf-8")
        expiry = datetime.date.fromisoformat(parts[2])
        info.update(company=company, expiry=expiry)
        if expiry < datetime.date.today():
            info["reason"] = f"این لایسنس منقضی شده بود ({expiry.isoformat()})."
            return info
        info["ok"] = True
        return info
    except Exception:
        info["reason"] = "کد لایسنس خوانا نیست؛ آن را بدون تغییر کپی کنید."
        return info
def _license_paths():
    here = os.path.dirname(os.path.abspath(__file__))
    return [os.path.join(d, LICENSE_FILE) for d in dict.fromkeys((here, os.getcwd()))]
def load_license():
    """خواندن کد لایسنس ذخیره‌شده (license.key کنار برنامه)"""
    for p in _license_paths():
        if os.path.isfile(p):
            try:
                with open(p, encoding="utf-8") as f:
                    k = f.read().strip()
                if k:
                    return k
            except Exception:
                pass
    return ""
def save_license(key):
    """ذخیرهٔ کد لایسنس کنار برنامه برای اجراهای بعدی"""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), LICENSE_FILE)
    try:
        with open(p, "w", encoding="utf-8") as f:
            f.write(key.strip() + "\n")
        return True
    except Exception:
        return False
def _license_activation_dialog(app, initial_reason, tk):
    """پنجرهٔ فعال‌سازی لایسنس (مسدودکننده)؛ نتیجه: (ok, key)"""
    top = tk.Toplevel(app)
    top.title("فعال‌سازی لایسنس")
    top.geometry("560x240")
    top.resizable(False, False)
    tk.Label(top, text="این برنامه برای استفاده نیاز به کد لایسنس دارد.",
             font=("", 11, "bold")).pack(pady=(16, 4))
    tk.Label(top, text=f"ارتباط با: {APP_OWNER}  |  {APP_PHONE}",
             fg="#555").pack(pady=(0, 8))
    reason_lbl = tk.Label(top, text=initial_reason or "", fg="#b00020",
                          wraplength=480, justify="right")
    reason_lbl.pack(pady=(0, 6))
    ent = tk.Entry(top, width=50, justify="left")
    ent.pack(pady=(0, 10))
    result = {"ok": False, "key": None}
    def do_activate():
        k = ent.get().strip()
        info = validate_license(k)
        if info["ok"]:
            result["ok"], result["key"] = True, k
            top.destroy()
        else:
            reason_lbl.config(text=info["reason"])
            ent.delete(0, "end")
            ent.focus_set()
    def do_quit():
        result["ok"] = False
        top.destroy()
    tk.Button(top, text="خروج", command=do_quit).pack(side="left", padx=8)
    tk.Button(top, text="فعال‌سازی", font=("", 11, "bold"),
              command=do_activate).pack(side="left", padx=8)
    top.lift()
    top.focus_force()
    app.wait_window(top)
    return result["ok"], result["key"]
def ensure_license(app=None, cli_key=None, tk=None):
    """دریافت لایسنس معتبر؛ اگر نشد app بسته می‌شود/None برمی‌گردد"""
    key = (cli_key or "").strip() or load_license()
    info = validate_license(key)
    if not info["ok"] and app is not None:
        ok, new_key = _license_activation_dialog(app, info["reason"], tk)
        if ok:
            key = new_key
            info = validate_license(key)
            if info["ok"]:
                save_license(key)  # برای اجراهای بعدی
        else:
            return None
    return info if info["ok"] else None
# ---------------------------------------------------------------------------
# پیکربندی
# ---------------------------------------------------------------------------
# مقادیر ثابت ستون‌های پایانی (مطابق فایل «گزارش مرجع»)
CONST_COST = 44000           # هزینه ریالی تعمیرات
CONST_LIMIT = 14000          # حد قابل قبول
CONST_TARGET = 12000         # هدف
CONST_PART_TYPE = "فرآیندی"   # نوع قطعات تولیدی و تامینی
# کدهای ECU که عیب ECU-07 آن‌ها در QC EMS ثبت می‌شود (بقیه 320 در FULT EMS)
ECU_FINAL_CONTROL_CODES = {"3206133", "3206134"}
ECU_FINAL_CONTROL_DEFECT = "ECU-07"
# ایستگاه‌های سند بازرسی که عیب‌هایشان در FULT EMS می‌آیند
FULT_EMS_STATIONS = {
    "تست و کنترل ECU",
    "مونتاژ پدال گاز برقی",
    "تکمیل کاری ECU",
    "مونتاژ انتن و یونیت ایمو بلایزر",
}
# عنوان عملیات «QV» در سند بازرسی نسخهٔ تکراری همان عیب است
QV_TITLE = "QV"
# در نمونه، ایستگاه «وان قلع و کنترل ماشینی پس از وان» در ردیف‌های عیبِ
# «اطلاعات جامع کیفیت» به «وان قلع» کوتاه نوشته شده
STATION_RENAME_QUALITY = {"وان قلع و کنترل ماشینی پس از وان": "وان قلع"}
SHEETS = [
    # ترتیب شیت‌ها مطابق رپورت ماه قبل
    dict(
        name="FULT EMS",
        defect_source="defect",
        code_prefix=("320",),
        defect_filter="fult_ems",
        station="source",
        prod_prefix=("320",),
        prod_centers={"تکمیل کاری ECU", "تست و کنترل ECU"},
        defect_decl="-",
        prod_shift="",
        branch_const="EMS",       # برنچ شیت‌های EMS ثابت است
    ),
    dict(
        name="QC EMS",
        defect_source="defect",
        code_prefix=("331", "332"),
        defect_filter="qc_ems",   # عیب‌های 33 + ECU-07 دو کد ECU
        station="کنترل نهایی",
        prod_prefix=("331", "332"),
        prod_centers=None,        # همه مراکز
        defect_decl="-",
        prod_shift="-",
        branch_const="EMS",
    ),
    dict(
        name="ICT",
        defect_source="quality",
        code_prefix=("122",),
        defect_filter="ICT",
        station="ICT",
        prod_prefix=("122",),
        prod_centers={"تکمیل کاری نود ها"},
        defect_decl="-",
        prod_shift="-",
        prod_branch="-",                 # در نمونه برنچ ردیف‌های تولید ICT «-» است
        prod_requires_grouping=False,    # ICT همه ردیف‌های مرکز خودش را می‌گیرد
        prod_cnt="-",                    # تعداد ایراد ردیف‌های تولید ICT «-» است
        prod_repair_dash=True,           # هزینه/زمان‌های ردیف‌های تولید ICT «-» است
    ),
    dict(
        name="QC ELE",
        defect_source="quality",
        code_prefix=("123",),
        defect_filter="any",
        station="کنترل نهایی",
        prod_prefix=("123",),
        prod_centers={"کنترل نهایی خط D", "کنترل نهایی جلوآمپر ها",
                      "کنترل نهایی خط نود ها"},
        defect_decl="-",
        prod_shift="-",
    ),
    dict(
        name="SMD REPORT",
        defect_source="quality",
        code_prefix=("120",),
        defect_filter="any",
        station="-",
        prod_prefix=("120",),
        prod_centers={"سامسونگ 1", "سامسونگ 2", "ماشین میرایی"},
        defect_decl="کنترل ماشینی",
        prod_shift="-",
        extra_month_col=True,   # شیت SMD یک ستون «ماه» بعد از تاریخ دارد
        time_empty_dash=True,   # در شیت SMD، «رفع عیب»/«تست مجدد» خالی با «-» نوشته می‌شود
    ),
    dict(
        name="FULTELE",
        defect_source="defect",
        code_prefix=("121", "122"),
        defect_filter="non_qv",   # همه فرآیندهای غیر-QV (ICT_01 مستثنا)
        station="title",
        prod_prefix=("121", "122"),
        prod_centers={"مونتاژ دستی خطوط جلوآمپر", "مونتاژ دستی کلیدها",
                      "وان قلع و کنترل ماشینی پس از وان", "تکمیل کاری خط D",
                      "تکمیل کاری جلوآمپر", "تکمیل کاری نود ها"},
        defect_decl="-",
        prod_shift="-",
        # در نمونه شیفت ردیف‌های تولید مراکز «تکمیل کاری» خالی و بقیه «-» است
        prod_shift_tamamil_empty=True,
    ),
    dict(
        name="qv",
        defect_source="quality",
        code_prefix=("121",),
        defect_filter="any",
        station="source",
        prod_prefix=("121",),
        prod_centers={"مونتاژ دستی خطوط جلوآمپر", "مونتاژ دستی کلیدها",
                      "وان قلع و کنترل ماشینی پس از وان"},
        defect_decl="کنترل چشمی",
        prod_shift="-",
    ),
    # -------------------------------------------------------------- پلیمر
    # تقسیم‌بندی کد کالا: 1* = الکترونیک، 2* = پلیمر، 3* = EMS (هرکدام
    # زیرگروه دارند: 120 SMD، 121 مونتاژ/وان قلع (qv و فالت)، 122 تکمیل کاری
    # (ICT فقط برای خانوادهٔ نود با عیب ICT_01)، 123 کنترل نهایی، 130 محصول
    # کامل — و برای پلیمر: 221، 222، 225، 232، 233؛ برای EMS: 320/331/332).
    # کالاهای پلیمری (هر کدی که با ۲ شروع شود) در هیچ‌کدام از شیت‌های بالا
    # جایی ندارند؛ برای اینکه از گزارش جا نمانند، شیت مستقل «پلیمر» ساخته
    # می‌شود:
    #   - ردیف‌های عیب:   از سند بازرسی (ردیف‌هایی که کد ایراد دارند)
    #   - ضایعات:         فایل ضایعات الکترونیک و EMS جداست، اما برای پلیمر
    #                     ستون «مقدار ضایعات» همان سند عملکرد مبناست و به
    #                     صورت ردیف عیب با کد «ضایعات» می‌آید
    #                     (scrap_as_defect؛ فقط برای این شیت فعال است)
    #   - ردیف‌های تولید: همه ردیف‌های ۲* سند عملکرد (مقدار سالم)
    dict(
        name="پلیمر",
        defect_source="defect",
        code_prefix=("2",),
        defect_filter="any",
        station="source",          # ایستگاه از ستون «ایستگاه» سند بازرسی
        prod_prefix=("2",),
        prod_centers=None,         # همهٔ مراکز کاری پلیمر
        defect_decl="-",
        prod_shift="-",
        branch_const="POL",        # برنچ کالاهای پلیمری ثابت است
        prod_requires_grouping=False,   # کدهای 2* در جدول گروه‌بندی نیستند
        scrap_as_defect=True,      # ضایعات پلیمر هم ردیف عیب می‌سازد
        scrap_defect_code="ضایعات",
        scrap_defect_desc="ضایعات ثبت‌شده در سند عملکرد",
    ),
]
# ---------------------------------------------------------------------------
# ابزارها
# ---------------------------------------------------------------------------
def s(v):
    return "" if v is None else str(v).strip()
def n(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    return int(f) if f == int(f) else f
def norm_dc(x):
    """نرمال‌سازی کد عیب: حذف پسوند پرانتزی و نقطهٔ انتهایی.

    نمونه: TS-08(ف)، TS-08(01) و TS-01. به‌ترتیب TS-08، TS-08 و TS-01
    می‌شوند.
    """
    return re.sub(r"[（(].*?[）)]", "", s(x)).rstrip(".").strip()


def is_qv_title(value):
    """تشخیص عنوان عملیات QV، بدون حساسیت به بزرگ/کوچک‌بودن حروف."""
    return s(value).replace("\u200c", "").casefold() == QV_TITLE.casefold()


_TRAILING_COUNTERPART_SUFFIX = re.compile(
    r"\s*[（(]\s*([^()（）]*?)\s*[）)]\s*[.،؛]?\s*$")


def norm_defect_description(value):
    """حذف فقط پسوندِ همتاساز از شرح عیب.

    پسوندهای شناسه‌ایِ انتهای شرح، مثل (ف)، (1)، (01) و (A)، برای یکسان‌شدن
    شرح عیب حذف می‌شوند. پرانتزهای معنادارِ چندکلمه‌ای، مثل (ICT)، (UV) یا
    (لک/موج/خش)، بدون تغییر باقی می‌مانند تا اطلاعات واقعی عیب از بین نرود.
    """
    text = s(value)
    while text:
        match = _TRAILING_COUNTERPART_SUFFIX.search(text)
        if not match:
            break
        suffix = match.group(1).strip()
        # عدد، یک حرف فارسی یا یک حرف انگلیسی، پسوندِ شناسه‌ای همتاست.
        if not re.fullmatch(r"[0-9٠-٩۰-۹]+|[A-Za-zآ-ی]", suffix):
            break
        text = text[:match.start()].rstrip()
    return text.rstrip(".،؛ ").strip()


def date_key(d):
    d = s(d)
    parts = d.replace("٠", "0").split("/")
    try:
        return tuple(int(p) for p in parts)
    except ValueError:
        return (9999, 99, 99)
def load_sheet(path, sheet=None):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    hdr = [str(h).strip() if h is not None else f"col{i}" for i, h in enumerate(rows[0])]
    out = []
    for r in rows[1:]:
        if not any(v is not None for v in r):
            continue
        out.append(dict(zip(hdr, r)))
    return out
# ---------------------------------------------------------------------------
# جدول گروه‌بندی
# ---------------------------------------------------------------------------
GRP_KEYS = ["کد راهکاران", "نام محصول", "خانواده محصول",
            "نام محصول ترکیبی", "گروه محصول نهایی", "برنچ"]
GRP_CODE_COL = "کد راهکاران"
GRP_CODE_COL_ALT = "کد گروه محصول"   # در نسخهٔ جدیدتر جدول، نام ستون کد این است
def load_grouping(path):
    """خواندن جدول گروه‌بندی:
      ردیف هدر از بین ۱۵ ردیف اول هر شیت پیدا می‌شود (پس ردیف عنوان/خالی
      بالای جدول و جابه‌جایی جدول بین شیت‌ها خرابی نمی‌سازد).
      ستون کد: «کد راهکاران» یا «کد گروه محصول».
      برگشت: (ردیف‌ها, هدرها, توضیح)
    """
    wb = openpyxl.load_workbook(path, data_only=True)
    for ws in wb.worksheets:
        allr = list(ws.iter_rows(values_only=True))
        for hi, row in enumerate(allr[:15]):
            hdr = [str(h).strip() if h is not None else "" for h in row]
            code_col = next((c for c in (GRP_CODE_COL, GRP_CODE_COL_ALT)
                             if c in hdr), None)
            if code_col:
                out = []
                for r in allr[hi + 1:]:
                    if not any(v is not None for v in r):
                        continue
                    d = dict(zip(hdr, r))
                    if code_col != GRP_CODE_COL:
                        d.setdefault(GRP_CODE_COL, d.get(code_col))
                    out.append(d)
                return out, hdr, f"شیت «{ws.title}»، ردیف {hi + 1}"
    # ستون پیدا نشد — هدر شیت اول را برگردان تا بتواند تشخيص داده شود
    first = wb.worksheets[0]
    row1 = next(first.iter_rows(min_row=1, max_row=1, values_only=True), None) or ()
    hdr = [str(h).strip() if h is not None else "" for h in row1]
    found = ", ".join(h for h in hdr if h)[:180]
    return [], hdr, (f"ستون «{GRP_CODE_COL}» یا «{GRP_CODE_COL_ALT}» پیدا نشد "
                     f"(هدرهای شیت اول: {found or '—'})")
def build_grouping(grp_rows, history_grp_rows):
    """
    ساخت جدول گروه‌بندی:
      - فایل گروه‌بندی فعلی اولویت دارد (اولین ردیف تکراری، مثل VLOOKUP)
      - کدهای موجود در رپورت قبلی ولی نه در فایل فعلی، از رپورت قبلی می‌آیند
    """
    grp = {}
    for rows in (grp_rows, history_grp_rows or []):
        for r in rows:
            code = s(r.get("کد راهکاران"))
            if not code or code in grp:
                continue
            grp[code] = {
                "site_name": s(r.get("نام محصول")),
                "family": s(r.get("خانواده محصول")),
                "combo": s(r.get("نام محصول ترکیبی")),
                "final": s(r.get("گروه محصول نهایی")),
                "branch": s(r.get("برنچ")),
            }
    return grp
def read_history(path):
    """خواندن جدول گروه‌بندی و ردیف‌های ثبت‌شده از رپورت ماه قبل"""
    wb = openpyxl.load_workbook(path, data_only=True)
    # 1) شیت گروه‌بندی: شیتی که هدرش «کد راهکاران» دارد
    grp_rows = []
    for ws in wb.worksheets:
        first = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), None)
        if first and any(s(h) == "کد راهکاران" for h in first):
            grp_rows = load_sheet(path, ws.title)
            break
    # 2) ردیف‌های ثبت‌شده در هر شیت رپورت (برای حذف تکراری‌ها)
    reported = {}
    for cfg in SHEETS:
        sheet_name = cfg["name"] + (" " if cfg["name"] == "qv" else "")
        rows = sheet_rows_raw(path, sheet_name)
        defect_keys = Counter()
        prod_keys = Counter()
        for r in rows:
            vals = [s(v) for v in r]
            off = 1 if len(vals) > 54 else 0   # شیت SMD یک ستون «ماه» اضافه دارد
            date = vals[0]
            code = vals[2 + off]
            dc = vals[9 + off]
            cnt = n(vals[11 + off])
            total = n(vals[12 + off])
            if dc not in ("", "-"):
                defect_keys[(date, code, norm_dc(dc), cnt)] += 1
            else:
                prod_keys[(date, code, total)] += 1
        reported[cfg["name"]] = (defect_keys, prod_keys)
    return grp_rows, reported
def sheet_rows_raw(path, name):
    wb = openpyxl.load_workbook(path, data_only=True)
    for sh in wb.sheetnames:
        if sh.strip() == name.strip():
            ws = wb[sh]
            return list(ws.iter_rows(values_only=True))[1:]
    return []
# ---------------------------------------------------------------------------
# ساخت ردیف‌ها
# ---------------------------------------------------------------------------
BASE_HEADERS = [
    "تاریخ", "شیفت کاری", "کد گروه محصول", "کد محصول", "نام محصول",
    "خانواده محصول", "نام محصول ترکیبی", "گروه محصول نهایی", "ایستگاه",
    "کد ایراد", "شرح ایراد", "تعداد ایراد", "تعداد کل", "برنچ",
    "شرح فعالیت انجام شده توسط تعمیرات", "عامل مسبب ایراد 6M", "کد قطعه",
    "نام قطعه", "نام تامین کننده", "کد و نام تجهیزات و ابزارآلات",
    "کد تجهیزات و ابزارآلات", "کد و نام تجهیزات و ابزارآلات1",
    "کد فرآیند (OPC)", "نام فرآیند (OPC)", "حالت خرابی بالقوه",
    "نوع حالت خرابی بالقوه", "توضیحات تعمیرات", "ستون مشترک حالت خرابی",
    "شدت حالت خرابی", "تشخیص حالت خرابی", "وقوع قدیمی",
    "مدت زمان عیب یابی\n( دقیقه )", "مدت زمان رفع عیب\n( دقیقه )",
    "مدت زمان تست مجدد\n( دقیقه )", "هزینه ریالی تعمیرات", "خانواده قطعات",
    "شماره BOM", "شماره برگ ارسال", "کد اپراتور", "نام اپراتور",
    "کد بازرس چشمی", "نام بازرس", "AOI", "نام بازرس AOI",
    "نوع قطعات تولیدی و تامینی", "وضعیت اعلام ایرادات", "توضیحات اضافه",
    "توضیحات", "Control Station", "حد قابل قبول", "هدف",
    "علت افت یا بهبود PPM", "حد قابل قبول عظام", "هدف عظام",
]
# شیت SMD در قالب کاربر 68 ستونه است: علاوه بر ستون «ماه»، ستون
# «جانمایی قطعه معیوب در فرآیند SMD» بعد از «نام قطعه» و ۱۳ ستون
# مخصوص SMD (اپراتور/ماشین‌ها) در انتها دارد (مطابق رپورت ماه قبل)
SMD_HEADERS = [
    "تاریخ", "ماه", "شیفت کاری", "کد گروه محصول", "کد محصول", "نام محصول",
    "خانواده محصول", "نام محصول ترکیبی", "گروه محصول نهایی", "ایستگاه",
    "کد ایراد", "شرح ایراد", "تعداد ایراد", "تعداد کل", "برنچ",
    "شرح فعالیت انجام شده توسط تعمیرات", "عامل مسبب ایراد 6M", "کد قطعه",
    "نام قطعه", "جانمایی قطعه معیوب در فرآیند SMD", "نام تامین کننده",
    "کد و نام تجهیزات و ابزارآلات", "کد تجهیزات و ابزارآلات",
    "کد و نام تجهیزات و ابزارآلات1", "کد فرآیند (OPC)", "نام فرآیند (OPC)",
    "حالت خرابی بالقوه", "نوع حالت خرابی بالقوه", "توضیحات تعمیرات",
    "ستون مشترک حالت خرابی", "شدت حالت خرابی", "تشخیص حالت خرابی",
    "وقوع قدیمی", "مدت زمان عیب یابی\n( دقیقه )", "مدت زمان رفع عیب\n( دقیقه )",
    "مدت زمان تست مجدد\n( دقیقه )", "هزینه ریالی تعمیرات", "خانواده قطعات",
    "شماره BOM", "شماره برگ ارسال", "کد اپراتور", "نام اپراتور",
    "کد بازرس چشمی", "نام بازرس", "AOI", "نام بازرس AOI",
    "نوع قطعات تولیدی و تامینی", "وضعیت اعلام ایرادات", "توضیحات اضافه",
    "توضیحات", "Control Station", "حد قابل قبول", "هدف",
    "علت افت یا بهبود PPM", "کد اپراتور\nچشمی SMD", "نام اپراتور\nچشمی SMD",
    "کد اپراتور\nPaste SMD", "نام اپراتور\nPaste SMD", "ماشین مونتاژ SMD",
    "ماشین \nPaste SMD", "ماشین\nOven SMD", "Control Station",
    "نام اپراتور بازرس SMD", "کد \nکنترلر بازرس SMD", "شماره \nBOM SMD",
    "توضیحات", "حد قابل قبول عظام", "هدف عظام",
]
def headers_for(cfg):
    if cfg.get("extra_month_col"):
        return list(SMD_HEADERS)
    return list(BASE_HEADERS)
def to_smd_row(row, placement, center):
    """تبدیل ردیف 55 ستونه (با ماه) به قالب 68 ستونه شیت SMD"""
    r = list(row)
    is_prod = s(r[10]) in ("", "-")
    out = r[:19]                    # 0-18
    out.append(s(placement) or "-") # 19 جانمایی
    out += r[19:37]                 # 20-37: تامین‌کننده تا خانواده قطعات
    if is_prod:
        out[36] = 0                 # هزینه ردیف‌های تولید SMD: 0
    out += [0, 0]                   # 38-39: BOM / برگ ارسال
    out += r[39:45]                 # 40-45: اپراتور و بازرس
    out += [r[45], r[46], r[47], r[48]]  # 46-49: نوع قطعات تا توضیحات
    out.append(r[46])               # 50: Control Station = وضعیت اعلام
    out += [r[50], r[51], r[52]]    # 51-53: حد / هدف / PPM
    out += ["-", "-", "-", "-", "-"]  # 54-58: اپراتور و ماشین مونتاژ
    out.append(s(center) or "-")    # 59: ماشین Paste SMD = مرکز کاری
    out += ["-", "-", "-", "-"]     # 60-63: اوون / Control Station / بازرس
    out.append(0)                   # 64: BOM SMD
    out.append("-")                 # 65: توضیحات
    out += [r[53], r[54]]           # 66-67: حد و هدف عظام
    # 33=عیب یابی, 34=رفع عیب, 35=تست مجدد
    if is_prod:
        out[33] = out[34] = out[35] = 0
    else:
        if out[33] is None:
            out[33] = 0
        if out[34] is None:
            out[34] = "-"
        if out[35] is None:
            out[35] = "-"
    return out
def insert_month(row_list, month_value="-"):
    return [row_list[0], month_value] + row_list[1:]
def make_row(cfg, grp, date, shift, code, prod_name, station,
             dc, desc, cnt, total, extra):
    g = grp.get(code)
    if g is not None:
        # کد در جدول گروه‌بندی پیدا شد (مثل VLOOKUP: مقدار خالی می‌ماند خالی)
        name = g["site_name"]
        family = g["family"]
        combo = g["combo"]
        final = g["final"]
        branch = g["branch"]
    else:
        # کد پیدا نشد → #N/A (همان رفتار VLOOKUP اکسل)
        name = family = combo = final = "#N/A"
        branch = "#N/A"
    if cfg.get("branch_const"):
        branch = cfg["branch_const"]
    row = [date, shift, code, prod_name, name, family, combo, final,
           station, dc, desc, cnt, total, branch]
    ex = extra or {}
    # شیت SMD خالی بودن «رفع عیب»/«تست مجدد» را با «-» نشان می‌دهد؛
    # برای آن خالی بودن (None) حفظ می‌شود و در to_smd_row تبدیل می‌شود
    is_smd = bool(cfg.get("extra_month_col"))
    # در برخی شیت‌ها (ICT) هزینه و زمان‌های تعمیرات ردیف‌های تولید «-» است
    repair_dash = cfg.get("prod_repair_dash") and s(dc) in ("", "-")
    def tv(key):
        if repair_dash:
            return "-"
        v = ex.get(key)
        if v is not None:
            return v
        return 0 if not is_smd else None
    row += [
        ex.get("activity") or "-",
        ex.get("m6") or "-",
        ex.get("part_code") or "-",
        ex.get("part_name") or "-",
        ex.get("supplier") or "-",
        "-",
        "-",
        ex.get("equipment") or "-",
        ex.get("opc_code") or "-",
        ex.get("opc_name") or "-",
        ex.get("latent") or "-",
        ex.get("latent_type") or "-",
        ex.get("repair_note") or "-",
        "-",
        ex.get("severity", 0),
        ex.get("detection", 0),
        ex.get("occurrence", 0),
        tv("t_time"),
        tv("f_time"),
        tv("r_time"),
        CONST_COST if not repair_dash else "-",
        ex.get("part_family") or "-",
        "-",
        "-",
        "-",
        ex.get("operator") or "-",
        "-",
        ex.get("inspector") or "-",
        "-",
        "-",
        CONST_PART_TYPE,
        cfg.get("defect_decl", "-"),
        "-",
        "-",
        "-",
        CONST_LIMIT,
        CONST_TARGET,
        "-",
        CONST_LIMIT,
        CONST_TARGET,
    ]
    return row
def quality_extra(r):
    def g(k):
        return s(r.get(k)) or None
    def t(k):
        # مقدار عددی؛ خالی بودن None می‌ماند تا شیت‌ها بتوانند تصمیم بگیرند
        v = r.get(k)
        if v is None or s(v) in ("", "-"):
            return None
        return n(v)
    return {
        "activity": g("شرح فعالیت انجام شده توسط تعمیرات"),
        "m6": g("Mعامل مسبب 6"),
        "part_code": g("کد قطعه"),
        "part_name": g("نام قطعه"),
        "supplier": g("نام تامین کننده"),
        "equipment": g("کد و نام ابزارآلات و تجهیزات"),
        "opc_code": g("کد فرایند"),
        "opc_name": g("نام فرآیند OPC"),
        "latent": g("حالت خرابی بلقوه"),
        "latent_type": g("نوع حالت خرابی بلقوه"),
        "repair_note": g("توضیحات تعمیرات"),
        "severity": n(r.get("شدت حالت خرابی")),
        "detection": n(r.get("تشخیص حالت خرابی")),
        "occurrence": n(r.get("وقوع قدیمی")),
        "t_time": t("مدت زمان عیب یابی دقیقه"),
        "f_time": t("مدت زمان رفع عیب دقیقه"),
        "r_time": t("مدت زمان تست مجدد دقیقه"),
        "part_family": g("خانواده قطعات"),
        "operator": g("اپراتور مسبب ایراد"),
        "inspector": g("بازرس مسبب ایراد"),
        "placement": g("جانمایی"),
    }
# ---------------------------------------------------------------------------
# فیلترها
# ---------------------------------------------------------------------------
def in_prefix(code, prefixes):
    code = s(code)
    return any(code.startswith(p) for p in prefixes)
def code_allowed(cfg, code):
    if in_prefix(code, cfg["code_prefix"]):
        return True
    # کدهای ECU با ECU-07 به QC EMS می‌روند هرچند پیشوند 320 دارند
    if cfg["defect_filter"] == "qc_ems" and s(code) in ECU_FINAL_CONTROL_CODES:
        return True
    return False
def defect_kept(cfg, dc_norm, source_row):
    f = cfg["defect_filter"]
    if f == "any":
        return True
    if f == "ICT":
        return dc_norm.upper().startswith("ICT")
    if f == "non_qv":
        # عیب‌های QV فقط از «اطلاعات جامع کیفیت» وارد شیت qv می‌شوند؛
        # حتی اگر در فایل سند بازرسی همتای غیر-QV نداشته باشند، نباید به
        # FULTELE وارد شوند.
        if is_qv_title(source_row.get("title")):
            return False
        if dc_norm.upper() == "ICT_01":
            return False
        if s(source_row.get("title")).upper() == "ICT":
            return False
        return True
    if f == "fult_ems":
        if s(source_row["station"]) not in FULT_EMS_STATIONS:
            return False
        if (s(source_row["code"]) in ECU_FINAL_CONTROL_CODES
                and dc_norm == ECU_FINAL_CONTROL_DEFECT):
            return False
        return True
    if f == "qc_ems":
        if (s(source_row["code"]) in ECU_FINAL_CONTROL_CODES
                and dc_norm == ECU_FINAL_CONTROL_DEFECT):
            return True
        return in_prefix(source_row["code"], cfg["code_prefix"])
    return True
def prod_station_for(cfg, center):
    """ایستگاه ردیف‌های تولید:
      - شیت‌های ایستگاه ثابت (ICT، SMD، QC ELE، QC EMS): همان مقدار ثابت
      - «source» (qv و FULT EMS): نام مرکز کاری همان‌طور که هست
      - «title» (FULTELE): نام مرکز کاری با همان کوتاه‌نویسی ایستگاه (وان قلع)"""
    st = cfg["station"]
    if st not in ("source", "title"):
        return st
    c = s(center) or "-"
    if st == "title":
        c = STATION_RENAME_QUALITY.get(c, c)
    return c
def station_for(cfg, source_row, from_quality):
    st = cfg["station"]
    if st == "source":
        val = s(source_row["station"]) or "-"
        if from_quality:
            val = STATION_RENAME_QUALITY.get(val, val)
        return val
    if st == "title":
        title = s(source_row.get("title", ""))
        if (title and title not in ("تکمیل کاری", "ICT")
                and not is_qv_title(title)):
            return title
        return s(source_row.get("station", "")) or "-"
    return st


INPUT_SOURCE_LABELS = {
    "quality": "اطلاعات جامع کیفیت حین تولید",
    "defect": "گزارش عیب‌های سند بازرسی",
    "prod": "گزارش تعداد تولید",
}


def _freeze_input_value(value):
    """تبدیل مقدار احتمالیِ غیرقابل‌هش به مقدار قابل‌مقایسه."""
    if isinstance(value, dict):
        return tuple((k, _freeze_input_value(v)) for k, v in value.items())
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_input_value(v) for v in value)
    if isinstance(value, set):
        return tuple(sorted((_freeze_input_value(v) for v in value), key=repr))
    try:
        hash(value)
    except TypeError:
        return repr(value)
    return value


def input_row_key(source_kind, input_row):
    """اثر انگشت تمام ستون‌های یک ردیف از گزارش ورودی.

    حذف تکراری بر مبنای این کلید انجام می‌شود، نه بر مبنای ردیف تبدیل‌شدهٔ
    خروجی. در نتیجه دو ردیف ورودی که مثلاً شماره سفارش یا هر ستون استفاده‌نشدهٔ
    متفاوتی دارند، حتی اگر خروجی‌شان مشابه باشد، حذف نمی‌شوند.
    """
    columns = [(column, _freeze_input_value(value))
               for column, value in input_row.items()]
    # ترتیب ستون‌ها نباید نتیجه را عوض کند؛ نام و مقدار همهٔ ستون‌ها مقایسه می‌شود.
    columns.sort(key=lambda item: str(item[0]))
    return source_kind, tuple(columns)


def register_input_row(seen, source_kind, input_row_number, input_row):
    """ردیف ورودی را ثبت کند یا اطلاعات همتای کاملاً یکسانش را برگرداند."""
    key = input_row_key(source_kind, input_row)
    previous = seen.get(key)
    if previous is None:
        seen[key] = (input_row_number, 1)
        return None

    first_input_row, copies = previous
    copies += 1
    seen[key] = (first_input_row, copies)
    return {
        "source_label": INPUT_SOURCE_LABELS[source_kind],
        "first_input_row": first_input_row,
        "duplicate_input_row": input_row_number,
        "copy_number": copies,
        "input_row": input_row,
    }


def input_row_summary(input_row):
    """خلاصهٔ قابل‌خواندن برای لاگ ردیف ورودی حذف‌شده."""
    date = s(input_row.get("تاریخ سفارش") or input_row.get("تاریخ تولید"))
    code = s(input_row.get("کد محصول") or input_row.get("کد کالا"))
    defect_code = norm_dc(input_row.get("کد ایراد") or input_row.get("کد عیب"))
    count = input_row.get("تعداد ایراد")
    if count is None:
        count = input_row.get("تعداد عیب مربوطه")
    if count is None:
        count = input_row.get("تعداد عیب")
    if defect_code:
        return f"تاریخ={date} | کد={code} | عیب={defect_code} | تعداد ایراد={s(count)}"
    return f"تاریخ={date} | کد={code} | مقدار سالم={s(input_row.get('مقدار سالم'))}"


# ---------------------------------------------------------------------------
# تولید شیت‌ها
# ---------------------------------------------------------------------------
def build_sheet(cfg, quality, defect, prod, grp, history, month, dedup=False):
    rows = []
    seq = 0
    hist_defect, hist_prod = (history.get(cfg["name"]) or (Counter(), Counter()))
    skipped = 0
    dropped_nogroup = 0
    # این ساختار فقط برای گزینهٔ --dedup است و بر پایهٔ گزارش ورودی کار می‌کند.
    seen_input_rows = {}
    duplicate_details = []
    month_key = (int(month[:4]), int(month[5:7])) if month else None
    # ---- ردیف‌های عیب
    source_kind = cfg["defect_source"]
    source_rows = quality if source_kind == "quality" else defect
    # شمارهٔ واقعی اکسل را نگه می‌داریم تا لاگ تکراری‌ها دقیق باشد.
    src = list(enumerate(source_rows, start=2))
    if source_kind == "defect":
        if cfg["defect_filter"] == "non_qv":
            # FULTELE فقط عیب‌های 121 و 122 با عملیات واقعی را می‌گیرد.
            # عنوان عملیات QV، حتی اگر همتای غیر-QV نداشته باشد، فقط باید
            # از «اطلاعات جامع کیفیت» به شیت qv برسد.
            src = [(row_no, r) for row_no, r in src
                   if not is_qv_title(r.get("عنوان عملیات آزمایش"))]
        else:
            # برای سایر شیت‌های سند بازرسی، نسخهٔ غیر-QV اولویت دارد؛ اگر
            # وجود نداشت، نسخهٔ QV برای جلوگیری از گم‌شدن داده نگه داشته می‌شود.
            has_non_qv = set()
            for _, r in src:
                if (s(r.get("کد ایراد"))
                        and not is_qv_title(r.get("عنوان عملیات آزمایش"))):
                    has_non_qv.add((s(r.get("تاریخ سفارش")),
                                    s(r.get("کد محصول")),
                                    norm_dc(r.get("کد ایراد"))))
            src = [(row_no, r) for row_no, r in src
                   if (not is_qv_title(r.get("عنوان عملیات آزمایش"))
                       or (s(r.get("تاریخ سفارش")), s(r.get("کد محصول")),
                           norm_dc(r.get("کد ایراد"))) not in has_non_qv)]
    for input_row_number, r in src:
        code = s(r.get("کد محصول") or r.get("کد کالا"))
        if not code or not code_allowed(cfg, code):
            continue
        raw_dc = s(r.get("کد ایراد") or r.get("کد عیب"))
        if not raw_dc:
            continue
        dc = norm_dc(raw_dc)
        date = s(r.get("تاریخ سفارش"))
        if month_key and date_key(date)[:2] != month_key:
            continue
        source_row = {
            "code": code,
            "station": r.get("ایستگاه"),
            "title": r.get("عنوان عملیات آزمایش", ""),
        }
        if not defect_kept(cfg, dc, source_row):
            continue
        if dedup:
            duplicate = register_input_row(
                seen_input_rows, source_kind, input_row_number, r)
            if duplicate is not None:
                duplicate_details.append(duplicate)
                continue
        # پسوندهای همتاسازِ شرح (مثل (ف) و (1)) نیز مانند کد عیب حذف می‌شوند.
        desc = norm_defect_description(
            r.get("شرح ایراد") or r.get("شرح عیب")) or "-"
        cnt = n(r.get("تعداد ایراد") or r.get("تعداد عیب مربوطه") or r.get("تعداد عیب"))
        # ردیفی که قبلاً ثبت شده تکرار نمی‌شود. «تعداد ایراد» جزو کلید است؛
        # بنابراین مثلاً تعداد ۲ و ۳ هرگز با هم یک رکورد محسوب نمی‌شوند.
        hkey = (date, code, dc, cnt)
        if hist_defect.get(hkey, 0) > 0:
            hist_defect[hkey] -= 1
            skipped += 1
            continue
        shift = s(r.get("شیفت")) if cfg["defect_source"] == "defect" else "-"
        extra = quality_extra(r) if cfg["defect_source"] == "quality" else None
        row = make_row(cfg, grp, date, shift, code,
                       s(r.get("نام محصول") or r.get("نام کالا")),
                       station_for(cfg, source_row, cfg["defect_source"] == "quality"),
                       dc, desc, cnt, 0, extra)
        if cfg.get("extra_month_col"):
            row = insert_month(row)
            row = to_smd_row(row, extra.get("placement") if extra else None,
                             s(r.get("ایستگاه")))
        rows.append((code, date_key(date), seq, row))
        seq += 1
    # ---- ردیف‌های تولید
    for input_row_number, r in enumerate(prod, start=2):
        code = s(r.get("کد کالا"))
        if not code or not in_prefix(code, cfg["prod_prefix"]):
            continue
        center = s(r.get("مرکز کاری"))
        if cfg["prod_centers"] is not None and center not in cfg["prod_centers"]:
            continue
        if cfg.get("prod_requires_grouping", True) and code not in grp:
            dropped_nogroup += 1
            continue
        date = s(r.get("تاریخ تولید"))
        if month_key and date_key(date)[:2] != month_key:
            continue
        total = n(r.get("مقدار سالم"))
        if dedup:
            duplicate = register_input_row(
                seen_input_rows, "prod", input_row_number, r)
            if duplicate is not None:
                duplicate_details.append(duplicate)
                continue
        hkey = (date, code, total)
        if hist_prod.get(hkey, 0) > 0:
            hist_prod[hkey] -= 1
            skipped += 1
            continue
        station_val = prod_station_for(cfg, center)
        pshift = cfg["prod_shift"]
        if cfg.get("prod_shift_tamamil_empty") and station_val.startswith("تکمیل کاری"):
            pshift = ""
        row = make_row(cfg, grp, date, pshift, code,
                       s(r.get("نام کالا")), station_val,
                       "-", "-", cfg.get("prod_cnt", 0), total, None)
        if cfg.get("prod_branch") == "-":
            row[13] = "-"
        if cfg.get("extra_month_col"):
            row = insert_month(row)
            row = to_smd_row(row, None, center)
        rows.append((code, date_key(date), seq, row))
        seq += 1
        # ضایعات پلیمر: چون فایل ضایعات برای پلیمر جدا نیست، ستون
        # «مقدار ضایعات» همان سند عملکرد به عنوان یک ردیف عیب ثبت می‌شود
        # (فقط برای شیت‌هایی که scrap_as_defect دارند، یعنی فقط پلیمر).
        if cfg.get("scrap_as_defect"):
            scrap = n(r.get("مقدار ضایعات"))
            if scrap:
                srow = make_row(cfg, grp, date, pshift, code,
                                s(r.get("نام کالا")), station_val,
                                cfg.get("scrap_defect_code", "ضایعات"),
                                cfg.get("scrap_defect_desc", "ضایعات"),
                                scrap, 0, None)
                if cfg.get("prod_branch") == "-":
                    srow[13] = "-"
                rows.append((code, date_key(date), seq, srow))
                seq += 1
    order = {}
    for i, (code, dk, seq_i, row) in enumerate(rows):
        order.setdefault(code, len(order))
    rows.sort(key=lambda t: (order[t[0]], t[1], t[2]))
    data = [t[3] for t in rows]
    # duplicate_details فقط از مقایسهٔ تمام ستون‌های گزارش ورودی ساخته شده است.
    return data, skipped, dropped_nogroup, duplicate_details
def style_sheet(ws, ncols):
    for c in range(1, ncols + 1):
        ws.cell(row=1, column=c).font = Font(bold=True)
    ws.freeze_panes = "A2"
    ws.sheet_view.rightToLeft = True
def norm_val(v):
    t = s(v)
    if re.fullmatch(r"-?\d+\.0", t):
        t = t[:-2]
    return t
def sheet_rows(path, name):
    wb = openpyxl.load_workbook(path, data_only=True)
    for sh in wb.sheetnames:
        if sh.strip() == name.strip():
            ws = wb[sh]
            rows = list(ws.iter_rows(values_only=True))
            return [tuple(norm_val(v) for v in r) for r in rows[1:]
                    if any(v is not None for v in r)]
    return []
def validate(gen_path, ref_path, log=print):
    log("\n========== مقایسه با رپورت مرجع ==========")
    for cfg in SHEETS:
        name = cfg["name"] + (" " if cfg["name"] == "qv" else "")
        gen = sheet_rows(gen_path, name)
        ref = sheet_rows(ref_path, name)
        g = [r[:14] for r in gen]
        r_ = [r[:14] for r in ref]
        cg, cr = Counter(g), Counter(r_)
        only_gen = cg - cr
        only_ref = cr - cg
        both = cg & cr
        log(f"  {name:>12}: مشترک {sum(both.values()):>4} | "
            f"فقط خروجی {sum(only_gen.values()):>3} | فقط مرجع {sum(only_ref.values()):>3}")
        for k, v in list(only_ref.most_common(4)):
            log(f"        - فقط مرجع : {k[0]} | {k[2]} | {k[8]} | {k[9]} | cnt={k[11]} | tot={k[12]}")
        for k, v in list(only_gen.most_common(4)):
            log(f"        + فقط خروجی: {k[0]} | {k[2]} | {k[8]} | {k[9]} | cnt={k[11]} | tot={k[12]}")
def run_build(quality, defect, prod, grouping, history=None, month=None,
              out=None, validate_path=None, dedup=False, log=print):
    """اجرای ساخت رپورت؛ log تابع خروجی‌دهنده (در حالت گرافیکی به لاگ فرستاده می‌شود)"""
    quality_rows = load_sheet(quality)
    defect_rows = load_sheet(defect)
    prod_rows = load_sheet(prod)
    grp_rows, grp_hdr, grp_info = load_grouping(grouping)
    history_grp = []
    hist_reported = None
    if history:
        log(f"خواندن رپورت قبل: {history}")
        history_grp, hist_reported = read_history(history)
    grp = build_grouping(grp_rows, history_grp)
    cur_codes = {s(r.get("کد راهکاران")) for r in grp_rows if s(r.get("کد راهکاران"))}
    log(f"جدول گروه‌بندی: {len(grp)} کد (فایل فعلی: {len(cur_codes)}; {grp_info}"
        + (f" + رپورت قبل: {len(grp) - len(cur_codes)}" if len(grp) > len(cur_codes) else "") + ")")
    if cur_codes:
        log(f"  نمونه کدها: {', '.join(list(cur_codes)[:3])}")
    missing_cols = [c for c in ("نام محصول", "خانواده محصول", "نام محصول ترکیبی",
                                "گروه محصول نهایی", "برنچ") if c not in grp_hdr]
    if missing_cols:
        log(f"  ⚠ ستون‌های موجود نبود در جدول گروه‌بندی: {', '.join(missing_cols)}")
    if not grp:
        log("  ⚠ هشدار: هیچ کدی از جدول گروه‌بندی خوانده نشد؛ همه ردیف‌های رپورت "
            "#N/A می‌شوند. مطمئن شوید ستونی با هدر «کد راهکاران» یا "
            "«کد گروه محصول» در جدول هست و کدهای آن با «کد کالا» "
            "فایل‌های سایت یکی‌اند (مثل 3206133).")
    out_wb = openpyxl.Workbook()
    out_wb.remove(out_wb.active)
    for cfg in SHEETS:
        data, skipped, nogroup, duplicate_details = build_sheet(
            cfg, quality_rows, defect_rows, prod_rows, grp,
            hist_reported or {}, month, dedup=dedup)
        title = cfg["name"] + (" " if cfg["name"] == "qv" else "")
        ws = out_wb.create_sheet(title=title)
        ws.append(headers_for(cfg))
        for row in data:
            ws.append(row)
        style_sheet(ws, len(headers_for(cfg)))
        ndef = sum(1 for row in data
                   if s(row[9] if not cfg.get("extra_month_col") else row[10])
                   not in ("", "-"))
        # این تعداد مربوط به رپورت ماه قبل است، نه تکراری‌های داخل فایل فعلی.
        extra = (f" | قبلاً در رپورت ماه قبل ثبت شده: {skipped}"
                 if skipped else "")
        if nogroup:
            extra += f" | بدون گروه‌بندی: {nogroup}"
        if duplicate_details:
            extra += (" | تکراریِ کاملاً یکسان در گزارش ورودی: "
                      f"{len(duplicate_details)}")
        log(f"  شیت {title:>12}: {len(data):>4} ردیف (عیب: {ndef} | "
            f"تولید: {len(data)-ndef}){extra}")
        if duplicate_details:
            log("      نکته: مقایسهٔ تکراری با تمام ستون‌های گزارش ورودی انجام شد؛ "
                "شباهتِ خروجی به‌تنهایی باعث حذف نمی‌شود.")
            for detail in duplicate_details[:8]:
                log(f"      - نسخهٔ {detail['copy_number']} از سطر ورودی "
                    f"{detail['duplicate_input_row']} حذف شد؛ با سطر ورودی "
                    f"{detail['first_input_row']} در «{detail['source_label']}» "
                    f"در تمام ستون‌ها یکسان است: "
                    f"{input_row_summary(detail['input_row'])}")
            if len(duplicate_details) > 8:
                log(f"      - ...و {len(duplicate_details) - 8} سطر ورودی کاملاً یکسان دیگر")
    ws = out_wb.create_sheet(title="گروه بندی محصولات")
    if grp_rows:
        hdr = list(grp_rows[0].keys())
        ws.append(hdr)
        for r in grp_rows:
            ws.append([r.get(k) for k in hdr])
        style_sheet(ws, len(hdr))
    out_wb.save(out)
    log(f"\nخروجی ذخیره شد: {out}")
    if validate_path:
        validate(out, validate_path, log=log)
def _find_logo():
    """لوگو: فایل logo.png/gif/jpg کنار اسکریپت (یا در پوشهٔ اجرا)"""
    here = os.path.dirname(os.path.abspath(__file__))
    for d in (here, os.getcwd()):
        for name in ("logo.png", "logo.gif", "logo.jpg", "logo.jpeg"):
            p = os.path.join(d, name)
            if os.path.isfile(p):
                return p
    return None
def _load_logo(tk, path, max_h=56):
    """بارگذاری لوگو و کوچک‌کردن آن؛ اگر نشد None"""
    try:
        if path.lower().endswith((".png", ".gif")):
            img = tk.PhotoImage(file=path)
            f = max(1, img.height() // max_h)
            if f > 1:
                img = img.subsample(f, f)
            return img
        from PIL import Image, ImageTk
        im = Image.open(path)
        im.thumbnail((max_h * 4, max_h))
        return ImageTk.PhotoImage(im)
    except Exception:
        return None
def run_gui():
    """حالت گرافیکی: بارگذاری فایل‌ها و انتخاب مسیر خروجی"""
    import queue
    import threading
    import tkinter as tk
    from tkinter import filedialog, messagebox
    app = tk.Tk()
    app.title(APP_TITLE)
    app.geometry("780x800")
    # بررسی لایسنس: اگر معتبر نبود پنجرهٔ فعال‌سازی باز می‌شود
    lic = ensure_license(app, tk=tk)
    if lic is None:
        app.destroy()
        return
    # سربرگ: لوگو بزرگ + عنوان + نام و تلفن (ثابت و غیرقابل تغییر از داخل برنامه)
    header = tk.Frame(app)
    header.pack(fill="x", padx=12, pady=(8, 2))
    logo_path = _find_logo()
    logo_img = _load_logo(tk, logo_path, max_h=150) if logo_path else None
    if logo_img is not None:
        logo_lbl = tk.Label(header, image=logo_img)
        logo_lbl.image = logo_img      # نگه‌داشتن مرجع تا تصویر جمع‌آوری نشود
        logo_lbl.pack(side="left", padx=(0, 12), pady=4)
    title_box = tk.Frame(header)
    title_box.pack(side="right", anchor="n", fill="x", expand=True)
    tk.Label(title_box, text=APP_TITLE, font=("", 14, "bold")).pack(anchor="e", pady=(4, 2))
    tk.Label(title_box, text=f"نام: {APP_OWNER}    |    تلفن: {APP_PHONE}",
             fg="#444").pack(anchor="e", pady=(0, 0))
    tk.Label(title_box, text=f"لایسنس: {lic['company']}   |   تا {lic['expiry'].isoformat()}",
             fg="#0a600a").pack(anchor="e", pady=(0, 4))
    tk.Label(app, text="فایل‌ها را انتخاب کنید و روی «تولید رپورت» بزنید",
             font=("", 11, "bold")).pack(pady=(0, 2))
    tk.Label(app, text="رپورت ماه قبل و ماه، اختیاری‌اند", fg="#555").pack(pady=(0, 6))
    fields = {}
    labels = {}
    def add_file(label, key, save=False):
        row = tk.Frame(app)
        row.pack(fill="x", padx=12, pady=3)
        ent = tk.Entry(row)
        ent.pack(side="right", fill="x", expand=True)
        btn = tk.Button(row, text="انتخاب...", width=10)
        btn.pack(side="left", padx=(0, 6))
        tk.Label(row, text=label, width=34, anchor="e").pack(side="left")
        def pick():
            if save:
                m = month_ent.get().strip()
                name = (f"QC Report راهکاران - {m}.xlsx" if m
                        else "QC Report راهکاران.xlsx")
                path = filedialog.asksaveasfilename(
                    title="فایل خروجی", defaultextension=".xlsx",
                    initialfile=name, filetypes=[("فایل اکسل", "*.xlsx")])
            else:
                path = filedialog.askopenfilename(
                    title=label, filetypes=[("فایل اکسل", "*.xlsx *.xlsm"),
                                             ("همه فایل‌ها", "*.*")])
            if path:
                ent.delete(0, "end")
                ent.insert(0, path)
        btn.config(command=pick)
        fields[key] = ent
        labels[key] = label
        return ent
    add_file("اطلاعات جامع کیفیت حین تولید:", "quality")
    add_file("گزارش عیب های سند بازرسی:", "defect")
    add_file("گزارش تعداد تولید به تفکیک سند عملکرد:", "prod")
    add_file("گروه بندی محصولات:", "grouping")
    add_file("رپورت ماه قبل (برای ادامه بدون تکرار):", "history")
    mrow = tk.Frame(app)
    mrow.pack(fill="x", padx=12, pady=3)
    month_ent = tk.Entry(mrow, width=14)
    month_ent.pack(side="right")
    tk.Label(mrow, text="ماه (مثلا 1405/06):", width=34, anchor="e").pack(side="left")
    dedup_var = tk.BooleanVar(value=False)
    drow = tk.Frame(app)
    drow.pack(fill="x", padx=12, pady=3)
    tk.Checkbutton(
        drow, variable=dedup_var,
        text="فقط ردیف‌های صددرصد یکسانِ گزارش‌های ورودی را حذف کن (تمام ستون‌های "
             "همان ردیف باید یکسان باشند؛ شباهت خروجی کافی نیست)"
    ).pack(side="right")
    add_file("فایل خروجی:", "out", save=True)
    run_btn = tk.Button(app, text="تولید رپورت", font=("", 12, "bold"),
                        command=None)
    run_btn.pack(pady=12, ipadx=24, ipady=4)
    log_frame = tk.Frame(app)
    log_frame.pack(fill="both", expand=True, padx=12, pady=(0, 6))
    log_text = tk.Text(log_frame, height=14, state="disabled", wrap="word")
    sb = tk.Scrollbar(log_frame, command=log_text.yview)
    log_text.configure(yscrollcommand=sb.set)
    sb.pack(side="right", fill="y")
    log_text.pack(side="left", fill="both", expand=True)
    status = tk.Label(app, text="", fg="#0a600a")
    status.pack(pady=(0, 8))
    q = queue.Queue()
    state = {"running": False}
    def append_log(msg):
        log_text.config(state="normal")
        log_text.insert("end", str(msg) + "\n")
        log_text.see("end")
        log_text.config(state="disabled")
    def set_status(msg, color="#0a600a"):
        status.config(text=msg, fg=color)
    def start():
        if state["running"]:
            return
        month = month_ent.get().strip()
        missing = [labels[k] for k in ("quality", "defect", "prod", "grouping", "out")
                   if not fields[k].get().strip()]
        if missing:
            messagebox.showwarning(
                "اطلاعات ناقص",
                "این فیلدها خالی‌اند:\n" + "\n".join(missing))
            return
        out = fields["out"].get().strip()
        if not out.lower().endswith((".xlsx", ".xlsm")):
            out += ".xlsx"
        state["running"] = True
        run_btn.config(state="disabled")
        set_status("در حال تولید...", "#1a4f9c")
        log_text.config(state="normal")
        log_text.delete("1.0", "end")
        log_text.config(state="disabled")
        def worker():
            try:
                run_build(
                    quality=fields["quality"].get().strip(),
                    defect=fields["defect"].get().strip(),
                    prod=fields["prod"].get().strip(),
                    grouping=fields["grouping"].get().strip(),
                    history=fields["history"].get().strip() or None,
                    month=month or None,
                    out=out,
                    dedup=bool(dedup_var.get()),
                    log=lambda m: q.put(m),
                )
                q.put(("__done__", out))
            except Exception as exc:
                q.put(("__error__", str(exc)))
        threading.Thread(target=worker, daemon=True).start()
    def poll():
        try:
            while True:
                item = q.get_nowait()
                if isinstance(item, tuple):
                    tag, msg = item
                    state["running"] = False
                    run_btn.config(state="normal")
                    if tag == "__done__":
                        set_status(f"تمام شد: {msg}", "#0a600a")
                    else:
                        set_status("خطا!", "#b00020")
                        messagebox.showerror("خطا", msg)
                else:
                    append_log(item)
        except queue.Empty:
            pass
        app.after(100, poll)
    run_btn.config(command=start)
    poll()
    app.mainloop()
def _make_license_cli(cli_args):
    """ساخت کد لایسنس (ابزار مالک)"""
    ap = argparse.ArgumentParser(
        description="ساخت کد لایسنس برای مشتری (فقط مالک)")
    ap.add_argument("company", help="نام شرکت/مشتری روی لایسنس")
    ap.add_argument("--days", type=int, default=365,
                    help="تعداد روز اعتبار (پیش‌فرض 365)")
    ap.add_argument("--date", default=None,
                    help="تاریخ انقضا YYYY-MM-DD (به‌جای --days)")
    m = ap.parse_args(cli_args[cli_args.index("--make-license") + 1:])
    date = datetime.date.fromisoformat(m.date) if m.date else None
    key, expiry = make_license_key(m.company, days=m.days, date=date)
    print("کد لایسنس:")
    print(" ", key)
    print(f"شرکت: {m.company}")
    print(f"معتبر تا: {expiry.isoformat()}")
    print("\nاین کد را به مشتری بدهید؛ او در پنجرهٔ «فعال‌سازی لایسنس» واردش می‌کند.")
def main():
    cli_args = sys.argv[1:]
    # ابزار مالک: ساخت کد لایسنس
    if "--make-license" in cli_args:
        _make_license_cli(cli_args)
        return
    # اجرا بدون هیچ پارامتری (مثلاً دابل‌کلیک) یا با --gui → حالت گرافیکی
    if not cli_args or "--gui" in cli_args:
        run_gui()
        return
    ap = argparse.ArgumentParser(description="سازندهٔ رپورت QC راهکاران")
    ap.add_argument("--quality", required=True)
    ap.add_argument("--defect", required=True)
    ap.add_argument("--prod", required=True)
    ap.add_argument("--grouping", required=True)
    ap.add_argument("--history", default=None,
                    help="رپورت ماه قبل؛ برای جدول گروه‌بندی و حذف تکراری‌ها")
    ap.add_argument("--month", default=None, help="مثلا 1405/06 (اختیاری)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--validate", default=None)
    ap.add_argument("--dedup", action="store_true",
                    help="رکوردهای کاملاً تکراری (همهٔ ستون‌ها یکسان) را جدا کند؛ "
                         "یکی نگه داشته می‌شود")
    ap.add_argument("--gui", action="store_true",
                    help="حالت گرافیکی (بدون بقیهٔ پارامترها اجرا شود)")
    ap.add_argument("--license", default=None,
                    help="کد لایسنس (اگر license.key کنار برنامه نباشد)")
    args = ap.parse_args()
    lic = ensure_license(cli_key=args.license)
    if lic is None:
        print("برنامه بدون لایسنس معتبر اجرا نمی‌شود.")
        print("کد لایسنس را با --license \"CODE\" بفرستید یا آن را در فایل")
        print("license.key کنار اسکریپت ذخیره کنید.")
        print("دریافت کد: 09216895359 - سعید کاظمی‌پور")
        sys.exit(2)
    run_build(quality=args.quality,
              defect=args.defect,
              prod=args.prod,
              grouping=args.grouping,
              history=args.history,
              month=args.month,
              out=args.out,
              validate_path=args.validate,
              dedup=args.dedup)
if __name__ == "__main__":
    main()
