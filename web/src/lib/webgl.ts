// WebGL capability check for choosing the explorer's default view. Tiny and library-free, so it
// can run in the main bundle without loading Three.js.
export type WebGLSupport = 'full' | 'software' | 'none';

let cached: WebGLSupport | null = null;

function probe(opts?: WebGLContextAttributes): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2', opts) ?? c.getContext('webgl', opts)) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // release the probe context immediately
    return true;
  } catch {
    return false;
  }
}

/** 'full' = hardware WebGL; 'software' = WebGL only with a major performance caveat; 'none'. */
export function webglSupport(): WebGLSupport {
  if (cached) return cached;
  cached = typeof document === 'undefined' || !probe() ? 'none' : probe({ failIfMajorPerformanceCaveat: true }) ? 'full' : 'software';
  return cached;
}

export type ExplorerView = '3d' | '2d';
const KEY = 'wa-explorer-view';

export function storedView(): ExplorerView | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === '3d' || v === '2d' ? v : null;
  } catch {
    return null;
  }
}

export function storeView(v: ExplorerView) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* per-viewer convenience only */
  }
}

/**
 * Default view: the 3D globe where hardware WebGL is available on a device that is not low-end
 * (≤ 2 GB memory or ≤ 2 CPU cores where the browser reports them); otherwise the 2D map.
 * A choice the visitor made earlier on this device wins (3D only while WebGL is available).
 */
export function initialView(support: WebGLSupport, opts: { lowEnd: boolean }): ExplorerView {
  if (support === 'none') return '2d';
  const stored = storedView();
  if (stored) return stored;
  if (support === 'software' || opts.lowEnd) return '2d';
  return '3d';
}

export function isLowEndDevice(): boolean {
  const n = navigator as Navigator & { deviceMemory?: number };
  return (n.deviceMemory != null && n.deviceMemory <= 2) || (n.hardwareConcurrency != null && n.hardwareConcurrency > 0 && n.hardwareConcurrency <= 2);
}
