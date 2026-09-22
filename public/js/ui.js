/* اجزای آماده‌ی رابط کاربری: کارت‌ها، کارت شاخص، جدول، وضعیت بارگذاری */
import { faInt, faDec, faPct, compact, el, escapeHtml, enNum } from './core.js';
import { GLOSSARY } from './glossary.js';

export function infoBtn(key, placement = 'left') {
  const g = GLOSSARY[key];
  if (!g) return '';
  return `<button class="info-btn" data-info="${key}" data-placement="${placement}" title="توضیح این شاخص">؟</button>`;
}

export function cardShell({ title, subtitle, info, actions = '', body, className = '', foot = '' }) {
  return `
  <section class="card ${className}">
    <header class="card-head">
      <div class="card-titles">
        <h3>${title}${info ? infoBtn(info) : ''}</h3>
        ${subtitle ? `<p class="card-sub">${subtitle}</p>` : ''}
      </div>
      <div class="card-actions">${actions}</div>
    </header>
    <div class="card-body">${body}</div>
    ${foot ? `<footer class="card-foot">${foot}</footer>` : ''}
  </section>`;
}

export function kpiCard({ label, value, unit = '', hint = '', info, delta = null, tone = 'default', sub = '' }) {
  let deltaHtml = '';
  if (delta !== null && delta !== undefined && Number.isFinite(Number(delta))) {
    const d = Number(delta);
    const up = d >= 0;
    const good = (label.includes('PPM') || label.includes('ضایعات') || label.includes('عیوب')) ? !up : up;
    deltaHtml = `<span class="kpi-delta ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${faDec(Math.abs(d), 1)}٪ <em>نسبت به دوره قبل</em></span>`;
  }
  return `
  <div class="kpi kpi-${tone}">
    <div class="kpi-label">${label}${info ? infoBtn(info) : ''}</div>
    <div class="kpi-value">${value}${unit ? `<span class="kpi-unit">${unit}</span>` : ''}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    ${hint ? `<div class="kpi-hint">${hint}</div>` : ''}
    ${deltaHtml}
  </div>`;
}

export function loadingCard(title = 'در حال بارگذاری…') {
  return `<div class="loading"><span class="spinner"></span>${title}</div>`;
}

export function emptyCard(message = 'داده‌ای برای این بازه و فیلترها پیدا نشد') {
  return `<div class="empty-state"><div class="empty-icon">🗂️</div><p>${message}</p><small>بازه تاریخ یا فیلترها را تغییر دهید</small></div>`;
}

export function infoPopoverHtml(key) {
  const g = GLOSSARY[key];
  if (!g) return '';
  return `<div class="info-pop"><div class="info-pop-title">${g.title}</div>
    <div class="info-pop-formula">${g.formula}</div>
    <div class="info-pop-text">${g.text}</div></div>`;
}

/** جدول ساده با هدر فارسی */
/** یکدست‌سازی متنِ جست‌وجو: رقمِ فارسی، ی/ک عربی و نیم‌فاصله */
function normSearch(v) {
  return enNum(String(v === null || v === undefined ? '' : v))
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[\u200c\u200f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

let searchWired = false;
/**
 * اتصالِ یک‌بارِ کادرِ جست‌وجوی جدول‌ها (رویداد به‌صورت تفویضی).
 * تایپ در کادر، سطرهای همان جدول را فیلتر می‌کند و تعدادِ سطرهای دیده‌شده را می‌نویسد.
 */
export function wireTableSearch(doc = typeof document !== 'undefined' ? document : null) {
  if (searchWired || !doc) return;
  searchWired = true;
  doc.addEventListener('input', (e) => {
    const box = e.target && e.target.closest ? e.target.closest('.tbl-search') : null;
    if (!box) return;
    const block = box.closest('.tbl-block');
    if (!block) return;
    const q = normSearch(box.value);
    let shown = 0, total = 0;
    block.querySelectorAll('tbody tr').forEach((tr) => {
      total++;
      const hit = !q || normSearch(tr.textContent).includes(q);
      tr.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    const count = block.querySelector('.tbl-search-count');
    if (count) count.textContent = q ? `${faInt(shown)} از ${faInt(total)} سطر` : `${faInt(total)} سطر`;
    block.classList.toggle('has-filter', !!q);
  });
}

export function dataTable({ columns, rows, caption = '', onRowClass = null, maxHeight = '420px', search = null }) {
  if (!rows || !rows.length) return emptyCard();
  const keys = Object.keys(columns);
  const head = keys.map((k) => `<th>${columns[k]}</th>`).join('');
  const body = rows.map((r, i) => {
    const cls = onRowClass ? onRowClass(r, i) : '';
    return `<tr class="${cls}">${keys.map((k) => `<td>${formatCell(k, r[k], r)}</td>`).join('')}</tr>`;
  }).join('');
  // جدول‌های شلوغ (بیش از ۱۲ سطر) کادرِ جست‌وجو می‌گیرند تا «پیدا کردن» سخت نباشد
  const wantSearch = search === null ? rows.length > 12 : !!search;
  const searchHtml = wantSearch ? `
      <div class="tbl-search-row">
        <input type="search" class="input tbl-search" placeholder="جست‌وجو در این جدول…" aria-label="جست‌وجو در این جدول" />
        <span class="tbl-search-count">${faInt(rows.length)} سطر</span>
      </div>` : '';
  return `
    ${caption ? `<div class="table-caption">${caption}</div>` : ''}
    <div class="tbl-block">${searchHtml}
    <div class="table-wrap" style="max-height:${maxHeight}">
      <table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div></div>`;
}

function formatCell(key, value) {
  if (value === null || value === undefined || value === '') return '<span class="muted">—</span>';
  if (typeof value === 'number') {
    if (key.includes('ppm') || key.includes('PPM')) return faInt(value);
    if (key.includes('pct') || key.includes('rate')) return `${faDec(value, 1)}٪`;
    if (Number.isInteger(value)) return faInt(value);
    return faDec(value, 1);
  }
  return escapeHtml(value);
}

/** جدول ماتریسی (سطر × ستون) */
export function matrixTable(matrix, { rowHeader = '', colHeader = '' } = {}) {
  const { rows = [], cols = [], cells = [] } = matrix || {};
  if (!rows.length || !cols.length) return emptyCard();
  const map = new Map();
  for (const c of cells) map.set(`${c.r}||${c.c}`, c.v);
  const totalRow = cols.map((c) => cells.filter((x) => x.c === c.key).reduce((s, x) => s + x.v, 0));
  const grand = totalRow.reduce((s, v) => s + v, 0);
  const head = `<tr><th>${rowHeader || ''}</th>${cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}<th>جمع</th></tr>`;
  const body = rows.map((r) => {
    const vals = cols.map((c) => map.get(`${r.key}||${c.key}`) || 0);
    const sum = vals.reduce((s, v) => s + v, 0);
    return `<tr><th class="row-head">${escapeHtml(r.label)}</th>${vals.map(cellHeat).join('')}<td class="sum">${faInt(sum)}</td></tr>`;
  }).join('');
  const foot = `<tr class="sum-row"><th class="row-head">جمع</th>${totalRow.map(cellHeat).join('')}<td class="sum">${faInt(grand)}</td></tr>`;
  return `<div class="table-wrap"><table class="data-table matrix"><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

function cellHeat(v) {
  if (!v) return '<td class="zero">·</td>';
  const intensity = Math.min(1, Math.log10(v + 1) / 3);
  const alpha = (0.06 + intensity * 0.5).toFixed(3);
  return `<td style="background:rgba(47,111,179,${alpha})">${faInt(v)}</td>`;
}

/** ساخت المنت کارت از رشته‌ی HTML */
/** انتخابگر دوره زمانی (پیش‌فرض ماهانه؛ روزانه نیز در دسترس است) */
export const PERIOD_LABELS = {
  day: 'روزانه', week: 'هفتگی', month: 'ماهانه',
  quarter: 'فصلی', half: 'نیم‌سالانه', year: 'سالانه'
};

export function periodSeg({ id = 'period-seg', current = 'month', options = ['day', 'week', 'month', 'quarter'] } = {}) {
  return `<div class="seg" id="${id}">${options
    .map((o) => `<button type="button" data-g="${o}" class="${o === current ? 'active' : ''}">${PERIOD_LABELS[o] || o}</button>`)
    .join('')}</div>`;
}

/** اتصال دکمه‌های انتخابگر به یک تابع */
export function wireSeg(root, id, cb) {
  root.querySelectorAll(`#${id} button`).forEach((b) => {
    b.addEventListener('click', () => cb(b.dataset.g, b));
  });
}

export function node(html) {
  return el(html);
}

export { compact, faInt, faDec, faPct };

/* ============================================================ خواناییِ تحلیل
   دو مشکلِ گزارش‌شدهٔ کاربر:
   ۱) جمله‌های پشتِ سر هم با عددهای زیاد → معلوم نیست هر عدد مالِ کدام توضیح است
   ۲) پیدا کردنِ خواسته‌ها در صفحه سخت است
   راه‌حل: هر جمله در یک سطرِ جدا با نشانگرِ رنگی، و هر عدد در «تراشهٔ عدد» برجسته. */

/**
 * رقم‌های فارسی/لاتین با جداکننده، درصد و تاریخِ شمسی.
 * فقط عددِ «تنها» برجسته می‌شود: اگر رقم به حرف چسبیده باشد (مثل 6M یا ICN1)
 * دست نمی‌خورد تا نامِ کالا و اصطلاح‌ها خراب نشوند.
 */
const NUM_RE = /(^|[\s(«\"'،؛:|=+←])[▼▲△▽]?\s?[۰-۹٠-٩0-9][۰-۹٠-٩0-9.,/-]*(?:\s?(?:٪|%|×))?(?=$|[\s)»\"'،؛:.|!?←-]|[\u0600-\u06FF])/g;

/**
 * عددها را در متن برجسته می‌کند. ورودی باید پیش‌تر `escapeHtml` شده باشد؛
 * خودِ تابع هم بخش‌های escape‌شده (مثل &#39;) را دست‌نخورده می‌گذارد.
 */
export function highlightNums(escaped) {
  return String(escaped == null ? '' : escaped)
    .split(/(&#?\w+;)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(NUM_RE, (m, pre) => `${pre}<b class="num">${m.slice(pre.length)}</b>`)))
    .join('');
}

/**
 * متنِ پیوسته را به سطرهای جدا (هر جمله یک سطر) با نشانگرِ رنگی تبدیل می‌کند
 * تا عددِ هر جمله کنارِ همان جمله بماند.
 */
export function sentenceList(text, { tone = '', icon = '', cls = 'sent-list' } = {}) {
  const parts = String(text || '')
    .split(/(?<=[.؛:!؟])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
  if (!parts.length) return '';
  const mark = icon || '<span class="sent-dot"></span>';
  return `<ul class="${cls}${tone ? ' tone-' + tone : ''}">`
    + parts.map((p) => `<li><span class="sent-mark">${mark}</span><span class="sent-text">${highlightNums(escapeHtml(p))}</span></li>`).join('')
    + '</ul>';
}

/**
 * کارتِ یک «یافته»: آیکون + برچسب + یک عددِ بزرگ + یک جملهٔ توضیح + تراشه‌های برچسب‌دار.
 * هر یافته یک کارتِ مستقل است، پس عدد و توضیحش قاطی نمی‌شوند.
 */
export function findingCard(f) {
  const tone = f.tone || 'info';
  const chips = (f.chips || []).map((c) => `<span class="fd-chip"><b>${escapeHtml(c.label)}</b> ${highlightNums(escapeHtml(c.value))}</span>`).join('');
  return `<article class="fd tone-${escapeHtml(tone)}">
    <div class="fd-head">
      <span class="fd-icon">${escapeHtml(f.icon || '•')}</span>
      <span class="fd-label">${escapeHtml(f.label || '')}</span>
    </div>
    <div class="fd-value">${highlightNums(escapeHtml(f.value == null ? '—' : String(f.value)))}${f.unit ? `<small>${escapeHtml(f.unit)}</small>` : ''}</div>
    ${f.sub ? `<div class="fd-sub">${highlightNums(escapeHtml(f.sub))}</div>` : ''}
    ${f.text ? `<p class="fd-text">${highlightNums(escapeHtml(f.text))}</p>` : ''}
    ${chips ? `<div class="fd-chips">${chips}</div>` : ''}
    ${f.drill ? '<div class="fd-drill">برای دیدن رکوردها کلیک کنید ←</div>' : ''}
  </article>`;
}

/** شبکهٔ یافته‌ها (کلیاتِ تحلیلگر) */
export function findingsHtml(list, { compact = false } = {}) {
  if (!list || !list.length) return '';
  return `<div class="fd-grid${compact ? ' fd-compact' : ''}">${list.map(findingCard).join('')}</div>`;
}

/* ============================================================ ناوبریِ بخش‌ها
   صفحه‌های تحلیلی کارتِ زیاد دارند و «پیدا کردنِ» بخشِ خواسته سخت است؛
   این نوارِ چسبان، فهرستِ بخش‌ها را بالای صفحه نگه می‌دارد و با اسکرول،
   بخشِ دیده‌شده را روشن می‌کند. */

/** عنوانِ کوتاهِ کارت (بدونِ ایموجی و بدونِ دنبالهٔ توضیحی) */
function shortTitle(h3) {
  const t = (h3.textContent || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = t.split('—')[0].split(' - ')[0].trim();
  return (cut || t).slice(0, 34);
}

/**
 * ساختِ نوارِ «پرش به بخش» برای صفحهٔ جاری.
 * چندبار صدا زده شدن بی‌ضرر است (نوارِ قبلی پاک می‌شود).
 */
export function sectionNav(root) {
  if (!root || typeof document === 'undefined') return;
  root.querySelectorAll(':scope > .sec-nav').forEach((n) => n.remove());
  const cards = Array.from(root.querySelectorAll('.card')).filter((c) => c.querySelector('.card-titles h3'));
  if (cards.length < 3) return;

  const header = document.querySelector('.app-header');
  const filterBar = document.getElementById('filter-bar');
  const stickyTop = (header ? header.offsetHeight : 0) + (filterBar ? filterBar.offsetHeight : 0) + 8;

  const nav = document.createElement('nav');
  nav.className = 'sec-nav';
  nav.style.top = `${stickyTop}px`;
  nav.innerHTML = '<span class="sec-nav-label">پرش به بخش:</span>'
    + cards.map((c, i) => {
      c.id = c.id || `sec-${i + 1}`;
      c.style.scrollMarginTop = `${stickyTop + 52}px`;
      return `<button type="button" class="sec-chip" data-target="${c.id}">${escapeHtml(shortTitle(c.querySelector('.card-titles h3')))}</button>`;
    }).join('');
  root.prepend(nav);

  nav.addEventListener('click', (e) => {
    const chip = e.target.closest('.sec-chip');
    if (!chip) return;
    const target = root.querySelector(`#${chip.dataset.target}`);
    if (!target) return;
    // در برخی محیط‌ها (آزمونِ jsdom) این تابع وجود ندارد؛ بی‌صدا رد می‌شویم
    if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('sec-flash');
    setTimeout(() => target.classList.remove('sec-flash'), 1600);
  });

  // روشن کردنِ بخشِ دیده‌شده هنگامِ اسکرول
  const chips = Array.from(nav.querySelectorAll('.sec-chip'));
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (!document.body.contains(nav)) { window.removeEventListener('scroll', onScroll); return; }
      const line = stickyTop + 64;
      let active = cards[0];
      for (const c of cards) {
        if (c.getBoundingClientRect().top <= line) active = c;
      }
      chips.forEach((ch) => ch.classList.toggle('active', ch.dataset.target === active.id));
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
