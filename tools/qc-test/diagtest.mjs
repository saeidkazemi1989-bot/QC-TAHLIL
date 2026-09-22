/* بررسیِ «چرا داده‌ای دیده نمی‌شود؟» — تشخیص‌های سرور (dataDiagnostics) + بنرِ کلاینت
 * سناریوها در یک ریشهٔ موقت اجرا می‌شوند تا به دادهٔ واقعیِ data/ دست نخورد. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = '/home/user/QC-TAHLIL';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name, extra); } };

/* --- ۱) ریشهٔ موقت: server/ + data/{raw,clean} --- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qcdiag-'));
fs.cpSync(path.join(REPO, 'server'), path.join(tmp, 'server'), { recursive: true });
fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
const RAW = path.join(tmp, 'data', 'raw'), CLEAN = path.join(tmp, 'data', 'clean');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(CLEAN, { recursive: true });

const probe = path.join(tmp, 'probe.mjs');
fs.writeFileSync(probe, `import { dataDiagnostics } from ${JSON.stringify(path.join(tmp, 'server', 'pipeline.mjs'))};
console.log('@@' + JSON.stringify(dataDiagnostics(JSON.parse(process.argv[2] || '{}'))));
`);

const wipe = (dir, keepDot = false) => { for (const f of fs.readdirSync(dir)) if (!(keepDot && f.startsWith('.'))) fs.rmSync(path.join(dir, f)); };

/* پایتونی که هست ولی openpyxl ندارد (شمِ آزمایشی) — رایج‌ترین وضعیت روی سیستمِ کاربر */
const FAKE_BIN = path.join(tmp, 'fakebin');
fs.mkdirSync(FAKE_BIN, { recursive: true });
fs.writeFileSync(path.join(FAKE_BIN, 'python3'),
  '#!/bin/sh\ncase "$1" in\n  --version) echo "Python 3.12.9"; exit 0;;\n'
  + '  -c) echo "ModuleNotFoundError: No module named openpyxl" >&2; exit 1;;\nesac\nexit 0\n', { mode: 0o755 });

/** اجرای یک سناریو: چه فایل‌هایی کجا باشد و پایتون در دسترس باشد یا نه */
const run = ({ raw = [], clean = false, root = [], counts = {}, noPython = false, fakePython = false }) => {
  wipe(RAW, true); wipe(CLEAN, true);
  for (const f of fs.readdirSync(tmp)) if (/\.xlsx$/i.test(f)) fs.rmSync(path.join(tmp, f));
  for (const f of raw) fs.writeFileSync(path.join(RAW, f), 'x');
  for (const f of root) fs.writeFileSync(path.join(tmp, f), 'x');
  if (clean) fs.writeFileSync(path.join(CLEAN, 'QC Report راهکاران.xlsx'), 'x');
  const env = {
    ...process.env,
    ...(noPython ? { PATH: '/nonexistent' } : {}),
    ...(fakePython ? { PATH: `${FAKE_BIN}:${process.env.PATH}` } : {})
  };
  const r = spawnSync(process.execPath, [probe, JSON.stringify(counts)], { cwd: tmp, encoding: 'utf8', env });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) throw new Error(`probe failed: ${(r.stderr || '').slice(-300)}`);
  return JSON.parse(line.slice(2));
};

const FULL = { inprocess: 1729, inspection: 804, production: 2632, orders: 3012 };
const texts = (d) => d.map((x) => `${x.level}: ${x.text}`).join(' | ');
const has = (d, s) => texts(d).includes(s);
const RAW4 = ['اطلاعات جامع کیفیت حین تولید (9).xlsx'];

console.log('— تشخیص‌های سرور (dataDiagnostics) —');
let d = run({});
ok('پوشه‌ها خالی ⇒ یک خطا با راهنمای data/raw', d.length === 1 && d[0].level === 'error' && has(d, 'data/raw'), texts(d));

d = run({ raw: RAW4 });
ok('فایل خام هست، گزارش تمیز نیست (پایتون سالم) ⇒ هشدارِ تبدیل', d.some((x) => x.level === 'warn' && /گزارشِ تمیزی در data\/clean نیست/.test(x.text)), texts(d));
ok('  و فایل‌های لازمِ نیامده را فهرست می‌کند', has(d, 'گزارش عیب‌های سند بازرسی'), texts(d));

d = run({ raw: RAW4, noPython: true });
ok('پایتون/openpyxl نیست ⇒ خطای صریح با راه‌حل (install_windows.bat)', has(d, 'پایتون') && has(d, 'install_windows.bat'), texts(d));
ok('  نبودِ پایتون کاربر را به python.org و PATH می‌فرستد', has(d, 'python.org') && has(d, 'PATH'), texts(d));

d = run({ raw: RAW4, fakePython: true });
ok('پایتون هست ولی openpyxl نیست ⇒ راه‌حلِ درون‌برنامه‌ای پیشنهاد می‌شود', has(d, 'openpyxl') && has(d, 'نصبِ خودکارِ openpyxl'), texts(d));
ok('  نسخهٔ پایتونِ پیدا‌شده هم گفته می‌شود', has(d, 'Python 3.12.9'), texts(d));

d = run({ raw: RAW4, root: ['فایل جدید من.xlsx'], counts: FULL });
ok('اکسلِ جاافتاده در ریشه ⇒ هشدار با نامِ فایل', has(d, 'ریشهٔ پروژه') && has(d, 'فایل جدید من.xlsx'), texts(d));

d = run({ clean: true });
ok('گزارش تمیز هست ولی داده‌ای بارگذاری نشده ⇒ خطای ساختارِ فایل', has(d, 'بارگذاری نشد'), texts(d));

d = run({ clean: true, raw: RAW4, counts: FULL });
ok('دادهٔ کامل ⇒ بدونِ هیچ هشداری', d.length === 0, texts(d));

/* --- ۲) سیم‌کشی: health و بنرِ کلاینت --- */
console.log('— سیم‌کشی (health + بنر) —');
const idx = fs.readFileSync(path.join(REPO, 'server', 'index.mjs'), 'utf8');
ok('/api/health تشخیص‌ها را برمی‌گرداند', /diagnostics: dataDiagnostics\(counts\)/.test(idx));

const app = fs.readFileSync(path.join(REPO, 'public', 'js', 'app.js'), 'utf8');
ok('app.js تابع renderDataBanner را دارد', /export function renderDataBanner/.test(app));
ok('  جای بنر در پوستهٔ صفحه هست (#data-banner)', /<div class="data-banner" id="data-banner" hidden><\/div>/.test(app));
ok('  در پرس‌وجوی دوره‌ای صدا زده می‌شود', /renderDataBanner\(h\.diagnostics\)/.test(app));
ok('  متن‌ها escape می‌شوند', /escapeHtml\(d\.text\)/.test(app));

const css = fs.readFileSync(path.join(REPO, 'public', 'css', 'app.css'), 'utf8');
ok('app.css سبک بنر را دارد (هشدار + خطا)', /\.data-banner\s*\{/.test(css) && /\.data-banner\.lv-error/.test(css));
ok('  حالتِ پنهان کار می‌کند', /\.data-banner\[hidden\]\s*\{\s*display: none/.test(css));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
process.exit(fail ? 1 : 0);
