/* بررسی پارتو: پیش‌فرض «توضیحات تعمیرات» + امکان تغییر به «کد عیب» */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
const BASE = 'http://localhost:3000';
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/getContext/.test(e.message)) errors.push('JSDOM: ' + e.message); });
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
  window.echarts.init = (el,t,op) => o(el,t,{...(op||{}),renderer:'svg',width:900,height:360}); }
window.eval(fs.readFileSync('/tmp/bundle.js','utf8'));
await wait(2500);
const d = await (await fetch(`${BASE}/api/auth/users`)).json();
const u = d.users.find((x) => x.role_label.includes('مدیر سیستم'));
const j = await (await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:u.username}) })).json();
window.localStorage.setItem('qc_token', j.token);
window.localStorage.setItem('qc_user', JSON.stringify(j.user));
window.document.getElementById('app').innerHTML = '';
window.eval(fs.readFileSync('/tmp/bundle.js','utf8'));
await wait(3500);
window.eval(fs.readFileSync('/home/user/QC-TAHLIL/tools/qc-test/testbundle.js','utf8'));

const paretoOf = (id) => {
  const el = window.document.getElementById(id);
  const inst = el && window.echarts.getInstanceByDom(el);
  if (!inst) return 'ساخته نشد';
  const ax = inst.getOption().xAxis[0].data.slice(0, 5);
  return ax.map((s) => String(s).replace(/\n/g, ' ')).join(' | ');
};
const clickSeg = async (segId, g) => {
  const b = window.document.querySelector(`#${segId} button[data-g="${g}"]`);
  if (!b) return false;
  b.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1800);
  return true;
};
const openPage = async (page, src) => {
  window.eval(`window.__core.state.source='${src}'; window.__core.state.filters={source:'${src}'};`);
  await window.eval(`window.__PAGES.${page}.render(document.getElementById('page-root'))`);
  await wait(2500);
};
for (const [page, src, id, seg] of [['home','inprocess','home-pareto','home-pareto-seg'],
                                    ['inprocess','inprocess','ip-pareto','ip-pareto-seg'],
                                    ['inspection','inspection','ins-pareto','ins-pareto-seg']]) {
  await openPage(page, src);
  const title = window.document.querySelector(`#${id}`)?.closest('.card')?.querySelector('.card-title')?.textContent.trim();
  console.log(`\n${page} (${src}) — ${title}`);
  console.log('   پیش‌فرض (توضیحات تعمیرات):', paretoOf(id));
  if (await clickSeg(seg, 'defect')) console.log('   پس از کلیک «کد عیب»:', paretoOf(id));
  await clickSeg(seg, 'repair');
}
console.log('\nخطاها:', errors.length ? [...new Set(errors)].slice(0,4).join('\n') : 'بدون خطا');
dom.window.close(); process.exit(0);
