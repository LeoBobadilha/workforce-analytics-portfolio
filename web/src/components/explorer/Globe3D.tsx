// React wrapper for the 3D globe (lazy chunk with Three.js). It owns one GlobeScene for its
// lifetime and forwards only changes: markers on month/mode/filter changes, selection, hover and
// visibility. Camera moves only on explicit actions (selection, region, reset, guided tour).
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { esc, shortName } from '../../charts/options';
import { fmtInt, fmtSignedInt, fmtSignedPct } from '../../lib/format';
import type { CountryPoint } from '../../lib/geo';
import { defaultCentre, markerSpecs, regionCentres, shapesFrom, type GlobeMode } from '../../lib/globe';
import { GlobeScene, type GlobeFeature } from './GlobeScene';
import { GLOBE_STATUS } from './globeTheme';

interface Props {
  features: GlobeFeature[];
  countries: { name: string; iso3: string; region: string }[];
  covered: Set<string>;
  points: CountryPoint[];
  mode: GlobeMode;
  maxTotal: number;
  maxChange: number;
  pinned: string | null;
  hovered: string | null;
  /** increments whenever the camera should bring `pinned` into view (explicit selection) */
  focusSeq: number;
  reducedMotion: boolean;
  visible: boolean;
  monthLabel: string;
  height: number;
  coarse: boolean;
  onHover: (iso: string | null) => void;
  onSelect: (iso: string) => void;
  onInteract: () => void;
  onReady: () => void;
  onFailure: (reason: 'unavailable' | 'lost') => void;
  /** the browser gave the graphics context back: the parent remounts the scene */
  onRestored: () => void;
}

const btn =
  'grid h-9 w-9 place-items-center rounded-lg border border-white/15 bg-[#0A1628]/80 text-[#DCE6F1] backdrop-blur-sm transition-colors hover:bg-[#13274A] disabled:opacity-40';

export default function Globe3D(props: Props) {
  const { features, countries, covered, points, mode, maxTotal, maxChange, pinned, hovered, focusSeq, reducedMotion, visible, monthLabel, height, coarse } = props;
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<GlobeScene | null>(null);
  const cb = useRef(props);
  cb.current = props;
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState(false);

  const anchors = useMemo(() => new Map(features.map((f) => [f.properties.iso3, f.properties.label] as [string, [number, number]])), [features]);
  const shapes = useMemo(() => shapesFrom(features), [features]);
  const slots = useMemo(() => countries.map((c) => c.iso3), [countries]);
  const home = useMemo(() => defaultCentre(slots.map((s) => anchors.get(s)!).filter(Boolean)), [slots, anchors]);
  const regions = useMemo(() => regionCentres(countries, anchors).sort((a, b) => a.region.localeCompare(b.region)), [countries, anchors]);
  const names = useMemo(() => new Map(countries.map((c) => [c.iso3, c.name])), [countries]);
  const byIso = useMemo(() => new Map(points.map((p) => [p.iso3, p])), [points]);
  const lookup = useRef(byIso);
  lookup.current = byIso;
  const monthRef = useRef(monthLabel);
  monthRef.current = monthLabel;

  // one scene for the component's lifetime
  useEffect(() => {
    let s: GlobeScene;
    const start = cb.current.pinned ? anchors.get(cb.current.pinned) ?? home : home;
    try {
      s = new GlobeScene({
        container: host.current!,
        features,
        shapes,
        anchors,
        slots,
        covered,
        reducedMotion,
        coarse,
        start,
        callbacks: {
          onHover: (iso) => cb.current.onHover(iso),
          onSelect: (iso) => cb.current.onSelect(iso),
          onInteract: () => cb.current.onInteract(),
          onReady: () => {
            setReady(true);
            cb.current.onReady();
          },
          onContextLost: () => cb.current.onFailure('lost'),
          onContextRestored: () => cb.current.onRestored(),
          onWheelHint: () => setHint(true),
          describe: (iso) => {
            const name = names.get(iso) ?? features.find((f) => f.properties.iso3 === iso)?.properties.name ?? iso;
            if (!covered.has(iso)) return `<div style="color:#9FB0C4">${esc(name)} · not covered by the workforce model</div>`;
            const p = lookup.current.get(iso);
            const head = `<div style="font-weight:600;margin-bottom:4px">${esc(name)}</div>`;
            if (!p) return head + `<div style="color:#9FB0C4">No active staff in this selection · ${esc(monthRef.current)}</div>`;
            const st = GLOBE_STATUS[p.status];
            const yoy = p.change == null ? 'No baseline' : p.status === 'new' ? `${fmtSignedInt(p.change)} · new` : `${st.glyph} ${fmtSignedInt(p.change)}${p.pct != null ? ` (${fmtSignedPct(p.pct)})` : ''}`;
            const row = (k: string, v: string, c?: string) =>
              `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#9FB0C4">${k}</span><b style="font-variant-numeric:tabular-nums${c ? `;color:${c}` : ''}">${esc(v)}</b></div>`;
            return head + row('Active staff', fmtInt(p.total)) + row('YoY change', yoy, p.change == null ? undefined : st.color) + `<div style="margin-top:4px;color:#9FB0C4">${esc(monthRef.current)} · click to pin details</div>`;
          },
        },
      });
    } catch {
      cb.current.onFailure('unavailable');
      return;
    }
    scene.current = s;
    return () => {
      s.dispose();
      scene.current = null;
    };
    // the scene is created once; later prop changes are forwarded by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // markers: month, mode and filter changes rewrite instance data only
  const specs = useMemo(() => markerSpecs(points, anchors, mode, maxTotal, maxChange), [points, anchors, mode, maxTotal, maxChange]);
  const labelText = useMemo(
    () =>
      new Map(
        points.map((p) => [
          p.iso3,
          mode === 'active'
            ? `${shortName(p.name)} ${fmtInt(p.total)}`
            : `${shortName(p.name)} ${p.change == null ? '–' : `${GLOBE_STATUS[p.status].glyph} ${fmtSignedInt(p.change)}`}`,
        ]),
      ),
    [points, mode],
  );
  useEffect(() => scene.current?.setMarkers(specs, labelText), [specs, labelText]);
  useEffect(() => scene.current?.setSelected(pinned), [pinned]);
  useEffect(() => scene.current?.setHovered(hovered), [hovered]);
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const sync = () => s.setActive(visible && !document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [visible]);
  // explicit selection → bring the country into view (never while the user is just reading)
  useEffect(() => {
    if (!focusSeq || !cb.current.pinned) return;
    const a = anchors.get(cb.current.pinned);
    if (a) scene.current?.flyTo(a);
  }, [focusSeq, anchors]);
  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(() => setHint(false), 1800);
    return () => window.clearTimeout(id);
  }, [hint]);

  const onKey = (e: React.KeyboardEvent) => {
    const s = scene.current;
    if (!s) return;
    const k = e.key;
    const map: Record<string, () => void> = {
      ArrowLeft: () => s.rotateBy(-15, 0),
      ArrowRight: () => s.rotateBy(15, 0),
      ArrowUp: () => s.rotateBy(0, 10),
      ArrowDown: () => s.rotateBy(0, -10),
      '+': () => s.zoomBy(0.85),
      '=': () => s.zoomBy(0.85),
      '-': () => s.zoomBy(1 / 0.85),
      '0': () => s.reset(home),
      Home: () => s.reset(home),
    };
    if (map[k]) {
      e.preventDefault();
      map[k]();
      cb.current.onInteract();
    }
  };

  return (
    <div className="relative" style={{ height }}>
      <div
        ref={host}
        className="absolute inset-0"
        tabIndex={0}
        role="img"
        aria-roledescription="interactive 3D globe"
        aria-label={`3D globe of active staff by country of assignment, ${monthLabel}. Arrow keys rotate, plus and minus zoom, 0 resets the view. The country list beside the globe gives the same information and selection.`}
        onKeyDown={onKey}
        data-globe-ready={ready ? 'true' : 'false'}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
        <label className="pointer-events-auto">
          <span className="sr-only">Focus the globe on a region</span>
          <select
            className="select h-9 rounded-lg border border-white/15 bg-[#0A1628]/80 pl-2.5 text-xs text-[#DCE6F1] backdrop-blur-sm"
            value=""
            onChange={(e) => {
              const r = regions.find((x) => x.region === e.target.value);
              if (r) scene.current?.flyTo(r.centre);
              cb.current.onInteract();
            }}
            aria-label="Focus the globe on a region"
          >
            <option value="">Go to region…</option>
            {regions.map((r) => (
              <option key={r.region} value={r.region}>
                {r.region}
              </option>
            ))}
          </select>
        </label>
        <div className="pointer-events-auto flex flex-col gap-1.5">
          <button type="button" className={btn} aria-label="Zoom in" onClick={() => scene.current?.zoomBy(0.8)}>
            <Plus size={16} aria-hidden />
          </button>
          <button type="button" className={btn} aria-label="Zoom out" onClick={() => scene.current?.zoomBy(1.25)}>
            <Minus size={16} aria-hidden />
          </button>
          <button type="button" className={btn} aria-label="Reset globe view" onClick={() => scene.current?.reset(home)}>
            <RotateCcw size={15} aria-hidden />
          </button>
        </div>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-3 right-14 text-[11px] text-[#9FB0C4]">
        {hint
          ? 'Click the globe first, then scroll to zoom (or use + / −).'
          : coarse
            ? 'Drag sideways to rotate · pinch to zoom · tap a column for details'
            : 'Drag to rotate · scroll to zoom after clicking · click a column for details'}
      </p>
      {!ready && <div className="absolute inset-0 grid place-items-center text-xs text-[#9FB0C4]">Preparing 3D globe…</div>}
    </div>
  );
}
