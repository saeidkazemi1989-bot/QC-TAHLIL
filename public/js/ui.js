/* اجزای آماده‌ی رابط کاربری: کارت‌ها، کارت شاخص، جدول، وضعیت بارگذاری */
import { faInt, faDec, faPct, compact, el, escapeHtml } from './core.js';
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
export function dataTable({ columns, rows, caption = '', onRowClass = null, maxHeight = '420px' }) {
  if (!rows || !rows.length) return emptyCard();
  const keys = Object.keys(columns);
  const head = keys.map((k) => `<th>${columns[k]}</th>`).join('');
  const body = rows.map((r, i) => {
    const cls = onRowClass ? onRowClass(r, i) : '';
    return `<tr class="${cls}">${keys.map((k) => `<td>${formatCell(k, r[k], r)}</td>`).join('')}</tr>`;
  }).join('');
  return `
    ${caption ? `<div class="table-caption">${caption}</div>` : ''}
    <div class="table-wrap" style="max-height:${maxHeight}">
      <table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>`;
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
export function node(html) {
  return el(html);
}

export { compact, faInt, faDec, faPct };
