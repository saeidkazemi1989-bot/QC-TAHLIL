/**
 * خطِ به‌روزرسانی خودکارِ داده‌ها
 * ---------------------------------------------------------------
 *   data/raw  (چهار فایل خامِ راهکاران)
 *      ↓  qc.py  (ابزار تبدیلِ خودِ کاربر)
 *   data/clean (گزارش تمیزِ هفت شیتی)
 *      ↓  ETL
 *   data/qc.db (پایگاه داده) → داشبورد و تحلیلگر
 *
 * کار این ماژول:
 *   ۱) `refreshAll()` — کل زنجیره را یک‌جا اجرا می‌کند (تبدیل فقط وقتی لازم باشد)
 *   ۲) `startWatcher()` — پوشه‌ها را زیر نظر می‌گیرد تا با ریختنِ فایلِ جدید،
 *      سامانه خودش به‌روز شود (بدون هیچ دستور یا دخالت دستی)
 *   ۳) `pipelineStatus()` — وضعیت برای نمایش در رابط کاربری و `/api/health`
 *
 * نکته: تبدیل (qc.py) فقط وقتی اجرا می‌شود که «اثر انگشت» فایل‌های خام با
 * آخرین گزارش تمیزِ ساخته‌شده فرق کرده باشد؛ بنابراین اجرای مکرر، فایل تمیزِ
 * تکراری نمی‌سازد و حلقهٔ بی‌پایان هم تشکیل نمی‌شود.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, RAW_DIR, CLEAN_DIR, getDb, ready as dbReady } from './db.mjs';
import { runCleanAsync, rawRoles } from './clean.mjs';
import { runImport } from './etl.mjs';

const log = (...a) => console.log('[pipeline]', ...a);
const FP_FILE = path.join(CLEAN_DIR, '.fingerprints.json');
const isExcel = (f) => /\.(xlsx|xlsm)$/i.test(f) && !f.startsWith('~$');

/* ---------------------------------------------------------------- اثر انگشت */
export function listExcel(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(isExcel).sort();
}

/** اثر انگشتِ پوشهٔ خام: نام + اندازه + زمانِ تغییرِ هر فایل */
export function rawFingerprint(dir = RAW_DIR) {
  return listExcel(dir)
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return `${f}|${st.size}|${Math.round(st.mtimeMs)}`;
    })
    .join(';');
}

function loadFingerprints() {
  try { return JSON.parse(fs.readFileSync(FP_FILE, 'utf8')); } catch { return {}; }
}
function saveFingerprint(fp, file) {
  const all = loadFingerprints();
  // ورودیِ فایل‌هایی که دیگر وجود ندارند پاک می‌شود تا پرونده کوچک بماند
  const present = new Set(listExcel(CLEAN_DIR));
  for (const k of Object.keys(all)) if (!present.has(k) && k !== file) delete all[k];
  all[file] = { fingerprint: fp, at: new Date().toISOString() };
  try {
    fs.mkdirSync(CLEAN_DIR, { recursive: true });
    fs.writeFileSync(FP_FILE, JSON.stringify(all, null, 2));
  } catch (err) { log('ذخیرهٔ اثر انگشت ناموفق:', err.message); }
}

/**
 * اگر گزارش تمیزِ موجود از فایل‌های خام جدیدتر است، همان را «منطبق» فرض کن تا
 * بی‌دلیل تبدیلِ دوباره اجرا نشود (مثلاً اولین اجرا پس از نصبِ این قابلیت).
 */
export function adoptExistingClean() {
  const fp = rawFingerprint();
  if (!fp || cleanIsUpToDate()) return null;
  const raws = listExcel(RAW_DIR).map((f) => fs.statSync(path.join(RAW_DIR, f)).mtimeMs);
  const newestRaw = raws.length ? Math.max(...raws) : 0;
  const clean = listExcel(CLEAN_DIR)
    .map((f) => ({ f, t: fs.statSync(path.join(CLEAN_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0];
  if (clean && clean.t >= newestRaw) {
    saveFingerprint(fp, clean.f);
    log(`گزارش تمیزِ موجود (${clean.f}) منطبق بر فایل‌های خام در نظر گرفته شد`);
    return clean.f;
  }
  return null;
}

/** آیا گزارش تمیزِ منطبق بر فایل‌های خامِ فعلی داریم؟ */
export function cleanIsUpToDate() {
  const fp = rawFingerprint();
  if (!fp) return false;
  const all = loadFingerprints();
  const clean = listExcel(CLEAN_DIR);
  return clean.some((f) => all[f] && all[f].fingerprint === fp);
}

/* ------------------------------------------------------------------ وضعیت */
const state = {
  enabled: false,
  watching: [],
  state: 'idle',                 // idle | running | error
  runs: 0,
  last_run_at: null,
  last_reason: null,
  last_ok: true,
  last_message: '',
  last_detail: null,
  data_version: null,
  started_at: null,
  interval_ms: 0
};

export function pipelineStatus() {
  return {
    ...state,
    watching: [RAW_DIR, CLEAN_DIR],
    raw_files: listExcel(RAW_DIR),
    clean_files: listExcel(CLEAN_DIR),
    clean_up_to_date: cleanIsUpToDate(),
    python_ready: pythonReady(),
    python: pythonStatus(),
    raw_roles: rawRolesSafe()
  };
}

/** نقش فایل‌های خام با کش (هر ۳۰ ثانیه یک‌بار بررسی می‌شود) */
let rolesCache = { at: 0, value: null };
function rawRolesSafe() {
  if (Date.now() - rolesCache.at < 30000 && rolesCache.value) return rolesCache.value;
  try { rolesCache = { at: Date.now(), value: rawRoles() }; } catch { /* ignore */ }
  return rolesCache.value;
}

/**
 * وضعیتِ پایتونِ ابزار تبدیل: پیدا می‌شود؟ کتابخانهٔ openpyxl را دارد؟
 * «در دسترس» یعنی هر دو — چون بدونِ openpyxl تبدیلِ فایل خام ممکن نیست.
 * @param {{force?:boolean}} opts force=true کش را نادیده می‌گیرد (پس از نصب)
 * @returns {{ok:boolean, python:boolean, exe:string|null, version:string, openpyxl:boolean, error:string}}
 */
let PY_STATUS;
export function pythonStatus({ force = false } = {}) {
  if (!force && PY_STATUS) return PY_STATUS;
  const st = { ok: false, python: false, exe: null, version: '', openpyxl: false, openpyxl_version: '', error: '' };
  for (const [cmd, pre] of [['python3', []], ['python', []], ['py', ['-3']]]) {
    const v = spawnSync(cmd, [...pre, '--version'], { encoding: 'utf8', timeout: 20000 });
    if (v.error || v.status !== 0) continue;
    st.python = true;
    st.exe = [cmd, ...pre].join(' ');
    st.version = String(v.stdout || v.stderr || '').trim().split('\n')[0];
    const o = spawnSync(cmd, [...pre, '-c', 'import openpyxl,sys;sys.stdout.write(openpyxl.__version__)'],
      { encoding: 'utf8', timeout: 40000 });
    st.openpyxl = !o.error && o.status === 0;
    if (st.openpyxl) st.openpyxl_version = String(o.stdout || '').trim();
    if (!st.openpyxl) st.error = String(o.stderr || o.error?.message || '').trim().split('\n').pop() || '';
    break;
  }
  st.ok = st.python && st.openpyxl;
  PY_STATUS = st;
  return st;
}

/** آیا ابزار تبدیل (پایتون + openpyxl) در دسترس است؟ — نتیجه کش می‌شود */
export function pythonReady() {
  return pythonStatus().ok;
}

/**
 * نصبِ خودکارِ نیازمندی‌ها (openpyxl) با همان پایتونی که پیدا شده — تا کاربر
 * مجبور نباشد خطِ فرمان باز کند. اگر pip به پوشهٔ سیستم دسترسی نداشت، با --user
 * دوباره تلاش می‌شود. خروجی برای نمایش در رابط نگه داشته می‌شود.
 * @returns {Promise<{ok:boolean, message:string, output:string, command:string}>}
 */
export function installPythonDeps() {
  const req = path.join(ROOT, 'requirements.txt');
  const found = pythonStatus({ force: true });
  if (found.ok) {
    return Promise.resolve({
      ok: true,
      message: 'نیازمندی‌ها از قبل نصب است' + (found.openpyxl_version ? ' (openpyxl ' + found.openpyxl_version + ')' : ''),
      output: '',
      command: '(چیزی برای نصب نبود)'
    });
  }
  const [cmd, ...pre] = (found.exe || 'python3').split(' ');

  /** یک تلاشِ pip؛ نتیجه شاملِ کدِ خروج و همهٔ خروجی است */
  const pip = (extra) => new Promise((resolve) => {
    const args = [...pre, '-m', 'pip', 'install', '--disable-pip-version-check', '-r', req, ...extra];
    const command = [cmd, ...args].join(' ');
    let out = '';
    let settled = false;
    const finish = (code) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, out, command }); };
    let child;
    try { child = spawn(cmd, args, { cwd: ROOT, windowsHide: true }); }
    catch (err) { out = String(err.message || err); return finish(-1); }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } finish(-2); }, 300000);
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { out += d; });
    child.on('error', (err) => { out += '\n' + String(err.message || err); finish(-1); });
    child.on('close', (code) => finish(code));
  });

  return (async () => {
    // ترتیبِ تلاش: عادی ← فقط برای کاربر جاری ← (در لینوکسِ PEP 668) با پرچمِ سیستمی
    const plans = [[], ['--user']];
    let last = null;
    for (let i = 0; i < plans.length; i += 1) {
      last = await pip(plans[i]);
      PY_STATUS = undefined;
      if (pythonStatus({ force: true }).ok) {
        return { ok: true, message: 'openpyxl نصب شد و ابزار تبدیل آماده است', output: last.out.slice(-4000), command: last.command };
      }
      if (/externally-managed-environment/i.test(last.out) && plans.length === 2) {
        plans.push(['--break-system-packages'], ['--user', '--break-system-packages']);
      }
      if (last.code === -1 || last.code === -2) break;
    }
    const message = !last ? 'پایتون پیدا نشد'
      : last.code === -1 ? 'پایتون یا pip پیدا نشد'
        : last.code === -2 ? 'نصب بیش از ۵ دقیقه طول کشید و متوقف شد (اینترنت کند یا فیلتر)'
          : 'نصب با خطا پایان یافت (کد ' + last.code + ')';
    return { ok: false, message, output: (last?.out || '').slice(-4000), command: last?.command || '' };
  })();
}

/** نسخهٔ داده‌ها: با هر تغییرِ واقعی عوض می‌شود تا رابط خودش را به‌روز کند */
export function computeDataVersion() {
  try {
    const db = getDb();
    const c = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    const last = db.prepare('SELECT MAX(imported_at) m FROM import_file').get().m || '';
    return `${c('fact_inprocess')}.${c('fact_inspection')}.${c('fact_production')}.${c('fact_order')}.${last}`;
  } catch {
    // پایگاه داده هنوز آماده نیست: نسخهٔ پایدار از روی فایل‌ها (نه زمانِ حال) تا
    // رابط کاربری بی‌دلیل و پیوسته خودش را بازترسیم نکند
    return 'pending:' + rawFingerprint() + '#' + listExcel(CLEAN_DIR).join(',');
  }
}

/* --------------------------------------------------------------- زنجیرهٔ کار */
let running = false;
let queued = null;
let dirty = false;          // فایلی در جریانِ یک به‌روزرسانی تغییر کرده است

/**
 * اجرای کاملِ زنجیره: تبدیل (در صورت نیاز) ← بارگذاری ← به‌روزرسانی نسخهٔ داده
 * @returns {{ok:boolean, clean?:object, import?:object, message:string, data_version:string}}
 */
export async function refreshAll({ reason = 'manual', forceClean = false, removeMissing = true } = {}) {
  if (running) {
    queued = { reason, forceClean, removeMissing };
    state.state = 'running';
    return { ok: true, deferred: true, message: 'یک به‌روزرسانی در حال اجراست؛ بلافاصله پس از آن، این یکی هم اجرا می‌شود.' };
  }
  running = true;
  dirty = false;
  state.state = 'running';
  state.last_reason = reason;
  const t0 = Date.now();
  const notes = [];
  let ok = true;
  let fpSeen = '';                 // اثر انگشتِ فایل‌های خام در آغازِ کار

  try {
    await dbReady;

    /* ۱) تبدیلِ فایل‌های خام به گزارش تمیز (فقط وقتی تغییری رخ داده باشد) */
    let clean = { skipped: true, message: 'گزارش تمیزِ منطبق با فایل‌های خام موجود است؛ تبدیل دوباره لازم نیست.' };
    const fp = rawFingerprint();
    fpSeen = fp;
    if (!forceClean) adoptExistingClean();
    if (!fp) {
      clean = { skipped: true, message: 'فایل اکسلی در پوشهٔ data/raw نیست.' };
    } else if (forceClean || !cleanIsUpToDate()) {
      const res = await runCleanAsync();
      if (res.ok) {
        saveFingerprint(fp, res.file);
        const dups = res.duplicates && Object.keys(res.duplicates).length
          ? Object.values(res.duplicates).map((l) => l.join(' و ')).join('؛ ')
          : '';
        const dupNote = dups ? ' (از میان چند نسخهٔ هم‌نوع، جدیدترین استفاده شد: ' + dups + ')' : '';
        clean = {
          ok: true,
          file: res.file,
          used: res.used || null,
          duplicates: res.duplicates || null,
          message: 'گزارش تمیز ساخته شد: ' + res.file + dupNote
        };
      } else {
        ok = false;
        clean = { ok: false, message: res.message };
      }
    }
    notes.push(clean.message);

    /* ۲) بارگذاری در پایگاه داده */
    const imp = await runImport({ removeMissing });
    const bad = (imp.files || []).filter((f) => f.status === 'error');
    if (bad.length) {
      ok = false;
      notes.push(`خطا در بارگذاری ${bad.length} فایل: ${bad.map((b) => `${b.file} (${b.message})`).join('، ')}`);
    } else {
      notes.push(`بارگذاری انجام شد: ${Object.entries(imp.totals || {}).map(([k, v]) => `${k}=${v}`).join('، ')}`);
    }

    state.data_version = computeDataVersion();
    state.runs += 1;
    state.last_run_at = new Date().toISOString();
    state.last_ok = ok;
    state.last_message = notes.join(' | ');
    state.last_detail = {
      reason, elapsed_ms: Date.now() - t0,
      clean, import: { totals: imp.totals, files: imp.files, elapsedMs: imp.elapsedMs },
      data_version: state.data_version
    };
    state.state = ok ? 'idle' : 'error';
    log(`به‌روزرسانی (${reason}) در ${state.last_detail.elapsed_ms}ms — ${ok ? 'موفق' : 'با هشدار'}`);
    return { ok, deferred: false, clean, import: imp, message: state.last_message, data_version: state.data_version };
  } catch (err) {
    ok = false;
    state.state = 'error';
    state.last_ok = false;
    state.last_run_at = new Date().toISOString();
    state.last_message = String(err.message || err);
    state.last_detail = { reason, error: state.last_message };
    log('خطا در به‌روزرسانی:', state.last_message);
    return { ok: false, message: state.last_message, data_version: state.data_version };
  } finally {
    running = false;
    suppressUntil = Date.now() + 4000;   // تغییراتِ خودِ سامانه (ساخت گزارش تمیز) را نادیده بگیر
    lastRaw = rawFingerprint();
    lastClean = listExcel(CLEAN_DIR).join(',');
    if (queued) {
      const q = queued; queued = null;
      setTimeout(() => { refreshAll(q).catch(() => {}); }, 300);
    } else if (dirty && rawFingerprint() !== fpSeen) {
      // فایل خامِ تازه‌ای در جریانِ کار رسیده بود ← یک بار دیگر اجرا می‌شود
      dirty = false;
      setTimeout(() => { refreshAll({ reason: 'watcher' }).catch(() => {}); }, 1500);
    } else {
      dirty = false;
    }
  }
}

/* ----------------------------------------------------------------- ناظر پوشه */
let suppressUntil = 0;
let pollTimer = null;
let debounceTimer = null;
const watchers = [];
let lastRaw = null;
let lastClean = null;

function scheduleRun(reason) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    refreshAll({ reason }).catch((e) => log('خطای به‌روزرسانی خودکار:', e.message));
  }, 3000);   // سه ثانیه صبر تا کپیِ فایل کامل شود
}

function check(reason) {
  const rawNow = rawFingerprint();
  const cleanNow = listExcel(CLEAN_DIR).join(',');
  const rawChanged = rawNow !== lastRaw;
  const cleanChanged = cleanNow !== lastClean;
  if (!rawChanged && !cleanChanged) return;
  const first = lastRaw === null;
  lastRaw = rawNow;
  lastClean = cleanNow;
  if (first) return;                 // نخستین نمونه‌برداری فقط برای مقایسه است
  // تغییرِ پوشهٔ تمیز، در بازهٔ کوتاهِ پس از هر اجرا، خروجیِ خودِ سامانه است و نادیده
  // گرفته می‌شود؛ اما تغییرِ فایل خام هرگز نادیده گرفته نمی‌شود (حتی بلافاصله پس از
  // یک به‌روزرسانی) وگرنه فایلِ تازهٔ کاربر تا تغییرِ بعدی دیده نمی‌شد.
  if (!rawChanged && Date.now() < suppressUntil) return;
  // در جریانِ یک اجرا، فقط تغییرِ فایل خام مهم است (خروجیِ خودِ سامانه در data/clean نه)
  if (running) { if (rawChanged) dirty = true; return; }
  scheduleRun(reason);
}

/**
 * زیر نظر گرفتن پوشه‌های داده تا با ریختن فایل جدید، همه‌چیز خودش به‌روز شود.
 * هم رویدادِ فایل سیستم و هم نمونه‌برداری دوره‌ای (برای اطمینان روی هر سیستم‌عامل).
 */
export function startWatcher({ intervalMs = 10000 } = {}) {
  if (state.enabled) return pipelineStatus();
  state.enabled = true;
  state.interval_ms = intervalMs;
  state.started_at = new Date().toISOString();
  state.data_version = state.data_version || computeDataVersion();
  adoptExistingClean();
  lastRaw = rawFingerprint();
  lastClean = listExcel(CLEAN_DIR).join(',');

  for (const dir of [RAW_DIR, CLEAN_DIR]) {
    try {
      const w = fs.watch(dir, { persistent: false }, () => check('watcher'));
      watchers.push(w);
    } catch (err) {
      log(`fs.watch روی ${dir} فعال نشد (${err.message}) — فقط نمونه‌برداری دوره‌ای`);
    }
  }
  pollTimer = setInterval(() => check('watcher'), intervalMs);
  if (pollTimer.unref) pollTimer.unref();
  log(`پوشه‌های داده زیر نظر گرفته شد: ${RAW_DIR} و ${CLEAN_DIR} (هر ${Math.round(intervalMs / 1000)} ثانیه)`);
  return pipelineStatus();
}

export function stopWatcher() {
  state.enabled = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
  watchers.length = 0;
  return pipelineStatus();
}

/* ------------------------------------------------------- بازسازی از صفر */
/**
 * بازسازیِ کامل از فایل‌های خامِ فعلی: همهٔ گزارش‌های تمیزِ `data/clean` پاک می‌شوند و
 * زنجیره از نو اجرا می‌شود (تبدیلِ اجباری + بارگذاری با حذفِ دادهٔ فایل‌های رفته).
 *
 * کجا به کار می‌آید؟ وقتی دادهٔ قبلی آزمایشی یا اشتباه بوده، یا گزارش‌های دوره‌های
 * مختلف با هم قاطی شده‌اند و می‌خواهید داشبورد فقط از فایل‌های خامِ فعلی ساخته شود.
 * فایل‌های خامِ `data/raw` دست‌نخورده می‌مانند.
 */
export async function rebuildFromRaw({ reason = 'rebuild' } = {}) {
  if (running) {
    return { ok: false, message: 'یک به‌روزرسانی در حال اجراست؛ پس از پایانِ آن دوباره تلاش کنید.' };
  }
  const removed = [];
  suppressUntil = Date.now() + 60000;   // حذفِ گزارش‌ها کارِ خودِ ماست؛ ناظر نادیده بگیرد
  for (const f of listExcel(CLEAN_DIR)) {
    try {
      fs.unlinkSync(path.join(CLEAN_DIR, f));
      removed.push(f);
    } catch (err) { log(`حذفِ ${f} ناموفق:`, err.message); }
  }
  try { fs.unlinkSync(FP_FILE); } catch { /* پروندهٔ اثر انگشت نبود */ }
  lastRaw = null;
  lastClean = null;
  log(`${removed.length} گزارش تمیز حذف شد — بازسازی از فایل‌های خامِ فعلی`);
  const res = await refreshAll({ reason, forceClean: true, removeMissing: true });
  return {
    ok: res.ok !== false,
    removed,
    result: res,
    data_version: res.data_version,
    message: `${removed.length} گزارش تمیز حذف شد و داده‌ها فقط از فایل‌های خامِ فعلی از نو ساخته شد.`
      + (res.ok === false ? ` (با هشدار: ${res.message})` : '')
  };
}

/**
 * چرا داده‌ای دیده نمی‌شود؟ — تشخیص‌های عملی از وضعیتِ پوشه‌ها و پایتون.
 * هدف: کاربر به‌جای «داده‌ای پیدا نشد»ِ خالی، دلیل و راه‌حلِ دقیق ببیند.
 * @param {{inprocess?:number,inspection?:number,production?:number,orders?:number}} counts
 * @returns {Array<{level:'error'|'warn', text:string}>}
 */
export function dataDiagnostics(counts = {}) {
  const out = [];
  const empty = ['inprocess', 'inspection', 'production', 'orders'].every((k) => !counts[k]);
  const clean = listExcel(CLEAN_DIR);
  const raw = listExcel(RAW_DIR);

  // ۱) اکسل‌های جاافتاده در ریشهٔ پروژه — هیچ‌جا خوانده نمی‌شوند
  let rootXlsx = [];
  try { rootXlsx = fs.readdirSync(ROOT).filter(isExcel); } catch { /* ignore */ }
  if (rootXlsx.length) {
    out.push({ level: 'warn', text: `این فایل‌های اکسل در ریشهٔ پروژه‌اند و خوانده نمی‌شوند؛ به پوشهٔ data/raw منتقلشان کنید: ${rootXlsx.join('، ')}` });
  }

  // ۲) گزارشِ تمیز نیست
  if (!clean.length) {
    if (!raw.length) {
      out.push({ level: 'error', text: 'هیچ فایلی در data/raw و data/clean نیست؛ فایل اکسل را در پوشهٔ data/raw بگذارید تا سامانه خودش تبدیل و بارگذاری کند.' });
    } else {
      const py = pythonStatus();
      if (!py.python) {
        out.push({ level: 'error', text: 'پوشهٔ data/clean خالی است و پایتون روی این سیستم نصب نیست؛ بدونِ آن فایل‌های data/raw به «گزارش تمیز» تبدیل نمی‌شوند و داشبورد داده‌ای ندارد. پایتون را از python.org نصب کنید (تیکِ Add python.exe to PATH را بزنید) یا install_windows.bat را اجرا کنید.' });
      } else if (!py.openpyxl) {
        out.push({ level: 'error', text: `پایتون پیدا شد (${py.version || 'بدونِ نسخه'}) ولی کتابخانهٔ openpyxl نصب نیست؛ بدونِ آن تبدیل انجام نمی‌شود. در صفحهٔ «مدیریت داده و کاربران» دکمهٔ «نصبِ خودکارِ openpyxl» را بزنید (یا install_windows.bat را اجرا کنید).` });
      } else {
        out.push({ level: 'warn', text: 'گزارشِ تمیزی در data/clean نیست؛ تبدیلِ data/raw در جریان است یا ناموفق بوده. در صفحهٔ «مدیریت داده و کاربران» → «تبدیلِ دوبارهٔ فایل خام (اجباری)» پیام خطا را ببینید.' });
      }
    }
  }

  // ۳) نقشِ فایل‌های خام کامل نیست (چهار فایلِ لازم)
  if (!clean.length && raw.length) {
    const names = { quality: 'اطلاعات جامع کیفیت حین تولید', defect: 'گزارش عیب‌های سند بازرسی', prod: 'گزارش تعداد تولید به تفکیک سند عملکرد', grouping: 'گروه‌بندی محصولات' };
    const found = rawRolesSafe()?.found || {};
    const missing = Object.keys(names).filter((r) => !found[r]);
    if (missing.length) {
      out.push({ level: 'warn', text: `از چهار فایلِ لازم در data/raw، این‌ها پیدا نشد یا ستون‌هایشان شناخته نشد: ${missing.map((m) => names[m]).join('، ')}` });
    }
  }

  // ۴) گزارشِ تمیز هست ولی هیچ داده‌ای بارگذاری نشده
  if (clean.length && empty) {
    out.push({ level: 'error', text: `${clean.length} گزارشِ تمیز در data/clean هست ولی هیچ داده‌ای بارگذاری نشد؛ شیت‌ها/ستون‌های فایل با نمونهٔ «QC Report راهکاران» یکی نیست. خطای ETL در «مدیریت داده و کاربران» دیده می‌شود.` });
  }

  return out;
}
