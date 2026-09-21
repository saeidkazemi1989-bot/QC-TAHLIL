/**
 * بررسیِ شمارش عیب‌ها در فایل خامِ «اطلاعات جامع کیفیت حین تولید».
 *
 * قاعده: برای هر (شماره سفارش، کد محصول، کد عیب) جمعِ ستون «تعداد عیب مربوطه»
 * باید برابرِ یکی از خانه‌های ستون «تعداد عیب» باشد. دو الگوی ثبت وجود دارد:
 *   الف) تقسیمی: یک خانهٔ «تعداد عیب» (مثلاً ۱۰) و چند ردیف با مربوطهٔ ۲+۶+۱+۱
 *   ب)   مستقل: هر ردیف عددِ خودش را دارد (۲ و ۲ و ۳)
 * ستون «تعداد عیب» هیچ‌وقت نباید جمع زده شود (چند برابر می‌شود).
 *
 * این بررسی داخل خود سامانه هم در دسترس است (کارتِ «بررسی شمارش عیب‌ها»
 * در صفحهٔ مدیریت) تا هر بار که فایل جدید می‌آید بتوان آن را اجرا کرد.
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const HEADER_CANDIDATES = {
  order: ['شماره سفارش تولید'],
  code: ['کد محصول', 'کد کالا'],
  defect: ['کد عیب', 'کد ایراد'],
  related: ['تعداد عیب مربوطه'],
  total: ['تعداد عیب', 'تعداد ایراد'],
  date: ['تاریخ سفارش', 'تاریخ تولید']
};

function normText(v) {
  return String(v == null ? '' : v).replace(/[\u200c\u200f]/g, '').replace(/\s+/g, ' ').trim();
}

/** نرمال‌سازی کد عیب: حذف پسوند پرانتزی و نقطهٔ انتهایی (همان رفتار qc.py) */
function normDc(v) {
  return normText(v).replace(/[（(].*?[）)]/g, '').replace(/\.+$/, '').trim().toUpperCase();
}

function num(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'object' && 'result' in v) return num(v.result);   // سلول فرمول
  const s = normText(v).replace(/[,\u066c\u066b]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function cellText(cell) {
  if (cell == null) return '';
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.result !== undefined && v.result !== null) return normText(v.result);
    if (v.text) return normText(v.text);
    if (Array.isArray(v.richText)) return normText(v.richText.map((t) => t.text).join(''));
    return '';
  }
  return normText(v);
}

/** پیدا کردن فایل جامع کیفیت در پوشهٔ داده‌ها */
export function findQualityFile(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /\.(xlsx|xlsm)$/i.test(f) && !f.startsWith('~$'));
  return files.find((f) => f.includes('جامع کیفیت')) || null;
}

export async function checkDefectCounts(dir) {
  const name = findQualityFile(dir);
  if (!name) return { ok: false, error: 'فایل «اطلاعات جامع کیفیت» در پوشهٔ داده‌ها پیدا نشد' };
  const file = path.join(dir, name);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, error: 'فایل خالی است' };

  let headerRow = null;
  const col = {};
  ws.eachRow((row, i) => {
    if (headerRow) return;
    const values = [];
    row.eachCell({ includeEmpty: true }, (c, j) => { values[j] = normText(cellText(c)); });
    const found = {};
    let hits = 0;
    for (const [key, names] of Object.entries(HEADER_CANDIDATES)) {
      const idx = values.findIndex((v) => names.includes(v));
      if (idx > 0) { found[key] = idx; hits += 1; }
    }
    if (hits >= 4 && found.related && found.total && found.defect) {
      headerRow = i;
      Object.assign(col, found);
    }
  });
  if (!headerRow) return { ok: false, error: 'ستون‌های «تعداد عیب مربوطه» / «تعداد عیب» / «کد عیب» در فایل پیدا نشد' };

  const get = (row, key) => (col[key] ? row.getCell(col[key]) : null);
  const groups = new Map();
  let rowsWithDefect = 0;
  let rowsUnanalyzed = 0;
  let sumRelatedAll = 0;

  ws.eachRow((row, i) => {
    if (i <= headerRow) return;
    const dc = normDc(cellText(get(row, 'defect')));
    if (!dc) return;
    rowsWithDefect += 1;
    const rel = num(get(row, 'related')?.value);
    const tot = num(get(row, 'total')?.value);
    if (!rel) rowsUnanalyzed += 1;
    sumRelatedAll += rel;
    const order = cellText(get(row, 'order'));
    const code = cellText(get(row, 'code'));
    const date = cellText(get(row, 'date'));
    const key = `${order || date}|${code}|${dc}`;
    const g = groups.get(key) || { order: order || null, code, defect: dc, rel: 0, tots: [], rows: 0 };
    g.rel += rel;
    g.tots.push(tot);
    g.rows += 1;
    groups.set(key, g);
  });

  let split = 0;
  let independent = 0;
  let unknownCount = 0;
  const unknown = [];
  for (const g of groups.values()) {
    const tots = g.tots.filter((v) => v);
    const eq = (a, b) => Math.abs(a - b) < 1e-6;
    if (tots.length && tots.some((t) => eq(g.rel, t))) split += 1;
    else if (eq(g.rel, tots.reduce((a, b) => a + b, 0))) independent += 1;
    else {
      unknownCount += 1;
      if (unknown.length < 12) unknown.push(g);
    }
  }
  const sumTotalCol = [...groups.values()].reduce((acc, g) => acc + g.tots.reduce((a, b) => a + b, 0), 0);

  return {
    ok: true,
    file: name,
    rowsWithDefect,
    rowsUnanalyzed,                       // ردیف‌های بدون «تعداد عیب مربوطه» (تحلیل‌نشده)
    groups: groups.size,
    split,                                // الف) جمعِ مربوطه = یکی از خانه‌های تعداد عیب
    independent,                          // ب) هر ردیف عدد مستقل
    unknown: unknownCount,                // ناهماهنگ
    unknownExamples: unknown.map((g) => ({
      order: g.order, code: g.code, defect: g.defect,
      related: Math.round(g.rel * 100) / 100, totals: g.tots, rows: g.rows
    })),
    sumRelated: Math.round(sumRelatedAll * 100) / 100,   // مبنای آمار
    sumTotalCol: Math.round(sumTotalCol * 100) / 100,    // اگر ستون تعداد عیب جمع شود (اشتباه)
    factor: sumRelatedAll ? Math.round((sumTotalCol / sumRelatedAll) * 10) / 10 : null
  };
}
