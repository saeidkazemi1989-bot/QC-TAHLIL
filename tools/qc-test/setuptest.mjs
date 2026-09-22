/* آزمونِ «نصبِ خودکارِ نیازمندی‌ها» — endpoint، رابط، و فایل‌های راه‌اندازِ ویندوز
 * اجرا: node setuptest.mjs   (سرور روی پورت ۳۰۰۰ لازم است) */
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const REPO = '/home/user/QC-TAHLIL';
const BASE = process.env.QC_BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name, extra); } };

const login = async (username) => {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
  return (await r.json()).token;
};
const post = async (path, token) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {} });
  let body = null;
  try { body = await r.json(); } catch { /* ignore */ }
  return { status: r.status, body };
};

console.log('— دسترسیِ endpoint —');
const A = await login('admin'), M = await login('manager'), E = await login('expert');
ok('admin/manager/expert وارد می‌شوند', !!(A && M && E));
ok('بدونِ توکن ⇒ ۴۰۱', (await post('/api/admin/setup-python', null)).status === 401);
ok('مدیر ارشد ⇒ ۴۰۳', (await post('/api/admin/setup-python', M)).status === 403);
ok('کارشناس کیفیت ⇒ ۴۰۳', (await post('/api/admin/setup-python', E)).status === 403);

console.log('— اجرای نصب برای مدیر سیستم (ممکن است چند ده ثانیه طول بکشد) —');
const r = await post('/api/admin/setup-python', A);
ok('پاسخ ۲۰۰ است', r.status === 200, String(r.status));
ok('نصب موفق گزارش می‌شود', r.body?.ok === true, JSON.stringify(r.body?.message || r.body).slice(0, 160));
ok('وضعیتِ پایتون: openpyxl دارد', r.body?.python?.openpyxl === true && r.body?.python?.ok === true);
ok('دستورِ اجرا‌شده برای کاربر قابلِ دیدن است', /pip install|چیزی برای نصب نبود/.test(r.body?.command || ''), r.body?.command);
const tot = r.body?.result?.import?.totals || {};
ok('پس از نصب، داده‌ها ساخته/بارگذاری شد', (tot.inprocess || 0) > 0 && (tot.production || 0) > 0, JSON.stringify(tot));

const health = await (await fetch(BASE + '/api/health')).json();
ok('health وضعیتِ دقیقِ پایتون را می‌دهد', !!health.watcher?.python && health.watcher.python_ready === true);
ok('و چون داده هست، تشخیصی نمی‌دهد', Array.isArray(health.diagnostics) && health.diagnostics.length === 0, JSON.stringify(health.diagnostics));

console.log('— رابطِ کاربری —');
const pages = fs.readFileSync(REPO + '/public/js/pages.js', 'utf8');
ok('دکمهٔ «نصبِ خودکارِ openpyxl» ساخته می‌شود', pages.includes('data-act="setup-python"'));
ok('فقط وقتی پایتون هست و openpyxl نیست', /pipe && !pipe\.python_ready/.test(pages) && /pipe\.python && pipe\.python\.python/.test(pages));
ok('کلیک به doSetupPython وصل است', /if \(b\.dataset\.act === 'setup-python'\) return doSetupPython\(b\);/.test(pages));
ok('پس از نصب، داده‌ها تازه می‌شود و پیامِ موفقیت می‌آید', /api\/admin\/setup-python/.test(pages) && /نیازمندی‌ها نصب شد/.test(pages));
ok('وضعیتِ پایتون سه حالت دارد', /پایتون هست، openpyxl نصب نیست/.test(pages) && /پایتون نصب نیست/.test(pages));

console.log('— فایل‌های راه‌اندازِ ویندوز —');
for (const f of ['install_windows.bat', 'run_windows.bat']) {
  const b = fs.readFileSync(REPO + '/' + f);
  const s = b.toString('utf8');
  ok(`${f}: پایانِ سطر CRLF (برای cmd لازم است)`, b.includes(Buffer.from('\r\n')) && !/(^|[^\r])\n/.test(s.replace(/\r\n/g, '')));
  ok(`${f}: پایتون را از PATH هم پیدا می‌کند`, /call :trywhere python/.test(s) && /call :trywhere py "-3"/.test(s));
  ok(`${f}: اشاره‌گرِ فروشگاه مایکروسافت را رد می‌کند`, /--version >nul 2>nul/.test(s));
}
const inst = fs.readFileSync(REPO + '/install_windows.bat', 'utf8');
ok('install: openpyxl را پس از نصب آزمایش می‌کند', /import openpyxl/.test(inst));
ok('install: در صورتِ نبودِ دسترسی، با --user دوباره تلاش می‌کند', /pip install --user/.test(inst));
ok('install: نبودِ پایتون را با نشانی و تیکِ PATH توضیح می‌دهد', /python\.org\/downloads/.test(inst) && /Add python\.exe to PATH/.test(inst));
ok('install: راهِ جایگزین (گزارش تمیز در data/clean) را هم می‌گوید', /data\\clean|data\/clean/.test(inst));
ok('run: اگر openpyxl نبود، خودش نصب می‌کند', /import openpyxl/.test(fs.readFileSync(REPO + '/run_windows.bat', 'utf8')) && /install_windows\.bat/.test(fs.readFileSync(REPO + '/run_windows.bat', 'utf8')));
ok('.gitattributes پایانِ سطرِ bat را نگه می‌دارد', /\*\.bat text eol=crlf/.test(fs.readFileSync(REPO + '/.gitattributes', 'utf8')));


console.log('— منطقِ نصب با پایتونِ ساختگی (بدونِ اینترنت) —');
/* پایتونی وانمود می‌کند openpyxl ندارد؛ pip هم بسته به حالت، موفق یا ناموفق است.
   هدف: ترتیبِ تلاش‌ها (عادی ← --user ← --break-system-packages) آزموده شود. */
const unit = fs.mkdtempSync(os.tmpdir() + '/qcsetup-');
fs.cpSync(REPO + '/server', unit + '/server', { recursive: true });
fs.symlinkSync(REPO + '/node_modules', unit + '/node_modules', 'dir');
const bin = unit + '/bin';
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(bin + '/python3', `#!/bin/sh
case "$1" in
  --version) echo "Python 3.12.9"; exit 0;;
  -c) if [ -f "$FAKE_MARK" ]; then echo "3.1.5"; exit 0; else echo "ModuleNotFoundError: No module named openpyxl" >&2; exit 1; fi;;
  -m) if [ "$PEP668" = "1" ]; then
        for a in "$@"; do if [ "$a" = "--break-system-packages" ]; then touch "$FAKE_MARK"; echo "Successfully installed openpyxl-3.1.5"; exit 0; fi; done
        echo "error: externally-managed-environment" >&2; exit 1
      fi
      if [ "$PEP668" = "2" ]; then echo "ERROR: Could not find a version that satisfies the requirement openpyxl" >&2; exit 1; fi
      touch "$FAKE_MARK"; echo "Successfully installed openpyxl-3.1.5"; exit 0;;
esac
exit 0
`, { mode: 0o755 });
fs.writeFileSync(unit + '/probe.mjs', `import { installPythonDeps } from ${JSON.stringify(unit + '/server/pipeline.mjs')};
const r = await installPythonDeps();
console.log('@@' + JSON.stringify({ ok: r.ok, message: r.message, command: r.command }));
`);

const pip = (pep668) => {
  const mark = unit + '/mark-' + pep668;
  try { fs.rmSync(mark); } catch { /* ignore */ }
  const res = spawnSync(process.execPath, [unit + '/probe.mjs'], {
    cwd: unit, encoding: 'utf8',
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, FAKE_MARK: mark, PEP668: pep668 }
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) throw new Error('probe failed: ' + (res.stderr || '').slice(-250));
  return JSON.parse(line.slice(2));
};

let u = pip('0');
ok('حالتِ عادی: یک pip install کافی است', u.ok === true && /^python3 -m pip install/.test(u.command), JSON.stringify(u));
u = pip('1');
ok('محیطِ مدیریت‌شده (PEP 668): با --break-system-packages دوباره تلاش می‌کند', u.ok === true && /--break-system-packages/.test(u.command), JSON.stringify(u));
u = pip('2');
ok('شکستِ واقعیِ pip: ناموفق گزارش می‌شود و کدِ خروج را می‌گوید', u.ok === false && /کد 1/.test(u.message), JSON.stringify(u));
fs.rmSync(unit, { recursive: true, force: true });

console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
process.exit(fail ? 1 : 0);
