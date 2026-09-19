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
import { getDb, ready as dbReady, ensureDate, buildCalendar, RAW_DIR } from './db.mjs';
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

// ---------------------------------------------------------------- اجرا
export async function runImport({ files = null, removeMissing = false } = {}) {
  await dbReady;                       // اطمینان از آماده بودن پایگاه داده
  const db = getDb();
  const t0 = Date.now();
  const entries = fs.readdirSync(RAW_DIR)
    .filter((f) => /\.(xlsx|xlsm)$/i.test(f) && !f.startsWith('~$'))
    .map((f) => path.join(RAW_DIR, f));

  const targets = files && files.length
    ? entries.filter((p) => files.includes(path.basename(p)))
    : entries;

  const results = [];
  for (const filePath of targets) {
    const fileName = path.basename(filePath);
    let sheet;
    try {
      sheet = await readSheet(filePath);
      const type = detectType(sheet.headers);
      if (!type) {
        markImport(db, fileName, 'ناشناس', 0, 0, 'error', 'نوع فایل بر اساس ستون‌ها تشخیص داده نشد', fs.statSync(filePath).size);
        results.push({ file: fileName, type: 'ناشناس', rows: 0, status: 'error', message: 'نوع فایل تشخیص داده نشد' });
        continue;
      }
      let r;
      if (type === 'inprocess') r = await importInprocess(db, filePath, fileName);
      else if (type === 'inspection') r = await importInspection(db, filePath, fileName);
      else if (type === 'production') r = await importProduction(db, filePath, fileName);
      else r = await importProducts(db, filePath, fileName);

      markImport(db, fileName, type, r.rowsIn, r.rowsLoaded, 'ok', r.message || null, fs.statSync(filePath).size);
      results.push({ file: fileName, type, rows: r.rowsLoaded, status: 'ok', message: r.message || null });
      log(`${fileName} -> ${type} (${r.rowsLoaded} ردیف)`);
    } catch (err) {
      markImport(db, fileName, 'خطا', 0, 0, 'error', String(err.message || err), fs.statSync(filePath).size);
      results.push({ file: fileName, type: 'خطا', rows: 0, status: 'error', message: String(err.message || err) });
      log(`خطا در ${fileName}:`, err.message);
    }
  }

  // حذف ردیف‌های فایل‌هایی که دیگر در پوشه نیستند
  if (removeMissing) {
    const present = new Set(entries.map((p) => path.basename(p)));
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

  rebuildDims(db);
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
