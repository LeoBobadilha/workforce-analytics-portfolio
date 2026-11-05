// Pure geometry and marker logic for the 3D globe (no rendering library, so it is unit-tested).
//
// Convention: unit sphere, y up. Longitude 0 / latitude 0 faces +z, east is +x, north is +y.
// Markers sit at the Natural Earth label point of each country of assignment (the same anchor as
// the 2D map); they represent country totals, never individual locations.
import type { CountryPoint } from './geo';

export type Vec3 = [number, number, number];
const RAD = Math.PI / 180;

export function lonLatToVec3(lon: number, lat: number, r = 1): Vec3 {
  const φ = lat * RAD;
  const λ = lon * RAD;
  return [r * Math.cos(φ) * Math.sin(λ), r * Math.sin(φ), r * Math.cos(φ) * Math.cos(λ)];
}

export function vec3ToLonLat([x, y, z]: Vec3): [number, number] {
  const r = Math.hypot(x, y, z) || 1;
  return [Math.atan2(x, z) / RAD, Math.asin(Math.max(-1, Math.min(1, y / r))) / RAD];
}

/** Great-circle interpolation between two lon/lat positions (t in 0..1). */
export function slerpLonLat(a: [number, number], b: [number, number], t: number): [number, number] {
  const p = lonLatToVec3(a[0], a[1]);
  const q = lonLatToVec3(b[0], b[1]);
  const dot = Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
  const ω = Math.acos(dot);
  if (ω < 1e-6) return b;
  const s = Math.sin(ω);
  const k0 = Math.sin((1 - t) * ω) / s;
  const k1 = Math.sin(t * ω) / s;
  return vec3ToLonLat([k0 * p[0] + k1 * q[0], k0 * p[1] + k1 * q[1], k0 * p[2] + k1 * q[2]]);
}

/** Angular distance in degrees between two lon/lat positions. */
export function angularDistance(a: [number, number], b: [number, number]): number {
  const p = lonLatToVec3(a[0], a[1]);
  const q = lonLatToVec3(b[0], b[1]);
  return Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]))) / RAD;
}

/**
 * A point on the sphere is visible from the camera when it lies on the near side of the
 * horizon: P·C > R² (R = 1). Markers behind the planet are hidden and cannot be picked.
 */
export const facesCamera = (p: Vec3, cam: Vec3, margin = 0) => p[0] * cam[0] + p[1] * cam[1] + p[2] * cam[2] > 1 + margin;

/** Ray–sphere intersection (unit sphere at the origin); returns the near hit or null. */
export function raySphere(origin: Vec3, dir: Vec3): Vec3 | null {
  const b = origin[0] * dir[0] + origin[1] * dir[1] + origin[2] * dir[2];
  const c = origin[0] ** 2 + origin[1] ** 2 + origin[2] ** 2 - 1;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;
  return [origin[0] + t * dir[0], origin[1] + t * dir[1], origin[2] + t * dir[2]];
}

// ---------------------------------------------------------------------------------------------
// Country lookup from a geographic position (used for clicking or tapping the globe surface).

export interface CountryShape {
  iso3: string;
  /** polygons → rings → [lon, lat] */
  polygons: number[][][][];
  bbox: [number, number, number, number];
}

export function shapesFrom(features: { properties: { iso3: string }; geometry: { coordinates: number[][][][] } }[]): CountryShape[] {
  return features.map((f) => {
    let w = 180, s = 90, e = -180, n = -90;
    for (const poly of f.geometry.coordinates) for (const [x, y] of poly[0]) {
      w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
    }
    return { iso3: f.properties.iso3, polygons: f.geometry.coordinates, bbox: [w, s, e, n] };
  });
}

function inRing(ring: number[][], x: number, y: number) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** ISO3 of the country containing (lon, lat), honouring holes; null over the ocean. */
export function countryAt(shapes: CountryShape[], lon: number, lat: number): string | null {
  for (const s of shapes) {
    const [w, so, e, n] = s.bbox;
    if (lon < w || lon > e || lat < so || lat > n) continue;
    for (const poly of s.polygons) {
      if (!inRing(poly[0], lon, lat)) continue;
      if (poly.slice(1).some((hole) => inRing(hole, lon, lat))) continue;
      return s.iso3;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Markers

export type GlobeMode = 'active' | 'yoy';
export type MarkerKind = 'column' | 'ring';

export interface MarkerSpec {
  iso3: string;
  lon: number;
  lat: number;
  /** column height as a fraction of the tallest possible column (0..1), linear in the value */
  height: number;
  /** value the height encodes: headcount (active) or |YoY change| (yoy) */
  value: number;
  kind: MarkerKind;
  status: CountryPoint['status'];
}

/** Smallest drawn column so a country with one employee is still visible (fraction of max height). */
export const MIN_COLUMN = 0.012;

/**
 * Column height is linear in the encoded value with a fixed maximum over the selected period
 * (the same `scaleMaxima` as the 2D bubbles), so heights are comparable across months:
 *  - Active staff: height = headcount ÷ largest country headcount in the period.
 *  - YoY change:   height = |change| ÷ largest |change| in the period; colour gives the direction.
 * Countries without a prior-year baseline are drawn as a ring (no column) in YoY mode, and as a
 * column with a ring at its base in Active-staff mode, so "no baseline" never looks like "no change".
 */
export function markerSpecs(
  points: CountryPoint[],
  anchors: Map<string, [number, number]>,
  mode: GlobeMode,
  maxTotal: number,
  maxChange: number,
): MarkerSpec[] {
  const out: MarkerSpec[] = [];
  for (const p of points) {
    const a = anchors.get(p.iso3);
    if (!a) continue;
    let value: number;
    let height: number;
    let kind: MarkerKind = 'column';
    if (mode === 'active') {
      value = p.total;
      height = value > 0 && maxTotal > 0 ? Math.max(MIN_COLUMN, value / maxTotal) : 0;
    } else if (p.change == null) {
      value = 0;
      height = 0;
      kind = 'ring';
    } else {
      value = Math.abs(p.change);
      height = value > 0 && maxChange > 0 ? Math.max(MIN_COLUMN, value / maxChange) : MIN_COLUMN / 2;
    }
    out.push({ iso3: p.iso3, lon: a[0], lat: a[1], height, value, kind, status: p.status });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Guided exploration: stops ranked from the model, never hard-coded.

export interface TourStop {
  iso3: string;
  name: string;
  change: number;
  pct: number | null;
  kind: 'increase' | 'reduction';
  /** competition rank by size of change: 1 = largest; equal changes share a rank */
  rank: number;
  /** another country has exactly the same change */
  tied: boolean;
}

/**
 * Countries with the largest headcount increases, then the largest reductions, at the selected
 * month and filters. Order within equal changes follows the ranked list (larger headcount first,
 * then name); equal changes share a rank and are flagged as tied. Countries without a prior-year
 * baseline are excluded.
 */
export function tourStops(points: CountryPoint[], perSide = 3): TourStop[] {
  const known = points.filter((p) => p.change != null && p.change !== 0);
  const side = (kind: 'increase' | 'reduction') => {
    const sign = kind === 'increase' ? 1 : -1;
    const pool = known.filter((p) => sign * p.change! > 0);
    return pool
      .sort((a, b) => sign * (b.change! - a.change!) || b.total - a.total || a.name.localeCompare(b.name))
      .slice(0, perSide)
      .map((p) => ({
        iso3: p.iso3,
        name: p.name,
        change: p.change!,
        pct: p.pct,
        kind,
        rank: 1 + pool.filter((q) => sign * q.change! > sign * p.change!).length,
        tied: pool.filter((q) => q.change === p.change).length > 1,
      }));
  };
  return [...side('increase'), ...side('reduction')];
}

/** Region views derived from the countries in the model (centre of their marker anchors). */
export function regionCentres(countries: { iso3: string; region: string }[], anchors: Map<string, [number, number]>) {
  const groups = new Map<string, Vec3>();
  for (const c of countries) {
    const a = anchors.get(c.iso3);
    if (!a) continue;
    const v = lonLatToVec3(a[0], a[1]);
    const g = groups.get(c.region) ?? [0, 0, 0];
    groups.set(c.region, [g[0] + v[0], g[1] + v[1], g[2] + v[2]]);
  }
  return [...groups].map(([region, v]) => ({ region, centre: vec3ToLonLat(v) }));
}

/** Default view: centred on all model countries. */
export function defaultCentre(anchors: Iterable<[number, number]>): [number, number] {
  let s: Vec3 = [0, 0, 0];
  for (const [lon, lat] of anchors) {
    const v = lonLatToVec3(lon, lat);
    s = [s[0] + v[0], s[1] + v[1], s[2] + v[2]];
  }
  return vec3ToLonLat(s);
}
