// Global Workforce Explorer body (lazy chunk): view (3D globe / 2D map), local month timeline,
// analysis mode, selection, guided exploration, detail panel and ranked country list.
// Both views read the same cached cube and the same state; global filters are never changed implicitly.
import { Compass, Pause, Play, RotateCcw, SkipForward, X } from 'lucide-react';
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shortName } from '../../charts/options';
import { CATEGORY_COLOR } from '../../charts/theme';
import { CATEGORIES } from '../../data/types';
import { fmtDay, fmtMonth, fmtMonthShort, monthEndDay } from '../../lib/dates';
import { fmtInt, fmtSignedInt, fmtSignedPct } from '../../lib/format';
import { buildCube, countryPoints, scaleMaxima, summarise, type CountryPoint } from '../../lib/geo';
import { tourStops, type TourStop } from '../../lib/globe';
import type { ExplorerView, WebGLSupport } from '../../lib/webgl';
import { useApp } from '../../state/AppData';
import { Segmented } from '../ui';
import { GLOBE_STATUS, RING_COLOR } from './globeTheme';
import WorldMapImpl, { STATUS_STYLE, sizeOf, type GeoFeatureProps, type MapMode } from './WorldMap';

const WorldMap = memo(WorldMapImpl);
// Three.js and the globe scene: a separate chunk, requested only when the 3D view is shown.
const Globe3D = lazy(() => import('./Globe3D'));
const PLAY_MS = 700;
const TOUR_MS = 5200;

type GeoData = { type: string; features: { properties: GeoFeatureProps; geometry: { coordinates: number[][][][] } }[] };
type Bounds = [[number, number], [number, number]];
const WORLD: Bounds = [[-170, 84], [190, -57]];

/** Extent of the countries in the workforce model, padded, for the default focus view. */
function focusBounds(geo: GeoData, covered: Set<string>): Bounds {
  let w = 180, e = -180, n = -90, s = 90;
  for (const f of geo.features) {
    if (!covered.has(f.properties.iso3)) continue;
    for (const poly of f.geometry.coordinates) for (const [x, y] of poly[0]) {
      w = Math.min(w, x); e = Math.max(e, x); n = Math.max(n, y); s = Math.min(s, y);
    }
  }
  return [[w - 12, Math.min(84, n + 10)], [e + 12, Math.max(-57, s - 10)]];
}
let geoPromise: Promise<GeoData> | null = null;
const loadGeo = (): Promise<GeoData> => (geoPromise ??= fetch(`${import.meta.env.BASE_URL}geo/world-110m.json`).then((r) => {
  if (!r.ok) throw new Error(`Map data: HTTP ${r.status}`);
  return r.json();
}));

function useMedia(q: string) {
  const [match, setMatch] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const h = () => setMatch(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return match;
}

function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

const changeText = (p: CountryPoint) => {
  if (p.change == null) return 'No baseline';
  if (p.status === 'new') return `${fmtSignedInt(p.change)} · new`;
  if (p.change === 0) return '= 0';
  return `${STATUS_STYLE[p.status].glyph} ${fmtSignedInt(p.change)}`;
};

const nice = (v: number) => {
  if (v <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).filter((x) => x <= v).pop() ?? p;
};

const ORD = ['', '', 'second-', 'third-'];
const stopTitle = (s: TourStop) => {
  const t = `${s.tied ? 'joint ' : ''}${ORD[s.rank] ?? `${s.rank}th-`}largest ${s.kind}`;
  return t[0].toUpperCase() + t.slice(1);
};

interface Tour {
  stops: TourStop[];
  i: number;
  paused: boolean;
  month: number;
}

export default function ExplorerBody({ visible, view, setView, support }: { visible: boolean; view: ExplorerView; setView: (v: ExplorerView, remember?: boolean) => void; support: WebGLSupport }) {
  const { model, filters, setFilters } = useApp();
  const cube = useMemo(() => buildCube(model), [model]);
  const hq = model.meta.hq_country;
  const isoByName = useMemo(() => new Map(model.countries.map((c) => [c.name, c.iso3])), [model]);
  const covered = useMemo(() => new Set(model.countries.map((c) => c.iso3)), [model]);

  const [geo, setGeo] = useState<GeoData | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadGeo().then((g) => live && setGeo(g)).catch((e: Error) => live && setGeoError(e.message));
    return () => {
      live = false;
    };
  }, []);
  const focus_ = useMemo(() => (geo ? focusBounds(geo, covered) : WORLD), [geo, covered]);
  const features = useMemo(() => new Map<string, GeoFeatureProps>((geo?.features ?? []).map((f) => [f.properties.iso3, f.properties])), [geo]);

  const [mode, setMode] = useState<MapMode>('active');
  const [extent, setExtent] = useState<'focus' | 'world'>('focus');
  const [month, setMonth] = useState(filters.to);
  const [pinned, setPinned] = useState<string | null>(filters.country ? isoByName.get(filters.country) ?? null : null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusSeq, setFocusSeq] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [tour, setTour] = useState<Tour | null>(null);
  const [globeKey, setGlobeKey] = useState(0);
  const [globeLost, setGlobeLost] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const coarse = useMedia('(pointer: coarse)');
  const is3d = view === '3d';

  /** pin a country and bring it into view (explicit actions only) */
  const pinTo = useCallback((iso: string | null) => {
    setPinned(iso);
    if (iso) setFocusSeq((s) => s + 1);
  }, []);

  // Reconcile the local timeline with the global period: default to the reporting month.
  useEffect(() => {
    setMonth(filters.to);
    setPlaying(false);
  }, [filters.from, filters.to]);
  // A global country filter selects that country on the map.
  useEffect(() => {
    pinTo(filters.country ? isoByName.get(filters.country) ?? null : null);
  }, [filters.country, isoByName, pinTo]);
  // The guided exploration belongs to one month and filter selection.
  useEffect(() => setTour(null), [filters.from, filters.to, filters.country, filters.category]);

  // Playback: one month per tick from cached aggregates; stops at the period end, when paused,
  // hidden, scrolled away, unmounted or when reduced motion is requested.
  useEffect(() => {
    if (!playing) return;
    if (!visible || reduced) {
      setPlaying(false);
      return;
    }
    const id = window.setInterval(() => setMonth((m) => Math.min(m + 1, filters.to)), PLAY_MS);
    return () => window.clearInterval(id);
  }, [playing, visible, reduced, filters.to]);
  useEffect(() => {
    if (playing && month >= filters.to) setPlaying(false);
  }, [playing, month, filters.to]);
  useEffect(() => {
    const h = () => {
      if (!document.hidden) return;
      setPlaying(false);
      setTour((t) => (t && !t.paused ? { ...t, paused: true } : t));
    };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, []);

  const f = useMemo(() => ({ country: filters.country, category: filters.category }), [filters.country, filters.category]);
  const points = useMemo(() => countryPoints(cube, month, f), [cube, month, f]);
  const maxima = useMemo(() => scaleMaxima(cube, filters.from, filters.to, f), [cube, filters.from, filters.to, f]);
  const summary = useMemo(() => summarise(points, hq), [points, hq]);
  const byIso = useMemo(() => new Map(points.map((p) => [p.iso3, p])), [points]);

  // Guided exploration: auto-advance unless paused, hidden, scrolled away or reduced motion.
  useEffect(() => {
    if (!tour || tour.paused || !visible || reduced) return;
    const id = window.setTimeout(() => {
      const next = tour.i + 1;
      if (next >= tour.stops.length) setTour({ ...tour, paused: true });
      else {
        setTour({ ...tour, i: next });
        pinTo(tour.stops[next].iso3);
      }
    }, TOUR_MS);
    return () => window.clearTimeout(id);
  }, [tour, visible, reduced, pinTo]);
  const stops = useMemo(() => tourStops(points), [points]);
  const startTour = () => {
    if (!stops.length) return;
    setPlaying(false);
    setTour({ stops, i: 0, paused: reduced, month });
    pinTo(stops[0].iso3);
  };
  const tourStep = (i: number) => {
    if (!tour) return;
    setTour({ ...tour, i });
    pinTo(tour.stops[i].iso3);
  };

  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const narrow = width > 0 && width < 640;
  const mapHeight = Math.round(Math.min(520, Math.max(230, width * 0.5)));
  const globeHeight = Math.round(Math.min(560, Math.max(320, width * 0.56)));
  const maxD = Math.round(Math.min(40, Math.max(18, width * (extent === 'focus' ? 0.042 : 0.034))));

  const onHover = useCallback((iso: string | null) => setHovered(iso), []);
  const onSelect = useCallback((iso: string) => {
    setTour(null);
    setPinned((p) => (p === iso ? null : iso));
    setFocusSeq((s) => s + 1);
  }, []);
  const onReady = useCallback(() => setReady(true), []);
  const onInteract = useCallback(() => setTour((t) => (t && !t.paused ? { ...t, paused: true } : t)), []);
  const onGlobeFailure = useCallback(
    (reason: 'unavailable' | 'lost') => {
      if (reason === 'unavailable') {
        setNotice('The 3D globe could not start on this device (WebGL unavailable), so the 2D map is shown. All figures are the same.');
        setView('2d', false);
      } else setGlobeLost(true);
    },
    [setView],
  );
  const onGlobeRestored = useCallback(() => {
    setGlobeLost(false);
    setGlobeKey((k) => k + 1);
  }, []);
  const switchView = (v: ExplorerView) => {
    setNotice(null);
    setGlobeLost(false);
    setView(v);
  };

  const focusIso = pinned ?? hovered;
  const focusName = focusIso ? model.countries.find((c) => c.iso3 === focusIso)?.name ?? null : null;
  const focus = focusIso ? byIso.get(focusIso) ?? null : null;

  const ranked = useMemo(
    () =>
      [...points].sort((a, b) =>
        mode === 'active' ? b.total - a.total || a.name.localeCompare(b.name) : (b.change ?? -Infinity) - (a.change ?? -Infinity) || b.total - a.total,
      ),
    [points, mode],
  );

  const sizeTicks = useMemo(() => {
    const max = mode === 'active' ? maxima.total : maxima.change;
    const top = nice(max);
    return [top, nice(top / 4), nice(top / 16)].filter((v, i, a) => v > 0 && a.indexOf(v) === i);
  }, [maxima, mode]);

  const monthLabel = fmtDay(monthEndDay(month));
  const canPlay = !reduced && filters.to > filters.from;
  const yoy = summary.prev == null ? null : summary.total - summary.prev;
  const stop = tour ? tour.stops[tour.i] : null;
  const globeFeatures = geo?.features as unknown as import('./GlobeScene').GlobeFeature[] | undefined;
  const no3d = support === 'none';

  return (
    <div
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        setTour(null);
        setPinned(null);
      }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted" aria-live="polite">
          <b className="font-semibold text-ink">{monthLabel}</b> · {fmtInt(summary.total)} active staff ·{' '}
          {summary.countriesOfOperation} countries of operation{summary.countries > summary.countriesOfOperation ? ' + HQ' : ''} · YoY{' '}
          <b className={`font-semibold ${yoy == null ? 'text-muted' : yoy > 0 ? 'text-teal' : yoy < 0 ? 'text-burgundy' : 'text-ink'}`}>
            {yoy == null ? 'no baseline' : `${yoy > 0 ? '▲' : yoy < 0 ? '▼' : '='} ${fmtSignedInt(yoy)}`}
          </b>
          {filters.category && <> · {filters.category} only</>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Explorer view"
            value={view}
            onChange={switchView}
            options={[
              { value: '3d', label: '3D Globe', disabled: no3d, title: no3d ? 'The 3D globe needs WebGL, which is not available in this browser' : undefined },
              { value: '2d', label: '2D Map' },
            ]}
          />
          <Segmented
            label="Map view"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'active', label: 'Active staff' },
              { value: 'yoy', label: 'YoY change' },
            ]}
          />
          <button
            type="button"
            onClick={() => (tour ? setTour(null) : startTour())}
            disabled={!tour && !stops.length}
            aria-pressed={!!tour}
            title={!stops.length ? 'Needs a prior-year baseline: choose a month at least 12 months after the data starts' : 'Visit the largest increases and reductions'}
            className={`inline-flex h-[30px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              tour ? 'border-teal/50 bg-teal-50 text-teal' : 'border-line bg-white text-ink-2 hover:bg-page'
            }`}
          >
            <Compass size={14} aria-hidden />
            Explore workforce changes
          </button>
        </div>
      </div>
      {notice && (
        <p role="status" className="mb-3 rounded-md border border-line bg-page px-3 py-2 text-xs text-ink-2">
          {notice}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div
            ref={box}
            data-stage={view}
            className={`relative overflow-hidden rounded-lg border ${
              is3d ? 'border-[#22364F] bg-[radial-gradient(120%_95%_at_50%_42%,#173158_0%,#0B1A30_52%,#060E1B_100%)]' : 'border-line-2 bg-[#FAFBFC]'
            }`}
          >
            {is3d ? (
              geo && globeFeatures ? (
                <Suspense fallback={<div style={{ height: globeHeight }} className="grid place-items-center text-xs text-[#9FB0C4]">Loading 3D globe…</div>}>
                  <Globe3D
                    key={globeKey}
                    features={globeFeatures}
                    countries={model.countries}
                    covered={covered}
                    points={points}
                    mode={mode}
                    maxTotal={maxima.total}
                    maxChange={maxima.change}
                    pinned={pinned}
                    hovered={hovered}
                    focusSeq={focusSeq}
                    reducedMotion={reduced}
                    visible={visible && !globeLost}
                    monthLabel={monthLabel}
                    height={globeHeight}
                    coarse={coarse}
                    onHover={onHover}
                    onSelect={onSelect}
                    onInteract={onInteract}
                    onReady={onReady}
                    onFailure={onGlobeFailure}
                    onRestored={onGlobeRestored}
                  />
                </Suspense>
              ) : (
                <div style={{ height: globeHeight }} className="grid place-items-center text-xs text-[#9FB0C4]">
                  {geoError ? `The globe could not be loaded (${geoError}). The country list remains available.` : 'Loading 3D globe…'}
                </div>
              )
            ) : geo ? (
              <WorldMap
                geoJson={geo}
                features={features}
                covered={covered}
                points={points}
                mode={mode}
                maxTotal={maxima.total}
                maxChange={maxima.change}
                maxDiameter={maxD}
                pinned={pinned}
                bounds={extent === 'focus' ? focus_ : WORLD}
                reducedMotion={reduced}
                tooltip={!narrow}
                monthLabel={monthLabel}
                onHover={onHover}
                onSelect={onSelect}
                onReady={onReady}
                height={mapHeight}
              />
            ) : (
              <div style={{ height: mapHeight || 300 }} className="grid place-items-center text-xs text-muted">
                {geoError ? `The map could not be loaded (${geoError}). The country list remains available.` : 'Loading map…'}
              </div>
            )}
            {!is3d && (
              <div className="absolute right-2 top-2">
                <Segmented
                  label="Map extent"
                  value={extent}
                  onChange={setExtent}
                  options={[
                    { value: 'focus', label: 'Focus' },
                    { value: 'world', label: 'World' },
                  ]}
                />
              </div>
            )}
            {is3d && globeLost && (
              <div role="alert" className="absolute inset-0 z-10 grid place-items-center bg-[#060E1B]/85 p-4 text-center text-xs text-[#DCE6F1]">
                <div>
                  <p className="font-semibold">The 3D view was interrupted because the browser released its graphics context.</p>
                  <p className="mt-1 text-[#9FB0C4]">No data was lost; the country list and details are still current.</p>
                  <div className="mt-3 flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setGlobeLost(false);
                        setGlobeKey((k) => k + 1);
                      }}
                      className="rounded-md border border-white/20 bg-white/10 px-3 py-1.5 font-medium hover:bg-white/20"
                    >
                      Restart 3D view
                    </button>
                    <button type="button" onClick={() => switchView('2d')} className="rounded-md border border-white/20 bg-white/10 px-3 py-1.5 font-medium hover:bg-white/20">
                      Switch to 2D map
                    </button>
                  </div>
                </div>
              </div>
            )}
            {!points.length && ready && (
              <div className={`pointer-events-none absolute inset-0 grid place-items-center text-sm ${is3d ? 'text-[#C9D5E2]' : 'bg-white/60 text-muted'}`}>
                No active staff for this selection.
              </div>
            )}
          </div>

          {tour && stop && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-teal/30 bg-teal-50/50 px-3 py-2 text-xs" role="region" aria-label="Explore workforce changes">
              <span className="tabular font-semibold text-muted">
                {tour.i + 1} / {tour.stops.length}
              </span>
              <p className="min-w-0 flex-1" aria-live="polite" data-tour-stop={stop.iso3}>
                <span className="text-muted">{stopTitle(stop)} · </span>
                <b className="text-ink">{stop.name}</b>{' '}
                <b className={stop.kind === 'increase' ? 'text-teal' : 'text-burgundy'}>
                  {stop.kind === 'increase' ? '▲' : '▼'} {fmtSignedInt(stop.change)}
                  {stop.pct != null ? ` (${fmtSignedPct(stop.pct)})` : ''}
                </b>
                <span className="text-muted">
                  {' '}
                  · {fmtMonth(tour.month - 12)} → {fmtMonth(tour.month)} · ranked from the workforce model for the current filters
                </span>
              </p>
              <div className="flex items-center gap-1">
                {!reduced && (
                  <button
                    type="button"
                    onClick={() => setTour({ ...tour, paused: !tour.paused })}
                    aria-label={tour.paused ? 'Resume guided exploration' : 'Pause guided exploration'}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink-2 hover:bg-page"
                  >
                    {tour.paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => tourStep((tour.i + 1) % tour.stops.length)}
                  aria-label="Next country in guided exploration"
                  className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink-2 hover:bg-page"
                >
                  <SkipForward size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setTour(null)}
                  aria-label="Exit guided exploration"
                  className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink-2 hover:bg-page"
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            </div>
          )}

          {/* timeline */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setTour(null);
                  if (month >= filters.to) {
                    setMonth(filters.from);
                    setPlaying(true);
                  } else setPlaying((p) => !p);
                }}
                disabled={!canPlay}
                aria-label={playing ? 'Pause playback' : 'Play timeline'}
                title={reduced ? 'Playback is off because reduced motion is enabled' : undefined}
                className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink-2 hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                {playing ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTour(null);
                  setMonth(filters.from);
                  setPlaying(true);
                }}
                disabled={!canPlay}
                aria-label="Restart playback from the period start"
                title={reduced ? 'Playback is off because reduced motion is enabled' : undefined}
                className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink-2 hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw size={14} aria-hidden />
              </button>
            </div>
            <div className="flex min-w-[200px] flex-1 items-center gap-3">
              <span className="text-[11px] tabular text-faint">{fmtMonthShort(filters.from)}</span>
              <input
                type="range"
                min={filters.from}
                max={filters.to}
                step={1}
                value={month}
                disabled={filters.to === filters.from}
                onChange={(e) => {
                  setPlaying(false);
                  setTour(null);
                  setMonth(Number(e.target.value));
                }}
                aria-label="Map reporting month"
                aria-valuetext={fmtMonth(month)}
                className="h-1.5 flex-1 cursor-pointer accent-[#168A80]"
              />
              <span className="text-[11px] tabular text-faint">{fmtMonthShort(filters.to)}</span>
            </div>
            <span data-month-label className="min-w-[72px] rounded-md bg-teal-50 px-2 py-1 text-center text-xs font-semibold tabular text-teal">
              {fmtMonth(month)}
            </span>
          </div>
          {reduced && (
            <p className="mt-1 text-[11px] text-muted">
              Playback and camera animation are off because your system requests reduced motion; use the slider to move between months.
            </p>
          )}

          {/* legends */}
          {is3d ? (
            <GlobeLegend mode={mode} ticks={sizeTicks} max={mode === 'active' ? maxima.total : maxima.change} />
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3 text-[11px] text-muted">
              <div>
                <p className="mb-1 font-medium text-ink-2">{mode === 'active' ? 'Bubble area = active staff' : 'Bubble area = YoY change (employees)'}</p>
                <div className="flex items-end gap-3">
                  {sizeTicks.map((v) => {
                    const d = Math.max(4, sizeOf({ total: v, change: v } as CountryPoint, mode, maxima.total, maxima.change, maxD));
                    return (
                      <span key={v} className="flex flex-col items-center gap-1">
                        <span className="rounded-full border border-[#94A3B8] bg-[#94A3B8]/15" style={{ width: d, height: d }} aria-hidden />
                        <span className="tabular">{mode === 'active' ? fmtInt(v) : `±${fmtInt(v)}`}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="mb-1 font-medium text-ink-2">Colour = year-over-year direction</p>
                <ul className="flex flex-wrap gap-x-3 gap-y-1">
                  {(['growth', 'reduction', 'unchanged', 'no-baseline'] as const).map((s) => (
                    <li key={s} className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: STATUS_STYLE[s].fill, border: `1px ${STATUS_STYLE[s].dashed ? 'dashed' : 'solid'} ${STATUS_STYLE[s].dashed ? STATUS_STYLE[s].stroke : STATUS_STYLE[s].fill}` }}
                        aria-hidden
                      />
                      {STATUS_STYLE[s].glyph} {STATUS_STYLE[s].label}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 font-medium text-ink-2">Countries</p>
                <ul className="flex flex-wrap gap-x-3 gap-y-1">
                  <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3.5 rounded-[2px] bg-[#D6E7E4]" aria-hidden />In the workforce model</li>
                  <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3.5 rounded-[2px] bg-[#E8ECF1]" aria-hidden />Not covered</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-3" aria-label="Country details">
          <DetailPanel
            name={focusName}
            point={focus}
            pinned={!!pinned}
            month={month}
            summary={summary}
            yoy={yoy}
            ranked={ranked}
            globalCountry={filters.country}
            onClear={() => {
              setTour(null);
              setPinned(null);
            }}
            onApply={(name) => setFilters({ country: name })}
            onClearFilter={() => setFilters({ country: null })}
          />
          <div className="min-h-0 rounded-lg border border-line-2">
            <p className="border-b border-line-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Countries · ranked by {mode === 'active' ? 'active staff' : 'YoY change'}
            </p>
            <ul className="max-h-[236px] overflow-y-auto p-1" aria-label="Countries ranked">
              {ranked.map((p) => (
                <li key={p.iso3}>
                  <button
                    type="button"
                    aria-pressed={pinned === p.iso3}
                    onClick={() => onSelect(p.iso3)}
                    onMouseEnter={() => setHovered(p.iso3)}
                    onMouseLeave={() => setHovered(null)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      pinned === p.iso3 ? 'bg-teal-50 text-ink' : 'text-ink-2 hover:bg-page'
                    } ${coarse ? 'min-h-[40px]' : ''}`}
                  >
                    <span className="flex-1 truncate">{shortName(p.name)}</span>
                    <span className="tabular font-semibold text-ink">{fmtInt(p.total)}</span>
                    <span
                      className={`w-[64px] text-right tabular ${p.change == null ? 'text-faint' : p.change > 0 ? 'text-teal' : p.change < 0 ? 'text-burgundy' : 'text-muted'}`}
                    >
                      {changeText(p)}
                    </span>
                  </button>
                </li>
              ))}
              {!ranked.length && <li className="px-2 py-3 text-xs text-muted">No active staff for this selection.</li>}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** 3D legend: column height scale (linear), direction colours with glyphs, coverage. */
function GlobeLegend({ mode, ticks, max }: { mode: MapMode; ticks: number[]; max: number }) {
  const H = 40;
  return (
    <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3 text-[11px] text-muted">
      <div>
        <p className="mb-1 font-medium text-ink-2">{mode === 'active' ? 'Column height = active staff (linear scale)' : 'Column height = size of the YoY change (linear)'}</p>
        <div className="flex items-end gap-4">
          {ticks.map((v) => (
            <span key={v} className="flex items-end gap-1.5">
              <span className="w-[6px] rounded-t-[2px] bg-[#8FA0B5]" style={{ height: Math.max(2, (H * v) / (max || 1)) }} aria-hidden />
              <span className="tabular">{mode === 'active' ? fmtInt(v) : `±${fmtInt(v)}`}</span>
            </span>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 font-medium text-ink-2">Colour = year-over-year direction</p>
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {(['growth', 'reduction', 'unchanged', 'no-baseline'] as const).map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              {GLOBE_STATUS[s].ring ? (
                <span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: RING_COLOR }} aria-hidden />
              ) : (
                <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: GLOBE_STATUS[s].color }} aria-hidden />
              )}
              {GLOBE_STATUS[s].glyph} {GLOBE_STATUS[s].label}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1 font-medium text-ink-2">Countries</p>
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3.5 rounded-[2px] border border-[#56B7AA] bg-[#1D4652]" aria-hidden />In the workforce model</li>
          <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3.5 rounded-[2px] border border-[#4C6A8C] bg-[#1A2D47]" aria-hidden />Not covered</li>
        </ul>
        <p className="mt-1 text-faint">Markers show country totals at the country's label point, not office or staff locations.</p>
      </div>
    </div>
  );
}

function DetailPanel(props: {
  name: string | null;
  point: CountryPoint | null;
  pinned: boolean;
  month: number;
  summary: ReturnType<typeof summarise>;
  yoy: number | null;
  ranked: CountryPoint[];
  globalCountry: string | null;
  onClear: () => void;
  onApply: (name: string) => void;
  onClearFilter: () => void;
}) {
  const { name, point: p, pinned, month, summary, yoy, ranked, globalCountry } = props;
  const D = fmtDay(monthEndDay(month));
  const prevD = fmtDay(monthEndDay(month - 12));
  const stat = (label: string, value: string, cls = 'text-ink') => (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-muted">{label}</dt>
      <dd className={`tabular font-semibold ${cls}`}>{value}</dd>
    </div>
  );

  if (!name) {
    const movers = ranked.filter((x) => x.change != null);
    const up = [...movers].sort((a, b) => (b.change ?? 0) - (a.change ?? 0))[0];
    const down = [...movers].sort((a, b) => (a.change ?? 0) - (b.change ?? 0))[0];
    return (
      <div className="rounded-lg border border-line-2 bg-page/60 p-3 text-xs" data-detail="summary">
        <p className="font-semibold text-ink">All countries in the selection</p>
        <p className="text-muted">Reporting date {D}</p>
        <dl className="mt-2 divide-y divide-line-2">
          {stat('Active staff', fmtInt(summary.total))}
          {stat(`One year earlier (${prevD})`, summary.prev == null ? 'No baseline' : fmtInt(summary.prev))}
          {stat('YoY change', yoy == null ? 'No baseline' : fmtSignedInt(yoy), yoy == null ? 'text-muted' : yoy > 0 ? 'text-teal' : yoy < 0 ? 'text-burgundy' : 'text-ink')}
          {up && up.change! > 0 && stat('Largest increase', `${shortName(up.name)} ▲ ${fmtSignedInt(up.change)}`, 'text-teal')}
          {down && down.change! < 0 && stat('Largest reduction', `${shortName(down.name)} ▼ ${fmtSignedInt(down.change)}`, 'text-burgundy')}
        </dl>
        <p className="mt-2 text-muted">Hover over or select a country on the map or in the list for its details.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border p-3 text-xs ${pinned ? 'border-teal/40 bg-teal-50/40' : 'border-line-2 bg-page/60'}`} data-detail="country">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink" data-detail-name>{name}</p>
          <p className="text-muted">Reporting date {D}</p>
        </div>
        {pinned && (
          <button type="button" onClick={props.onClear} aria-label="Clear map selection" className="rounded-md p-1 text-muted hover:bg-white hover:text-ink">
            <X size={14} aria-hidden />
          </button>
        )}
      </div>
      {p ? (
        <>
          <dl className="mt-2 divide-y divide-line-2">
            {stat('Active staff', fmtInt(p.total))}
            {stat(`One year earlier (${prevD})`, p.prev == null ? 'No baseline' : fmtInt(p.prev))}
            {stat(
              'YoY change',
              p.change == null ? 'No baseline' : p.status === 'new' ? `${fmtSignedInt(p.change)} (new)` : `${STATUS_STYLE[p.status].glyph} ${fmtSignedInt(p.change)}`,
              p.change == null ? 'text-muted' : p.change > 0 ? 'text-teal' : p.change < 0 ? 'text-burgundy' : 'text-ink',
            )}
            {stat('YoY change %', p.pct != null ? fmtSignedPct(p.pct) : p.status === 'new' ? 'New · no prior workforce' : p.change == null ? 'No baseline' : '—')}
          </dl>
          <ul className="mt-2 space-y-1 border-t border-line-2 pt-2" aria-label="Active staff by category">
            {CATEGORIES.filter((k) => k !== 'HQ Staff' || p.byCat[k] > 0).map((k) => (
              <li key={k} className="flex items-center gap-2">
                <span className="h-2 w-2 flex-none rounded-[2px]" style={{ background: CATEGORY_COLOR[k] }} aria-hidden />
                <span className="flex-1 text-ink-2">{k}</span>
                <span className="tabular font-semibold text-ink">{fmtInt(p.byCat[k])}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-muted">No active staff in this country for the current selection on {D}.</p>
      )}
      {pinned && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line-2 pt-2">
          {globalCountry === name ? (
            <button type="button" onClick={props.onClearFilter} className="rounded-md border border-line bg-white px-2 py-1 font-medium text-ink-2 hover:bg-page">
              Remove dashboard country filter
            </button>
          ) : (
            <button type="button" onClick={() => props.onApply(name)} className="rounded-md border border-line bg-white px-2 py-1 font-medium text-teal hover:bg-page">
              Filter whole dashboard to {shortName(name)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
