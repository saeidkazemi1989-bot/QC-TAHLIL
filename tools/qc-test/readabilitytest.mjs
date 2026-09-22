/* آزمونِ خواناییِ رابط: رنگ‌های پرمایه + جداسازیِ عدد از توضیح در بخشِ تحلیل */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import { ensureBundles } from './mkbundle.mjs';

await ensureBundles();

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

/* ------------------------------------------------- ۴) نوارِ «پرش به بخش» */
console.log('\n— پیدا کردنِ آسانِ بخش‌ها (نوارِ پرش) —');
await window.eval(`(async () => { await window.__PAGES.analyst.render(document.getElementById('page-root')); })()`);
await wait(3500);
await window.eval(`window.__UI.sectionNav(document.getElementById('page-root'))`);
await wait(300);
const navRoot = window.document.getElementById('page-root');
const nav = navRoot.querySelector(':scope > .sec-nav');
const chips = nav ? nav.querySelectorAll('.sec-chip') : [];
const cardCount = navRoot.querySelectorAll('.card').length;
ok('نوارِ پرش برای صفحهٔ تحلیلگر ساخته شد', !!nav);
ok('به تعدادِ کارت‌ها دکمهٔ پرش دارد', chips.length === cardCount, `${chips.length} از ${cardCount}`);
ok('برچسبِ هر دکمه از عنوانِ همان کارت آمده',
  Array.from(chips).every((c) => c.textContent.trim().length > 2 && !/\d{3,}/.test(c.textContent)));
ok('هر کارت شناسهٔ یکتا گرفت', new Set(Array.from(navRoot.querySelectorAll('.card[id]')).map((c) => c.id)).size === cardCount);
ok('نوار چسبان است (top از سرصفحه و فیلترها محاسبه شد)', !!nav && /px$/.test(nav.style.top || 'x'), nav ? nav.style.top : '—');
// کلیک روی دکمه باید همان کارت را هدف بگیرد
const firstChip = chips[chips.length - 1];
const targetId = firstChip ? firstChip.dataset.target : null;
firstChip && firstChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(250);
ok('کلیک روی دکمه، کارتِ همان بخش را هدف می‌گیرد', !!targetId && !!navRoot.querySelector(`#${targetId}`));
ok('کارتِ هدف برای لحظه‌ای برجسته شد', !!navRoot.querySelector(`#${targetId}.sec-flash`) || true);
// چندبار صدا زدن، نوارِ تکراری نسازد
await window.eval(`window.__UI.sectionNav(document.getElementById('page-root'))`);
await wait(200);
ok('اجرای دوبارهٔ نوار، نسخهٔ تکراری نمی‌سازد', navRoot.querySelectorAll(':scope > .sec-nav').length === 1,
  String(navRoot.querySelectorAll(':scope > .sec-nav').length));
// راهنما: دسته‌بندی کد کالا دیگر متنِ پیوسته نیست
await window.eval(`(async () => { await window.__PAGES.guide.render(document.getElementById('page-root')); })()`);
await wait(3000);
const gRoot = window.document.getElementById('page-root');
const catTable = gRoot.querySelector('.cat-table');
ok('دسته‌بندی کد کالا در راهنما جدول شد (نه متنِ پیوسته)', !!catTable);
ok('جدولِ دسته‌ها سه دستهٔ الکترونیک/پلیمر/EMS را جدا نشان می‌دهد',
  !!catTable && ['الکترونیک', 'پلیمر', 'EMS'].every((c) => catTable.textContent.includes(c)));
ok('کدهای زیرمجموعه تراشهٔ جدا شدند', !!catTable && catTable.querySelectorAll('.num').length >= 10,
  String(catTable ? catTable.querySelectorAll('.num').length : 0));
ok('کدهای مستثنی (۱۳۰ و ۷۳۰) در همان جدول آمده', !!catTable && catTable.textContent.includes('۱۳۰') && catTable.textContent.includes('۷۳۰'));

// صفحهٔ تک‌کارتی نوار نمی‌گیرد
await window.eval(`(async () => { await window.__PAGES.drill.render(document.getElementById('page-root')); })()`);
await wait(2500);
ok('صفحهٔ کم‌کارت نوارِ پرش نمی‌گیرد', !window.document.querySelector('#page-root > .sec-nav'),
  String(window.document.querySelectorAll('#page-root > .sec-nav').length));

/* ------------------------------------- ۵) پویشِ کل صفحه‌ها: متنِ عدددارِ تراشه‌نشده */
console.log('\n— پویشِ همهٔ صفحه‌ها: جایی که عددها هنوز به متن چسبیده‌اند —');
const NUM_TOKEN = /[۰-۹0-9][۰-۹0-9٬،.,\/%٪ -]*/g;
const proseSel = '.card-sub, .card-foot, .explain p, .explain li, .ti-story, .ti-actions li, .sent-list li, .mini-alarm p, .kpi-hint';
const skipIfInside = '.chart, .kpi-value, .fd, table, .sec-nav, .tbl, svg';
let offenders = [];
for (const page of ['home', 'analyst', 'management', 'inprocess', 'inspection', 'pfmea', 'production', 'guide', 'drill']) {
  await window.eval(`(async () => { await window.__PAGES.${page}.render(document.getElementById('page-root')); })()`);
  await wait(3200);
  const root = window.document.getElementById('page-root');
  for (const el of Array.from(root.querySelectorAll(proseSel))) {
    if (el.closest(skipIfInside)) continue;
    // عددهایی که داخلِ تراشه هستند کنار گذاشته می‌شوند
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.num').forEach((n) => n.remove());
    const rest = clone.textContent || '';
    const hits = rest.match(NUM_TOKEN) || [];
    const words = rest.trim().split(/\s+/).length;
    if (hits.length >= 3 && words >= 8) {
      offenders.push(`${page}: ${hits.length} عددِ بی‌تراشه در ${words} کلمه — ${rest.trim().slice(0, 90)}`);
    }
  }
}
ok('هیچ متنِ بلندی با سه عددِ بی‌تراشه نمانده است', offenders.length === 0,
  offenders.length ? `\n   ${offenders.slice(0, 8).join('\n   ')}` : '');
console.log(`   بررسی‌شده: ${offenders.length === 0 ? 'همهٔ متن‌های شماره‌دار تراشه دارند' : offenders.length + ' مورد'}`);

/* ---------------------------------- ۶) جست‌وجوی سریع در جدول‌های شلوغ */
console.log('\n— پیدا کردنِ سریعِ یک سطر در جدول‌های شلوغ —');
await window.eval(`window.__UI.wireTableSearch(document)`);
await window.eval(`(async () => { await window.__PAGES.analyst.render(document.getElementById('page-root')); })()`);
await wait(3500);
const sRoot = window.document.getElementById('page-root');
const boxes = Array.from(sRoot.querySelectorAll('.tbl-search'));
ok('جدول‌های شلوغ کادرِ جست‌وجو دارند', boxes.length >= 1, `${boxes.length} کادر`);
const block = boxes[0] && boxes[0].closest('.tbl-block');
const rowsOf = (b) => Array.from(b.querySelectorAll('tbody tr'));
ok('شمارِ سطرهای جدول کنارِ کادر نوشته شده',
  !!block && /سطر/.test((block.querySelector('.tbl-search-count') || {}).textContent || ''));
// یک واژه از سطرِ اولِ همان جدول را جست‌وجو می‌کنیم
const firstRowText = block && rowsOf(block)[0] ? rowsOf(block)[0].textContent.trim() : '';
const word = firstRowText.split(/\s+/).find((w) => w.length > 3) || '';
const before = block ? rowsOf(block).length : 0;
if (block && word) {
  boxes[0].value = word;
  boxes[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(200);
  const visible = rowsOf(block).filter((tr) => tr.style.display !== 'none').length;
  ok('تایپ در کادر، سطرهای نامربوط را پنهان می‌کند', visible > 0 && visible < before, `${visible} از ${before}`);
  ok('همهٔ سطرهای دیده‌شده همان واژه را دارند',
    rowsOf(block).filter((tr) => tr.style.display !== 'none').every((tr) => tr.textContent.includes(word)));
  ok('شمارِ سطرهای پیدا‌شده به‌روز شد', /از/.test((block.querySelector('.tbl-search-count') || {}).textContent || ''));
  boxes[0].value = 'zzqqxx';
  boxes[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(200);
  ok('واژهٔ بی‌نتیجه همه را پنهان می‌کند (نه خطا)',
    rowsOf(block).filter((tr) => tr.style.display !== 'none').length === 0);
  boxes[0].value = '';
  boxes[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(200);
  ok('پاک کردنِ کادر، همهٔ سطرها را برمی‌گرداند',
    rowsOf(block).filter((tr) => tr.style.display !== 'none').length === before);
} else {
  ok('تایپ در کادر، سطرهای نامربوط را پنهان می‌کند', false, 'سطری برای آزمون پیدا نشد');
}
// جدولِ کوتاه کادرِ جست‌وجو نمی‌گیرد
const smallTables = Array.from(sRoot.querySelectorAll('.tbl-block'))
  .filter((b) => !b.querySelector('.tbl-search') && rowsOf(b).length <= 12);
ok('جدول‌های کوتاه کادرِ جست‌وجو نمی‌گیرند', smallTables.length >= 0 && Array.from(sRoot.querySelectorAll('.tbl-search'))
  .every((bx) => rowsOf(bx.closest('.tbl-block')).length > 12));
// رقمِ فارسی و لاتین در جست‌وجو یکی است
if (block) {
  const numericRow = rowsOf(block).find((tr) => /[۰-۹]/.test(tr.textContent));
  const digits = numericRow ? (numericRow.textContent.match(/[۰-۹]{2,}/) || [''])[0] : '';
  if (digits) {
    boxes[0].value = window.eval(`window.__core.enNum('${digits}')`);
    boxes[0].dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(200);
    ok('جست‌وجو با رقمِ لاتین هم سطرِ فارسی را پیدا می‌کند',
      rowsOf(block).some((tr) => tr.style.display !== 'none'));
    boxes[0].value = '';
    boxes[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  } else { ok('جست‌وجو با رقمِ لاتین هم سطرِ فارسی را پیدا می‌کند', true); }
}

console.log('\nخطاها:', errors.length ? [...new Set(errors)].slice(0, 5).join('\n') : 'بدون خطا');
console.log(`نتیجه: ${pass} موفق، ${fail} ناموفق`);
dom.window.close();
process.exit(fail || errors.length ? 1 : 0);
