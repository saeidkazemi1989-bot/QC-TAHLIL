/* بررسی موتور تحلیل (تحلیلگر خودکار): API + رابط کاربری
 * اجرا:  node analysttest.mjs   (سرور باید روی پورت ۳۰۰۰ در حال اجرا باشد)
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import { ensureBundles } from './mkbundle.mjs';

await ensureBundles();

const BASE = 'http://localhost:3000';
const reqLog = [];
let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

/* ---------------------------------------------------------- بخش ۱: API */
const users = await (await fetch(`${BASE}/api/auth/users`)).json();
const login = async (role) => {
  const u = users.users.find((x) => x.role === role) || users.users[0];
  const j = await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u.username })
  })).json();
  return j.token;
};
const TOK = await login('admin');
const api = async (path) => (await fetch(BASE + path, { headers: { Authorization: `Bearer ${TOK}` } })).json();

console.log('\n— API: /api/insights —');
for (const src of ['inprocess', 'inspection', 'polymer']) {
  const r = await api(`/api/insights?source=${src}`);
  console.log(`  [${src}]`);
  ok('headline ساخته شده', !!r.headline && !!r.headline.narrative, `${r.headline?.verdict} / ${r.headline?.narrative?.length || 0} نویسه`);
  ok('kpiها کامل‌اند', r.headline?.kpis?.defects > 0 && r.headline?.kpis?.ppm > 0, `${r.headline.kpis.defects} عیب · PPM ${Math.round(r.headline.kpis.ppm)}`);
  ok('quick (کلیات) ≥ ۶ ردیف', (r.headline?.quick || []).length >= 6, String(r.headline?.quick?.length));
  ok('آلارم دارد', (r.alarms || []).length >= 3, `${r.alarms.length} آلارم`);
  ok('هر آلارم عنوان/متن/اقدام/دریل دارد', r.alarms.every((a) => a.title && a.body && a.action && a.drill && a.severity_label));
  ok('TOP 10 ساخته شده', (r.top_repair || []).length >= 1, `${r.top_repair.length} مورد`);
  ok('هر موردِ TOP: محصول/فرآیند/کد/6M/اقدام/جملهٔ خلاصه', r.top_repair.every((x) =>
    x.products && x.stages && x.codes && x.cause6m && x.action?.length && x.story && x.window && x.drill));
  ok('کانون‌های اقدام (محصول × موضوع)', (r.focus || []).length >= 5, `${r.focus.length} مورد`);
  ok('اقدام‌های فوری', (r.actions || []).length >= 1, `${r.actions.length} اقدام`);
  ok('کلیاتِ سه منبع', (r.sources_overview || []).length === 3,
    r.sources_overview.map((x) => `${x.label}:${x.defects}`).join(' '));
  ok('پایهٔ تحلیل اعلام شده', !!r.basis?.label && !!r.basis?.note, r.basis?.label);
  ok('آستانه‌ها مستند شده‌اند', r.thresholds?.minCount > 0 && r.thresholds?.spikeMin > 0,
    `minCount=${r.thresholds.minCount} spikeMin=${r.thresholds.spikeMin}`);
  ok('زمان اجرا < ۲ ثانیه', r.took_ms < 2000, `${r.took_ms}ms`);
  if (src === 'inprocess') {
    ok('پایهٔ حین تولید = توضیحات تعمیرات', r.basis.label === 'توضیحات تعمیرات');
    ok('RPN آمده است', Array.isArray(r.rpn), `${r.rpn?.length} ردیف`);
  } else {
    ok(`پایهٔ ${src} = کد عیب (چون توضیح تعمیرات ثبت نشده)`, r.basis.label === 'کد عیب', `${Math.round(r.basis.repair_missing_share)}٪ خالی`);
    ok('آلارم کیفیت داده ثبت شده', r.alarms.some((a) => a.kind === 'data_quality'));
  }
}

/* فیلتر تاریخ: تحلیل باید بازه را رعایت کند */
const full = await api('/api/insights?source=inprocess');
const part = await api('/api/insights?source=inprocess&from=1405/06/01&to=1405/06/22');
ok('با فیلتر تاریخ، تعداد عیب کمتر می‌شود', part.headline.kpis.defects < full.headline.kpis.defects,
  `${part.headline.kpis.defects} < ${full.headline.kpis.defects}`);
ok('بازهٔ گزارش‌شده همان فیلتر است', part.range.from === '1405/06/01' && part.range.to === '1405/06/22');

/* ---------------------------------------------------------- بخش ۲: رابط کاربری */
console.log('\n— رابط کاربری (jsdom) —');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/getContext/.test(e.message)) errors.push('JSDOM: ' + e.message); });
const dom = await JSDOM.fromURL(BASE, {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(window) {
    window.fetch = (u, o) => { const full = new URL(u, BASE).toString(); reqLog.push(full); return fetch(full, o); };
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.Headers = Headers; window.Request = Request; window.Response = Response;
    window.FormData = FormData; window.Blob = Blob;
    window.HTMLCanvasElement.prototype.getContext = () => ({
      measureText: (t) => ({ width: String(t).length * 7 }),
      fillText() {}, save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, fill() {}, stroke() {},
      clearRect() {}, rect() {}, arc() {}, setTransform() {}, translate() {}, scale() {}, drawImage() {}, setLineDash() {}, clip() {}, transform() {}, rotate() {},
      createLinearGradient: () => ({ addColorStop() {} }), getImageData: () => ({ data: [] }), putImageData() {}
    });
  }
});
const { window } = dom;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(2500);
if (window.echarts) {
  const o = window.echarts.init.bind(window.echarts);
  window.echarts.init = (el, t, op) => o(el, t, { ...(op || {}), renderer: 'svg', width: 900, height: 360 });
}
// ورود پیش از اجرای بسته تا فقط «یک» نمونهٔ برنامه در صفحه باشد
// (اجرای دوبارهٔ بسته، شنوندهٔ hashchange اضافی می‌سازد و ناوبری را خراب می‌کند)
const j = await (await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: users.users[0].username })
})).json();
window.localStorage.setItem('qc_token', j.token);
window.localStorage.setItem('qc_user', JSON.stringify(j.user));
const bundle = fs.readFileSync('/tmp/bundle.js', 'utf8');
window.eval(bundle);
await wait(4200);
window.eval(fs.readFileSync('/home/user/QC-TAHLIL/tools/qc-test/testbundle.js', 'utf8'));
const hashLog = [];
window.addEventListener('hashchange', () => hashLog.push(window.location.hash));

const openPage = async (page, src) => {
  window.eval(`window.__core.state.source='${src}'; window.__core.state.filters={source:'${src}'};`);
  await window.eval(`window.__PAGES.${page}.render(document.getElementById('page-root'))`);
  await wait(2600);
};
const txt = (sel) => window.document.querySelector(sel)?.textContent.trim() || '';
const cnt = (sel) => window.document.querySelectorAll(sel).length;

/* نمای کلی: کارت تحلیلگر باید اولِ صفحه باشد */
await openPage('home', 'inprocess');
ok('کارت تحلیلگر در نمای کلی هست', cnt('.analyst-head') === 1);
ok('کارت تحلیلگر اولین کارت صفحه است', window.document.querySelector('#page-root .card')?.classList.contains('analyst-head'));
ok('خلاصهٔ وضعیت در نمای کلی', txt('.verdict-badge').length > 2, txt('.verdict-badge'));
ok('آلارم‌های مهم در نمای کلی', cnt('.mini-alarms li') >= 1, String(cnt('.mini-alarms li')));
ok('پیوند «تحلیل کامل»', !!window.document.querySelector('a[href="#/analyst"]'));
ok('منوی کناری «تحلیلگر خودکار» دارد', txt('.side-link[data-page="analyst"] b') === 'تحلیلگر خودکار');

/* صفحهٔ تحلیلگر */
for (const src of ['inprocess', 'inspection', 'polymer']) {
  await openPage('analyst', src);
  console.log(`  [صفحهٔ تحلیلگر · ${src}]`);
  ok('نتیجهٔ کلی (verdict)', txt('.verdict-badge').length > 2, txt('.verdict-badge'));
  ok('متن کلیات', txt('.verdict-text').length > 80, `${txt('.verdict-text').length} نویسه`);
  ok('کلیاتِ سریع ≥ ۶', cnt('.quick-item') >= 6, String(cnt('.quick-item')));
  ok('جدول سه منبع', cnt('.analyst-head table tbody tr') === 3);
  ok('آلارم‌ها رندر شده', cnt('#an-alarms .alarm') >= 3, String(cnt('#an-alarms .alarm')));
  ok('شدت و نوع هر آلارم', cnt('#an-alarms .sev-badge') === cnt('#an-alarms .alarm'));
  ok('اقدام پیشنهادی هر آلارم', cnt('.alarm-action') === cnt('#an-alarms .alarm'));
  const topRows = cnt('#an-top table tbody tr');
  ok('جدول TOP 10', topRows >= 1 && topRows <= 10, `${topRows} سطر`);
  ok('ستون محصول و فرآیند در TOP', txt('#an-top table thead').includes('محصول') && txt('#an-top table thead').includes('فرآیند'));
  ok('پروندهٔ جزئیات هر مورد', cnt('.top-item') === topRows, `${cnt('.top-item')} مورد`);
  ok('سلول‌های جدول TOP بدون تگِ خامِ HTML', !txt('#an-top table tbody').includes('<b>'), txt('#an-top table tbody tr').slice(0, 70));
  ok('پارتو/نمودار تحلیلگر', cnt('#an-pareto svg') === 1);
  ok('کانون‌های اقدام', cnt('table') >= 5);
  ok('قاعده‌های تحلیلگر توضیح داده شده', txt('.card-body').includes('قاعده') || cnt('.explain') >= 2);

  /* فیلتر شدت */
  const before = [...window.document.querySelectorAll('#an-alarms .alarm')].filter((e) => e.style.display !== 'none').length;
  const goodBtn = window.document.querySelector('#an-sev button[data-g="good"]');
  goodBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(300);
  const shownGood = [...window.document.querySelectorAll('#an-alarms .alarm')].filter((e) => e.style.display !== 'none');
  ok('فیلتر «بهبود» فقط همان‌ها را نشان می‌دهد', shownGood.every((e) => e.dataset.sev === 'good'),
    `${before} → ${shownGood.length}`);
  window.document.querySelector('#an-sev button[data-g="all"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(200);
  ok('بازگشت به «همه»', [...window.document.querySelectorAll('#an-alarms .alarm')].every((e) => e.style.display !== 'none'));

  if (src === 'inprocess') {
    /* دریل واقعی: صفحهٔ تحلیلگرِ خودِ برنامه با هش باز می‌شود و کلیک روی آلارم
       باید فیلتر را اعمال کند، به رکوردها برود و درخواستِ فیلتردار بفرستد */
    window.location.hash = '#/analyst';
    await wait(2800);
    ok('صفحهٔ تحلیلگر با هش باز می‌شود', window.location.hash === '#/analyst' && cnt('#an-alarms .alarm') >= 3, window.location.hash);
    hashLog.length = 0; reqLog.length = 0;
    window.document.querySelector('.alarm-drill')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(2800);
    ok('دریلِ آلارم: به صفحهٔ رکوردها رفت', hashLog.includes('#/records'), hashLog.join(' → '));
    ok('دریلِ آلارم: فیلتر در درخواستِ رکوردها اعمال شد',
      reqLog.some((u) => u.includes('/api/records') && /stage=|repair_desc=|defect_code=|part_family=|failure_mode=/.test(u)),
      decodeURIComponent((reqLog.find((u) => u.includes('/api/records')) || '').split('?')[1] || '').slice(0, 90));
    ok('جدول رکوردها با همان فیلتر رندر شد', cnt('#rec-table tbody tr') >= 1, `${cnt('#rec-table tbody tr')} سطر`);
    ok('نوار فیلتر، فیلترِ اعمال‌شده را نشان می‌دهد', cnt('.ms-badge') >= 1, String(cnt('.ms-badge')));

    /* کلیک روی سطر TOP 10 هم باید به رکوردهای همان موضوع ببرد */
    window.location.hash = '#/analyst';
    await wait(2800);
    hashLog.length = 0; reqLog.length = 0;
    window.document.querySelector('#an-top table tbody tr')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(2800);
    ok('کلیک روی سطر TOP → رفتن به رکوردها', hashLog.includes('#/records'), hashLog.join(' → '));
    ok('کلیک روی سطر TOP → فیلتر توضیحات تعمیرات در درخواست',
      reqLog.some((u) => u.includes('/api/records') && u.includes('repair_desc=')),
      decodeURIComponent((reqLog.find((u) => u.includes('/api/records')) || '').split('?')[1] || '').slice(0, 90));
  }
}

ok('بدون خطای زمان اجرا', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));
console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
dom.window.close();
process.exit(fail ? 1 : 0);
