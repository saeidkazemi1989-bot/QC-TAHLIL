/**
 * لایه تحلیل: تبدیل فیلترها به پرس‌وجوهای تجمیعی
 * ---------------------------------------------------------------
 * شاخص‌های اصلی:
 *   تولید        = مجموع «مقدار سالم» سفارش‌های در بازه
 *   تعداد عیوب   = مجموع «تعداد عیب/ایراد» (حین تولید یا بازرسی)
 *   PPM          = تعداد عیوب ÷ تولید × یک‌میلیون
 *   نرخ ضایعات   = ضایعات ÷ (سالم + ضایعات) × ۱۰۰
 */
import { getDb } from './db.mjs';
import { defectWhere, orderWhere, productionWhere, previousPeriod, mergeWhere } from './filters.mjs';

const VIEW_BY_SOURCE = { inprocess: 'v_inprocess', inspection: 'v_inspection', polymer: 'v_inspection' };

export function viewFor(source) {
  return VIEW_BY_SOURCE[source] || 'v_inprocess';
}

// ---------------------------------------------------------------- ابعاد
export const DIMENSIONS = {
  station:         { label: 'ایستگاه',            key: "COALESCE(d.station,'نامشخص')",              label2: null, sources: ['inprocess', 'inspection', 'polymer'], orderLevel: true },
  category:        { label: 'دسته محصول',         key: "COALESCE(d.category,'سایر')",               label2: null, sources: ['inprocess', 'inspection', 'polymer'], orderLevel: true },
  stage:           { label: 'زیرگروه محصول',      key: "COALESCE(d.stage,'سایر')",                  label2: null, sources: ['inprocess', 'inspection', 'polymer'], orderLevel: true },
  process_domain:  { label: 'حوزه فرآیندی',       key: "COALESCE(d.process_domain,'سایر')",         sources: ['inprocess', 'inspection', 'polymer'], orderLevel: true },
  final_group:     { label: 'گروه محصول نهایی',   key: "COALESCE(d.final_group,'نامشخص')",          sources: ['inprocess', 'inspection', 'polymer'], orderLevel: true },
  product_family:  { label: 'خانواده محصول',      key: "COALESCE(d.product_family,'نامشخص')",       sources: ['inprocess', 'inspection', 'polymer'], orderLevel: true },
  product_combined:{ label: 'نام محصول ترکیبی',   key: "COALESCE(d.product_combined,'نامشخص')",     sources: ['inprocess', 'inspection', 'polymer'], orderLevel: true },
  product:         { label: 'محصول (کد مرحله)',   key: "COALESCE(d.product_code,'نامشخص')",
    label2: "COALESCE(d.product_name_dim, d.product_code) || ' · ' || COALESCE(d.stage, 'سایر')",
    sources: ['inprocess', 'inspection', 'polymer'], orderLevel: true },
  product_unified: { label: 'محصول (یکپارچه)',    key: "COALESCE(d.unified_name, d.product_name_dim, d.product_code)",
    label2: "COALESCE(d.unified_name, d.product_name_dim, d.product_code)",
    sources: ['inprocess', 'inspection', 'polymer'], orderLevel: true,
    ordFilter: "AND COALESCE(o.product_code, '') IN (SELECT product_code FROM dim_product WHERE is_final = 1)" },
  report:          { label: 'گزارش مبدا',         key: "COALESCE(d.report,'نامشخص')",               sources: ['inprocess', 'inspection', 'polymer'] },
  defect:          { label: 'کد عیب',             key: "COALESCE(d.defect_code,'نامشخص')",          label2: "COALESCE(d.defect_desc, d.defect_code)", sources: ['inprocess', 'inspection', 'polymer'] },
  defect_group:    { label: 'دسته عیب',           key: "COALESCE(d.defect_group,'سایر')",           sources: ['inprocess', 'inspection', 'polymer'] },
  cause_6m:        { label: 'عامل مسبب (6M)',     key: "COALESCE(d.cause_6m,'ثبت نشده')",           sources: ['inprocess', 'inspection', 'polymer'] },
  part_family:     { label: 'خانواده قطعات',      key: "COALESCE(d.part_family,'ثبت نشده')",        sources: ['inprocess', 'inspection', 'polymer'] },
  part_name:       { label: 'نام قطعه',           key: "COALESCE(d.part_name,'ثبت نشده')",          sources: ['inprocess', 'inspection', 'polymer'] },
  supplier:        { label: 'تامین‌کننده',        key: "COALESCE(d.supplier,'ثبت نشده')",          sources: ['inprocess', 'inspection', 'polymer'] },
  repair_action:   { label: 'اقدام تعمیرات',      key: "COALESCE(d.repair_action,'ثبت نشده')",      sources: ['inprocess', 'inspection', 'polymer'] },
  repair_desc:     { label: 'توضیحات تعمیرات',    key: "COALESCE(d.repair_desc,'ثبت نشده')",        sources: ['inprocess', 'inspection', 'polymer'] },
  failure_mode:    { label: 'حالت خرابی بالقوه',  key: "COALESCE(d.failure_mode,'ثبت نشده')",       sources: ['inprocess', 'inspection', 'polymer'] },
  process_name:    { label: 'نام فرآیند (OPC)',   key: "COALESCE(d.process_name,'ثبت نشده')",       sources: ['inprocess', 'inspection', 'polymer'] },
  registrar:       { label: 'ثبت‌کننده اطلاعات',  key: "COALESCE(d.registrar,'ثبت نشده')",          sources: ['inprocess'] },
  operator:        { label: 'اپراتور مسبب',       key: "COALESCE(d.operator_name,'ثبت نشده')",      sources: ['inprocess', 'inspection', 'polymer'] },
  shift:           { label: 'شیفت',               key: "COALESCE(d.shift,'ثبت نشده')",              sources: ['inspection', 'polymer'], orderLevel: true },
  operation:       { label: 'عنوان عملیات آزمایش', key: "COALESCE(d.operation,'ثبت نشده')",         sources: ['inspection', 'polymer'] }
};


// key  -> برای نماهای عیب (نام مستعار d)
// keyOrder -> برای نمای سفارش‌ها (نام مستعار o) و جدول تقویم (dd)
export const DATE_GROUPS = {
  day: {
    key: "COALESCE(d.order_date,'نامشخص')",
    keyOrder: "COALESCE(o.order_date,'نامشخص')",
    keyProd: "COALESCE(p.production_date,'نامشخص')",
    label: "COALESCE(d.order_date,'نامشخص')"
  },
  week: {
    key: "COALESCE(d.jweek_label,'نامشخص')",
    keyOrder: "COALESCE(dd.jweek_label,'نامشخص')",
    keyProd: "COALESCE(d.jweek_label,'نامشخص')",
    label: "COALESCE(d.jweek_label,'نامشخص')"
  },
  month: {
    key: "COALESCE(d.jmonth_label,'نامشخص')",
    keyOrder: "COALESCE(dd.jmonth_label,'نامشخص')",
    keyProd: "COALESCE(d.jmonth_label,'نامشخص')",
    label: "COALESCE(d.jmonth_name_label,'نامشخص')"
  },
  quarter: {
    key: "COALESCE(d.jquarter_label,'نامشخص')",
    keyOrder: "COALESCE(dd.jquarter_label,'نامشخص')",
    keyProd: "COALESCE(d.jquarter_label,'نامشخص')",
    label: "COALESCE(d.jquarter_name,'نامشخص')"
  },
  half: {
    key: "COALESCE(d.jhalf_label,'نامشخص')",
    keyOrder: "COALESCE(dd.jhalf_label,'نامشخص')",
    keyProd: "COALESCE(d.jhalf_label,'نامشخص')",
    label: "COALESCE(d.jhalf_name,'نامشخص')"
  },
  year: {
    key: "COALESCE(CAST(d.jyear AS TEXT),'نامشخص')",
    keyOrder: "COALESCE(CAST(dd.jyear AS TEXT),'نامشخص')",
    keyProd: "COALESCE(CAST(d.jyear AS TEXT),'نامشخص')",
    label: "COALESCE(CAST(d.jyear AS TEXT),'نامشخص')"
  }
};


// ---------------------------------------------------------------- شاخص‌های کلیدی
export function summary(f, source = 'inprocess') {
  const db = getDb();
  const view = viewFor(source);
  const dw = defectWhere({ ...f, source }, 'd');
  const ow = orderWhere(f, 'o');

  const prod = db.prepare(`
    SELECT COUNT(*)                     AS orders,
           COALESCE(SUM(o.sound_qty),0) AS production,
           COALESCE(SUM(o.scrap_qty),0) AS scrap,
           COALESCE(SUM(o.planned_qty),0) AS planned
    FROM v_order o ${ow.sql}
  `).get(ow.params);

  const def = db.prepare(`
    SELECT COALESCE(SUM(d.defect_qty),0) AS defects,
           COUNT(*)                      AS defect_rows,
           COUNT(DISTINCT COALESCE(d.order_no, d.order_date || '|' || COALESCE(d.product_code, ''))) AS orders_with_defect
    FROM ${view} d ${dw.sql}
  `).get(dw.params);

  let times = { fix: 0, retest: 0, troubleshoot: 0, rows: 0, rpn_avg: null, rpn_max: null };
  if (source === 'inprocess') {
    times = db.prepare(`
      SELECT COALESCE(SUM(d.fix_time_min),0)          AS fix,
             COALESCE(SUM(d.retest_time_min),0)       AS retest,
             COALESCE(SUM(d.troubleshoot_time_min),0) AS troubleshoot,
             COUNT(*)                                 AS rows,
             AVG(d.rpn)                               AS rpn_avg,
             MAX(d.rpn)                               AS rpn_max
      FROM ${view} d ${dw.sql}
    `).get(dw.params);
  }

  const production = prod.production || 0;
  const defects = def.defects || 0;
  const scrap = prod.scrap || 0;
  const ppm = production > 0 ? (defects / production) * 1e6 : 0;
  const out = {
    source,
    production,
    planned: prod.planned || 0,
    defects,
    defect_rows: def.defect_rows || 0,
    orders: prod.orders || 0,
    orders_with_defect: def.orders_with_defect || 0,
    scrap,
    ppm,
    scrap_rate: (production + scrap) > 0 ? (scrap / (production + scrap)) * 100 : 0,
    defect_rate_per_order: prod.orders ? defects / prod.orders : 0,
    fix_hours: (times.fix || 0) / 60,
    retest_hours: (times.retest || 0) / 60,
    troubleshoot_hours: (times.troubleshoot || 0) / 60,
    rework_hours: ((times.fix || 0) + (times.retest || 0) + (times.troubleshoot || 0)) / 60,
    rpn_avg: times.rpn_avg,
    rpn_max: times.rpn_max
  };

  // مقایسه با دوره قبل
  const prev = previousPeriod(f);
  if (prev) {
    const p = summaryRaw(prev, source);
    out.prev = {
      production: p.production,
      defects: p.defects,
      ppm: p.ppm,
      scrap_rate: p.scrap_rate,
      from: prev.from,
      to: prev.to
    };
    out.delta = {
      production: p.production ? ((production - p.production) / p.production) * 100 : null,
      defects: p.defects ? ((defects - p.defects) / p.defects) * 100 : null,
      ppm: p.ppm ? ((ppm - p.ppm) / p.ppm) * 100 : null
    };
  }
  return out;
}

function summaryRaw(f, source) {
  const db = getDb();
  const view = viewFor(source);
  const dw = defectWhere({ ...f, source }, 'd');
  const ow = orderWhere(f, 'o');
  const prod = db.prepare(`SELECT COALESCE(SUM(o.sound_qty),0) AS production, COALESCE(SUM(o.scrap_qty),0) AS scrap FROM v_order o ${ow.sql}`).get(ow.params);
  const def = db.prepare(`SELECT COALESCE(SUM(d.defect_qty),0) AS defects FROM ${view} d ${dw.sql}`).get(dw.params);
  const production = prod.production || 0;
  const scrap = prod.scrap || 0;
  return {
    production,
    defects: def.defects || 0,
    ppm: production > 0 ? ((def.defects || 0) / production) * 1e6 : 0,
    scrap_rate: (production + scrap) > 0 ? (scrap / (production + scrap)) * 100 : 0
  };
}

// ---------------------------------------------------------------- روند زمانی
export function trend(f, source = 'inprocess', group = 'month') {
  const db = getDb();
  const view = viewFor(source);
  const g = DATE_GROUPS[group] || DATE_GROUPS.month;
  const dw = defectWhere({ ...f, source }, 'd');
  const ow = orderWhere(f, 'o');
  // در بخش سفارش‌ها نام مستعار جدول سفارش o و تقویم dd است
  const gkeyOrder = g.keyOrder || g.key;

  const rows = db.prepare(`
    WITH def AS (
      SELECT ${g.key} AS gkey, MIN(d.order_date) AS mind, MAX(d.order_date) AS maxd,
             COALESCE(SUM(d.defect_qty),0) AS defects
      FROM ${view} d ${dw.sql}
      GROUP BY gkey
    ),
    ord AS (
      SELECT ${gkeyOrder} AS gkey, MIN(o.order_date) AS mind, MAX(o.order_date) AS maxd,
             COALESCE(SUM(o.sound_qty),0) AS production,
             COALESCE(SUM(o.scrap_qty),0) AS scrap,
             COUNT(*) AS orders
      FROM v_order o JOIN dim_date dd ON dd.jdate = o.order_date ${ow.sql ? ow.sql.replace('WHERE', 'AND') : ''}
      GROUP BY gkey
    ),
    keys AS (
      SELECT gkey, MIN(mind) AS mind, MAX(maxd) AS maxd FROM (
        SELECT gkey, mind, maxd FROM def UNION ALL SELECT gkey, mind, maxd FROM ord
      ) GROUP BY gkey
    )
    SELECT k.gkey                     AS key,
           COALESCE(ord.production,0) AS production,
           COALESCE(ord.scrap,0)      AS scrap,
           COALESCE(ord.orders,0)     AS orders,
           COALESCE(def.defects,0)    AS defects,
           k.mind                     AS from_date,
           k.maxd                     AS to_date
    FROM keys k
    LEFT JOIN def ON def.gkey = k.gkey
    LEFT JOIN ord ON ord.gkey = k.gkey
    ORDER BY k.mind
  `).all({ ...dw.params, ...ow.params });

  return rows.map((r) => ({
    key: r.key,
    label: r.key,
    production: r.production,
    defects: r.defects,
    scrap: r.scrap,
    orders: r.orders,
    from_date: r.from_date || null,
    to_date: r.to_date || null,
    ppm: r.production > 0 ? (r.defects / r.production) * 1e6 : 0
  }));
}

// ---------------------------------------------------------------- تفکیک بر اساس یک بُعد
export function breakdown(f, source = 'inprocess', dim = 'station', limit = 25) {
  const db = getDb();
  const view = viewFor(source);
  const d = DIMENSIONS[dim];
  // ابعادی که برای این منبع معنا ندارند (مثل شیفت در حین تولید) خالی برمی‌گردند
  if (!d || (d.sources && !d.sources.includes(source))) return [];
  const dw = defectWhere({ ...f, source }, 'd');
  const ow = orderWhere(f, 'o');
  const labelExpr = d.label2 || d.key;
  const limitNum = Math.min(Math.max(Number(limit) || 25, 1), 500);
  // در بخش سفارش‌ها نام مستعار جدول o است
  const dkeyOrder = d.key.replace(/\bd\./g, 'o.');
  const dlabelOrder = labelExpr.replace(/\bd\./g, 'o.');

  let rows;
  if (d.orderLevel) {
    // تولیدِ همان گروه (سفارش‌های آن گروه) مبنای PPM قرار می‌گیرد
    rows = db.prepare(`
      WITH def AS (
        SELECT ${d.key} AS gkey, MAX(${labelExpr}) AS glabel, COALESCE(SUM(d.defect_qty),0) AS defects,
               COUNT(*) AS rows_count
        FROM ${view} d ${dw.sql}
        GROUP BY gkey
      ),
      ord AS (
        SELECT ${dkeyOrder} AS gkey, MAX(${dlabelOrder}) AS glabel, COALESCE(SUM(o.sound_qty),0) AS production
        FROM v_order o ${ow.sql} ${d.ordFilter || ''}
        GROUP BY gkey
      ),
      keys AS (SELECT gkey FROM def UNION SELECT gkey FROM ord)
      SELECT k.gkey AS key,
             COALESCE((SELECT glabel FROM def WHERE def.gkey = k.gkey),
                      (SELECT glabel FROM ord WHERE ord.gkey = k.gkey), k.gkey) AS label,
             COALESCE(def.defects,0)    AS defects,
             COALESCE(ord.production,0) AS production
      FROM keys k
      LEFT JOIN def ON def.gkey = k.gkey
      LEFT JOIN ord ON ord.gkey = k.gkey
      ORDER BY defects DESC, production DESC
      LIMIT ${limitNum}
    `).all({ ...dw.params, ...ow.params });
  } else {
    // ابعادِ وابسته به عیب: سهم هر مقدار از کل تولیدِ بازه (سهم از PPM کل)
    rows = db.prepare(`
      WITH def AS (
        SELECT ${d.key} AS gkey, MAX(${labelExpr}) AS glabel, COALESCE(SUM(d.defect_qty),0) AS defects,
               COUNT(*) AS rows_count
        FROM ${view} d ${dw.sql}
        GROUP BY gkey
      ),
      total AS (SELECT COALESCE(SUM(o.sound_qty),0) AS production FROM v_order o ${ow.sql})
      SELECT def.gkey AS key, def.glabel AS label, def.defects AS defects, def.rows_count AS rows_count,
             (SELECT production FROM total) AS production
      FROM def
      ORDER BY defects DESC
      LIMIT ${limitNum}
    `).all({ ...dw.params, ...ow.params });
  }

  const totalDefects = rows.reduce((s, r) => s + (r.defects || 0), 0);
  let cum = 0;
  return rows.map((r) => {
    cum += r.defects || 0;
    return {
      key: r.key,
      label: r.label,
      defects: r.defects,
      rows_count: r.rows_count ?? null,
      production: r.production,
      ppm: r.production > 0 ? (r.defects / r.production) * 1e6 : 0,
      pct: totalDefects ? (r.defects / totalDefects) * 100 : 0,
      cumPct: totalDefects ? (cum / totalDefects) * 100 : 0
    };
  });
}

// ---------------------------------------------------------------- جدول PFMEA / RPN
export function pfmea(f, limit = 50) {
  const db = getDb();
  const dw = defectWhere({ ...f, source: 'inprocess' }, 'd');
  const rows = db.prepare(`
    SELECT COALESCE(d.failure_mode,'ثبت نشده')                     AS failure_mode,
           COALESCE(d.failure_mode_type,'ثبت نشده')                AS failure_mode_type,
           COALESCE(d.process_name, d.station,'ثبت نشده')          AS process_name,
           COALESCE(d.station,'ثبت نشده')                          AS station,
           AVG(d.severity)                                         AS severity,
           AVG(d.occurrence)                                       AS occurrence,
           AVG(d.detection)                                        AS detection,
           AVG(d.rpn)                                              AS rpn_avg,
           MAX(d.rpn)                                              AS rpn_max,
           COUNT(*)                                                AS records,
           COALESCE(SUM(d.defect_qty),0)                           AS defects
    FROM v_inprocess d ${dw.sql} AND d.rpn IS NOT NULL
    GROUP BY failure_mode, failure_mode_type, process_name, station
    ORDER BY rpn_max DESC, defects DESC
    LIMIT ${Number(limit) || 50}
  `).all(dw.params);
  return rows;
}

// ---------------------------------------------------------------- رکوردهای تفصیلی
const RECORD_COLUMNS = {
  inprocess: {
    order_date: 'تاریخ',
    report: 'گزارش مبدا',
    product_name_dim: 'محصول',
    station: 'ایستگاه',
    process_domain: 'حوزه فرآیندی',
    defect_code: 'کد عیب',
    defect_desc: 'شرح عیب',
    defect_qty: 'تعداد عیب',
    cause_6m: 'عامل مسبب (6M)',
    failure_mode: 'حالت خرابی',
    part_name: 'قطعه',
    part_family: 'خانواده قطعه',
    supplier: 'تامین‌کننده',
    repair_action: 'اقدام تعمیرات',
    repair_desc: 'توضیحات تعمیرات',
    fix_time_min: 'زمان رفع عیب (دقیقه)',
    troubleshoot_time_min: 'زمان عیب‌یابی (دقیقه)',
    severity: 'شدت',
    occurrence: 'وقوع',
    detection: 'تشخیص',
    rpn: 'RPN',
    registrar: 'ثبت‌کننده',
    operator_name: 'اپراتور'
  },
  polymer: {
    order_date: 'تاریخ',
    product_name_dim: 'محصول',
    station: 'ایستگاه',
    shift: 'شیفت',
    defect_code: 'کد ایراد',
    defect_desc: 'شرح ایراد',
    defect_qty: 'تعداد عیب',
    repair_action: 'اقدام تعمیرات',
    repair_desc: 'توضیحات تعمیرات'
  },
  inspection: {
    order_date: 'تاریخ',
    report: 'گزارش مبدا',
    product_name_dim: 'محصول',
    station: 'ایستگاه',
    shift: 'شیفت',
    defect_code: 'کد ایراد',
    defect_desc: 'شرح ایراد',
    defect_qty: 'تعداد واحد معیوب',
    cause_6m: 'عامل مسبب (6M)',
    part_name: 'قطعه',
    supplier: 'تامین‌کننده',
    repair_action: 'اقدام تعمیرات',
    repair_desc: 'توضیحات تعمیرات',
    inspector: 'بازرس',
    operator_name: 'اپراتور'
  }
};

export function recordColumns(source) {
  return RECORD_COLUMNS[source] || RECORD_COLUMNS.inprocess;
}

export function records(f, source = 'inprocess', { page = 1, size = 50, sort = 'defect_qty', dir = 'DESC' } = {}) {
  const db = getDb();
  const view = viewFor(source);
  const dw = defectWhere({ ...f, source }, 'd');
  const cols = Object.keys(recordColumns(source));
  const safeSort = cols.includes(sort) ? sort : 'defect_qty';
  const safeDir = String(dir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(Number(size) || 50, 1), 500);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  // عبارت جست‌وجو بر اساس ستون‌های همان منبع
  const searchExpr = source === 'inprocess'
    ? ['d.order_no', "COALESCE(d.defect_desc,'')", "COALESCE(d.defect_code,'')",
       "COALESCE(d.part_name,'')", "COALESCE(d.repair_desc,'')", "COALESCE(d.product_name_dim,'')",
       "COALESCE(d.station,'')", "COALESCE(d.cause_6m,'')"]
    : ['d.order_no', "COALESCE(d.defect_desc,'')", "COALESCE(d.defect_code,'')",
       "COALESCE(d.product_name_dim,'')", "COALESCE(d.operation,'')", "COALESCE(d.station,'')"];

  const filterParams = { ...dw.params };
  let extra = '';
  if (f.q) {
    extra = ` AND (${searchExpr.map((c) => `${c} LIKE @q`).join(' OR ')})`;
    filterParams.q = `%${f.q}%`;
  }

  const whereSql = dw.sql ? `${dw.sql}${extra}` : `WHERE 1 = 1${extra}`;
  const rows = db.prepare(`
    SELECT ${cols.join(', ')} FROM ${view} d ${whereSql}
    ORDER BY d.${safeSort} ${safeDir} NULLS LAST
    LIMIT @limit OFFSET @offset
  `).all({ ...filterParams, limit, offset });
  const total = db.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(d.defect_qty),0) AS s FROM ${view} d ${whereSql}`).get(filterParams);
  return { rows, total: total.c, defectsSum: total.s, page: Math.max(Number(page) || 1, 1), size: limit };
}

// ---------------------------------------------------------------- تولید
export function productionSummary(f) {
  const db = getDb();
  const w = productionWhere(f, 'p');
  return db.prepare(`
    SELECT COUNT(*) AS docs,
           COALESCE(SUM(p.sound_qty),0)   AS production,
           COALESCE(SUM(p.scrap_qty),0)   AS scrap,
           COALESCE(SUM(p.personnel),0)   AS personnel,
           COUNT(DISTINCT p.product_code) AS products,
           COUNT(DISTINCT p.work_center)  AS work_centers
    FROM v_production p ${w.sql}
  `).get(w.params);
}

export function productionTrend(f, group = 'day') {
  const db = getDb();
  const g = DATE_GROUPS[group] || DATE_GROUPS.day;
  const w = productionWhere(f, 'p');
  const keyProd = g.keyProd || g.key;
  const rows = db.prepare(`
    SELECT ${keyProd} AS key,
           MIN(p.production_date) AS from_date,
           MAX(p.production_date) AS to_date,
           COALESCE(SUM(p.sound_qty),0) AS production,
           COALESCE(SUM(p.scrap_qty),0) AS scrap,
           COALESCE(SUM(p.personnel),0) AS personnel,
           COUNT(*) AS docs
    FROM v_production p JOIN dim_date d ON d.jdate = p.production_date ${w.sql ? w.sql.replace('WHERE', 'AND') : ''}
    GROUP BY key ORDER BY MIN(p.production_date)
  `).all(w.params);
  return rows;
}

const PROD_DIMS = {
  work_center:    { label: 'مرکز کاری',      key: "COALESCE(p.work_center,'نامشخص')" },
  process_domain: { label: 'حوزه فرآیندی',   key: "COALESCE(p.process_domain,'سایر')" },
  category:       { label: 'دسته محصول',     key: "COALESCE(p.category,'سایر')" },
  final_group:    { label: 'گروه محصول',     key: "COALESCE(p.final_group,'نامشخص')" },
  product:        { label: 'محصول',          key: "COALESCE(p.product_code,'نامشخص')", label2: "COALESCE(p.product_name_dim, p.product_code)" }
};

export function productionBreakdown(f, dim = 'work_center', limit = 30) {
  const db = getDb();
  const d = PROD_DIMS[dim] || PROD_DIMS.work_center;
  const w = productionWhere(f, 'p');
  const labelExpr = d.label2 || d.key;
  return db.prepare(`
    SELECT ${d.key} AS key, MAX(${labelExpr}) AS label,
           COALESCE(SUM(p.sound_qty),0) AS production,
           COALESCE(SUM(p.scrap_qty),0) AS scrap,
           COALESCE(SUM(p.personnel),0) AS personnel,
           COUNT(*) AS docs
    FROM v_production p ${w.sql}
    GROUP BY key ORDER BY production DESC LIMIT ${Number(limit) || 30}
  `).all(w.params);
}

// ---------------------------------------------------------------- فراداده و فهرست فیلترها
export function meta() {
  const db = getDb();
  const opt = (sql, params = {}) => db.prepare(sql).all(params)
    .map((r) => r.v).filter((v) => v !== null && v !== undefined && v !== '');

  const coverage = (table, col) => db.prepare(`
    SELECT MIN(${col}) AS a, MAX(${col}) AS b, COUNT(DISTINCT ${col}) AS n
    FROM ${table} WHERE ${col} IS NOT NULL`).get();

  return {
    categories: opt("SELECT DISTINCT category AS v FROM dim_product WHERE category IS NOT NULL ORDER BY category"),
    stages: opt("SELECT DISTINCT stage AS v FROM dim_product WHERE stage IS NOT NULL ORDER BY stage"),
    final_groups: opt("SELECT DISTINCT final_group AS v FROM dim_product WHERE final_group IS NOT NULL ORDER BY final_group"),
    product_families: opt("SELECT DISTINCT product_family AS v FROM dim_product WHERE product_family IS NOT NULL ORDER BY product_family"),
    product_combined: opt("SELECT DISTINCT product_combined AS v FROM dim_product WHERE product_combined IS NOT NULL ORDER BY product_combined"),
    stations: opt("SELECT DISTINCT station AS v FROM dim_station ORDER BY station"),
    process_domains: opt("SELECT DISTINCT process_domain AS v FROM dim_station WHERE process_domain IS NOT NULL ORDER BY process_domain"),
    work_centers: opt("SELECT DISTINCT work_center AS v FROM dim_workcenter ORDER BY work_center"),
    defect_groups: opt("SELECT DISTINCT defect_group AS v FROM dim_defect WHERE defect_group IS NOT NULL ORDER BY defect_group"),
    defects: db.prepare(`SELECT defect_code AS key, COALESCE(defect_desc, defect_code) AS label, defect_group AS grp
                         FROM dim_defect ORDER BY defect_code`).all(),
    cause_6m: opt("SELECT DISTINCT cause_6m AS v FROM fact_inprocess WHERE cause_6m IS NOT NULL ORDER BY cause_6m"),
    shifts: opt("SELECT DISTINCT shift AS v FROM fact_inspection WHERE shift IS NOT NULL ORDER BY shift"),
    repair_actions: opt("SELECT DISTINCT repair_action AS v FROM fact_inprocess WHERE repair_action IS NOT NULL ORDER BY repair_action"),
    suppliers: opt("SELECT DISTINCT supplier AS v FROM fact_inprocess WHERE supplier IS NOT NULL ORDER BY supplier"),
    part_families: opt("SELECT DISTINCT part_family AS v FROM fact_inprocess WHERE part_family IS NOT NULL ORDER BY part_family"),
    failure_modes: opt("SELECT DISTINCT failure_mode AS v FROM fact_inprocess WHERE failure_mode IS NOT NULL ORDER BY failure_mode"),
    operations: opt("SELECT DISTINCT operation AS v FROM fact_inspection WHERE operation IS NOT NULL ORDER BY operation"),
    coverage: {
      inprocess: coverage('fact_inprocess', 'order_date'),
      inspection: coverage('fact_inspection', 'order_date'),
      production: coverage('fact_production', 'production_date')
    },
    products: db.prepare(`SELECT product_code AS key, COALESCE(product_name, product_code) AS label, branch
                          FROM dim_product ORDER BY product_name, product_code`).all()
  };
}

// ---------------------------------------------------------------- جدول محوری (ماتریس)
export function matrix(f, source = 'inprocess', rowDim = 'defect', colDim = 'station', limitRows = 15, limitCols = 10) {
  const db = getDb();
  const view = viewFor(source);
  const r = DIMENSIONS[rowDim];
  const c = DIMENSIONS[colDim];
  if (!r || !c) return { rows: [], cols: [], cells: [] };
  if ((r.sources && !r.sources.includes(source)) || (c.sources && !c.sources.includes(source))) {
    return { rows: [], cols: [], cells: [] };
  }
  const dw = defectWhere({ ...f, source }, 'd');
  const rowLabel = r.label2 || r.key;
  const colLabel = c.label2 || c.key;

  const topRows = db.prepare(`
    SELECT ${r.key} AS k, MAX(${rowLabel}) AS lbl, COALESCE(SUM(d.defect_qty),0) AS q
    FROM ${view} d ${dw.sql} GROUP BY k ORDER BY q DESC LIMIT ${Number(limitRows) || 15}
  `).all(dw.params).map((x) => x.k);

  const topCols = db.prepare(`
    SELECT ${c.key} AS k, MAX(${colLabel}) AS lbl, COALESCE(SUM(d.defect_qty),0) AS q
    FROM ${view} d ${dw.sql} GROUP BY k ORDER BY q DESC LIMIT ${Number(limitCols) || 10}
  `).all(dw.params).map((x) => x.k);

  if (!topRows.length || !topCols.length) return { rows: [], cols: [], cells: [] };

  const rowNamedParams = { ...dw.params };
  const colNamedParams = { ...dw.params };
  const namedParams = { ...dw.params };
  topRows.forEach((v, i) => { rowNamedParams[`r${i}`] = v; namedParams[`r${i}`] = v; });
  topCols.forEach((v, i) => { colNamedParams[`c${i}`] = v; namedParams[`c${i}`] = v; });
  const rowNamed = topRows.map((_, i) => `@r${i}`).join(',');
  const colNamed = topCols.map((_, i) => `@c${i}`).join(',');
  const cells2 = db.prepare(`
    SELECT ${r.key} AS rk, ${c.key} AS ck, COALESCE(SUM(d.defect_qty),0) AS q
    FROM ${view} d ${dw.sql} AND ${r.key} IN (${rowNamed}) AND ${c.key} IN (${colNamed})
    GROUP BY rk, ck
  `).all(namedParams);

  // برای هر پرس‌وجو فقط پارامترهای همان پرس‌وجو فرستاده می‌شود
  const rowParams = { ...rowNamedParams };
  const colParams = { ...colNamedParams };
  const rowsInfo = db.prepare(`
    SELECT ${r.key} AS k, MAX(${rowLabel}) AS lbl FROM ${view} d ${dw.sql} AND ${r.key} IN (${rowNamed}) GROUP BY k
  `).all(rowParams);
  const colsInfo = db.prepare(`
    SELECT ${c.key} AS k, MAX(${colLabel}) AS lbl FROM ${view} d ${dw.sql} AND ${c.key} IN (${colNamed}) GROUP BY k
  `).all(colParams);

  return {
    rows: rowsInfo.map((x) => ({ key: x.k, label: x.lbl || x.k })),
    cols: colsInfo.map((x) => ({ key: x.k, label: x.lbl || x.k })),
    cells: cells2.map((x) => ({ r: x.rk, c: x.ck, v: x.q }))
  };
}

// ---------------------------------------------------------------- زمان‌های صرف‌شده
export function times(f, dim = 'station', limit = 15) {
  const db = getDb();
  const d = DIMENSIONS[dim] || DIMENSIONS.station;
  const dw = defectWhere({ ...f, source: 'inprocess' }, 'd');
  const labelExpr = d.label2 || d.key;
  return db.prepare(`
    SELECT ${d.key} AS key, MAX(${labelExpr}) AS label,
           COALESCE(SUM(d.fix_time_min),0)          AS fix_min,
           COALESCE(SUM(d.retest_time_min),0)       AS retest_min,
           COALESCE(SUM(d.troubleshoot_time_min),0) AS troubleshoot_min,
           COALESCE(SUM(d.defect_qty),0)            AS defects,
           COUNT(*)                                 AS records
    FROM v_inprocess d ${dw.sql}
    GROUP BY key
    ORDER BY (COALESCE(SUM(d.fix_time_min),0) + COALESCE(SUM(d.retest_time_min),0) + COALESCE(SUM(d.troubleshoot_time_min),0)) DESC
    LIMIT ${Number(limit) || 15}
  `).all(dw.params);
}

// ---------------------------------------------------------------- تحلیل گام‌به‌گام (دریل‌داون)
/**
 * درخت تحلیل: روز → محصول → کد عیب → ریز رکوردها.
 * هدف: پاسخ به این پرسش که «در این تاریخ، کدام محصول، با کدام عیب و چه تعداد،
 * در برابر چه مقدار تولید، چه اقدام تعمیراتی روی کدام قطعه و با کدام ریشه 6M
 * داشته و تعمیرات چه توضیحی ثبت کرده است».
 */
export function drillTree(f, source = 'inprocess') {
  const db = getDb();
  const view = viewFor(source);
  const dw = defectWhere({ ...f, source }, 'd');
  const ow = orderWhere(f, 'o');

  // ستون‌هایی که فقط در برخی منابع وجود دارند (مثل شیفت در اسناد بازرسی)
  const hasCols = {
    inprocess: { shift: false, operation: false },
    inspection: { shift: true, operation: true },
    polymer: { shift: true, operation: true }
  }[source] || { shift: false, operation: false };
  const shiftExpr = hasCols.shift ? "COALESCE(d.shift, '')" : "''";
  const operationExpr = hasCols.operation ? "COALESCE(d.operation, '')" : "''";

  const rows = db.prepare(`
    SELECT d.order_date                                   AS date,
           d.product_code                                 AS code,
           COALESCE(d.product_name_dim, d.product_code)   AS name,
           COALESCE(d.stage, 'سایر')                      AS stage,
           COALESCE(d.station, 'نامشخص')                  AS station,
           COALESCE(d.defect_code, 'نامشخص')              AS defect_code,
           COALESCE(d.defect_desc, '')                    AS defect_desc,
           COALESCE(d.defect_qty, 0)                      AS qty,
           COALESCE(d.cause_6m, '')                       AS cause_6m,
           COALESCE(d.failure_mode, '')                   AS failure_mode,
           COALESCE(d.part_code, '')                      AS part_code,
           COALESCE(d.part_name, '')                      AS part_name,
           COALESCE(d.part_family, '')                    AS part_family,
           COALESCE(d.supplier, '')                       AS supplier,
           COALESCE(d.repair_action, '')                  AS repair_action,
           COALESCE(d.repair_desc, '')                    AS repair_desc,
           COALESCE(d.fix_time_min, 0)                    AS fix_min,
           COALESCE(d.troubleshoot_time_min, 0)           AS troubleshoot_min,
           COALESCE(d.retest_time_min, 0)                 AS retest_min,
           ${shiftExpr}                                   AS shift,
           ${operationExpr}                               AS operation,
           COALESCE(d.report, '')                         AS report
    FROM ${view} d ${dw.sql}
    ORDER BY d.order_date, d.product_code, d.defect_code
  `).all(dw.params);

  // تولید به تفکیک روز (مخرج PPMِ روز)
  const prodDay = new Map();
  for (const r of db.prepare(`
    SELECT o.order_date AS date, COALESCE(SUM(o.sound_qty), 0) AS production
    FROM v_order o ${ow.sql} GROUP BY o.order_date`).all(ow.params)) {
    prodDay.set(r.date, r.production);
  }
  // تولید به تفکیک روز + محصول
  const prodDayProduct = new Map();
  for (const r of db.prepare(`
    SELECT o.order_date AS date, o.product_code AS code, COALESCE(SUM(o.sound_qty), 0) AS production
    FROM v_order o ${ow.sql} GROUP BY o.order_date, o.product_code`).all(ow.params)) {
    prodDayProduct.set(`${r.date}|${r.code}`, r.production);
  }

  const days = new Map();
  for (const r of rows) {
    const date = r.date || 'نامشخص';
    if (!days.has(date)) {
      days.set(date, {
        date,
        defects: 0,
        records: 0,
        production: prodDay.get(date) || 0,
        products: new Map()
      });
    }
    const day = days.get(date);
    day.defects += r.qty || 0;
    day.records += 1;

    if (!day.products.has(r.code)) {
      day.products.set(r.code, {
        code: r.code,
        name: r.name,
        stage: r.stage,
        defects: 0,
        records: 0,
        production: prodDayProduct.get(`${date}|${r.code}`) || 0,
        defectList: new Map()
      });
    }
    const product = day.products.get(r.code);
    product.defects += r.qty || 0;
    product.records += 1;

    if (!product.defectList.has(r.defect_code)) {
      product.defectList.set(r.defect_code, {
        code: r.defect_code,
        desc: r.defect_desc,
        qty: 0,
        records: 0,
        rows: []
      });
    }
    const defect = product.defectList.get(r.defect_code);
    defect.qty += r.qty || 0;
    defect.records += 1;
    defect.rows.push({
      station: r.station,
      shift: r.shift,
      operation: r.operation,
      report: r.report,
      qty: r.qty,
      part_code: r.part_code,
      part_name: r.part_name,
      part_family: r.part_family,
      supplier: r.supplier,
      repair_action: r.repair_action,
      repair_desc: r.repair_desc,
      cause_6m: r.cause_6m,
      failure_mode: r.failure_mode,
      fix_min: r.fix_min,
      troubleshoot_min: r.troubleshoot_min,
      retest_min: r.retest_min
    });
  }

  const dayList = [...days.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let totalDefects = 0;
  let totalRecords = 0;
  const out = dayList.map((day) => {
    totalDefects += day.defects;
    totalRecords += day.records;
    const products = [...day.products.values()]
      .sort((a, b) => b.defects - a.defects)
      .map((p) => ({
        ...p,
        ppm: p.production > 0 ? (p.defects / p.production) * 1e6 : 0,
        defectList: [...p.defectList.values()].sort((a, b) => b.qty - a.qty)
      }));
    return {
      ...day,
      products,
      ppm: day.production > 0 ? (day.defects / day.production) * 1e6 : 0
    };
  });

  // تولیدِ کلِ بازه (مطابق شاخص‌های اصلی) — مبنای PPM در سطح اول
  const rangeProduction = db.prepare(
    `SELECT COALESCE(SUM(o.sound_qty),0) AS production FROM v_order o ${ow.sql}`).get(ow.params).production || 0;
  const totalProduction = rangeProduction;
  return {
    source,
    from: f.from || null,
    to: f.to || null,
    totals: {
      days: out.length,
      defects: totalDefects,
      records: totalRecords,
      production: totalProduction,
      ppm: totalProduction > 0 ? (totalDefects / totalProduction) * 1e6 : 0
    },
    days: out
  };
}
