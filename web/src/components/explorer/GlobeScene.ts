// Imperative Three.js scene for the 3D globe. Loaded only with the 3D view (separate chunk).
//
// Performance model:
//  - Built once: sphere + land texture (drawn once from the simplified Natural Earth boundaries),
//    one line mesh for all borders, one for model-country borders, one graticule, one atmosphere.
//  - Markers are instanced meshes with one fixed slot per model country: timeline, mode and filter
//    changes only rewrite 27 instance matrices/colours (no new meshes, textures or geometry).
//  - Rendering is on demand: frames are drawn only while the camera, a flight, inertia or a
//    height transition is moving. An idle globe, a hidden tab or an off-screen section draws nothing.
//  - Device pixel ratio is capped; all GPU resources are disposed on unmount; context loss is
//    reported to the React wrapper, which offers the 2D map or a restart.
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
import { countryAt, facesCamera, lonLatToVec3, raySphere, slerpLonLat, angularDistance, type CountryShape, type MarkerSpec, type Vec3 } from '../../lib/globe';
import { GLOBE, GLOBE_STATUS, RING_COLOR } from './globeTheme';

export interface GlobeFeature {
  properties: { iso3: string; name: string; label: [number, number] };
  geometry: { coordinates: number[][][][] };
}

export interface SceneCallbacks {
  onHover(iso: string | null): void;
  onSelect(iso: string): void;
  /** the user dragged, zoomed or used the keyboard on the globe */
  onInteract(): void;
  onReady(): void;
  onContextLost(): void;
  onContextRestored(): void;
  onWheelHint(): void;
  describe(iso: string): string;
}

export interface SceneOptions {
  container: HTMLElement;
  features: GlobeFeature[];
  shapes: CountryShape[];
  anchors: Map<string, [number, number]>;
  /** model countries, in a fixed order: one marker slot each */
  slots: string[];
  covered: Set<string>;
  reducedMotion: boolean;
  coarse: boolean;
  start: [number, number];
  callbacks: SceneCallbacks;
}

/** Counters read by the browser tests and the performance script (no effect on rendering). */
interface Stats {
  live: number;
  created: number;
  frames: number;
  renderMs: number;
  gpu: { geometries: number; textures: number; drawCalls: number };
  /** screen position (px within the canvas) of a country's marker base, or null when behind the planet */
  screenOf?: (iso: string) => [number, number] | null;
}
const stats = (): Stats => {
  const w = window as unknown as { __globeStats?: Stats };
  return (w.__globeStats ??= { live: 0, created: 0, frames: 0, renderMs: 0, gpu: { geometries: 0, textures: 0, drawCalls: 0 } });
};

const FOV = 30;
// Tallest column, in globe radii. Heights stay linear in the value; a shorter maximum keeps
// columns near the limb from crossing their neighbours in the dense Africa / Middle East band.
const H_MAX = 0.27;
const COL_R = 0.0105; // column radius (≈ 0.6°), so neighbouring countries stay distinguishable
const FOOT_R = 0.017;
const RING_R = 0.024;
/** surface colour that unselected markers fade towards while a country is selected */
const DIM = new Color(GLOBE.ocean);
const LAT_MIN = -65;
const LAT_MAX = 75;
const TEX_W = 2048;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Line segments along every ring of the given features, densified to follow the curvature. */
function ringSegments(features: GlobeFeature[], r: number): Float32Array {
  const out: number[] = [];
  for (const f of features)
    for (const poly of f.geometry.coordinates)
      for (const ring of poly)
        for (let i = 0; i < ring.length - 1; i++) {
          const [x0, y0] = ring[i];
          const [x1, y1] = ring[i + 1];
          const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2));
          for (let k = 0; k < n; k++) {
            const a = lonLatToVec3(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, r);
            const b = lonLatToVec3(x0 + ((x1 - x0) * (k + 1)) / n, y0 + ((y1 - y0) * (k + 1)) / n, r);
            out.push(...a, ...b);
          }
        }
  return new Float32Array(out);
}

function graticule(r: number): Float32Array {
  const out: number[] = [];
  for (let lon = -180; lon < 180; lon += 30)
    for (let lat = -80; lat < 80; lat += 4) out.push(...lonLatToVec3(lon, lat, r), ...lonLatToVec3(lon, lat + 4, r));
  for (let lat = -60; lat <= 60; lat += 30)
    for (let lon = -180; lon < 180; lon += 4) out.push(...lonLatToVec3(lon, lat, r), ...lonLatToVec3(lon + 4, lat, r));
  return new Float32Array(out);
}

/** Equirectangular land texture: ocean, land, and model countries in a teal tint. Drawn once. */
function landTexture(features: GlobeFeature[], covered: Set<string>, width: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = width / 2;
  const g = c.getContext('2d')!;
  g.fillStyle = GLOBE.ocean;
  g.fillRect(0, 0, c.width, c.height);
  const X = (lon: number) => ((lon + 180) / 360) * c.width;
  const Y = (lat: number) => ((90 - lat) / 180) * c.height;
  for (const f of features) {
    g.beginPath();
    for (const poly of f.geometry.coordinates)
      for (const ring of poly) {
        ring.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
        g.closePath();
      }
    g.fillStyle = covered.has(f.properties.iso3) ? GLOBE.covered : GLOBE.land;
    g.fill('evenodd');
  }
  return c;
}

const ATMOS_VERT = /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ATMOS_FRAG = /* glsl */ `
uniform vec3 glow;
varying vec3 vNormal;
void main() {
  float i = pow(max(0.0, 0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.4);
  gl_FragColor = vec4(glow, 1.0) * i * 0.85;
}`;

export class GlobeScene {
  private o: SceneOptions;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 0.05, 50);
  private canvas: HTMLCanvasElement;
  private labelLayer: HTMLDivElement;
  private tooltip: HTMLDivElement;
  private ro: ResizeObserver;
  private disposed = false;
  private lost = false;
  private active = true;
  private raf = 0;
  private w = 1;
  private h = 1;

  // camera state (degrees, globe radii)
  private lon: number;
  private lat: number;
  private dist = 4;
  private fitDist = 4;
  private flight: { from: [number, number]; to: [number, number]; d0: number; d1: number; t0: number; dur: number } | null = null;
  private vel = { lon: 0, lat: 0 };

  // markers
  private columns: InstancedMesh;
  private feet: InstancedMesh;
  private rings: InstancedMesh;
  private selRing: Mesh;
  private selLines: LineSegments | null = null;
  private hoverLines: LineSegments | null = null;
  /** on-globe controls (region select, zoom buttons) that labels must not cover, in px */
  private reserved: [number, number, number, number][] = [];
  private normals: Vector3[];
  private qUp: Quaternion[];
  private qFace: Quaternion[];
  private cur: Float32Array;
  private from: Float32Array;
  private to: Float32Array;
  private tween: { t0: number; dur: number } | null = null;
  private specs = new Map<string, MarkerSpec>();
  /** marker base on the near side of the horizon (back-side markers are hidden, not just occluded) */
  private front: Uint8Array;
  private slotOf: Map<string, number>;
  private hovered: string | null = null;
  private selected: string | null = null;
  private labels = new Map<string, { el: HTMLSpanElement; text: string; w: number }>();
  private labelText = new Map<string, string>();
  private readyFired = false;

  // pointer state
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; moved: number; t: number; type: string; dx: number; dy: number; scroll: boolean; decided: boolean } | null = null;
  private pinch: number | null = null;
  private engaged = false;
  private lastMove = { x: 0, y: 0, t: 0 };
  private hoverQueued = false;
  private hoverAt = { x: 0, y: 0 };

  constructor(o: SceneOptions) {
    this.o = o;
    [this.lon, this.lat] = o.start;
    this.slotOf = new Map(o.slots.map((s, i) => [s, i]));
    const dprCap = o.coarse ? 1.5 : 1.75;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;outline:none;cursor:grab';
    o.container.appendChild(this.canvas);

    this.labelLayer = document.createElement('div');
    this.labelLayer.setAttribute('aria-hidden', 'true');
    this.labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    o.container.appendChild(this.labelLayer);
    this.tooltip = document.createElement('div');
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.style.cssText =
      'position:absolute;left:0;top:0;display:none;pointer-events:none;z-index:5;min-width:150px;max-width:240px;padding:8px 10px;border-radius:8px;' +
      'background:rgba(9,20,36,.94);border:1px solid rgba(120,150,185,.35);box-shadow:0 8px 24px rgba(0,0,0,.35);color:#E8EEF5;font:12px/1.45 Inter Variable,Segoe UI,system-ui,sans-serif';
    o.container.appendChild(this.tooltip);

    // --- static globe -------------------------------------------------------------------------
    const tex = new CanvasTexture(landTexture(o.features, o.covered, o.coarse ? TEX_W / 2 : TEX_W));
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const sphere = new Mesh(new SphereGeometry(1, 96, 64), new MeshLambertMaterial({ map: tex }));
    sphere.rotation.y = -Math.PI / 2; // align the equirectangular texture with lon/lat (lon 0 faces +z)
    this.scene.add(sphere);

    const line = (pos: Float32Array, color: string, opacity: number) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      return new LineSegments(g, new LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    };
    this.scene.add(line(graticule(1.0008), GLOBE.graticule, 0.07));
    this.scene.add(line(ringSegments(o.features.filter((f) => !o.covered.has(f.properties.iso3)), 1.0012), GLOBE.border, 0.42));
    this.scene.add(line(ringSegments(o.features.filter((f) => o.covered.has(f.properties.iso3)), 1.0015), GLOBE.coveredBorder, 0.55));

    const atmos = new Mesh(
      new SphereGeometry(1.14, 64, 48),
      new ShaderMaterial({ vertexShader: ATMOS_VERT, fragmentShader: ATMOS_FRAG, uniforms: { glow: { value: new Color(GLOBE.atmosphere) } }, side: BackSide, blending: AdditiveBlending, transparent: true, depthWrite: false }),
    );
    this.scene.add(atmos);

    this.scene.add(new AmbientLight(0xffffff, 1.9));
    const sun = new DirectionalLight(0xffffff, 2.1);
    sun.position.set(-1.6, 1.4, 2.2);
    this.camera.add(sun); // the lit side follows the view so the visible hemisphere stays readable
    this.scene.add(this.camera);

    // --- markers: one instanced slot per model country -----------------------------------------
    const n = o.slots.length;
    const colGeo = new CylinderGeometry(1, 1, 1, 14, 1, false);
    colGeo.translate(0, 0.5, 0); // base at the surface
    this.columns = new InstancedMesh(colGeo, new MeshLambertMaterial({ color: 0xffffff, emissive: new Color('#0B1626') }), n);
    this.feet = new InstancedMesh(new CircleGeometry(1, 28), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }), n);
    this.rings = new InstancedMesh(new RingGeometry(0.72, 1, 40), new MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0.95, depthWrite: false }), n);
    for (const m of [this.columns, this.feet, this.rings]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      this.scene.add(m);
    }
    this.selRing = new Mesh(new RingGeometry(0.8, 1, 48), new MeshBasicMaterial({ color: GLOBE.selection, transparent: true, opacity: 0.95, depthWrite: false }));
    this.selRing.visible = false;
    this.scene.add(this.selRing);

    this.normals = o.slots.map((iso) => {
      const a = o.anchors.get(iso) ?? [0, 0];
      return new Vector3(...lonLatToVec3(a[0], a[1]));
    });
    const Y = new Vector3(0, 1, 0);
    const Z = new Vector3(0, 0, 1);
    this.qUp = this.normals.map((v) => new Quaternion().setFromUnitVectors(Y, v));
    this.qFace = this.normals.map((v) => new Quaternion().setFromUnitVectors(Z, v));
    this.cur = new Float32Array(n);
    this.from = new Float32Array(n);
    this.to = new Float32Array(n);
    this.front = new Uint8Array(n).fill(1);
    const black = new Color(0, 0, 0);
    for (let i = 0; i < n; i++) {
      this.columns.setColorAt(i, black);
      this.feet.setColorAt(i, black);
    }
    this.applyMarkers();

    // --- events -----------------------------------------------------------------------------
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onCancel);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('webglcontextlost', this.onLost);
    this.canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(o.container);
    this.resize();
    this.dist = this.fitDist * 0.98;
    const s = stats();
    s.live++;
    s.created++;
    s.screenOf = this.screenOf;
  }

  // ----------------------------------------------------------------------------------------------
  // Public API

  setMarkers(specs: MarkerSpec[], labelText: Map<string, string>) {
    this.specs = new Map(specs.map((s) => [s.iso3, s]));
    this.labelText = labelText;
    const now = performance.now();
    for (let i = 0; i < this.o.slots.length; i++) {
      this.from[i] = this.cur[i];
      this.to[i] = this.specs.get(this.o.slots[i])?.height ?? 0;
    }
    if (this.o.reducedMotion) {
      this.cur.set(this.to);
      this.tween = null;
    } else this.tween = { t0: now, dur: 320 };
    this.applyColours();
    this.applyMarkers();
    this.requestRender();
  }

  setHovered(iso: string | null) {
    if (iso === this.hovered) return;
    this.hovered = iso;
    // a light outline of the hovered country (the selected one already has a strong outline)
    this.hoverLines = this.outline(this.hoverLines, iso && iso !== this.selected ? iso : null, 1.0018, 0.5);
    this.applyColours();
    this.requestRender();
  }

  /** Replace an outline mesh (one country's borders); geometry is built only on selection or hover changes. */
  private outline(prev: LineSegments | null, iso: string | null, r: number, opacity: number): LineSegments | null {
    if (prev) {
      this.scene.remove(prev);
      prev.geometry.dispose();
      (prev.material as Material).dispose();
    }
    if (!iso) return null;
    const f = this.o.features.filter((x) => x.properties.iso3 === iso);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(ringSegments(f, r), 3));
    const lines = new LineSegments(g, new LineBasicMaterial({ color: GLOBE.selection, transparent: true, opacity, depthWrite: false }));
    this.scene.add(lines);
    return lines;
  }

  setSelected(iso: string | null) {
    if (iso === this.selected) return;
    this.selected = iso;
    this.selLines = this.outline(this.selLines, iso, 1.002, 0.95);
    if (iso && iso === this.hovered) this.hoverLines = this.outline(this.hoverLines, null, 0, 0);
    this.applyColours();
    this.applyMarkers();
    this.requestRender();
  }

  /** Bring a geographic position to the centre of the view. */
  flyTo(lonLat: [number, number], opts: { dist?: number } = {}) {
    const d1 = Math.min(this.maxDist(), Math.max(this.minDist(), opts.dist ?? Math.min(this.dist, this.fitDist * 1.02)));
    this.vel = { lon: 0, lat: 0 };
    const to: [number, number] = [lonLat[0], Math.max(LAT_MIN, Math.min(LAT_MAX, lonLat[1]))];
    if (this.o.reducedMotion) {
      [this.lon, this.lat] = to;
      this.dist = d1;
      this.flight = null;
    } else {
      const ang = angularDistance([this.lon, this.lat], to);
      this.flight = { from: [this.lon, this.lat], to, d0: this.dist, d1, t0: performance.now(), dur: Math.min(1400, 500 + ang * 7) };
    }
    this.requestRender();
  }

  reset(centre: [number, number]) {
    this.flyTo(centre, { dist: this.fitDist * 0.98 });
  }

  zoomBy(factor: number) {
    this.flight = null;
    this.dist = Math.min(this.maxDist(), Math.max(this.minDist(), this.dist * factor));
    this.requestRender();
  }

  rotateBy(dLon: number, dLat: number) {
    this.flyTo([this.lon + dLon, this.lat + dLat], { dist: this.dist });
  }

  /** Pause or resume drawing (section scrolled away, tab hidden). */
  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.vel = { lon: 0, lat: 0 };
    } else this.requestRender();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.scene.traverse((obj: Object3D) => {
      const m = obj as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mat of mats) {
        const map = (mat as MeshLambertMaterial).map;
        if (map) map.dispose();
        mat.dispose();
      }
      if (obj instanceof InstancedMesh) obj.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.labelLayer.remove();
    this.tooltip.remove();
    const st = stats();
    st.live--;
    if (st.screenOf === this.screenOf) delete st.screenOf;
  }

  get cameraState() {
    return { lon: this.lon, lat: this.lat, dist: this.dist, fit: this.fitDist };
  }

  // ----------------------------------------------------------------------------------------------
  // Rendering

  requestRender() {
    if (this.disposed || this.lost || !this.active || this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.disposed || this.lost) return;
    let more = false;
    if (this.flight) {
      const f = this.flight;
      const t = Math.min(1, (now - f.t0) / f.dur);
      const e = ease(t);
      [this.lon, this.lat] = slerpLonLat(f.from, f.to, e);
      this.dist = f.d0 + (f.d1 - f.d0) * e;
      if (t >= 1) this.flight = null;
      else more = true;
    } else if (!this.drag && (Math.abs(this.vel.lon) > 0.01 || Math.abs(this.vel.lat) > 0.01)) {
      this.lon += this.vel.lon;
      this.lat = Math.max(LAT_MIN, Math.min(LAT_MAX, this.lat + this.vel.lat));
      this.vel.lon *= 0.9;
      this.vel.lat *= 0.9;
      more = true;
    }
    if (this.tween) {
      const t = Math.min(1, (now - this.tween.t0) / this.tween.dur);
      const e = easeOut(t);
      for (let i = 0; i < this.cur.length; i++) this.cur[i] = this.from[i] + (this.to[i] - this.from[i]) * e;
      this.applyMarkers();
      if (t >= 1) this.tween = null;
      else more = true;
    }
    this.lon = ((((this.lon + 180) % 360) + 360) % 360) - 180;
    this.camera.position.set(...lonLatToVec3(this.lon, this.lat, this.dist));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    if (this.updateFront()) this.applyMarkers();
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    const st = stats();
    st.frames++;
    st.renderMs += performance.now() - t0;
    const info = this.renderer.info;
    st.gpu = { geometries: info.memory.geometries, textures: info.memory.textures, drawCalls: info.render.calls };
    if (more) this.requestRender();
    else {
      this.o.container.dataset.camera = `${this.lon.toFixed(1)},${this.lat.toFixed(1)},${(this.dist / this.fitDist).toFixed(2)}`;
      if (!this.readyFired) {
        this.readyFired = true;
        this.o.callbacks.onReady();
      }
    }
  };

  private resize() {
    const r = this.o.container.getBoundingClientRect();
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    const prevFit = this.fitDist;
    // distance at which the globe (with its tallest columns) fills the shorter side of the view
    const half = Math.tan(((FOV / 2) * Math.PI) / 180) * Math.min(1, this.camera.aspect);
    this.fitDist = Math.sqrt(1 + (1.18 / half) ** 2);
    this.dist *= this.fitDist / prevFit;
    this.measureReserved();
    this.requestRender();
  }

  /** Rectangles of the overlay controls ([data-globe-ui]) relative to the canvas. */
  private measureReserved() {
    const host = this.o.container.getBoundingClientRect();
    const root = this.o.container.parentElement;
    this.reserved = root
      ? [...root.querySelectorAll('[data-globe-ui]')].map((el) => {
          const r = el.getBoundingClientRect();
          return [r.left - host.left - 4, r.top - host.top - 4, r.width + 8, r.height + 8] as [number, number, number, number];
        })
      : [];
  }

  private minDist = () => 1.32;
  private maxDist = () => this.fitDist * 1.6;

  private applyColours() {
    const c = new Color();
    const white = new Color('#FFFFFF');
    for (let i = 0; i < this.o.slots.length; i++) {
      const iso = this.o.slots[i];
      const s = this.specs.get(iso);
      c.set(s ? GLOBE_STATUS[s.status].color : '#000000');
      if (iso === this.hovered || iso === this.selected) c.lerp(white, iso === this.selected ? 0.28 : 0.4);
      // while a country is selected, the others recede so it stands out (colours keep their hue)
      else if (this.selected) c.lerp(DIM, 0.5);
      this.columns.setColorAt(i, c);
      this.feet.setColorAt(i, c);
    }
    if (this.columns.instanceColor) this.columns.instanceColor.needsUpdate = true;
    if (this.feet.instanceColor) this.feet.instanceColor.needsUpdate = true;
  }

  /** Recompute which marker bases face the camera; true when any changed. */
  private updateFront() {
    const cam = this.camVec();
    let changed = false;
    for (let i = 0; i < this.normals.length; i++) {
      const n = this.normals[i];
      const f = facesCamera([n.x, n.y, n.z], cam, 0.004) ? 1 : 0;
      if (f !== this.front[i]) {
        this.front[i] = f;
        changed = true;
      }
    }
    return changed;
  }

  private applyMarkers() {
    const m = new Matrix4();
    const p = new Vector3();
    const sc = new Vector3();
    const hollow = new Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.o.slots.length; i++) {
      const s = this.front[i] ? this.specs.get(this.o.slots[i]) : undefined;
      const h = this.front[i] ? this.cur[i] : 0;
      const n = this.normals[i];
      if (h > 0.0005) {
        p.copy(n).multiplyScalar(1.001);
        sc.set(COL_R, h * H_MAX, COL_R);
        this.columns.setMatrixAt(i, m.compose(p, this.qUp[i], sc));
      } else this.columns.setMatrixAt(i, hollow);
      p.copy(n).multiplyScalar(1.0025);
      if (s) this.feet.setMatrixAt(i, m.compose(p, this.qFace[i], sc.set(FOOT_R, FOOT_R, 1)));
      else this.feet.setMatrixAt(i, hollow);
      p.copy(n).multiplyScalar(1.003);
      if (s && s.status === 'no-baseline') this.rings.setMatrixAt(i, m.compose(p, this.qFace[i], sc.set(RING_R, RING_R, 1)));
      else this.rings.setMatrixAt(i, hollow);
    }
    this.columns.instanceMatrix.needsUpdate = true;
    this.feet.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    const si = this.selected ? this.slotOf.get(this.selected) : undefined;
    if (si != null && this.front[si]) {
      this.selRing.visible = true;
      this.selRing.position.copy(this.normals[si]).multiplyScalar(1.0035);
      this.selRing.quaternion.copy(this.qFace[si]);
      this.selRing.scale.setScalar(0.034);
    } else this.selRing.visible = false;
  }

  screenOf = (iso: string): [number, number] | null => {
    const i = this.slotOf.get(iso);
    if (i == null) return null;
    const n = this.normals[i];
    return facesCamera([n.x, n.y, n.z], this.camVec(), 0.01) ? this.project([n.x, n.y, n.z]) : null;
  };

  private project(v: Vec3): [number, number] {
    const p = new Vector3(...v).project(this.camera);
    return [((p.x + 1) / 2) * this.w, ((1 - p.y) / 2) * this.h];
  }

  private camVec(): Vec3 {
    return [this.camera.position.x, this.camera.position.y, this.camera.position.z];
  }

  private updateLabels() {
    const cam = this.camVec();
    const max = this.w < 520 ? 3 : 6;
    if (!this.reserved.length) this.measureReserved();
    const order = [...this.specs.values()].sort((a, b) => {
      const pa = a.iso3 === this.selected ? 2 : a.iso3 === this.hovered ? 1 : 0;
      const pb = b.iso3 === this.selected ? 2 : b.iso3 === this.hovered ? 1 : 0;
      return pb - pa || b.value - a.value;
    });
    const placed: [number, number, number, number][] = [];
    const shown = new Set<string>();
    for (const s of order) {
      if (placed.length >= max) break;
      const i = this.slotOf.get(s.iso3);
      if (i == null) continue;
      const n = this.normals[i];
      const base: Vec3 = [n.x, n.y, n.z];
      if (!facesCamera(base, cam, 0.06)) continue;
      const top = lonLatToVec3(s.lon, s.lat, 1 + this.cur[i] * H_MAX + 0.01);
      const [x, y] = this.project(top);
      const text = this.labelText.get(s.iso3) ?? s.iso3;
      let L = this.labels.get(s.iso3);
      if (!L) {
        const el = document.createElement('span');
        el.style.cssText =
          'position:absolute;left:0;top:0;white-space:nowrap;padding:1px 6px;border-radius:5px;background:rgba(7,16,30,.72);' +
          'color:#E8EEF5;font:600 11px/16px Inter Variable,Segoe UI,system-ui,sans-serif;font-variant-numeric:tabular-nums;will-change:transform';
        this.labelLayer.appendChild(el);
        L = { el, text: '', w: 0 };
        this.labels.set(s.iso3, L);
      }
      if (L.text !== text) {
        L.el.textContent = text;
        L.text = text;
        L.el.style.display = 'block';
        L.w = L.el.offsetWidth;
      }
      const lw = L.w || text.length * 6.5 + 12;
      const rect: [number, number, number, number] = [x - lw / 2, y - 22, lw, 18];
      const important = s.iso3 === this.selected || s.iso3 === this.hovered;
      const overlaps = (r: [number, number, number, number]) => rect[0] < r[0] + r[2] + 3 && rect[0] + rect[2] + 3 > r[0] && rect[1] < r[1] + r[3] + 2 && rect[1] + rect[3] + 2 > r[1];
      if (this.reserved.some(overlaps)) continue; // never cover the on-globe controls
      const hit = placed.some(overlaps);
      if (hit && !important) continue;
      if (rect[0] < 2 || rect[0] + lw > this.w - 2 || rect[1] < 2) continue;
      placed.push(rect);
      shown.add(s.iso3);
      L.el.style.display = 'block';
      L.el.style.transform = `translate(${Math.round(rect[0])}px,${Math.round(rect[1])}px)`;
      L.el.style.outline = s.iso3 === this.selected ? `1px solid ${GLOBE.selection}` : 'none';
    }
    for (const [iso, L] of this.labels) if (!shown.has(iso)) L.el.style.display = 'none';
  }

  // ----------------------------------------------------------------------------------------------
  // Picking: markers in screen space (front side only), then the country under the pointer.

  pick(x: number, y: number, touch: boolean): string | null {
    const cam = this.camVec();
    let best: string | null = null;
    let bestD = touch ? 24 : 14;
    for (const [iso, s] of this.specs) {
      const i = this.slotOf.get(iso);
      if (i == null) continue;
      const n = this.normals[i];
      if (!facesCamera([n.x, n.y, n.z], cam, 0.01)) continue;
      const [ax, ay] = this.project([n.x, n.y, n.z]);
      const [bx, by] = this.project(lonLatToVec3(s.lon, s.lat, 1 + this.cur[i] * H_MAX));
      const dx = bx - ax;
      const dy = by - ay;
      const L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d < bestD) {
        bestD = d;
        best = iso;
      }
    }
    if (best) return best;
    const ndc = new Vector3((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1, 0.5).unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const hit = raySphere(cam, [dir.x, dir.y, dir.z]);
    if (!hit) return null;
    const lon = (Math.atan2(hit[0], hit[2]) * 180) / Math.PI;
    const lat = (Math.asin(Math.max(-1, Math.min(1, hit[1]))) * 180) / Math.PI;
    return countryAt(this.o.shapes, lon, lat);
  }

  // ----------------------------------------------------------------------------------------------
  // Input

  private local(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private degPerPx() {
    // on-screen globe radius in px; near the centre one px of drag ≈ 1/R radians of surface
    const R = this.h / 2 / (Math.tan(((FOV / 2) * Math.PI) / 180) * Math.sqrt(Math.max(0.05, this.dist * this.dist - 1)));
    return (180 / Math.PI / R) * 0.95;
  }

  private onDown = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.engaged = true;
    this.flight = null;
    this.vel = { lon: 0, lat: 0 };
    if (this.pointers.size === 1) {
      this.drag = { x: p.x, y: p.y, moved: 0, t: performance.now(), type: e.pointerType, dx: 0, dy: 0, scroll: false, decided: false };
      this.lastMove = { x: p.x, y: p.y, t: performance.now() };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.drag) this.drag.moved = 99; // a pinch is never a tap
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is optional */
    }
  };

  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    if (!this.pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') this.queueHover(p.x, p.y);
      return;
    }
    const prev = this.pointers.get(e.pointerId)!;
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0) this.zoomBy(this.pinch / d);
      this.pinch = d;
      this.o.callbacks.onInteract();
      return;
    }
    if (!this.drag) return;
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    this.drag.moved += Math.abs(dx) + Math.abs(dy);
    this.drag.dx += dx;
    this.drag.dy += dy;
    if (this.drag.moved < 4) return;
    // Touch: the first movement decides. A mostly vertical gesture belongs to the page (the
    // browser scrolls it, see touch-action: pan-y) and never rotates the globe.
    if (this.drag.type === 'touch' && !this.drag.decided) {
      this.drag.decided = true;
      this.drag.scroll = Math.abs(this.drag.dy) > Math.abs(this.drag.dx);
    }
    if (this.drag.scroll) return;
    const k = this.degPerPx();
    this.lon -= dx * k;
    this.lat = Math.max(LAT_MIN, Math.min(LAT_MAX, this.lat + dy * k));
    const now = performance.now();
    const dt = Math.max(8, now - this.lastMove.t);
    const cap = (v: number) => Math.max(-3, Math.min(3, v));
    this.vel = { lon: cap(((-dx * k) / dt) * 16), lat: cap(((dy * k) / dt) * 16) };
    this.lastMove = { x: p.x, y: p.y, t: now };
    this.canvas.style.cursor = 'grabbing';
    this.hideTooltip();
    this.o.callbacks.onInteract();
    this.requestRender();
  };

  private onUp = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const d = this.drag;
    if (this.pointers.size === 0) this.drag = null;
    this.canvas.style.cursor = 'grab';
    if (d && d.moved < 6 && performance.now() - d.t < 600) {
      this.vel = { lon: 0, lat: 0 };
      const iso = this.pick(p.x, p.y, d.type !== 'mouse');
      if (iso && this.o.covered.has(iso)) this.o.callbacks.onSelect(iso);
      return;
    }
    if (this.o.reducedMotion || performance.now() - this.lastMove.t > 80) this.vel = { lon: 0, lat: 0 };
    this.requestRender();
  };

  private onCancel = (e: PointerEvent) => {
    // e.g. the browser took over a vertical touch drag to scroll the page
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.drag = null;
    this.pinch = null;
    this.vel = { lon: 0, lat: 0 };
  };

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    this.engaged = false;
    this.hideTooltip();
    if (this.hovered) this.o.callbacks.onHover(null);
  };

  private onWheel = (e: WheelEvent) => {
    // Ordinary page scrolling passes through until the user has clicked or dragged the globe.
    if (!this.engaged && !e.ctrlKey && !e.metaKey) {
      this.o.callbacks.onWheelHint();
      return;
    }
    e.preventDefault();
    this.zoomBy(Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.004));
    this.o.callbacks.onInteract();
  };

  private queueHover(x: number, y: number) {
    this.hoverAt = { x, y };
    if (this.hoverQueued) return;
    this.hoverQueued = true;
    requestAnimationFrame(() => {
      this.hoverQueued = false;
      if (this.disposed || this.drag) return;
      const { x: hx, y: hy } = this.hoverAt;
      const iso = this.pick(hx, hy, false);
      const covered = !!iso && this.o.covered.has(iso);
      this.canvas.style.cursor = covered ? 'pointer' : 'grab';
      if (iso) {
        this.tooltip.innerHTML = this.o.callbacks.describe(iso);
        this.tooltip.style.display = 'block';
        const tw = this.tooltip.offsetWidth;
        const th = this.tooltip.offsetHeight;
        const tx = hx + 14 + tw > this.w ? hx - 14 - tw : hx + 14;
        const ty = Math.max(4, Math.min(this.h - th - 4, hy - th / 2));
        this.tooltip.style.transform = `translate(${Math.round(tx)}px,${Math.round(ty)}px)`;
      } else this.hideTooltip();
      const next = covered ? iso : null;
      if (next !== this.hovered) this.o.callbacks.onHover(next);
    });
  }

  private hideTooltip() {
    this.tooltip.style.display = 'none';
  }

  private onLost = (e: Event) => {
    if (this.disposed) return;
    e.preventDefault();
    this.lost = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.o.callbacks.onContextLost();
  };

  private onRestored = () => {
    if (this.disposed) return;
    this.o.callbacks.onContextRestored();
  };
}
