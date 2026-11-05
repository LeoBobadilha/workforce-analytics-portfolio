// Shell for the Global Workforce Explorer. It stays in the main bundle and is deliberately small:
// the map code (ECharts geo + scatter), the world boundaries and the explorer state load only when
// the section approaches the viewport, so the rest of the dashboard renders exactly as before.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Card, InfoTip } from '../ui';

const ExplorerBody = lazy(() => import('./ExplorerBody'));

export function GlobalWorkforceExplorer() {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current!;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      setVisible(true);
      return;
    }
    // Start loading when the section is within 300px of the viewport, once the browser is idle,
    // so the map never competes with the first render of the dashboard above it.
    let idle = 0;
    const schedule = () => {
      if (idle) return;
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      idle = w.requestIdleCallback ? w.requestIdleCallback(() => setNear(true), { timeout: 1200 }) : window.setTimeout(() => setNear(true), 200);
    };
    const pre = new IntersectionObserver(([e]) => e.isIntersecting && schedule(), { rootMargin: '300px 0px' });
    const vis = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.1 });
    pre.observe(node);
    vis.observe(node);
    return () => {
      pre.disconnect();
      vis.disconnect();
    };
  }, []);

  return (
    <Card className="min-w-0 p-5">
      <section ref={ref} id="global-workforce-explorer" aria-labelledby="gwe-title">
        <header className="mb-3">
          <div className="flex items-center gap-1.5">
            <h2 id="gwe-title" className="text-[15px] font-semibold text-ink">
              Global Workforce Explorer
            </h2>
            <InfoTip
              label="About Global Workforce Explorer"
              text={
                <>
                  Active staff by country of assignment at the selected month-end (contract covers the date; one contract per person, so no
                  double counting). YoY change = headcount at the month-end − headcount at the same month-end one year earlier; % only when
                  the earlier headcount is above zero. The timeline is local to the map and does not change the dashboard period; it
                  respects the global period, country and staff-category filters.
                </>
              }
            />
          </div>
          <p className="mt-0.5 text-xs text-muted">Explore workforce distribution and historical headcount changes across countries.</p>
        </header>
        {near ? (
          <Suspense fallback={<div className="grid h-[360px] place-items-center text-xs text-muted">Loading map…</div>}>
            <ExplorerBody visible={visible} />
          </Suspense>
        ) : (
          <div className="grid h-[360px] place-items-center rounded-lg border border-line-2 bg-[#FAFBFC] text-xs text-muted">Map loads when scrolled into view</div>
        )}
      </section>
    </Card>
  );
}
