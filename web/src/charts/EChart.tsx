import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { useEffect, useRef } from 'react';

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, MarkLineComponent, TitleComponent, SVGRenderer]);

interface Props {
  option: EChartsOption;
  height: number;
  label: string;
}

/** Thin ECharts wrapper: SVG renderer (crisp at any zoom), auto-resize, full re-render on option change. */
export function EChart({ option, height, label }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const node = el.current!;
    const inst = echarts.init(node, undefined, { renderer: 'svg' });
    chart.current = inst;
    const ro = new ResizeObserver(() => inst.resize());
    ro.observe(node);
    return () => {
      ro.disconnect();
      inst.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={el} style={{ height }} className="w-full" role="img" aria-label={label} />;
}
