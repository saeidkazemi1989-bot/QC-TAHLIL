/**
 * اجرای ابزار تبدیل گزارش‌های راهکاران (qc.py)
 * ---------------------------------------------------------------
 * چهار فایل خامِ خروجیِ راهکاران را می‌گیرد و «گزارش تمیز» را
 * در پوشه data/clean می‌سازد؛ همان فایلی که بعداً توسط ETL بارگذاری می‌شود.
 *
 * اجرا:  npm run clean
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ROOT, RAW_DIR, CLEAN_DIR } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.log('[clean]', ...a);

/** پیدا کردن مفسر پایتون در دسترس (نتیجه کش می‌شود تا سرور بلاک نشود) */
let PYTHON_CACHE;
function findPython() {
  if (PYTHON_CACHE !== undefined) return PYTHON_CACHE;
  for (const cmd of ['python3', 'python', 'py']) {
    const args = cmd === 'py' ? ['-3', '--version'] : ['--version'];
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    if (!r.error && r.status === 0) {
      PYTHON_CACHE = cmd === 'py' ? { cmd, prefix: ['-3'] } : { cmd, prefix: [] };
      return PYTHON_CACHE;
    }
  }
  PYTHON_CACHE = null;
  return null;
}

/** تشخیص نوع فایل بر اساس نام ستون‌ها با کمک یک اسکریپت پایتون کوتاه (نتیجه کش می‌شود) */
const SNIFF_CACHE = new Map();
function sniff(python, file) {
  let key = file;
  try {
    const st = fs.statSync(file);
    key = file + '|' + st.mtimeMs + '|' + st.size;
  } catch { /* فایل ممکن است در همان لحظه جابه‌جا شود */ }
  if (SNIFF_CACHE.has(key)) return SNIFF_CACHE.get(key);
  const code = `
import sys, json
try:
    from openpyxl import load_workbook
except Exception as e:
    print(json.dumps({"error": "openpyxl-not-installed"}))
    sys.exit(0)
try:
    wb = load_workbook(sys.argv[1], read_only=True, data_only=True)
    ws = wb.worksheets[0]
    hdr = [str(c.value).strip() if c.value is not None else '' for c in next(ws.iter_rows(min_row=1, max_row=1))]
    print(json.dumps({"headers": hdr}, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"error": str(e)}, ensure_ascii=False))
`;
  const r = spawnSync(python.cmd, [...python.prefix, '-c', code, file], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  const out = (r.stdout || '').trim();
  let res;
  try {
    res = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  } catch {
    res = { error: 'خروجی نامعتبر' };
  }
  if (SNIFF_CACHE.size > 40) SNIFF_CACHE.clear();
  SNIFF_CACHE.set(key, res);
  return res;
}

/** تشخیص نقش هر فایل خام از روی ستون‌ها */
function roleOf(headers) {
  const h = (headers || []).map((x) => String(x).replace(/\s+/g, ' ').trim());
  const set = new Set(h);
  const has = (...n) => n.some((x) => set.has(x));
  if (has('برنچ') && (has('کد راهکاران') || has('کد گروه محصول')) && !has('تعداد ایراد')) return 'grouping';
  if (has('عنوان عملیات آزمایش')) return 'defect';
  if (has('تعداد پرسنل تولید', 'تعداد پرسنل') && has('مرکز کاری')) return 'prod';
  if (has('Mعامل مسبب 6', 'M عامل مسبب 6', 'عامل مسبب ایراد 6M') || (has('تعداد عیب') && has('ایستگاه'))) return 'quality';
  return null;
}
/** نقش فایل‌های خامِ موجود (بدون اجرای تبدیل) — برای نمایش در رابط کاربری. */
export function rawRoles() {
  const python = findPython();
  if (!python) return { ok: false, message: 'پایتون در دسترس نیست' };
  const out = {};
  const names = fs.readdirSync(RAW_DIR).filter((x) => /\.xlsx$/i.test(x) && x.indexOf('~') !== 0);
  for (const f of names) {
    const full = path.join(RAW_DIR, f);
    const info = sniff(python, full);
    let t = 0;
    let size = 0;
    try { const st = fs.statSync(full); t = st.mtimeMs; size = st.size; } catch {}
    out[f] = { role: info.error ? null : roleOf(info.headers), mtime: t, size, error: info.error || null };
  }
  return { ok: true, files: out };
}
/** آماده‌سازی تبدیل: پیدا کردن فایل‌های خام، تشخیص نقش و ساخت آرگومان‌های qc.py */
function prepareClean({ outName = null } = {}) {
  const python = findPython();
  if (!python) {
    return { ok: false, message: 'پایتون روی این سیستم پیدا نشد. ابزار تبدیل (run_windows.bat) را اجرا کنید و خروجی را در پوشه data/clean قرار دهید.' };
  }

  const files = fs.readdirSync(RAW_DIR)
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'))
    .map((f) => path.join(RAW_DIR, f));
  if (!files.length) return { ok: false, message: `هیچ فایل اکسلی در پوشه ${RAW_DIR} نیست` };

  // نقش هر فایل از روی ستون‌ها تشخیص داده می‌شود؛ اگر چند نسخه از یک نقش باشد،
  // جدیدترین (بر اساس زمانِ ویرایش) انتخاب می‌شود تا فایلِ قدیمی دادهٔ نو را نپوشاند.
  const byRole = {};
  for (const f of files) {
    const info = sniff(python, f);
    if (info.error) {
      return { ok: false, message: `امکان خواندن فایل‌ها با پایتون نیست (${info.error}). کتابخانه openpyxl را نصب کنید: pip install openpyxl` };
    }
    const role = roleOf(info.headers);
    if (!role) continue;
    let t = 0;
    try { t = fs.statSync(f).mtimeMs; } catch {}
    (byRole[role] = byRole[role] || []).push({ f, t });
  }
  const found = {};
  const duplicates = {};
  for (const [role, list] of Object.entries(byRole)) {
    list.sort((a, b) => b.t - a.t);
    found[role] = list[0].f;
    if (list.length > 1) duplicates[role] = list.map((x) => path.basename(x.f));
  }

  const missing = ['quality', 'defect', 'prod', 'grouping'].filter((r) => !found[r]);
  if (missing.length) {
    const names = { quality: 'اطلاعات جامع کیفیت حین تولید', defect: 'گزارش عیب‌های سند بازرسی', prod: 'گزارش تعداد تولید به تفکیک سند عملکرد', grouping: 'گروه‌بندی محصولات' };
    return { ok: false, message: `فایل‌های زیر در پوشه data/raw پیدا نشد: ${missing.map((m) => names[m]).join('، ')}` };
  }

  fs.mkdirSync(CLEAN_DIR, { recursive: true });

  // نام خروجی: هرگز گزارش تمیزِ موجود را بازنویسی نمی‌کنیم
  const baseName = 'QC Report راهکاران.xlsx';
  let outName2 = outName;
  if (!outName2) {
    const target = path.join(CLEAN_DIR, baseName);
    outName2 = fs.existsSync(target)
      ? `QC Report راهکاران ${new Date().toISOString().slice(0, 10)}.xlsx`
      : baseName;
  }
  const out = path.join(CLEAN_DIR, outName2);

  // جدیدترین گزارش تمیز قبلی به عنوان تاریخچه (برای حذف ردیف‌های تکراری)
  const prev = fs.existsSync(CLEAN_DIR)
    ? fs.readdirSync(CLEAN_DIR)
      .filter((f) => /^QC Report.*\.xlsx$/i.test(f) && f !== outName2)
      .map((f) => ({ f, t: fs.statSync(path.join(CLEAN_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0]
    : null;

  const args = [
    path.join(ROOT, 'qc.py'),
    '--quality', found.quality,
    '--defect', found.defect,
    '--prod', found.prod,
    '--grouping', found.grouping,
    '--out', out
  ];
  if (prev) {
    args.push('--history', path.join(CLEAN_DIR, prev.f));
    log('گزارش قبلی به عنوان تاریخچه:', prev.f);
  }
  return { ok: true, python, args, out, name: outName2, history: prev ? prev.f : null, found, duplicates };
}

/** نسخهٔ همگام — برای `npm run clean` در خط فرمان. */
export function runClean(opts = {}) {
  const prep = prepareClean(opts);
  if (!prep.ok) return prep;
  log('در حال اجرای ابزار تبدیل…');
  const r = spawnSync(prep.python.cmd, [...prep.python.prefix, ...prep.args], { encoding: 'utf8', cwd: ROOT, maxBuffer: 1024 * 1024 * 200 });
  if (r.stdout) console.log(String(r.stdout).trim());
  if (r.error) return { ok: false, message: String(r.error.message || r.error) };
  if (r.status !== 0) {
    return { ok: false, message: `اجرای ابزار تبدیل ناموفق بود (کد ${r.status}). ${String(r.stderr || '').slice(0, 400)}` };
  }
  if (r.stderr) console.error(String(r.stderr).trim());
  if (!fs.existsSync(prep.out)) return { ok: false, message: 'فایل خروجی ساخته نشد' };
  log('گزارش تمیز ساخته شد:', prep.out);
  return { ok: true, out: prep.out, file: path.basename(prep.out), used: prep.found, duplicates: prep.duplicates };
}

/**
 * نسخهٔ ناهمگام — سرور در جریان تبدیل قفل نمی‌شود: داشبورد باز می‌ماند و
 * وضعیت «در حال به‌روزرسانی» از /api/admin/pipeline قابل دیدن است.
 */
export function runCleanAsync(opts = {}) {
  const prep = prepareClean(opts);
  if (!prep.ok) return Promise.resolve(prep);
  return new Promise((resolve) => {
    const t0 = Date.now();
    log('در حال اجرای ابزار تبدیل…');
    const child = spawn(prep.python.cmd, [...prep.python.prefix, ...prep.args], { cwd: ROOT });
    let so = '';
    let se = '';
    child.stdout.on('data', (d) => { so += d.toString(); });
    child.stderr.on('data', (d) => { se += d.toString(); });
    child.on('error', (e) => resolve({ ok: false, message: `اجرای ابزار تبدیل ناموفق: ${e.message || e}` }));
    child.on('close', (code) => {
      const secs = Number(((Date.now() - t0) / 1000).toFixed(1));
      if (so) console.log(so.trim());
      if (code !== 0) {
        return resolve({ ok: false, message: `اجرای ابزار تبدیل ناموفق بود (کد ${code}). ${se.slice(0, 400)}` });
      }
      if (se) console.error(se.trim());
      if (!fs.existsSync(prep.out)) return resolve({ ok: false, message: 'فایل خروجی ساخته نشد' });
      log('گزارش تمیز ساخته شد:', prep.out, `(${secs}s)`);
      resolve({ ok: true, out: prep.out, file: path.basename(prep.out), secs, used: prep.found, duplicates: prep.duplicates });
    });
  });
}


/** اجرای مستقیم: node server/clean.mjs */
if (import.meta.url === `file://${process.argv[1]}`) {
  const res = runClean();
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}
void __dirname;
