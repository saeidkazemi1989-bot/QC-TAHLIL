/*
 * آزمونِ خطِ به‌روزرسانی خودکار
 * ------------------------------------------------------------------
 *  بخش ۱) ماژول‌های pipeline/clean بدون سرور (اثر انگشت، نقش فایل‌ها، وضعیت)
 *  بخش ۲) API های زنده (نیاز به سرورِ در حال اجرا روی پورت ۳۰۰۰)
 *  بخش ۳) گردشِ کاملِ ناظرِ پوشه — با QC_E2E=1 یا --e2e (چند ده ثانیه طول می‌کشد)
 *
 * اجرا:  node tools/qc-test/pipelinetest.mjs
 *        node tools/qc-test/pipelinetest.mjs --e2e
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RAW_DIR, CLEAN_DIR, ready as dbReady } from '../../server/db.mjs';
import {
  rawFingerprint, listExcel, cleanIsUpToDate, adoptExistingClean, pipelineStatus, computeDataVersion, pythonReady
} from '../../server/pipeline.mjs';
import { rawRoles } from '../../server/clean.mjs';

const BASE = process.env.QC_BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${name}`); }
  else { fail += 1; console.log(`  ❌ ${name} ${extra}`); }
};
async function j(url, opts = {}) {
  const res = await fetch(BASE + url, opts);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}
const auth = (t) => ({ headers: { Authorization: `Bearer ${t}` } });

/* ------------------------------------------------------- ۱) آزمونِ ماژول‌ها */
console.log('\n— بخش ۱: ماژولِ خطِ به‌روزرسانی —');
await dbReady;

const raws = listExcel(RAW_DIR);
const cleans = listExcel(CLEAN_DIR);
ok('چهار فایل خام در data/raw دیده می‌شود', raws.length === 4, `(${raws.length})`);
ok('گزارش تمیز در data/clean وجود دارد', cleans.length >= 1, `(${cleans.length})`);
ok('فایلِ اثر انگشت، فایل اکسل حساب نمی‌شود', !cleans.includes('.fingerprints.json'));

const fp = rawFingerprint();
ok('اثر انگشتِ فایل‌های خام ساخته می‌شود', typeof fp === 'string' && fp.split(';').length === raws.length);
ok('اثر انگشت نام و اندازه و زمان را دارد', /\.xlsx\|\d+\|\d+/.test(fp));
ok('وضعیتِ انطباقِ گزارش تمیز بولی است', typeof cleanIsUpToDate() === 'boolean');

// اثر انگشت باید با تغییرِ فایل عوض شود (روی پوشهٔ موقت، بدون دست‌زدن به دادهٔ واقعی)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-'));
try {
  const a = path.join(tmp, 'a.xlsx');
  const b = path.join(tmp, 'b.xlsx');
  fs.writeFileSync(a, 'x');
  fs.writeFileSync(b, 'yy');
  const fp1 = rawFingerprint(tmp);
  ok('اثر انگشتِ تکراری یکسان است (حلقهٔ بی‌پایان نمی‌سازد)', rawFingerprint(tmp) === fp1);
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(a, t, t);
  ok('با تغییرِ زمانِ فایل، اثر انگشت عوض می‌شود', rawFingerprint(tmp) !== fp1);
  fs.writeFileSync(a, 'xxxx');
  ok('با تغییرِ اندازهٔ فایل، اثر انگشت عوض می‌شود', rawFingerprint(tmp) !== fp1);
  fs.writeFileSync(path.join(tmp, '~$lock.xlsx'), 'z');
  ok('فایلِ قفلِ موقتِ اکسل (~$) نادیده گرفته می‌شود', rawFingerprint(tmp).split(';').length === 2);
  ok('پوشهٔ نبود، اثر انگشتِ خالی می‌دهد', rawFingerprint(path.join(tmp, 'nope')) === '');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const roles = rawRoles();
ok('نقشِ فایل‌های خام تشخیص داده می‌شود', roles.ok === true, JSON.stringify(roles).slice(0, 120));
const found = Object.values(roles.files || {}).map((x) => x.role).filter(Boolean).sort();
ok('هر چهار نقش پیدا شد (quality/defect/prod/grouping)',
  JSON.stringify(found) === JSON.stringify(['defect', 'grouping', 'prod', 'quality']), found.join(','));
ok('هیچ فایل خامی بی‌نقش نماند', Object.values(roles.files || {}).every((x) => x.role));

ok('پایتون برای ابزارِ تبدیل در دسترس است', pythonReady() === true);
ok('adoptExistingClean وقتی گزارش منطبق است کاری نمی‌کند',
  cleanIsUpToDate() ? adoptExistingClean() === null : true);

const st = pipelineStatus();
for (const k of ['enabled', 'state', 'runs', 'raw_files', 'clean_files', 'clean_up_to_date', 'python_ready', 'raw_roles', 'watching']) {
  ok(`وضعیت شاملِ ${k} است`, st[k] !== undefined);
}
ok('وضعیت، پوشه‌های زیر نظر را گزارش می‌کند', st.watching.includes(RAW_DIR) && st.watching.includes(CLEAN_DIR));
ok('نسخهٔ داده از شمارِ ردیف‌ها ساخته می‌شود', /^\d+\.\d+\.\d+\.\d+\./.test(computeDataVersion()), computeDataVersion());

/* ------------------------------------------------------------- ۲) آزمونِ API */
console.log('\n— بخش ۲: API های زنده —');
const A = (await j('/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin' })
})).data?.token;
const E = (await j('/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'expert' })
})).data?.token;
ok('ورودِ مدیر سیستم توکن می‌دهد', !!A);

// --- هم‌ترازیِ نخست: اگر گزارش تمیز منطبق نیست، یک بار زنجیره اجرا شود
let h = (await j('/api/health')).data;
if (!h.watcher.clean_up_to_date) {
  console.log('  (گزارش تمیز منطبق نبود — یک بار به‌روزرسانی می‌شود…)');
  await j('/api/admin/refresh', { method: 'POST', ...auth(A) });
  for (let i = 0; i < 90; i += 1) {
    await sleep(2000);
    h = (await j('/api/health')).data;
    if (h.watcher.state === 'idle' && h.watcher.clean_up_to_date) break;
  }
}

const health = await j('/api/health');
ok('GET /api/health بدون ورود در دسترس است', health.status === 200);
ok('health نسخهٔ داده را دارد', typeof health.data?.data_version === 'string' && health.data.data_version.length > 5);
const w = health.data?.watcher || {};
ok('health وضعیتِ ناظر را دارد', typeof w.enabled === 'boolean' && typeof w.state === 'string');
ok('ناظر فعال و آماده است', w.enabled === true && w.state === 'idle', JSON.stringify(w).slice(0, 120));
ok('health فایل‌های خام و تمیز را گزارش می‌کند', (w.raw_files || []).length === 4 && (w.clean_files || []).length >= 1);
ok('health می‌گوید گزارش تمیز منطبق است', w.clean_up_to_date === true);
ok('health می‌گوید پایتون آماده است', w.python_ready === true);

ok('pipeline بدون توکن ۴۰۱ می‌دهد', (await j('/api/admin/pipeline')).status === 401);
ok('pipeline برای نقشِ غیرِ مدیر ۴۰۳ می‌دهد', (await j('/api/admin/pipeline', auth(E))).status === 403);
const pipe = await j('/api/admin/pipeline', auth(A));
ok('GET /api/admin/pipeline با توکنِ مدیر کار می‌کند', pipe.status === 200 && pipe.data?.enabled === true);
ok('pipeline نقشِ فایل‌های خام را دارد', Object.keys(pipe.data?.raw_roles?.files || {}).length === 4);

const files = await j('/api/admin/files', auth(A));
ok('GET /api/admin/files هر دو پوشه را دارد', files.status === 200
  && files.data.files.some((f) => f.folder === 'raw') && files.data.files.some((f) => f.folder === 'clean'));
ok('files وضعیتِ خط را هم دارد', !!files.data.pipeline && typeof files.data.pipeline.state === 'string');
ok('فایلِ خام «ورودی خام» علامت خورده (نه بارگذاریِ مستقیم)',
  files.data.files.filter((f) => f.folder === 'raw').every((f) => f.records?.[0]?.source_type === 'ورودی خام'));
ok('فایلِ تمیز ردیفِ بارگذاری‌شده دارد',
  files.data.files.filter((f) => f.folder === 'clean').every((f) => (f.records?.[0]?.rows_loaded || 0) > 0));

// --- به‌روزرسانیِ دستی باید هم‌توان باشد: تبدیلِ بی‌دلیل و گزارشِ تکراری نسازد
const cleansBefore = listExcel(CLEAN_DIR);
const countsBefore = health.data.counts;
const t0 = Date.now();
const ref = await j('/api/admin/refresh', { method: 'POST', ...auth(A) });
ok('POST /api/admin/refresh موفق است', ref.status === 200 && ref.data?.ok === true, JSON.stringify(ref.data).slice(0, 160));
ok('تبدیلِ بی‌دلیل اجرا نشد (گزارش تمیز منطبق بود)', ref.data?.result?.clean?.skipped === true,
  JSON.stringify(ref.data?.result?.clean).slice(0, 140));
ok('گزارشِ تمیزِ تکراری ساخته نشد', listExcel(CLEAN_DIR).join() === cleansBefore.join());
const after = (await j('/api/health')).data;
ok('آمار پس از به‌روزرسانیِ دستی عوض نشد',
  JSON.stringify(after.counts) === JSON.stringify(countsBefore),
  `${JSON.stringify(countsBefore)} → ${JSON.stringify(after.counts)}`);
ok('نسخهٔ داده پس از بارگذاری تازه شد', after.data_version !== health.data.data_version);
ok('به‌روزرسانیِ دستی بدون تبدیل سریع بود', Date.now() - t0 < 45000, `${Date.now() - t0}ms`);

ok('حذفِ فایلِ نبود ۴۰۴ می‌دهد',
  (await j('/api/admin/files/' + encodeURIComponent('no-such-file.xlsx'), { method: 'DELETE', ...auth(A) })).status === 404);

/* --------------------------------------- ۳) گردشِ کاملِ ناظر (اختیاری: QC_E2E=1) */
const wantE2E = process.env.QC_E2E === '1' || process.argv.includes('--e2e');
if (wantE2E) {
  console.log('\n— بخش ۳: گردشِ کاملِ ناظرِ پوشه (ریختن فایل تازه) —');
  const before = (await j('/api/health')).data;
  const runsBefore = before.watcher.runs;
  const target = path.join(RAW_DIR, raws.find((f) => /گروه/.test(f)) || raws[0]);
  const touchedAt = Date.now();
  fs.utimesSync(target, new Date(), new Date());       // مثلِ کپی‌کردنِ دوبارهٔ فایل
  console.log(`  فایلِ لمس‌شده: ${path.basename(target)} — منتظرِ ناظر…`);

  let slowest = 0;
  let sawRunning = false;
  let done = null;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const t = Date.now();
    const cur = (await j('/api/health')).data;
    slowest = Math.max(slowest, Date.now() - t);
    if (cur?.watcher?.state === 'running') sawRunning = true;
    if (cur && cur.watcher.runs > runsBefore && cur.watcher.state === 'idle') { done = cur; break; }
    await sleep(2000);
  }
  ok('ناظر تغییرِ فایل خام را دید و زنجیره را اجرا کرد', !!done, `runs=${runsBefore}→${done ? done.watcher.runs : '?'}`);
  if (done) {
    ok('در جریانِ تبدیل، سرور پاسخ‌دهنده ماند (قفل نشد)', slowest < 4000, `کندترین پاسخ: ${slowest}ms`);
    ok('وضعیتِ «در حال به‌روزرسانی» دیده شد', sawRunning);
    ok('دقیقاً یک اجرای خودکار انجام شد (حلقهٔ بی‌پایان نیست)', done.watcher.runs === runsBefore + 1,
      `${runsBefore} → ${done.watcher.runs}`);

    const detail = (await j('/api/admin/pipeline', auth(A))).data?.last_detail || {};
    const converted = detail.clean && detail.clean.ok === true;
    const newestClean = listExcel(CLEAN_DIR)
      .map((f) => ({ f, t: fs.statSync(path.join(CLEAN_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0];
    ok('ابزارِ تبدیل (qc.py) دوباره اجرا شد', converted, JSON.stringify(detail.clean).slice(0, 160));
    ok('گزارشِ تمیزِ منطبق با فایل تازه نوشته شد', !!newestClean && newestClean.t >= touchedAt - 2000,
      newestClean ? `${newestClean.f} @${new Date(newestClean.t).toISOString()}` : '—');
    ok('گزارشِ تمیزِ بی‌نامِ تازه انباشته نشد (همان نامِ روز بازنویسی می‌شود)',
      listExcel(CLEAN_DIR).length <= cleansBefore.length + 1, listExcel(CLEAN_DIR).join(', '));
    ok('آمار پس از تبدیلِ خودکار دست‌نخورد ماند (دوباره‌شماری نشد)',
      JSON.stringify(done.counts) === JSON.stringify(before.counts),
      `${JSON.stringify(before.counts)} → ${JSON.stringify(done.counts)}`);
    ok('پس از پایانِ کار، گزارش تمیز منطبق است', done.watcher.clean_up_to_date === true);
    ok('بارگذاری پس از تبدیل انجام شد', (detail.import?.totals?.inprocess || 0) === before.counts.inprocess);

    // چند ثانیه صبر: اگر حلقهٔ پنهانی باشد، خودش را نشان می‌دهد
    await sleep(16000);
    const settled = (await j('/api/health')).data;
    ok('پس از ۱۶ ثانیه اجرای خودکارِ دیگری رخ نداد', settled.watcher.runs === done.watcher.runs,
      `${done.watcher.runs} → ${settled.watcher.runs}`);
  }
  /* ------------------------------------ ۴) بازسازیِ کامل از فایل‌های خام (--e2e) */
  console.log('\n— بخش ۴: بازسازیِ کامل از فایل‌های خامِ فعلی —');
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-backup-'));
  for (const f of fs.readdirSync(CLEAN_DIR)) fs.copyFileSync(path.join(CLEAN_DIR, f), path.join(backupDir, f));
  const countsBeforeRebuild = (await j('/api/health')).data.counts;
  const nCleanBefore = listExcel(CLEAN_DIR).length;

  const rb = await j('/api/admin/rebuild', { method: 'POST', ...auth(A) });
  ok('POST /api/admin/rebuild موفق است', rb.status === 200 && rb.data?.ok === true, JSON.stringify(rb.data).slice(0, 160));
  ok('همهٔ گزارش‌های تمیزِ قبلی پاک شدند', (rb.data?.removed || []).length === nCleanBefore,
    `${(rb.data?.removed || []).length} از ${nCleanBefore}`);
  ok('فقط یک گزارش تمیزِ تازه از فایل‌های خام ساخته شد', listExcel(CLEAN_DIR).length === 1, listExcel(CLEAN_DIR).join(', '));
  ok('فایل‌های خام دست‌نخورده ماندند', listExcel(RAW_DIR).length === 4);
  const rebuilt = (await j('/api/health')).data;
  ok('پس از بازسازی، داده بارگذاری شد', rebuilt.counts.inprocess > 0 && rebuilt.counts.production > 0,
    JSON.stringify(rebuilt.counts));
  ok('پس از بازسازی، گزارش تمیز منطبق است', rebuilt.watcher.clean_up_to_date === true);
  ok('بازسازی نسخهٔ داده را عوض کرد', rebuilt.data_version !== done?.data_version);

  // --- بازگرداندنِ پشتیبان تا وضعیتِ داده‌ها مثلِ اول شود
  for (const f of fs.readdirSync(backupDir)) fs.copyFileSync(path.join(backupDir, f), path.join(CLEAN_DIR, f));
  fs.rmSync(backupDir, { recursive: true, force: true });
  const fpNow = rawFingerprint();
  fs.writeFileSync(path.join(CLEAN_DIR, '.fingerprints.json'), JSON.stringify(Object.fromEntries(
    listExcel(CLEAN_DIR).map((f) => [f, { fingerprint: fpNow, at: new Date().toISOString() }])
  ), null, 2));
  await j('/api/admin/refresh', { method: 'POST', ...auth(A) });
  let restored = null;
  for (let i = 0; i < 60; i += 1) {
    await sleep(2000);
    const hh = (await j('/api/health')).data;
    if (hh.watcher.state === 'idle') { restored = hh; break; }
  }
  ok('پس از بازگرداندنِ پشتیبان، آمار به حالتِ اول برگشت',
    !!restored && JSON.stringify(restored.counts) === JSON.stringify(countsBeforeRebuild),
    `${JSON.stringify(countsBeforeRebuild)} → ${JSON.stringify(restored && restored.counts)}`);
  ok('گزارش‌های تمیزِ پشتیبان‌گرفته سرِ جای خود هستند', listExcel(CLEAN_DIR).length === nCleanBefore,
    listExcel(CLEAN_DIR).join(', '));
}

console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
process.exit(fail ? 1 : 0);
