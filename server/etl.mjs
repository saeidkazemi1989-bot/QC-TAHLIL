/**
 * بارگذاری داده‌های اکسل به پایگاه داده
 * ---------------------------------------------------------------
 * هر فایل اکسل موجود در پوشه data/raw بر اساس نام ستون‌هایش شناسایی
 * می‌شود و به یکی از جداول مقصد می‌رود:
 *   - اطلاعات جامع کیفیت حین تولید  -> fact_inprocess
 *   - گزارش عیب‌های سند بازرسی      -> fact_inspection
 *   - گزارش تعداد تولید             -> fact_production
 *   - گروه‌بندی محصولات             -> dim_product
 *
 * بارگذاری idempotent است: هر بار اجرا، ردیف‌های همان فایل پاک و از نو
 * درج می‌شوند؛ بنابراین گذاشتن فایل جدید در پوشه و اجرای مجدد، داده را
 * به‌روز می‌کند بدون ایجاد تکرار.
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { getDb, ready as dbReady, ensureDate, buildCalendar, RAW_DIR, CLEAN_DIR } from './db.mjs';
import { parseJalali, toEn, gregorianToJalali, formatJalali } from './jalali.mjs';

const log = (...a) => console.log('[ETL]', ...a);

// ---------------------------------------------------------------- ابزارها
function normalizeText(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');      // کاراکترهای نامرئی
  s = s.replace(/[أإ]/g, 'ا').replace(/ي/g, 'ی')
       .replace(/ك/g, 'ک').replace(/ة/g, 'ه')
       .replace(/ؤ/g, 'و');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function toNum(v) {
  v = unwrapCell(v);
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return null;
  const s = toEn(String(v)).replace(/[,،\s]/g, '');
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toStr(v) {
  const s = normalizeText(v);
  return s === '' ? null : s;
}

function toJdate(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const j = gregorianToJalali(v.getFullYear(), v.getMonth() + 1, v.getDate());
    return formatJalali(j.jy, j.jm, j.jd);
  }
  const p = parseJalali(v);
  return p ? p.jdate : null;
}

/** نگاشت ستون‌ها: نام نرمال‌شده -> ایندکس */
function headerIndex(headerRow) {
  const map = new Map();
  (headerRow || []).forEach((h, i) => {
    const n = normalizeText(h);
    if (n && !map.has(n)) map.set(n, i);
  });
  return map;
}

/** پیدا کردن ستون با چند نام جایگزین */
function findCol(idx, names) {
  for (const n of names) {
    const key = normalizeText(n);
    if (idx.has(key)) return idx.get(key);
  }
  // جستجوی تقریبی (شاملِ عبارت)
  for (const n of names) {
    const key = normalizeText(n);
    for (const [h, i] of idx.entries()) {
      if (h.includes(key) || key.includes(h)) return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------- طبقه‌بندی
const DEFECT_GROUPS = [
  { group: 'لحیم‌کاری و قطعه‌گذاری', prefixes: ['SS', 'TS', 'SI', 'SL', 'SD'] },
  { group: 'ظاهری', prefixes: ['IP'] },
  { group: 'عملکردی / تست نهایی', prefixes: ['PD', 'MF', 'BC', 'HW', 'AW', 'RW', 'ECU', 'FTD', 'FD'] },
  { group: 'تست مداری (ICT)', prefixes: ['ICT'] },
  { group: 'چاپ و تزریق (پلیمر)', prefixes: ['AD'] }
];

function defectGroup(code) {
  if (!code) return 'نامشخص';
  // ضایعاتِ ثبت‌شده در سند عملکرد (مخصوص شیت پلیمر) کد لاتین ندارد
  if (String(code).startsWith('ضایعات')) return 'ضایعات تولید';
  const c = String(code).toUpperCase().replace(/[^A-Z]/g, '');
  for (const g of DEFECT_GROUPS) {
    if (g.prefixes.some((p) => c.startsWith(p))) return g.group;
  }
  return 'سایر';
}

/** طبقه‌بندی ایستگاه/مرکز کاری به حوزه فرآیندی */
const DOMAIN_RULES = [
  { domain: 'SMD', kw: ['سامسونگ', 'میرایی', 'SMD'] },
  { domain: 'وان قلع و QV', kw: ['وان قلع', 'قلع و کنترل'] },
  { domain: 'تزریق پلاستیک', kw: ['اشتهارد', 'تزریق'] },
  { domain: 'ICT', kw: ['تکمیل کاری نود', 'تست و کنترل ECU', 'ICT'] },
  { domain: 'کنترل نهایی', kw: ['کنترل نهایی', 'کنترل  نهایی'] },
  { domain: 'OQC و بسته‌بندی', kw: ['بسته بندی', 'بسته‌بندی'] },
  { domain: 'مونتاژ و تکمیل کاری', kw: ['مونتاژ', 'تکمیل کاری', 'مجموعه سازی', 'مجموعه ی'] },
  { domain: 'آزمون و تست محصول', kw: ['تست', 'فلش', 'آزمایش'] }
];

function stationDomain(name) {
  const n = normalizeText(name);
  if (!n) return 'سایر';
  for (const r of DOMAIN_RULES) {
    if (r.kw.some((k) => n.includes(normalizeText(k)))) return r.domain;
  }
  return 'سایر';
}

function stationBranch(name) {
  const n = normalizeText(name);
  if (n.includes('اشتهارد') || n.includes('تزریق')) return 'POL';
  return 'نامشخص';
}

// ---------------------------------------------------------------- خواندن فایل
async function readSheet(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets.find((s) => s.rowCount > 0) || wb.worksheets[0];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    rows.push({ n: rowNumber, values: row.values });
  });
  if (!rows.length) return { headers: [], rows: [] };
  const headerRow = rows[0].values.slice(1);
  const idx = headerIndex(headerRow);
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    const vals = rows[i].values.slice(1);
    out.push({ rowNumber: rows[i].n, get: (colIdx) => (colIdx >= 0 ? vals[colIdx] : undefined) });
  }
  return { headers: headerRow.map(normalizeText), idx, rows: out, sheetName: ws.name };
}

function detectType(headers) {
  const h = new Set(headers.map(normalizeText));
  const has = (...names) => names.some((n) => h.has(normalizeText(n)));
  if (has('Mعامل مسبب 6', 'M عامل مسبب 6', 'عامل مسبب ایراد 6M') && has('کد عیب', 'تعداد عیب')) return 'inprocess';
  if (has('عنوان عملیات آزمایش') || (has('کد ایراد') && has('تعداد ایراد'))) return 'inspection';
  if (has('تعداد پرسنل تولید', 'تعداد پرسنل') && has('مرکز کاری')) return 'production';
  if (has('برنچ') && has('کد گروه محصول')) return 'product';
  if (has('تعداد عیب') && has('ایستگاه')) return 'inprocess';
  return null;
}

// ---------------------------------------------------------------- واردکننده‌ها
function markImport(db, fileName, sourceType, rowsIn, rowsLoaded, status, message, size) {
  db.prepare(`
    INSERT INTO import_file (file_name, source_type, rows_in, rows_loaded, status, message, file_size, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_name, source_type) DO UPDATE SET
      rows_in = excluded.rows_in, rows_loaded = excluded.rows_loaded, status = excluded.status,
      message = excluded.message, file_size = excluded.file_size, imported_at = excluded.imported_at
  `).run(fileName, sourceType, rowsIn, rowsLoaded, status || 'ok', message || null, size || null, new Date().toISOString());
}

async function importInprocess(db, filePath, fileName) {
  const { headers, idx, rows } = await readSheet(filePath);
  const c = {
    scrap: findCol(idx, ['مقدار ضایعات']),
    sound: findCol(idx, ['مقدار سالم']),
    defectQty: findCol(idx, ['تعداد عیب']),
    relatedQty: findCol(idx, ['تعداد عیب مربوطه']),
    defectDesc: findCol(idx, ['شرح عیب']),
    defectCode: findCol(idx, ['کد عیب']),
    fixTime: findCol(idx, ['مدت زمان رفع عیب دقیقه']),
    retestTime: findCol(idx, ['مدت زمان تست مجدد دقیقه']),
    troubleshootTime: findCol(idx, ['مدت زمان عیب یابی دقیقه']),
    occurrence: findCol(idx, ['وقوع قدیمی']),
    detection: findCol(idx, ['تشخیص حالت خرابی']),
    severity: findCol(idx, ['شدت حالت خرابی']),
    failureType: findCol(idx, ['نوع حالت خرابی بلقوه']),
    failureMode: findCol(idx, ['حالت خرابی بلقوه']),
    mainStation: findCol(idx, ['ایستگاه اصلی']),
    processName: findCol(idx, ['نام فرآیند OPC', 'نام فرایند OPC']),
    processCode: findCol(idx, ['کد فرایند', 'کد فرآیند']),
    cause6m: findCol(idx, ['Mعامل مسبب 6', 'M عامل مسبب 6', 'عامل مسبب ایراد 6M']),
    registrar: findCol(idx, ['یوزر ثبات ریز اطلاعات']),
    supplier: findCol(idx, ['نام تامین کننده']),
    tool: findCol(idx, ['کد و نام ابزارآلات و تجهیزات']),
    location: findCol(idx, ['جانمایی']),
    partName: findCol(idx, ['نام قطعه']),
    partCode: findCol(idx, ['کد قطعه']),
    partFamily: findCol(idx, ['خانواده قطعات']),
    inspector: findCol(idx, ['بازرس مسبب ایراد']),
    operator: findCol(idx, ['اپراتور مسبب ایراد']),
    repairDesc: findCol(idx, ['توضیحات تعمیرات']),
    repairAction: findCol(idx, ['شرح فعالیت انجام شده توسط تعمیرات']),
    stationGroup: findCol(idx, ['ایستگاه کاری گروهبندی']),
    station: findCol(idx, ['ایستگاه']),
    productName: findCol(idx, ['نام محصول']),
    productCode: findCol(idx, ['کد محصول']),
    orderDate: findCol(idx, ['تاریخ سفارش']),
    orderNo: findCol(idx, ['شماره سفارش تولید'])
  };

  db.prepare('DELETE FROM fact_inprocess WHERE src_file = ?').run(fileName);
  const ins = db.prepare(`
    INSERT INTO fact_inprocess
      (src_file, src_row, order_no, order_date, product_code, product_name, station, station_group, process_name, process_code,
       defect_code, defect_desc, defect_qty, related_defect_qty, scrap_qty, sound_qty,
       fix_time_min, retest_time_min, troubleshoot_time_min, cause_6m, failure_mode, failure_mode_type,
       severity, occurrence, detection, rpn, part_code, part_name, part_family, supplier, tool, location,
       repair_action, repair_desc, inspector, operator_name, registrar)
    VALUES
      (@src_file, @src_row, @order_no, @order_date, @product_code, @product_name, @station, @station_group, @process_name, @process_code,
       @defect_code, @defect_desc, @defect_qty, @related_defect_qty, @scrap_qty, @sound_qty,
       @fix_time_min, @retest_time_min, @troubleshoot_time_min, @cause_6m, @failure_mode, @failure_mode_type,
       @severity, @occurrence, @detection, @rpn, @part_code, @part_name, @part_family, @supplier, @tool, @location,
       @repair_action, @repair_desc, @inspector, @operator_name, @registrar)
  `);

  let loaded = 0;
  const tx = db.transaction((list) => {
    for (const r of list) {
      const orderNo = toStr(r.get(c.orderNo));
      const severity = toNum(r.get(c.severity));
      const occurrence = toNum(r.get(c.occurrence));
      const detection = toNum(r.get(c.detection));
      const rpn = (severity !== null && occurrence !== null && detection !== null)
        ? severity * occurrence * detection : null;
      ins.run({
        src_file: fileName,
        src_row: r.rowNumber,
        order_no: orderNo,
        order_date: toJdate(r.get(c.orderDate)),
        product_code: toStr(r.get(c.productCode)),
        product_name: toStr(r.get(c.productName)),
        station: toStr(r.get(c.station)) || toStr(r.get(c.mainStation)),
        station_group: toStr(r.get(c.stationGroup)),
        process_name: toStr(r.get(c.processName)),
        process_code: toStr(r.get(c.processCode)),
        defect_code: toStr(r.get(c.defectCode)),
        defect_desc: toStr(r.get(c.defectDesc)),
        defect_qty: toNum(r.get(c.defectQty)),
        related_defect_qty: toNum(r.get(c.relatedQty)),
        scrap_qty: toNum(r.get(c.scrap)),
        sound_qty: toNum(r.get(c.sound)),
        fix_time_min: toNum(r.get(c.fixTime)),
        retest_time_min: toNum(r.get(c.retestTime)),
        troubleshoot_time_min: toNum(r.get(c.troubleshootTime)),
        cause_6m: toStr(r.get(c.cause6m)),
        failure_mode: toStr(r.get(c.failureMode)),
        failure_mode_type: toStr(r.get(c.failureType)),
        severity, occurrence, detection, rpn,
        part_code: toStr(r.get(c.partCode)),
        part_name: toStr(r.get(c.partName)),
        part_family: toStr(r.get(c.partFamily)),
        supplier: toStr(r.get(c.supplier)),
        tool: toStr(r.get(c.tool)),
        location: toStr(r.get(c.location)),
        repair_action: toStr(r.get(c.repairAction)),
        repair_desc: toStr(r.get(c.repairDesc)),
        inspector: toStr(r.get(c.inspector)),
        operator_name: toStr(r.get(c.operator)),
        registrar: toStr(r.get(c.registrar))
      });
      loaded += 1;
    }
  });
  tx(rows);
  return { rowsIn: rows.length, rowsLoaded: loaded };
}

async function importInspection(db, filePath, fileName) {
  const { idx, rows } = await readSheet(filePath);
  const c = {
    orderNo: findCol(idx, ['شماره سفارش تولید']),
    orderDate: findCol(idx, ['تاریخ سفارش']),
    shift: findCol(idx, ['شیفت']),
    productCode: findCol(idx, ['کد محصول']),
    productName: findCol(idx, ['نام محصول']),
    planned: findCol(idx, ['مقدار کل برنامه ریزی شده']),
    sound: findCol(idx, ['مقدار سالم ثبت عملکرد']),
    scrap: findCol(idx, ['مقدار ضایعات ثبت عملکرد']),
    operation: findCol(idx, ['عنوان عملیات آزمایش']),
    defectCode: findCol(idx, ['کد ایراد']),
    defectDesc: findCol(idx, ['شرح ایراد']),
    defectQty: findCol(idx, ['تعداد ایراد']),
    station: findCol(idx, ['ایستگاه'])
  };

  db.prepare('DELETE FROM fact_inspection WHERE src_file = ?').run(fileName);
  const ins = db.prepare(`
    INSERT INTO fact_inspection
      (src_file, src_row, order_no, order_date, shift, product_code, product_name, station, operation,
       planned_qty, sound_qty, scrap_qty, defect_code, defect_desc, defect_qty, op_seq)
    VALUES
      (@src_file, @src_row, @order_no, @order_date, @shift, @product_code, @product_name, @station, @operation,
       @planned_qty, @sound_qty, @scrap_qty, @defect_code, @defect_desc, @defect_qty, 1)
  `);

  let loaded = 0;
  const tx = db.transaction((list) => {
    for (const r of list) {
      ins.run({
        src_file: fileName,
        src_row: r.rowNumber,
        order_no: toStr(r.get(c.orderNo)),
        order_date: toJdate(r.get(c.orderDate)),
        shift: toStr(r.get(c.shift)),
        product_code: toStr(r.get(c.productCode)),
        product_name: toStr(r.get(c.productName)),
        station: toStr(r.get(c.station)),
        operation: toStr(r.get(c.operation)),
        planned_qty: toNum(r.get(c.planned)),
        sound_qty: toNum(r.get(c.sound)),
        scrap_qty: toNum(r.get(c.scrap)),
        defect_code: toStr(r.get(c.defectCode)),
        defect_desc: toStr(r.get(c.defectDesc)),
        defect_qty: toNum(r.get(c.defectQty))
      });
      loaded += 1;
    }
  });
  tx(rows);
  return { rowsIn: rows.length, rowsLoaded: loaded };
}

async function importProduction(db, filePath, fileName) {
  const { idx, rows } = await readSheet(filePath);
  const c = {
    productCode: findCol(idx, ['کد کالا']),
    productName: findCol(idx, ['نام کالا']),
    workCenter: findCol(idx, ['مرکز کاری']),
    sound: findCol(idx, ['مقدار سالم']),
    scrap: findCol(idx, ['مقدار ضایعات']),
    date: findCol(idx, ['تاریخ تولید']),
    personnel: findCol(idx, ['تعداد پرسنل تولید', 'تعداد پرسنل'])
  };

  db.prepare('DELETE FROM fact_production WHERE src_file = ?').run(fileName);
  const ins = db.prepare(`
    INSERT INTO fact_production
      (src_file, src_row, production_date, product_code, product_name, work_center, sound_qty, scrap_qty, personnel)
    VALUES (@src_file, @src_row, @production_date, @product_code, @product_name, @work_center, @sound_qty, @scrap_qty, @personnel)
  `);

  let loaded = 0;
  const tx = db.transaction((list) => {
    for (const r of list) {
      const jdate = toJdate(r.get(c.date));
      if (!jdate) continue;
      ins.run({
        src_file: fileName,
        src_row: r.rowNumber,
        production_date: jdate,
        product_code: toStr(r.get(c.productCode)),
        product_name: toStr(r.get(c.productName)),
        work_center: toStr(r.get(c.workCenter)),
        sound_qty: toNum(r.get(c.sound)),
        scrap_qty: toNum(r.get(c.scrap)),
        personnel: toNum(r.get(c.personnel))
      });
      loaded += 1;
    }
  });
  tx(rows);
  return { rowsIn: rows.length, rowsLoaded: loaded };
}

async function importProducts(db, filePath, fileName) {
  const { idx, rows } = await readSheet(filePath);
  const c = {
    groupCode: findCol(idx, ['کد گروه محصول']),
    fullName: findCol(idx, ['کد محصول']),
    name: findCol(idx, ['نام محصول']),
    family: findCol(idx, ['خانواده محصول']),
    combined: findCol(idx, ['نام محصول ترکیبی']),
    finalGroup: findCol(idx, ['گروه محصول نهایی']),
    branch: findCol(idx, ['برنچ'])
  };

  const ins = db.prepare(`
    INSERT INTO dim_product (product_code, product_name, product_full, product_family, product_combined, final_group, branch)
    VALUES (@product_code, @product_name, @product_full, @product_family, @product_combined, @final_group, @branch)
    ON CONFLICT(product_code) DO UPDATE SET
      product_name = COALESCE(dim_product.product_name, excluded.product_name),
      product_full = COALESCE(dim_product.product_full, excluded.product_full),
      product_family = COALESCE(dim_product.product_family, excluded.product_family),
      product_combined = COALESCE(dim_product.product_combined, excluded.product_combined),
      final_group = COALESCE(dim_product.final_group, excluded.final_group),
      branch = COALESCE(dim_product.branch, excluded.branch)
  `);

  let loaded = 0;
  let skipped = 0;
  const tx = db.transaction((list) => {
    for (const r of list) {
      const code = toStr(r.get(c.groupCode));
      if (!code) { skipped += 1; continue; }
      ins.run({
        product_code: code,
        product_name: toStr(r.get(c.name)),
        product_full: toStr(r.get(c.fullName)),
        product_family: toStr(r.get(c.family)),
        product_combined: toStr(r.get(c.combined)),
        final_group: toStr(r.get(c.finalGroup)),
        branch: toStr(r.get(c.branch))
      });
      loaded += 1;
    }
  });
  tx(rows);
  return { rowsIn: rows.length, rowsLoaded: loaded, message: skipped ? `${skipped} ردیف بدون کد محصول نادیده گرفته شد` : null };
}

// ---------------------------------------------------------------- بازسازی ابعاد و وابستگی‌ها
function rebuildDims(db) {
  // کدهای عیب
  db.exec(`
    INSERT INTO dim_defect (defect_code, defect_desc, defect_group)
    SELECT code, MAX(descr), 'سایر' FROM (
      SELECT defect_code AS code, defect_desc AS descr FROM fact_inprocess WHERE defect_code IS NOT NULL
      UNION ALL
      SELECT defect_code AS code, defect_desc AS descr FROM fact_inspection WHERE defect_code IS NOT NULL
    ) GROUP BY code
    ON CONFLICT(defect_code) DO UPDATE SET defect_desc = COALESCE(dim_defect.defect_desc, excluded.defect_desc);
  `);
  const upd = db.prepare('UPDATE dim_defect SET defect_group = ? WHERE defect_code = ?');
  for (const row of db.prepare('SELECT defect_code FROM dim_defect').all()) {
    upd.run(defectGroup(row.defect_code), row.defect_code);
  }

  // ایستگاه‌ها
  db.exec(`
    INSERT INTO dim_station (station, process_domain, branch)
    SELECT st, 'سایر', 'نامشخص' FROM (
      SELECT station AS st FROM fact_inprocess WHERE station IS NOT NULL
      UNION SELECT station FROM fact_inspection WHERE station IS NOT NULL
      UNION SELECT station FROM fact_order WHERE station IS NOT NULL
    ) GROUP BY st
    ON CONFLICT(station) DO NOTHING;
  `);
  const updSt = db.prepare('UPDATE dim_station SET process_domain = ?, branch = ? WHERE station = ?');
  for (const row of db.prepare('SELECT station FROM dim_station').all()) {
    updSt.run(stationDomain(row.station), stationBranch(row.station), row.station);
  }

  // مراکز کاری
  db.exec(`
    INSERT INTO dim_workcenter (work_center, process_domain, branch)
    SELECT work_center, 'سایر', 'نامشخص' FROM fact_production WHERE work_center IS NOT NULL GROUP BY work_center
    ON CONFLICT(work_center) DO NOTHING;
  `);
  const updWc = db.prepare('UPDATE dim_workcenter SET process_domain = ?, branch = ? WHERE work_center = ?');
  for (const row of db.prepare('SELECT work_center FROM dim_workcenter').all()) {
    updWc.run(stationDomain(row.work_center), stationBranch(row.work_center), row.work_center);
  }

  // محصولاتِ فاقد کد در فایل گروه‌بندی
  db.exec(`
    INSERT INTO dim_product (product_code, product_name, branch)
    SELECT pc, MAX(pn), 'نامشخص' FROM (
      SELECT product_code AS pc, product_name AS pn FROM fact_inprocess WHERE product_code IS NOT NULL
      UNION ALL SELECT product_code, product_name FROM fact_inspection WHERE product_code IS NOT NULL
      UNION ALL SELECT product_code, product_name FROM fact_production WHERE product_code IS NOT NULL
    ) GROUP BY pc
    ON CONFLICT(product_code) DO NOTHING;
  `);

  // تکمیل نام محصول از روی داده‌های واقعیت
  db.exec(`
    UPDATE dim_product SET product_name = (
      SELECT MAX(pn) FROM (
        SELECT product_code pc, product_name pn FROM fact_inprocess WHERE product_name IS NOT NULL
        UNION ALL SELECT product_code, product_name FROM fact_inspection WHERE product_name IS NOT NULL
        UNION ALL SELECT product_code, product_name FROM fact_production WHERE product_name IS NOT NULL
      ) x WHERE x.pc = dim_product.product_code
    ) WHERE product_name IS NULL;
  `);

  // تطبیق بر اساس نام: برای کدهایی که در فایل گروه‌بندی نبودند ولی نامشان هست
  db.exec(`
    UPDATE dim_product
    SET branch = COALESCE((SELECT p2.branch FROM dim_product p2
                           WHERE p2.product_name = dim_product.product_name AND p2.branch IS NOT 'نامشخص' LIMIT 1), branch),
        final_group = COALESCE((SELECT p2.final_group FROM dim_product p2
                           WHERE p2.product_name = dim_product.product_name AND p2.final_group IS NOT NULL LIMIT 1), final_group),
        product_family = COALESCE((SELECT p2.product_family FROM dim_product p2
                           WHERE p2.product_name = dim_product.product_name AND p2.product_family IS NOT NULL LIMIT 1), product_family),
        product_combined = COALESCE((SELECT p2.product_combined FROM dim_product p2
                           WHERE p2.product_name = dim_product.product_name AND p2.product_combined IS NOT NULL LIMIT 1), product_combined)
    WHERE branch IS 'نامشخص' AND product_name IS NOT NULL;
  `);

  // استنتاج برنچ بر اساس ایستگاه غالب محصول
  const unknown = db.prepare("SELECT product_code FROM dim_product WHERE branch IS NULL OR branch = 'نامشخص'").all();
  const domStation = db.prepare(`
    SELECT station FROM (
      SELECT station, COUNT(*) n FROM (
        SELECT station FROM fact_inprocess WHERE product_code = ? AND station IS NOT NULL
        UNION ALL SELECT station FROM fact_inspection WHERE product_code = ? AND station IS NOT NULL
        UNION ALL SELECT work_center FROM fact_production WHERE product_code = ? AND work_center IS NOT NULL
      ) GROUP BY station ORDER BY n DESC LIMIT 1
    )`);
  const updBranch = db.prepare('UPDATE dim_product SET branch = ? WHERE product_code = ?');
  for (const row of unknown) {
    const st = domStation.get(row.product_code, row.product_code, row.product_code);
    if (st && st.station) {
      const b = branchFromStation(st.station);
      if (b) updBranch.run(b, row.product_code);
    }
  }
}

/** حدس برنچ بر اساس نام ایستگاه/مرکز کاری */
function branchFromStation(name) {
  const n = normalizeText(name);
  if (!n) return null;
  if (n.includes('اشتهارد') || n.includes('تزریق')) return 'POL';
  if (['سامسونگ', 'میرایی', 'وان قلع', 'جلوآمپر', 'جلو آمپر', 'کلید', 'دایال', 'نود', 'بسته بندی'].some((k) => n.includes(k))) return 'ELE';
  if (['مجموعه سازی', 'پدال گاز', 'ECU', 'ESC', 'سنسور', 'انژکتور', 'ایموبلایزر', 'ایمو بلایزر', 'آنتن', 'مدولاتور'].some((k) => n.includes(normalizeText(k)))) return 'EMS';
  return null;
}

function rebuildOrders(db) {
  db.exec('DELETE FROM fact_order;');
  db.exec(`
    INSERT INTO fact_order (order_no, order_date, product_code, station, sound_qty, scrap_qty, sources)
    SELECT order_no, MAX(order_date), MAX(product_code), MAX(station), MAX(sound_qty), MAX(scrap_qty), 'inprocess'
    FROM fact_inprocess WHERE order_no IS NOT NULL GROUP BY order_no;
  `);
  db.exec(`
    INSERT INTO fact_order (order_no, order_date, shift, product_code, station, planned_qty, sound_qty, scrap_qty, sources)
    SELECT order_no, MAX(order_date), MAX(shift), MAX(product_code), MAX(station),
           MAX(planned_qty), MAX(sound_qty), MAX(scrap_qty), 'inspection'
    FROM fact_inspection WHERE order_no IS NOT NULL GROUP BY order_no
    ON CONFLICT(order_no) DO UPDATE SET
      order_date   = COALESCE(fact_order.order_date, excluded.order_date),
      shift        = COALESCE(fact_order.shift, excluded.shift),
      product_code = COALESCE(fact_order.product_code, excluded.product_code),
      station      = COALESCE(fact_order.station, excluded.station),
      planned_qty  = COALESCE(fact_order.planned_qty, excluded.planned_qty),
      sound_qty    = COALESCE(fact_order.sound_qty, excluded.sound_qty),
      scrap_qty    = COALESCE(fact_order.scrap_qty, excluded.scrap_qty),
      sources      = CASE WHEN instr(COALESCE(fact_order.sources,''), 'inspection') > 0
                          THEN fact_order.sources ELSE COALESCE(fact_order.sources,'') || ',inspection' END;
  `);
  // رکوردهای تولید (در داده‌های تمیز، شماره سفارش وجود ندارد؛
  // هر ردیف تولیدِ یک روز/محصول/گزارش به عنوان یک رکورد تولید شمرده می‌شود)
  db.exec(`
    INSERT INTO fact_order (order_no, order_date, product_code, station, planned_qty, sound_qty, scrap_qty, sources, report)
    SELECT 'P|' || COALESCE(production_date,'') || '|' || COALESCE(product_code,'') || '|' || COALESCE(work_center,''),
           production_date, product_code, MAX(station), 0,
           SUM(COALESCE(sound_qty,0)), SUM(COALESCE(scrap_qty,0)), 'production', MAX(report)
    FROM fact_production
    WHERE production_date IS NOT NULL
    GROUP BY production_date, product_code, work_center
    ON CONFLICT(order_no) DO UPDATE SET
      sound_qty = excluded.sound_qty,
      scrap_qty = excluded.scrap_qty,
      sources   = CASE WHEN instr(COALESCE(fact_order.sources,''), 'production') > 0
                       THEN fact_order.sources ELSE COALESCE(fact_order.sources,'') || ',production' END
  `);
  // مرتب‌سازی: سفارش‌های فقط-بازرسی که تاریخ ندارند
  db.exec(`UPDATE fact_order SET sources = ltrim(COALESCE(sources,''), ',')`);
}

/** علامت‌گذاری رکوردهای تکراری عملیات در اسناد بازرسی */
function markInspectionDuplicates(db) {
  // هر عیب ممکن است زیر چند «عنوان عملیات آزمایش» ثبت شده باشد؛
  // تنها یک عملیات (اولی) به عنوان رکورد اصلی شمارش می‌شود تا از بزرگ‌نمایی جلوگیری شود.
  db.exec(`
    WITH ops AS (
      SELECT order_no, defect_code, COALESCE(operation, '') AS op,
             ROW_NUMBER() OVER (PARTITION BY order_no, defect_code ORDER BY COALESCE(operation, '')) AS rn
      FROM (SELECT DISTINCT order_no, defect_code, COALESCE(operation, '') AS operation
            FROM fact_inspection WHERE defect_code IS NOT NULL)
    )
    UPDATE fact_inspection
    SET op_seq = COALESCE((
      SELECT rn FROM ops
      WHERE ops.order_no IS fact_inspection.order_no
        AND ops.defect_code IS fact_inspection.defect_code
        AND ops.op = COALESCE(fact_inspection.operation, '')
    ), 1)
    WHERE defect_code IS NOT NULL;
  `);
  db.exec(`UPDATE fact_inspection SET op_seq = 1 WHERE defect_code IS NULL`);
}

function ensureCalendar(db) {
  const years = new Set();
  const addYear = (d) => {
    const y = Number(String(d || '').slice(0, 4));
    if (y >= 1300 && y <= 1600) years.add(y);
  };
  for (const r of db.prepare('SELECT DISTINCT order_date AS d FROM fact_inprocess WHERE order_date IS NOT NULL').all()) addYear(r.d);
  for (const r of db.prepare('SELECT DISTINCT order_date AS d FROM fact_inspection WHERE order_date IS NOT NULL').all()) addYear(r.d);
  for (const r of db.prepare('SELECT DISTINCT production_date AS d FROM fact_production WHERE production_date IS NOT NULL').all()) addYear(r.d);
  if (!years.size) years.add(1405);
  const list = new Set();
  for (const y of years) { list.add(y - 1); list.add(y); list.add(y + 1); }
  // حذف ردیف‌های تقویم بیگانه (سال‌های غیرمنطقی)
  db.exec('DELETE FROM dim_date WHERE jyear < 1300 OR jyear > 1600');
  buildCalendar([...list].sort());
}


// ---------------------------------------------------------------- گزارش تمیز راهکاران
/**
 * خروجی ابزار تبدیل (qc.py) یک فایل با ۷ شیت داده است.
 * هر شیت مربوط به یک گزارش کیفیت است و شامل ردیف‌های عیب و ردیف‌های تولید:
 *   - ردیف عیب:    تعداد ایراد > 0 و تعداد کل = 0
 *   - ردیف تولید:  تعداد ایراد = 0 و تعداد کل = مقدار سالم
 */
export const CLEAN_SHEETS = {
  qv:          { source: 'inprocess',  label: 'بازرسی چشمی (QV)' },
  'smd report': { source: 'inprocess', label: 'SMD' },
  ict:         { source: 'inprocess',  label: 'ICT' },
  'qc ele':    { source: 'inprocess',  label: 'کنترل نهایی ELE' },
  fultele:     { source: 'inspection', label: 'تست نهایی ELE' },
  'fult ems':  { source: 'inspection', label: 'تست نهایی EMS' },
  'qc ems':    { source: 'inspection', label: 'کنترل نهایی EMS' },
  'پلیمر':     { source: 'polymer',    label: 'پلیمر' }
};

/** فهرست شیت‌های هر منبع (برای مخرج PPM) */
export const SOURCE_REPORTS = Object.entries(CLEAN_SHEETS).reduce((acc, [sheet, info]) => {
  acc[info.source] = acc[info.source] || [];
  acc[info.source].push(info.label);
  return acc;
}, {});

/** سلول‌های فرمول‌دار اکسل (مثل VLOOKUP) را به مقدار واقعی تبدیل می‌کند */
function unwrapCell(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && ('result' in v || 'formula' in v || 'error' in v)) {
    const r = v.result;
    if (r === undefined || r === null) return null;                 // خطا یا خالی
    if (typeof r === 'object') return r.error ? null : (r.text ?? null);
    return r;
  }
  return v;
}

/** مقادیر تهی در گزارش تمیز: «-» و «#N/A» */
function cleanVal(v) {
  const s = toStr(unwrapCell(v));
  if (!s) return null;
  if (s === '-' || s === '—' || s === '#N/A' || s === '.' || s === '#N/A#N/A') return null;
  return s;
}

function cleanNum(v) {
  const s = cleanVal(v);
  if (s === null) return null;
  return toNum(s);
}

/** عددی که صفرِ آن به معنای «ثبت نشده» است (شدت/تشخیص/وقوع و زمان‌ها) */
function cleanNumNz(v) {
  const n = cleanNum(v);
  return (n === null || n === 0) ? null : n;
}

/** خواندن همه شیت‌های یک فایل اکسل */
async function readWorkbook(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheets = [];
  for (const ws of wb.worksheets) {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => rows.push({ n, values: row.values }));
    if (!rows.length) continue;
    const headers = rows[0].values.slice(1).map(normalizeText);
    const idx = new Map();
    headers.forEach((h, i) => { if (h && !idx.has(h)) idx.set(h, i); });
    sheets.push({
      name: ws.name,
      headers,
      idx,
      rows: rows.slice(1).map((r) => ({ n: r.n, values: r.values.slice(1) }))
    });
  }
  return sheets;
}

/** تشخیص فایل خروجی ابزار تبدیل */
export function isCleanReport(sheets) {
  const names = sheets.map((s) => normalizeText(s.name).toLowerCase());
  const known = names.filter((n) => CLEAN_SHEETS[n]).length;
  if (known >= 1) return true;
  const sheetsWithCols = sheets.filter((s) => s.idx.has('تعداد ایراد') && s.idx.has('تعداد کل') && s.idx.has('کد گروه محصول'));
  return sheetsWithCols.length >= 2;
}

const CC = {
  date: ['تاریخ'],
  shift: ['شیفت کاری'],
  code: ['کد گروه محصول'],
  rawName: ['کد محصول'],
  name: ['نام محصول'],
  family: ['خانواده محصول'],
  combined: ['نام محصول ترکیبی'],
  final: ['گروه محصول نهایی'],
  branch: ['برنچ'],
  station: ['ایستگاه'],
  dcode: ['کد ایراد'],
  ddesc: ['شرح ایراد'],
  dqty: ['تعداد ایراد'],
  tot: ['تعداد کل'],
  action: ['شرح فعالیت انجام شده توسط تعمیرات'],
  six: ['عامل مسبب ایراد 6M'],
  pcode: ['کد قطعه'],
  pname: ['نام قطعه'],
  pfamily: ['خانواده قطعات'],
  psup: ['نام تامین کننده'],
  fm: ['حالت خرابی بالقوه'],
  fmtype: ['نوع حالت خرابی بالقوه'],
  sev: ['شدت حالت خرابی'],
  det: ['تشخیص حالت خرابی'],
  occ: ['وقوع قدیمی'],
  tTrou: ['مدت زمان عیب یابی ( دقیقه )', 'مدت زمان عیب یابی(دقیقه)'],
  tFix: ['مدت زمان رفع عیب ( دقیقه )', 'مدت زمان رفع عیب(دقیقه)'],
  tTest: ['مدت زمان تست مجدد ( دقیقه )', 'مدت زمان تست مجدد(دقیقه)'],
  rep: ['توضیحات تعمیرات'],
  op: ['نام اپراتور'],
  insp: ['نام بازرس'],
  tool: ['کد و نام تجهیزات و ابزارآلات'],
  loc: ['جانمایی قطعه معیوب در فرآیند SMD'],
  opcCode: ['کد فرآیند (OPC)'],
  opcName: ['نام فرآیند (OPC)'],
  notes: ['توضیحات']
};

function colIdx(idx, key) {
  for (const n of CC[key] || []) {
    const i = idx.get(normalizeText(n));
    if (i !== undefined) return i;
  }
  return -1;
}

/** درج/به‌روزرسانی اطلاعات محصول از خودِ ردیف‌های گزارش */
function upsertProduct(db, code, name, family, combined, finalGroup, branch) {
  if (!code) return;
  db.prepare(`
    INSERT INTO dim_product (product_code, product_name, product_family, product_combined, final_group, branch)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_code) DO UPDATE SET
      product_name     = COALESCE(dim_product.product_name, excluded.product_name),
      product_family   = COALESCE(dim_product.product_family, excluded.product_family),
      product_combined = COALESCE(dim_product.product_combined, excluded.product_combined),
      final_group      = COALESCE(dim_product.final_group, excluded.final_group),
      branch           = CASE WHEN dim_product.branch IS NULL OR dim_product.branch = 'نامشخص'
                              THEN excluded.branch ELSE dim_product.branch END
  `).run(code, name, family, combined, finalGroup, branch);
}

export async function importClean(db, filePath, fileName) {
  const sheets = await readWorkbook(filePath);
  if (!isCleanReport(sheets)) throw new Error('ساختار فایل به عنوان «گزارش تمیز» شناخته نشد');

  // حذف داده‌های قبلی همین فایل (بارگذاری تکراری = جایگزینی)
  db.prepare('DELETE FROM fact_inprocess WHERE src_file = ?').run(fileName);
  db.prepare('DELETE FROM fact_inspection WHERE src_file = ?').run(fileName);
  db.prepare('DELETE FROM fact_production WHERE src_file = ?').run(fileName);

  /* امضای ردیف‌های «سایر فایل‌ها»:
     اگر یک ردیف با همین مشخصات قبلاً از فایل دیگری بارگذاری شده باشد،
     دوباره شمرده نمی‌شود. این کار مانع دوباره‌شماری هنگام قرار گرفتن
     چند گزارش با بازه‌های همپوشان در پوشه داده می‌شود. */
  const sigOf = (o) => [o.report, o.date, o.code, o.station, o.defect, o.qty, o.prod, o.part, o.repair, o.six].join('|');
  const otherSigs = new Set();
  for (const r of db.prepare(`SELECT report, order_date, product_code, station, defect_code, defect_qty,
                                     part_code, repair_desc, cause_6m, src_file FROM fact_inprocess`).all()) {
    if (r.src_file === fileName) continue;
    otherSigs.add(sigOf({ report: r.report, date: r.order_date, code: r.product_code, station: r.station,
      defect: r.defect_code, qty: r.defect_qty, prod: 0, part: r.part_code, repair: r.repair_desc, six: r.cause_6m }));
  }
  for (const r of db.prepare(`SELECT report, order_date, product_code, station, defect_code, defect_qty,
                                     part_code, repair_desc, cause_6m, src_file FROM fact_inspection`).all()) {
    if (r.src_file === fileName) continue;
    otherSigs.add(sigOf({ report: r.report, date: r.order_date, code: r.product_code, station: r.station,
      defect: r.defect_code, qty: r.defect_qty, prod: 0, part: r.part_code, repair: r.repair_desc, six: r.cause_6m }));
  }
  for (const r of db.prepare(`SELECT report, production_date, product_code, station, sound_qty, src_file FROM fact_production`).all()) {
    if (r.src_file === fileName) continue;
    otherSigs.add(sigOf({ report: r.report, date: r.production_date, code: r.product_code, station: r.station,
      defect: null, qty: 0, prod: r.sound_qty, part: null, repair: null, six: null }));
  }
  let duplicateRows = 0;

  const insIp = db.prepare(`
    INSERT INTO fact_inprocess
      (src_file, src_row, report, order_no, order_date, product_code, product_name, station,
       process_code, process_name, defect_code, defect_desc, defect_qty, sound_qty,
       cause_6m, failure_mode, failure_mode_type, severity, occurrence, detection, rpn,
       part_code, part_name, part_family, supplier, tool, location,
       repair_action, repair_desc, inspector, operator_name, notes,
       fix_time_min, retest_time_min, troubleshoot_time_min)
    VALUES (@src_file,@src_row,@report,@order_no,@order_date,@product_code,@product_name,@station,
       @process_code,@process_name,@defect_code,@defect_desc,@defect_qty,@sound_qty,
       @cause_6m,@failure_mode,@failure_mode_type,@severity,@occurrence,@detection,@rpn,
       @part_code,@part_name,@part_family,@supplier,@tool,@location,
       @repair_action,@repair_desc,@inspector,@operator_name,@notes,
       @fix_time_min,@retest_time_min,@troubleshoot_time_min)
  `);
  const insIns = db.prepare(`
    INSERT INTO fact_inspection
      (src_file, src_row, report, order_no, order_date, shift, product_code, product_name,
       station, operation, defect_code, defect_desc, defect_qty, op_seq,
       repair_action, repair_desc, cause_6m, failure_mode, failure_mode_type, part_code, part_name, part_family, supplier,
       severity, occurrence, detection, rpn, fix_time_min, retest_time_min, troubleshoot_time_min,
       operator_name, inspector, process_code, process_name, notes)
    VALUES (@src_file,@src_row,@report,@order_no,@order_date,@shift,@product_code,@product_name,
       @station,@operation,@defect_code,@defect_desc,@defect_qty,1,
       @repair_action,@repair_desc,@cause_6m,@failure_mode,@failure_mode_type,@part_code,@part_name,@part_family,@supplier,
       @severity,@occurrence,@detection,@rpn,@fix_time_min,@retest_time_min,@troubleshoot_time_min,
       @operator_name,@inspector,@process_code,@process_name,@notes)
  `);
  const insProd = db.prepare(`
    INSERT INTO fact_production
      (src_file, src_row, report, production_date, product_code, product_name, station, work_center, sound_qty, scrap_qty, planned_qty)
    VALUES (@src_file,@src_row,@report,@production_date,@product_code,@product_name,@station,@work_center,@sound_qty,0,0)
  `);

  let rowsIn = 0;
  const loaded = { inprocess: 0, inspection: 0, production: 0 };
  const skipped = [];
  const seen = new Map();          // حذف ردیف‌های کاملاً تکراری بین فایل‌ها

  const run = db.transaction(() => {
    for (const sheet of sheets) {
      const key = normalizeText(sheet.name).toLowerCase();
      const info = CLEAN_SHEETS[key];
      const sheetNo = sheets.indexOf(sheet) + 1;   // شماره شیت برای یکتا بودن شماره ردیف
      if (!info) continue;                      // شیت گروه‌بندی محصولات و شیت‌های دیگر
      const c = {};
      for (const k of Object.keys(CC)) c[k] = colIdx(sheet.idx, k);
      if (c.date < 0 || c.dqty < 0 || c.tot < 0) { skipped.push(`${sheet.name}: ستون‌های اصلی پیدا نشد`); continue; }

      const get = (row, k) => (c[k] >= 0 ? row.values[c[k]] : undefined);

      for (const row of sheet.rows) {
        const rawDate = get(row, 'date');
        const jdate = toJdate(rawDate);
        const code = cleanVal(get(row, 'code'));
        if (!jdate || !code) { if (rawDate) rowsIn += 1; continue; }
        rowsIn += 1;

        const dqty = toNum(get(row, 'dqty')) || 0;
        const tot = toNum(get(row, 'tot')) || 0;
        const name = cleanVal(get(row, 'name'));
        const family = cleanVal(get(row, 'family'));
        const combined = cleanVal(get(row, 'combined'));
        const finalGroup = cleanVal(get(row, 'final'));
        const branch = cleanVal(get(row, 'branch'));
        upsertProduct(db, code, name || cleanVal(get(row, 'rawName')), family, combined, finalGroup, branch);

        // کلید یکتا برای جلوگیری از شمارش دوباره ردیف‌های مشترک بین گزارش‌ها
        const sig = sigOf({
          report: info.label, date: jdate, code, station: cleanVal(get(row, 'station')),
          defect: cleanVal(get(row, 'dcode')), qty: dqty, prod: tot,
          part: cleanVal(get(row, 'pcode')), repair: cleanVal(get(row, 'rep')), six: cleanVal(get(row, 'six'))
        });
        const n = (seen.get(sig) || 0) + 1;
        seen.set(sig, n);
        // (حذف ردیف‌های تکراریِ بین فایل‌ها در پایان و به صورت یکپارچه انجام می‌شود)

        const common = {
          src_file: fileName,
          src_row: sheetNo * 1000000 + row.n,
          report: info.label,
          order_no: null,
          order_date: jdate,
          product_code: code,
          product_name: cleanVal(get(row, 'rawName')) || name,
          station: cleanVal(get(row, 'station')),
          defect_code: cleanVal(get(row, 'dcode')),
          defect_desc: cleanVal(get(row, 'ddesc')),
          defect_qty: dqty,
          repair_action: cleanVal(get(row, 'action')),
          repair_desc: cleanVal(get(row, 'rep')),
          cause_6m: cleanVal(get(row, 'six')),
          failure_mode: cleanVal(get(row, 'fm')),
          failure_mode_type: cleanVal(get(row, 'fmtype')),
          severity: cleanNumNz(get(row, 'sev')),
          occurrence: cleanNumNz(get(row, 'occ')),
          detection: cleanNumNz(get(row, 'det')),
          part_code: cleanVal(get(row, 'pcode')),
          part_name: cleanVal(get(row, 'pname')),
          part_family: cleanVal(get(row, 'pfamily')),
          supplier: cleanVal(get(row, 'psup')),
          fix_time_min: cleanNumNz(get(row, 'tFix')),
          retest_time_min: cleanNumNz(get(row, 'tTest')),
          troubleshoot_time_min: cleanNumNz(get(row, 'tTrou')),
          operator_name: cleanVal(get(row, 'op')),
          inspector: cleanVal(get(row, 'insp')),
          process_code: cleanVal(get(row, 'opcCode')),
          process_name: cleanVal(get(row, 'opcName')),
          notes: cleanVal(get(row, 'notes'))
        };
        const s = common.severity, o = common.occurrence, d = common.detection;
        const rpn = (s != null && o != null && d != null) ? s * o * d : null;

        if (dqty > 0) {
          if (info.source === 'inprocess') {
            insIp.run({ ...common, sound_qty: 0, tool: cleanVal(get(row, 'tool')), location: cleanVal(get(row, 'loc')), rpn });
            loaded.inprocess += 1;
          } else {
            insIns.run({ ...common, shift: cleanVal(get(row, 'shift')), operation: null, rpn });
            loaded.inspection += 1;
          }
        } else if (tot > 0) {
          insProd.run({
            src_file: fileName,
            src_row: sheetNo * 1000000 + row.n,
            report: info.label,
            production_date: jdate,
            product_code: code,
            product_name: name,
            station: cleanVal(get(row, 'station')),
            work_center: info.label,
            sound_qty: tot
          });
          loaded.production += 1;
        }
      }
    }
  });
  run();

  return {
    rowsIn,
    rowsLoaded: loaded.inprocess + loaded.inspection + loaded.production,
    message: `عیب حین تولید: ${loaded.inprocess} | عیب بازرسی: ${loaded.inspection} | تولید: ${loaded.production}`
      + (duplicateRows ? ` | ${duplicateRows} ردیف تکراری (قبلاً از فایل دیگر بارگذاری شده) نادیده گرفته شد` : '')
      + (skipped.length ? ` | ${skipped.join(' / ')}` : ''),
    detail: loaded
  };
}

/**
 * حذف ردیف‌های تکراریِ بین چند گزارش.
 * اگر یک ردیف با مشخصات یکسان در چند فایل باشد، فقط ردیف‌هایِ فایلی که نام آن
 * در ترتیب الفبایی جلوتر است نگه داشته می‌شود؛ ردیف‌های تکراریِ درونِ یک فایل
 * (که در منبع هم تکرارند) دست‌نخورده می‌مانند. این کار مستقل از ترتیب بارگذاری
 * و تکرارپذیر است.
 */
/**
 * یکپارچه‌سازی نام محصول.
 * هر محصول در سیستم چند کد دارد (هر کد = یک مرحله تولید: 120=SMD،
 * 121=مونتاژ/وان قلع، 122=تکمیل کاری، 123=کنترل نهایی، 130=محصول کامل،
 * 22x/23x=پلیمر، 32x/33x=EMS). برای اینکه در گزارش نام یک محصول تکرار نشود،
 * همه کدهای یک محصول زیر یک «نام یکپارچه» جمع می‌شوند و کدِ آخرین مرحله به
 * عنوان مرحله نهایی علامت می‌خورد تا مخرج تولید دوبار شمرده نشود.
 */
export const STAGE_ORDER = ['120', '121', '122', '123', '130',
  '221', '222', '225', '232', '233', '320', '331', '332'];

/**
 * دسته‌بندی کدهای کالا (تعریفِ کارفرما):
 *   1* = الکترونیک   120 SMD | 121 مونتاژ/وان قلع (qv و فالت) |
 *                    122 تکمیل کاری (ICT فقط برای خانوادهٔ نود و عیب ICT_01) |
 *                    123 کنترل نهایی | 130 محصول کامل (خارج از تحلیل عیب)
 *   2* = پلیمر       221 چاپ و لیزر دایال | 222 تزریق و کنترل نهایی دایال |
 *                    225 قطعات نیمه‌ساخته | 232 تزریق قطعات | 233 تزریق سنگین
 *   3* = EMS         320 مونتاژ و تست | 331 مجموعه‌سازی | 332 مونتاژ و بسته‌بندی
 */
export const CODE_CLASS = {
  '120': ['الکترونیک', 'SMD'],
  '121': ['الکترونیک', 'مونتاژ و وان قلع (QV/فالت)'],
  '122': ['الکترونیک', 'تکمیل کاری (ICT برای نودها)'],
  '123': ['الکترونیک', 'کنترل نهایی'],
  '130': ['الکترونیک', 'محصول کامل (بسته‌بندی)'],
  '221': ['پلیمر', 'چاپ و لیزر دایال'],
  '222': ['پلیمر', 'تزریق و کنترل نهایی دایال'],
  '225': ['پلیمر', 'قطعات نیمه‌ساخته'],
  '232': ['پلیمر', 'تزریق قطعات'],
  '233': ['پلیمر', 'تزریق سنگین'],
  '320': ['EMS', 'مونتاژ و تست'],
  '331': ['EMS', 'مجموعه‌سازی ECU/مدولاتور/پدال'],
  '332': ['EMS', 'مجموعه‌سازی سنسور/آنتن/سایر']
};

export const CATEGORY_BY_FIRST_DIGIT = {
  '1': 'الکترونیک',
  '2': 'پلیمر',
  '3': 'EMS'
};

/** دسته و زیرگروه هر محصول را از روی پیشوند کد کالا پر می‌کند */
export function computeProductClass(db) {
  const rows = db.prepare('SELECT product_code FROM dim_product').all();
  const upd = db.prepare('UPDATE dim_product SET category = ?, stage = ? WHERE product_code = ?');
  let n = 0;
  for (const r of rows) {
    const code = String(r.product_code || '');
    const prefix = code.slice(0, 3);
    const cls = CODE_CLASS[prefix];
    const category = cls ? cls[0] : (CATEGORY_BY_FIRST_DIGIT[code.slice(0, 1)] || 'سایر');
    const stage = cls ? cls[1] : (CATEGORY_BY_FIRST_DIGIT[code.slice(0, 1)] || 'سایر');
    upd.run(category, stage, code);
    n += 1;
  }
  return n;
}

export function computeProductUnified(db) {
  db.exec(`
    UPDATE dim_product SET unified_name =
      COALESCE(NULLIF(TRIM(COALESCE(product_combined, '')), ''),
               NULLIF(TRIM(COALESCE(product_name, '')), ''),
               product_code);
  `);
  db.exec('UPDATE dim_product SET is_final = 0');
  const rows = db.prepare('SELECT product_code, unified_name FROM dim_product').all();
  const byUnified = new Map();
  for (const r of rows) {
    const prefix = String(r.product_code || '').slice(0, 3);
    const rank = STAGE_ORDER.indexOf(prefix);
    const current = byUnified.get(r.unified_name);
    if (!current || (rank >= 0 && (current.rank < 0 || rank > current.rank))) {
      byUnified.set(r.unified_name, { rank, code: r.product_code });
    }
  }
  const upd = db.prepare('UPDATE dim_product SET is_final = 1 WHERE product_code = ?');
  for (const { code } of byUnified.values()) upd.run(code);
  return byUnified.size;
}

/**
 * حذف ردیف‌های عیبِ «تحلیل‌نشده» از شیت‌های حین تولید.
 * در فایل «اطلاعات جامع کیفیت» هر عیب یا تحلیل شده (توضیحات تعمیرات، عامل 6M،
 * قطعه، زمان‌ها) یا فقط ثبت اولیه است. ردیفی که هیچ‌کدام از این نشانه‌ها را
 * ندارد تحلیل نشده و نباید در آمار عیب بیاید (ابزار تبدیل qc.py هم آن‌ها را
 * کنار می‌گذارد؛ این قانون برای گزارش‌های قدیمی‌تر هم اعمال می‌شود).
 */
export function dropUnanalyzed(db) {
  const info = db.prepare(`
    DELETE FROM fact_inprocess
    WHERE (repair_desc IS NULL OR TRIM(repair_desc) = '')
      AND (repair_action IS NULL OR TRIM(repair_action) = '')
      AND (cause_6m IS NULL OR TRIM(cause_6m) = '')
      AND (part_code IS NULL OR TRIM(part_code) = '')
      AND (part_name IS NULL OR TRIM(part_name) = '')
      AND (failure_mode IS NULL OR TRIM(failure_mode) = '')
      AND COALESCE(fix_time_min, 0) = 0
      AND COALESCE(retest_time_min, 0) = 0
      AND COALESCE(troubleshoot_time_min, 0) = 0
  `).run();
  const removed = info.changes || 0;
  if (removed) log(`ردیف‌های عیبِ تحلیل‌نشدهٔ جامع کیفیت حذف شد: ${removed}`);
  return removed;
}

/**
 * اولویتِ «اطلاعات جامع کیفیت» بر «گزارش عیب‌های سند بازرسی».
 * اگر عیبی (با تاریخ، کد محصول و کد عیبِ یکسان) در شیت‌های حین تولید
 * (QV/SMD/ICT/کنترل نهایی) تحلیل شده باشد، ردیفِ تکراریِ همان عیب در شیت‌های
 * سند بازرسی (FULTELE/FULT EMS/QC EMS) دوباره شمرده نمی‌شود.
 * توجه: کدهای EMS (3*) و پلیمر (2*) در فایل جامع کیفیت نیستند، پس حذف نمی‌شوند.
 */
export function dedupeAcrossSources(db) {
  const info = db.prepare(`
    DELETE FROM fact_inspection
    WHERE defect_code IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM fact_inprocess p
        WHERE p.order_date IS fact_inspection.order_date
          AND p.product_code IS fact_inspection.product_code
          AND p.defect_code IS fact_inspection.defect_code
      )
  `).run();
  const removed = info.changes || 0;
  if (removed) log(`عیب‌های تکراریِ سند بازرسی (تحلیل‌شده در جامع کیفیت) حذف شد: ${removed}`);
  return removed;
}

export function dedupeAcrossFiles(db) {
  let removed = 0;
  const groups = [
    {
      table: 'fact_inprocess',
      cols: ['report', 'order_date', 'product_code', 'station', 'defect_code', 'defect_qty',
             'part_code', 'repair_desc', 'cause_6m']
    },
    {
      table: 'fact_inspection',
      cols: ['report', 'order_date', 'product_code', 'station', 'defect_code', 'defect_qty',
             'part_code', 'repair_desc', 'cause_6m']
    },
    {
      table: 'fact_production',
      cols: ['report', 'production_date', 'product_code', 'station', 'sound_qty']
    }
  ];
  for (const g of groups) {
    const sel = g.cols.join(', ');
    const match = g.cols.map((c) => `t.${c} IS k.${c}`).join(' AND ');
    const info = db.prepare(`
      DELETE FROM ${g.table} WHERE id IN (
        SELECT t.id FROM ${g.table} t
        JOIN (SELECT ${sel}, MIN(src_file) AS keep_file FROM ${g.table} GROUP BY ${sel}) k
          ON ${match}
        WHERE t.src_file IS NOT k.keep_file
      )
    `).run();
    removed += info.changes || 0;
  }
  if (removed) log(`${removed} ردیف تکراری بین گزارش‌ها حذف شد`);
  return removed;
}

// ---------------------------------------------------------------- اجرا
export async function runImport({ files = null, removeMissing = false } = {}) {
  await dbReady;                       // اطمینان از آماده بودن پایگاه داده
  const db = getDb();
  const t0 = Date.now();
  const listDir = (dir) => (fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.(xlsx|xlsm)$/i.test(f) && !f.startsWith('~$')).map((f) => path.join(dir, f))
    : []);
  // اولویت با پوشه گزارش‌های تمیز (خروجی ابزار تبدیل) است.
  // فایل‌های موجود در پوشه raw فقط «ورودی ابزار تبدیل» هستند و مستقیماً بار نمی‌شوند،
  // مگر این‌که خودشان یک گزارش تمیز باشند.
  const entries = [
    ...listDir(CLEAN_DIR).map((p) => ({ path: p, from: 'clean' })),
    ...listDir(RAW_DIR).map((p) => ({ path: p, from: 'raw' }))
  ];

  const targets = files && files.length
    ? entries.filter((e) => files.includes(path.basename(e.path)))
    : entries;

  const results = [];
  for (const entry of targets) {
    const filePath = entry.path;
    const fileName = path.basename(filePath);
    let sheet;
    try {
      const sheets = await readWorkbook(filePath);
      sheet = sheets.find((sh) => sh.rows.length) || { headers: [], idx: new Map(), rows: [] };
      const type = detectType(sheet.headers);
      // تشخیص «گزارش تمیز» نیازمند بررسی همه شیت‌هاست
      const isClean = sheets.some((sh) => CLEAN_SHEETS[normalizeText(sh.name).toLowerCase()])
        || isCleanReport(sheets);
      if (!isClean && !type) {
        markImport(db, fileName, 'ناشناس', 0, 0, 'error', 'نوع فایل بر اساس ستون‌ها تشخیص داده نشد', fs.statSync(filePath).size);
        results.push({ file: fileName, type: 'ناشناس', rows: 0, status: 'error', message: 'نوع فایل تشخیص داده نشد' });
        continue;
      }
      let r;
      let typeLabel = type;
      if (isClean) {
        r = await importClean(db, filePath, fileName);
        typeLabel = 'گزارش تمیز';
      } else if (entry.from === 'raw' && !isClean) {
        // ورودی خام ابزار تبدیل: مستقیماً وارد پایگاه نمی‌شود
        markImport(db, fileName, 'ورودی خام', 0, 0, 'info',
          'این فایل ورودیِ ابزار تبدیل است؛ ابتدا دستور «npm run clean» را اجرا کنید', fs.statSync(filePath).size);
        db.prepare('UPDATE import_file SET source_kind = ? WHERE file_name = ?').run('raw', fileName);
        results.push({ file: fileName, type: 'ورودی خام', rows: 0, status: 'info',
          message: 'ورودی ابزار تبدیل - با npm run clean به گزارش تمیز تبدیل می‌شود' });
        log(`${fileName} -> ورودی خام ابزار تبدیل (نادیده گرفته شد)`);
        continue;
      } else if (type === 'inprocess') r = await importInprocess(db, filePath, fileName);
      else if (type === 'inspection') r = await importInspection(db, filePath, fileName);
      else if (type === 'production') r = await importProduction(db, filePath, fileName);
      else r = await importProducts(db, filePath, fileName);

      markImport(db, fileName, typeLabel, r.rowsIn, r.rowsLoaded, 'ok', r.message || null, fs.statSync(filePath).size);
      db.prepare('UPDATE import_file SET source_kind = ? WHERE file_name = ?').run(isClean ? 'clean' : 'raw', fileName);
      results.push({ file: fileName, type: typeLabel, rows: r.rowsLoaded, status: 'ok', message: r.message || null });
      log(`${fileName} -> ${typeLabel} (${r.rowsLoaded} ردیف)`);
    } catch (err) {
      markImport(db, fileName, 'خطا', 0, 0, 'error', String(err.message || err), fs.statSync(filePath).size);
      results.push({ file: fileName, type: 'خطا', rows: 0, status: 'error', message: String(err.message || err) });
      log(`خطا در ${fileName}:`, err.message);
    }
  }

  // حذف ردیف‌های فایل‌هایی که دیگر در پوشه نیستند
  if (removeMissing) {
    const present = new Set(entries.map((e) => path.basename(e.path)));
    const stale = db.prepare('SELECT DISTINCT file_name FROM import_file').all()
      .map((r) => r.file_name).filter((n) => !present.has(n));
    for (const name of stale) {
      db.prepare('DELETE FROM fact_inprocess WHERE src_file = ?').run(name);
      db.prepare('DELETE FROM fact_inspection WHERE src_file = ?').run(name);
      db.prepare('DELETE FROM fact_production WHERE src_file = ?').run(name);
      db.prepare('DELETE FROM import_file WHERE file_name = ?').run(name);
      log(`فایل حذف‌شده از پوشه: ${name} -> داده‌های آن پاک شد`);
    }
  }

  dedupeAcrossFiles(db);
  dropUnanalyzed(db);
  dedupeAcrossSources(db);
  rebuildDims(db);
  computeProductClass(db);
  computeProductUnified(db);
  markInspectionDuplicates(db);
  rebuildOrders(db);
  ensureCalendar(db);

  const summary = {
    elapsedMs: Date.now() - t0,
    files: results,
    totals: {
      inprocess: db.prepare('SELECT COUNT(*) c FROM fact_inprocess').get().c,
      inspection: db.prepare('SELECT COUNT(*) c FROM fact_inspection').get().c,
      production: db.prepare('SELECT COUNT(*) c FROM fact_production').get().c,
      orders: db.prepare('SELECT COUNT(*) c FROM fact_order').get().c,
      products: db.prepare('SELECT COUNT(*) c FROM dim_product').get().c
    }
  };
  log('پایان بارگذاری:', JSON.stringify(summary.totals));
  return summary;
}

/** اجرای مستقیم: node server/etl.mjs */
if (import.meta.url === `file://${process.argv[1]}`) {
  runImport({ removeMissing: true })
    .then((s) => {
      console.log(JSON.stringify(s, null, 2));
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
