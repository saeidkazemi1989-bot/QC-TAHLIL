/* چارچوب اصلی رابط کاربری: ورود، منو، فیلترها، مسیریابی */
import { api, state, saveSession, logout, faInt, faDec, escapeHtml, el, toast } from './core.js';
import { PAGES } from './pages.js';
import { infoPopoverHtml } from './ui.js';
import { j2d, d2j, formatJalali, parseJalali, toFa, toEn } from './jalali.js';

const PAGE_META = {
  home: { icon: '📊', label: 'نمای کلی', desc: 'خلاصه وضعیت کیفیت' },
  management: { icon: '🏛️', label: 'داشبورد مدیریتی', desc: 'روند و مقایسه برای تصمیم‌گیری' },
  inprocess: { icon: '🔧', label: 'تحلیل حین تولید', desc: 'ریشه‌یابی ریز عیوب' },
  inspection: { icon: '🔍', label: 'اسناد بازرسی (OQC)', desc: 'دلایل مردودی در بازرسی' },
  pfmea: { icon: '⚠️', label: 'تحلیل PFMEA / RPN', desc: 'اولویت‌بندی ریسک' },
  production: { icon: '🏭', label: 'گزارش تولید', desc: 'حجم تولید و مراکز کاری' },
  records: { icon: '📋', label: 'رکوردهای تفصیلی', desc: 'داده‌ها ردیف‌به‌ردیف' },
  admin: { icon: '⚙️', label: 'مدیریت داده و کاربران', desc: 'به‌روزرسانی و دسترسی‌ها' },
  guide: { icon: '📖', label: 'راهنما و واژه‌نامه', desc: 'توضیح شاخص‌ها' }
};

const ROLE_LABELS = { admin: 'مدیر سیستم', executive: 'مدیر ارشد', expert: 'کارشناس کیفیت' };

/* ------------------------------------------------------------------ ورود */
async function renderLogin() {
  const app = document.getElementById('app');
  const data = await api('/api/auth/users');
  const cards = data.users.map((u) => `
    <button class="user-card" data-user="${escapeHtml(u.username)}">
      <div class="user-role">${escapeHtml(u.role_label)}</div>
      <div class="user-icon">${u.role === 'admin' ? '🛠️' : u.role === 'executive' ? '👔' : '🔬'}</div>
      <ul class="user-pages">
        ${u.pages.map((p) => `<li>${PAGE_META[p]?.icon || '•'} ${PAGE_META[p]?.label || p}</li>`).join('')}
      </ul>
      <div class="user-enter">ورود به سامانه</div>
    </button>`).join('');

  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-brand">
          <div class="brand-logo">QC</div>
          <div>
            <h1>سامانه گزارشات کیفیت</h1>
            <p>${escapeHtml(state.meta?.settings?.company_name || 'شرکت سازه پویش')}</p>
          </div>
        </div>
        <p class="login-lead">نقش خود را انتخاب کنید تا وارد شوید. دسترسی هر نقش به صفحه‌ها متفاوت است.</p>
        <div class="user-cards">${cards}</div>
        <p class="login-foot">داده‌ها از فایل‌های اکسلِ گزارشات کیفیت خوانده شده‌اند و با بارگذاری فایل جدید به‌روز می‌شوند.</p>
      </div>
    </div>`;

  app.querySelectorAll('.user-card').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const res = await api('/api/auth/login', { method: 'POST', body: { username: btn.dataset.user } });
        saveSession(res.token, res.user);
        await start();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/* ------------------------------------------------------------------ چارچوب */
async function start() {
  if (!state.token) { await renderLogin(); return; }
  try {
    if (!state.user) {
      const me = await api('/api/auth/me');
      state.user = me.user;
    }
    state.meta = await api('/api/meta');
    if (!state.user.pages) state.user.pages = state.meta.pages;
    renderShell();
    route();
  } catch (err) {
    console.error(err);
    logout();
  }
}

function renderShell() {
  const user = state.user;
  const pages = user.pages || state.meta.pages || ['home'];
  const app = document.getElementById('app');
  const lastImport = state.meta.imports?.[0];
  app.innerHTML = `
    <div class="app-shell">
      <aside class="app-side">
        <div class="side-brand">
          <div class="brand-logo">QC</div>
          <div class="brand-text">
            <strong>گزارشات کیفیت</strong>
            <small>${escapeHtml(state.meta.settings?.company_name || 'سازه پویش')}</small>
          </div>
        </div>
        <nav class="side-nav" id="side-nav">
          ${pages.map((p) => `
            <a href="#/${p}" class="side-link" data-page="${p}">
              <span class="side-icon">${PAGE_META[p]?.icon || '•'}</span>
              <span class="side-text">
                <b>${PAGE_META[p]?.label || p}</b>
                <small>${PAGE_META[p]?.desc || ''}</small>
              </span>
            </a>`).join('')}
        </nav>
        <div class="side-foot">
          <div class="data-status">
            <span class="dot ok"></span>
            <div>
              <small>آخرین به‌روزرسانی داده</small>
              <b>${lastImport ? faInt(lastImport.imported_at.replace('T', ' ').slice(0, 16)) : '—'}</b>
            </div>
          </div>
        </div>
      </aside>
      <main class="app-main">
        <header class="app-header">
          <div class="head-titles">
            <h1 id="page-title">—</h1>
            <p id="page-subtitle"></p>
          </div>
          <div class="head-user">
            <div class="user-chip">
              <b>${escapeHtml(user.display_name)}</b>
              <small>${escapeHtml(ROLE_LABELS[user.role] || user.role)}</small>
            </div>
            <button class="btn btn-ghost" id="btn-logout">خروج</button>
          </div>
        </header>
        <div class="filter-bar" id="filter-bar"></div>
        <div class="page-root" id="page-root"></div>
      </main>
    </div>
    <div id="toast-box" class="toast-box"></div>
    <div id="info-layer" class="info-layer"></div>`;

  document.getElementById('btn-logout').addEventListener('click', logout);
  buildFilterBar();
  setupInfoLayer();
}

/* ------------------------------------------------------------------ فیلترها */
const FILTER_DEFS = [
  { key: 'branch', label: 'برنچ', options: () => state.meta.branches },
  { key: 'final_group', label: 'گروه محصول نهایی', options: () => state.meta.final_groups },
  { key: 'product_family', label: 'خانواده محصول', options: () => state.meta.product_families },
  { key: 'product_code', label: 'محصول', options: () => state.meta.products.map((p) => ({ value: p.key, label: `${p.label}` })), searchable: true },
  { key: 'station', label: 'ایستگاه', options: () => state.meta.stations },
  { key: 'process_domain', label: 'حوزه فرآیندی', options: () => state.meta.process_domains },
  { key: 'defect_group', label: 'دسته عیب', options: () => state.meta.defect_groups },
  { key: 'defect_code', label: 'کد عیب', options: () => state.meta.defects.map((d) => ({ value: d.key, label: `${d.key} — ${d.label}` })), searchable: true },
  { key: 'cause_6m', label: 'عامل مسبب (6M)', options: () => state.meta.cause_6m, only: ['inprocess'] },
  { key: 'repair_action', label: 'اقدام تعمیرات', options: () => state.meta.repair_actions, only: ['inprocess'] },
  { key: 'part_family', label: 'خانواده قطعات', options: () => state.meta.part_families, only: ['inprocess'] },
  { key: 'supplier', label: 'تامین‌کننده', options: () => state.meta.suppliers, only: ['inprocess'] },
  { key: 'shift', label: 'شیفت', options: () => state.meta.shifts, only: ['inspection'] },
  { key: 'operation', label: 'عملیات آزمایش', options: () => state.meta.operations, only: ['inspection'] }
];

function normalizeOptions(list) {
  return (list || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
}

function buildFilterBar() {
  const bar = document.getElementById('filter-bar');
  if (!bar) return;
  const source = state.source || 'inprocess';

  bar.innerHTML = `
    <div class="filter-row">
      <div class="seg" id="src-seg">
        <button data-src="inprocess" class="${source === 'inprocess' ? 'active' : ''}">عیوب حین تولید</button>
        <button data-src="inspection" class="${source === 'inspection' ? 'active' : ''}">اسناد بازرسی</button>
      </div>
      <div class="date-fields">
        <label>از تاریخ<input class="input date-input" id="f-from" value="${state.filters.from || ''}" placeholder="1405/05/01" /></label>
        <label>تا تاریخ<input class="input date-input" id="f-to" value="${state.filters.to || ''}" placeholder="1405/05/31" /></label>
      </div>
      <div class="presets" id="date-presets">
        <button data-preset="all">کل بازه</button>
        <button data-preset="30">۳۰ روز اخیر</button>
        <button data-preset="month">ماه آخر</button>
        <button data-preset="prevMonth">ماه قبل</button>
        <button data-preset="year">سال جاری</button>
      </div>
      <div class="filter-actions">
        <button class="btn btn-primary" id="btn-apply">نمایش</button>
        <button class="btn btn-ghost" id="btn-clear">پاک کردن فیلترها</button>
      </div>
    </div>
    <div class="filter-row wrap" id="filter-chips"></div>`;

  const chips = bar.querySelector('#filter-chips');
  for (const def of FILTER_DEFS) {
    if (def.only && !def.only.includes(source)) continue;
    const opts = normalizeOptions(def.options());
    if (!opts.length) continue;
    const selected = state.filters[def.key] || [];
    chips.appendChild(multiSelect(def, opts, selected));
  }

  bar.querySelectorAll('#src-seg button').forEach((b) => {
    b.addEventListener('click', () => {
      state.source = b.dataset.src;
      state.filters.source = b.dataset.src;
      buildFilterBar();
      route(true);
    });
  });
  bar.querySelectorAll('#date-presets button').forEach((b) => {
    b.addEventListener('click', () => applyPreset(b.dataset.preset));
  });
  bar.querySelector('#btn-apply').addEventListener('click', () => {
    state.filters.from = bar.querySelector('#f-from').value.trim();
    state.filters.to = bar.querySelector('#f-to').value.trim();
    route(true);
  });
  bar.querySelector('#btn-clear').addEventListener('click', () => {
    state.filters = { source: state.source };
    buildFilterBar();
    route(true);
  });
}

function multiSelect(def, options, selected) {
  const count = selected.length;
  const node = el(`
    <details class="ms" data-key="${def.key}">
      <summary>${def.label} ${count ? `<span class="ms-badge">${faInt(count)}</span>` : ''}</summary>
      <div class="ms-panel">
        ${options.length > 12 ? '<input class="ms-search input" placeholder="جست‌وجو..." />' : ''}
        <div class="ms-list">
          ${options.map((o) => `
            <label><input type="checkbox" value="${escapeHtml(o.value)}" ${selected.includes(String(o.value)) ? 'checked' : ''} />
            <span>${escapeHtml(o.label)}</span></label>`).join('')}
        </div>
        <div class="ms-actions">
          <button type="button" class="ms-clear">پاک کردن</button>
          <button type="button" class="ms-apply">اعمال</button>
        </div>
      </div>
    </details>`);

  const search = node.querySelector('.ms-search');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      node.querySelectorAll('.ms-list label').forEach((l) => {
        l.style.display = l.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }
  node.querySelector('.ms-clear').addEventListener('click', (e) => {
    e.preventDefault();
    node.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = false; });
    state.filters[def.key] = [];
    buildFilterBar();
    route(true);
  });
  node.querySelector('.ms-apply').addEventListener('click', (e) => {
    e.preventDefault();
    const vals = [...node.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
    state.filters[def.key] = vals;
    buildFilterBar();
    route(true);
  });
  node.addEventListener('click', (e) => {
    if (e.target.tagName === 'SUMMARY') {
      document.querySelectorAll('details.ms').forEach((d) => { if (d !== node) d.open = false; });
    }
  });
  return node;
}

function coverageRange() {
  const c = state.meta?.coverage || {};
  const src = state.source === 'inspection' ? c.inspection : c.inprocess;
  return { min: src?.a || null, max: src?.b || null };
}

function shiftJdate(jdate, days) {
  const p = parseJalali(jdate);
  if (!p) return jdate;
  const jdn = j2d(p.jy, p.jm, p.jd) + days;
  const j = d2j(jdn);
  return formatJalali(j.jy, j.jm, j.jd);
}

function applyPreset(preset) {
  const { min, max } = coverageRange();
  let from = '';
  let to = '';
  if (preset === 'all') { from = ''; to = ''; }
  else if (preset === '30' && max) { to = max; from = shiftJdate(max, -29); }
  else if (preset === 'month' && max) {
    const p = parseJalali(max);
    from = formatJalali(p.jy, p.jm, 1);
    to = max;
  } else if (preset === 'prevMonth' && max) {
    const p = parseJalali(max);
    const pm = p.jm === 1 ? 12 : p.jm - 1;
    const py = p.jm === 1 ? p.jy - 1 : p.jy;
    from = formatJalali(py, pm, 1);
    const pmax = parseJalali(formatJalali(py, pm, 29));
    // آخرین روز ماه قبل
    let lastDay = 29;
    for (let d = 31; d >= 28; d -= 1) {
      const cand = formatJalali(py, pm, d);
      const back = d2j(j2d(py, pm, Math.min(d, 29)));
      void cand; void back;
      if (d <= 29 && pm <= 6) { lastDay = 31; break; }
      if (d <= 30 && pm >= 7 && pm <= 11) { lastDay = 30; break; }
      if (d <= 29 && pm === 12) { lastDay = 29; break; }
    }
    void pmax;
    to = formatJalali(py, pm, lastDay);
  } else if (preset === 'year' && max) {
    const p = parseJalali(max);
    from = formatJalali(p.jy, 1, 1);
    to = formatJalali(p.jy, 12, 29);
  }
  state.filters.from = from;
  state.filters.to = to;
  buildFilterBar();
  route(true);
}

/* ------------------------------------------------------------------ مسیریابی */
function currentPage() {
  const hash = (location.hash || '#/home').replace('#/', '');
  return hash.split('?')[0] || 'home';
}

function route(force = false) {
  const id = currentPage();
  const allowed = state.user?.pages || [];
  if (!allowed.includes(id)) {
    location.hash = '#/home';
    return;
  }
  const page = PAGES[id];
  const root = document.getElementById('page-root');
  document.getElementById('page-title').textContent = PAGE_META[id]?.label || page?.title || id;
  document.getElementById('page-subtitle').textContent = page?.subtitle || '';
  document.querySelectorAll('.side-link').forEach((a) => {
    a.classList.toggle('active', a.dataset.page === id);
  });
  if (page) page.render(root);
  if (force) buildFilterBar();
}

/* ------------------------------------------------------------------ راهنمای شاخص */
function setupInfoLayer() {
  const layer = document.getElementById('info-layer');
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.info-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const html = infoPopoverHtml(btn.dataset.info);
      layer.innerHTML = html;
      layer.classList.add('show');
      const rect = btn.getBoundingClientRect();
      const pop = layer.firstElementChild;
      const width = 320;
      let left = rect.left - width + rect.width / 2;
      if (left < 8) left = 8;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      pop.style.left = `${left}px`;
      pop.style.top = `${rect.bottom + 8}px`;
      pop.style.width = `${width}px`;
      return;
    }
    if (!e.target.closest('.info-pop')) {
      layer.classList.remove('show');
      layer.innerHTML = '';
    }
  });
}

/* ------------------------------------------------------------------ آغاز */
window.addEventListener('hashchange', () => route());
window.addEventListener('resize', () => {
  document.querySelectorAll('.chart').forEach((c) => c.__chart?.resize());
});

start();
