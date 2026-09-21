/* رندر همهٔ صفحه‌ها در حالت سرور (بررسی خطاهای زمان اجرا) */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
const BASE = 'http://localhost:3000';
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/getContext/.test(e.message)) errors.push('JSDOM: ' + e.message); });
vc.on('error', (...a) => errors.push('CONSOLE: ' + a.join(' ')));
const dom = await JSDOM.fromURL(BASE, {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(window) {
    window.fetch = (u, o) => fetch(new URL(u, BASE).toString(), o);
    window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
    window.Headers = Headers; window.Request = Request; window.Response = Response;
    window.FormData = FormData; window.Blob = Blob;
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
  window.echarts.init = (el,t,op) => o(el,t,{...(op||{}),renderer:'svg',width:800,height:340}); }
const bundle = fs.readFileSync('/tmp/bundle.js','utf8');
window.eval(bundle);
await wait(2500);
const d = await (await fetch(`${BASE}/api/auth/users`)).json();
const u = d.users.find((x) => x.role_label.includes('مدیر سیستم'));
const j = await (await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:u.username}) })).json();
window.localStorage.setItem('qc_token', j.token);
window.localStorage.setItem('qc_user', JSON.stringify(j.user));
window.document.getElementById('app').innerHTML = '';
window.eval(bundle);
await wait(3500);
window.eval(fs.readFileSync('/home/user/QC-TAHLIL/tools/qc-test/testbundle.js','utf8'));
console.log('روی بارگذاری مانده؟', window.document.querySelector('.boot') ? 'بله (مشکل)' : 'خیر');
const order = ['home','analyst','drill','management','inprocess','inspection','pfmea','production','records','admin','guide'];
for (const src of ['inprocess','polymer']) {
  console.log(`\n—— منبع: ${src} ——`);
  for (const p of (src === 'polymer' ? ['home','analyst','drill','management','records'] : order)) {
    await window.eval(`(async () => { window.__core.state.source = ${JSON.stringify(src)};
      window.__core.state.filters.source = ${JSON.stringify(src)};
      await window.__PAGES[Object.keys(window.__PAGES).find(k => window.__PAGES[k].id === ${JSON.stringify(p)})].render(document.getElementById('page-root')); })()`);
    await wait(1700);
    const root = window.document.getElementById('page-root');
    console.log(`   ${p.padEnd(11)}: کارت=${String(root.querySelectorAll('.card').length).padStart(2)} نمودار=${String(root.querySelectorAll('.chart svg').length).padStart(2)} جدول=${root.querySelectorAll('table').length} شاخص=${root.querySelectorAll('.kpi').length}`);
  }
}
console.log('\nخطاها:', errors.length ? [...new Set(errors)].slice(0,6).join('\n') : 'بدون خطا');
dom.window.close(); process.exit(0);
