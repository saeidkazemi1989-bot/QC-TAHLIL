/* نمودارها با ECharts — تنظیمات آماده برای نمایش راست‌به‌چپ و فارسی */
import { faInt, faDec } from './core.js';

const PALETTE = ['#2f6fb3', '#e08a2e', '#3f9e78', '#c0504d', '#7a63c9', '#2aa1b3', '#b8873b', '#8b6f47', '#5b8def', '#cf5c8a'];

export function chart(node, option, { onClick = null } = {}) {
  const inst = window.echarts.init(node, null, { renderer: 'canvas' });
  inst.setOption(option, true);
  if (onClick) inst.on('click', (p) => onClick(p, inst));
  const ro = new ResizeObserver(() => inst.resize());
  ro.observe(node);
  node.__chart = inst;
  if (onClick) node.classList.add('chart-clickable');
  return inst;
}

const baseGrid = { left: 12, right: 18, top: 34, bottom: 10, containLabel: true };

const axisLabelStyle = { fontFamily: 'Vazirmatn, Tahoma, "B Nazanin", sans-serif', fontSize: 11.5, color: '#2b3a4d', fontWeight: 600 };

function tooltip(extra = {}) {
  return {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderColor: '#d7dee8',
    borderWidth: 1,
    textStyle: { color: '#0d1622', fontFamily: 'Vazirmatn, Tahoma, sans-serif', fontSize: 12.5 },
    ...extra
  };
}

/** نمودار میله‌ای افقی (مناسب رتبه‌بندی) */
export function barH(node, data, {
  valueName = 'تعداد عیب', color = PALETTE[0], unit = '', showPpm = false, limit = 15, onClick = null
} = {}) {
  const rows = data.slice(0, limit).slice().reverse();
  return chart(node, {
    grid: { ...baseGrid, left: 8, right: 30, bottom: 4 },
    tooltip: tooltip({
      formatter: (ps) => {
        const p = ps[0];
        const d = rows[p.dataIndex];
        const extra = d && d.production ? `<br/>تولید: ${faInt(d.production)}` : '';
        const ppm = d && d.ppm !== undefined ? `<br/>PPM: ${faInt(d.ppm)}` : '';
        return `<b>${p.name}</b><br/>${valueName}: ${faInt(p.value)}${unit}${extra}${ppm}`;
      }
    }),
    xAxis: { type: 'value', axisLabel: { ...axisLabelStyle, formatter: (v) => faInt(v) }, splitLine: { lineStyle: { color: '#e6ecf4' } } },
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.label),
      axisLabel: { ...axisLabelStyle, fontSize: 11, width: 150, overflow: 'truncate' },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [{
      type: 'bar',
      data: rows.map((r) => (showPpm ? r.ppm : r.defects)),
      itemStyle: { color, borderRadius: [0, 4, 4, 0] },
      barMaxWidth: 22,
      label: {
        show: true,
        position: 'right',
        formatter: (p) => faInt(p.value),
        fontFamily: 'Vazirmatn, Tahoma, sans-serif',
        fontSize: 11,
        color: '#334155'
      }
    }]
  }, { onClick: onClick ? (p) => onClick(rows[p.dataIndex], p) : null });
}

/** پارتو: ستون‌های تعداد عیب + خط درصد تجمعی */
export function pareto(node, data, { limit = 12, valueName = 'تعداد عیب' } = {}) {
  const rows = data.slice(0, limit);
  return chart(node, {
    grid: { ...baseGrid, bottom: 44, right: 30 },
    tooltip: tooltip({
      formatter: (ps) => {
        const i = ps[0].dataIndex;
        const d = rows[i];
        return `<b>${d.label}</b><br/>${valueName}: ${faInt(d.defects)}<br/>سهم: ${faDec(d.pct, 1)}٪<br/>سهم تجمعی: ${faDec(d.cumPct, 1)}٪`;
      }
    }),
    xAxis: {
      type: 'category',
      data: rows.map((r) => r.label),
      axisLabel: { ...axisLabelStyle, interval: 0, rotate: 30, width: 90, overflow: 'truncate' },
      axisTick: { show: false }
    },
    yAxis: [
      { type: 'value', name: valueName, nameTextStyle: axisLabelStyle, axisLabel: { ...axisLabelStyle, formatter: (v) => faInt(v) }, splitLine: { lineStyle: { color: '#e6ecf4' } } },
      { type: 'value', name: 'درصد تجمعی', max: 100, nameTextStyle: axisLabelStyle, axisLabel: { ...axisLabelStyle, formatter: '{value}٪' }, splitLine: { show: false } }
    ],
    series: [
      {
        type: 'bar',
        data: rows.map((r) => r.defects),
        itemStyle: { color: PALETTE[0], borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 34
      },
      {
        type: 'line',
        yAxisIndex: 1,
        data: rows.map((r) => Number(r.cumPct.toFixed(1))),
        itemStyle: { color: '#e08a2e' },
        lineStyle: { width: 2 },
        symbolSize: 6,
        label: { show: true, formatter: '{c}٪', fontSize: 10, color: '#a35c17', fontFamily: 'Vazirmatn, Tahoma, sans-serif' }
      }
    ]
  });
}

/** نمودار روند: ستون تولید + خط PPM (و عیوب) */
export function trendCombo(node, rows, { target = 0, onClick = null, defectLabel = 'تعداد عیوب' } = {}) {
  const labels = rows.map((r) => r.label || r.key);
  const series = [
    {
      name: 'تولید',
      type: 'bar',
      data: rows.map((r) => r.production),
      itemStyle: { color: 'rgba(47,111,179,0.28)', borderRadius: [4, 4, 0, 0] },
      barMaxWidth: 28
    },
    {
      name: 'تعداد عیوب',
      type: 'bar',
      data: rows.map((r) => r.defects),
      itemStyle: { color: PALETTE[1], borderRadius: [4, 4, 0, 0] },
      barMaxWidth: 28
    },
    {
      name: 'PPM',
      type: 'line',
      yAxisIndex: 1,
      data: rows.map((r) => Math.round(r.ppm)),
      itemStyle: { color: '#c0504d' },
      lineStyle: { width: 3 },
      symbolSize: 7,
      label: { show: labels.length <= 12, formatter: (p) => faInt(p.value), fontSize: 10, color: '#a33b38', fontFamily: 'Vazirmatn, Tahoma, sans-serif' }
    }
  ];
  if (target > 0) {
    series.push({
      name: 'هدف PPM',
      type: 'line',
      yAxisIndex: 1,
      data: rows.map(() => target),
      lineStyle: { type: 'dashed', width: 2, color: '#3f9e78' },
      symbol: 'none',
      tooltip: { show: false }
    });
  }
  return chart(node, {
    legend: { data: series.map((s) => s.name), textStyle: axisLabelStyle, top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8 },
    grid: { ...baseGrid, top: 40, right: 42, bottom: 40 },
    tooltip: tooltip({
      formatter: (ps) => {
        const i = ps[0].dataIndex;
        const r = rows[i];
        return `<b>${r.label || r.key}</b><br/>تولید: ${faInt(r.production)}<br/>عیوب: ${faInt(r.defects)}<br/>PPM: ${faInt(r.ppm)}<br/>سفارش‌ها: ${faInt(r.orders)}`;
      }
    }),
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { ...axisLabelStyle, interval: 0, rotate: labels.length > 10 ? 35 : 0, width: 80, overflow: 'truncate' },
      axisTick: { show: false }
    },
    yAxis: [
      { type: 'value', name: 'تعداد', nameTextStyle: axisLabelStyle, axisLabel: { ...axisLabelStyle, formatter: (v) => faInt(v) }, splitLine: { lineStyle: { color: '#e6ecf4' } } },
      { type: 'value', name: 'PPM', nameTextStyle: axisLabelStyle, axisLabel: { ...axisLabelStyle, formatter: (v) => faInt(v) }, splitLine: { show: false } }
    ],
    series
  }, { onClick: onClick ? (p) => onClick(rows[p.dataIndex], p) : null });
}

/** نمودار دونات (ترکیب) */
export function donut(node, data, { valueName = 'تعداد عیب', onClick = null } = {}) {
  const rows = data.slice(0, 10);
  return chart(node, {
    color: PALETTE,
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: '#d7dee8',
      textStyle: { color: '#0d1622', fontFamily: 'Vazirmatn, Tahoma, sans-serif', fontSize: 12.5 },
      formatter: (p) => `<b>${p.name}</b><br/>${valueName}: ${faInt(p.value)} (${p.percent}٪)`
    },
    legend: { orient: 'vertical', right: 4, top: 'middle', textStyle: { ...axisLabelStyle, fontSize: 11 }, itemWidth: 10, itemHeight: 8, icon: 'circle' },
    series: [{
      type: 'pie',
      radius: ['46%', '72%'],
      center: ['38%', '52%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      data: rows.map((r) => ({ name: r.label, value: r.defects }))
    }]
  }, { onClick: onClick ? (p) => onClick(rows[p.dataIndex], p) : null });
}

/** نمودار پراکندگی (تولید در برابر PPM) */
export function scatter(node, data, { xName = 'تولید', yName = 'PPM' } = {}) {
  const rows = data.filter((r) => r.production > 0).slice(0, 40);
  return chart(node, {
    grid: { ...baseGrid, top: 30, right: 30 },
    tooltip: tooltip({
      trigger: 'item',
      formatter: (p) => {
        const r = rows[p.dataIndex];
        return `<b>${r.label}</b><br/>${xName}: ${faInt(r.production)}<br/>عیوب: ${faInt(r.defects)}<br/>${yName}: ${faInt(r.ppm)}`;
      }
    }),
    xAxis: { type: 'value', name: xName, nameTextStyle: axisLabelStyle, axisLabel: { ...axisLabelStyle, formatter: (v) => faInt(v) }, splitLine: { lineStyle: { color: '#e6ecf4' } } },
    yAxis: { type: 'value', name: yName, nameTextStyle: axisLabelStyle, axisLabel: { ...axisLabelStyle, formatter: (v) => faInt(v) }, splitLine: { lineStyle: { color: '#e6ecf4' } } },
    series: [{
      type: 'scatter',
      symbolSize: (v) => Math.max(8, Math.min(34, Math.sqrt(v[1]) / 6)),
      data: rows.map((r) => [r.production, Math.round(r.ppm)]),
      itemStyle: { color: 'rgba(47,111,179,0.65)' },
      label: {
        show: rows.length <= 15,
        formatter: (p) => String(rows[p.dataIndex].label).slice(0, 18),
        position: 'top',
        fontSize: 10,
        color: '#475569',
        fontFamily: 'Vazirmatn, Tahoma, sans-serif'
      }
    }]
  });
}

/** تغییرات نسبت به دوره قبل (میله‌ای با مقادیر مثبت و منفی) */
export function deltaBars(node, rows, { valueName = 'تغییر PPM' } = {}) {
  const data = rows.slice(0, 12).slice().reverse();
  return chart(node, {
    grid: { ...baseGrid, left: 8, right: 40 },
    tooltip: tooltip({
      formatter: (p) => {
        const d = data[p[0].dataIndex];
        return `<b>${d.label}</b><br/>دوره قبل: ${faInt(d.prev)}<br/>دوره جاری: ${faInt(d.current)}<br/>تغییر: ${faDec(d.delta, 1)}٪`;
      }
    }),
    xAxis: { type: 'value', axisLabel: { ...axisLabelStyle, formatter: (v) => `${faInt(v)}٪` }, splitLine: { lineStyle: { color: '#e6ecf4' } } },
    yAxis: {
      type: 'category',
      data: data.map((r) => r.label),
      axisLabel: { ...axisLabelStyle, width: 130, overflow: 'truncate' },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [{
      type: 'bar',
      data: data.map((r) => Number(r.delta.toFixed(1))),
      itemStyle: { color: (p) => (p.value >= 0 ? '#c0504d' : '#3f9e78'), borderRadius: 3 },
      barMaxWidth: 20,
      label: {
        show: true,
        position: 'right',
        formatter: (p) => `${faDec(p.value, 1)}٪`,
        fontSize: 11,
        color: '#334155',
        fontFamily: 'Vazirmatn, Tahoma, sans-serif'
      }
    }]
  });
}

/** روند ساده تولید */
export function productionChart(node, rows, { onClick = null } = {}) {
  const labels = rows.map((r) => r.key);
  return chart(node, {
    legend: { data: ['تولید سالم', 'ضایعات', 'پرسنل'], textStyle: axisLabelStyle, top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8 },
    grid: { ...baseGrid, top: 38, right: 42, bottom: 40 },
    tooltip: tooltip({ formatter: (ps) => { const i = ps[0].dataIndex; const r = rows[i]; return `<b>${r.key}</b><br/>تولید: ${faInt(r.production)}<br/>ضایعات: ${faInt(r.scrap)}<br/>پرسنل: ${faInt(r.personnel)}<br/>اسناد عملکرد: ${faInt(r.docs)}`; } }),
    xAxis: { type: 'category', data: labels, axisLabel: { ...axisLabelStyle, interval: 0, rotate: labels.length > 12 ? 45 : 0 }, axisTick: { show: false } },
    yAxis: [
      { type: 'value', name: 'تعداد', nameTextStyle: axisLabelStyle, axisLabel: { ...axisLabelStyle, formatter: (v) => faInt(v) }, splitLine: { lineStyle: { color: '#e6ecf4' } } },
      { type: 'value', name: 'پرسنل', nameTextStyle: axisLabelStyle, axisLabel: { ...axisLabelStyle, formatter: (v) => faInt(v) }, splitLine: { show: false } }
    ],
    series: [
      { name: 'تولید سالم', type: 'line', data: rows.map((r) => r.production), smooth: true, areaStyle: { color: 'rgba(47,111,179,0.14)' }, itemStyle: { color: PALETTE[0] }, lineStyle: { width: 2 } },
      { name: 'ضایعات', type: 'bar', data: rows.map((r) => r.scrap), itemStyle: { color: PALETTE[1], borderRadius: [3, 3, 0, 0] }, barMaxWidth: 20 },
      { name: 'پرسنل', type: 'line', yAxisIndex: 1, data: rows.map((r) => r.personnel), itemStyle: { color: PALETTE[2] }, lineStyle: { width: 2, type: 'dotted' } }
    ]
   }, { onClick: onClick ? (p) => onClick(rows[p.dataIndex], p) : null });
}

export { PALETTE };
