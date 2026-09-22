/* آزمونِ رابطِ صفحهٔ «مدیریت داده و کاربران» — کارتِ به‌روزرسانی خودکار و جدول فایل‌ها */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';

const BASE = process.env.QC_BASE || 'http://localhost:3000';
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/getContext/.test(e.message)) errors.push('JSDOM: ' + e.message); });
vc.on('error', (...a) => errors.push('CONSOLE: ' + a.join(' ')));

const dom = await JSDOM.fromURL(BASE, {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(window) {
    window.fetch = (u, o) => fetch(new URL(u, BASE).toString(), o);
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.Headers = Headers; window.Request = Request; window.Response = Response;
    window.FormData = FormData; window.Blob = Blob;
    window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: String(t).length * 7 }),
      fillText() {}, save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, fill() {}, stroke() {},
      clearRect() {}, rect() {}, arc() {}, setTransform() {}, translate() {}, scale() {}, drawImage() {}, setLineDash() {}, clip() {}, transform() {}, rotate() {},
      createLinearGradient: () => ({ addColorStop() {} }), getImageData: () => ({ data: [] }), putImageData() {} });
  }
});
const { window } = dom;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(2000);
window.eval(fs.readFileSync('/tmp/bundle.js', 'utf8'));
await wait(1500);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${name}`); }
  else { fail += 1; console.log(`  ❌ ${name} ${extra}`); }
};

const d = await (await fetch(`${BASE}/api/auth/users`)).json();
const adminUser = d.users.find((x) => x.role === 'admin');
const login = await (await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: adminUser.username })
})).json();
window.localStorage.setItem('qc_token', login.token);
window.localStorage.setItem('qc_user', JSON.stringify(login.user));
window.document.getElementById('app').innerHTML = '';
window.eval(fs.readFileSync('/tmp/bundle.js', 'utf8'));
await wait(3000);
window.eval(fs.readFileSync(new URL('./testbundle.js', import.meta.url).pathname, 'utf8'));

// --- صفحهٔ مدیریت داده
await window.eval(`(async () => { await window.__PAGES.admin.render(document.getElementById('page-root')); })()`);
await wait(2500);
const root = window.document.getElementById('page-root');
const filesApi = await (await fetch(`${BASE}/api/admin/files`, { headers: { Authorization: `Bearer ${login.token}` } })).json();
const nFiles = filesApi.files.length;
const nRaw = filesApi.files.filter((f) => f.folder === 'raw').length;

ok('کارتِ وضعیتِ خطِ به‌روزرسانی رندر شد', !!root.querySelector('#pipeline-box'));
ok('شاخص‌های وضعیت (ناظر/گزارش تمیز/پایتون/آخرین اجرا) دیده می‌شود', root.querySelectorAll('.pipe-item').length >= 6,
  String(root.querySelectorAll('.pipe-item').length));
ok('هر چهار نقشِ فایل خام در جدولِ نقش‌ها آمده', root.querySelectorAll('.role-item').length === 4,
  String(root.querySelectorAll('.role-item').length));
ok('وضعیتِ ناظر «فعال» است', /فعال/.test(root.querySelector('#pipeline-box').textContent));
ok('پیامِ «به‌روزرسانی خودکار» در راهنمای کارت هست',
  /data\/raw/.test(root.textContent) && /به‌روزرسانی خودکار/.test(root.textContent));
ok('دکمهٔ «به‌روزرسانی فوری» وجود دارد', !!root.querySelector('[data-act="refresh"]'));
ok('دکمهٔ «تبدیلِ دوباره (اجباری)» وجود دارد', !!root.querySelector('[data-act="force"]'));
ok('دکمهٔ «بازسازی کامل از فایل‌های خام» وجود دارد', !!root.querySelector('[data-act="rebuild"]'));
ok('معنیِ بازسازیِ کامل در راهنما توضیح داده شد', /بازسازی کامل/.test(root.textContent) && /دادهٔ آزمایشی/.test(root.textContent));
ok('به تعدادِ فایل‌ها دکمهٔ حذف ساخته شد', root.querySelectorAll('[data-del]').length === nFiles,
  `${root.querySelectorAll('[data-del]').length} از ${nFiles}`);
ok('ستونِ پوشه، فایل خام را با data/raw نشان می‌دهد',
  (root.innerHTML.match(/data\/raw/g) || []).length >= nRaw, String((root.innerHTML.match(/data\/raw/g) || []).length));
ok('ستونِ پوشه، گزارش تمیز را با data/clean نشان می‌دهد', /data\/clean/.test(root.innerHTML));
ok('نقشِ فایل خام به‌جای «ورودی خام» در جدول نوشته شد',
  /جامع کیفیت حین تولید/.test(root.textContent) && /گروه‌بندی محصولات/.test(root.textContent));
ok('زمانِ آخرین بارگذاری با رقم فارسی و تاریخ محلی نوشته شد', /[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}/.test(root.textContent),
  (root.textContent.match(/[۰-۹]{4}[^]{0,12}/) || [''])[0]);
ok('ناظرِ وضعیتِ زنده (تایمر ۴ ثانیه) فعال شد', typeof root.__pipeTimer === 'number' || !!root.__pipeTimer);

// --- نوارِ کناری: نشانگرِ به‌روزرسانی خودکار
ok('نوارِ کناری نشانگرِ «به‌روزرسانی خودکار» دارد', !!window.document.getElementById('live-note'));
await wait(9000);   // چند چرخهٔ پرس‌وجو
const note = window.document.getElementById('live-note');
ok('نشانگر پس از چند ثانیه وضعیت را نوشت',
  /به‌روزرسانی خودکار|ارتباط با سرور/.test(note ? note.textContent : ''), note ? note.textContent : '—');
ok('زمانِ آخرین به‌روزرسانی در نوار کناری خالی نیست',
  (window.document.getElementById('live-time') || {}).textContent !== '—');

// --- صفحهٔ راهنما
await window.eval(`(async () => { await window.__PAGES.guide.render(document.getElementById('page-root')); })()`);
await wait(1200);
const g = window.document.getElementById('page-root').textContent;
ok('راهنما: «فقط فایل خام را در پوشهٔ data/raw کپی کنید» توضیح داده شد', /data\/raw/.test(g) && /خودش/.test(g));
ok('راهنما: به صفحهٔ مدیریت داده برای حذف/جزئیات ارجاع می‌دهد', /مدیریت داده/.test(g));
ok('راهنما: «به‌روزرسانی فوری» را معرفی می‌کند', /به‌روزرسانی فوری/.test(g));

console.log('\nخطاها:', errors.length ? [...new Set(errors)].slice(0, 5).join('\n') : 'بدون خطا');
console.log(`نتیجه: ${pass} موفق، ${fail} ناموفق`);
dom.window.close();
process.exit(fail || errors.length ? 1 : 0);
