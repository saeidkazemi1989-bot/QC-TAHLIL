/* بررسی «تحلیلگر خودکار» در نسخهٔ تک‌فایل آفلاین (QC-Dashboard.html) */
import { JSDOM, VirtualConsole } from 'jsdom';

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/getContext/.test(e.message)) errors.push('JSDOM: ' + e.message); });
vc.on('error', (...a) => errors.push('CONSOLE: ' + a.join(' ')));
const dom = await JSDOM.fromFile('/home/user/QC-TAHLIL/QC-Dashboard.html', {
  url: 'file:///C:/x/QC-Dashboard.html', runScripts: 'dangerously', resources: 'usable',
  pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(window) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
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
  window.echarts.init = (el, t, op) => o(el, t, { ...(op || {}), renderer: 'svg', width: 900, height: 340 });
}
await wait(1500);
window.eval(`(function(){var c=[].slice.call(document.querySelectorAll('.user-card'));(c.find(function(x){return x.textContent.includes('مدیر سیستم')})||c[0]).click();})()`);
await wait(3800);

const txt = (sel) => window.document.querySelector(sel)?.textContent.trim() || '';
const cnt = (sel) => window.document.querySelectorAll(sel).length;

console.log('۱) منو:', [...window.document.querySelectorAll('.side-link')].map((a) => a.dataset.page).join(','));
console.log('۲) نمای کلی — کارت تحلیلگر:');
console.log('   اولین کارت صفحه:', window.document.querySelector('#page-root .card')?.classList.contains('analyst-head') ? 'تحلیلگر ✅' : 'چیز دیگر ❌');
console.log('   وضعیت:', txt('.verdict-badge') || '—');
console.log('   کلیات:', txt('.verdict-text').slice(0, 150) + '…');
console.log('   سریع:', [...window.document.querySelectorAll('.quick-item')].slice(0, 4).map((q) => `${q.querySelector('small').textContent}=${q.querySelector('b').textContent.slice(0, 40)}`).join(' | '));
console.log('   آلارم‌های مهم:', cnt('.mini-alarms li'));
console.log('   پیوند تحلیل کامل:', window.document.querySelector('a[href="#/analyst"]') ? 'هست ✅' : 'نیست ❌');

for (const name of ['عیوب حین تولید', 'اسناد بازرسی', 'پلیمر']) {
  [...window.document.querySelectorAll('#src-seg button')].find((b) => b.textContent.includes(name))?.click();
  await wait(2600);
  window.eval(`location.hash = '#/analyst'`);
  await wait(3200);
  const rows = cnt('#an-top table tbody tr');
  console.log(`۳) صفحهٔ تحلیلگر — ${name}:`);
  console.log(`   وضعیت: ${txt('.verdict-badge')} | آلارم‌ها: ${cnt('#an-alarms .alarm')} | سطرهای TOP: ${rows} | نمودار: ${cnt('#an-pareto svg')} | جزئیات: ${cnt('.top-item')}`);
  console.log(`   پایهٔ تحلیل: ${txt('.card-foot').slice(0, 90)}`);
  console.log(`   اولین آلارم: ${txt('#an-alarms .alarm .alarm-title').slice(0, 90)}`);
  console.log(`   اقدام: ${txt('#an-alarms .alarm .alarm-action').slice(0, 90)}`);
  console.log(`   TOP1: ${[...(window.document.querySelectorAll('#an-top table tbody tr')[0]?.querySelectorAll('td') || [])].map((td) => td.textContent.trim()).join(' ¦ ').slice(0, 130)}`);
  /* دریل در نسخهٔ آفلاین: فقط منبع را عوض می‌کند و باید پیام بدهد، نه خطا */
  window.document.querySelector('.alarm-drill')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(1200);
  console.log(`   دریل آفلاین: پیام = ${txt('.toast') ? 'دارد ✅' : 'ندارد'} | خطا = ${errors.length ? '❌' : 'خیر ✅'}`);
  window.eval(`location.hash = '#/analyst'`);
  await wait(1800);
  /* فیلتر شدت */
  window.document.querySelector('#an-sev button[data-g="high"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(500);
  const shown = [...window.document.querySelectorAll('#an-alarms .alarm')].filter((e) => e.style.display !== 'none');
  console.log(`   فیلتر «مهم»: ${shown.length} آلارم نمایش داده شد (همه مهم؟ ${shown.every((e) => e.dataset.sev === 'high') ? 'بله ✅' : 'خیر ❌'})`);
  window.document.querySelector('#an-sev button[data-g="all"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(400);
}

console.log('\nخطاها:', errors.length ? [...new Set(errors)].slice(0, 5).join('\n') : 'بدون خطا ✅');
dom.window.close();
process.exit(errors.length ? 1 : 0);
