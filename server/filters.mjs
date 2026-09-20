/**
 * ساخت شرط‌های فیلتر برای پرس‌وجوهای تحلیلی
 * تمام فیلترها به‌صورت پارامترهای بانام بسته می‌شوند (امن در برابر تزریق SQL)
 */
import { j2d, d2j, parseJalali, formatJalali } from './jalali.mjs';

/** فیلدهایی که به‌صورت فهرست (چندمقداری) از کلاینت می‌آیند */
export const LIST_FILTERS = [
  'branch', 'final_group', 'product_family', 'product_code',
  'station', 'process_domain', 'defect_code', 'defect_group',
  'cause_6m', 'shift', 'repair_action', 'supplier', 'part_family',
  'failure_mode', 'operation', 'work_center', 'product_combined',
  'category', 'stage'
];

export function parseList(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

export function parseFilters(q = {}) {
  const f = {
    from: (q.from || '').trim() || null,
    to: (q.to || '').trim() || null,
    source: ['inprocess', 'inspection', 'polymer'].includes(q.source) ? q.source : 'inprocess',
    q: (q.q || '').trim() || null
  };
  for (const key of LIST_FILTERS) f[key] = parseList(q[key]);
  return f;
}

/** شرط‌های مشترکِ تاریخ */
function dateClause(alias, f, where, params, col = 'order_date') {
  if (f.from) { where.push(`${alias}.${col} >= @from`); params.from = f.from; }
  if (f.to) { where.push(`${alias}.${col} <= @to`); params.to = f.to; }
}

function listClause(alias, field, values, where, params, col) {
  if (!values || !values.length) return;
  const names = values.map((v, i) => {
    const p = `${field}_${i}`;
    params[p] = v;
    return `@${p}`;
  });
  where.push(`${alias}.${col} IN (${names.join(',')})`);
}

/** فیلدهای مرتبط با محصول (هم در نماهای عیب و هم سفارش) */
const PRODUCT_FIELDS = [
  ['category', 'category'],
  ['stage', 'stage'],
  ['branch', 'branch'],
  ['final_group', 'final_group'],
  ['product_family', 'product_family'],
  ['product_combined', 'product_combined'],
  ['product_code', 'product_code']
];

const STATION_FIELDS = [
  ['station', 'station'],
  ['process_domain', 'process_domain']
];

const DEFECT_FIELDS = [
  ['defect_code', 'defect_code'],
  ['defect_group', 'defect_group']
];

// ستون‌هایی که فقط در یکی از دو منبع عیب وجود دارند
const SOURCE_COLUMNS = {
  inprocess: new Set([
    'branch', 'final_group', 'product_family', 'product_combined', 'product_code',
    'category', 'stage',
    'station', 'process_domain', 'defect_code', 'defect_group',
    'cause_6m', 'repair_action', 'supplier', 'part_family', 'failure_mode',
    'report', 'repair_desc'
  ]),
  inspection: new Set([
    'branch', 'final_group', 'product_family', 'product_combined', 'product_code',
    'category', 'stage',
    'station', 'process_domain', 'defect_code', 'defect_group',
    'shift', 'operation', 'report', 'repair_desc'
  ]),
  polymer: new Set([
    'branch', 'final_group', 'product_family', 'product_combined', 'product_code',
    'category', 'stage',
    'station', 'process_domain', 'defect_code', 'defect_group',
    'report', 'repair_desc', 'shift'
  ])
};

/** شرط‌های قابل اعمال بر نماهای عیب (v_inprocess / v_inspection) */
export function defectWhere(f, alias = 'd') {
  const where = [`${alias}.defect_code IS NOT NULL`];
  const params = {};
  dateClause(alias, f, where, params);
  for (const [key, col] of PRODUCT_FIELDS) listClause(alias, key, f[key], where, params, col);
  for (const [key, col] of STATION_FIELDS) listClause(alias, key, f[key], where, params, col);
  for (const [key, col] of DEFECT_FIELDS) listClause(alias, key, f[key], where, params, col);
  // فقط فیلترهایی اعمال می‌شوند که در نمای آن منبع وجود دارند
  const allowed = SOURCE_COLUMNS[f.source] || SOURCE_COLUMNS.inprocess;
  const detailOnly = [
    ['cause_6m', 'cause_6m'],
    ['repair_action', 'repair_action'],
    ['supplier', 'supplier'],
    ['part_family', 'part_family'],
    ['failure_mode', 'failure_mode'],
    ['shift', 'shift'],
    ['operation', 'operation'],
    ['report', 'report'],
    ['repair_desc', 'repair_desc']
  ];
  for (const [key, col] of detailOnly) {
    if (!allowed.has(col)) continue;
    listClause(alias, key, f[key], where, params, col);
  }
  if (f.source === 'inspection') where.push(`COALESCE(${alias}.op_seq, 1) = 1`);
  // ردیف‌های شیت پلیمر در همان جدول اسناد بازرسی ذخیره می‌شوند؛ در منبع
  // «اسناد بازرسی» (و حین تولید) نباید دیده شوند (منبع مستقل «پلیمر» دارند)
  if (f.source !== 'polymer') {
    where.push(`COALESCE(${alias}.report, '') <> @polymer_report`);
    params.polymer_report = 'پلیمر';
  }
  // منبع پلیمر: فقط ردیف‌هایِ گزارش پلیمر (که در جدول اسناد بازرسی ذخیره می‌شوند)
  if (f.source === 'polymer') {
    where.push(`COALESCE(${alias}.report, '') = @report_scope`);
    params.report_scope = 'پلیمر';
    where.push(`COALESCE(${alias}.op_seq, 1) = 1`);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/** شرط‌های قابل اعمال بر نمای سفارش‌ها (v_order) */
export const SOURCE_REPORTS = {
  inprocess: ['بازرسی چشمی (QV)', 'SMD', 'ICT', 'کنترل نهایی ELE'],
  inspection: ['تست نهایی ELE', 'تست نهایی EMS', 'کنترل نهایی EMS'],
  polymer: ['پلیمر']
};

export function orderWhere(f, alias = 'o') {
  const where = ['1 = 1'];
  const params = {};
  dateClause(alias, f, where, params);
  for (const [key, col] of PRODUCT_FIELDS) listClause(alias, key, f[key], where, params, col);
  for (const [key, col] of STATION_FIELDS) listClause(alias, key, f[key], where, params, col);
  listClause(alias, 'shift', f.shift, where, params, 'shift');
  // مخرجِ تولید فقط رکوردهای تولیدِ همان گزارش‌هایی که منبع عیب از آن‌هاست
  // (گزارش‌های حین تولید: QV/SMD/ICT/کنترل نهایی ELE — گزارش‌های بازرسی: FULTELE/FULT EMS/QC EMS)
  const reports = SOURCE_REPORTS[f.source];
  if (reports && reports.length) {
    const keys = reports.map((_, i) => `@rep${i}`);
    reports.forEach((label, i) => { params[`rep${i}`] = label; });
    where.push(`(${alias}.report IS NULL OR ${alias}.sources LIKE '%inprocess%' OR ${alias}.sources LIKE '%inspection%' OR ${alias}.report IN (${keys.join(', ')}))`);
  }
  return { sql: `WHERE ${where.join(' AND ')}`, params };
}

/** شرط‌های قابل اعمال بر نمای تولید (v_production) */
export function productionWhere(f, alias = 'p') {
  const where = ['1 = 1'];
  const params = {};
  if (f.from) { where.push(`${alias}.production_date >= @from`); params.from = f.from; }
  if (f.to) { where.push(`${alias}.production_date <= @to`); params.to = f.to; }
  const prodfields = [
    ['category', 'category'],
    ['stage', 'stage'],
    ['branch', 'branch'],
    ['final_group', 'final_group'],
    ['product_family', 'product_family'],
    ['product_code', 'product_code'],
    ['work_center', 'work_center'],
    ['process_domain', 'process_domain']
  ];
  for (const [key, col] of prodfields) listClause(alias, key, f[key], where, params, col);
  return { sql: `WHERE ${where.join(' AND ')}`, params };
}

/** ترکیب شرط‌های اضافی با پارامترها */
export function mergeWhere(...parts) {
  const clauses = [];
  const params = {};
  for (const p of parts) {
    if (!p) continue;
    if (p.sql) {
      const s = p.sql.replace(/^WHERE\s+/i, '').trim();
      if (s && s !== '1 = 1') clauses.push(s);
    }
    Object.assign(params, p.params || {});
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** محاسبه بازه قبلی (به طول بازه فعلی) */
export function previousPeriod(f) {
  const a = parseJalali(f.from);
  const b = parseJalali(f.to);
  if (!a || !b) return null;
  const start = j2d(a.jy, a.jm, a.jd);
  const end = j2d(b.jy, b.jm, b.jd);
  const len = end - start + 1;
  const pEnd = start - 1;
  const pStart = pEnd - len + 1;
  const f2 = { ...f };
  const j1 = d2j(pStart);
  const j2 = d2j(pEnd);
  f2.from = formatJalali(j1.jy, j1.jm, j1.jd);
  f2.to = formatJalali(j2.jy, j2.jm, j2.jd);
  return f2;
}
