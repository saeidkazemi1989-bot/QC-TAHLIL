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
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ROOT, RAW_DIR, CLEAN_DIR } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.log('[clean]', ...a);

/** پیدا کردن مفسر پایتون در دسترس */
function findPython() {
  for (const cmd of ['python3', 'python', 'py']) {
    const args = cmd === 'py' ? ['-3', '--version'] : ['--version'];
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    if (!r.error && r.status === 0) return cmd === 'py' ? { cmd, prefix: ['-3'] } : { cmd, prefix: [] };
  }
  return null;
}

/** تشخیص نوع فایل بر اساس نام ستون‌ها با کمک یک اسکریپت پایتون کوتاه */
function sniff(python, file) {
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
  try {
    return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  } catch {
    return { error: 'خروجی نامعتبر' };
  }
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

export function runClean({ outName = null } = {}) {
  const python = findPython();
  if (!python) {
    return { ok: false, message: 'پایتون روی این سیستم پیدا نشد. ابزار تبدیل (run_windows.bat) را اجرا کنید و خروجی را در پوشه data/clean قرار دهید.' };
  }

  const files = fs.readdirSync(RAW_DIR)
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'))
    .map((f) => path.join(RAW_DIR, f));
  if (!files.length) return { ok: false, message: `هیچ فایل اکسلی در پوشه ${RAW_DIR} نیست` };

  const found = {};
  for (const f of files) {
    const info = sniff(python, f);
    if (info.error) {
      return { ok: false, message: `امکان خواندن فایل‌ها با پایتون نیست (${info.error}). کتابخانه openpyxl را نصب کنید: pip install openpyxl` };
    }
    const role = roleOf(info.headers);
    if (role && !found[role]) found[role] = f;
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

  log('در حال اجرای ابزار تبدیل…');
  const r = spawnSync(python.cmd, [...python.prefix, ...args], { encoding: 'utf8', cwd: ROOT, maxBuffer: 1024 * 1024 * 200 });
  if (r.stdout) console.log(String(r.stdout).trim());
  if (r.error) return { ok: false, message: String(r.error.message || r.error) };
  if (r.status !== 0) {
    return { ok: false, message: `اجرای ابزار تبدیل ناموفق بود (کد ${r.status}). ${String(r.stderr || '').slice(0, 400)}` };
  }
  if (r.stderr) console.error(String(r.stderr).trim());
  if (!fs.existsSync(out)) return { ok: false, message: 'فایل خروجی ساخته نشد' };

  log('گزارش تمیز ساخته شد:', out);
  return { ok: true, out, file: path.basename(out) };
}

/** اجرای مستقیم: node server/clean.mjs */
if (import.meta.url === `file://${process.argv[1]}`) {
  const res = runClean();
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}
void __dirname;
