/**
 * موتور تحلیل خودکار کیفیت («تحلیلگر»)
 * ---------------------------------------------------------------
 * کاری که این موتور می‌کند همان کاری است که یک کارشناس کیفیت انجام می‌دهد:
 *   ۱) کلیات را در چند جمله می‌گوید (وضعیت، PPM، بزرگ‌ترین مشکل، روند)
 *   ۲) آلارم می‌دهد (چه چیزی، کجا، چقدر، چرا، چه باید کرد)
 *   ۳) TOP 10 «توضیحات تعمیرات» را با محصول، مرحله/ایستگاه، کد عیب،
 *      ریشهٔ 6M، قطعه، زمان تعمیر و روندِ دورهٔ اخیر همراه هر مورد می‌آورد
 *
 * نکته‌ی مهم: اگر در یک منبع «توضیحات تعمیرات» ثبت نشده باشد (اسناد بازرسی و
 * پلیمر)، موتور خودش پایهٔ تحلیل را به «کد عیب» تغییر می‌دهد و دلیلش را هم
 * در خروجی می‌نویسد؛ یعنی هیچ‌وقت تحلیلِ پوچ تحویل کاربر نمی‌دهد.
 *
 * همه‌ی آستانه‌ها نسبی‌اند (بر پایهٔ حجم دادهٔ همان بازه) تا با فایل جدید
 * هم معنادار بمانند. هر آلارم یک «مسیر دریل» دارد که کاربر را مستقیم به
 * رکوردهای همان موضوع می‌برد.
 */
import { getDb } from './db.mjs';
import { defectWhere } from './filters.mjs';
import { summary, breakdown, trend, pfmea, viewFor } from './analytics.mjs';
import { j2d, d2j, parseJalali, formatJalali } from './jalali.mjs';

const SOURCE_LABEL = { inprocess: 'حین تولید', inspection: 'اسناد بازرسی', polymer: 'پلیمر' };
const SOURCES = ['inprocess', 'inspection', 'polymer'];

const SEV_LABEL = {
  critical: 'بحرانی', high: 'مهم', medium: 'متوسط', low: 'کم', info: 'اطلاع', good: 'بهبود'
};
const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4, good: 5 };
const KIND_LABEL = {
  ppm_trend: 'روند PPM', dominance: 'بزرگ‌ترین موضوع', spike: 'جهش ناگهانی',
  improvement: 'بهبود', product_ppm: 'محصول پرخطر', product_spike: 'جهش محصول',
  process_concentration: 'تمرکز فرآیندی', detection_escape: 'فرار عیب', chronic: 'عیب مزمن',
  cause_6m: 'ریشهٔ 6M', part_family: 'خانوادهٔ قطعه', supplier: 'تامین‌کننده',
  rpn: 'ریسک PFMEA', rework_time: 'زمان تعمیر', stage_focus: 'تمرکز مرحله',
  data_quality: 'کیفیت داده', systemic: 'الگوی سیستماتیک', scrap: 'ضایعات'
};

/** ردیف‌هایی که «ضایعاتِ سند عملکرد» هستند، نه عیبِ تحلیل‌شده (در منبع پلیمر) */
function isScrap(key) { return /ضایعات/.test(String(key || '')); }

/* عبارت‌های SQL برای ابعاد پرکاربرد (در هر دو نمای عیب وجود دارند) */
const E = {
  repair:   "COALESCE(d.repair_desc,'ثبت نشده')",
  product:  "COALESCE(d.unified_name, d.product_name_dim, d.product_code, 'نامشخص')",
  stage:    "COALESCE(d.stage,'سایر')",
  station:  "COALESCE(d.station,'نامشخص')",
  domain:   "COALESCE(d.process_domain,'سایر')",
  code:     "COALESCE(d.defect_code,'نامشخص')",
  codelbl:  "COALESCE(d.defect_desc, d.defect_code, 'نامشخص')",
  m6:       "COALESCE(d.cause_6m,'ثبت نشده')",
  part:     "COALESCE(d.part_family,'ثبت نشده')",
  partname: "COALESCE(d.part_name,'ثبت نشده')",
  supplier: "COALESCE(d.supplier,'ثبت نشده')",
  raction:  "COALESCE(d.repair_action,'ثبت نشده')",
  fmode:    "COALESCE(d.failure_mode,'ثبت نشده')",
  month:    "COALESCE(d.jmonth_label,'نامشخص')",
  order:    "COALESCE(NULLIF(d.order_no,''), d.order_date || '|' || COALESCE(d.product_code,''))"
};

/* ------------------------------------------------------------------ ابزارها */
const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
function fa(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return String(Math.round(Number(v)).toLocaleString('en-US')).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}
function fa1(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    .replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}
function pct(part, whole) { return whole > 0 ? (part / whole) * 100 : 0; }
/** تاریخِ شمسیِ خوانا: 1405-04-31 ← ۱۴۰۵/۰۴/۳۱ */
function faDate(v) {
  if (!v) return '—';
  return String(v).replace(/-/g, '/').replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}
function change(cur, prev) {
  if (!prev) return cur > 0 ? null : 0;          // null = «قبلاً وجود نداشته»
  return ((cur - prev) / prev) * 100;
}
function trendWord(c) {
  if (c === null || c === undefined) return 'مورد تازه';
  if (c >= 25) return 'افزایش شدید';
  if (c >= 8) return 'رو به افزایش';
  if (c <= -25) return 'کاهش چشمگیر';
  if (c <= -8) return 'رو به بهبود';
  return 'پایدار';
}
function arrow(c) {
  if (c === null || c === undefined) return '✦';
  if (c > 1) return '▲';
  if (c < -1) return '▼';
  return '■';
}
function median(list) {
  const a = [...list].sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function shiftDays(jdate, delta) {
  const p = parseJalali(jdate);
  if (!p) return null;
  const j = d2j(j2d(p.jy, p.jm, p.jd) + delta);
  return formatJalali(j.jy, j.jm, j.jd);
}
function daySpan(a, b) {
  const pa = parseJalali(a); const pb = parseJalali(b);
  if (!pa || !pb) return 0;
  return j2d(pb.jy, pb.jm, pb.jd) - j2d(pa.jy, pa.jm, pa.jd) + 1;
}

/** پرس‌وجوی تجمیعی عمومی روی نمای عیبِ یک منبع */
function agg(f, source, dims, { extra = '', params = {}, order = 'defects DESC', limit = 0 } = {}) {
  const db = getDb();
  const view = viewFor(source);
  const dw = defectWhere({ ...f, source }, 'd');
  const sel = dims.map(([as, expr]) => `${expr} AS ${as}`).join(', ');
  const gby = dims.map(([as]) => as).join(', ');
  return db.prepare(`
    SELECT ${sel}, COALESCE(SUM(d.defect_qty),0) AS defects, COUNT(*) AS rows_count
    FROM ${view} d ${dw.sql}${extra}
    GROUP BY ${gby}
    ORDER BY ${order}${limit ? ` LIMIT ${Number(limit)}` : ''}
  `).all({ ...dw.params, ...params });
}

/** شرط «یکی از این کلیدها» به‌همراه پارامترهای بانام */
function inList(expr, keys, prefix = 'kk') {
  const params = {};
  if (!keys || !keys.length) return { extra: ' AND 1 = 0', params };
  const names = keys.map((v, i) => { params[`${prefix}${i}`] = v; return `@${prefix}${i}`; });
  return { extra: ` AND ${expr} IN (${names.join(',')})`, params };
}

/** فهرست → Map (کلید → تعداد عیب) */
function toMap(rows, key = 'k', val = 'defects') {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + (r[val] || 0));
  return m;
}

/** گروه‌بندی ردیف‌های چندبُعدی در حافظه: کلید → فهرست {key,label,defects} مرتب */
function groupBy(rows, keyField, valField, labelField) {
  const out = new Map();
  for (const r of rows) {
    const k = r[keyField];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push({ key: r[valField], label: labelField ? r[labelField] : r[valField], defects: r.defects || 0 });
  }
  for (const [k, list] of out) {
    list.sort((a, b) => b.defects - a.defects);
    out.set(k, list);
  }
  return out;
}

/** تبدیل فهرست به «سهم‌دار» با درصدِ کل و درصدِ داخلِ همان مورد */
function withShare(list, total, n = 3) {
  const sum = list.reduce((s, x) => s + x.defects, 0);
  return list.slice(0, n).map((x) => ({
    key: x.key, label: x.label, defects: x.defects,
    pct_of_total: pct(x.defects, total),
    pct_of_item: sum > 0 ? (x.defects / sum) * 100 : 0
  }));
}

/* دانشِ اقدام: ریشهٔ 6M → کار عملی */
const M6_ACTION = {
  'مواد اولیه': 'کنترل ورودی مواد/قطعات و بررسی بچ یا تامین‌کنندهٔ مشکوک؛ در صورت تکرار، درخواست اقدام اصلاحی از تامین‌کننده',
  'تجهیرات و ماشین آلات': 'بازبینی نتِ پیشگیرانه و کالیبراسیون دستگاه مربوط؛ بررسی پارامترهای فرآیند (دما/فشار/سرعت) و ثبت تغییرات',
  'اپراتور': 'آموزش مجدد و استانداردسازی روش کار در همان ایستگاه؛ بازبینی کفایت اپراتور و شیفت‌بندی',
  'روش': 'بازنگری دستورالعمل و پارامترهای فرآیند و به‌روزرسانی مستندات؛ اعتبارسنجی تغییر روش با نمونه‌گیری',
  'محیط': 'کنترل شرایط محیطی (دما، رطوبت، تمیزی، روشنایی) در سالن مربوط',
  'اندازه‌گیری': 'کالیبراسیون تجهیزات تست و بازنگری روش اندازه‌گیری و حد پذیرش'
};
/* دانشِ اقدام: مرحلهٔ فرآیند → کار عملی */
const STAGE_ACTION = {
  'SMD': 'بررسی کیفیت خمیر قلع و استنسیل، پروفایل ری‌فلو، وضعیت نازل‌ها و فیدرها و دقت جای‌گذاری (Pick&Place)',
  'مونتاژ و وان قلع (QV/فالت)': 'بازبینی پارامترهای لحیم‌سازی موج/وان قلع (دما، سرعت نوار، فلاکس) و زاویهٔ ورود برد',
  'تکمیل کاری (ICT برای نودها)': 'بازبینی فیکسچر و سوزن‌های تست ICT و حذف اتصال‌های کاذبِ ناشی از تست',
  'کنترل نهایی': 'بازنگری روش تست نهایی و معیارهای پذیرش، و مهم‌تر: بررسی اینکه این عیب چرا در ایستگاه‌های قبلی کشف نشده است',
  'تزریق و کنترل نهایی دایال': 'بازبینی پارامترهای تزریق (دما، فشار، زمان سرد شدن) و وضعیت قالب مربوط',
  'چاپ و لیزر دایال': 'کنترل کیفیت چاپ/لیزر، تمیزی سطح و ثبات مرکب',
  'قطعات نیمه‌ساخته': 'کنترل کیفیت قطعات نیمه‌ساخته در ورودی مرحلهٔ بعد و بازبینی تلرانس‌ها',
  'مونتاژ و تست': 'بازنگری روش مونتاژ دستی و فیکسچرهای تست؛ آموزش اپراتور مونتاژ',
  'مجموعه‌سازی سنسور/آنتن/سایر': 'بازنگری روش مونتاژ مجموعه و کنترل‌های حین مونتاژ'
};

/** اقدام پیشنهادی برای یک ردیفِ TOP 10 */
function actionFor(row) {
  const out = [];
  const m6 = (row.cause6m || [])[0];
  if (m6 && m6.key !== 'ثبت نشده' && m6.pct_of_item >= 35) out.push(M6_ACTION[m6.key] || `رفع ریشهٔ غالب (${m6.label}) با تعریف اقدام اصلاحی`);
  const st = (row.stages || [])[0];
  if (st && st.key !== 'سایر' && st.pct_of_item >= 45) out.push(STAGE_ACTION[st.key] || `تمرکز بازرسی و اقدام اصلاحی در مرحلهٔ «${st.label}»`);
  const part = (row.parts || [])[0];
  if (part && part.key !== 'ثبت نشده' && part.pct_of_item >= 30) out.push(`بررسی قطعهٔ «${part.label}» از نظر انطباق، بچ و تامین‌کننده`);
  if ((row.avg_troubleshoot_min || 0) >= 25) out.push('کاهش زمان عیب‌یابی با تهیهٔ راهنمای تشخیص و تجهیزات تست مناسب‌تر');
  if (row.window && row.window.change !== null && row.window.change >= 50) out.push('بررسی تغییرات اخیر (مواد/دستگاه/روش/نفر) در همان بازهٔ زمانی');
  if (!out.length) out.push('تعریف اقدام اصلاحی برای این مورد و پایش اثر آن در دورهٔ بعد');
  return out;
}

/* ------------------------------------------------------------------ پنجره‌ها */
function windows(f, source) {
  const db = getDb();
  const view = viewFor(source);
  const dw = defectWhere({ ...f, source }, 'd');
  const cov = db.prepare(`SELECT MIN(d.order_date) AS a, MAX(d.order_date) AS b FROM ${view} d ${dw.sql}`).get(dw.params);
  const from = f.from || cov.a;
  const to = f.to || cov.b;
  if (!from || !to) return null;
  const days = Math.max(1, daySpan(from, to));
  const win = Math.max(7, Math.min(30, Math.round(days / 2)));
  const curFrom = shiftDays(to, -(win - 1));
  return {
    from, to, days, win,
    cur: { from: curFrom, to },
    prev: { from: shiftDays(curFrom, -win), to: shiftDays(curFrom, -1) }
  };
}

/* ------------------------------------------------------------------ موتور اصلی */
export function insights(f, source = 'inprocess') {
  const t0 = Date.now();
  const s = summary(f, source);
  const total = s.defects || 0;
  const w = windows(f, source);

  const base = {
    source,
    source_label: SOURCE_LABEL[source] || source,
    generated_at: new Date().toISOString(),
    range: w ? { from: w.from, to: w.to, days: w.days, window_days: w.win, cur: w.cur, prev: w.prev } : null,
    basis: null,
    thresholds: null,
    headline: null,
    alarms: [],
    actions: [],
    top_repair: [],
    top_defects: [],
    top_products: [],
    top_stages: [],
    top_stations: [],
    top_6m: [],
    top_parts: [],
    top_suppliers: [],
    focus: [],
    chronic: [],
    escapes: [],
    rpn: [],
    data_quality: null,
    monthly: [],
    sources_overview: sourcesOverview(f),
    took_ms: 0
  };

  if (!total || !w) {
    base.basis = {
      dim: 'repair_desc', filter: 'repair_desc', label: 'توضیحات تعمیرات', repair_missing_share: 0,
      note: 'در این بازه عیبی ثبت نشده است تا پایهٔ تحلیل انتخاب شود.'
    };
    base.thresholds = { minCount: 0, spikeMin: 0, ppm: 0, total: 0, basis: 'توضیحات تعمیرات' };
    base.headline = {
      verdict: 'داده ناکافی', tone: 'muted', alarm_counts: {}, quick: [], findings: [],
      narrative: 'در این بازه و با این فیلترها عیبی ثبت نشده است؛ بازهٔ تاریخ یا فیلترها را تغییر دهید.',
      kpis: { production: s.production || 0, defects: 0, ppm: 0 }
    };
    return base;
  }

  /* ---- تجمیع‌های پایه ---- */
  const bdRepair = breakdown(f, source, 'repair_desc', 40);
  const bdProduct = breakdown(f, source, 'product_unified', 80);
  const bdStage = breakdown(f, source, 'stage', 15);
  const bdStation = breakdown(f, source, 'station', 15);
  const bdCode = breakdown(f, source, 'defect', 30);
  const bd6m = breakdown(f, source, 'cause_6m', 10);
  const bdPart = breakdown(f, source, 'part_family', 12);
  const bdSupplier = breakdown(f, source, 'supplier', 12);
  const monthly = trend(f, source, 'month');

  /* ---- انتخاب پایهٔ تحلیل: توضیحات تعمیرات؛ و اگر ثبت نشده، کد عیب ---- */
  const noRepair = bdRepair.find((r) => r.key === 'ثبت نشده');
  const repairMissingShare = noRepair ? noRepair.pct : 0;
  const useCode = repairMissingShare > 50;
  const basisDim = useCode ? 'defect' : 'repair_desc';
  const basisFilter = useCode ? 'defect_code' : 'repair_desc';
  const basisExpr = useCode ? E.code : E.repair;
  const basisLabel = useCode ? 'کد عیب' : 'توضیحات تعمیرات';
  base.basis = {
    dim: basisDim, filter: basisFilter, label: basisLabel,
    repair_missing_share: repairMissingShare,
    note: useCode
      ? `«توضیحات تعمیرات» در ${fa1(repairMissingShare)}٪ عیوبِ منبع «${SOURCE_LABEL[source]}» ثبت نشده است؛ بنابراین تحلیل به‌طور خودکار بر اساس «کد عیب» انجام شد. برای داشتن تحلیلِ تعمیرات، این ستون باید در گزارش پر شود.`
      : `پایهٔ تحلیل «توضیحات تعمیرات» است (در ${fa1(100 - repairMissingShare)}٪ عیوب ثبت شده است).`
  };

  /* ---- آستانه‌های نسبی (با دادهٔ کم/زیاد معنادار بمانند) ---- */
  const minCount = Math.max(8, Math.round(total * 0.008));   // «قابل توجه» بودن یک مورد
  const spikeMin = Math.max(6, Math.round(total * 0.004));   // حداقل افزایش مطلق برای آلارم جهش
  base.thresholds = { minCount, spikeMin, ppm: s.ppm, total, basis: basisLabel };

  const bdBasis = breakdown(f, source, basisDim, 40);
  const topKeys = bdBasis.slice(0, 10).map((r) => r.key);
  const topSum = bdBasis.slice(0, 10).reduce((a, r) => a + r.defects, 0);
  const tl = inList(basisExpr, topKeys);

  /* ---- ماتریس‌های ریز برای TOP 10 ---- */
  const xProduct = groupBy(agg(f, source, [['k', basisExpr], ['v', E.product]], tl), 'k', 'v');
  const xStage = groupBy(agg(f, source, [['k', basisExpr], ['v', E.stage]], tl), 'k', 'v');
  const xStation = groupBy(agg(f, source, [['k', basisExpr], ['v', E.station]], tl), 'k', 'v');
  const xCode = groupBy(agg(f, source, [['k', basisExpr], ['v', E.code], ['lbl', E.codelbl]], tl), 'k', 'v', 'lbl');
  const x6m = groupBy(agg(f, source, [['k', basisExpr], ['v', E.m6]], tl), 'k', 'v');
  const xPart = groupBy(agg(f, source, [['k', basisExpr], ['v', E.part]], tl), 'k', 'v');
  const xSupplier = groupBy(agg(f, source, [['k', basisExpr], ['v', E.supplier]], tl), 'k', 'v');
  const xAction = groupBy(agg(f, source, [['k', basisExpr], ['v', E.raction]], tl), 'k', 'v');
  const xMonth = groupBy(agg(f, source, [['k', basisExpr], ['v', E.month]], tl), 'k', 'v');

  const db = getDb();
  const view = viewFor(source);
  const dw = defectWhere({ ...f, source }, 'd');
  const statRows = db.prepare(`
    SELECT ${basisExpr} AS k,
           COUNT(DISTINCT ${E.order})   AS orders,
           COUNT(DISTINCT ${E.product}) AS products,
           COUNT(DISTINCT ${E.stage})   AS stages,
           COUNT(DISTINCT ${E.code})    AS codes,
           COUNT(DISTINCT d.order_date) AS days,
           AVG(d.fix_time_min)          AS fix_avg,
           AVG(d.troubleshoot_time_min) AS ts_avg,
           MAX(d.rpn)                   AS rpn_max
    FROM ${view} d ${dw.sql}${tl.extra}
    GROUP BY k
  `).all({ ...dw.params, ...tl.params });
  const statMap = new Map(statRows.map((r) => [r.k, r]));

  /* ---- مقایسهٔ دو پنجرهٔ اخیر (برای جهش‌ها و روند) ---- */
  const curF = { ...f, from: w.cur.from, to: w.cur.to };
  const prevF = { ...f, from: w.prev.from, to: w.prev.to };
  const curBasis = toMap(agg(curF, source, [['k', basisExpr]]));
  const prevBasis = toMap(agg(prevF, source, [['k', basisExpr]]));
  const curProduct = toMap(agg(curF, source, [['k', E.product]]));
  const prevProduct = toMap(agg(prevF, source, [['k', E.product]]));
  const prodCur = summary(curF, source);
  const prodPrev = summary(prevF, source);
  const ppmCur = prodCur.ppm || 0;
  const ppmPrev = prodPrev.ppm || 0;

  /* ---- ساخت TOP 10 ---- */
  base.top_repair = bdBasis.slice(0, 10).map((r, i) => {
    const st = statMap.get(r.key) || {};
    const cur = curBasis.get(r.key) || 0;
    const prev = prevBasis.get(r.key) || 0;
    const ch = change(cur, prev);
    const row = {
      rank: i + 1,
      key: r.key,
      label: r.label || r.key,
      defects: r.defects,
      rows: r.rows_count,
      share: r.pct,
      cum_share: r.cumPct,
      ppm: r.ppm,
      window: { cur, prev, days: w.win, change: ch, word: trendWord(ch), arrow: arrow(ch) },
      monthly: (xMonth.get(r.key) || []).map((m) => ({ month: m.key, defects: m.defects })),
      months: (xMonth.get(r.key) || []).length,
      products: withShare(xProduct.get(r.key) || [], total, 3),
      stages: withShare(xStage.get(r.key) || [], total, 3),
      stations: withShare(xStation.get(r.key) || [], total, 3),
      codes: withShare(xCode.get(r.key) || [], total, 3),
      cause6m: withShare(x6m.get(r.key) || [], total, 3),
      parts: withShare(xPart.get(r.key) || [], total, 3),
      suppliers: withShare(xSupplier.get(r.key) || [], total, 2),
      actions: withShare(xAction.get(r.key) || [], total, 3),
      orders: st.orders || 0,
      distinct_products: st.products || 0,
      distinct_stages: st.stages || 0,
      distinct_codes: st.codes || 0,
      active_days: st.days || 0,
      avg_fix_min: st.fix_avg ?? null,
      avg_troubleshoot_min: st.ts_avg ?? null,
      rpn_max: st.rpn_max ?? null
    };
    row.action = actionFor(row);
    row.story = basisStory(row, basisLabel);
    row.drill = { source, filters: { [basisFilter]: [row.key] } };
    return row;
  });

  base.top_defects = bdCode.slice(0, 12).map((r) => ({
    key: r.key, label: r.label, defects: r.defects, share: r.pct, ppm: r.ppm,
    drill: { source, filters: { defect_code: [r.key] } }
  }));

  /* محصولات: PPM هر محصول با «میانهٔ هم‌گروهان» مقایسه می‌شود، نه با میانگین کل؛
     چون مخرجِ تولیدِ هر محصول فقط کدهای نهایی همان محصول است. */
  const prodRows = bdProduct.filter((r) => r.defects >= minCount && r.production >= 1000);
  const peerPpm = median(prodRows.map((r) => r.ppm));
  base.top_products = bdProduct.filter((r) => r.defects > 0).slice(0, 15).map((r) => {
    const cur = curProduct.get(r.key) || 0;
    const prev = prevProduct.get(r.key) || 0;
    return {
      key: r.key, label: r.label, defects: r.defects, share: r.pct, production: r.production, ppm: r.ppm,
      ppm_vs_peers: peerPpm ? r.ppm / peerPpm : null,
      window: { cur, prev, change: change(cur, prev), word: trendWord(change(cur, prev)) },
      drill: { source, filters: { product_unified: [r.key] } }
    };
  });
  base.peer_ppm = peerPpm;

  /* ---- کانون‌های اقدام: کدام موضوع در کدام محصول (قابل‌اجراترین فهرست) ---- */
  const focusRows = agg(f, source, [['p', E.product], ['k', basisExpr], ['v', E.stage]], { limit: 9000 });
  const focusMap = new Map();
  for (const r of focusRows) {
    const key = `${r.p}||${r.k}`;
    if (!focusMap.has(key)) focusMap.set(key, { product: r.p, subject: r.k, defects: 0, stages: new Map() });
    const e = focusMap.get(key);
    e.defects += r.defects || 0;
    if (r.v) e.stages.set(r.v, (e.stages.get(r.v) || 0) + (r.defects || 0));
  }
  base.focus = [...focusMap.values()]
    .filter((e) => e.defects >= Math.max(5, minCount / 2))
    .sort((a, b) => b.defects - a.defects)
    .slice(0, 15)
    .map((e) => {
      const st = [...e.stages.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        product: e.product, subject: e.subject, subject_label: basisLabel, defects: e.defects,
        share: pct(e.defects, total), stage: st ? st[0] : null, stage_defects: st ? st[1] : 0,
        stage_share: st && e.defects ? (st[1] / e.defects) * 100 : 0,
        drill: { source, filters: { product_unified: [e.product], [basisFilter]: [e.subject] } }
      };
    });

  base.top_stages = bdStage.map((r) => ({ key: r.key, label: r.label, defects: r.defects, share: r.pct }));
  base.top_stations = bdStation.map((r) => ({ key: r.key, label: r.label, defects: r.defects, share: r.pct }));
  base.top_6m = bd6m.map((r) => ({ key: r.key, label: r.label, defects: r.defects, share: r.pct }));
  base.top_parts = bdPart.map((r) => ({ key: r.key, label: r.label, defects: r.defects, share: r.pct }));
  base.top_suppliers = bdSupplier.map((r) => ({ key: r.key, label: r.label, defects: r.defects, share: r.pct }));
  base.monthly = monthly.map((m) => ({ label: m.label, defects: m.defects, production: m.production, ppm: m.ppm }));

  /* ---- مزمن‌ها: (محصول × موضوع) در چند ماه پیاپی ---- */
  const chronRows = agg(f, source, [['p', E.product], ['k', basisExpr], ['m', E.month]], { limit: 8000 });
  const chronMap = new Map();
  for (const r of chronRows) {
    const key = `${r.p}||${r.k}`;
    if (!chronMap.has(key)) chronMap.set(key, { product: r.p, subject: r.k, months: new Set(), defects: 0 });
    const e = chronMap.get(key);
    e.months.add(r.m); e.defects += r.defects || 0;
  }
  const monthCount = new Set(monthly.map((m) => m.label)).size || 1;
  base.chronic = [...chronMap.values()]
    .filter((e) => e.months.size >= Math.min(3, monthCount) && e.defects >= minCount)
    .sort((a, b) => b.defects - a.defects)
    .slice(0, 20)
    .map((e) => ({
      product: e.product, subject: e.subject, subject_label: basisLabel, defects: e.defects, months: e.months.size,
      drill: { source, filters: { product_unified: [e.product], [basisFilter]: [e.subject] } }
    }));

  /* ---- فرار عیب از ایستگاه‌ها (ضعف کشف) ---- */
  const escRows = agg(f, source, [['k', E.code], ['lbl', E.codelbl], ['v', E.stage]]);
  const escMap = new Map();
  for (const r of escRows) {
    if (!escMap.has(r.k)) escMap.set(r.k, { code: r.k, label: r.lbl, stages: new Map(), defects: 0 });
    const e = escMap.get(r.k);
    e.stages.set(r.v, (e.stages.get(r.v) || 0) + (r.defects || 0));
    e.defects += r.defects || 0;
  }
  base.escapes = [...escMap.values()]
    .filter((e) => e.stages.size >= 3 && e.defects >= minCount && !isScrap(e.code))
    .sort((a, b) => b.defects - a.defects)
    .slice(0, 12)
    .map((e) => {
      const list = [...e.stages.entries()].map(([k, v]) => ({ key: k, label: k, defects: v }))
        .sort((a, b) => b.defects - a.defects);
      return {
        code: e.code, label: e.label, defects: e.defects, stage_count: e.stages.size,
        stages: withShare(list, total, 4),
        drill: { source, filters: { defect_code: [e.code] } }
      };
    });

  /* ---- RPN بالا (فقط حین تولید این داده را دارد) ---- */
  if (source === 'inprocess') {
    base.rpn = pfmea(f, 80).filter((r) => (r.rpn_max || 0) >= 150).slice(0, 15).map((r) => ({
      failure_mode: r.failure_mode, failure_mode_type: r.failure_mode_type, process_name: r.process_name,
      station: r.station, severity: r.severity, occurrence: r.occurrence, detection: r.detection,
      rpn_max: r.rpn_max, rpn_avg: r.rpn_avg, records: r.records, defects: r.defects,
      drill: { source, filters: { failure_mode: [r.failure_mode] } }
    }));
  }

  /* ---- کیفیت داده ---- */
  const no6m = bd6m.find((r) => r.key === 'ثبت نشده');
  base.data_quality = {
    repair_missing: noRepair ? { defects: noRepair.defects, share: noRepair.pct } : { defects: 0, share: 0 },
    cause6m_missing: no6m ? { defects: no6m.defects, share: no6m.pct } : { defects: 0, share: 0 },
    rows: s.defect_rows,
    orders_with_defect: s.orders_with_defect,
    days: w.days
  };

  /* ============================================================ قاعده‌های آلارم */
  const alarms = [];
  const push = (a) => { a.kind_label = KIND_LABEL[a.kind] || a.kind; alarms.push(a); };

  /* ۱) روند PPM در دو پنجرهٔ اخیر */
  if (ppmPrev > 0 && prodPrev.production > 0 && prodCur.production > 0) {
    const ch = change(ppmCur, ppmPrev);
    if (ch >= 10 || ch <= -15) {
      const up = ch > 0;
      const moversTxt = up
        ? topMovers(curBasis, prevBasis, 3).map((m) => `«${m.key}» (${arrow(m.change)} ${fa1(Math.abs(m.change ?? 0))}٪)`).join('، ')
        : '';
      push({
        id: 'ppm-window', kind: 'ppm_trend',
        severity: up ? (ch >= 25 ? 'critical' : 'high') : 'good',
        title: up ? `PPM در ${fa(w.win)} روز اخیر ${fa1(ch)}٪ بالا رفته است` : `PPM در ${fa(w.win)} روز اخیر ${fa1(Math.abs(ch))}٪ پایین آمده است`,
        body: `شاخص PPM از ${fa(ppmPrev)} در بازهٔ ${w.prev.from} تا ${w.prev.to} به ${fa(ppmCur)} در بازهٔ ${w.cur.from} تا ${w.cur.to} رسیده است.`
          + (up
            ? ' یعنی به ازای هر میلیون دستگاه، عیبِ بیشتری ثبت شده؛ علت اصلی باید پیش از پایان دورهٔ بعد مشخص شود.'
            : ' یعنی اثر اقدام‌های انجام‌شده دیده می‌شود؛ همان روش را برای موارد باقی‌مانده ادامه دهید.'),
        metrics: { ppm_cur: ppmCur, ppm_prev: ppmPrev, change_pct: ch },
        action: up
          ? (moversTxt ? `سه عامل اولِ افزایش در همین دوره: ${moversTxt} — بررسی تغییرات مواد/دستگاه/روش در این بازه` : 'بررسی تغییرات فرآیند در همین بازه')
          : 'مستندسازی اقدام‌های مؤثر و تبدیل آن‌ها به استاندارد کاری',
        evidence: [
          { label: 'PPM دورهٔ اخیر', value: fa(ppmCur) },
          { label: 'PPM دورهٔ قبل', value: fa(ppmPrev) },
          { label: 'تغییر', value: `${arrow(ch)} ${fa1(Math.abs(ch))}٪` }
        ],
        drill: { source, filters: { from: w.cur.from, to: w.cur.to } }
      });
    }
  }

  /* ۲) سلطهٔ اولین موضوع */
  const first = base.top_repair[0];
  if (first && first.share >= 12 && !isScrap(first.key)) {
    const isMissingData = useCode === false && first.key === 'ثبت نشده';
    push({
      id: 'top-basis', kind: 'dominance',
      severity: isMissingData ? 'medium' : (first.share >= 20 ? 'high' : 'medium'),
      title: isMissingData
        ? `«توضیحات تعمیرات» در ${fa1(first.share)}٪ عیوب ثبت نشده است`
        : `«${first.label}» به‌تنهایی ${fa1(first.share)}٪ کل عیوب است`,
      body: (isMissingData
        ? `${fa(first.defects)} عیب از ${fa(total)} مورد بدون توضیح تعمیرات ثبت شده‌اند؛ بدون این ستون نمی‌توان گفت واقعاً چه ایرادی رفع شده است. `
        : `در بازهٔ انتخابی ${fa(first.defects)} عیب از مجموع ${fa(total)} مورد با ${basisLabel} «${first.label}» ثبت شده است. `)
        + (first.products[0] ? `بیشترین سهم آن در محصول «${first.products[0].label}» (${fa(first.products[0].defects)} مورد = ${fa1(first.products[0].pct_of_item)}٪ این موضوع) ` : '')
        + (first.stages[0] ? `و در فرآیند/مرحلهٔ «${first.stages[0].label}» (${fa(first.stages[0].defects)} مورد = ${fa1(first.stages[0].pct_of_item)}٪) است. ` : '')
        + (useCode && first.codes[0] ? '' : (first.codes[0] ? `کد عیب غالب: «${first.codes[0].label}». ` : ''))
        + (first.cause6m[0] && first.cause6m[0].key !== 'ثبت نشده' ? `ریشهٔ 6M ثبت‌شده بیشتر «${first.cause6m[0].label}» (${fa1(first.cause6m[0].pct_of_item)}٪) است.` : ''),
      metrics: { subject: first.key, defects: first.defects, share: first.share },
      action: isMissingData
        ? 'الزامی‌کردن ثبت «توضیحات تعمیرات» در فرم گزارش کیفیت و پایش نرخ تکمیل آن'
        : first.action[0],
      evidence: [
        { label: 'تعداد عیب', value: fa(first.defects) },
        { label: 'سهم از کل', value: `${fa1(first.share)}٪` },
        { label: 'محصول اول', value: first.products[0] ? `${first.products[0].label} (${fa(first.products[0].defects)})` : '—' },
        { label: 'فرآیند اول', value: first.stages[0] ? `${first.stages[0].label} (${fa(first.stages[0].defects)})` : '—' },
        { label: 'روند اخیر', value: `${first.window.arrow} ${first.window.word}` }
      ],
      drill: { source, filters: { [basisFilter]: [first.key] } }
    });
  }

  /* ۳) جهش ناگهانیِ موضوع‌ها */
  const movers = topMovers(curBasis, prevBasis, 40)
    .filter((m) => m.delta >= spikeMin && m.cur >= Math.max(minCount / 2, 5) && (m.prev === 0 || m.change >= 50));
  for (const m of movers.slice(0, 5)) {
    const isNew = m.prev === 0;
    const detail = base.top_repair.find((r) => r.key === m.key);
    const strong = isNew ? m.cur >= minCount : (m.change ?? 0) >= 100;
    push({
      id: `spike-${m.key}`, kind: 'spike',
      severity: strong ? 'high' : 'medium',
      title: isNew
        ? `مورد تازه: «${m.key}» در ${fa(w.win)} روز اخیر ${fa(m.cur)} بار ثبت شده (پیش‌تر نبود)`
        : `جهش «${m.key}»: ${fa(m.prev)} → ${fa(m.cur)} مورد (${arrow(m.change)} ${fa1(Math.abs(m.change ?? 0))}٪)`,
      body: `در ${fa(w.win)} روز اخیر (${w.cur.from} تا ${w.cur.to}) «${m.key}» ${fa(m.cur)} عیب داشته، در حالی که در ${fa(w.win)} روز پیش از آن (${w.prev.from} تا ${w.prev.to}) ${fa(m.prev)} عیب داشت. `
        + (detail && detail.products[0] ? `تمرکز اصلی آن در محصول «${detail.products[0].label}»` : '')
        + (detail && detail.stages[0] ? ` و مرحلهٔ «${detail.stages[0].label}» است.` : (detail ? ' است.' : ''))
        + (isNew ? ' چون پیش‌تر دیده نشده، به احتمال زیاد تغییری در مواد، تنظیمات دستگاه یا روش کار رخ داده است.' : ''),
      metrics: { subject: m.key, cur: m.cur, prev: m.prev, change_pct: m.change },
      action: isNew
        ? 'بررسی تغییرات اخیر (مواد/دستگاه/روش/نفر) در همان بازه و ثبت علت در گزارش کیفیت'
        : (detail ? detail.action[0] : 'بررسی تغییرات اخیر فرآیند در همان بازه'),
      evidence: [
        { label: `${fa(w.win)} روز اخیر`, value: fa(m.cur) },
        { label: `${fa(w.win)} روز قبل`, value: fa(m.prev) },
        { label: 'تغییر', value: isNew ? 'مورد تازه' : `${arrow(m.change)} ${fa1(Math.abs(m.change ?? 0))}٪` },
        { label: 'محصول اصلی', value: detail?.products[0]?.label || '—' }
      ],
      drill: { source, filters: { [basisFilter]: [m.key], from: w.cur.from, to: w.cur.to } }
    });
  }

  /* ۴) بهبودِ قابل توجه (آلارم مثبت) */
  for (const r of base.top_repair.filter((x) => x.window.prev >= minCount && x.window.change !== null && x.window.change <= -30).slice(0, 3)) {
    push({
      id: `improve-${r.key}`, kind: 'improvement', severity: 'good',
      title: `بهبود «${r.label}»: ${fa(r.window.prev)} → ${fa(r.window.cur)} مورد`,
      body: `«${r.label}» در ${fa(w.win)} روز اخیر ${fa1(Math.abs(r.window.change))}٪ نسبت به ${fa(w.win)} روز قبل کم شده است. اگر اقدامی انجام شده، اثر آن دیده می‌شود و باید استاندارد و پایش شود.`,
      metrics: { subject: r.key, cur: r.window.cur, prev: r.window.prev, change_pct: r.window.change },
      action: 'ثبت اقدام مؤثر در سوابق کیفیت و پایش پایداری آن در دورهٔ بعد',
      evidence: [{ label: 'دورهٔ اخیر', value: fa(r.window.cur) }, { label: 'دورهٔ قبل', value: fa(r.window.prev) }],
      drill: { source, filters: { [basisFilter]: [r.key] } }
    });
  }

  /* ۵) محصولات پرخطر (PPM بالاتر از میانهٔ هم‌گروهان) */
  const outliers = prodRows
    .filter((p) => peerPpm > 0 && p.ppm >= peerPpm * 1.8)
    .sort((a, b) => b.ppm - a.ppm)
    .slice(0, 3);
  for (const p of outliers) {
    const pl = inList(E.product, [p.key], 'pp');
    const topSubject = agg(f, source, [['k', basisExpr]], pl)[0];
    const topStage = agg(f, source, [['k', E.stage]], pl)[0];
    const prod = base.top_products.find((x) => x.key === p.key);
    push({
      id: `product-${p.key}`, kind: 'product_ppm',
      severity: p.ppm >= peerPpm * 3 ? 'high' : 'medium',
      title: `«${p.label}» ${fa1(p.ppm / peerPpm)} برابرِ میانهٔ محصولات، عیب دارد (PPM ${fa(p.ppm)})`,
      body: `«${p.label}» با ${fa(p.production)} دستگاه تولید، ${fa(p.defects)} عیب دارد؛ PPM آن ${fa(p.ppm)} است در حالی که میانهٔ PPM محصولاتِ هم‌حجم ${fa(peerPpm)} است. `
        + (topSubject ? `بیشترین ${basisLabel} آن «${topSubject.k}» (${fa(topSubject.defects)} مورد)` : '')
        + (topStage ? ` و مرحلهٔ اصلی «${topStage.k}» (${fa(topStage.defects)} مورد) است.` : '')
        + (prod && prod.window.change !== null && prod.window.change >= 25 ? ` روند ${fa(w.win)} روز اخیر هم ${arrow(prod.window.change)} ${fa1(Math.abs(prod.window.change))}٪ بوده است.` : ''),
      metrics: { product: p.key, ppm: p.ppm, peer_ppm: peerPpm, defects: p.defects, production: p.production },
      action: topSubject
        ? `تمرکز اقدام اصلاحی روی «${topSubject.k}» در این محصول${topStage ? ` در مرحلهٔ «${topStage.k}»` : ''}`
        : 'بازنگری فرآیند تولید این محصول',
      evidence: [
        { label: 'PPM محصول', value: fa(p.ppm) },
        { label: 'میانهٔ هم‌گروهان', value: fa(peerPpm) },
        { label: 'تعداد عیب', value: fa(p.defects) },
        { label: 'موضوع اصلی', value: topSubject ? topSubject.k : '—' }
      ],
      drill: { source, filters: { product_unified: [p.key] } }
    });
  }

  /* ۶) جهش محصول‌ها */
  const productMovers = topMovers(curProduct, prevProduct, 30)
    .filter((x) => x.delta >= spikeMin && x.cur >= minCount && x.prev > 0 && x.change >= 40);
  for (const m of productMovers.slice(0, 3)) {
    const pl = inList(E.product, [m.key], 'pp');
    const topSubject = agg({ ...curF }, source, [['k', basisExpr]], pl)[0];
    push({
      id: `pspike-${m.key}`, kind: 'product_spike',
      severity: m.change >= 100 ? 'high' : 'medium',
      title: `افزایش عیب «${m.key}»: ${fa(m.prev)} → ${fa(m.cur)} مورد (${arrow(m.change)} ${fa1(Math.abs(m.change))}٪)`,
      body: `عیوبِ «${m.key}» در ${fa(w.win)} روز اخیر ${fa1(Math.abs(m.change))}٪ بیشتر از ${fa(w.win)} روز قبل شده است. `
        + (topSubject ? `بیشترین ${basisLabel} در همین دورهٔ اخیر «${topSubject.k}» (${fa(topSubject.defects)} مورد) است. ` : '')
        + 'چنین جهشی معمولاً به تغییر بچ مواد، تنظیمات دستگاه/قالب یا جابه‌جایی اپراتور همان خط مربوط است.',
      metrics: { product: m.key, cur: m.cur, prev: m.prev, change_pct: m.change },
      action: 'مقایسهٔ تغییرات خط/شیفت/بچ مواد بین دو دوره و بررسی نخستین قطعات تولیدیِ دورهٔ اخیر',
      evidence: [{ label: 'دورهٔ اخیر', value: fa(m.cur) }, { label: 'دورهٔ قبل', value: fa(m.prev) }, { label: 'موضوع اصلی', value: topSubject ? topSubject.k : '—' }],
      drill: { source, filters: { product_unified: [m.key], from: w.cur.from, to: w.cur.to } }
    });
  }

  /* ۷) تمرکز فرآیندی یک موضوع */
  const conc = base.top_repair
    .map((r) => ({ r, st: r.stages[0] }))
    .filter(({ r, st }) => st && st.key !== 'سایر' && st.pct_of_item >= 60 && r.defects >= minCount
      && r.key !== 'ثبت نشده' && !isScrap(r.key))
    .sort((a, b) => b.r.defects - a.r.defects);
  for (const { r, st } of conc.slice(0, 4)) {
    const isFinal = /^کنترل نهایی/.test(st.key);
    push({
      id: `conc-${r.key}`, kind: 'process_concentration',
      severity: st.pct_of_item >= 80 && !isFinal ? 'high' : 'medium',
      title: isFinal
        ? `«${r.label}» بیشتر در «${st.label}» دیده می‌شود (${fa1(st.pct_of_item)}٪) — عیب از مراحل قبل فرار کرده`
        : `«${r.label}» تقریباً فقط در «${st.label}» رخ می‌دهد (${fa1(st.pct_of_item)}٪)`,
      body: `از ${fa(r.defects)} مورد «${r.label}»، ${fa(st.defects)} مورد در مرحلهٔ «${st.label}» ثبت شده است. `
        + (isFinal
          ? 'تمرکز در ایستگاه آخر یعنی این عیب در مراحل قبلی کشف نشده و تا کنترل نهایی رسیده است؛ هزینهٔ کشف در آخرین مرحله بیشترین است.'
          : 'چنین تمرکزی یعنی ریشه در خودِ همان فرآیند است، نه پراکنده در خطوط. ')
        + (r.stations[0] ? ` ایستگاه اصلی: «${r.stations[0].label}».` : '')
        + (r.products[0] ? ` محصول اصلی: «${r.products[0].label}» (${fa1(r.products[0].pct_of_item)}٪).` : ''),
      metrics: { subject: r.key, stage: st.key, share: st.pct_of_item, defects: r.defects },
      action: STAGE_ACTION[st.key] || `بازنگری پارامترها و روش کار در مرحلهٔ «${st.label}»`,
      evidence: [
        { label: 'مرحلهٔ غالب', value: `${st.label} (${fa1(st.pct_of_item)}٪)` },
        { label: 'تعداد عیب', value: fa(r.defects) },
        { label: 'محصول اول', value: r.products[0]?.label || '—' },
        { label: 'ایستگاه اول', value: r.stations[0]?.label || '—' }
      ],
      drill: { source, filters: { [basisFilter]: [r.key], stage: [st.key] } }
    });
  }

  /* ۸) فرار عیب از ایستگاه‌های قبلی (یک کد عیب در چند مرحله) */
  for (const e of base.escapes.slice(0, 3)) {
    const last = e.stages.find((x) => /کنترل نهایی/.test(x.key));
    push({
      id: `escape-${e.code}`, kind: 'detection_escape', severity: 'high',
      title: `عیب «${e.label}» در ${fa(e.stage_count)} مرحله تکرار شده است`,
      body: `کد عیب ${e.code} («${e.label}») با ${fa(e.defects)} مورد در ${fa(e.stage_count)} مرحله دیده شده: `
        + e.stages.map((x) => `${x.label} (${fa(x.defects)})`).join('، ') + '. '
        + (last
          ? `بیشترین سهم در «${last.label}» است؛ یعنی عیب در ایستگاه‌های قبلی کشف نشده و تا مرحلهٔ آخر فرار کرده است.`
          : 'تکرار یک عیب در چند مرحله یعنی یک علت مشترک بالادستی وجود دارد.'),
      metrics: { defect_code: e.code, stages: e.stage_count, defects: e.defects },
      action: 'بازنگری معیارهای پذیرش و روش بازرسی در ایستگاه‌های میانی + تعریف کنترل مؤثرتر در مبدأ ایجاد عیب',
      evidence: e.stages.map((x) => ({ label: x.label, value: fa(x.defects) })),
      drill: { source, filters: { defect_code: [e.code] } }
    });
  }

  /* ۹) عیب‌های مزمن */
  for (const c of base.chronic.slice(0, 4)) {
    push({
      id: `chronic-${c.product}-${c.subject}`, kind: 'chronic', severity: 'medium',
      title: `مزمن: «${c.subject}» در «${c.product}» — ${fa(c.months)} ماه پیاپی`,
      body: `این ترکیب در ${fa(c.months)} ماهِ مختلفِ بازه تکرار شده و جمعاً ${fa(c.defects)} عیب دارد. تکرارِ ماهانه یعنی اقدام‌های موردی جواب نداده‌اند و به اقدام اصلاحی ریشه‌ای نیاز است.`,
      metrics: { product: c.product, subject: c.subject, months: c.months, defects: c.defects },
      action: 'تعریف اقدام اصلاحی ریشه‌ای (8D/A3) با مسئول و تاریخ مشخص، و پایش سه دورهٔ بعد',
      evidence: [{ label: 'ماه‌های درگیر', value: fa(c.months) }, { label: 'جمع عیب', value: fa(c.defects) }],
      drill: c.drill
    });
  }

  /* ۱۰) ریشهٔ 6M غالب */
  const m6Items = base.top_repair
    .filter((r) => r.cause6m[0] && r.cause6m[0].key !== 'ثبت نشده' && r.cause6m[0].pct_of_item >= 45 && r.defects >= minCount);
  for (const r of m6Items.slice(0, 3)) {
    const m6 = r.cause6m[0];
    push({
      id: `6m-${r.key}`, kind: 'cause_6m', severity: 'medium',
      title: `ریشهٔ غالب «${r.label}»: ${m6.label} (${fa1(m6.pct_of_item)}٪)`,
      body: `در ${fa(r.defects)} مورد «${r.label}»، عامل مسببِ ثبت‌شده بیشتر «${m6.label}» است (${fa(m6.defects)} مورد). تا وقتی این ریشه رفع نشود، تعداد عیب پایین نمی‌آید و تعمیرات فقط پیامد را جمع می‌کند.`,
      metrics: { subject: r.key, cause_6m: m6.key, share: m6.pct_of_item },
      action: M6_ACTION[m6.key] || `رفع ریشهٔ «${m6.label}» با اقدام اصلاحی تعریف‌شده`,
      evidence: [{ label: 'عامل مسبب', value: m6.label }, { label: 'سهم', value: `${fa1(m6.pct_of_item)}٪` }, { label: 'تعداد عیب', value: fa(m6.defects) }],
      drill: { source, filters: { [basisFilter]: [r.key], cause_6m: [m6.key] } }
    });
  }

  /* ۱۱) قطعه / تامین‌کنندهٔ مشکل‌دار */
  for (const p of bdPart.filter((x) => x.key !== 'ثبت نشده' && x.pct >= 10 && x.defects >= minCount).slice(0, 2)) {
    push({
      id: `part-${p.key}`, kind: 'part_family', severity: 'medium',
      title: `خانوادهٔ قطعهٔ «${p.label}» ${fa1(p.pct)}٪ عیوب را دارد`,
      body: `${fa(p.defects)} عیب به قطعاتِ خانوادهٔ «${p.label}» مربوط است. اگر این سهم به یک تامین‌کننده یا یک بچ خاص گره خورده باشد، مسئله کیفیتِ ورودی مواد است نه فرآیند تولید.`,
      metrics: { part_family: p.key, defects: p.defects, share: p.pct },
      action: 'ردیابی بچ/تامین‌کنندهٔ همان قطعات، سخت‌گیری در بازرسی ورودی و در صورت تکرار، اقدام اصلاحی تامین‌کننده',
      evidence: [{ label: 'تعداد عیب', value: fa(p.defects) }, { label: 'سهم از کل', value: `${fa1(p.pct)}٪` }],
      drill: { source, filters: { part_family: [p.key] } }
    });
  }
  for (const sup of bdSupplier.filter((x) => x.key !== 'ثبت نشده' && x.pct >= 10 && x.defects >= minCount).slice(0, 2)) {
    push({
      id: `sup-${sup.key}`, kind: 'supplier', severity: 'medium',
      title: `تامین‌کنندهٔ «${sup.label}» در ${fa1(sup.pct)}٪ عیوب نقش دارد`,
      body: `${fa(sup.defects)} عیب با قطعاتِ این تامین‌کننده ثبت شده است. تجمع عیب روی یک تامین‌کننده، سرنخ قویِ مشکل کیفیت ورودی است.`,
      metrics: { supplier: sup.key, defects: sup.defects, share: sup.pct },
      action: 'ارسال گزارش کیفیت به تامین‌کننده، درخواست اقدام اصلاحی و ارزیابی مجدد او',
      evidence: [{ label: 'تعداد عیب', value: fa(sup.defects) }, { label: 'سهم از کل', value: `${fa1(sup.pct)}٪` }],
      drill: { source, filters: { supplier: [sup.key] } }
    });
  }

  /* ۱۲) ریسک بالای PFMEA */
  for (const r of base.rpn.filter((x) => (x.rpn_max || 0) >= 200).slice(0, 3)) {
    push({
      id: `rpn-${r.failure_mode}-${r.station}`, kind: 'rpn',
      severity: (r.rpn_max || 0) >= 300 ? 'critical' : 'high',
      title: `ریسک بالا (RPN ${fa(r.rpn_max)}): «${r.failure_mode}» در ${r.station || r.process_name || '—'}`,
      body: `حالت خرابی «${r.failure_mode}» (${r.failure_mode_type || '—'}) در فرآیند «${r.process_name || r.station || '—'}» بالاترین RPN را دارد: شدت ${fa1(r.severity)}، وقوع ${fa1(r.occurrence)}، کشف ${fa1(r.detection)} → RPN ${fa(r.rpn_max)}. ${fa(r.records)} رکورد و ${fa(r.defects)} عیب ثبت شده است.`,
      metrics: { failure_mode: r.failure_mode, station: r.station, rpn_max: r.rpn_max },
      action: (r.detection >= 7 ? 'افزایش قابلیت کشف (تست یا بازرسی مؤثرتر)؛ ' : '')
        + (r.occurrence >= 7 ? 'کاهش وقوع با اصلاح پارامترهای فرآیند؛ ' : '')
        + (r.severity >= 8 ? 'ارزیابی اثر بر مشتری و در صورت لزوم بازطراحی' : 'بازنگری اقدام‌های کنترلی در PFMEA'),
      evidence: [
        { label: 'RPN بیشینه', value: fa(r.rpn_max) },
        { label: 'شدت / وقوع / کشف', value: `${fa1(r.severity)} / ${fa1(r.occurrence)} / ${fa1(r.detection)}` },
        { label: 'ایستگاه', value: r.station || '—' }
      ],
      drill: r.drill
    });
  }

  /* ۱۳) زمان عیب‌یابی/تعمیر بالا */
  const slow = base.top_repair.filter((r) => (r.avg_troubleshoot_min || 0) >= 25 && (r.rows || 0) >= 15);
  for (const r of slow.slice(0, 2)) {
    push({
      id: `time-${r.key}`, kind: 'rework_time', severity: 'low',
      title: `زمان عیب‌یابی «${r.label}» به‌طور میانگین ${fa(r.avg_troubleshoot_min)} دقیقه است`,
      body: `برای ${fa(r.rows)} رکوردِ «${r.label}»، میانگین زمان عیب‌یابی ${fa(r.avg_troubleshoot_min)} دقیقه و میانگین زمان رفع عیب ${fa(r.avg_fix_min || 0)} دقیقه ثبت شده است. زمان بالای عیب‌یابی معمولاً یعنی روش تشخیصِ استاندارد یا ابزار مناسب در ایستگاه وجود ندارد.`,
      metrics: { subject: r.key, troubleshoot_min: r.avg_troubleshoot_min, fix_min: r.avg_fix_min },
      action: 'تهیهٔ راهنمای تشخیص گام‌به‌گام برای این عیب و تجهیز ایستگاه به ابزار تست مناسب',
      evidence: [{ label: 'عیب‌یابی (دقیقه)', value: fa(r.avg_troubleshoot_min) }, { label: 'رفع عیب (دقیقه)', value: fa(r.avg_fix_min || 0) }],
      drill: { source, filters: { [basisFilter]: [r.key] } }
    });
  }

  /* ۱۴) تمرکز مرحله‌ایِ کل */
  const topStage = bdStage[0];
  if (topStage && topStage.pct >= 30 && topStage.key !== 'سایر') {
    push({
      id: `stage-${topStage.key}`, kind: 'stage_focus',
      severity: topStage.pct >= 45 ? 'high' : 'medium',
      title: `${fa1(topStage.pct)}٪ عیوب در مرحلهٔ «${topStage.label}» ثبت می‌شود`,
      body: `از ${fa(total)} عیب، ${fa(topStage.defects)} مورد به مرحلهٔ «${topStage.label}» مربوط است. `
        + (topStage.pct >= 45
          ? 'این تمرکز شدید است؛ هر بهبود در همین مرحله بیشترین اثر را روی PPM کل دارد.'
          : 'بخش قابل توجهی از بار کیفیت روی این مرحله است.'),
      metrics: { stage: topStage.key, defects: topStage.defects, share: topStage.pct },
      action: STAGE_ACTION[topStage.key] || `بازنگری کنترل‌های فرآیندی در مرحلهٔ «${topStage.label}»`,
      evidence: [{ label: 'تعداد عیب', value: fa(topStage.defects) }, { label: 'سهم از کل', value: `${fa1(topStage.pct)}٪` }],
      drill: { source, filters: { stage: [topStage.key] } }
    });
  }

  /* ۱۴ب) سهم ضایعات در منبع پلیمر (این ردیف‌ها عیبِ تحلیل‌شده نیستند) */
  const scrapItem = base.top_repair.find((r) => isScrap(r.key));
  if (scrapItem && scrapItem.share >= 20) {
    push({
      id: 'scrap-share', kind: 'scrap', severity: 'high',
      title: `${fa1(scrapItem.share)}٪ از «عیوب» این منبع در واقع ضایعاتِ سند عملکرد است`,
      body: `${fa(scrapItem.defects)} مورد از ${fa(total)} با عنوان «${scrapItem.label}» ثبت شده است؛ این‌ها قطعاتی هستند که در سند عملکرد به‌عنوان ضایعات آمده‌اند، نه عیبِ تعمیرشده. `
        + (scrapItem.stages[0] ? `بیشترین سهم در مرحلهٔ «${scrapItem.stages[0].label}» (${fa1(scrapItem.stages[0].pct_of_item)}٪) است. ` : '')
        + 'برای کاهش این عدد باید روی پارامترهای همان فرآیند (نه تعمیر) کار کرد؛ بقیهٔ آلارم‌های این گزارش دربارهٔ همین ردیف‌ها تکرار نمی‌شوند.',
      metrics: { subject: scrapItem.key, defects: scrapItem.defects, share: scrapItem.share },
      action: STAGE_ACTION[scrapItem.stages[0]?.key] || 'بازنگری پارامترهای فرآیند تولید برای کاهش ضایعات',
      evidence: [
        { label: 'ضایعات', value: fa(scrapItem.defects) },
        { label: 'سهم از کل', value: `${fa1(scrapItem.share)}٪` },
        { label: 'مرحلهٔ اصلی', value: scrapItem.stages[0]?.label || '—' }
      ],
      drill: { source, filters: { [basisFilter]: [scrapItem.key] } }
    });
  }

  /* ۱۵) کیفیت داده */
  const dq = base.data_quality;
  if (dq.repair_missing.share >= 15) {
    // اگر آن ستون در این منبع اساساً پر نمی‌شود (ساختاری)، شدت پایین‌تر می‌گیرد تا
    // قضاوتِ کلیِ گزارش را خراب نکند؛ ولی همچنان به‌عنوان مانعِ تحلیل گزارش می‌شود.
    const structural = dq.repair_missing.share >= 95;
    push({
      id: 'dq-repair', kind: 'data_quality',
      severity: structural ? 'medium' : (dq.repair_missing.share >= 60 ? 'high' : 'medium'),
      title: structural
        ? `در این منبع «توضیحات تعمیرات» ثبت نمی‌شود (${fa1(dq.repair_missing.share)}٪ خالی)`
        : `توضیحات تعمیرات در ${fa1(dq.repair_missing.share)}٪ عیوب ثبت نشده است`,
      body: `${fa(dq.repair_missing.defects)} عیب بدون «توضیحات تعمیرات» ثبت شده‌اند. بدون این ستون نمی‌توان فهمید واقعاً چه ایرادی رفع شده؛ به همین دلیل تحلیلِ این منبع به‌طور خودکار بر پایهٔ «کد عیب» انجام شد.`,
      metrics: { defects: dq.repair_missing.defects, share: dq.repair_missing.share },
      action: 'الزامی‌کردن ثبت توضیح تعمیرات در فرم گزارش کیفیت، آموزش ثبت‌کنندگان و پایش نرخ تکمیل آن',
      evidence: [{ label: 'عیب‌های بدون توضیح', value: fa(dq.repair_missing.defects) }, { label: 'سهم', value: `${fa1(dq.repair_missing.share)}٪` }],
      drill: { source, filters: { repair_desc: ['ثبت نشده'] } }
    });
  }
  if (dq.cause6m_missing.share >= 40) {
    push({
      id: 'dq-6m', kind: 'data_quality', severity: 'low',
      title: `عامل مسبب (6M) در ${fa1(dq.cause6m_missing.share)}٪ عیوب خالی است`,
      body: `برای ${fa(dq.cause6m_missing.defects)} عیب، ریشهٔ 6M ثبت نشده است؛ بنابراین ریشه‌یابی خودکار برای این بخش ممکن نیست و پیشنهادِ اقدام فقط بر پایهٔ محصول و فرآیند داده می‌شود.`,
      metrics: { defects: dq.cause6m_missing.defects, share: dq.cause6m_missing.share },
      action: 'افزودن فهرست کشویی 6M به فرم گزارش کیفیت و پایش نرخ تکمیل آن',
      evidence: [{ label: 'ردیف‌های بدون 6M', value: fa(dq.cause6m_missing.defects) }],
      drill: { source, filters: { cause_6m: ['ثبت نشده'] } }
    });
  }

  /* ۱۶) الگوی سیستماتیک (پخش در محصولات مختلف = علت مشترک) */
  const systemic = base.top_repair.filter((r) =>
    r.key !== 'ثبت نشده' && !isScrap(r.key) && r.distinct_products >= 5 && r.orders >= 20
    && r.products[0] && r.products[0].pct_of_item < 45);
  for (const r of systemic.slice(0, 2)) {
    push({
      id: `spread-${r.key}`, kind: 'systemic', severity: 'medium',
      title: `«${r.label}» سیستماتیک است: ${fa(r.orders)} سفارش و ${fa(r.distinct_products)} محصول مختلف`,
      body: `این مورد به یک محصول یا یک سفارش محدود نیست؛ در ${fa(r.orders)} سفارش، ${fa(r.distinct_products)} محصول و ${fa(r.distinct_stages)} مرحله دیده شده و هیچ محصولی بیش از ${fa1(r.products[0].pct_of_item)}٪ سهم ندارد. چنین الگویی معمولاً به یک علت مشترک (مواد، دستگاه مشترک یا روش کار) برمی‌گردد و با اقدام موردی حل نمی‌شود.`,
      metrics: { subject: r.key, orders: r.orders, products: r.distinct_products, stages: r.distinct_stages },
      action: 'بررسی علت مشترک بین محصولات (مواد/دستگاه/روش) و تعریف یک اقدام اصلاحی فراگیر به‌جای رفع موردی',
      evidence: [
        { label: 'سفارش‌های درگیر', value: fa(r.orders) },
        { label: 'محصول‌های درگیر', value: fa(r.distinct_products) },
        { label: 'مراحل درگیر', value: fa(r.distinct_stages) }
      ],
      drill: { source, filters: { [basisFilter]: [r.key] } }
    });
  }

  /* ---- مرتب‌سازی، اولویت‌بندی و جمع‌بندی ---- */
  alarms.sort((a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity]) || (b.metrics?.defects ?? b.metrics?.share ?? 0) - (a.metrics?.defects ?? a.metrics?.share ?? 0));
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, good: 0 };
  alarms.forEach((a, i) => {
    a.severity_label = SEV_LABEL[a.severity];
    a.seq = i + 1;
    a.priority = i < 8 && a.severity !== 'good';
    counts[a.severity] = (counts[a.severity] || 0) + 1;
  });
  base.alarms = alarms;
  base.alarm_counts = counts;

  /* ---- اقدام‌های فوری (از دلِ آلارم‌های مهم) ---- */
  base.actions = alarms
    .filter((a) => ['critical', 'high', 'medium'].includes(a.severity))
    .slice(0, 8)
    .map((a, i) => ({
      priority: i + 1, severity: a.severity, kind_label: a.kind_label,
      title: a.title, text: a.action, drill: a.drill
    }));

  /* ---- کلیات: همان چیزی که باید اول دیده شود ---- */
  const ppmChange = change(ppmCur, ppmPrev);
  const verdict = counts.critical ? { text: 'وضعیت بحرانی', tone: 'danger' }
    : counts.high >= 3 ? { text: 'نیازمند توجه فوری', tone: 'danger' }
      : counts.high >= 1 ? { text: 'نیازمند توجه', tone: 'warn' }
        : counts.medium >= 3 ? { text: 'قابل پیگیری', tone: 'warn' }
          : { text: 'پایدار', tone: 'ok' };

  const narrative = [
    `در بازهٔ ${faDate(w.from)} تا ${faDate(w.to)} (${fa(w.days)} روز) در منبع «${SOURCE_LABEL[source]}»، ${fa(total)} عیب روی ${fa(s.production)} دستگاه تولید ثبت شده است (PPM = ${fa(s.ppm)}).`,
    ppmChange !== null && ppmPrev > 0
      ? `PPM ${fa(w.win)} روز اخیر ${fa(ppmCur)} و ${fa(w.win)} روز پیش از آن ${fa(ppmPrev)} بوده، یعنی ${arrow(ppmChange)} ${fa1(Math.abs(ppmChange))}٪.`
      : '',
    first && first.key !== 'ثبت نشده'
      ? `بزرگ‌ترین موضوع «${first.label}» است: ${fa(first.defects)} عیب = ${fa1(first.share)}٪ کل`
        + (first.products[0] ? `؛ بیشتر در محصول «${first.products[0].label}» (${fa1(first.products[0].pct_of_item)}٪)` : '')
        + (first.stages[0] ? ` و فرآیند «${first.stages[0].label}» (${fa1(first.stages[0].pct_of_item)}٪)` : '')
        + (first.cause6m[0] && first.cause6m[0].key !== 'ثبت نشده' ? `؛ ریشهٔ ثبت‌شده بیشتر «${first.cause6m[0].label}»` : '')
        + '.'
      : '',
    base.top_repair.length >= 5 && topSum < total
      ? `ده مورد اولِ ${basisLabel} با هم ${fa(topSum)} عیب = ${fa1(pct(topSum, total))}٪ کل را می‌سازند؛ یعنی با حلِ همین ده مورد، حدود ${fa1(pct(topSum, total))}٪ بار کیفیت کم می‌شود.`
      : '',
    `${fa(counts.critical + counts.high)} آلارم بحرانی/مهم و ${fa(counts.medium)} آلارم متوسط فعال است`
      + (counts.good ? ` و ${fa(counts.good)} مورد بهبود دیده می‌شود.` : '.'),
    base.basis.note && useCode ? base.basis.note : ''
  ].filter(Boolean).join(' ');

  /* ---- یافته‌های تفکیک‌شده: هر عدد در کارتِ خودش با برچسب و جملهٔ جدا ----
     هدف: خواننده مجبور نباشد از یک پاراگرافِ پیوسته حدس بزند کدام عدد مال کدام توضیح است. */
  const findings = [];
  findings.push({
    icon: '🗓', label: 'بازهٔ تحلیل', tone: 'info',
    value: fa(w.days), unit: 'روز',
    text: `از ${faDate(w.from)} تا ${faDate(w.to)} در منبع «${SOURCE_LABEL[source]}»`
  });
  findings.push({
    icon: '🧮', label: 'عیبِ ثبت‌شده', tone: 'info',
    value: fa(total), unit: 'مورد',
    text: `روی ${fa(s.production)} دستگاه تولید، در ${fa(s.defect_rows)} ردیف گزارش`
  });
  findings.push({
    icon: '🎯', label: 'نرخ عیب (PPM)', tone: s.ppm > 20000 ? 'danger' : s.ppm > 8000 ? 'warn' : 'ok',
    value: fa(s.ppm), unit: 'عیب در میلیون دستگاه',
    text: 'تعداد عیبِ ثبت‌شده به ازای هر یک میلیون دستگاه تولید'
  });
  if (ppmChange !== null && ppmPrev > 0) {
    findings.push({
      icon: ppmChange < 0 ? '📉' : '📈',
      label: `روند ${fa(w.win)} روز اخیر`,
      tone: ppmChange < 0 ? 'ok' : 'danger',
      value: `${arrow(ppmChange)} ${fa1(Math.abs(ppmChange))}`, unit: '٪ تغییر PPM',
      text: `PPM ${fa(w.win)} روز اخیر ${fa(ppmCur)} در برابر ${fa(ppmPrev)} در دورهٔ مشابهِ قبلی`,
      chips: [{ label: 'دورهٔ جاری', value: `PPM ${fa(ppmCur)}` }, { label: 'دورهٔ قبل', value: `PPM ${fa(ppmPrev)}` }]
    });
  }
  if (first && first.key !== 'ثبت نشده') {
    findings.push({
      icon: '🥇', label: `بزرگ‌ترین ${basisLabel}`, tone: 'danger',
      value: first.label,
      sub: `${fa(first.defects)} عیب = ${fa1(first.share)}٪ کل`,
      text: 'سهم این مورد از همهٔ عیب‌های بازهٔ انتخابی',
      chips: [
        first.products[0] ? { label: 'محصول اول', value: `${first.products[0].label} — ${fa1(first.products[0].pct_of_item)}٪` } : null,
        first.stages[0] ? { label: 'فرآیند اول', value: `${first.stages[0].label} — ${fa1(first.stages[0].pct_of_item)}٪` } : null,
        (first.cause6m[0] && first.cause6m[0].key !== 'ثبت نشده')
          ? { label: 'ریشهٔ 6M', value: `${first.cause6m[0].label} — ${fa1(first.cause6m[0].pct_of_item)}٪` } : null
      ].filter(Boolean),
      drill: first.drill
    });
  }
  if (base.top_repair.length >= 5 && topSum < total) {
    findings.push({
      icon: '🔟', label: 'اثرِ ده موردِ اول', tone: 'warn',
      value: fa1(pct(topSum, total)), unit: '٪ از کل عیب‌ها',
      sub: `${fa(topSum)} عیب در ۱۰ ${basisLabel}`,
      text: 'با حلِ همین ده مورد، این سهم از بار کیفیت کم می‌شود',
      drill: { source, page: 'analyst' }
    });
  }
  findings.push({
    icon: '🚨', label: 'آلارم‌های فعال', tone: counts.critical ? 'danger' : counts.high ? 'warn' : 'ok',
    value: fa(counts.critical + counts.high), unit: 'آلارم بحرانی/مهم',
    text: [
      counts.medium ? `${fa(counts.medium)} آلارم متوسط` : '',
      counts.low ? `${fa(counts.low)} آلارم کم` : '',
      counts.good ? `${fa(counts.good)} مورد بهبود` : ''
    ].filter(Boolean).join(' · ') || 'فقط همین آلارم‌های مهم فعال است'
  });
  if (base.basis.note && useCode) {
    findings.push({ icon: 'ℹ️', label: 'مبنای تحلیل', tone: 'muted', value: base.basis.label || '—', text: base.basis.note });
  }

  base.headline = {
    verdict: verdict.text,
    tone: verdict.tone,
    narrative,
    findings,
    alarm_counts: counts,
    kpis: {
      production: s.production, defects: total, ppm: s.ppm, scrap_rate: s.scrap_rate,
      defect_rows: s.defect_rows, orders: s.orders, orders_with_defect: s.orders_with_defect,
      rework_hours: s.rework_hours, ppm_cur: ppmCur, ppm_prev: ppmPrev, ppm_change: ppmChange,
      products: base.top_products.length, alarm_total: alarms.length, days: w.days, window_days: w.win
    },
    quick: [
      { label: 'وضعیت کلی', value: verdict.text, tone: verdict.tone },
      { label: `بیشترین ${basisLabel}`, value: first ? `${first.label} — ${fa(first.defects)} مورد (${fa1(first.share)}٪)` : '—', drill: first?.drill },
      { label: 'بیشترین محصول', value: base.top_products[0] ? `${base.top_products[0].label} — ${fa(base.top_products[0].defects)} مورد` : '—', drill: base.top_products[0]?.drill },
      { label: 'بیشترین فرآیند', value: topStage ? `${topStage.label} — ${fa(topStage.defects)} مورد (${fa1(topStage.pct)}٪)` : '—', drill: topStage ? { source, filters: { stage: [topStage.key] } } : null },
      { label: 'پرخطرترین ایستگاه', value: bdStation[0] ? `${bdStation[0].label} — ${fa(bdStation[0].defects)} مورد` : '—', drill: bdStation[0] ? { source, filters: { station: [bdStation[0].key] } } : null },
      { label: `روند ${fa(w.win)} روز اخیر`, value: `${arrow(ppmChange)} PPM ${fa(ppmCur)} (دورهٔ قبل ${fa(ppmPrev)})` },
      { label: 'آلارم فعال', value: `${fa(counts.critical + counts.high)} مهم/بحرانی · ${fa(counts.medium)} متوسط${counts.good ? ` · ${fa(counts.good)} بهبود` : ''}` },
      { label: 'مهم‌ترین اقدام', value: base.actions[0]?.text || '—', drill: base.actions[0]?.drill }
    ]
  };

  base.took_ms = Date.now() - t0;
  return base;
}

/** بیشترین تغییرکننده‌ها بین دو پنجره */
function topMovers(curMap, prevMap, limit = 20) {
  const keys = new Set([...curMap.keys(), ...prevMap.keys()]);
  const rows = [];
  for (const k of keys) {
    if (!k || k === 'ثبت نشده' || k === 'نامشخص') continue;
    const cur = curMap.get(k) || 0;
    const prev = prevMap.get(k) || 0;
    rows.push({ key: k, cur, prev, change: change(cur, prev), delta: cur - prev });
  }
  return rows
    .filter((r) => r.delta > 0)
    .sort((a, b) => (b.prev === 0 ? 1e9 : b.change) - (a.prev === 0 ? 1e9 : a.change) || b.delta - a.delta)
    .slice(0, limit);
}

/** جملهٔ کوتاهِ توصیفی برای هر ردیفِ TOP 10 */
function basisStory(r, basisLabel) {
  const bits = [
    `${fa(r.defects)} عیب (${fa1(r.share)}٪ کل)`,
    r.products[0] ? `محصول «${r.products[0].label}» ${fa1(r.products[0].pct_of_item)}٪` : '',
    r.stages[0] ? `فرآیند «${r.stages[0].label}» ${fa1(r.stages[0].pct_of_item)}٪` : '',
    basisLabel !== 'کد عیب' && r.codes[0] ? `کد عیب «${r.codes[0].label}»` : '',
    r.cause6m[0] && r.cause6m[0].key !== 'ثبت نشده' ? `ریشهٔ ${r.cause6m[0].label} ${fa1(r.cause6m[0].pct_of_item)}٪` : '',
    r.parts[0] && r.parts[0].key !== 'ثبت نشده' ? `قطعهٔ ${r.parts[0].label}` : '',
    `${fa(r.orders)} سفارش · ${fa(r.active_days)} روز`,
    `${r.window.arrow} ${r.window.word}`
  ].filter(Boolean);
  return bits.join(' · ');
}

/** کلیاتِ سه منبع (برای کارتِ «یک نگاه» در صفحهٔ اول) */
export function sourcesOverview(f) {
  return SOURCES.map((src) => {
    try {
      const s = summary(f, src);
      const rep = breakdown(f, src, 'repair_desc', 2);
      const noRep = rep.find((r) => r.key === 'ثبت نشده');
      const useCode = !noRep || noRep.pct > 50;
      const bd = breakdown(f, src, useCode ? 'defect' : 'repair_desc', 1)[0] || null;
      const topProduct = breakdown(f, src, 'product_unified', 1)[0] || null;
      const topStage = breakdown(f, src, 'stage', 1)[0] || null;
      return {
        source: src,
        label: SOURCE_LABEL[src],
        production: s.production,
        defects: s.defects,
        ppm: s.ppm,
        scrap_rate: s.scrap_rate,
        delta: s.delta || null,
        basis: useCode ? 'کد عیب' : 'توضیحات تعمیرات',
        basis_dim: useCode ? 'defect' : 'repair_desc',
        top_basis: bd ? { key: bd.key, label: bd.label, defects: bd.defects, share: bd.pct } : null,
        top_product: topProduct ? { key: topProduct.key, label: topProduct.label, defects: topProduct.defects, ppm: topProduct.ppm } : null,
        top_stage: topStage ? { key: topStage.key, label: topStage.label, defects: topStage.defects, share: topStage.pct } : null
      };
    } catch {
      return { source: src, label: SOURCE_LABEL[src], production: 0, defects: 0, ppm: 0, basis: '—', top_basis: null, top_product: null, top_stage: null };
    }
  });
}

export const INSIGHT_META = { SEV_LABEL, SEV_RANK, KIND_LABEL, SOURCE_LABEL, M6_ACTION, STAGE_ACTION };
