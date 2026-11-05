import type { EChartsOption } from 'echarts';
import { C, FONT } from './theme';

export interface SeriesSpec {
  name: string;
  data: (number | null)[];
  color: string;
}

type Fmt = (v: number) => string;

const compact = (v: number) => (Math.abs(v) >= 10_000 ? `${Math.round(v / 1000)}K` : v.toLocaleString('en-GB'));

const SHORT: Record<string, string> = {
  'Democratic Republic of the Congo': 'DR Congo',
  'Central African Republic': 'Central African Rep.',
};
export const shortName = (s: string) => SHORT[s] ?? s;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

const tooltipBase = {
  backgroundColor: '#FFFFFF',
  borderColor: '#E2E8F0',
  borderWidth: 1,
  padding: [10, 12],
  textStyle: { color: C.ink, fontFamily: FONT, fontSize: 12 },
  extraCssText: 'box-shadow: 0 8px 24px rgba(25,35,45,0.12); border-radius: 10px;',
  confine: true,
};

export const row = (color: string, name: string, value: string, strong = false) =>
  `<div style="display:flex;align-items:center;gap:8px;min-width:180px;margin-top:4px">` +
  `<span style="width:8px;height:8px;border-radius:2px;background:${color};flex:none"></span>` +
  `<span style="color:#475569;flex:1">${esc(name)}</span>` +
  `<span style="font-variant-numeric:tabular-nums;font-weight:${strong ? 700 : 600};color:${C.ink}">${value}</span></div>`;

export const title = (t: string) => `<div style="font-weight:600;color:${C.ink};margin-bottom:2px">${esc(t)}</div>`;

export const foot = (t: string) => `<div style="margin-top:8px;padding-top:6px;border-top:1px solid #EEF1F5;color:#64748B">${t}</div>`;

const axisLabel = { color: C.muted, fontFamily: FONT, fontSize: 11 };
const legend = {
  top: 0,
  left: 0,
  icon: 'roundRect',
  itemWidth: 10,
  itemHeight: 10,
  itemGap: 16,
  textStyle: { color: C.ink2, fontFamily: FONT, fontSize: 12 },
};

interface CartesianOpts {
  categories: string[];
  series: SeriesSpec[];
  fmt?: Fmt;
  axisFmt?: Fmt;
  stack?: boolean;
  horizontal?: boolean;
  /** show value labels at bar tips (single-series charts / few bars) */
  labels?: boolean;
  labelFmt?: Fmt;
  total?: boolean;
  /** extra tooltip footer for a category index */
  extra?: (dataIndex: number) => string;
  /** custom per-series tooltip value */
  tooltipValue?: (seriesIndex: number, dataIndex: number) => string;
  yMax?: number;
  yMin?: number;
  legend?: boolean;
  barMax?: number;
  axisLabelRotate?: number;
  /** category axis label width (horizontal charts) */
  labelWidth?: number;
}

function cartesianTooltip(o: CartesianOpts) {
  const fmt = o.fmt ?? ((v: number) => v.toLocaleString('en-GB'));
  return {
    ...tooltipBase,
    trigger: 'axis' as const,
    axisPointer: { type: 'shadow' as const, shadowStyle: { color: 'rgba(100,116,139,0.08)' } },
    formatter: (params: unknown) => {
      const ps = (Array.isArray(params) ? params : [params]) as {
        seriesName: string;
        value: number | null;
        color: string;
        dataIndex: number;
        seriesIndex: number;
        name: string;
      }[];
      if (!ps.length) return '';
      const idx = ps[0].dataIndex;
      let html = title(ps[0].name);
      let sum = 0;
      const shown = o.horizontal ? [...ps].reverse() : ps;
      for (const p of o.stack ? [...shown].reverse() : shown) {
        if (p.value == null) continue;
        sum += Number(p.value);
        const val = o.tooltipValue ? o.tooltipValue(p.seriesIndex, idx) : fmt(Number(p.value));
        html += row(o.series[p.seriesIndex]?.color ?? p.color, p.seriesName, val);
      }
      if (o.total && ps.length > 1) html += foot(`Total <b style="color:${C.ink};float:right;margin-left:16px">${fmt(sum)}</b>`);
      if (o.extra) html += o.extra(idx);
      return html;
    },
  };
}

/** Bars / columns (grouped or stacked). */
export function bars(o: CartesianOpts): EChartsOption {
  const horizontal = !!o.horizontal;
  const r = horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
  const n = o.series.length;
  const catAxis = {
    type: 'category' as const,
    data: o.categories,
    inverse: horizontal,
    axisLine: { lineStyle: { color: C.axis } },
    axisTick: { show: false },
    axisLabel: {
      ...axisLabel,
      color: C.ink2,
      rotate: o.axisLabelRotate ?? 0,
      formatter: (v: string) => shortName(v),
      width: o.labelWidth,
      overflow: o.labelWidth ? ('truncate' as const) : undefined,
      interval: !horizontal && !o.axisLabelRotate && o.categories.length > 14 ? ('auto' as const) : 0,
      hideOverlap: !horizontal && o.categories.length > 14,
    },
  };
  const valAxis = {
    type: 'value' as const,
    max: o.yMax,
    min: o.yMin,
    splitLine: { lineStyle: { color: C.grid } },
    axisLabel: { ...axisLabel, formatter: (v: number) => (o.axisFmt ?? compact)(v) },
  };
  return {
    animationDuration: 450,
    textStyle: { fontFamily: FONT },
    legend: o.legend === false || n < 2 ? undefined : { ...legend, data: o.series.map((s) => s.name) },
    grid: { left: 4, right: o.labels && horizontal ? 48 : 16, top: n < 2 || o.legend === false ? 12 : 40, bottom: 4, containLabel: true },
    tooltip: cartesianTooltip(o),
    xAxis: horizontal ? valAxis : catAxis,
    yAxis: horizontal ? catAxis : valAxis,
    series: o.series.map((s, i) => ({
      type: 'bar' as const,
      name: s.name,
      data: s.data,
      stack: o.stack ? 'total' : undefined,
      barMaxWidth: o.barMax ?? 22,
      barGap: '20%',
      itemStyle: {
        color: s.color,
        borderRadius: !o.stack || i === n - 1 ? r : 0,
        borderColor: o.stack ? C.surface : undefined,
        borderWidth: o.stack ? 1 : 0,
      },
      emphasis: { focus: 'series' as const },
      label: o.labels
        ? {
            show: true,
            position: horizontal ? ('right' as const) : ('top' as const),
            color: C.ink2,
            fontFamily: FONT,
            fontSize: 11,
            fontWeight: 600,
            formatter: (p: { value: unknown }) => (p.value == null ? '' : (o.labelFmt ?? o.fmt ?? compact)(Number(p.value))),
          }
        : undefined,
    })),
  };
}

interface LineOpts {
  categories: string[];
  series: SeriesSpec[];
  fmt?: Fmt;
  axisFmt?: Fmt;
  area?: boolean;
  stack?: boolean;
  yMin?: number | 'dataMin';
  yMax?: number;
  total?: boolean;
  extra?: (dataIndex: number) => string;
  tooltipValue?: (seriesIndex: number, dataIndex: number) => string;
  endLabels?: boolean;
  smooth?: boolean;
}

/** Lines (2px, markers on hover, optional 10% area wash, optional end labels). */
export function lines(o: LineOpts): EChartsOption {
  const fmt = o.fmt ?? ((v: number) => v.toLocaleString('en-GB'));
  const n = o.series.length;
  return {
    animationDuration: 450,
    textStyle: { fontFamily: FONT },
    legend: n < 2 ? undefined : { ...legend, data: o.series.map((s) => s.name) },
    grid: { left: 4, right: o.endLabels ? 64 : 16, top: n < 2 ? 16 : 40, bottom: 4, containLabel: true },
    tooltip: {
      ...cartesianTooltip({ ...o, yMin: undefined, fmt, stack: o.stack, categories: o.categories, series: o.series }),
      axisPointer: { type: 'line' as const, lineStyle: { color: C.axis, width: 1 } },
    },
    xAxis: {
      type: 'category',
      data: o.categories,
      boundaryGap: false,
      axisLine: { lineStyle: { color: C.axis } },
      axisTick: { show: false },
      axisLabel: { ...axisLabel, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      min: o.yMin,
      max: o.yMax,
      scale: o.yMin === 'dataMin',
      splitLine: { lineStyle: { color: C.grid } },
      axisLabel: { ...axisLabel, formatter: (v: number) => (o.axisFmt ?? compact)(v) },
    },
    series: o.series.map((s) => ({
      type: 'line' as const,
      name: s.name,
      data: s.data,
      stack: o.stack ? 'total' : undefined,
      smooth: o.smooth ? 0.25 : false,
      showSymbol: false,
      symbol: 'circle',
      symbolSize: 8,
      connectNulls: false,
      lineStyle: { width: 2, color: s.color, cap: 'round' as const, join: 'round' as const },
      itemStyle: { color: s.color, borderColor: C.surface, borderWidth: 2 },
      areaStyle: o.area || o.stack ? { color: s.color, opacity: o.stack ? 0.85 : 0.1 } : undefined,
      emphasis: { focus: 'series' as const },
      endLabel: o.endLabels
        ? {
            show: true,
            color: C.ink2,
            fontFamily: FONT,
            fontSize: 11,
            fontWeight: 600,
            formatter: (p: { value: unknown }) => (p.value == null ? '' : fmt(Number(p.value))),
          }
        : undefined,
    })),
  };
}

export interface Slice {
  name: string;
  value: number;
  color: string;
}

/** Donut for part-to-whole with ≤ 5 parts; centre shows the total. */
export function donut(data: Slice[], centre: { value: string; label: string }, fmt?: Fmt): EChartsOption {
  const total = data.reduce((s, d) => s + d.value, 0);
  const f = fmt ?? ((v: number) => v.toLocaleString('en-GB'));
  return {
    animationDuration: 450,
    textStyle: { fontFamily: FONT },
    tooltip: {
      ...tooltipBase,
      trigger: 'item',
      formatter: (p: unknown) => {
        const q = p as { name: string; value: number; color: string };
        return title(q.name) + row(q.color, 'Count', f(q.value)) + row(q.color, 'Share', `${((q.value / total) * 100).toFixed(1)}%`);
      },
    },
    title: {
      text: centre.value,
      subtext: centre.label,
      left: 'center',
      top: '40%',
      textStyle: { fontFamily: FONT, fontSize: 22, fontWeight: 700, color: C.ink },
      subtextStyle: { fontFamily: FONT, fontSize: 11, color: C.muted },
      itemGap: 4,
    },
    series: [
      {
        type: 'pie',
        radius: ['58%', '80%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        padAngle: 1.5,
        itemStyle: { borderRadius: 4, borderColor: C.surface, borderWidth: 1 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 4 },
        data: data.filter((d) => d.value > 0).map((d) => ({ name: d.name, value: d.value, itemStyle: { color: d.color } })),
      },
    ],
  };
}
