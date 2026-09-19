/* ابزارهای مشترک رابط کاربری: اعداد فارسی، تاریخ، فراخوانی API، وضعیت */
const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function faNum(input) {
  if (input === null || input === undefined || input === '') return '—';
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

export function faInt(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return faNum(Math.round(Number(n)).toLocaleString('en-US'));
}

export function faDec(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return faNum(Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
}

export function faPct(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${faDec(n, digits)}٪`;
}

export function enNum(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();
}

/** کوتاه‌سازی عدد برای نمایش در کارت‌ها */
export function compact(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return `${faDec(v / 1e6, 2)} میلیون`;
  if (Math.abs(v) >= 1e3) return `${faDec(v / 1e3, 1)} هزار`;
  return faInt(v);
}

export const state = {
  token: localStorage.getItem('qc_token') || null,
  user: JSON.parse(localStorage.getItem('qc_user') || 'null'),
  meta: null,
  filters: {},
  source: 'inprocess'
};

export function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('qc_token', token);
  localStorage.setItem('qc_user', JSON.stringify(user));
}

export function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('qc_token');
  localStorage.removeItem('qc_user');
  location.hash = '#/login';
  location.reload();
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    ...options,
    headers,
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body
  });
  if (res.status === 401) {
    logout();
    throw new Error('نشست شما پایان یافته؛ دوباره وارد شوید');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data && data.error) || `خطا در ارتباط با سرور (${res.status})`);
  return data;
}

/** ساخت رشته کوئری از فیلترها */
export function filterQuery(extra = {}) {
  const p = new URLSearchParams();
  const f = { ...state.filters, ...extra };
  for (const [k, v] of Object.entries(f)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(','));
    } else {
      p.set(k, v);
    }
  }
  if (!f.source && state.source) p.set('source', state.source);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** خروجی CSV از یک جدول داده‌ای */
export function downloadCsv(filename, columns, rows) {
  const header = Object.values(columns).join(',');
  const keys = Object.keys(columns);
  const body = rows.map((r) => keys.map((k) => {
    const v = r[k] === null || r[k] === undefined ? '' : String(r[k]);
    return `"${v.replace(/"/g, '""')}"`;
  }).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function toast(message, kind = 'info') {
  const box = document.getElementById('toast-box');
  if (!box) return;
  const node = el(`<div class="toast toast-${kind}">${escapeHtml(message)}</div>`);
  box.appendChild(node);
  setTimeout(() => node.classList.add('show'), 10);
  setTimeout(() => { node.classList.remove('show'); setTimeout(() => node.remove(), 300); }, 4000);
}
