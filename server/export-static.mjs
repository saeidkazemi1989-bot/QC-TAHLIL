/**
 * ساخت «نسخه تک‌فایل» برای دیدن نمودارها بدون نیاز به نصب و اجرای سرور
 * ---------------------------------------------------------------
 * خروجی: QC-Dashboard.html در ریشه پروژه
 * تمام داده‌ها و کتابخانه نمودار درون همان فایل قرار می‌گیرند؛
 * بنابراین با دبل‌کلیک روی آن (حتی بدون اینترنت) باز می‌شود.
 *
 * اجرا:  npm run export
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

import { getDb, ready as dbReady, getSettings, RAW_DIR, ROOT } from './db.mjs';
import { parseFilters } from './filters.mjs';
import {
  summary, trend, breakdown, pfmea, records, recordColumns,
  productionSummary, productionTrend, productionBreakdown, meta, times, matrix, DIMENSIONS,
  drillTree
} from './analytics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.resolve(__dirname, '..');

await dbReady;
const db = getDb();

/** یکسان‌سازی کلید (همان منطقِ سمت مرورگر) */
function normalizeKey(pathname) {
  const qIndex = pathname.indexOf('?');
  if (qIndex < 0) return pathname;
  const base = pathname.slice(0, qIndex);
  const params = new URLSearchParams(pathname.slice(qIndex + 1));
  const ignore = new Set(['limit', 'size', 'page', 'sort', 'dir']);
  const entries = [...params.entries()]
    .filter(([k]) => !ignore.has(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${base}?${new URLSearchParams(entries).toString()}`;
}

const data = {};
const put = (url, value) => { data[normalizeKey(url)] = value; };

// ---------------------------------------------------------------- داده‌ها
const sources = ['inprocess', 'inspection', 'polymer'];
const grains = ['day', 'week', 'month', 'quarter', 'half', 'year'];
const dims = Object.keys(DIMENSIONS);

for (const source of sources) {
  const f = parseFilters({ source });
  put(`/api/summary?source=${source}`, summary(f, source));
  for (const g of grains) put(`/api/trend?source=${source}&group=${g}`, trend(f, source, g));
  for (const dim of dims) {
    put(`/api/breakdown?source=${source}&dim=${dim}&limit=50`, breakdown(f, source, dim, 50));
  }
  put(`/api/matrix?source=${source}&row=defect&col=station&rows=12&cols=8`, matrix(f, source, 'defect', 'station', 12, 8));
  put(`/api/matrix?source=${source}&row=final_group&col=defect_group&rows=8&cols=5`, matrix(f, source, 'final_group', 'defect_group', 8, 5));
  put(`/api/matrix?source=${source}&row=product&col=defect&rows=10&cols=6`, matrix(f, source, 'product', 'defect', 10, 6));
  put(`/api/matrix?source=${source}&row=product_unified&col=stage&rows=15&cols=8`, matrix(f, source, 'product_unified', 'stage', 15, 8));
  put(`/api/records?source=${source}&page=1&size=500&sort=defect_qty&dir=DESC`,
    { ...records(f, source, { page: 1, size: 500, sort: 'defect_qty', dir: 'DESC' }), columns: recordColumns(source) });
  // تحلیل گام‌به‌گام (دریل‌داون) برای کل بازه
  put(`/api/drill?source=${source}`, drillTree(f, source));
}
put('/api/times?source=inprocess&dim=station&limit=10', times(parseFilters({ source: 'inprocess' }), 'station', 10));
put('/api/pfmea?source=inprocess&limit=60', pfmea(parseFilters({ source: 'inprocess' }), 60));

// تولید (برای هر دو منبع کلید جداگانه ذخیره می‌شود چون کلید درخواست شامل منبع است)
const pf = parseFilters({ source: 'inprocess' });
for (const source of sources) {
  put(`/api/production/summary?source=${source}`, productionSummary(pf));
  for (const g of ['day', 'week', 'month']) put(`/api/production/trend?group=${g}&source=${source}`, productionTrend(pf, g));
  for (const dim of ['work_center', 'process_domain', 'category', 'product', 'final_group']) {
    put(`/api/production/breakdown?dim=${dim}&limit=30&source=${source}`, productionBreakdown(pf, dim, 30));
  }
}

// فراداده و مدیریت (فقط خواندنی)
const metaInfo = meta();
const rolePages = {
  admin: ['home', 'drill', 'management', 'inprocess', 'inspection', 'pfmea', 'production', 'records', 'admin', 'guide'],
  executive: ['home', 'drill', 'management', 'production', 'guide'],
  expert: ['home', 'drill', 'inprocess', 'inspection', 'pfmea', 'production', 'records', 'guide']
};
const roleLabels = { admin: 'مدیر سیستم', executive: 'مدیر ارشد', expert: 'کارشناس کیفیت' };
const users = db.prepare('SELECT username, display_name, role, active FROM app_user WHERE active = 1 ORDER BY id').all();
const authUsers = users.map((u) => ({
  username: u.username,
  display_name: u.display_name,
  role: u.role,
  role_label: roleLabels[u.role] || u.role,
  has_password: false,
  pages: rolePages[u.role] || rolePages.expert
}));
const logins = {};
for (const u of authUsers) {
  logins[u.username] = {
    token: 'offline',
    user: { username: u.username, display_name: u.display_name, role: u.role, role_label: u.role_label, pages: u.pages }
  };
}
put('/api/auth/users', { users: authUsers, roles: Object.entries(roleLabels).map(([id, label]) => ({ id, label, pages: rolePages[id] })) });
put('/api/meta', { ...metaInfo, role: 'admin', pages: rolePages.admin, settings: getSettings(), imports: db.prepare('SELECT * FROM import_file ORDER BY imported_at DESC').all() });

const files = fs.readdirSync(RAW_DIR)
  .filter((f) => /\.(xlsx|xlsm)$/i.test(f) && !f.startsWith('~$'))
  .map((f) => {
    const rec = db.prepare('SELECT source_type, rows_loaded, imported_at, status, message FROM import_file WHERE file_name = ?').all(f);
    return { name: f, size: fs.statSync(path.join(RAW_DIR, f)).size, modified: new Date().toISOString(), records: rec };
  });
put('/api/admin/files', { files });
put('/api/admin/users', db.prepare('SELECT id, username, display_name, role, active, created_at, (password_hash IS NOT NULL) AS has_password FROM app_user ORDER BY id').all());
put('/api/admin/settings', db.prepare('SELECT key, value, label, description FROM app_setting').all());

// ---------------------------------------------------------------- بسته‌بندی
const css = fs.readFileSync(path.join(PAGES_DIR, 'public', 'css', 'app.css'), 'utf8');
const echarts = fs.readFileSync(path.join(PAGES_DIR, 'public', 'vendor', 'echarts.min.js'), 'utf8');

const build = await esbuild.build({
  entryPoints: [path.join(PAGES_DIR, 'tools', 'static-entry.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none'
});
const appJs = build.outputFiles[0].text;

const faDate = new Date().toLocaleDateString('fa-IR');
const snapshot = JSON.stringify({ data, logins, meta: metaInfo, generatedAt: new Date().toISOString() });

const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>سامانه گزارشات کیفیت - نسخه تک‌فایل</title>
<style>${css}
.static-note{background:#eaf2fb;border:1px solid #cfe0f5;border-radius:12px;padding:10px 16px;margin:10px 24px;font-size:13px;color:#23548a}
.static-note b{color:#16202e}
</style>
</head>
<body>
<div id="app"><div class="boot">در حال بارگذاری…</div></div>
<script>window.__SNAPSHOT__ = ${snapshot};</script>
<script>${echarts}</script>
<script>${appJs}</script>
<script>
  // یادداشت بالای صفحه برای نسخه آفلاین (تا وقتی صفحه اصلی آماده شود صبر می‌کند)
  (function(){
    var tries = 0;
    var timer = setInterval(function(){
      tries += 1;
      var shell = document.querySelector('.app-main');
      if (shell && !document.querySelector('.static-note')) {
        var note = document.createElement('div');
        note.className = 'static-note';
        note.innerHTML = 'نسخه <b>تک‌فایل و آفلاین</b> — داده‌ها تا تاریخ <b>${faDate}</b> درون همین فایل ذخیره شده‌اند و نیازی به اینترنت یا سرور ندارند. ' +
          'در این نسخه فقط انتخاب منبع عیب فعال است و امکان بارگذاری داده جدید وجود ندارد؛ ' +
          'برای فیلترهای کامل و به‌روزرسانی داده، <b>start.bat</b> را اجرا کنید.';
        shell.insertBefore(note, shell.children[1] || null);
        clearInterval(timer);
      }
      if (tries > 120) clearInterval(timer);
    }, 250);
  })();
</script>
</body>
</html>`;

const outPath = path.join(PAGES_DIR, 'QC-Dashboard.html');
fs.writeFileSync(outPath, html, 'utf8');

const sizeMb = (Buffer.byteLength(html, 'utf8') / (1024 * 1024)).toFixed(2);
console.log(`[export] فایل ساخته شد: ${outPath}`);
console.log(`[export] حجم: ${sizeMb} مگابایت | تعداد پرس‌وجوهای ذخیره‌شده: ${Object.keys(data).length}`);
console.log('[export] این فایل را می‌توان با دبل‌کلیک (بدون نیاز به سرور) باز کرد.');
void ROOT;
