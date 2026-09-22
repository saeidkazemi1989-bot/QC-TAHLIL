/* بررسیِ نوارِ «پرش به بخش» در نسخهٔ تک‌فایل آفلاین */
import { JSDOM, VirtualConsole } from 'jsdom';
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/getContext/.test(e.message)) errors.push('JSDOM: ' + e.message); });
vc.on('error', (...a) => errors.push('CONSOLE: ' + a.join(' ')));
const dom = await JSDOM.fromFile('/home/user/QC-TAHLIL/QC-Dashboard.html', {
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
window.eval(`(function(){var c=[].slice.call(document.querySelectorAll('.user-card'));(c.find(function(x){return x.textContent.includes('کارشناس کیفیت')})||c[0]).click();})()`);
await wait(4000);
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name, extra); } };
for (const page of ['analyst', 'home', 'management']) {
  window.location.hash = '#/' + page;
  await wait(4500);
  const root = window.document.getElementById('page-root');
  const nav = root && root.querySelector(':scope > .sec-nav');
  const chips = nav ? nav.querySelectorAll('.sec-chip').length : 0;
  const cards = root ? root.querySelectorAll('.card').length : 0;
  ok(`صفحهٔ «${page}» نوارِ پرش دارد (${chips} دکمه برای ${cards} کارت)`, !!nav && chips >= 3 && chips === cards);
  ok(`  دکمه‌ها برچسبِ خوانا دارند`, !!nav && Array.from(nav.querySelectorAll('.sec-chip')).every((c) => c.textContent.trim().length > 2));
}
// کلیک روی یک دکمه در نسخهٔ آفلاین هم کار کند
window.location.hash = '#/analyst';
await wait(4500);
const nav = window.document.querySelector('#page-root > .sec-nav');
const chip = nav && nav.querySelectorAll('.sec-chip')[3];
chip && chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(400);
ok('کلیک روی دکمه در نسخهٔ آفلاین خطا نداد', true);
ok('بدونِ خطای زمانِ اجرا', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('\nخطاها:', errors.length ? errors.slice(0, 5).join('\n') : 'بدون خطا');
console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
window.close();
process.exit(fail ? 1 : 0);
