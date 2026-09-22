/* صفحه‌های سامانه: هر صفحه شاخص‌ها، نمودارها و توضیح‌های خود را دارد */
import { api, filterQuery, faInt, faDec, faDateTime, escapeHtml, downloadCsv, toast, state } from './core.js';
import { barH, pareto, trendCombo, donut, scatter, deltaBars, productionChart } from './charts.js';
import {
  cardShell, kpiCard, loadingCard, emptyCard, dataTable, matrixTable, infoPopoverHtml,
  periodSeg, wireSeg, findingsHtml, sentenceList, highlightNums
} from './ui.js';
import { GLOSSARY } from './glossary.js';

const DEFECT_LABEL = {
  inprocess: 'تعداد عیوب',
  inspection: 'تعداد واحد معیوب',
  polymer: 'تعداد عیوب پلیمر'
};

function defectWord() {
  return DEFECT_LABEL[state.source] || DEFECT_LABEL.inprocess;
}

/** توضیح کوتاهِ دوره انتخابی */
function periodHint() {
  return `دوره: ${PERIOD_HINT[state.trendGroup] || 'ماهانه'}`;
}
const PERIOD_HINT = { day: 'روزانه', week: 'هفتگی', month: 'ماهانه', quarter: 'فصلی' };

/** بازترسیم یک صفحه پس از تغییر دوره */
function rerender(page, root) {
  const target = root && root.id === 'page-root' ? root : document.getElementById('page-root');
  if (target) page.render(target);
}

function sourceNote() {
  if (state.source === 'inprocess') return 'منبع: گزارش کیفیت حین تولید (ریز عیوب ثبت‌شده در ایستگاه‌ها)';
  if (state.source === 'polymer') return 'منبع: گزارش پلیمر (هر کد کالا که با ۲ شروع شود؛ عیب از سند بازرسی + ضایعاتِ سند عملکرد، تولید = مقدار سالمِ همه مراکز پلیمر)';
  return 'منبع: اسناد بازرسی (تعداد دستگاه معیوب؛ ردیف‌های تکراری عملیات حذف شده است)';
}

function grid(cols, content, className = '') {
  return `<div class="grid grid-${cols} ${className}">${content}</div>`;
}

async function get(path, extra = {}) {
  return api(path + filterQuery(extra));
}

/* ---------------------------------------------------- دریل‌داون (تفکیک روزانه) */
/** اعمال بازهٔ تاریخ و رفتن به حالت روزانه (کلیک روی ماه/هفته در نمودار روند) */
export function drillRange(page, root, from, to) {
  if (!from && !to) return;
  state.filters.from = from || null;
  state.filters.to = to || null;
  state.trendGroup = 'day';
  document.dispatchEvent(new CustomEvent('qc:filters-changed'));
  rerender(page, root);
}

/** بازگشت به کل بازه (حذف محدودیت تاریخِ دریل) */
export function clearDrill(page, root) {
  state.filters.from = null;
  state.filters.to = null;
  state.trendGroup = 'month';
  document.dispatchEvent(new CustomEvent('qc:filters-changed'));
  rerender(page, root);
}

/** نوارِ بازهٔ انتخاب‌شده با دکمهٔ بازگشت */
function drillBanner(page, root) {
  const from = state.filters.from;
  const to = state.filters.to;
  if (!from && !to) return '';
  const id = `drill-back-${Math.random().toString(36).slice(2, 8)}`;
  setTimeout(() => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => clearDrill(page, root));
  }, 0);
  return `<div class="drill-banner">
    <span>بازهٔ انتخاب‌شده: <b>${escapeHtml(from || 'ابتدا')}</b> تا <b>${escapeHtml(to || 'انت‌ها')}</b>
    — نمودارها و جدول‌ها برای همین بازه، به تفکیک روز هستند.</span>
    <button id="${id}">بازگشت به کل بازه</button>
  </div>`;
}

/** کلیک روی نمودار روند: ماه/هفته/فصل → روزانه؛ و در حالت روزانه → صفحهٔ تحلیل گام‌به‌گام */
function trendDrill(page, root) {
  return (row) => {
    if (!row) return;
    const from = row.from_date || row.key;
    const to = row.to_date || row.key;
    if (state.trendGroup === 'day' || (from && from === to)) {
      state.filters.from = from;
      state.filters.to = to;
      state.trendGroup = 'day';
      state.drill = { date: from, product: null, defect: null };
      document.dispatchEvent(new CustomEvent('qc:filters-changed'));
      location.hash = '#/drill';
      return;
    }
    drillRange(page, root, from, to);
  };
}

/* ============================================================ نمای کلی */
export const home = {
  id: 'home',
  title: 'نمای کلی کیفیت',
  subtitle: 'یک نگاه سریع به وضعیت تولید، عیوب و شاخص PPM',
  roles: ['admin', 'executive', 'expert'],
  async render(root) {
    root.innerHTML = loadingCard();
    const [ins, s, tr, defectBd, stationBd, productBd, causeBd, catBd, stageBd, repairBd] = await Promise.all([
      get('/api/insights').catch(() => null),
      get('/api/summary'),
      get('/api/trend', { group: state.trendGroup || 'month' }),
      get('/api/breakdown', { dim: 'defect', limit: 12 }),
      get('/api/breakdown', { dim: 'station', limit: 10 }),
      get('/api/breakdown', { dim: 'product_unified', limit: 10 }),
      get('/api/breakdown', { dim: state.source === 'inprocess' ? 'cause_6m' : 'shift', limit: 8 }),
      get('/api/breakdown', { dim: 'category', limit: 6 }),
      get('/api/breakdown', { dim: 'stage', limit: 8 }),
      get('/api/breakdown', { dim: 'repair_desc', limit: 12 })
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

    const insCard = ins && ins.headline ? (() => {
      const sum = analystSummaryCard(ins, { full: false });
      const topAlarms = (ins.alarms || []).filter((a) => a.priority).slice(0, 3);
      return grid(1, cardShell({
        title: '🧠 تحلیلگر خودکار — نتیجه در یک نگاه',
        subtitle: `کلیات را اول می‌گوید: وضعیت کلی، آلارم‌ها و TOP 5 ${ins.basis?.label || 'توضیحات تعمیرات'} با محصول و فرآیند`,
        info: 'analyst',
        className: 'analyst-head',
        actions: '<a class="btn btn-primary" href="#/analyst">تحلیل کامل و همهٔ آلارم‌ها ←</a>',
        body: `${sum.verdict}${sum.quick}
          ${topAlarms.length ? `<div class="explain" style="margin-top:10px"><b>مهم‌ترین آلارم‌ها</b>
            <ul class="mini-alarms">${topAlarms.map((a) => `<li class="sev-${escapeHtml(a.severity)}"><span>${escapeHtml(a.severity_label)}</span> ${highlightNums(escapeHtml(a.title))}</li>`).join('')}</ul></div>` : ''}
          <div style="margin-top:8px">${sum.table}</div>`,
        foot: ''
      }));
    })() : '';

    root.innerHTML = `
      ${insCard}
      ${grid(3, kpis, 'kpi-grid')}
      ${grid(1, cardShell({
        title: 'روند تولید، عیوب و PPM در زمان',
        subtitle: `ستون‌ها تعداد تولید و عیوب؛ خط قرمز شاخص PPM است — ${periodHint()}`,
        info: 'ppm',
        actions: periodSeg({ id: 'home-period', current: state.trendGroup || 'month' }),
        body: '<div class="chart chart-lg" id="home-trend"></div>',
        foot: sourceNote()
      }))}
      ${grid(2, `
        ${cardShell({
          title: 'پارتو توضیحات تعمیرات',
          subtitle: 'بیشترین ایرادهایی که تعمیرات ثبت کرده — ستون‌ها تعداد عیب و خط نارنجی سهم تجمعی',
          info: 'repair_pareto',
          actions: `<div class="seg" id="home-pareto-seg">
              <button type="button" data-g="repair" class="active">توضیحات تعمیرات</button>
              <button type="button" data-g="defect">کد عیب</button>
            </div>`,
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
          subtitle: highlightNums('۱۰ محصول با بیشترین عیب در بازه انتخابی'),
          body: '<div class="chart" id="home-product"></div>'
        })}
        ${cardShell({
          title: state.source === 'inprocess' ? 'تحلیل ریشه‌ای (6M)' : 'توزیع بر اساس شیفت',
          subtitle: state.source === 'inprocess' ? 'عیب ناشی از ماشین، مواد، اپراتور یا روش؟' : 'عملکرد شیفت‌های مختلف',
          info: state.source === 'inprocess' ? 'cause_6m' : null,
          body: '<div class="chart" id="home-cause"></div>'
        })}
      `)}
      ${grid(2, `
        ${cardShell({
          title: 'دسته محصول (الکترونیک / پلیمر / EMS)',
          subtitle: highlightNums('بر اساس پیشوند کد کالا: ۱ = الکترونیک، ۲ = پلیمر، ۳ = EMS'),
          info: 'category',
          body: '<div class="chart" id="home-category"></div>'
        })}
        ${cardShell({
          title: 'زیرگروه محصول (مرحله کد)',
          subtitle: 'هر دسته چند زیرگروه دارد: SMD، مونتاژ، تکمیل کاری، دایال، تزریق و ...',
          info: 'stage',
          body: '<div class="chart" id="home-stage"></div>'
        })}
      `)}
    `;

    wireSeg(root, 'home-period', (g) => { state.trendGroup = g; rerender(home, root); });
    trendCombo(root.querySelector('#home-trend'), tr, { target: Number(state.meta?.settings?.ppm_target) || 0, onClick: trendDrill(home, root) });
    const homeParetoDim = { current: 'repair' };
    const drawHomePareto = () => {
      const data = homeParetoDim.current === 'repair' ? repairBd : defectBd;
      if (data.length) pareto(root.querySelector('#home-pareto'), data, { valueName: defectWord() });
      else root.querySelector('#home-pareto').innerHTML = emptyCard();
    };
    wireSeg(root, 'home-pareto-seg', (g) => {
      homeParetoDim.current = g;
      root.querySelectorAll('#home-pareto-seg button').forEach((b) => b.classList.toggle('active', b.dataset.g === g));
      drawHomePareto();
    });
    drawHomePareto();
    if (stationBd.length) barH(root.querySelector('#home-station'), stationBd, { valueName: defectWord() });
    if (productBd.length) barH(root.querySelector('#home-product'), productBd, { valueName: defectWord() });
    if (causeBd.length) donut(root.querySelector('#home-cause'), causeBd, { valueName: defectWord() });
    const catEl = root.querySelector('#home-category');
    if (catBd.length) donut(catEl, catBd, { valueName: defectWord() }); else catEl.innerHTML = emptyCard();
    const stageEl = root.querySelector('#home-stage');
    if (stageBd.length) barH(stageEl, stageBd, { valueName: defectWord() }); else stageEl.innerHTML = emptyCard();
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
    const [s, tr, categoryBd, productBd, groupBd, defectBd, stationBd, matrix, prevStation] = await Promise.all([
      get('/api/summary'),
      get('/api/trend', { group: state.trendGroup || 'month' }),
      get('/api/breakdown', { dim: 'category', limit: 6 }),
      get('/api/breakdown', { dim: 'product_unified', limit: 40 }),
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
        title: 'روند تولید، عیوب و PPM',
        subtitle: (s.prev ? `مقایسه با دوره قبل: ${faInt(s.prev.from)} تا ${faInt(s.prev.to)} — ` : '')
          + `دوره نمایش: ${PERIOD_HINT[state.trendGroup] || 'ماهانه'}`,
        info: 'ppm',
        actions: periodSeg({ id: 'mg-period', current: state.trendGroup || 'month' }),
        body: '<div class="chart chart-lg" id="mg-trend"></div>',
        foot: sourceNote()
      }))}
      ${grid(2, `
        ${cardShell({
          title: 'مقایسه دسته‌های محصول',
          subtitle: 'تولید و عیوب به تفکیک دسته محصول (الکترونیک / پلیمر / EMS)',
          body: '<div class="chart" id="mg-category"></div>'
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

    wireSeg(root, 'mg-period', (g) => { state.trendGroup = g; rerender(management, root); });
    trendCombo(root.querySelector('#mg-trend'), tr, { target: Number(state.meta?.settings?.ppm_target) || 0, onClick: trendDrill(management, root) });
    if (categoryBd.length) barH(root.querySelector('#mg-category'), categoryBd, { valueName: defectWord() });
    if (defectBd.length) donut(root.querySelector('#mg-defectgroup'), defectBd, { valueName: defectWord() });
    if (deltaRows.length) deltaBars(root.querySelector('#mg-delta'), deltaRows);
    const scatterRows = productBd.filter((r) => r.production > 0).slice(0, 15);
    if (scatterRows.length) scatter(root.querySelector('#mg-scatter'), scatterRows);
    else root.querySelector('#mg-scatter').innerHTML = emptyCard();
  }
};

/* ============================================================ تحلیل حین تولید */
let productDS = null;      // محصول انتخاب‌شده در جدول «کد عیب × مرحله»
export const inprocess = {
  id: 'inprocess',
  title: 'تحلیل عیوب حین تولید',
  subtitle: 'ریشه‌یابی دقیق: کد عیب، ایستگاه، قطعه، تامین‌کننده، عامل 6M و زمان تعمیرات',
  roles: ['admin', 'expert'],
  async render(root) {
    state.source = 'inprocess';
    root.innerHTML = loadingCard();
    const [s, tr, defectBd, stationBd, domainBd, causeBd, partFamBd, partBd, supplierBd, operatorBd,
      failureBd, repairBd, processBd, reportBd, repairNotesBd, matrix, matrixPS, productUBd, timesBd] = await Promise.all([
      get('/api/summary'),
      get('/api/trend', { group: state.trendGroup || 'month' }),
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
      get('/api/breakdown', { dim: 'report', limit: 10 }),
      get('/api/breakdown', { dim: 'repair_desc', limit: 15 }),
      get('/api/matrix', { row: 'defect', col: 'station', rows: 12, cols: 8 }),
      get('/api/matrix', { row: 'product_unified', col: 'stage', rows: 15, cols: 8 }),
      get('/api/breakdown', { dim: 'product_unified', limit: 12 }),
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
        title: 'روند تولید، عیوب و PPM',
        subtitle: `تغییرات در طول زمان — دوره نمایش: ${PERIOD_HINT[state.trendGroup] || 'ماهانه'} (برای دیدن روند روزانه، «روزانه» را انتخاب کنید)`,
        info: 'ppm',
        actions: periodSeg({ id: 'ip-period', current: state.trendGroup || 'month' }),
        body: '<div class="chart chart-lg" id="ip-trend"></div>',
        foot: sourceNote()
      }))}
      ${grid(1, cardShell({
        title: 'پارتو توضیحات تعمیرات',
        subtitle: 'مهم‌ترین ایرادهایی که تعمیرات دیده و ثبت کرده است (اولویت اصلاحی)',
        info: 'repair_pareto',
        actions: `<div class="seg" id="ip-pareto-seg">
            <button type="button" data-g="repair" class="active">توضیحات تعمیرات</button>
            <button type="button" data-g="defect">کد عیب</button>
          </div>`,
        body: '<div class="chart chart-lg" id="ip-pareto"></div>'
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
        ${cardShell({ title: 'توزیع عیوب بر اساس گزارش مبدا', subtitle: 'هر گزارش (QV، SMD، ICT، کنترل نهایی) چه سهمی از عیوب دارد', info: 'inprocess', body: '<div class="chart" id="ip-report"></div>' })}
        ${cardShell({ title: 'حالت خرابی بالقوه', info: 'inprocess', body: '<div class="chart" id="ip-failure"></div>' })}
      `)}
      ${grid(2, `
        ${cardShell({ title: 'اپراتورهای مسبب عیب', subtitle: 'در صورت ثبت در سیستم', body: '<div class="chart" id="ip-operator"></div>' })}
        ${cardShell({ title: 'فرآیندهای پرمشکل (OPC)', body: '<div class="chart" id="ip-process"></div>' })}
      `)}
      ${grid(1, cardShell({
        title: 'توضیحات تعمیرات',
        subtitle: 'شرح اقدامی که واحد تعمیرات روی عیوب ثبت کرده است (پرتکرارترها)',
        info: 'repair_desc',
        body: repairNotesBd.length ? dataTable({
          columns: {
            label: 'توضیحات تعمیرات',
            defects: 'تعداد عیب',
            rows_count: 'تعداد رکورد',
            production: 'تولید مرتبط',
            ppm: 'PPM'
          },
          rows: repairNotesBd.map((r) => ({
            label: r.label,
            defects: faInt(r.defects),
            rows_count: faInt(r.rows_count),
            production: faInt(r.production),
            ppm: faInt(r.ppm)
          })),
          maxHeight: '380px'
        }) : emptyCard('توضیحی برای تعمیرات ثبت نشده است')
      }))}
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
      ${grid(2, `
        ${cardShell({
          title: 'جدول محوری: کد عیب × ایستگاه',
          subtitle: 'هر عیب در کدام ایستگاه رخ می‌دهد',
          body: matrixTable(matrix, { rowHeader: 'کد عیب' })
        })}
        ${cardShell({
          title: 'عیوب هر محصول به تفکیک مرحله',
          subtitle: 'یک محصول چند کد دارد (هر کد یک مرحله)؛ این جدول نشان می‌دهد از عیوبِ آن محصول، چه تعداد در SMD، چه تعداد در مونتاژ/QV، تکمیل کاری و کنترل نهایی بوده است',
          info: 'product_stage',
          body: matrixTable(matrixPS, { rowHeader: 'محصول (یکپارچه)' })
        })}
      `)}
      ${grid(1, cardShell({
        title: 'یک محصول، یک عیب، چند مرحله',
        subtitle: 'محصول را انتخاب کنید تا ببینید هر کد عیبِ آن (مثل اتصالی) چند مورد در SMD، چند مورد در مونتاژ/QV، تکمیل کاری و کنترل نهایی ثبت شده است',
        info: 'product_defect_stage',
        body: `
          <div class="row-actions">
            <label class="hint" for="ip-product">محصول:</label>
            <select id="ip-product" class="input" style="min-width:280px">
              ${productUBd.map((p) => `<option value="${escapeHtml(p.key)}">${escapeHtml(p.label)} — ${faInt(p.defects)} عیب</option>`).join('')}
            </select>
            <button class="btn btn-ghost" id="ip-product-csv">خروجی CSV</button>
          </div>
          <div id="ip-matrix-ds">${loadingCard()}</div>`
      }))}
    `;

    wireSeg(root, 'ip-period', (g) => { state.trendGroup = g; rerender(inprocess, root); });

    // انتخاب محصول → جدول «کد عیب × مرحله» برای همان محصول
    productDS = productUBd[0]?.key || null;
    const drawDS = async () => {
      const box = root.querySelector('#ip-matrix-ds');
      if (!box) return;
      box.innerHTML = loadingCard();
      try {
        const m = await get('/api/matrix', { row: 'defect', col: 'stage', rows: 12, cols: 8, product_unified: productDS });
        box.innerHTML = (m.rows.length && m.cols.length)
          ? matrixTable(m, { rowHeader: 'کد عیب' })
          : emptyCard('برای این محصول در این بازه داده‌ای نیست');
      } catch (e) {
        box.innerHTML = emptyCard(String(e.message || e));
      }
    };
    const sel = root.querySelector('#ip-product');
    if (sel) {
      sel.value = productDS || '';
      sel.addEventListener('change', () => { productDS = sel.value; drawDS(); });
    }
    const csvBtn = root.querySelector('#ip-product-csv');
    if (csvBtn) csvBtn.addEventListener('click', async () => {
      const m = await get('/api/matrix', { row: 'defect', col: 'stage', rows: 12, cols: 8, product_unified: productDS });
      const rows = [['کد عیب', ...m.cols.map((c) => c.label)]];
      for (const r of m.rows) {
        rows.push([r.label, ...m.cols.map((c) => {
          const cell = m.cells.find((x) => x.r === r.key && x.c === c.key);
          return cell ? String(cell.v) : '';
        })]);
      }
      downloadCsv(`matrix-${productDS || 'product'}.csv`, rows);
    });
    drawDS();
    if (tr.length) trendCombo(root.querySelector('#ip-trend'), tr, { defectLabel: 'تعداد عیوب', onClick: trendDrill(inprocess, root) });
    else root.querySelector('#ip-trend').innerHTML = emptyCard();
    const ipParetoDim = { current: 'repair' };
    const drawIpPareto = () => {
      const data = ipParetoDim.current === 'repair' ? repairNotesBd : defectBd;
      if (data.length) pareto(root.querySelector('#ip-pareto'), data, { limit: 15 });
      else root.querySelector('#ip-pareto').innerHTML = emptyCard();
    };
    wireSeg(root, 'ip-pareto-seg', (g) => {
      ipParetoDim.current = g;
      root.querySelectorAll('#ip-pareto-seg button').forEach((b) => b.classList.toggle('active', b.dataset.g === g));
      drawIpPareto();
    });
    drawIpPareto();
    barH(root.querySelector('#ip-station'), stationBd);
    barH(root.querySelector('#ip-domain'), domainBd);
    donut(root.querySelector('#ip-cause'), causeBd);
    donut(root.querySelector('#ip-repair'), repairBd);
    barH(root.querySelector('#ip-partfam'), partFamBd);
    barH(root.querySelector('#ip-part'), partBd);
    barH(root.querySelector('#ip-report'), reportBd);
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
    const [s, tr, defectBd, stationBd, shiftBd, reportBd, productBd, repairNotesBd, matrix] = await Promise.all([
      get('/api/summary'),
      get('/api/trend', { group: state.trendGroup || 'month' }),
      get('/api/breakdown', { dim: 'defect', limit: 15 }),
      get('/api/breakdown', { dim: 'station', limit: 12 }),
      get('/api/breakdown', { dim: 'shift', limit: 6 }),
      get('/api/breakdown', { dim: 'report', limit: 10 }),
      get('/api/breakdown', { dim: 'product', limit: 30 }),
      get('/api/breakdown', { dim: 'repair_desc', limit: 15 }),
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
        title: 'روند تولید، مردودی و PPM',
        subtitle: `تغییرات در طول زمان — دوره نمایش: ${PERIOD_HINT[state.trendGroup] || 'ماهانه'}`,
        info: 'ppm',
        actions: periodSeg({ id: 'ins-period', current: state.trendGroup || 'month' }),
        body: '<div class="chart chart-lg" id="ins-trend"></div>',
        foot: sourceNote()
      }))}
      ${grid(1, cardShell({
        title: 'پارتو توضیحات تعمیرات',
        subtitle: 'بیشترین ایرادهایی که تعمیرات برای واحدهای مردود ثبت کرده است',
        info: 'repair_pareto',
        actions: `<div class="seg" id="ins-pareto-seg">
            <button type="button" data-g="repair" class="active">توضیحات تعمیرات</button>
            <button type="button" data-g="defect">کد ایراد</button>
          </div>`,
        body: '<div class="chart chart-lg" id="ins-pareto"></div>'
      }))}
      ${grid(2, `
        ${cardShell({ title: 'مردودی بر اساس ایستگاه بازرسی', info: 'station', body: '<div class="chart" id="ins-station"></div>' })}
        ${cardShell({ title: 'مردودی بر اساس گزارش مبدا', subtitle: 'تست نهایی ELE / EMS و کنترل نهایی EMS', info: 'inspection', body: '<div class="chart" id="ins-report"></div>' })}
      `)}
      ${grid(2, `
        ${cardShell({ title: 'توزیع بر اساس شیفت', body: '<div class="chart" id="ins-shift"></div>' })}
        ${cardShell({ title: 'محصولات با بیشترین مردودی', body: '<div class="chart" id="ins-product"></div>' })}
      `)}
      ${cardShell({
        title: 'توضیحات تعمیرات',
        subtitle: 'شرح اقدام تعمیرات ثبت‌شده روی دستگاه‌های مردود',
        info: 'repair_desc',
        body: repairNotesBd.length ? dataTable({
          columns: { label: 'توضیحات تعمیرات', defects: 'تعداد واحد معیوب', rows_count: 'تعداد رکورد', ppm: 'PPM' },
          rows: repairNotesBd.map((r) => ({
            label: r.label, defects: faInt(r.defects), rows_count: faInt(r.rows_count), ppm: faInt(r.ppm)
          })),
          maxHeight: '340px'
        }) : emptyCard('توضیحی برای تعمیرات ثبت نشده است')
      })}
      ${grid(1, cardShell({
        title: 'جدول محوری: محصول × دلیل مردودی',
        body: matrixTable(matrix, { rowHeader: 'محصول' })
      }))}
    `;

    wireSeg(root, 'ins-period', (g) => { state.trendGroup = g; rerender(inspection, root); });
    if (tr.length) trendCombo(root.querySelector('#ins-trend'), tr, { defectLabel: 'تعداد واحد معیوب', onClick: trendDrill(inspection, root) });
    else root.querySelector('#ins-trend').innerHTML = emptyCard();
    const insParetoDim = { current: 'repair' };
    const drawInsPareto = () => {
      const data = insParetoDim.current === 'repair' ? repairNotesBd : defectBd;
      if (data.length) pareto(root.querySelector('#ins-pareto'), data, { limit: 15, valueName: 'تعداد واحد معیوب' });
      else root.querySelector('#ins-pareto').innerHTML = emptyCard();
    };
    wireSeg(root, 'ins-pareto-seg', (g) => {
      insParetoDim.current = g;
      root.querySelectorAll('#ins-pareto-seg button').forEach((b) => b.classList.toggle('active', b.dataset.g === g));
      drawInsPareto();
    });
    drawInsPareto();
    barH(root.querySelector('#ins-station'), stationBd, { valueName: 'تعداد واحد معیوب' });
    barH(root.querySelector('#ins-report'), reportBd, { valueName: 'تعداد واحد معیوب' });
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
    state.source = 'inprocess';            // تحلیل PFMEA فقط روی داده‌های حین تولید معنا دارد
    state.filters.source = 'inprocess';
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
            <p><b>RPN</b> حاصل‌ضرب سه امتیاز است: <b>شدت</b> اثر خرابی (S)، <b>وقوع</b> یا تکرارپذیری (O) و <b>توانایی تشخیص</b> (D).</p>
            <p>هر کدام از <b class="num">۱</b> تا <b class="num">۱۰</b> امتیاز می‌گیرند؛ به‌طور معمول RPN بالای <b class="num">۱۰۰</b> نیازمند اقدام اصلاحی فوری است.</p>
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
  group: 'month',
  async render(root) {
    root.innerHTML = loadingCard();
    // اگر از صفحهٔ دیگری روی یک ماه/هفته دریل شده باشد، همان تفکیک اینجا هم رعایت می‌شود
    const group = ['day', 'week', 'month'].includes(state.trendGroup)
      ? state.trendGroup : (production.group || 'month');
    const [s, tr, wcs, domains, categories, products] = await Promise.all([
      get('/api/production/summary'),
      get('/api/production/trend', { group }),
      get('/api/production/breakdown', { dim: 'work_center', limit: 15 }),
      get('/api/production/breakdown', { dim: 'process_domain', limit: 8 }),
      get('/api/production/breakdown', { dim: 'category', limit: 5 }),
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
        ${cardShell({ title: 'تولید به تفکیک دسته محصول', body: '<div class="chart" id="pr-category"></div>' })}
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

    productionChart(root.querySelector('#pr-trend'), tr, {
      onClick: (row) => {
        if (!row) return;
        if (production.group === 'day') return;
        production.group = 'day';
        state.filters.from = row.from_date;
        state.filters.to = row.to_date;
        document.dispatchEvent(new CustomEvent('qc:filters-changed'));
        production.render(document.getElementById('page-root') || root);
      }
    });
    barH(root.querySelector('#pr-wc'), wcs.map((r) => ({ ...r, defects: r.production })), { valueName: 'تولید', color: '#3f9e78' });
    barH(root.querySelector('#pr-domain'), domains.map((r) => ({ ...r, defects: r.production })), { valueName: 'تولید', color: '#3f9e78' });
    barH(root.querySelector('#pr-category'), categories.map((r) => ({ ...r, defects: r.production })), { valueName: 'تولید', color: '#3f9e78' });

    root.querySelectorAll('#prod-group button').forEach((b) => {
      b.addEventListener('click', () => {
        production.group = b.dataset.g;
        state.trendGroup = b.dataset.g;
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
          maxHeight: '560px',
          search: false            // همین کارت کادرِ جست‌وجوی سروریِ خودش را دارد
        })}</div>`,
        foot: `
          <div class="pager">
            <button class="btn btn-ghost" id="rec-prev" ${recordsPage.page <= 1 ? 'disabled' : ''}>قبلی</button>
            <span>صفحه <b class="num">${faInt(recordsPage.page)}</b> از <b class="num">${faInt(pageCount)}</b></span>
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
/* ------------------------------------------------ وضعیتِ خطِ به‌روزرسانی خودکار */
const RAW_ROLE_NAMES = {
  quality: 'جامع کیفیت حین تولید',
  defect: 'عیب‌های سند بازرسی',
  prod: 'تعداد تولید (سند عملکرد)',
  grouping: 'گروه‌بندی محصولات'
};

/**
 * کارتِ وضعیتِ «به‌روزرسانی خودکار»: آیا ناظرِ پوشه فعال است، چهار فایل خام
 * پیدا شده‌اند، گزارش تمیز منطبق است و پایتون در دسترس هست یا نه.
 * این تابع هم در رندر نخست و هم در به‌روزرسانیِ زندهٔ هر چند ثانیه استفاده می‌شود.
 */
function pipelineStatusHtml(p) {
  if (!p) return '<div class="explain">وضعیتِ به‌روزرسانی خودکار در دسترس نیست.</div>';
  const running = p.state === 'running';
  const tone = running ? 'warn' : (p.state === 'error' ? 'bad' : 'ok');
  const stateText = running ? 'در حال تبدیل و بارگذاری…' : (p.state === 'error' ? 'آخرین اجرا با خطا' : 'آماده');

  const roles = p.raw_roles && p.raw_roles.files ? p.raw_roles.files : {};
  const byRole = {};
  for (const [name, info] of Object.entries(roles)) {
    if (!info || !info.role) continue;
    (byRole[info.role] = byRole[info.role] || []).push({ name, t: info.mtime || 0 });
  }
  const missing = ['quality', 'defect', 'prod', 'grouping'].filter((r) => !(byRole[r] || []).length);
  const roleRows = ['quality', 'defect', 'prod', 'grouping'].map((r) => {
    const list = (byRole[r] || []).sort((a, b) => b.t - a.t);
    const pick = list[0];
    const extra = list.length > 1
      ? '<span class="pill warn">' + faInt(list.length - 1) + ' نسخهٔ قدیمی‌تر نادیده گرفته می‌شود</span>'
      : '';
    return '<div class="role-item">' +
      '<span class="rname">' + RAW_ROLE_NAMES[r] + '</span>' +
      '<span class="rfile">' + (pick ? escapeHtml(pick.name) : '—') + '</span>' +
      (pick ? '<span class="pill ok">پیدا شد</span>' : '<span class="pill bad">پیدا نشد</span>') +
      extra +
      '</div>';
  }).join('');

  return [
    '<div class="pipe-grid">',
    '<div class="pipe-item ' + tone + '"><small>وضعیت</small><b>' + stateText + '</b></div>',
    '<div class="pipe-item ' + (p.enabled ? 'ok' : 'bad') + '"><small>ناظرِ پوشه‌ها</small><b>' + (p.enabled ? 'فعال' : 'غیرفعال') + '</b></div>',
    '<div class="pipe-item ' + (p.clean_up_to_date ? 'ok' : 'warn') + '"><small>گزارشِ تمیز</small><b>' + (p.clean_up_to_date ? 'منطبق با فایل خام' : 'نیاز به تبدیل دارد') + '</b></div>',
    '<div class="pipe-item ' + (p.python_ready ? 'ok' : 'bad') + '"><small>ابزارِ تبدیل (پایتون + openpyxl)</small><b>'
      + (p.python_ready
        ? 'در دسترس' + (p.python && p.python.version ? ' — ' + escapeHtml(String(p.python.version).replace(/^Python\s*/i, 'v')) : '')
        : (p.python && p.python.python ? 'پایتون هست، openpyxl نصب نیست' : 'پایتون نصب نیست'))
      + '</b></div>',
    '<div class="pipe-item"><small>آخرین اجرا</small><b>' + faDateTime(p.last_run_at) + '</b></div>',
    '<div class="pipe-item"><small>اجراهای این نشست</small><b>' + faInt(p.runs || 0) + '</b></div>',
    '</div>',
    '<div class="explain"><b>فایل‌های خامِ شناسایی‌شده در پوشهٔ data/raw</b>',
    '<div class="role-list">' + roleRows + '</div></div>',
    missing.length
      ? '<div class="explain warning" style="margin-top:8px">برای تبدیلِ خودکار، هر چهار فایل خام لازم است. کم است: ' + missing.map((m) => RAW_ROLE_NAMES[m]).join('، ') + '</div>'
      : '',
    p.last_message ? '<div class="explain" style="margin-top:8px"><small>آخرین پیام: ' + escapeHtml(p.last_message) + '</small></div>' : ''
  ].join('\n');
}

export const admin = {
  id: 'admin',
  title: 'مدیریت داده و کاربران',
  subtitle: 'بارگذاری فایل‌های جدید، مشاهده وضعیت داده‌ها، مدیریت کاربران و تنظیمات',
  roles: ['admin'],
  async render(root) {
    root.innerHTML = loadingCard();
    const [files, users, settings, counts] = await Promise.all([
      api('/api/admin/files'),
      api('/api/admin/users'),
      api('/api/admin/settings'),
      api('/api/admin/check-counts').catch(() => null)
    ]);

    const pipe = files.pipeline || null;
    const rawRoles = (pipe && pipe.raw_roles && pipe.raw_roles.files) || {};
    const fileRows = files.files.map((f) => {
      const rec = (f.records || [])[0];
      const role = rawRoles[f.name] && rawRoles[f.name].role;
      const typeLabel = f.folder === 'raw'
        ? (RAW_ROLE_NAMES[role] || 'ورودی خامِ ابزار تبدیل')
        : ({
          inprocess: 'عیوب حین تولید', inspection: 'اسناد بازرسی',
          production: 'تعداد تولید', product: 'گروه‌بندی محصولات'
        }[rec && rec.source_type] || (rec && rec.source_type) || 'گزارش تمیز');
      const st = !rec ? '<span class="pill">—</span>'
        : rec.status === 'ok' ? '<span class="pill ok">بارگذاری شد</span>'
          : rec.status === 'info' ? '<span class="pill warn">ورودی خام</span>'
            : rec.status === 'error' ? '<span class="pill bad">خطا</span>'
              : '<span class="pill">' + escapeHtml(rec.status) + '</span>';
      return '<tr>'
        + '<td>' + escapeHtml(f.name) + '</td>'
        + '<td><span class="pill ' + (f.folder === 'raw' ? 'warn' : 'ok') + '">' + (f.folder === 'raw' ? 'data/raw' : 'data/clean') + '</span></td>'
        + '<td>' + typeLabel + '</td>'
        + '<td>' + (rec && rec.rows_loaded ? faInt(rec.rows_loaded) : '<span class="muted">—</span>') + '</td>'
        + '<td>' + faDateTime((rec && rec.imported_at) || f.modified) + '</td>'
        + '<td>' + st + '</td>'
        + '<td><button class="btn-danger" data-del="' + escapeHtml(f.name) + '">حذف</button></td>'
        + '</tr>';
    }).join('');
    const filesTable = '<div class="table-wrap" style="max-height:340px"><table class="data-table">'
      + '<thead><tr><th>فایل</th><th>پوشه</th><th>نقش / نوع</th><th>ردیف‌ها</th><th>آخرین بارگذاری</th><th>وضعیت</th><th></th></tr></thead>'
      + '<tbody>' + (fileRows || '<tr><td colspan="7" class="muted">فایلی در پوشه‌های داده نیست</td></tr>') + '</tbody></table></div>';

    const countsBody = () => {
      if (!counts || !counts.ok) {
        return `<div class="explain">${counts && counts.error ? escapeHtml(counts.error) : 'فایل «اطلاعات جامع کیفیت» در پوشهٔ داده‌ها نیست یا بررسی ممکن نشد.'}</div>`;
      }
      return `
        <div class="kpi-row">
          ${kpiCard({ label: 'جمع «تعداد عیب مربوطه»', value: faInt(counts.sumRelated), unit: 'مورد', info: 'defect_count', hint: 'مبنای آمار' })}
          ${kpiCard({ label: 'جمع ستون «تعداد عیب»', value: faInt(counts.sumTotalCol), unit: 'مورد', tone: 'danger', hint: counts.factor ? `${counts.factor} برابر — جمع‌زدن این ستون اشتباه است` : '' })}
          ${kpiCard({ label: 'ردیف‌های تحلیل‌نشده', value: faInt(counts.rowsUnanalyzed), unit: 'ردیف', tone: 'warn', hint: 'بدون «تعداد عیب مربوطه» — در آمار نمی‌آیند' })}
        </div>
        <div class="explain">
          بررسی برای <b>${escapeHtml(counts.file)}</b> روی ${faInt(counts.groups)} گروه (سفارش، محصول، کد عیب):
          <ul>
            <li><b>${faInt(counts.split)}</b> گروه: جمعِ «تعداد عیب مربوطه» برابرِ یکی از خانه‌های «تعداد عیب» ✅</li>
            <li><b>${faInt(counts.independent)}</b> گروه: هر ردیف عدد مستقل دارد (جمعِ مربوطه = جمعِ تعداد عیب) ✅</li>
            <li><b>${faInt(counts.unknown)}</b> گروه: ناهماهنگی در خودِ فایل (نمونه‌ها پایین)</li>
          </ul>
        </div>
        ${(counts.unknownExamples || []).length ? dataTable({
          columns: { order: 'شماره سفارش', code: 'کد محصول', defect: 'کد عیب', related: 'جمع مربوطه', totals: 'تعداد عیبِ ردیف‌ها', rows: 'ردیف‌ها' },
          rows: counts.unknownExamples.map((u) => ({ order: u.order || '—', code: u.code, defect: u.defect, related: u.related, totals: (u.totals || []).join('، '), rows: u.rows })),
          maxHeight: '200px'
        }) : ''}
      `;
    };

    root.innerHTML = `
      ${grid(2, `
        ${cardShell({
          title: 'بررسی شمارش عیب‌ها (جامع کیفیت)',
          subtitle: 'آیا جمع «تعداد عیب مربوطه» هر سفارش با ستون «تعداد عیب» می‌خواند؟',
          info: 'defect_count',
          body: countsBody()
        })}
        ${cardShell({
          title: 'به‌روزرسانی خودکارِ داده‌ها',
          subtitle: 'فایل خام را در پوشهٔ data/raw کپی کنید؛ سامانه خودش تبدیل، بارگذاری و داشبورد را به‌روز می‌کند',
          info: 'inprocess',
          body: `
            <div id="pipeline-box">${pipelineStatusHtml(pipe)}</div>
            <div class="upload-area" id="upload-area">
              <input type="file" id="file-input" accept=".xlsx,.xlsm" hidden />
              <div class="upload-icon">📥</div>
              <p>فایل اکسل را اینجا رها کنید یا <button class="btn-link" id="pick-file">انتخاب فایل</button></p>
              <small>راهِ ساده‌تر: فایل را مستقیم در پوشهٔ <b>data/raw</b> کپی کنید — ناظرِ پوشه بدون هیچ کلیک،
              خودش تبدیل و بارگذاری می‌کند و همهٔ صفحه‌ها بی‌درنگ به‌روز می‌شوند.
              اگر چند نسخه از یک فایل باشد، جدیدترین (بر اساس زمانِ ویرایش) به کار می‌رود.</small>
            </div>
            <div class="row-actions">
              ${pipe && !pipe.python_ready
    ? (pipe.python && pipe.python.python
      ? '<button class="btn btn-primary" data-act="setup-python">نصبِ خودکارِ openpyxl</button>'
      : '<span class="pill bad">پایتون نصب نیست — install_windows.bat را اجرا کنید</span>')
    : ''}
              <button class="btn btn-primary" data-act="refresh">به‌روزرسانی فوری</button>
              <button class="btn-mini" data-act="force">تبدیلِ دوبارهٔ فایل خام (اجباری)</button>
              <button class="btn-danger" data-act="rebuild" style="padding:5px 11px;font-size:12px">بازسازی کامل از فایل‌های خام</button>
              <span class="hint">به‌روزرسانی فوری: تبدیل فقط وقتی لازم باشد. بازسازی کامل: همهٔ گزارش‌های تمیزِ قدیمی پاک
              می‌شوند و داشبورد فقط از فایل‌های خامِ فعلی ساخته می‌شود (برای گذر از دادهٔ آزمایشی به دادهٔ واقعی).</span>
            </div>
            <div id="upload-result"></div>
          `
        })}
        ${cardShell({
          title: 'فایل‌های داده (خام و تمیز)',
          subtitle: 'فایل‌های پوشهٔ data/raw و گزارش‌های تمیزِ data/clean با وضعیت بارگذاری',
          body: filesTable,
          foot: 'حذفِ فایل، داده‌های همان فایل را از پایگاه داده پاک می‌کند و آمار بلافاصله دوباره ساخته می‌شود'
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

    // --- به‌روزرسانی فوری / تبدیلِ اجباری
    async function doRefresh(force) {
      const btns = Array.from(root.querySelectorAll('[data-act]'));
      btns.forEach((b) => { b.disabled = true; });
      const box = root.querySelector('#pipeline-box');
      if (box) box.innerHTML = pipelineStatusHtml({ ...(pipe || {}), state: 'running' });
      try {
        const res = await api('/api/admin/refresh' + (force ? '?force=1' : ''), { method: 'POST' });
        const r = res && res.result ? res.result : {};
        const tot = (r.import && r.import.totals) || {};
        const n = (tot.inprocess || 0) + (tot.inspection || 0) + (tot.production || 0);
        if (r.ok === false) toast('به‌روزرسانی با هشدار انجام شد: ' + (r.message || ''), 'error');
        else toast('به‌روزرسانی انجام شد: ' + faInt(n) + ' ردیف', 'success');
        admin.render(root);
      } catch (err) {
        toast(err.message, 'error');
        btns.forEach((b) => { b.disabled = false; });
        admin.render(root);
      }
    }
    root.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.act === 'setup-python') return doSetupPython(b);
        if (b.dataset.act === 'rebuild') return doRebuild();
        return doRefresh(b.dataset.act === 'force');
      });
    });

    // --- نصبِ خودکارِ نیازمندیِ ابزار تبدیل (openpyxl) و سپس تبدیلِ فایل‌های خام
    // تا کاربر بدونِ خطِ فرمان و بدونِ برگشتن به سازنده، دادهٔ تازه بگیرد.
    async function doSetupPython(btn) {
      const btns = Array.from(root.querySelectorAll('[data-act]'));
      btns.forEach((b) => { b.disabled = true; });
      btn.textContent = 'در حال نصب…';
      toast('نصبِ openpyxl آغاز شد؛ اگر اینترنت کند باشد چند دقیقه طول می‌کشد');
      try {
        const r = await api('/api/admin/setup-python', { method: 'POST' });
        if (r && r.ok) {
          const tot = r.result?.import?.totals || {};
          const n = (tot.inprocess || 0) + (tot.inspection || 0) + (tot.production || 0);
          toast('نیازمندی‌ها نصب شد و داده‌ها ساخته شد: ' + faInt(n) + ' ردیف', 'success');
        } else {
          toast('نصب ناموفق: ' + ((r && r.message) || 'خطای نامشخص'), 'error');
          if (r && r.output) window.console?.warn('[setup-python]', String(r.output).slice(-1500));
        }
      } catch (err) {
        toast(err.message, 'error');
      }
      admin.render(root);
    }

    // --- بازسازیِ کامل: پاک‌کردن گزارش‌های تمیز و ساخت دوباره از فایل‌های خامِ فعلی
    async function doRebuild() {
      const sure = window.confirm(
        'بازسازی کامل؟\n\nهمهٔ گزارش‌های تمیزِ پوشهٔ data/clean پاک می‌شوند و داشبورد فقط از\n'
        + 'فایل‌های خامِ فعلیِ data/raw از نو ساخته می‌شود (چند ده ثانیه طول می‌کشد).\n\n'
        + 'فایل‌های خام پاک نمی‌شوند. ادامه می‌دهید؟'
      );
      if (!sure) return;
      const btns = Array.from(root.querySelectorAll('[data-act]'));
      btns.forEach((b) => { b.disabled = true; });
      const box = root.querySelector('#pipeline-box');
      if (box) box.innerHTML = pipelineStatusHtml({ ...(pipe || {}), state: 'running' });
      toast('بازسازی کامل آغاز شد؛ ممکن است چند ده ثانیه طول بکشد…');
      try {
        const res = await api('/api/admin/rebuild', { method: 'POST' });
        const tot = res?.result?.import?.totals || {};
        const n = (tot.inprocess || 0) + (tot.inspection || 0) + (tot.production || 0);
        if (res && res.ok === false) toast('بازسازی با هشدار انجام شد: ' + (res.message || ''), 'error');
        else toast('بازسازی کامل انجام شد: ' + faInt(n) + ' ردیف از ' + faInt((res.removed || []).length) + ' گزارشِ پاک‌شده', 'success');
        admin.render(root);
      } catch (err) {
        toast(err.message, 'error');
        admin.render(root);
      }
    }

    // --- حذفِ فایل (از data/raw یا data/clean)
    root.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        const name = b.dataset.del;
        if (!window.confirm('حذفِ «' + name + '»؟\nداده‌های این فایل از پایگاه داده پاک می‌شود و آمار دوباره ساخته می‌شود.')) return;
        b.disabled = true;
        b.textContent = 'در حال حذف…';
        try {
          await api('/api/admin/files/' + encodeURIComponent(name), { method: 'DELETE' });
          toast('فایل حذف و داده‌ها به‌روز شد', 'success');
          admin.render(root);
        } catch (err) {
          toast(err.message, 'error');
          b.disabled = false;
          b.textContent = 'حذف';
        }
      });
    });

    // --- وضعیتِ زندهٔ خطِ به‌روزرسانی (هر ۴ ثانیه تا وقتی این صفحه باز است)
    if (root.__pipeTimer) clearInterval(root.__pipeTimer);
    root.__pipeTimer = setInterval(async () => {
      const box = document.getElementById('pipeline-box');
      if (!box) { clearInterval(root.__pipeTimer); root.__pipeTimer = null; return; }
      try {
        box.innerHTML = pipelineStatusHtml(await api('/api/admin/pipeline'));
      } catch { /* سرور مشغولِ تبدیل است؛ دفعهٔ بعد */ }
    }, 4000);

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

/* ============================================================ تحلیل گام‌به‌گام (دریل‌داون) */
export const drill = {
  id: 'drill',
  title: 'تحلیل گام‌به‌گام عیوب',
  subtitle: 'از روز تا ریزِ تعمیرات: تاریخ ← محصول ← کد عیب ← قطعه، اقدام تعمیرات، ریشه 6M و توضیحات تعمیرات',
  roles: ['admin', 'executive', 'expert'],
  async render(root) {
    if (!state.drill) state.drill = { date: null, product: null, defect: null };
    root.innerHTML = loadingCard();
    const tree = await get('/api/drill');
    const d = state.drill;

    const allDays = tree.days || [];
    const day = d.date ? allDays.find((x) => x.date === d.date) : null;
    const product = day && d.product ? day.products.find((p) => p.code === d.product) : null;
    const defect = product && d.defect ? product.defectList.find((x) => x.code === d.defect) : null;

    const crumbs = [];
    crumbs.push({ label: `کل بازه (${faInt(allDays.length)} روز)`, level: 0 });
    if (day) crumbs.push({ label: `روز ${day.date}`, level: 1 });
    if (product) crumbs.push({ label: product.name, level: 2 });
    if (defect) crumbs.push({ label: `${defect.code}`, level: 3 });

    let scopeDefects = tree.totals.defects;
    let scopeProduction = tree.totals.production;
    let scopeRecords = tree.totals.records;
    if (day) { scopeDefects = day.defects; scopeProduction = day.production; scopeRecords = day.records; }
    if (product) { scopeDefects = product.defects; scopeProduction = product.production; scopeRecords = product.records; }
    if (defect) { scopeDefects = defect.qty; scopeRecords = defect.records; }

    let body = '';
    let csv = { columns: {}, rows: [] };

    if (!day) {
      // سطح ۱: روزها
      csv = {
        columns: { date: 'تاریخ', defects: 'تعداد عیب', production: 'تعداد تولید', ppm: 'PPM', records: 'تعداد رکورد', products: 'تعداد محصول' },
        rows: allDays.map((x) => ({
          date: x.date, defects: x.defects, production: x.production, ppm: Math.round(x.ppm),
          records: x.records, products: x.products.length
        }))
      };
      body = dataTable({
        columns: {
          date: 'تاریخ', defects: 'تعداد عیب', production: 'تعداد تولید', ppm: 'PPM',
          records: 'تعداد رکورد', products: 'تعداد محصول'
        },
        rows: allDays.map((x) => ({
          date: x.date, defects: faInt(x.defects), production: faInt(x.production),
          ppm: faInt(x.ppm), records: faInt(x.records), products: faInt(x.products.length)
        })),
        onRowClass: () => 'drill-row',
        maxHeight: '520px'
      });
    } else if (!product) {
      // سطح ۲: محصولاتِ آن روز
      csv = {
        columns: { name: 'محصول', code: 'کد محصول', stage: 'زیرگروه', defects: 'تعداد عیب', production: 'تعداد تولید', ppm: 'PPM', records: 'تعداد رکورد', defect_codes: 'تعداد کد عیب' },
        rows: day.products.map((p) => ({
          name: p.name, code: p.code, stage: p.stage, defects: p.defects, production: p.production,
          ppm: Math.round(p.ppm), records: p.records, defect_codes: p.defectList.length
        }))
      };
      body = dataTable({
        columns: {
          name: 'محصول', code: 'کد محصول', stage: 'زیرگروه', defects: 'تعداد عیب',
          production: 'تعداد تولید', ppm: 'PPM', records: 'تعداد رکورد', defect_codes: 'تعداد کد عیب'
        },
        rows: day.products.map((p) => ({
          name: p.name, code: p.code, stage: p.stage, defects: faInt(p.defects),
          production: faInt(p.production), ppm: faInt(p.ppm), records: faInt(p.records),
          defect_codes: faInt(p.defectList.length)
        })),
        onRowClass: () => 'drill-row',
        maxHeight: '520px'
      });
    } else if (!defect) {
      // سطح ۳: کدهای عیبِ آن محصول در آن روز
      const sum = product.defectList.reduce((a, b) => a + b.qty, 0) || 1;
      csv = {
        columns: { code: 'کد عیب', desc: 'شرح عیب', qty: 'تعداد عیب', share: 'سهم از عیوب محصول (٪)', records: 'تعداد رکورد' },
        rows: product.defectList.map((x) => ({
          code: x.code, desc: x.desc, qty: x.qty, share: Number(((x.qty / sum) * 100).toFixed(1)), records: x.records
        }))
      };
      body = dataTable({
        columns: { code: 'کد عیب', desc: 'شرح عیب', qty: 'تعداد عیب', share: 'سهم از عیوب محصول', records: 'تعداد رکورد' },
        rows: product.defectList.map((x) => ({
          code: x.code, desc: x.desc || '—', qty: faInt(x.qty),
          share: `${faDec((x.qty / sum) * 100, 1)}٪`, records: faInt(x.records)
        })),
        onRowClass: () => 'drill-row',
        maxHeight: '520px'
      });
    } else {
      // سطح ۴: ریز رکوردها با جزئیات تعمیرات
      csv = {
        columns: {
          station: 'ایستگاه', qty: 'تعداد عیب', part_name: 'قطعه', part_code: 'کد قطعه',
          part_family: 'خانواده قطعه', supplier: 'تامین‌کننده', repair_action: 'اقدام تعمیرات',
          cause_6m: 'ریشه (6M)', failure_mode: 'حالت خرابی', repair_desc: 'توضیحات تعمیرات',
          fix_min: 'زمان رفع عیب (دقیقه)', report: 'گزارش مبدا'
        },
        rows: defect.rows
      };
      body = dataTable({
        columns: {
          station: 'ایستگاه', qty: 'تعداد عیب', part_name: 'قطعه', part_code: 'کد قطعه',
          part_family: 'خانواده قطعه', supplier: 'تامین‌کننده', repair_action: 'اقدام تعمیرات',
          cause_6m: 'ریشه (6M)', failure_mode: 'حالت خرابی', repair_desc: 'توضیحات تعمیرات',
          fix_min: 'زمان رفع عیب (دقیقه)', report: 'گزارش مبدا'
        },
        rows: defect.rows.map((r) => ({
          station: r.station, qty: faInt(r.qty), part_name: r.part_name || '—', part_code: r.part_code || '—',
          part_family: r.part_family || '—', supplier: r.supplier || '—', repair_action: r.repair_action || '—',
          cause_6m: r.cause_6m || '—', failure_mode: r.failure_mode || '—', repair_desc: r.repair_desc || '—',
          fix_min: r.fix_min ? faDec(r.fix_min, 0) : '—', report: r.report || '—'
        })),
        maxHeight: '520px'
      });
    }

    const levelTitle = !day ? '۱) روزها'
      : !product ? `۲) محصولاتِ روز ${day.date}`
      : !defect ? `۳) کدهای عیبِ «${product.name}» در ${day.date}`
      : `۴) ریزِ رکوردهای عیب ${defect.code} — ${product.name} — ${day.date}`;
    const levelHint = !day ? 'روی هر روز کلیک کنید تا محصولات و عیوب همان روز را ببینید'
      : !product ? 'روی هر محصول کلیک کنید تا کدهای عیب آن را ببینید'
      : !defect ? 'روی هر کد عیب کلیک کنید تا ریزِ اقدام تعمیرات، قطعه و توضیحات را ببینید'
      : 'این ریزترین سطح تحلیل است: چه قطعه‌ای، چه اقدامی و توضیح تعمیرات چه بوده است';

    root.innerHTML = `
      ${grid(4, [
        kpiCard({ label: defectWord() + ' در این سطح', value: faInt(scopeDefects), unit: 'مورد', info: state.source, tone: 'warn' }),
        kpiCard({ label: 'تعداد تولیدِ مرتبط', value: faInt(scopeProduction), unit: 'دستگاه', info: 'production' }),
        kpiCard({ label: 'شاخص PPM', value: faInt(scopeProduction > 0 ? (scopeDefects / scopeProduction) * 1e6 : 0), info: 'ppm', tone: 'warn' }),
        kpiCard({ label: 'تعداد رکورد', value: faInt(scopeRecords), unit: 'ردیف', tone: 'muted' })
      ].join(''), 'kpi-grid')}
      ${grid(1, cardShell({
        title: levelTitle,
        subtitle: levelHint,
        info: 'drill',
        actions: `<button class="btn btn-ghost" id="drill-csv">خروجی اکسل (CSV)</button>`,
        body: `
          <div class="drill-crumbs">
            <span class="drill-hint">مسیر تحلیل:</span>
            ${crumbs.map((c) => `<button class="drill-crumb ${c.level === crumbs.length - 1 ? 'current' : ''}" data-level="${c.level}">${escapeHtml(c.label)}</button>`).join('<span class="drill-hint">›</span>')}
          </div>
          ${body}
        `,
        foot: sourceNote()
      }))}
    `;

    root.querySelectorAll('.drill-crumb').forEach((b) => {
      b.addEventListener('click', () => {
        const level = Number(b.dataset.level);
        state.drill = {
          date: level >= 1 ? state.drill.date : null,
          product: level >= 2 ? state.drill.product : null,
          defect: level >= 3 ? state.drill.defect : null
        };
        rerender(drill, root);
      });
    });
    root.querySelectorAll('.drill-row').forEach((tr, i) => {
      tr.addEventListener('click', () => {
        if (!day) {
          state.drill = { date: allDays[i].date, product: null, defect: null };
        } else if (!product) {
          state.drill = { date: day.date, product: day.products[i].code, defect: null };
        } else if (!defect) {
          state.drill = { date: day.date, product: product.code, defect: product.defectList[i].code };
        } else return;
        rerender(drill, root);
      });
    });
    const csvBtn = root.querySelector('#drill-csv');
    if (csvBtn) {
      csvBtn.addEventListener('click', () => {
        const name = `تحلیل-${state.source}-${day ? day.date : 'کل‌بازه'}${product ? '-' + product.code : ''}${defect ? '-' + defect.code : ''}.csv`;
        downloadCsv(name, csv.columns, csv.rows);
        toast('فایل CSV ساخته شد');
      });
    }
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
              <p>مسیر داده‌ها دو مرحله دارد:</p>
              <p><b>۱) تمیز کردن:</b> چهار فایل خام خروجیِ راهکاران توسط ابزار تبدیل (<code>qc.py</code>) به
              «گزارش تمیز» تبدیل می‌شود: تاریخ‌ها شمسی و یکدست می‌شوند، کد و شرح عیب نرمال‌سازی می‌گردد،
              اطلاعات محصول از جدول گروه‌بندی به هر ردیف اضافه می‌شود و ردیف‌های تکراریِ ماه‌های قبل حذف می‌گردد.
              خروجی در پوشه <code>data/clean</code> قرار می‌گیرد.</p>
              <p><b>۲) بارگذاری در داشبورد:</b> گزارش‌های تمیز خوانده می‌شوند و در پایگاه داده ذخیره می‌گردند؛
              همه نمودارها از همان پایگاه خوانده می‌شوند.</p>
              <p>هر گزارش تمیز هفت بخش دارد که در فیلتر و نمودارها با نام «گزارش مبدا» می‌بینید:</p>
              <ul>
                <li><b>بازرسی چشمی (QV)، SMD، ICT، کنترل نهایی ELE</b> — عیوب حین تولید.</li>
                <li><b>تست نهایی ELE، تست نهایی EMS، کنترل نهایی EMS</b> — عیوب اسناد بازرسی.</li>
                <li><b>پلیمر</b> — کالاهایی که کدشان با ۲ شروع می‌شود (عیب از سند بازرسی + ضایعاتِ همان سند عملکرد).</li>
              </ul>
              <p><b>دسته‌بندی کد کالا:</b> رقمِ اولِ کد، دستهٔ محصول را مشخص می‌کند:</p>
              <table class="tbl cat-table"><thead><tr><th>رقمِ اول</th><th>دستهٔ محصول</th><th>بخش‌های زیرمجموعه</th><th>در داشبورد</th></tr></thead>
                <tbody>
                  <tr><td><b class="num">۱</b></td><td><b>الکترونیک</b></td>
                      <td><b class="num">۱۲۰</b> SMD · <b class="num">۱۲۱</b> مونتاژ/وان قلع · <b class="num">۱۲۲</b> تکمیل کاری · <b class="num">۱۲۳</b> کنترل نهایی</td>
                      <td>دستهٔ «الکترونیک»</td></tr>
                  <tr><td><b class="num">۲</b></td><td><b>پلیمر</b></td>
                      <td><b class="num">۲۲۱</b> چاپ و لیزر دایال · <b class="num">۲۲۲</b> تزریق و کنترل نهایی دایال · <b class="num">۲۲۵</b> قطعات نیمه‌ساخته · <b class="num">۲۳۲</b> تزریق قطعات · <b class="num">۲۳۳</b> تزریق سنگین</td>
                      <td>دستهٔ «پلیمر»</td></tr>
                  <tr><td><b class="num">۳</b></td><td><b>EMS</b></td>
                      <td><b class="num">۳۲۰</b> · <b class="num">۳۳۱</b> · <b class="num">۳۳۲</b></td>
                      <td>دستهٔ «EMS»</td></tr>
                  <tr><td><b class="num">۱۳۰</b></td><td>محصولِ کامل</td><td>—</td><td>مستثنی: در هیچ شیتی نمی‌آید</td></tr>
                  <tr><td><b class="num">۷۳۰</b></td><td>دسته‌سیم</td><td>—</td><td>مستثنی: در هیچ شیتی نمی‌آید</td></tr>
                </tbody>
              </table>
              <p>در نمودارهای «دستهٔ محصول» و «زیرگروه محصول» همین تقسیم‌بندی را می‌بینید.</p>
              <p>در هر بخش، ردیف‌های عیب و ردیف‌های تولید کنار هم هستند؛ به همین دلیل مخرجِ PPM هر بخش
              دقیقاً از همان مراکز کاریِ خودش گرفته می‌شود.</p>
              <p><b>نام محصول:</b> هر محصول چند کد دارد (هر کد یک مرحله تولید). جلوی نام محصول، مرحله آن
              نوشته می‌شود (مثلاً «BCMI 207 ، کنترل نهایی»). برای دیدن یکپارچه، نمودار «محصولات پرعیب»
              همه مراحل یک محصول را جمع می‌زند و تولید را فقط از مرحله آخر می‌گیرد تا PPM درست بماند.</p>
            </div>`
        })}
        ${cardShell({
          title: 'چطور داده‌ها را به‌روز کنم؟',
          subtitle: 'فقط فایل خام را در پوشهٔ data/raw کپی کنید — بقیه‌اش خودکار است',
          body: `
            <div class="explain">
              <ol>
                <li>چهار فایل خامِ راهکاران را در پوشه <code>data/raw</code> کپی یا جایگزین کنید:
                    جامع کیفیت حین تولید، عیب‌های سند بازرسی، تعداد تولید به تفکیک سند عملکرد، گروه‌بندی محصولات.</li>
                <li>سامانه تا چند ثانیه بعد <b>خودش</b> ابزار تبدیل (<code>qc.py</code>) را اجرا می‌کند، گزارش تمیز را در
                    <code>data/clean</code> می‌سازد، داده‌ها را بارگذاری می‌کند و همهٔ صفحه‌ها را با پیامِ
                    «داده‌های تازه بارگذاری شد» به‌روز می‌کند. هیچ دستوری لازم نیست.</li>
                <li>وضعیت را در نوارِ کناری ببینید: «به‌روزرسانی خودکار فعال است» و در جریانِ کار
                    «در حال به‌روزرسانی داده‌ها…» (در این مدت داشبورد باز و قابل استفاده می‌ماند).</li>
                <li>اگر چند نسخه از یک فایل در پوشه باشد، <b>جدیدترین</b> (بر اساس زمانِ ویرایش) به کار می‌رود و
                    نسخه‌های قدیمی‌تر نادیده گرفته می‌شوند.</li>
                <li>صفحهٔ «مدیریت داده و کاربران» جزئیات را نشان می‌دهد: نقشِ هر فایل خام، منطبق بودنِ گزارش تمیز،
                    زمانِ آخرین اجرا، و دکمهٔ حذفِ فایلِ اضافی (حذف، آمار را هم همان لحظه درست می‌کند).</li>
                <li>حوصلهٔ انتظار ندارید؟ همان‌جا «به‌روزرسانی فوری» را بزنید؛ «تبدیلِ دوبارهٔ فایل خام (اجباری)»
                    تبدیل را حتی وقتی لازم نیست از اول اجرا می‌کند.</li>
                <li>اگر ترجیح می‌دهید خودتان ابزار تبدیل را اجرا کنید، خروجی را در <code>data/clean</code> بگذارید —
                    سامانه همان را هم خودش می‌بیند و بارگذاری می‌کند.</li>
                <li>برای به‌روزرسانی نسخهٔ تک‌فایل (<code>QC-Dashboard.html</code>)، <code>npm run export</code> را اجرا کنید.</li>
              </ol>
              <p class="hint">دستورهای خط فرمان هم سرِ جای خود هستند: <code>npm run refresh</code> (تبدیل + بارگذاری) و
              <code>npm run import</code> (فقط بارگذاری) — برای کارِ روزمره لازم نیستند.</p>
              <p class="hint">ردیف‌های هر فایل جایگزین می‌شوند و دادهٔ تکراریِ بین گزارش‌ها دوباره شمرده نمی‌شود؛
              نیاز به تغییر کد یا ساختِ دوبارهٔ پایگاه داده نیست.</p>
            </div>`
        })}
      `)}
      ${grid(1, cardShell({
        title: 'تحلیلگر خودکار چه چیزی به شما می‌دهد؟',
        subtitle: 'صفحهٔ «تحلیلگر خودکار» — نتیجهٔ تحلیل اولِ صفحه است، بدون اینکه دنبال آن بگردید',
        info: 'analyst',
        body: `
            <div class="explain">
              <p>این صفحه همان کاری را می‌کند که یک کارشناس کیفیت انجام می‌دهد، ولی روی همهٔ داده‌ها و در چند ثانیه:</p>
              <ol>
                <li><b>کلیات، اول:</b> وضعیت کلی (بحرانی / نیازمند توجه / پایدار)، یک پاراگراف نتیجهٔ تحلیل
                    (تعداد عیب، PPM، روندِ دورهٔ اخیر، بزرگ‌ترین موضوع و اینکه در کدام محصول و فرآیند است)
                    و یک جدولِ «سه منبع داده در یک نگاه».</li>
                <li><b>آلارم‌ها:</b> هر آلارم می‌گوید <b>چه چیزی</b>، <b>کجا</b> (محصول/فرآیند/ایستگاه)،
                    <b>چقدر</b> (تعداد، سهم و تغییر نسبت به دورهٔ قبل)، <b>چرا</b> (ریشهٔ 6M، قطعه، RPN)
                    و <b>چه باید کرد</b>. با دکمهٔ «دیدن رکوردها» مستقیم به همان رکوردها می‌روید.</li>
                <li><b>TOP 10 توضیحات تعمیرات:</b> با محصول‌ها، فرآیند/مرحله، ایستگاه، کد عیب، ریشهٔ 6M،
                    خانوادهٔ قطعه، گسترهٔ سفارش‌ها، زمان عیب‌یابی و اقدام پیشنهادیِ هر مورد.</li>
                <li><b>کانون‌های اقدام:</b> ترکیب «محصول × موضوع» با مرحلهٔ غالب — قابل‌اجراترین فهرست گزارش.</li>
              </ol>
              <p><b>نکته:</b> اگر «توضیحات تعمیرات» در یک منبع ثبت نشده باشد (اسناد بازرسی و پلیمر)،
              تحلیلگر خودش پایهٔ تحلیل را به «کد عیب» تغییر می‌دهد، دلیلش را می‌نویسد و یک آلارم
              «کیفیت داده» هم برای ثبت‌نشدنِ آن ستون صادر می‌کند.</p>
            </div>`
        }))}
      ${grid(1, cardShell({
        title: 'تحلیلِ درست یعنی چه؟ (تحلیل گام‌به‌گام)',
        subtitle: 'صفحهٔ «تحلیل گام‌به‌گام» دقیقاً همین مسیر را می‌رود',
        info: 'drill',
        body: `
            <div class="explain">
              <p>یک تحلیل کاملِ عیب این پرسش‌ها را پاسخ می‌دهد؛ سامانه آن‌ها را در چهار گام
              (در صفحهٔ <b>تحلیل گام‌به‌گام</b>) دنبال می‌کند:</p>
              <ol>
                <li><b>در چه تاریخی؟</b> فهرست روزها با تعداد عیب، تعداد تولیدِ همان روز و PPM.</li>
                <li><b>کدام محصول؟</b> با کلیک روی یک روز، محصولاتِ همان روز با تعداد عیب،
                    تولیدِ همان محصول در همان روز و PPM آن.</li>
                <li><b>چه عیبی؟</b> با کلیک روی یک محصول، کدها و شرح عیب‌های آن با تعداد و سهم هر کد.</li>
                <li><b>تعمیرات چه کرده؟</b> با کلیک روی یک کد عیب، ریزِ هر رکورد: ایستگاه،
                    <b>قطعه</b> و کد/خانواده/تامین‌کنندهٔ آن، <b>اقدام تعمیرات</b>، <b>ریشهٔ عیب (6M)</b>،
                    حالت خرابی، زمان رفع عیب و <b>توضیحات تعمیرات</b> که واحد تعمیرات در فایل
                    «اطلاعات جامع کیفیت» ثبت کرده است.</li>
              </ol>
              <p>در هر سطح می‌توانید <b>خروجی CSV/اکسل</b> بگیرید. همچنین در هر نمودار روند
              (نمای کلی، مدیریتی، حین تولید، اسناد بازرسی، تولید) با <b>کلیک روی یک ماه/هفته/فصل</b>،
              نمودار به <b>تفکیکِ روزِ همان بازه</b> می‌رود و بالای صفحه نوارِ بازه با دکمهٔ
              «بازگشت به کل بازه» ظاهر می‌شود.</p>
            </div>`
        }))}
      ${grid(1, cardShell({
        title: 'نکته مهم درباره گزارش بازرسی',
        body: `<div class="explain warning">
            <p>در فایل «گزارش عیب‌های سند بازرسی»، برخی عیب‌ها زیر <b>دو عنوان عملیات آزمایش</b> ثبت شده‌اند
            (مثلاً هم زیر «QV» و هم زیر «وان قلع»). جمع ساده‌ی این ردیف‌ها باعث <b>بزرگ‌نمایی حدود ۲۳٪</b> در تعداد عیوب می‌شود.
            سامانه برای هر سفارش و کد عیب، فقط یک عملیات را می‌شمارد تا عدد واقعی نمایش داده شود.</p>
          </div>`
      }))}
      ${grid(1, cardShell({
        title: 'آمار عیب چطور شمرده می‌شود؟',
        subtitle: 'قواعد شمارش که در ابزار تبدیل (qc.py) و بارگذاری اعمال می‌شوند',
        info: 'defect_count',
        body: `
            <div class="explain">
              <ol>
                <li><b>مبنای شمارش «تعداد عیب مربوطه» است</b>، نه «تعداد عیب».
                    در فایل جامع کیفیت، ستون «تعداد عیب» کلِ عیبِ آن سفارش است و در هر ردیف تکرار
                    می‌شود؛ جمع‌زدن آن آمار را چند برابر نشان می‌دهد. «تعداد عیب مربوطه» سهمِ همان
                    ردیف است و جمع آن برای هر (سفارش، محصول، کد عیب) برابرِ تعداد عیبِ همان گروه است.</li>
                <li><b>فقط عیب‌های تحلیل‌شدهٔ جامع کیفیت می‌آیند.</b> ردیفی که «تعداد عیب مربوطه»
                    نداشته باشد (یعنی هنوز تحلیل نشده) در آمار نمی‌آید.</li>
                <li><b>اولویت با فایل جامع کیفیت است.</b> اگر عیبی با همان <b>شماره سفارش تولید</b>،
                    محصول و کد عیب در جامع کیفیت تحلیل شده باشد، ردیف تکراریِ آن در
                    «گزارش عیب‌های سند بازرسی» دوباره شمرده نمی‌شود. عیب‌های سند بازرسی فقط وقتی
                    می‌آیند که در جامع کیفیت تحلیل نشده باشند (مثل کدهای EMS و پلیمر).
                    برای اینکه این تشخیص دقیق باشد، qc.py شماره سفارش را در <b>آخرین ستونِ همهٔ
                    شیت‌ها</b> می‌نویسد و داشبورد آن را در رکوردها نشان می‌دهد.</li>
                <li><b>ضایعات فقط برای پلیمر</b> از همان سند عملکرد می‌آید؛ برای الکترونیک و EMS
                    فایل ضایعات جداست.</li>
                <li><b>دسته محصول (الکترونیک / پلیمر / EMS)</b> جایگزین «برنچ» شده است؛ چون هر دو
                    یک ماهیت داشتند (برنچِ الکترونیک = ELE، پلیمر = POL، EMS = EMS).</li>
                <li><b>نام محصول یکپارچه:</b> یک محصول چند کد دارد (هر کد یک مرحله). جدول
                    «عیوب هر محصول به تفکیک مرحله» نشان می‌دهد عیوبِ آن محصول چند تا در SMD،
                    چند تا در مونتاژ/QV، تکمیل کاری و کنترل نهایی بوده است؛ و جدول
                    «یک محصول، یک عیب، چند مرحله» نشان می‌دهد مثلاً «اتصالیِ» همان محصول
                    چند مورد در SMD و چند مورد در QV ثبت شده است.</li>
                <li><b>بررسیِ خودکارِ این قاعده‌ها</b> در صفحهٔ <b>مدیریت داده و کاربران</b>
                    (کارتِ «بررسی شمارش عیب‌ها») هر بار روی فایل جامع کیفیت اجرا می‌شود و
                    نشان می‌دهد جمعِ «تعداد عیب مربوطه» با ستون «تعداد عیب» می‌خواند یا نه.</li>
              </ol>
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

/* ============================================================ تحلیلگر خودکار کیفیت */
const SEV_LIST = [
  ['all', 'همه'], ['critical', 'بحرانی'], ['high', 'مهم'], ['medium', 'متوسط'],
  ['low', 'کم'], ['good', 'بهبود']
];

/** رفتن به رکوردهای همان موضوعِ آلارم (با اعمال فیلترها) */
export function gotoInsight(d) {
  if (!d) return;
  const pages = state.user?.pages || [];
  if (window.__STATIC__) {
    if (d.source && d.source !== state.source) {
      state.source = d.source;
      state.filters = { source: d.source };
    }
    document.dispatchEvent(new CustomEvent('qc:rerender'));
    toast('نسخهٔ تک‌فایل: منبع داده عوض شد؛ برای دریلِ کاملِ فیلترها نسخهٔ سروری را اجرا کنید', 'info');
    return;
  }
  if (d.source) state.source = d.source;
  state.filters = { source: state.source, ...(d.filters || {}) };
  document.dispatchEvent(new CustomEvent('qc:filters-changed'));
  const target = pages.includes('records') ? 'records'
    : (state.source === 'inprocess' && pages.includes('inprocess')) ? 'inprocess'
      : pages.includes('inspection') ? 'inspection'
        : pages.includes('drill') ? 'drill' : 'home';
  const hash = `#/${target}`;
  if (location.hash === hash) document.dispatchEvent(new CustomEvent('qc:rerender'));
  else location.hash = hash;
}

function alarmHtml(a) {
  return `<article class="alarm sev-${escapeHtml(a.severity)}" data-sev="${escapeHtml(a.severity)}" data-kind="${escapeHtml(a.kind)}">
    <div class="alarm-top">
      <span class="sev-badge">${escapeHtml(a.severity_label || '')}</span>
      <span class="alarm-kind">${escapeHtml(a.kind_label || '')}</span>
      ${a.priority ? '<span class="alarm-flag">اولویت‌دار</span>' : ''}
    </div>
    <h4 class="alarm-title">${highlightNums(escapeHtml(a.title))}</h4>
    ${sentenceList(a.body, { tone: a.severity, cls: 'sent-list alarm-body' })}
    ${(a.evidence && a.evidence.length)
    ? `<div class="alarm-ev">${a.evidence.map((e) => `<span class="ev"><b>${escapeHtml(e.label)}</b> ${escapeHtml(e.value)}</span>`).join('')}</div>`
    : ''}
    <div class="alarm-foot">
      <span class="alarm-action">🛠 ${escapeHtml(a.action || '')}</span>
      <button type="button" class="btn btn-ghost alarm-drill">دیدن رکوردها ←</button>
    </div>
  </article>`;
}

/** فهرستِ کوچکِ HTML (برای پنل جزئیات) */
function topList(list, n = 2) {
  if (!list || !list.length) return '<span class="muted">—</span>';
  return list.slice(0, n).map((x) => `${escapeHtml(x.label)} <b>${faInt(x.defects)}</b> (${faDec(x.pct_of_item, 0)}٪)`).join('، ');
}

/** همان فهرست به‌صورت متن ساده (برای سلولِ جدول که escape می‌شود) */
function topText(list, n = 2) {
  if (!list || !list.length) return '—';
  return list.slice(0, n).map((x) => `${x.label} ${faInt(x.defects)} (${faDec(x.pct_of_item, 0)}٪)`).join('، ');
}

/** کارتِ خلاصهٔ تحلیلگر (بالای صفحهٔ نمای کلی هم استفاده می‌شود) */
function analystSummaryCard(r, { full = true } = {}) {
  const h = r.headline;
  const counts = h.alarm_counts || {};
  const chips = [
    ['بحرانی', counts.critical, 'critical'], ['مهم', counts.high, 'high'],
    ['متوسط', counts.medium, 'medium'], ['کم', counts.low, 'low'], ['بهبود', counts.good, 'good']
  ].filter(([, n]) => n > 0)
    .map(([label, n, sev]) => `<span class="sev-chip sev-${sev}">${label} <b>${faInt(n)}</b></span>`).join('');

  const quick = (h.quick || []).slice(0, full ? 8 : 4).map((q) => `
    <div class="quick-item ${q.tone ? `tone-${q.tone}` : ''}">
      <small>${escapeHtml(q.label)}</small>
      <b>${escapeHtml(q.value)}</b>
    </div>`).join('');

  const topRows = (r.top_repair || []).slice(0, full ? 10 : 5).map((x) => ({
    rank: faInt(x.rank),
    subject: x.label,
    defects: x.defects,
    share_pct: x.share,
    trend: `${x.window.arrow} ${x.window.word}`,
    product: topText(x.products, 1),
    stage: topText(x.stages, 1)
  }));

  return {
    verdict: `<div class="verdict-head tone-${escapeHtml(h.tone)}">
        <div class="verdict-badge">${escapeHtml(h.verdict)}</div>
        <div class="verdict-chips">${chips}</div>
      </div>
      ${(h.findings && h.findings.length)
        ? findingsHtml(h.findings)
        : sentenceList(h.narrative, { tone: h.tone, cls: 'sent-list verdict-lines' })}
      ${h.narrative ? `<details class="narrative-more"><summary>متنِ پیوستهٔ تحلیل (همان یافته‌ها به‌صورت جملهٔ پشتِ سرِ هم)</summary>
        <p class="verdict-text">${highlightNums(escapeHtml(h.narrative))}</p></details>` : ''}`,
    quick: `<div class="quick-grid">${quick}</div>`,
    table: dataTable({
      columns: {
        rank: 'رتبه', subject: `بیشترین ${r.basis?.label || 'توضیحات تعمیرات'}`, defects: 'تعداد عیب',
        share_pct: 'سهم از کل', trend: 'روند اخیر', product: 'محصول اول', stage: 'فرآیند/مرحلهٔ اول'
      },
      rows: topRows, maxHeight: full ? '420px' : '260px'
    }),
    chips
  };
}

export const analyst = {
  id: 'analyst',
  title: 'تحلیلگر خودکار کیفیت',
  subtitle: 'موتور تحلیل مثل یک کارشناس کیفیت: اول کلیات و نتیجهٔ کل، بعد آلارم‌ها و TOP 10 توضیحات تعمیرات با محصول و فرآیند',
  roles: ['admin', 'executive', 'expert'],
  sev: 'all',
  showAll: false,
  async render(root) {
    root.innerHTML = loadingCard('تحلیلگر در حال بررسی داده‌ها…');
    let r;
    try {
      r = await get('/api/insights');
    } catch (err) {
      root.innerHTML = cardShell({ title: 'تحلیلگر کیفیت', body: `<div class="error-box">${escapeHtml(err.message)}</div>` });
      return;
    }
    if (!r || !r.headline || !r.alarms) {
      root.innerHTML = cardShell({ title: 'تحلیلگر کیفیت', body: emptyCard('داده‌ای برای تحلیل در این بازه پیدا نشد') });
      return;
    }
    const h = r.headline;
    const sum = analystSummaryCard(r, { full: true });
    const basisLabel = r.basis?.label || 'توضیحات تعمیرات';
    const shown = this.showAll ? r.alarms : r.alarms.slice(0, 12);

    /* --- منبع‌ها: کلیاتِ هر سه گزارش در یک نگاه --- */
    const srcRows = (r.sources_overview || []).map((x) => ({
      src: x.label,
      production: x.production,
      defects: x.defects,
      ppm: x.ppm,
      delta_ppm: x.delta?.ppm ?? null,
      top: x.top_basis ? `${x.top_basis.label} — ${faInt(x.top_basis.defects)} مورد` : '—',
      basis: x.basis,
      product: x.top_product ? x.top_product.label : '—',
      stage: x.top_stage ? x.top_stage.label : '—'
    }));

    /* --- جدول‌های پشتیبان --- */
    const productRows = (r.top_products || []).slice(0, 12).map((p) => ({
      product: p.label, defects: p.defects, share_pct: p.share, production: p.production,
      ppm: p.ppm, vs_peers: p.ppm_vs_peers ? `${faDec(p.ppm_vs_peers, 1)}×` : '—',
      trend: p.window.change === null ? '✦ مورد تازه' : `${p.window.arrow || '■'} ${p.window.word || ''}`
    }));
    const focusRows = (r.focus || []).map((x, i) => ({
      rank: faInt(i + 1), product: x.product, subject: x.subject, defects: x.defects,
      share_pct: x.share, stage: x.stage || '—', stage_share_pct: x.stage_share
    }));
    const chronicRows = (r.chronic || []).slice(0, 12).map((c) => ({
      product: c.product, subject: c.subject, defects: c.defects, months: c.months
    }));
    const escapeRows = (r.escapes || []).slice(0, 10).map((e) => ({
      code: e.code, defect: e.label, defects: e.defects, stages: e.stage_count,
      where: (e.stages || []).map((s) => `${s.label} (${faInt(s.defects)})`).join('، ')
    }));
    const rpnRows = (r.rpn || []).slice(0, 10).map((x) => ({
      failure_mode: x.failure_mode, type: x.failure_mode_type, station: x.station,
      severity: x.severity, occurrence: x.occurrence, detection: x.detection, rpn_max: x.rpn_max, defects: x.defects
    }));
    const stageRows = (r.top_stages || []).map((x) => ({ stage: x.label, defects: x.defects, share_pct: x.share }));
    const stationRows = (r.top_stations || []).slice(0, 10).map((x) => ({ station: x.label, defects: x.defects, share_pct: x.share }));
    const m6Rows = (r.top_6m || []).map((x) => ({ cause: x.label, defects: x.defects, share_pct: x.share }));
    const partRows = (r.top_parts || []).filter((x) => x.key !== 'ثبت نشده').slice(0, 8).map((x) => ({ part: x.label, defects: x.defects, share_pct: x.share }));

    root.innerHTML = `
      ${drillBanner(analyst, root)}

      ${grid(1, cardShell({
        title: '🧠 نتیجهٔ تحلیل — کلیات اول، بدون گشتن',
        subtitle: highlightNums(`${sourceNote()} · پایهٔ تحلیل: «${basisLabel}» · بازهٔ مقایسه: ${faInt(r.range?.window_days || 0)} روز اخیر در برابر ${faInt(r.range?.window_days || 0)} روز پیش از آن`),
        info: 'analyst',
        className: 'analyst-head',
        actions: '<button class="btn btn-ghost" id="an-csv-alarms">خروجی آلارم‌ها (CSV)</button>',
        body: `${sum.verdict}${sum.quick}
          <div class="explain" style="margin-top:10px">
            <b>سه منبع داده در یک نگاه</b>
            ${dataTable({
              columns: { src: 'منبع گزارش', production: 'تولید', defects: 'عیوب', ppm: 'PPM', delta_ppm: 'تغییر PPM', top: 'بزرگ‌ترین موضوع', basis: 'پایهٔ تحلیل', product: 'بیشترین محصول', stage: 'بیشترین فرآیند' },
              rows: srcRows, maxHeight: '200px'
            })}
          </div>`,
        foot: r.basis?.note ? escapeHtml(r.basis.note) : ''
      }))}

      ${grid(1, cardShell({
        title: `آلارم‌های تحلیلگر (${faInt(r.alarms.length)} مورد)`,
        subtitle: 'هر آلارم می‌گوید چه چیزی، کجا، چقدر و چرا — و چه اقدامی پیشنهاد می‌شود؛ با «دیدن رکوردها» مستقیم به همان داده‌ها می‌روید',
        info: 'analyst_alarms',
        actions: `<div class="seg" id="an-sev">${SEV_LIST.map(([k, l]) => `<button type="button" data-g="${k}" class="${this.sev === k ? 'active' : ''}">${l}</button>`).join('')}</div>`,
        body: `<div id="an-alarms">${shown.map(alarmHtml).join('') || emptyCard('آلارمی برای این بازه ثبت نشد — وضعیت پایدار است')}</div>
          ${r.alarms.length > 12 ? `<div class="row-actions"><button class="btn btn-ghost" id="an-more">${this.showAll ? 'نمایش خلاصهٔ آلارم‌ها' : `نمایش همهٔ ${faInt(r.alarms.length)} آلارم`}</button></div>` : ''}`,
        foot: 'آلارم‌ها با قاعده‌های نسبتی ساخته می‌شوند (به حجم دادهٔ همان بازه بستگی دارند)، نه با عدد ثابت؛ فهرست قاعده‌ها در پایین همین صفحه آمده است.'
      }))}

      ${grid(1, cardShell({
        title: `TOP 10 ${basisLabel} — در کدام محصول، در کدام فرآیند`,
        subtitle: 'رتبه، تعداد، سهم، روندِ دورهٔ اخیر، محصول و فرآیند اصلی، کد عیب و ریشهٔ 6M هر مورد',
        info: 'analyst_top',
        actions: '<button class="btn btn-ghost" id="an-csv-top">خروجی Excel (CSV)</button>',
        body: `<div id="an-top">${sum.table}</div>
          <div class="chart" id="an-pareto"></div>
          <div class="explain" style="margin-top:8px"><b>پروندهٔ هر مورد</b> — باز کنید تا جزئیات و اقدام پیشنهادی همان مورد را ببینید:
          <div class="top-details">
            ${(r.top_repair || []).map((x) => `
              <details class="top-item">
                <summary>
                  <span class="ti-rank">${faInt(x.rank)}</span>
                  <b>${escapeHtml(x.label)}</b>
                  <span class="ti-num">${faInt(x.defects)} عیب · ${faDec(x.share, 1)}٪ کل</span>
                  <span class="ti-trend">${escapeHtml(x.window.arrow)} ${escapeHtml(x.window.word)}</span>
                </summary>
                <div class="ti-body">
                  ${sentenceList(x.story, { cls: 'sent-list ti-story' })}
                  <div class="ti-grid">
                    <div><small>محصول‌ها</small>${topList(x.products, 3)}</div>
                    <div><small>فرآیند/مرحله</small>${topList(x.stages, 3)}</div>
                    <div><small>ایستگاه</small>${topList(x.stations, 2)}</div>
                    <div><small>کد عیب</small>${topList(x.codes, 3)}</div>
                    <div><small>ریشهٔ 6M</small>${topList(x.cause6m, 2)}</div>
                    <div><small>خانوادهٔ قطعه</small>${topList(x.parts, 2)}</div>
                    <div><small>اقدام تعمیرات</small>${topList(x.actions, 2)}</div>
                    <div><small>گستره</small>${faInt(x.orders)} سفارش · ${faInt(x.distinct_products)} محصول · ${faInt(x.active_days)} روز${x.avg_troubleshoot_min ? ` · عیب‌یابی ${faDec(x.avg_troubleshoot_min, 0)} دقیقه` : ''}</div>
                  </div>
                  <div class="ti-actions"><b>اقدام پیشنهادی:</b><ul>${(x.action || []).map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul></div>
                  <div class="row-actions"><button class="btn btn-ghost ti-drill">دیدن رکوردهای این مورد ←</button></div>
                </div>
              </details>`).join('')}
          </div></div>`,
        foot: highlightNums(`ده مورد اول با هم ${faInt((r.top_repair || []).reduce((s, x) => s + x.defects, 0))} عیب را می‌سازند.`)
      }))}

      ${grid(1, cardShell({
        title: 'اقدام‌های فوری پیشنهادی',
        subtitle: 'به ترتیب اهمیت آلارم‌ها — از دلِ همان داده‌ها استخراج شده است',
        info: 'analyst_actions',
        actions: '<button class="btn btn-ghost" id="an-csv-focus">خروجی کانون‌های اقدام (CSV)</button>',
        body: `<ol class="action-list">${(r.actions || []).map((a) => `
            <li class="sev-${escapeHtml(a.severity)}">
              <b>${highlightNums(escapeHtml(a.title))}</b>
              <span>${highlightNums(escapeHtml(a.text))}</span>
            </li>`).join('') || '<li>اقدام فوری لازم نیست — وضعیت پایدار است.</li>'}</ol>`,
        foot: ''
      }))}

      ${grid(1, cardShell({
        title: 'کانون‌های اقدام: کدام موضوع در کدام محصول',
        subtitle: 'قابل‌اجراترین فهرست: ترکیب «محصول × موضوع» با مرحلهٔ غالبِ هر کدام',
        info: 'analyst_focus',
        body: dataTable({
          columns: { rank: 'رتبه', product: 'محصول', subject: basisLabel, defects: 'تعداد عیب', share_pct: 'سهم از کل', stage: 'مرحلهٔ غالب', stage_share_pct: 'سهم مرحله' },
          rows: focusRows, maxHeight: '420px'
        })
      }))}

      ${grid(2, `
        ${cardShell({
          title: 'محصولات پرعیب و PPM آن‌ها',
          subtitle: highlightNums(`مقایسه با میانهٔ محصولاتِ هم‌حجم (${faInt(r.peer_ppm || 0)}) — نه با میانگین کل`),
          body: dataTable({
            columns: { product: 'محصول', defects: 'عیوب', share_pct: 'سهم', production: 'تولید', ppm: 'PPM', vs_peers: 'نسبت به میانه', trend: 'روند اخیر' },
            rows: productRows, maxHeight: '360px'
          })
        })}
        ${cardShell({
          title: 'مرحله و ایستگاه',
          subtitle: 'بارِ کیفیت روی کدام مرحله و ایستگاه است',
          body: `<div class="chart" id="an-stage"></div>
            ${dataTable({ columns: { station: 'ایستگاه', defects: 'تعداد عیب', share_pct: 'سهم' }, rows: stageRows.length ? stageRows : stationRows, maxHeight: '220px' })}`
        })}
      `)}

      ${grid(2, `
        ${cardShell({
          title: 'عیب‌های مزمن (تکرارِ ماهانه)',
          subtitle: 'ترکیب محصول × موضوع که در چند ماه پیاپی تکرار شده — نیازمند اقدام ریشه‌ای',
          body: dataTable({ columns: { product: 'محصول', subject: basisLabel, defects: 'تعداد عیب', months: 'ماه‌های درگیر' }, rows: chronicRows, maxHeight: '320px' })
        })}
        ${cardShell({
          title: 'فرار عیب از ایستگاه‌ها',
          subtitle: 'یک کد عیب که در چند مرحله دیده شده = ضعف کشف در ایستگاه‌های قبلی',
          body: dataTable({ columns: { code: 'کد', defect: 'شرح عیب', defects: 'تعداد', stages: 'تعداد مراحل', where: 'کجاها' }, rows: escapeRows, maxHeight: '320px' })
        })}
      `)}

      ${grid(2, `
        ${cardShell({
          title: 'ریشهٔ 6M، قطعه و تامین‌کننده',
          subtitle: 'علت‌های ثبت‌شده و قطعاتِ درگیر',
          body: dataTable({ columns: { cause: 'عامل مسبب (6M)', defects: 'تعداد عیب', share_pct: 'سهم' }, rows: m6Rows, maxHeight: '180px' })
            + dataTable({ columns: { part: 'خانوادهٔ قطعه', defects: 'تعداد عیب', share_pct: 'سهم' }, rows: partRows, maxHeight: '220px' })
        })}
        ${cardShell({
          title: 'ریسک بالای PFMEA (RPN)',
          subtitle: r.rpn && r.rpn.length ? highlightNums('حالت‌های خرابی با RPN بیشینهٔ ۱۵۰ به بالا') : 'این داده فقط در منبع «عیوب حین تولید» وجود دارد',
          body: dataTable({
            columns: { failure_mode: 'حالت خرابی', type: 'نوع', station: 'ایستگاه', severity: 'شدت', occurrence: 'وقوع', detection: 'کشف', rpn_max: 'RPN', defects: 'عیوب' },
            rows: rpnRows, maxHeight: '320px'
          })
        })}
      `)}

      ${grid(1, cardShell({
        title: 'تحلیلگر چطور کار می‌کند؟',
        subtitle: 'قاعده‌ها و آستانه‌هایی که برای ساختن آلارم‌ها استفاده شده است',
        info: 'analyst_rules',
        body: `<div class="explain">
          <p>موتور تحلیل روی همان داده‌هایی کار می‌کند که در بقیهٔ صفحه‌ها می‌بینید (با همان قواعدِ شمارشِ «تعداد عیب مربوطه»
          و اولویتِ جامع کیفیت). برای هر بازه این کارها را انجام می‌دهد:</p>
          <ol>
            <li><b>پایهٔ تحلیل را خودش انتخاب می‌کند:</b> اگر «توضیحات تعمیرات» در بیش از <b class="num">۵۰٪</b> ردیف‌ها ثبت نشده باشد
              (مثل اسناد بازرسی و پلیمر)، تحلیل را به «کد عیب» منتقل می‌کند و دلیلش را هم می‌نویسد.</li>
            <li><b>بازه را به دو پنجرهٔ مساوی تقسیم می‌کند</b> (حداکثر <b class="num">۳۰</b> روز) و دورهٔ اخیر را با دورهٔ قبل مقایسه می‌کند
              تا جهش‌ها و بهبودها دیده شوند.</li>
            <li><b>آستانه‌ها نسبی‌اند</b> — بر پایهٔ حجم دادهٔ همان بازه، نه یک عددِ ثابت:
              <table class="tbl rule-table"><thead><tr><th>قاعده</th><th>آستانهٔ فعلی</th></tr></thead><tbody>
                <tr><td>«قابل توجه» بودنِ یک مورد</td><td><b class="num">${faInt(r.thresholds?.minCount || 0)}</b> عیب</td></tr>
                <tr><td>«جهش»</td><td>حداقل <b class="num">${faInt(r.thresholds?.spikeMin || 0)}</b> عیب افزایش و <b class="num">۵۰٪</b> رشد</td></tr>
                <tr><td>«مزمن»</td><td>تکرار در <b class="num">۳</b> ماه</td></tr>
                <tr><td>«تمرکز فرآیندی»</td><td>بیش از <b class="num">۶۰٪</b> در یک مرحله</td></tr>
                <tr><td>«محصول پرخطر»</td><td>PPM بیش از <b class="num">۱.۸</b> برابرِ میانهٔ محصولاتِ هم‌حجم</td></tr>
                <tr><td>«ریسک بالا»</td><td>RPN بیش از <b class="num">۲۰۰</b></td></tr>
              </tbody></table>
            </li>
            <li><b>برای هر آلارم، اقدامِ متناسب با همان ریشه پیشنهاد می‌دهد</b> (جدولِ 6M و مرحلهٔ فرآیند)
              و مسیرِ رسیدن به رکوردهای همان موضوع را هم می‌سازد.</li>
            <li><b>ردیف‌های «ضایعات سند عملکرد» در پلیمر</b> به‌عنوان عیبِ تحلیل‌شده آلارم نمی‌گیرند؛ سهمشان جدا گزارش می‌شود.</li>
          </ol>
          <p class="hint">زمانِ اجرای این تحلیل: <b class="num">${faInt(r.took_ms || 0)}</b> میلی‌ثانیه · تحلیل روی <b class="num">${faInt(r.thresholds?.total || 0)}</b> عیبِ بازه.</p>
        </div>`
      }))}
    `;

    /* --- اتصال رویدادها --- */
    const filterAlarms = () => {
      root.querySelectorAll('#an-sev button').forEach((b) => b.classList.toggle('active', b.dataset.g === analyst.sev));
      root.querySelectorAll('#an-alarms .alarm').forEach((el) => {
        el.style.display = (analyst.sev === 'all' || el.dataset.sev === analyst.sev) ? '' : 'none';
      });
    };
    filterAlarms();
    root.querySelectorAll('#an-sev button').forEach((b) => {
      b.addEventListener('click', () => { analyst.sev = b.dataset.g; filterAlarms(); });
    });

    const more = root.querySelector('#an-more');
    if (more) more.addEventListener('click', () => { analyst.showAll = !analyst.showAll; analyst.render(root); });

    root.querySelectorAll('#an-alarms .alarm-drill').forEach((btn, i) => {
      btn.addEventListener('click', () => gotoInsight(shown[i]?.drill));
    });
    root.querySelectorAll('.ti-drill').forEach((btn, i) => {
      btn.addEventListener('click', () => gotoInsight(r.top_repair[i]?.drill));
    });
    root.querySelectorAll('#an-top tbody tr').forEach((tr, i) => {
      tr.classList.add('drill-row');
      tr.addEventListener('click', () => gotoInsight(r.top_repair[i]?.drill));
    });

    const paretoEl = root.querySelector('#an-pareto');
    if (paretoEl && r.top_repair?.length) {
      pareto(paretoEl, r.top_repair.map((x) => ({ label: x.label, defects: x.defects, pct: x.share, cumPct: x.cum_share })),
        { valueName: defectWord(), limit: 10 });
    }
    const stageEl = root.querySelector('#an-stage');
    if (stageEl && r.top_stages?.length) barH(stageEl, r.top_stages, { valueName: defectWord(), limit: 8 });

    root.querySelector('#an-csv-top')?.addEventListener('click', () => downloadCsv(
      `top10-${basisLabel}.csv`,
      { rank: 'رتبه', subject: basisLabel, defects: 'تعداد عیب', share: 'سهم از کل ٪', trend: 'روند', product: 'محصول اول', stage: 'فرآیند اول', code: 'کد عیب', m6: 'ریشه 6M', orders: 'سفارش‌ها', action: 'اقدام پیشنهادی' },
      r.top_repair.map((x) => ({
        rank: x.rank, subject: x.label, defects: x.defects, share: faDec(x.share, 1), trend: x.window.word,
        product: x.products[0]?.label || '', stage: x.stages[0]?.label || '', code: x.codes[0]?.label || '',
        m6: x.cause6m[0]?.label || '', orders: x.orders, action: (x.action || []).join(' | ')
      }))
    ));
    root.querySelector('#an-csv-focus')?.addEventListener('click', () => downloadCsv(
      'action-focus.csv',
      { rank: 'رتبه', product: 'محصول', subject: basisLabel, defects: 'تعداد عیب', share: 'سهم ٪', stage: 'مرحلهٔ غالب' },
      focusRows.map((x) => ({ rank: x.rank, product: x.product, subject: x.subject, defects: x.defects, share: faDec(x.share_pct, 1), stage: x.stage }))
    ));
    root.querySelector('#an-csv-alarms')?.addEventListener('click', () => downloadCsv(
      'alarms.csv',
      { seq: 'شماره', severity: 'شدت', kind: 'نوع', title: 'عنوان', body: 'توضیح', action: 'اقدام پیشنهادی' },
      r.alarms.map((a) => ({ seq: a.seq, severity: a.severity_label, kind: a.kind_label, title: a.title, body: a.body, action: a.action }))
    ));
  }
};

export const PAGES = { home, analyst, drill, management, inprocess, inspection, pfmea, production, records: recordsPage, admin, guide };
export { infoPopoverHtml };
