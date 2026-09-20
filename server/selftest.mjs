/**
 * خودآزمایی لایه تحلیل
 * ---------------------------------------------------------------
 * تمام پرس‌وجوهای تحلیلی را با ترکیب‌های مختلف فیلتر اجرا می‌کند تا
 * پس از هر بار به‌روزرسانی داده مطمئن شویم همه چیز سالم است.
 *
 * اجرا:  npm test
 */
import { ready } from './db.mjs';
import * as A from './analytics.mjs';
import { parseFilters } from './filters.mjs';
await ready;

const combos = [
  {},
  { from: '1405/05/01', to: '1405/05/31' },
  { category: 'الکترونیک,EMS' },
  { station: 'سامسونگ 1,سامسونگ 2' },
  { defect_group: 'ظاهری' },
  { defect_code: 'IP-58,SS-10' },
  { cause_6m: 'مواد اولیه,اپراتور' },
  { shift: 'عادی' },
  { operation: 'QV' },
  { repair_action: 'بازکاری' },
  { part_family: 'بزل' },
  { supplier: 'CY76' },
  { failure_mode: 'خط و خش روی گلس بزل' },
  { product_code: '1211963' },
  { final_group: 'Cluster Instrument' },
  { process_domain: 'SMD' },
  { category: 'پلیمر' },
  { stage: 'تزریق و کنترل نهایی دایال', category: 'پلیمر' },
  { q: 'قلع' },
  { from: '1405/05/01', to: '1405/05/31', category: 'الکترونیک', station: 'سامسونگ 1', cause_6m: 'تجهیرات و ماشین آلات', defect_group: 'لحیم‌کاری و قطعه‌گذاری' }
];

let pass = 0; const fails = [];
for (const source of ['inprocess', 'inspection', 'polymer']) {
  for (const combo of combos) {
    const f = parseFilters({ source, ...combo });
    const label = `${source} ${JSON.stringify(combo)}`;
    const calls = [
      ['summary', () => A.summary(f, source)],
      ['trend-day', () => A.trend(f, source, 'day')],
      ['trend-week', () => A.trend(f, source, 'week')],
      ['trend-month', () => A.trend(f, source, 'month')],
      ['trend-quarter', () => A.trend(f, source, 'quarter')],
      ['trend-half', () => A.trend(f, source, 'half')],
      ['trend-year', () => A.trend(f, source, 'year')],
      ['matrix', () => A.matrix(f, source, 'defect', 'station', 8, 5)],
      ['matrix2', () => A.matrix(f, source, 'product', 'defect_group', 6, 4)],
      ['times', () => A.times(f, 'station', 5)],
      ['pfmea', () => A.pfmea(f, 10)],
      ['drill', () => A.drillTree(f, source)],
      ['records', () => A.records(f, source, { page: 1, size: 10, sort: 'defect_qty' })],
      ['records-q', () => A.records({ ...f, q: 'TS' }, source, { page: 2, size: 5 })]
    ];
    for (const dim of ['station', 'process_domain', 'category', 'stage', 'final_group', 'product_family', 'product_combined',
                       'product', 'defect', 'defect_group', 'cause_6m', 'part_family', 'part_name', 'supplier',
                       'repair_action', 'repair_desc', 'failure_mode', 'process_name', 'registrar', 'operator',
                       'shift', 'operation', 'product_unified', 'category', 'stage']) {
      calls.push([`bd:${dim}`, () => A.breakdown(f, source, dim, 10)]);
    }
    for (const [name, fn] of calls) {
      try { fn(); pass += 1; } catch (e) { fails.push(`${label} | ${name}: ${e.message}`); }
    }
  }
}
// تولید
for (const combo of combos) {
  const f = parseFilters(combo);
  const calls = [
    ['prod-summary', () => A.productionSummary(f)],
    ['prod-trend-day', () => A.productionTrend(f, 'day')],
    ['prod-trend-week', () => A.productionTrend(f, 'week')],
    ['prod-trend-month', () => A.productionTrend(f, 'month')],
    ['prod-bd-wc', () => A.productionBreakdown(f, 'work_center', 10)],
    ['prod-bd-domain', () => A.productionBreakdown(f, 'process_domain', 8)],
    ['prod-bd-category', () => A.productionBreakdown(f, 'category', 5)],
    ['prod-bd-product', () => A.productionBreakdown(f, 'product', 10)],
    ['prod-bd-final', () => A.productionBreakdown(f, 'final_group', 6)]
  ];
  for (const [name, fn] of calls) {
    try { fn(); pass += 1; } catch (e) { fails.push(`production ${JSON.stringify(combo)} | ${name}: ${e.message}`); }
  }
}
console.log('\n------------------------------');
console.log(`پرس‌وجوهای موفق: ${pass}`);
console.log(`پرس‌وجوهای ناموفق: ${fails.length}`);
if (fails.length) {
  console.log('\nنمونه خطاها:');
  console.log([...new Set(fails)].slice(0, 20).join('\n'));
  process.exit(1);
} else {
  console.log('همه پرس‌وجوها سالم هستند ✅');
}
