/**
 * ورودیِ «نسخه تک‌فایل»
 * ---------------------------------------------------------------
 * در این نسخه هیچ سروری وجود ندارد؛ بنابراین تابع fetch با یک نسخه‌ی آفلاین
 * جایگزین می‌شود که پاسخ‌ها را از داده‌هایِ از پیش محاسبه‌شده (Snapshot) می‌خواند.
 * بقیه‌ی کد برنامه بدون تغییر کار می‌کند.
 */
window.__STATIC__ = true;

/** یکسان‌سازی کلید کوئری برای پیدا کردن پاسخ در snapshot */
function normalizeKey(path) {
  const qIndex = path.indexOf('?');
  if (qIndex < 0) return path;
  const base = path.slice(0, qIndex);
  const params = new URLSearchParams(path.slice(qIndex + 1));
  // پارامترهایی که در نسخه آفلاین اهمیتی ندارند (داده با حداکثر حجم ذخیره شده)
  const ignore = new Set(['limit', 'size', 'page', 'sort', 'dir']);
  const entries = [...params.entries()]
    .filter(([k]) => !ignore.has(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${base}?${new URLSearchParams(entries).toString()}`;
}

const EMPTY = {
  '/api/summary': { production: 0, defects: 0, ppm: 0, orders: 0, scrap: 0, scrap_rate: 0, rework_hours: 0 },
  '/api/trend': [],
  '/api/breakdown': [],
  '/api/matrix': { rows: [], cols: [], cells: [] },
  '/api/pfmea': [],
  '/api/times': [],
  '/api/records': { rows: [], total: 0, defectsSum: 0, columns: {} },
  '/api/insights': { headline: null, alarms: [], actions: [], top_repair: [], focus: [], sources_overview: [], basis: null, thresholds: null },
  '/api/production/trend': [],
  '/api/production/breakdown': [],
  '/api/production/summary': { docs: 0, production: 0, scrap: 0, personnel: 0, products: 0, work_centers: 0 }
};

const SNAPSHOT = window.__SNAPSHOT__ || { data: {}, meta: null, generatedAt: null };

function jsonResponse(body) {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body))
  });
}

window.fetch = function fakeFetch(input, options = {}) {
  const raw = typeof input === 'string' ? input : (input && input.url) || '';
  const qIndex = raw.indexOf('?');
  const base = qIndex < 0 ? raw : raw.slice(0, qIndex);
  const params = new URLSearchParams(qIndex < 0 ? '' : raw.slice(qIndex + 1));

  // ورود: پاسخ متناسب با نقش انتخابی
  if (base === '/api/auth/login') {
    let username = 'admin';
    try { username = JSON.parse(options.body || '{}').username || 'admin'; } catch { /* ignore */ }
    const users = (SNAPSHOT.logins || {});
    return jsonResponse(users[username] || users.admin);
  }

  // جست‌وجو در جدول رکوردها به صورت محلی انجام می‌شود
  if (base === '/api/records' && params.get('q')) {
    const key = normalizeKey(raw);
    const data = SNAPSHOT.data[key];
    if (data && data.rows) {
      const q = params.get('q').toLowerCase();
      const rows = data.rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q)));
      const sum = rows.reduce((s, r) => s + (Number(r.defect_qty) || 0), 0);
      return jsonResponse({ ...data, rows, total: rows.length, defectsSum: sum });
    }
  }

  const key = normalizeKey(raw);
  if (Object.prototype.hasOwnProperty.call(SNAPSHOT.data, key)) {
    return jsonResponse(SNAPSHOT.data[key]);
  }

  // درخواست‌های تغییردهنده (مثل بارگذاری فایل) در نسخه آفلاین پشتیبانی نمی‌شوند
  if (options.method && options.method !== 'GET') {
    return Promise.resolve({
      ok: false, status: 400,
      text: () => Promise.resolve(JSON.stringify({ error: 'در نسخه تک‌فایل امکان تغییر داده وجود ندارد؛ برای بارگذاری داده جدید نسخه سروری را اجرا کنید.' }))
    });
  }

  return jsonResponse(EMPTY[base] !== undefined ? EMPTY[base] : {});
};

// بارگذاری پویا: ابتدا fetch آفلاین جایگزین می‌شود و سپس برنامه اجرا می‌گردد
import('../public/js/app.js')
  .then((mod) => mod.startApp())
  .catch((err) => {
    document.getElementById('app').innerHTML =
      '<div class="boot-error"><h2>خطا در بارگذاری برنامه</h2><pre>' +
      String(err && err.message ? err.message : err).replace(/</g, '&lt;') + '</pre></div>';
  });
