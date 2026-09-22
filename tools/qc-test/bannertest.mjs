/* بررسیِ بنرِ «چرا داده‌ای دیده نمی‌شود؟» در محیطِ مرورگرگونه (jsdom) */
import * as esbuild from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const REPO = '/home/user/QC-TAHLIL';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name, extra); } };

const build = await esbuild.build({
  stdin: { contents: `import * as APP from ${JSON.stringify(REPO + '/public/js/app.js')};\nwindow.__APP = APP;`, resolveDir: REPO },
  bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'warning'
});
const code = build.outputFiles[0].text;

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('JSDOM: ' + e.message));
vc.on('error', (...a) => errors.push('CONSOLE: ' + a.join(' ')));

const dom = new JSDOM(`<!doctype html><html dir="rtl" lang="fa"><body>
  <main class="app-main">
    <div class="data-banner" id="data-banner" hidden></div>
    <div class="filter-bar" id="filter-bar"></div>
    <div class="page-root" id="page-root"></div>
  </main></body></html>`, {
  url: 'http://localhost:3000/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(window) { window.__STATIC__ = true; window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; }
});
const { window } = dom;
window.eval(code);
ok('باندل بدون خطا بارگذاری شد', !!window.__APP && errors.length === 0, errors.slice(0, 2).join(' | '));
ok('renderDataBanner صادر شده است', typeof window.__APP?.renderDataBanner === 'function');

const box = window.document.getElementById('data-banner');
const DIAGS = [
  { level: 'error', text: 'پوشهٔ data/clean خالی است و پایتون/openpyxl روی این سیستم پیدا نشد؛ install_windows.bat را اجرا کنید.' },
  { level: 'warn', text: 'این فایل‌های اکسل در ریشهٔ پروژه‌اند و خوانده نمی‌شوند؛ به data/raw منتقلشان کنید: فایل جدید من.xlsx' }
];

window.__APP.renderDataBanner(DIAGS);
ok('با تشخیصِ خطا، بنر دیده می‌شود', box.hidden === false);
ok('  شدتِ بنر درست است (خطا بر هشدار غالب است)', box.className === 'data-banner lv-error', box.className);
ok('  هر دو پیام نمایش داده می‌شود', box.querySelectorAll('li').length === 2 && box.textContent.includes('install_windows.bat'));
ok('  عنوان و راهنمای عملی دارد', box.textContent.includes('چرا داده‌ای دیده نمی‌شود؟') && box.textContent.includes('data/raw'));
ok('  level هر پیام روی li می‌نشیند', box.querySelector('li.lv-error') && box.querySelector('li.lv-warn'));

window.__APP.renderDataBanner([{ level: 'warn', text: 'هشدارِ تنها' }]);
ok('فقط هشدار ⇒ کلاس lv-warn', box.className === 'data-banner lv-warn', box.className);

window.__APP.renderDataBanner([]);
ok('بدونِ تشخیص ⇒ بنر پنهان و خالی می‌شود', box.hidden === true && box.innerHTML === '');

window.__APP.renderDataBanner(undefined);
ok('ورودیِ تعریف‌نشده هم خطا نمی‌دهد', box.hidden === true);

// متنِ خطرناک باید escape شود
window.__APP.renderDataBanner([{ level: 'error', text: '<img src=x onerror=alert(1)>' }]);
ok('متنِ تشخیص escape می‌شود (HTML تزریق نمی‌شود)', !box.querySelector('img') && box.textContent.includes('<img src=x'), box.innerHTML.slice(0, 90));

ok('بدونِ خطای زمانِ اجرا', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
window.close();
process.exit(fail ? 1 : 0);
