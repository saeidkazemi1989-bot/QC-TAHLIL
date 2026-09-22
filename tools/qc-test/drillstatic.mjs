/* بررسی نسخهٔ تک‌فایل آفلاین: روند روزانه + تحلیل گام‌به‌گام */
import { JSDOM, VirtualConsole } from 'jsdom';
import { needStatic } from './mkbundle.mjs';
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/getContext/.test(e.message)) errors.push('JSDOM: ' + e.message); });
vc.on('error', (...a) => errors.push('CONSOLE: ' + a.join(' ')));
const dom = await JSDOM.fromFile(needStatic("آزمونِ دریل‌داون در نسخهٔ آفلاین"), {
  url: 'file:///C:/x/QC-Dashboard.html', runScripts: 'dangerously', resources: 'usable',
  pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(window) {
    window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
    window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t)=>({width:String(t).length*7}),
      fillText(){},save(){},restore(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},fill(){},stroke(){},
      clearRect(){},rect(){},arc(){},setTransform(){},translate(){},scale(){},drawImage(){},setLineDash(){},clip(){},transform(){},rotate(){},
      createLinearGradient: ()=>({addColorStop(){}}), getImageData: ()=>({data:[]}), putImageData(){} });
  }
});
const { window } = dom;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(2500);
if (window.echarts) { const o = window.echarts.init.bind(window.echarts);
  window.echarts.init = (el,t,op) => o(el,t,{...(op||{}),renderer:'svg',width:900,height:340}); }
await wait(1500);
window.eval(`(function(){var c=[].slice.call(document.querySelectorAll('.user-card'));(c.find(function(x){return x.textContent.includes('مدیر سیستم')})||c[0]).click();})()`);
await wait(3500);
const chartInfo = (id) => {
  const el = window.document.getElementById(id);
  const inst = el && window.echarts.getInstanceByDom(el);
  if (!inst) return 'ساخته نشد';
  const ax = inst.getOption().xAxis[0].data;
  return `${ax.length} نقطه (${ax[0]}…${ax[ax.length-1]})`;
};
const kpis = () => [...window.document.querySelectorAll('.kpi')].slice(0, 3)
  .map((k) => `${k.querySelector('.kpi-label').textContent.replace('؟','')}=${k.querySelector('.kpi-value').textContent}`).join(' | ');
console.log('۱) منو:', [...window.document.querySelectorAll('.side-link')].map((a) => a.dataset.page).join(','));
console.log('۲) پارتو (پیش‌فرض):', chartInfo('home-pareto'));
[...window.document.querySelectorAll('#home-pareto-seg button')].find((b) => b.dataset.g === 'defect')?.click();
await wait(1500);
console.log('   پس از کلیک «کد عیب»:', chartInfo('home-pareto'));
console.log('۳) روند پیش‌فرض:', chartInfo('home-trend'));
[...window.document.querySelectorAll('#home-period button')].find((b) => b.textContent.includes('روزانه'))?.click();
await wait(3000);
console.log('   پس از انتخاب روزانه:', chartInfo('home-trend'));
for (const name of ['پلیمر', 'اسناد بازرسی', 'عیوب حین تولید']) {
  [...window.document.querySelectorAll('#src-seg button')].find((b) => b.textContent.includes(name))?.click();
  await wait(2800);
  console.log(`   ${name}: ${kpis()}`);
}
window.eval(`location.hash = '#/drill'`);
await wait(3000);
const snap = (t) => {
  const root = window.document.getElementById('page-root');
  const crumbs = [...root.querySelectorAll('.drill-crumb')].map((b) => b.textContent.trim() + (b.classList.contains('current') ? '*' : ''));
  const rows = [...root.querySelectorAll('.data-table tbody tr')];
  console.log(`   ${t}: ${crumbs.join(' › ')} | ردیف‌ها=${rows.length}`);
  rows.slice(0, 1).forEach((tr) => console.log('     ›', [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()).join(' ¦ ')));
};
const clickRow = async (i) => {
  const rows = [...window.document.querySelectorAll('.data-table tbody tr')];
  if (!rows[i]) return false;
  rows[i].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1500);
  return true;
};
console.log('۴) تحلیل گام‌به‌گام (آفلاین):');
snap('سطح ۱');
if (await clickRow(1)) snap('سطح ۲');
if (await clickRow(0)) snap('سطح ۳');
if (await clickRow(0)) snap('سطح ۴');
window.eval(`location.hash = '#/records'`);
await wait(3200);
const heads = [...window.document.querySelectorAll('#page-root table thead th')].map((h) => h.textContent.trim());
console.log('۵) ستون‌های رکوردها:', heads.slice(0, 6).join(' | '), '| شماره سفارش دارد؟', heads.includes('شماره سفارش') ? 'بله (اشکال)' : 'خیر (درست)');
console.log('\nخطاها:', errors.length ? [...new Set(errors)].slice(0,5).join('\n') : 'بدون خطا');
dom.window.close(); process.exit(0);
