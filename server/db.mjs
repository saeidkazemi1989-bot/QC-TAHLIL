import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { periodLabels, jWeekInfo, jalaliToGregorian, parseJalali, formatJalali } from './jalali.mjs';
import { openDatabase, driverWarnings } from './sqlite.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const RAW_DIR = path.join(DATA_DIR, 'raw');
export const DB_PATH = process.env.QC_DB || path.join(DATA_DIR, 'qc.db');

fs.mkdirSync(RAW_DIR, { recursive: true });

let dbInstance = null;

/** آماده‌سازی پایگاه داده (به‌صورت ناهم‌زمان؛ ماژول‌های دیگر منتظر آن می‌مانند) */
export const ready = (async () => {
  const db = await openDatabase(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  seedStatic(db);
  dbInstance = db;
  const w = driverWarnings();
  if (w.length) console.log('[db]', w.join(' | '));
  console.log(`[db] پایگاه داده آماده است (${db.driver}): ${DB_PATH}`);
  return db;
})();

export function getDb() {
  if (!dbInstance) {
    throw new Error('پایگاه داده هنوز آماده نیست؛ کمی بعد دوباره تلاش کنید');
  }
  return dbInstance;
}

/** اطمینان از وجود ردیف‌های تقویم برای یک تاریخ شمسی */
export function ensureDate(jdate) {
  const db = getDb();
  const p = parseJalali(jdate);
  if (!p) return;
  const exists = db.prepare('SELECT 1 FROM dim_date WHERE jdate = ?').get(p.jdate);
  if (exists) return;
  const per = periodLabels(p.jdate);
  const wk = jWeekInfo(p.jdate) || { weekNo: null, weekLabel: null, weekStart: null, weekday: null, weekdayName: null };
  const g = jalaliToGregorian(p.jy, p.jm, p.jd);
  const gdate = `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
  db.prepare(`
    INSERT OR REPLACE INTO dim_date
      (jdate, jyear, jmonth, jday, jmonth_name, jmonth_label, jmonth_name_label, jyear_label,
       jquarter, jquarter_label, jquarter_name, jhalf, jhalf_label, jhalf_name,
       jweek, jweek_label, jweek_start, jweekday, jweekday_name, gdate)
    VALUES
      (@jdate, @jyear, @jmonth, @jday, @jmonth_name, @jmonth_label, @jmonth_name_label, @jyear_label,
       @jquarter, @jquarter_label, @jquarter_name, @jhalf, @jhalf_label, @jhalf_name,
       @jweek, @jweek_label, @jweek_start, @jweekday, @jweekday_name, @gdate)
  `).run({
    jdate: p.jdate,
    jyear: per.jyear,
    jmonth: per.jmonth,
    jday: p.jd,
    jmonth_name: per.jmonthNameLabel.split(' ')[0],
    jmonth_label: per.jmonthLabel,
    jmonth_name_label: per.jmonthNameLabel,
    jyear_label: per.jyearLabel,
    jquarter: per.jquarter,
    jquarter_label: per.jquarterLabel,
    jquarter_name: per.jquarterNameLabel,
    jhalf: per.jhalf,
    jhalf_label: per.jhalfLabel,
    jhalf_name: per.jhalfNameLabel,
    jweek: wk.weekNo,
    jweek_label: wk.weekLabel,
    jweek_start: wk.weekStart,
    jweekday: wk.weekday,
    jweekday_name: wk.weekdayName,
    gdate
  });
}

/** ساخت کامل تقویم برای یک بازه سال شمسی */
export function buildCalendar(years) {
  const db = getDb();
  const insert = db.transaction((list) => {
    for (const d of list) ensureDate(d);
  });
  for (const y of years) {
    for (let m = 1; m <= 12; m += 1) {
      for (let d = 1; d <= 31; d += 1) {
        // ماه‌های ۷ تا ۱۱ سی روزه هستند؛ روز ۳۱ برای آن‌ها وجود ندارد
        if (m >= 7 && m <= 11 && d === 31) continue;
        if (m === 12 && d === 31) continue; // اسفند حداکثر ۳۰ روز
        const jdate = formatJalali(y, m, d);
        // تاریخ نامعتبر (مثل ۳۰ فروردین) را رد می‌کنیم
        const chk = parseJalali(jdate);
        if (!chk) continue;
        const round = jalaliToGregorian(chk.jy, chk.jm, chk.jd);
        const back = new Date(Date.UTC(round.gy, round.gm - 1, round.gd));
        if (back.getUTCDate() !== round.gd) continue;
        ensureDate(jdate);
      }
    }
  }
}

function seedStatic(db) {
  const now = new Date().toISOString();
  const users = [
    { username: 'admin', display_name: 'مدیر سیستم', role: 'admin' },
    { username: 'manager', display_name: 'مدیر ارشد', role: 'executive' },
    { username: 'expert', display_name: 'کارشناس کیفیت', role: 'expert' }
  ];
  const ins = db.prepare(`INSERT OR IGNORE INTO app_user (username, display_name, role, active, created_at)
                          VALUES (?, ?, ?, 1, ?)`);
  for (const u of users) ins.run(u.username, u.display_name, u.role, now);

  const settings = [
    ['ppm_target', '0', 'هدف PPM', 'عدد هدف (عیب در یک میلیون) که در نمودارها به‌صورت خط هدف نمایش داده می‌شود. صفر یعنی بدون هدف‌گذاری.'],
    ['acceptance_rate_target', '95', 'هدف نرخ پذیرش (درصد)', 'درصد هدف برای عبور سالم از ایستگاه'],
    ['company_name', 'سازه پویش', 'نام شرکت', 'نامی که در بالای صفحات نمایش داده می‌شود'],
    ['refresh_note', '', 'یادداشت به‌روزرسانی', 'توضیح کوتاه درباره آخرین به‌روزرسانی داده‌ها']
  ];
  const insSet = db.prepare(`INSERT OR IGNORE INTO app_setting (key, value, label, description) VALUES (?,?,?,?)`);
  for (const s of settings) insSet.run(...s);
}

export function getSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value, label, description FROM app_setting').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSetting(key, value) {
  const db = getDb();
  db.prepare('UPDATE app_setting SET value = ? WHERE key = ?').run(String(value), key);
}

/** پاک‌سازی کامل داده‌ها (برای بارگذاری مجدد) */
export function resetData() {
  const db = getDb();
  db.exec(`
    DELETE FROM fact_inprocess;
    DELETE FROM fact_inspection;
    DELETE FROM fact_production;
    DELETE FROM fact_order;
    DELETE FROM dim_product;
    DELETE FROM dim_defect;
    DELETE FROM import_file;
    DELETE FROM dim_station;
    DELETE FROM dim_workcenter;
  `);
}
