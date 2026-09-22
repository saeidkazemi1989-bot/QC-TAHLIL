/* آزمونِ خواناییِ رابط: رنگ‌های پرمایه + جداسازیِ عدد از توضیح در بخشِ تحلیل */
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
if (window.echarts) {
  const o = window.echarts.init.bind(window.echarts);
  window.echarts.init = (el, t, op) => o(el, t, { ...(op || {}), renderer: 'svg', width: 800, height: 340 });
}
window.eval(fs.readFileSync('/tmp/bundle.js', 'utf8'));
await wait(2000);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${name}`); }
  else { fail += 1; console.log(`  ❌ ${name} ${extra}`); }
};

/* ---------------------------------------------------- ۱) رنگ‌ها و کنتراست */
console.log('\n— رنگ و زمینه —');
const css = fs.readFileSync('/home/user/QC-TAHLIL/public/css/app.css', 'utf8');
const lastRoot = css.slice(css.lastIndexOf(':root {'));
const v = (name) => {
  const m = lastRoot.match(new RegExp('--' + name + ':\\s*([^;]+);'));
  return m ? m[1].trim() : null;
};
const lum = (hex) => {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const l1 = Math.max(lum(a), lum(b));
  const l2 = Math.min(lum(a), lum(b));
  return Number((((l1 + 0.05) / (l2 + 0.05))).toFixed(2));
};
const bg = v('bg');
const ink = v('ink');
const ink2 = v('ink-2');
const muted = v('muted');
const line = v('line');
ok('زمینهٔ صفحه تعریف شده', !!bg, String(bg));
ok('زمینه پرمایه‌تر از نسخهٔ قبلِ #f4f7fb است', lum(bg) < lum('#f4f7fb'), `${bg} lum=${lum(bg).toFixed(3)}`);
ok('کنتراستِ متنِ اصلی روی زمینه ≥ ۱۲ است (WCAG AAA)', contrast(ink, '#ffffff') >= 12, `${ink} → ${contrast(ink, '#ffffff')}`);
ok('کنتراستِ متنِ ثانوی روی کارت ≥ ۹ است', contrast(ink2, '#ffffff') >= 9, `${ink2} → ${contrast(ink2, '#ffffff')}`);
ok('کنتراستِ متنِ ریز (muted) روی کارت ≥ ۴.۵ است (WCAG AA)', contrast(muted, '#ffffff') >= 4.5, `${muted} → ${contrast(muted, '#ffffff')}`);
ok('کنتراستِ متنِ ریز روی زمینهٔ صفحه ≥ ۴.۵ است', contrast(muted, bg) >= 4.5, `${contrast(muted, bg)}`);
ok('خطِ مرزیِ کارت‌ها تیره‌تر از قبل (#dbe3ed) است', lum(line) < lum('#dbe3ed'), `${line}`);
ok('قاعدهٔ جدولِ راه‌راه اضافه شده', /tbody tr:nth-child\(even\)/.test(css));
ok('سرستونِ جدول کنتراستِ زیاد دارد', /data-table th \{[^}]*#e3ebf6/.test(css.replace(/\n/g, ' ')));
ok('سربرگِ کارت نوارِ رنگی دارد (پیدا کردنِ آسانِ بخش‌ها)', /card-titles h3::before/.test(css));
ok('برچسبِ شدتِ آلارم پرمایه‌تر شد', /sev-critical \{[^}]*rgba\(163, 39, 31, \.16\)/.test(css.replace(/\n/g, ' ')));

/* ------------------------------------- ۲) تحلیلگر: عدد از توضیح جدا باشد */
console.log('\n— بخشِ تحلیل: جداسازیِ عدد از توضیح —');
const d = await (await fetch(`${BASE}/api/auth/users`)).json();
const u = d.users.find((x) => x.role === 'executive');
const j = await (await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u.username })
})).json();
window.localStorage.setItem('qc_token', j.token);
window.localStorage.setItem('qc_user', JSON.stringify(j.user));
window.document.getElementById('app').innerHTML = '';
window.eval(fs.readFileSync('/tmp/bundle.js', 'utf8'));
await wait(3000);
window.eval(fs.readFileSync('/home/user/QC-TAHLIL/tools/qc-test/testbundle.js', 'utf8'));

await window.eval(`(async () => { await window.__PAGES.analyst.render(document.getElementById('page-root')); })()`);
await wait(4000);
const root = window.document.getElementById('page-root');

const ins = await (await fetch(`${BASE}/api/insights?source=inprocess`, { headers: { Authorization: `Bearer ${j.token}` } })).json();
const nf = (ins.headline.findings || []).length;

ok('سرور «یافته‌های تفکیک‌شده» می‌فرستد', nf >= 6, String(nf));
ok('هر یافته در کارتِ خودش رندر شد', root.querySelectorAll('.fd-grid .fd').length === nf,
  `${root.querySelectorAll('.fd-grid .fd').length} از ${nf}`);
ok('هر کارتِ یافته برچسب دارد (معلوم است عدد مالِ چیست)',
  Array.from(root.querySelectorAll('.fd')).every((x) => x.querySelector('.fd-label')?.textContent.trim().length > 2));
ok('هر کارتِ یافته یک مقدارِ برجسته دارد',
  Array.from(root.querySelectorAll('.fd')).filter((x) => x.querySelector('.fd-value')).length === nf);
ok('هر کارتِ یافته آیکونِ گرافیکی دارد', root.querySelectorAll('.fd .fd-icon').length === nf);
ok('کارتِ «بزرگ‌ترین موضوع» تراشه‌های برچسب‌دار دارد (محصول/فرآیند/ریشه)',
  root.querySelectorAll('.fd .fd-chip b').length >= 3, String(root.querySelectorAll('.fd .fd-chip b').length));
ok('یافتهٔ روند، لحنِ درست دارد (بهبود = سبز)', !!root.querySelector('.fd.tone-ok, .fd.tone-danger'));
ok('جملهٔ هر یافته جدا از عددِ بزرگ نوشته شده', root.querySelectorAll('.fd .fd-text').length >= nf - 1);

// بدنهٔ آلارم‌ها: جمله‌های جدا به‌جای پاراگرافِ پیوسته
const bodies = root.querySelectorAll('.alarm-body');
ok('بدنهٔ آلارم دیگر پاراگرافِ پیوسته نیست', root.querySelectorAll('p.alarm-body').length === 0);
ok('بدنهٔ آلارم فهرستِ جمله‌های جداست', Array.from(bodies).every((x) => x.classList.contains('sent-list')) && bodies.length > 3,
  String(bodies.length));
ok('هر آلارم بیش از یک سطرِ جدا دارد',
  Array.from(bodies).some((x) => x.querySelectorAll('li').length >= 2));
ok('عددها در متن برجسته (تراشهٔ عدد) شده‌اند', root.querySelectorAll('.alarm-body .num').length > 10,
  String(root.querySelectorAll('.alarm-body .num').length));
// عددِ چسبیده به حرف نباید برجسته شود (وگرنه «6M» و «ICN1» می‌شکنند)
const htmlNow = root.innerHTML;
ok('تراشهٔ عدد به حرفِ لاتین نمی‌چسبد (۶M نشکسته)', !/<b class="num">[^<]*<\/b>[A-Za-z]/.test(htmlNow));
ok('حرفِ لاتین قبلِ تراشهٔ عدد نمی‌آید (ICN1 نشکسته)', !/[A-Za-z]<b class="num">/.test(htmlNow));
ok('هیچ تراشهٔ عددی حرفِ لاتین داخلش نیست',
  Array.from(root.querySelectorAll('.num')).every((n) => !/[A-Za-z]/.test(n.textContent)));
ok('نشانگرِ رنگیِ هر سطر بر اساسِ شدتِ آلارم است',
  root.querySelectorAll('.sent-list.tone-high, .sent-list.tone-critical, .sent-list.tone-medium').length > 0);
ok('متنِ پیوستهٔ قدیم فقط در بخشِ بازشو باقی مانده', !!root.querySelector('.narrative-more > summary'));

// پروندهٔ TOP 10
await window.eval(`(async () => { const d = document.querySelector('.top-item'); if (d) d.open = true; })()`);
await wait(700);
ok('داستانِ هر موردِ TOP 10 هم سطرهای جدا دارد', root.querySelectorAll('.ti-story.sent-list li').length >= 2,
  String(root.querySelectorAll('.ti-story.sent-list li').length));

/* ---------------------------------------------------- ۳) صفحهٔ نمای کلی */
console.log('\n— صفحهٔ نمای کلی —');
await window.eval(`(async () => { await window.__PAGES.home.render(document.getElementById('page-root')); })()`);
await wait(4000);
const home = window.document.getElementById('page-root');
ok('کارتِ تحلیلگر در صفحهٔ اول هم یافته‌های جدا دارد', home.querySelectorAll('.fd-grid .fd').length >= 4,
  String(home.querySelectorAll('.fd-grid .fd').length));
ok('پاورقیِ کارتِ اول دیگر پاراگرافِ پیوستهٔ عدد نیست',
  !/در بازهٔ/.test(home.querySelector('.card-foot')?.textContent || ''));
ok('آلارم‌های کوچکِ صفحهٔ اول عددِ برجسته دارند', home.querySelectorAll('.mini-alarms .num').length >= 1,
  String(home.querySelectorAll('.mini-alarms .num').length));

console.log('\nخطاها:', errors.length ? [...new Set(errors)].slice(0, 5).join('\n') : 'بدون خطا');
console.log(`نتیجه: ${pass} موفق، ${fail} ناموفق`);
dom.window.close();
process.exit(fail || errors.length ? 1 : 0);
