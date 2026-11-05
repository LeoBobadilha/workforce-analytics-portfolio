import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeModel } from '../data/decode';
import { parseYm } from './dates';
import { buildCube, countryPoints, scaleMaxima, summarise } from './geo';
import {
  angularDistance,
  countryAt,
  defaultCentre,
  facesCamera,
  lonLatToVec3,
  markerSpecs,
  MIN_COLUMN,
  raySphere,
  regionCentres,
  shapesFrom,
  slerpLonLat,
  tourStops,
  vec3ToLonLat,
} from './globe';
import { computeKpis } from './metrics';
import { initialView } from './webgl';

const root = resolve(__dirname, '../../..');
const model = decodeModel(JSON.parse(readFileSync(resolve(root, 'web/public/data/hr_model.json'), 'utf-8')));
const geo = JSON.parse(readFileSync(resolve(root, 'web/public/geo/world-110m.json'), 'utf-8')) as {
  features: { properties: { iso3: string; name: string; label: [number, number] }; geometry: { coordinates: number[][][][] } }[];
};
const cube = buildCube(model);
const anchors = new Map(geo.features.map((f) => [f.properties.iso3, f.properties.label] as [string, [number, number]]));
const shapes = shapesFrom(geo.features);
const ALL = { country: null, category: null };
const OCT26 = parseYm('2026-10');

describe('3D globe coordinates', () => {
  it('lon/lat ↔ sphere position round-trips for every model country anchor', () => {
    for (const c of model.countries) {
      const [lon, lat] = anchors.get(c.iso3)!;
      const v = lonLatToVec3(lon, lat);
      expect(Math.hypot(...v)).toBeCloseTo(1, 12);
      const [lon2, lat2] = vec3ToLonLat(v);
      expect(lon2, c.name).toBeCloseTo(lon, 9);
      expect(lat2, c.name).toBeCloseTo(lat, 9);
    }
    // orientation: lon 0 / lat 0 faces +z, east is +x, north is +y
    expect(lonLatToVec3(0, 0)).toEqual([0, 0, 1]);
    expect(lonLatToVec3(90, 0)[0]).toBeCloseTo(1, 12);
    expect(lonLatToVec3(0, 90)[1]).toBeCloseTo(1, 12);
  });

  it('every marker sits on its own country: the anchor resolves back to that country when picked', () => {
    for (const c of model.countries) {
      const [lon, lat] = anchors.get(c.iso3)!;
      expect(countryAt(shapes, lon, lat), c.name).toBe(c.iso3);
    }
    expect(countryAt(shapes, -30, 0)).toBeNull(); // mid-Atlantic
    expect(countryAt(shapes, 2.35, 48.85)).toBe('FRA'); // a country outside the model is still identified
  });

  it('a ray from the camera through the view centre hits the surface at the focused country', () => {
    const [lon, lat] = anchors.get('KEN')!;
    const cam = lonLatToVec3(lon, lat, 3.2);
    const hit = raySphere(cam, lonLatToVec3(lon, lat, -1))!;
    const [hl, ht] = vec3ToLonLat(hit);
    expect(hl).toBeCloseTo(lon, 9);
    expect(ht).toBeCloseTo(lat, 9);
    expect(countryAt(shapes, hl, ht)).toBe('KEN');
    expect(raySphere(cam, lonLatToVec3(lon + 90, 0))).toBeNull(); // looking away from the planet
  });

  it('markers on the far side of the planet are hidden and cannot be picked (horizon test)', () => {
    const [lon, lat] = anchors.get('KEN')!;
    const cam = lonLatToVec3(lon, lat, 3.2);
    expect(facesCamera(lonLatToVec3(lon, lat), cam)).toBe(true);
    const [cl, ct] = anchors.get('COL')!; // Colombia: ~111° of arc from Kenya
    expect(angularDistance([lon, lat], [cl, ct])).toBeGreaterThan(100);
    expect(facesCamera(lonLatToVec3(cl, ct), cam)).toBe(false);
    // the horizon from distance d lies at acos(1/d) of arc
    const edge = (Math.acos(1 / 3.2) * 180) / Math.PI;
    expect(facesCamera(lonLatToVec3(lon + edge - 1, 0), lonLatToVec3(lon, 0, 3.2))).toBe(true);
    expect(facesCamera(lonLatToVec3(lon + edge + 1, 0), lonLatToVec3(lon, 0, 3.2))).toBe(false);
  });

  it('camera flights follow the great circle between the two positions', () => {
    const a: [number, number] = [37.9, 0.55];
    const b: [number, number] = [-73.17, 3.37];
    expect(slerpLonLat(a, b, 0)[0]).toBeCloseTo(a[0], 6);
    expect(slerpLonLat(a, b, 1)[0]).toBeCloseTo(b[0], 6);
    const mid = slerpLonLat(a, b, 0.5);
    const total = angularDistance(a, b);
    expect(angularDistance(a, mid)).toBeCloseTo(total / 2, 6);
    expect(angularDistance(mid, b)).toBeCloseTo(total / 2, 6);
  });

  it('region views and the default view are derived from the model countries', () => {
    const regions = regionCentres(model.countries, anchors);
    expect(new Set(regions.map((r) => r.region))).toEqual(new Set(model.countries.map((c) => c.region)));
    for (const r of regions) {
      const members = model.countries.filter((c) => c.region === r.region).map((c) => anchors.get(c.iso3)!);
      // the centre is close to its own countries (within the spread of the region)
      const nearest = Math.min(...members.map((m) => angularDistance(m, r.centre)));
      expect(nearest, r.region).toBeLessThan(25);
    }
    const home = defaultCentre(model.countries.map((c) => anchors.get(c.iso3)!));
    expect(home[0]).toBeGreaterThan(-20);
    expect(home[0]).toBeLessThan(60); // Africa / Middle East, where most countries of operation are
  });
});

describe('3D markers use the same validated figures as the 2D map and the KPIs', () => {
  const { total: maxTotal, change: maxChange } = scaleMaxima(cube, parseYm('2024-01'), OCT26, ALL);
  const points = countryPoints(cube, OCT26, ALL);

  it('active-staff columns: one per country, height linear in headcount, values reconcile with the KPI', () => {
    const specs = markerSpecs(points, anchors, 'active', maxTotal, maxChange);
    expect(specs.length).toBe(points.length);
    const byIso = new Map(points.map((p) => [p.iso3, p]));
    for (const s of specs) {
      const p = byIso.get(s.iso3)!;
      expect(s.value).toBe(p.total);
      expect(s.height).toBeCloseTo(Math.max(MIN_COLUMN, p.total / maxTotal), 12);
      expect(s.status).toBe(p.status);
      expect([s.lon, s.lat]).toEqual(anchors.get(s.iso3));
    }
    const sum = specs.reduce((a, s) => a + s.value, 0);
    const k = computeKpis(model, { from: parseYm('2024-01'), to: OCT26, country: null, category: null });
    expect(sum).toBe(k.headcount);
    expect(summarise(points, model.meta.hq_country).total).toBe(sum);
    // linear: two columns' heights have the same ratio as their headcounts
    const [a, b] = specs.filter((s) => s.height > MIN_COLUMN);
    expect(a.height / b.height).toBeCloseTo(a.value / b.value, 12);
  });

  it('YoY columns: height linear in |change|, direction in the status; no baseline is a ring, never zero growth', () => {
    const specs = markerSpecs(points, anchors, 'yoy', maxTotal, maxChange);
    for (const s of specs) {
      const p = points.find((x) => x.iso3 === s.iso3)!;
      expect(s.value).toBe(Math.abs(p.change!));
      if (p.change !== 0) expect(s.height).toBeCloseTo(Math.max(MIN_COLUMN, Math.abs(p.change!) / maxChange), 12);
    }
    const first = countryPoints(cube, cube.m0, ALL);
    for (const s of markerSpecs(first, anchors, 'yoy', maxTotal, maxChange)) {
      expect(s.kind).toBe('ring');
      expect(s.height).toBe(0);
      expect(s.status).toBe('no-baseline');
    }
  });

  it('category and country filters flow through to the markers', () => {
    const f = { country: null, category: 'International Staff' as const };
    const pts = countryPoints(cube, OCT26, f);
    const sum = markerSpecs(pts, anchors, 'active', 1, 1).reduce((a, s) => a + s.value, 0);
    expect(sum).toBe(computeKpis(model, { from: OCT26, to: OCT26, ...f }).headcount);
    const one = markerSpecs(countryPoints(cube, OCT26, { country: 'Kenya', category: null }), anchors, 'active', 1, 1);
    expect(one.map((s) => s.iso3)).toEqual(['KEN']);
  });
});

describe('guided exploration ranking', () => {
  it('stops are the largest increases then the largest reductions, computed from the model', () => {
    const points = countryPoints(cube, OCT26, ALL);
    const stops = tourStops(points, 3);
    const up = points.filter((p) => (p.change ?? 0) > 0).sort((a, b) => b.change! - a.change! || b.total - a.total || a.name.localeCompare(b.name));
    const down = points.filter((p) => (p.change ?? 0) < 0).sort((a, b) => a.change! - b.change! || b.total - a.total || a.name.localeCompare(b.name));
    expect(stops.map((s) => s.iso3)).toEqual([...up.slice(0, 3), ...down.slice(0, 3)].map((p) => p.iso3));
    for (const s of stops) {
      const p = points.find((x) => x.iso3 === s.iso3)!;
      expect(s.change).toBe(p.change);
      expect(s.pct).toBe(p.pct);
      expect(s.kind).toBe(p.change! > 0 ? 'increase' : 'reduction');
    }
    // equal changes share a rank and are flagged, so a tie is never presented as a sole "largest"
    for (const s of stops) {
      const same = (s.kind === 'increase' ? up : down).filter((p) => p.change === s.change);
      expect(s.tied, s.name).toBe(same.length > 1);
      const bigger = (s.kind === 'increase' ? up : down).filter((p) => Math.abs(p.change!) > Math.abs(s.change)).length;
      expect(s.rank, s.name).toBe(bigger + 1);
    }
  });

  it('the ranking follows the filters and month, and needs a prior-year baseline', () => {
    const a = tourStops(countryPoints(cube, parseYm('2025-06'), ALL)).map((s) => s.iso3);
    const b = tourStops(countryPoints(cube, OCT26, ALL)).map((s) => s.iso3);
    expect(a).not.toEqual(b);
    const intl = tourStops(countryPoints(cube, OCT26, { country: null, category: 'International Staff' }));
    for (const s of intl) {
      const p = countryPoints(cube, OCT26, { country: null, category: 'International Staff' }).find((x) => x.iso3 === s.iso3)!;
      expect(s.change).toBe(p.change);
    }
    expect(tourStops(countryPoints(cube, cube.m0, ALL))).toEqual([]);
  });
});

describe('default explorer view', () => {
  it('3D only with hardware WebGL on a capable device; 2D otherwise', () => {
    expect(initialView('full', { lowEnd: false })).toBe('3d');
    expect(initialView('full', { lowEnd: true })).toBe('2d');
    expect(initialView('software', { lowEnd: false })).toBe('2d');
    expect(initialView('none', { lowEnd: false })).toBe('2d');
  });
});
