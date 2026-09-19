/* صفحه‌های سامانه: هر صفحه شاخص‌ها، نمودارها و توضیح‌های خود را دارد */
import { api, filterQuery, faInt, faDec, escapeHtml, downloadCsv, toast, state } from './core.js';
import { barH, pareto, trendCombo, donut, scatter, deltaBars, productionChart } from './charts.js';
import {
  cardShell, kpiCard, loadingCard, emptyCard, dataTable, matrixTable, infoPopoverHtml
} from './ui.js';
import { GLOSSARY } from './glossary.js';

const DEFECT_LABEL = { inprocess: 'تعداد عیوب', inspection: 'تعداد واحد معیوب' };

function defectWord() {
  return DEFECT_LABEL[state.source] || DEFECT_LABEL.inprocess;
}

function sourceNote() {
  return state.source === 'inprocess'
    ? 'منبع: گزارش کیفیت حین تولید (ریز عیوب ثبت‌شده در ایستگاه‌ها)'
    : 'منبع: اسناد بازرسی (تعداد دستگاه معیوب؛ ردیف‌های تکراری عملیات حذف شده است)';
}

function grid(cols, content, className = '') {
  return `<div class="grid grid-${cols} ${className}">${content}</div>`;
}

async function get(path, extra = {}) {
  return api(path + filterQuery(extra));
}

/* ============================================================ نمای کلی */
export const home = {
  id: 'home',
  title: 'نمای کلی کیفیت',
  subtitle: 'یک نگاه سریع به وضعیت تولید، عیوب و شاخص PPM',
  roles: ['admin', 'executive', 'expert'],
  async render(root) {
    root.innerHTML = loadingCard();
    const [s, tr, defectBd, stationBd, productBd, causeBd] = await Promise.all([
      get('/api/summary'),
      get('/api/trend', { group: 'month' }),
      get('/api/breakdown', { dim: 'defect', limit: 12 }),
      get('/api/breakdown', { dim: 'station', limit: 10 }),
      get('/api/breakdown', { dim: 'product', limit: 10 }),
      get('/api/breakdown', { dim: state.source === 'inprocess' ? 'cause_6m' : 'shift', limit: 8 })
    ]);

    const kpis = [
      kpiCard({ label: 'تعداد تولید (سالم)', value: faInt(s.production), unit: 'دستگاه', info: 'production', delta: s.delta?.production, hint: 'مبنای محاسبه PPM' }),
      kpiCard({ label: defectWord(), value: faInt(s.defects), unit: 'مورد', info: state.source, delta: s.delta?.defects, tone: 'warn' }),
      kpiCard({ label: 'شاخص PPM', value: faInt(s.ppm), unit: 'عیب در میلیون', info: 'ppm', delta: s.delta?.ppm, tone: s.ppm > 10000 ? 'danger' : 'warn' }),
      kpiCard({ label: 'تعداد سفارش‌ها', value: faInt(s.orders), unit: 'سفارش', info: 'orders', sub: `${faInt(s.orders_with_defect)} سفارش دارای عیب` }),
      kpiCard({ label: 'نرخ ضایعات', value: faDec(s.scrap_rate, 2), unit: '٪', info: 'scrap_rate', tone: 'muted' }),
      state.source === 'inprocess'
        ? kpiCard({ label: 'زمان صرف‌شده رفع عیب', value: faDec(s.rework_hours, 1), unit: 'ساعت', info: 'rework_hours', tone: 'muted' })
        : kpiCard({ label: 'ضایعات ثبت‌شده', value: faInt(s.scrap), unit: 'دستگاه', info: 'scrap_rate', tone: 'muted' })
    ].join('');

    root.innerHTML = `
      ${grid(3, kpis, 'kpi-grid')}
      ${grid(1, cardShell({
        title: 'روند تولید، عیوب و PPM در زمان',
        subtitle: 'ستون‌ها تعداد تولید و عیوب؛ خط قرمز شاخص PPM است',
        info: 'ppm',
        body: '<div class="chart chart-lg" id="home-trend"></div>',
        foot: sourceNote()
      }))}
      ${grid(2, `
        ${cardShell({
          title: 'پارتو عیوب (مهم‌ترین عیب‌ها)',
          subtitle: 'ستون‌ها تعداد عیب و خط نارنجی سهم تجمعی',
          info: 'pareto',
          body: '<div class="chart" id="home-pareto"></div>'
        })}
        ${cardShell({
          title: 'توزیع عیوب بر اساس ایستگاه',
          subtitle: 'کدام ایستگاه بیشترین عیب را دارد',
          info: 'station',
          body: '<div class="chart" id="home-station"></div>'
        })}
      `)}
      ${grid(2, `
        ${cardShell({
          title: 'محصولات پرعیب',
          subtitle: '۱۰ محصول با بیشترین عیب در بازه انتخابی',
          body: '<div class="chart" id="home-product"></div>'
        })}
        ${cardShell({
          title: state.source === 'inprocess' ? 'تحلیل ریشه‌ای (6M)' : 'توزیع بر اساس شیفت',
          subtitle: state.source === 'inprocess' ? 'عیب ناشی از ماشین، مواد، اپراتور یا روش؟' : 'عملکرد شیفت‌های مختلف',
          info: state.source === 'inprocess' ? 'cause_6m' : null,
          body: '<div class="chart" id="home-cause"></div>'
        })}
      `)}
    `;

    trendCombo(root.querySelector('#home-trend'), tr, { target: Number(state.meta?.settings?.ppm_target) || 0 });
    if (defectBd.length) pareto(root.querySelector('#home-pareto'), defectBd, { valueName: defectWord() });
    else root.querySelector('#home-pareto').innerHTML = emptyCard();
    if (stationBd.length) barH(root.querySelector('#home-station'), stationBd, { valueName: defectWord() });
    if (productBd.length) barH(root.querySelector('#home-product'), productBd, { valueName: defectWord() });
    if (causeBd.length) donut(root.querySelector('#home-cause'), causeBd, { valueName: defectWord() });
  }
};

/* ============================================================ داشبورد مدیریتی */
export const management = {
  id: 'management',
  title: 'داشبورد مدیریتی',
  subtitle: 'خلاصه‌ای برای تصمیم‌گیری: روند، مقایسه دوره‌ها، تمرکز بر محصولات و ایستگاه‌های پرمخاطره',
  roles: ['admin', 'executive'],
  async render(root) {
    root.innerHTML = loadingCard();
    const [s, tr, branchBd, productBd, groupBd, defectBd, stationBd, matrix, prevStation] = await Promise.all([
      get('/api/summary'),
      get('/api/trend', { group: 'month' }),
      get('/api/breakdown', { dim: 'branch', limit: 6 }),
      get('/api/breakdown', { dim: 'product', limit: 40 }),
      get('/api/breakdown', { dim: 'final_group', limit: 8 }),
      get('/api/breakdown', { dim: 'defect_group', limit: 8 }),
      get('/api/breakdown', { dim: 'station', limit: 12 }),
      get('/api/matrix', { row: 'final_group', col: 'defect_group', rows: 8, cols: 5 }),
      (async () => {
        const prev = await api('/api/summary' + filterQuery({ from: s.prev?.from, to: s.prev?.to }));
        return prev;
      })().catch(() => null)
    ]);

    const prevStationBd = s.prev
      ? await get('/api/breakdown', { dim: 'station', limit: 12, from: s.prev.from, to: s.prev.to }).catch(() => [])
      : [];
    const prevMap = new Map(prevStationBd.map((r) => [r.key, r.ppm]));
    const deltaRows = stationBd
      .map((r) => ({ label: r.label, current: r.ppm, prev: prevMap.get(r.key) ?? 0, delta: prevMap.get(r.key) ? ((r.ppm - prevMap.get(r.key)) / prevMap.get(r.key)) * 100 : 100 }))
      .filter((r) => r.prev > 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    root.innerHTML = `
      ${grid(3, [
        kpiCard({ label: 'تولید دوره', value: faInt(s.production), unit: 'دستگاه', info: 'production', delta: s.delta?.production }),
        kpiCard({ label: defectWord(), value: faInt(s.defects), unit: 'مورد', info: state.source, delta: s.delta?.defects, tone: 'warn' }),
        kpiCard({ label: 'شاخص PPM', value: faInt(s.ppm), info: 'ppm', delta: s.delta?.ppm, tone: s.ppm > 10000 ? 'danger' : 'warn' }),
        kpiCard({ label: 'سفارش‌ها', value: faInt(s.orders), info: 'orders', sub: `${faInt(s.orders_with_defect)} سفارش دارای عیب` }),
        kpiCard({ label: 'نرخ ضایعات', value: faDec(s.scrap_rate, 2), unit: '٪', info: 'scrap_rate', tone: 'muted' }),
        kpiCard({ label: 'زمان رفع عیب', value: faDec(s.rework_hours, 1), unit: 'ساعت', info: 'rework_hours', tone: 'muted' })
      ].join(''), 'kpi-grid')}
      ${grid(1, cardShell({
        title: 'روند ماهانه تولید، عیوب و PPM',
        subtitle: s.prev ? `مقایسه با دوره قبل: ${faInt(s.prev.from)} تا ${faInt(s.prev.to)}` : 'بازه‌ای انتخاب کنید تا مقایسه دوره قبل نمایش داده شود',
        info: 'ppm',
        body: '<div class="chart chart-lg" id="mg-trend"></div>',
        foot: sourceNote()
      }))}
      ${grid(2, `
        ${cardShell({
          title: 'مقایسه برنچ‌ها',
          subtitle: 'تولید و عیوب به تفکیک برنچ',
          body: '<div class="chart" id="mg-branch"></div>'
        })}
        ${cardShell({
          title: 'دسته‌های عیب',
          subtitle: 'سهم هر دسته (ظاهری، لحیم‌کاری، عملکردی ...)',
          info: 'defect_group',
          body: '<div class="chart" id="mg-defectgroup"></div>'
        })}
      `)}
      ${grid(2, `
        ${cardShell({
          title: 'تغییر PPM نسبت به دوره قبل',
          subtitle: 'افزایش (قرمز) یا بهبود (سبز) به تفکیک ایستگاه',
          info: 'ppm',
          body: deltaRows.length ? '<div class="chart" id="mg-delta"></div>' : emptyCard('برای مقایسه با دوره قبل، یک بازه تاریخ مشخص (از/تا) انتخاب کنید')
        })}
        ${cardShell({
          title: 'تولید در برابر PPM محصولات',
          subtitle: 'هر نقطه یک محصول؛ بالا و راست = پرمخاطره‌تر',
          info: 'ppm',
          body: '<div class="chart" id="mg-scatter"></div>'
        })}
      `)}
      ${grid(2, `
        ${cardShell({
          title: 'جدول محوری: گروه محصول × دسته عیب',
          subtitle: 'تمرکز عیوب هر خانواده محصول',
          body: matrixTable(matrix, { rowHeader: 'گروه محصول' })
        })}
        ${cardShell({
          title: 'عملکرد محصولات',
          subtitle: 'مرتب بر اساس تعداد عیب',
          body: dataTable({
            columns: { label: 'محصول', defects: defectWord(), production: 'تولید', ppm: 'PPM', pct: 'سهم از عیوب (٪)' },
            rows: productBd.slice(0, 15),
            maxHeight: '380px'
          }),
          foot: sourceNote()
        })}
      `)}
    `;

    trendCombo(root.querySelector('#mg-trend'), tr, { target: Number(state.meta?.settings?.ppm_target) || 0 });
    if (branchBd.length) barH(root.querySelector('#mg-branch'), branchBd, { valueName: defectWord() });
    if (defectBd.length) donut(root.querySelector('#mg-defectgroup'), defectBd, { valueName: defectWord() });
    if (deltaRows.length) deltaBars(root.querySelector('#mg-delta'), deltaRows);
    const scatterRows = productBd.filter((r) => r.production > 0).slice(0, 15);
    if (scatterRows.length) scatter(root.querySelector('#mg-scatter'), scatterRows);
    else root.querySelector('#mg-scatter').innerHTML = emptyCard();
  }
};

/* ============================================================ تحلیل حین تولید */
export const inprocess = {
  id: 'inprocess',
  title: 'تحلیل عیوب حین تولید',
  subtitle: 'ریشه‌یابی دقیق: کد عیب، ایستگاه، قطعه، تامین‌کننده، عامل 6M و زمان تعمیرات',
  roles: ['admin', 'expert'],
  async render(root) {
    state.source = 'inprocess';
    root.innerHTML = loadingCard();
    const [s, defectBd, stationBd, domainBd, causeBd, partFamBd, partBd, supplierBd, operatorBd, failureBd, repairBd, processBd, matrix, timesBd] = await Promise.all([
      get('/api/summary'),
      get('/api/breakdown', { dim: 'defect', limit: 15 }),
      get('/api/breakdown', { dim: 'station', limit: 12 }),
      get('/api/breakdown', { dim: 'process_domain', limit: 10 }),
      get('/api/breakdown', { dim: 'cause_6m', limit: 8 }),
      get('/api/breakdown', { dim: 'part_family', limit: 10 }),
      get('/api/breakdown', { dim: 'part_name', limit: 10 }),
      get('/api/breakdown', { dim: 'registrar', limit: 8 }),
      get('/api/breakdown', { dim: 'operator', limit: 10 }),
      get('/api/breakdown', { dim: 'failure_mode', limit: 10 }),
      get('/api/breakdown', { dim: 'repair_action', limit: 6 }),
      get('/api/breakdown', { dim: 'process_name', limit: 10 }),
      get('/api/matrix', { row: 'defect', col: 'station', rows: 12, cols: 8 }),
      get('/api/times', { dim: 'station', limit: 8 })
    ]);

    root.innerHTML = `
      ${grid(3, [
        kpiCard({ label: 'تعداد عیوب', value: faInt(s.defects), unit: 'مورد', info: 'inprocess', delta: s.delta?.defects, tone: 'warn' }),
        kpiCard({ label: 'شاخص PPM', value: faInt(s.ppm), info: 'ppm', delta: s.delta?.ppm, tone: s.ppm > 10000 ? 'danger' : 'warn' }),
        kpiCard({ label: 'زمان رفع عیب', value: faDec(s.rework_hours, 1), unit: 'ساعت', info: 'rework_hours', sub: `عیب‌یابی ${faDec(s.troubleshoot_hours, 1)} · رفع ${faDec(s.fix_hours, 1)} · تست مجدد ${faDec(s.retest_hours, 1)} ساعت` }),
        kpiCard({ label: 'تولیدِ بازه', value: faInt(s.production), unit: 'دستگاه', info: 'production' }),
        kpiCard({ label: 'سفارش‌های دارای عیب', value: faInt(s.orders_with_defect), unit: `از ${faInt(s.orders)}`, info: 'orders' }),
        kpiCard({ label: 'میانگین RPN', value: faDec(s.rpn_avg, 1), unit: `بیشینه ${faInt(s.rpn_max)}`, info: 'rpn' })
      ].join(''), 'kpi-grid')}
      ${grid(1, cardShell({
        title: 'پارتو کدهای عیب',
        subtitle: 'مهم‌ترین عیب‌هایی که باید اولویت اصلاحی بگیرند',
        info: 'pareto',
        body: '<div class="chart chart-lg" id="ip-pareto"></div>',
        foot: sourceNote()
      }))}
      ${grid(2, `
        ${cardShell({ title: 'عیوب بر اساس ایستگاه', info: 'station', body: '<div class="chart" id="ip-station"></div>' })}
        ${cardShell({ title: 'عیوب بر اساس حوزه فرآیندی', info: 'process_domain', body: '<div class="chart" id="ip-domain"></div>' })}
      `)}
      ${grid(2, `
        ${cardShell({ title: 'عامل مسبب (6M)', subtitle: 'ریشه عیب از کجاست؟', info: 'cause_6m', body: '<div class="chart" id="ip-cause"></div>' })}
        ${cardShell({ title: 'اقدام تعمیرات', subtitle: 'بازکاری، تعمیر یا ضایعات', info: 'repair_action', body: '<div class="chart" id="ip-repair"></div>' })}
      `)}
      ${grid(2, `
        ${cardShell({ title: 'خانواده قطعات معیوب', body: '<div class="chart" id="ip-partfam"></div>' })}
        ${cardShell({ title: 'قطعات پرمشکل', body: '<div class="chart" id="ip-part"></div>' })}
      `)}
      ${grid(2, `
        ${cardShell({ title: 'ثبت‌کننده اطلاعات', subtitle: 'توزیع عیوب بر اساس کاربر ثبت‌کننده', body: '<div class="chart" id="ip-supplier"></div>' })}
        ${cardShell({ title: 'حالت خرابی بالقوه', info: 'inprocess', body: '<div class="chart" id="ip-failure"></div>' })}
      `)}
      ${grid(2, `
        ${cardShell({ title: 'اپراتورهای مسبب عیب', subtitle: 'در صورت ثبت در سیستم', body: '<div class="chart" id="ip-operator"></div>' })}
        ${cardShell({ title: 'فرآیندهای پرمشکل (OPC)', body: '<div class="chart" id="ip-process"></div>' })}
      `)}
      ${grid(1, cardShell({
        title: 'زمان صرف‌شده به تفکیک ایستگاه',
        subtitle: 'مجموع زمان عیب‌یابی، رفع عیب و تست مجدد (ساعت)',
        info: 'rework_hours',
        body: dataTable({
          columns: {
            label: 'ایستگاه',
            troubleshoot_h: 'عیب‌یابی (ساعت)',
            fix_h: 'رفع عیب (ساعت)',
            retest_h: 'تست مجدد (ساعت)',
            total_h: 'جمع (ساعت)',
            defects: 'تعداد عیوب',
            min_per_defect: 'دقیقه به ازای هر عیب'
          },
          rows: timesBd.map((r) => ({
            label: r.label,
            troubleshoot_h: faDec(r.troubleshoot_min / 60, 1),
            fix_h: faDec(r.fix_min / 60, 1),
            retest_h: faDec(r.retest_min / 60, 1),
            total_h: faDec((r.fix_min + r.retest_min + r.troubleshoot_min) / 60, 1),
            defects: r.defects,
            min_per_defect: r.defects ? faDec((r.fix_min + r.retest_min + r.troubleshoot_min) / r.defects, 2) : '—'
          })),
          maxHeight: '320px'
        })
      }))}
      ${grid(1, cardShell({
        title: 'جدول محوری: کد عیب × ایستگاه',
        subtitle: 'هر عیب در کدام ایستگاه رخ می‌دهد',
        body: matrixTable(matrix, { rowHeader: 'کد عیب' })
      }))}
    `;

    pareto(root.querySelector('#ip-pareto'), defectBd, { limit: 15 });
    barH(root.querySelector('#ip-station'), stationBd);
    barH(root.querySelector('#ip-domain'), domainBd);
    donut(root.querySelector('#ip-cause'), causeBd);
    donut(root.querySelector('#ip-repair'), repairBd);
    barH(root.querySelector('#ip-partfam'), partFamBd);
    barH(root.querySelector('#ip-part'), partBd);
    barH(root.querySelector('#ip-supplier'), supplierBd);
    barH(root.querySelector('#ip-failure'), failureBd);
    barH(root.querySelector('#ip-operator'), operatorBd);
    barH(root.querySelector('#ip-process'), processBd);
  }
};

/* ============================================================ تحلیل بازرسی */
export const inspection = {
  id: 'inspection',
  title: 'تحلیل اسناد بازرسی (OQC)',
  subtitle: 'نتیجه بازرسی‌های رسمی: چند دستگاه مردود شده و به چه دلیل',
  roles: ['admin', 'expert'],
  async render(root) {
    state.source = 'inspection';
    root.innerHTML = loadingCard();
    const [s, defectBd, stationBd, shiftBd, opBd, productBd, matrix] = await Promise.all([
      get('/api/summary'),
      get('/api/breakdown', { dim: 'defect', limit: 15 }),
      get('/api/breakdown', { dim: 'station', limit: 12 }),
      get('/api/breakdown', { dim: 'shift', limit: 6 }),
      get('/api/breakdown', { dim: 'operation', limit: 12 }),
      get('/api/breakdown', { dim: 'product', limit: 30 }),
      get('/api/matrix', { row: 'product', col: 'defect', rows: 10, cols: 6 })
    ]);

    root.innerHTML = `
      ${grid(3, [
        kpiCard({ label: 'تولید بازرسی‌شده', value: faInt(s.production), unit: 'دستگاه', info: 'production' }),
        kpiCard({ label: 'تعداد واحد معیوب', value: faInt(s.defects), unit: 'دستگاه', info: 'defect_units', delta: s.delta?.defects, tone: 'warn' }),
        kpiCard({ label: 'شاخص PPM', value: faInt(s.ppm), info: 'ppm', delta: s.delta?.ppm, tone: s.ppm > 10000 ? 'danger' : 'warn' }),
        kpiCard({ label: 'تعداد سفارش‌ها', value: faInt(s.orders), info: 'orders', sub: `${faInt(s.orders_with_defect)} سفارش دارای ایراد` }),
        kpiCard({ label: 'نرخ ضایعات', value: faDec(s.scrap_rate, 2), unit: '٪', info: 'scrap_rate' }),
        kpiCard({ label: 'برنامه‌ریزی‌شده', value: faInt(s.planned), unit: 'دستگاه', hint: 'مقدار کل برنامه‌ریزی شده سفارش‌ها', tone: 'muted' })
      ].join(''), 'kpi-grid')}
      ${grid(1, cardShell({
        title: 'پارتو دلایل مردودی',
        subtitle: 'بیشترین دلایل رد شدن محصول در بازرسی',
        info: 'pareto',
        body: '<div class="chart chart-lg" id="ins-pareto"></div>',
        foot: sourceNote() + ' · ' + GLOSSARY.dedup.text
      }))}
      ${grid(2, `
        ${cardShell({ title: 'مردودی بر اساس ایستگاه بازرسی', info: 'station', body: '<div class="chart" id="ins-station"></div>' })}
        ${cardShell({ title: 'مردودی بر اساس عنوان عملیات آزمایش', body: '<div class="chart" id="ins-op"></div>' })}
      `)}
      ${grid(2, `
        ${cardShell({ title: 'توزیع بر اساس شیفت', body: '<div class="chart" id="ins-shift"></div>' })}
        ${cardShell({ title: 'محصولات با بیشترین مردودی', body: '<div class="chart" id="ins-product"></div>' })}
      `)}
      ${grid(1, cardShell({
        title: 'جدول محوری: محصول × دلیل مردودی',
        body: matrixTable(matrix, { rowHeader: 'محصول' })
      }))}
    `;

    pareto(root.querySelector('#ins-pareto'), defectBd, { limit: 15, valueName: 'تعداد واحد معیوب' });
    barH(root.querySelector('#ins-station'), stationBd, { valueName: 'تعداد واحد معیوب' });
    barH(root.querySelector('#ins-op'), opBd, { valueName: 'تعدد واحد معیوب' });
    donut(root.querySelector('#ins-shift'), shiftBd, { valueName: 'تعداد واحد معیوب' });
    barH(root.querySelector('#ins-product'), productBd.slice(0, 12), { valueName: 'تعداد واحد معیوب' });
  }
};

/* ============================================================ PFMEA */
export const pfmea = {
  id: 'pfmea',
  title: 'تحلیل حالات خرابی (PFMEA / RPN)',
  subtitle: 'اولویت‌بندی ریسک بر اساس RPN = شدت × وقوع × تشخیص',
  roles: ['admin', 'expert'],
  async render(root) {
    root.innerHTML = loadingCard();
    const [s, rows] = await Promise.all([
      get('/api/summary'),
      get('/api/pfmea', { limit: 60 })
    ]);
    const chartRows = rows.slice(0, 12).map((r) => ({ label: r.failure_mode, defects: Number(r.rpn_max || 0), production: r.defects }));

    root.innerHTML = `
      ${grid(3, [
        kpiCard({ label: 'میانگین RPN', value: faDec(s.rpn_avg, 1), info: 'rpn' }),
        kpiCard({ label: 'بیشینه RPN', value: faInt(s.rpn_max), info: 'rpn', tone: s.rpn_max >= 100 ? 'danger' : 'warn' }),
        kpiCard({ label: 'حالت‌های خرابی ثبت‌شده', value: faInt(rows.length), unit: 'مورد', hint: 'تعداد ردیف‌های دارای امتیاز شدت/وقوع/تشخیص', tone: 'muted' })
      ].join('', ''), 'kpi-grid')}
      ${grid(1, cardShell({
        title: 'چه می‌گوید؟',
        subtitle: 'هرچه RPN بزرگ‌تر باشد، اقدام اصلاحی فوری‌تر است',
        body: `<div class="explain">
            <p><b>RPN</b> حاصل‌ضرب سه امتیاز است: <b>شدت</b> اثر خرابی (S)، <b>وقوع</b> یا تکرارپذیری (O) و <b>توانایی تشخیص</b> (D).
            هر کدام از ۱ تا ۱۰ امتیاز می‌گیرند. به‌طور معمول RPN بالای ۱۰۰ نیازمند اقدام اصلاحی فوری است.</p>
          </div>`
      }))}
      ${grid(2, `
        ${cardShell({
          title: 'بحرانی‌ترین حالت‌های خرابی',
          subtitle: 'بر اساس بیشینه RPN',
          body: rows.length ? '<div class="chart" id="pf-chart"></div>' : emptyCard('داده‌ای با امتیاز RPN در این بازه ثبت نشده است')
        })}
        ${cardShell({
          title: 'شدت در برابر وقوع',
          subtitle: 'اندازه هر نقطه بر اساس RPN است',
          body: rows.length ? '<div class="chart" id="pf-scatter"></div>' : emptyCard()
        })}
      `)}
      ${grid(1, cardShell({
        title: 'جدول تحلیل PFMEA',
        subtitle: 'مرتب بر اساس RPN',
        body: dataTable({
          columns: {
            failure_mode: 'حالت خرابی بالقوه',
            failure_mode_type: 'نوع',
            process_name: 'فرآیند',
            station: 'ایستگاه',
            severity: 'شدت (S)',
            occurrence: 'وقوع (O)',
            detection: 'تشخیص (D)',
            rpn_max: 'RPN (بیشینه)',
            defects: 'تعداد عیوب'
          },
          rows: rows.map((r) => ({
            failure_mode: r.failure_mode,
            failure_mode_type: r.failure_mode_type,
            process_name: r.process_name,
            station: r.station,
            severity: r.severity,
            occurrence: r.occurrence,
            detection: r.detection,
            rpn_max: r.rpn_max,
            defects: r.defects
          })),
          onRowClass: (r) => (Number(r.rpn_max) >= 100 ? 'row-danger' : (Number(r.rpn_max) >= 60 ? 'row-warn' : '')),
          maxHeight: '520px'
        }),
        foot: 'ستون‌های S و O و D میانگین ردیف‌های همان حالت خرابی هستند'
      }))}
    `;

    if (rows.length) {
      barH(root.querySelector('#pf-chart'), chartRows, { valueName: 'RPN', color: '#c0504d' });
      const sc = window.echarts.init(root.querySelector('#pf-scatter'));
      sc.setOption({
        grid: { left: 12, right: 24, top: 26, bottom: 30, containLabel: true },
        tooltip: {
          trigger: 'item',
          formatter: (p) => {
            const r = rows[p.dataIndex];
            return `<b>${escapeHtml(r.failure_mode)}</b><br/>شدت: ${faDec(r.severity, 1)}<br/>وقوع: ${faDec(r.occurrence, 1)}<br/>تشخیص: ${faDec(r.detection, 1)}<br/>RPN: ${faInt(r.rpn_max)}`;
          }
        },
        xAxis: { name: 'وقوع (O)', type: 'value', min: 0, max: 10, splitLine: { lineStyle: { color: '#eef2f7' } } },
        yAxis: { name: 'شدت (S)', type: 'value', min: 0, max: 10, splitLine: { lineStyle: { color: '#eef2f7' } } },
        series: [{
          type: 'scatter',
          data: rows.slice(0, 40).map((r) => [Number(r.occurrence.toFixed(2)), Number(r.severity.toFixed(2))]),
          symbolSize: (v, p) => Math.max(10, Math.min(40, Number(rows[p.dataIndex].rpn_max) / 5)),
          itemStyle: { color: (p) => (rows[p.dataIndex].rpn_max >= 100 ? '#c0504d' : rows[p.dataIndex].rpn_max >= 60 ? '#e08a2e' : '#2f6fb3') }
        }]
      });
      new ResizeObserver(() => sc.resize()).observe(root.querySelector('#pf-scatter'));
    }
  }
};

/* ============================================================ تولید */
export const production = {
  id: 'production',
  title: 'گزارش تولید',
  subtitle: 'حجم تولید روزانه به تفکیک مرکز کاری، محصول و پرسنل',
  roles: ['admin', 'executive', 'expert'],
  group: 'day',
  async render(root) {
    root.innerHTML = loadingCard();
    const group = production.group || 'day';
    const [s, tr, wcs, domains, branches, products] = await Promise.all([
      get('/api/production/summary'),
      get('/api/production/trend', { group }),
      get('/api/production/breakdown', { dim: 'work_center', limit: 15 }),
      get('/api/production/breakdown', { dim: 'process_domain', limit: 8 }),
      get('/api/production/breakdown', { dim: 'branch', limit: 5 }),
      get('/api/production/breakdown', { dim: 'product', limit: 15 })
    ]);

    root.innerHTML = `
      ${grid(3, [
        kpiCard({ label: 'تولید سالم', value: faInt(s.production), unit: 'دستگاه', info: 'production' }),
        kpiCard({ label: 'ضایعات', value: faInt(s.scrap), unit: 'دستگاه', info: 'scrap_rate', tone: 'warn' }),
        kpiCard({ label: 'نفر-روز پرسنل', value: faInt(s.personnel), unit: 'نفر', hint: 'مجموع تعداد پرسنل ثبت‌شده در اسناد عملکرد', tone: 'muted' }),
        kpiCard({ label: 'اسناد عملکرد', value: faInt(s.docs), info: 'work_center' }),
        kpiCard({ label: 'تعداد کالا', value: faInt(s.products), tone: 'muted' }),
        kpiCard({ label: 'مراکز کاری فعال', value: faInt(s.work_centers), tone: 'muted' })
      ].join(''), 'kpi-grid')}
      ${grid(1, cardShell({
        title: 'روند تولید در زمان',
        subtitle: 'تولید سالم، ضایعات و پرسنل',
        info: 'work_center',
        actions: `
          <div class="seg" id="prod-group">
            <button data-g="day" class="${group === 'day' ? 'active' : ''}">روزانه</button>
            <button data-g="week" class="${group === 'week' ? 'active' : ''}">هفتگی</button>
            <button data-g="month" class="${group === 'month' ? 'active' : ''}">ماهانه</button>
          </div>`,
        body: '<div class="chart chart-lg" id="pr-trend"></div>',
        foot: 'هر «سند عملکرد» خروجی یک مرکز کاری در یک روز است؛ جمع اسناد، حجم کل کار انجام‌شده را نشان می‌دهد'
      }))}
      ${grid(2, `
        ${cardShell({ title: 'تولید به تفکیک مرکز کاری', info: 'work_center', body: '<div class="chart" id="pr-wc"></div>' })}
        ${cardShell({ title: 'تولید به تفکیک حوزه فرآیندی', info: 'process_domain', body: '<div class="chart" id="pr-domain"></div>' })}
      `)}
      ${grid(2, `
        ${cardShell({ title: 'تولید به تفکیک برنچ', body: '<div class="chart" id="pr-branch"></div>' })}
        ${cardShell({
          title: 'پرمحصول‌ترین کالاها',
          body: dataTable({
            columns: { label: 'کالا', production: 'تولید', scrap: 'ضایعات', personnel: 'پرسنل', docs: 'اسناد' },
            rows: products.slice(0, 12),
            maxHeight: '340px'
          })
        })}
      `)}
    `;

    productionChart(root.querySelector('#pr-trend'), tr);
    barH(root.querySelector('#pr-wc'), wcs.map((r) => ({ ...r, defects: r.production })), { valueName: 'تولید', color: '#3f9e78' });
    barH(root.querySelector('#pr-domain'), domains.map((r) => ({ ...r, defects: r.production })), { valueName: 'تولید', color: '#3f9e78' });
    barH(root.querySelector('#pr-branch'), branches.map((r) => ({ ...r, defects: r.production })), { valueName: 'تولید', color: '#3f9e78' });

    root.querySelectorAll('#prod-group button').forEach((b) => {
      b.addEventListener('click', () => {
        production.group = b.dataset.g;
        const shell = root.closest('.app-main') || document;
        production.render(document.getElementById('page-root') || shell);
      });
    });
  }
};

/* ============================================================ رکوردهای تفصیلی */
export const recordsPage = {
  id: 'records',
  title: 'رکوردهای تفصیلی عیوب',
  subtitle: 'مشاهده و جست‌وجوی ردیف‌به‌ردیف داده‌ها (مخصوص کارشناسان)',
  roles: ['admin', 'expert'],
  page: 1,
  size: 25,
  sort: 'defect_qty',
  dir: 'DESC',
  q: '',
  async render(root) {
    root.innerHTML = loadingCard();
    const res = await get('/api/records', {
      page: recordsPage.page, size: recordsPage.size, sort: recordsPage.sort, dir: recordsPage.dir, q: recordsPage.q
    });
    const cols = res.columns;
    const pageCount = Math.max(1, Math.ceil(res.total / res.size));

    root.innerHTML = `
      ${grid(3, [
        kpiCard({ label: 'تعداد ردیف‌ها', value: faInt(res.total), unit: 'ردیف', hint: 'با فیلترهای جاری' }),
        kpiCard({ label: 'جمع عیوب', value: faInt(res.defectsSum), unit: 'مورد', tone: 'warn' }),
        kpiCard({ label: 'منبع داده', value: state.source === 'inprocess' ? 'حین تولید' : 'اسناد بازرسی', tone: 'muted', hint: sourceNote() })
      ].join(''), 'kpi-grid')}
      ${cardShell({
        title: 'جدول رکوردها',
        subtitle: 'برای مرتب‌سازی روی عنوان ستون کلیک کنید',
        actions: `
          <input type="search" class="input search-input" id="rec-q" placeholder="جست‌وجو در سفارش، شرح عیب، قطعه..." value="${escapeHtml(recordsPage.q)}" />
          <select class="input" id="rec-size">
            ${[25, 50, 100, 200].map((n) => `<option value="${n}" ${n === recordsPage.size ? 'selected' : ''}>${faInt(n)} ردیف</option>`).join('')}
          </select>
          <button class="btn btn-ghost" id="rec-csv">خروجی Excel (CSV)</button>
        `,
        body: `<div id="rec-table">${dataTable({
          columns: cols,
          rows: res.rows,
          maxHeight: '560px'
        })}</div>`,
        foot: `
          <div class="pager">
            <button class="btn btn-ghost" id="rec-prev" ${recordsPage.page <= 1 ? 'disabled' : ''}>قبلی</button>
            <span>صفحه ${faInt(recordsPage.page)} از ${faInt(pageCount)}</span>
            <button class="btn btn-ghost" id="rec-next" ${recordsPage.page >= pageCount ? 'disabled' : ''}>بعدی</button>
          </div>`
      })}
    `;

    const headerCells = root.querySelectorAll('#rec-table thead th');
    headerCells.forEach((th, i) => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const key = Object.keys(cols)[i];
        if (recordsPage.sort === key) recordsPage.dir = recordsPage.dir === 'DESC' ? 'ASC' : 'DESC';
        else { recordsPage.sort = key; recordsPage.dir = 'DESC'; }
        recordsPage.render(root);
      });
    });

    let timer = null;
    root.querySelector('#rec-q').addEventListener('input', (e) => {
      clearTimeout(timer);
      const v = e.target.value;
      timer = setTimeout(() => { recordsPage.q = v; recordsPage.page = 1; recordsPage.render(root); }, 350);
    });
    root.querySelector('#rec-size').addEventListener('change', (e) => {
      recordsPage.size = Number(e.target.value); recordsPage.page = 1; recordsPage.render(root);
    });
    root.querySelector('#rec-prev')?.addEventListener('click', () => { recordsPage.page -= 1; recordsPage.render(root); });
    root.querySelector('#rec-next')?.addEventListener('click', () => { recordsPage.page += 1; recordsPage.render(root); });
    root.querySelector('#rec-csv').addEventListener('click', async () => {
      const all = await get('/api/records', { page: 1, size: 500, sort: recordsPage.sort, dir: recordsPage.dir, q: recordsPage.q });
      downloadCsv(`qc-records-${state.source}.csv`, all.columns, all.rows);
      toast(`${faInt(all.rows.length)} ردیف خروجی گرفته شد`);
    });
  }
};

/* ============================================================ مدیریت سیستم */
export const admin = {
  id: 'admin',
  title: 'مدیریت داده و کاربران',
  subtitle: 'بارگذاری فایل‌های جدید، مشاهده وضعیت داده‌ها، مدیریت کاربران و تنظیمات',
  roles: ['admin'],
  async render(root) {
    root.innerHTML = loadingCard();
    const [files, users, settings] = await Promise.all([
      api('/api/admin/files'),
      api('/api/admin/users'),
      api('/api/admin/settings')
    ]);

    const fileRows = files.files.map((f) => {
      const rec = f.records[0];
      const typeLabel = {
        inprocess: 'عیوب حین تولید', inspection: 'اسناد بازرسی',
        production: 'تعداد تولید', product: 'گروه‌بندی محصولات'
      }[rec?.source_type] || rec?.source_type || '—';
      return {
        name: f.name,
        type: typeLabel,
        rows: rec?.rows_loaded ?? '—',
        at: (rec?.imported_at || f.modified || '').replace('T', ' ').slice(0, 16),
        status: rec?.status === 'ok' ? 'موفق' : (rec?.status || '—')
      };
    });

    root.innerHTML = `
      ${grid(2, `
        ${cardShell({
          title: 'به‌روزرسانی داده‌ها',
          subtitle: 'فایل اکسل جدید را بارگذاری کنید یا همه فایل‌های پوشه را دوباره بخوانید',
          info: 'inprocess',
          body: `
            <div class="upload-area" id="upload-area">
              <input type="file" id="file-input" accept=".xlsx,.xlsm" hidden />
              <div class="upload-icon">📥</div>
              <p>فایل اکسل را اینجا رها کنید یا <button class="btn-link" id="pick-file">انتخاب فایل</button></p>
              <small>فرمت‌های پشتیبانی‌شده: گزارش کیفیت حین تولید، گزارش عیب‌های سند بازرسی،
              گزارش تعداد تولید، گروه‌بندی محصولات (تشخیص بر اساس ستون‌ها انجام می‌شود)</small>
            </div>
            <div class="row-actions">
              <button class="btn btn-primary" id="btn-refresh">به‌روزرسانی همه داده‌ها</button>
              <span class="hint">فایل‌های تازه را در پوشه data/raw بریزید و این دکمه را بزنید</span>
            </div>
            <div id="upload-result"></div>
          `
        })}
        ${cardShell({
          title: 'فایل‌های بارگذاری‌شده',
          subtitle: 'وضعیت هر فایل و تعداد ردیف‌های خوانده‌شده',
          body: dataTable({
            columns: { name: 'فایل', type: 'نوع داده', rows: 'ردیف‌ها', at: 'آخرین بارگذاری', status: 'وضعیت' },
            rows: fileRows,
            maxHeight: '300px'
          }),
          foot: 'حذف فایل باعث حذف داده‌های همان فایل از پایگاه داده می‌شود'
        })}
      `)}
      ${grid(2, `
        ${cardShell({
          title: 'کاربران و دسترسی‌ها',
          subtitle: 'نقش هر کاربر تعیین می‌کند کدام صفحه‌ها را ببیند',
          body: dataTable({
            columns: { username: 'نام کاربری', display_name: 'نام', role: 'نقش', has_password: 'رمز', active: 'فعال' },
            rows: users.map((u) => ({
              username: u.username,
              display_name: u.display_name,
              role: ({ admin: 'مدیر سیستم', executive: 'مدیر ارشد', expert: 'کارشناس کیفیت' })[u.role] || u.role,
              has_password: u.has_password ? 'دارد' : 'ندارد',
              active: u.active ? 'بله' : 'خیر'
            })),
            maxHeight: '260px'
          }),
          foot: `
            <details><summary>افزودن / ویرایش کاربر</summary>
              <div class="form-grid" style="margin-top:10px">
                <input class="input" id="u-user" placeholder="نام کاربری (لاتین)" />
                <input class="input" id="u-name" placeholder="نام نمایشی" />
                <select class="input" id="u-role">
                  <option value="admin">مدیر سیستم</option>
                  <option value="executive">مدیر ارشد</option>
                  <option value="expert">کارشناس کیفیت</option>
                </select>
                <input class="input" id="u-pass" placeholder="رمز عبور (اختیاری)" />
                <button class="btn btn-primary" id="u-save">ذخیره کاربر</button>
              </div>
              <p class="hint">اگر نام کاربری موجود باشد، اطلاعات آن به‌روزرسانی می‌شود. گذاشتن رمز اختیاری است (برای نسخه تحت شبکه توصیه می‌شود).</p>
            </details>`
        })}
        ${cardShell({
          title: 'تنظیمات',
          subtitle: 'هدف‌گذاری شاخص‌ها و مشخصات شرکت',
          info: 'target',
          body: `
            <div class="form-grid">
              ${settings.map((s) => `
                <label class="field">
                  <span>${escapeHtml(s.label)}</span>
                  <input class="input" data-setting="${s.key}" value="${escapeHtml(s.value || '')}" />
                  <small>${escapeHtml(s.description || '')}</small>
                </label>`).join('')}
            </div>
            <div class="row-actions"><button class="btn btn-primary" id="save-settings">ذخیره تنظیمات</button></div>
          `
        })}
      `)}
    `;

    // --- تعاملات
    const input = root.querySelector('#file-input');
    const area = root.querySelector('#upload-area');
    root.querySelector('#pick-file').addEventListener('click', () => input.click());
    ['dragenter', 'dragover'].forEach((ev) => area.addEventListener(ev, (e) => { e.preventDefault(); area.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => area.addEventListener(ev, () => area.classList.remove('drag')));
    area.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) upload(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files[0]) upload(input.files[0]); });

    async function upload(file) {
      const fd = new FormData();
      fd.append('file', file);
      const box = root.querySelector('#upload-result');
      box.innerHTML = loadingCard(`در حال بارگذاری ${escapeHtml(file.name)}…`);
      try {
        const res = await api('/api/admin/upload', { method: 'POST', body: fd });
        box.innerHTML = `<div class="success-box">فایل <b>${escapeHtml(res.file)}</b> با موفقیت بارگذاری و داده‌ها به‌روز شد.<br/>
          <small>ردیف‌های جدید: ${faInt(res.result.files?.[0]?.rows || 0)}</small></div>`;
        toast('داده‌ها به‌روزرسانی شد');
        setTimeout(() => admin.render(root), 900);
      } catch (err) {
        box.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
      }
    }

    root.querySelector('#btn-refresh').addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'در حال به‌روزرسانی…';
      try {
        const res = await api('/api/admin/refresh', { method: 'POST' });
        toast(`به‌روزرسانی انجام شد: ${faInt(res.result.totals.inprocess + res.result.totals.inspection + res.result.totals.production)} ردیف`);
        admin.render(root);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    root.querySelector('#u-save').addEventListener('click', async () => {
      const body = {
        username: root.querySelector('#u-user').value.trim(),
        display_name: root.querySelector('#u-name').value.trim(),
        role: root.querySelector('#u-role').value,
        password: root.querySelector('#u-pass').value
      };
      try {
        await api('/api/admin/users', { method: 'POST', body });
        toast('کاربر ذخیره شد');
        admin.render(root);
      } catch (err) { toast(err.message, 'error'); }
    });

    root.querySelector('#save-settings').addEventListener('click', async (e) => {
      const body = {};
      root.querySelectorAll('[data-setting]').forEach((i) => { body[i.dataset.setting] = i.value; });
      e.target.disabled = true;
      try {
        await api('/api/admin/settings', { method: 'PUT', body });
        toast('تنظیمات ذخیره شد');
        state.meta = await api('/api/meta');
      } catch (err) { toast(err.message, 'error'); }
    });
  }
};

/* ============================================================ راهنما */
export const guide = {
  id: 'guide',
  title: 'راهنما و واژه‌نامه',
  subtitle: 'هر شاخص چه می‌گوید و داده‌ها چگونه به‌روز می‌شوند',
  roles: ['admin', 'executive', 'expert'],
  async render(root) {
    const entries = Object.entries(GLOSSARY).map(([key, g]) => `
      <div class="glossary-item">
        <h4>${g.title}</h4>
        <div class="glossary-formula">${g.formula}</div>
        <p>${g.text}</p>
      </div>`).join('');

    root.innerHTML = `
      ${grid(2, `
        ${cardShell({
          title: 'داده‌ها از کجا می‌آیند؟',
          body: `
            <div class="explain">
              <p>سامانه از چهار فایل اکسلِ شما یک پایگاه داده می‌سازد و همه نمودارها از همان پایگاه خوانده می‌شوند:</p>
              <ul>
                <li><b>اطلاعات جامع کیفیت حین تولید</b> — ریز عیوب ثبت‌شده در ایستگاه‌ها همراه با عامل مسبب (6M)، قطعه، تامین‌کننده، زمان تعمیرات و امتیازهای PFMEA.</li>
                <li><b>گزارش عیب‌های سند بازرسی</b> — نتیجه بازرسی رسمی هر سفارش؛ تعداد دستگاه‌های معیوب.</li>
                <li><b>گزارش تعداد تولید به تفکیک سند عملکرد</b> — تولید روزانه هر کالا در هر مرکز کاری.</li>
                <li><b>گروه‌بندی محصولات</b> — نگاشت کد محصول به برنچ، خانواده و گروه نهایی.</li>
              </ul>
            </div>`
        })}
        ${cardShell({
          title: 'چطور داده‌ها را به‌روز کنم؟',
          body: `
            <div class="explain">
              <ol>
                <li>فایل اکسل جدید را با همان قالب همیشگی از سیستم بگیرید.</li>
                <li>از صفحه <b>مدیریت داده و کاربران</b>، فایل را بارگذاری کنید — یا آن را در پوشه <code>data/raw</code> کنار فایل‌های قبلی بگذارید.</li>
                <li>دکمه <b>به‌روزرسانی همه داده‌ها</b> را بزنید. ردیف‌های همان فایل جایگزین می‌شوند و تکراری ایجاد نمی‌شود.</li>
                <li>نمودارها بلافاصله با داده جدید نمایش داده می‌شوند.</li>
              </ol>
              <p class="hint">نیازی به تغییر کد یا ساخت دوباره پایگاه داده نیست.</p>
            </div>`
        })}
      `)}
      ${grid(1, cardShell({
        title: 'نکته مهم درباره گزارش بازرسی',
        body: `<div class="explain warning">
            <p>در فایل «گزارش عیب‌های سند بازرسی»، برخی عیب‌ها زیر <b>دو عنوان عملیات آزمایش</b> ثبت شده‌اند
            (مثلاً هم زیر «QV» و هم زیر «وان قلع»). جمع ساده‌ی این ردیف‌ها باعث <b>بزرگ‌نمایی حدود ۲۳٪</b> در تعداد عیوب می‌شود.
            سامانه برای هر سفارش و کد عیب، فقط یک عملیات را می‌شمارد تا عدد واقعی نمایش داده شود.</p>
          </div>`
      }))}
      ${grid(1, cardShell({
        title: 'واژه‌نامه شاخص‌ها',
        subtitle: 'روی علامت «؟» کنار هر شاخص در صفحه‌ها هم همین توضیح‌ها را می‌بینید',
        body: `<div class="glossary">${entries}</div>`
      }))}
    `;
  }
};

export const PAGES = { home, management, inprocess, inspection, pfmea, production, records: recordsPage, admin, guide };
export { infoPopoverHtml };
