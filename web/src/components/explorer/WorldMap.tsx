// ECharts world map for the Global Workforce Explorer. Loaded lazily with its own chunk.
// One chart instance lives for the component's lifetime; month, mode and filter changes only
// merge new bubble data into the existing series (keyed by ISO3), so ECharts animates the change.
import { ScatterChart } from 'echarts/charts';
import { GeoComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { useEffect, useMemo, useRef, useState } from 'react';
import { esc, row, title, tooltipBase } from '../../charts/options';
import { C } from '../../charts/theme';
import { fmtInt, fmtSignedInt, fmtSignedPct } from '../../lib/format';
import { bubbleSize, type ChangeStatus, type CountryPoint } from '../../lib/geo';

echarts.use([GeoComponent, ScatterChart, TooltipComponent, SVGRenderer]);

export type MapMode = 'active' | 'yoy';

export interface GeoFeatureProps {
  iso3: string;
  name: string;
  label: [number, number];
}

export const STATUS_STYLE: Record<ChangeStatus, { fill: string; stroke: string; dashed?: boolean; label: string; glyph: string }> = {
  growth: { fill: C.teal, stroke: '#FFFFFF', label: 'Growth', glyph: '▲' },
  new: { fill: C.teal, stroke: '#FFFFFF', label: 'New (no prior-year staff)', glyph: '▲' },
  reduction: { fill: C.burgundy, stroke: '#FFFFFF', label: 'Reduction', glyph: '▼' },
  unchanged: { fill: '#94A3B8', stroke: '#FFFFFF', label: 'Unchanged', glyph: '=' },
  'no-baseline': { fill: 'rgba(148,163,184,0.12)', stroke: '#64748B', dashed: true, label: 'No prior-year baseline', glyph: '–' },
};

const AREA = { none: '#E8ECF1', covered: '#D6E7E4', pinned: '#A9D3CC', border: '#FFFFFF' };

interface Props {
  geoJson: object;
  features: Map<string, GeoFeatureProps>;
  covered: Set<string>;
  points: CountryPoint[];
  mode: MapMode;
  maxTotal: number;
  maxChange: number;
  maxDiameter: number;
  pinned: string | null;
  /** [[west, north], [east, south]] */
  bounds: [[number, number], [number, number]];
  reducedMotion: boolean;
  tooltip: boolean;
  monthLabel: string;
  onHover: (iso3: string | null) => void;
  onSelect: (iso3: string) => void;
  onReady: () => void;
  height: number;
}

export function sizeOf(p: CountryPoint, mode: MapMode, maxTotal: number, maxChange: number, maxD: number) {
  if (mode === 'active') return bubbleSize(p.total, maxTotal, maxD);
  if (p.change == null) return 10; // fixed hollow marker: no baseline
  if (p.change === 0) return 6;
  return bubbleSize(Math.abs(p.change), maxChange, maxD);
}

export default function WorldMap(props: Props) {
  const { geoJson, features, covered, points, mode, maxTotal, maxChange, maxDiameter, pinned, bounds, reducedMotion, tooltip, monthLabel, height } = props;
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const handlers = useRef(props);
  handlers.current = props;
  const [ready, setReady] = useState(false);
  const byIso = useMemo(() => new Map(points.map((p) => [p.iso3, p])), [points]);
  const lookup = useRef(byIso);
  lookup.current = byIso;
  const monthRef = useRef(monthLabel);
  monthRef.current = monthLabel;

  useEffect(() => {
    if (!echarts.getMap('world-110m')) echarts.registerMap('world-110m', geoJson as never);
    const inst = echarts.init(el.current!, undefined, { renderer: 'svg' });
    chart.current = inst;
    const isoOf = (p: { componentType?: string; name?: string; data?: { name?: string } }) => p.data?.name ?? p.name ?? null;
    inst.on('mouseover', (p) => {
      const iso = isoOf(p as never);
      if (iso && handlers.current.covered.has(iso)) handlers.current.onHover(iso);
    });
    inst.on('mouseout', () => handlers.current.onHover(null));
    inst.on('click', (p) => {
      const iso = isoOf(p as never);
      if (iso && handlers.current.covered.has(iso)) handlers.current.onSelect(iso);
    });
    inst.on('finished', () => setReady(true));
    const ro = new ResizeObserver(() => inst.resize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      inst.dispose();
      chart.current = null;
    };
  }, [geoJson]);

  useEffect(() => {
    if (ready) handlers.current.onReady();
  }, [ready]);

  // Region styles change only with the selection; kept as a stable, full-length array so merges are index-aligned.
  const regions = useMemo(
    () =>
      [...covered].map((iso) => ({
        name: iso,
        itemStyle: { areaColor: iso === pinned ? AREA.pinned : AREA.covered, borderColor: iso === pinned ? C.teal : AREA.border, borderWidth: iso === pinned ? 1.2 : 0.6 },
        emphasis: { itemStyle: { areaColor: AREA.pinned } },
      })),
    [covered, pinned],
  );

  const data = useMemo(
    () =>
      points
        .map((p) => {
          const st = STATUS_STYLE[p.status];
          const f = features.get(p.iso3)!;
          const size = sizeOf(p, mode, maxTotal, maxChange, maxDiameter);
          const hollow = p.status === 'no-baseline';
          return {
            name: p.iso3,
            value: [f.label[0], f.label[1], mode === 'active' ? p.total : (p.change ?? 0)],
            symbolSize: size,
            itemStyle: {
              color: st.fill,
              opacity: hollow ? 1 : 0.82,
              borderColor: p.iso3 === pinned ? C.ink : st.stroke,
              borderWidth: p.iso3 === pinned ? 2 : hollow ? 1.4 : 1,
              borderType: st.dashed ? ('dashed' as const) : ('solid' as const),
            },
          };
        })
        .filter((d) => d.symbolSize > 0)
        .sort((a, b) => b.symbolSize - a.symbolSize), // small bubbles drawn on top
    [points, features, mode, maxTotal, maxChange, maxDiameter, pinned],
  );

  useEffect(() => {
    const inst = chart.current;
    if (!inst) return;
    const anim = !reducedMotion;
    inst.setOption({
      animation: anim,
      animationDurationUpdate: anim ? 320 : 0,
      animationEasingUpdate: 'cubicOut',
      tooltip: {
        ...tooltipBase,
        show: tooltip,
        trigger: 'item',
        formatter: (raw: unknown) => {
          const q = raw as { name?: string; data?: { name?: string } };
          const iso = q.data?.name ?? q.name ?? '';
          const f = features.get(iso);
          if (!f) return '';
          if (!covered.has(iso)) return `<div style="color:${C.muted}">${esc(f.name)} · not covered by the workforce model</div>`;
          const p = lookup.current.get(iso);
          if (!p) return title(f.name) + `<div style="color:${C.muted}">No active staff in this selection · ${esc(monthRef.current)}</div>`;
          const st = STATUS_STYLE[p.status];
          const yoy =
            p.change == null ? 'No baseline' : p.status === 'new' ? `${fmtSignedInt(p.change)} · new` : `${st.glyph} ${fmtSignedInt(p.change)}${p.pct != null ? ` (${fmtSignedPct(p.pct)})` : ''}`;
          return (
            title(f.name) +
            row(C.teal, 'Active staff', fmtInt(p.total), true) +
            row(st.dashed ? '#CBD5E1' : st.fill, 'YoY change', esc(yoy)) +
            `<div style="margin-top:6px;color:${C.muted}">${esc(monthRef.current)} · click to pin details</div>`
          );
        },
      },
      geo: {
        map: 'world-110m',
        nameProperty: 'iso3',
        roam: false,
        boundingCoords: bounds,
        top: 8,
        bottom: 8,
        left: 4,
        right: 4,
        silent: false,
        itemStyle: { areaColor: AREA.none, borderColor: AREA.border, borderWidth: 0.6 },
        emphasis: { disabled: false, label: { show: false }, itemStyle: { areaColor: AREA.none } },
        select: { disabled: true },
        label: { show: false },
        regions,
      },
    });
  }, [regions, bounds, reducedMotion, tooltip, features, covered]);

  // Month, mode and filter changes touch only the bubble series, not the 175 country shapes.
  useEffect(() => {
    chart.current?.setOption({
      series: [
        {
          id: 'bubbles',
          type: 'scatter',
          coordinateSystem: 'geo',
          data,
          emphasis: { scale: 1.12, itemStyle: { borderColor: C.ink, borderWidth: 1.5 } },
          z: 3,
        },
      ],
    });
  }, [data]);

  return (
    <div
      ref={el}
      style={{ height }}
      className="w-full"
      role="img"
      aria-label={`World map of active staff by country of assignment, ${monthLabel}. Use the country list for a keyboard-accessible view.`}
      data-map-ready={ready ? 'true' : 'false'}
    />
  );
}
