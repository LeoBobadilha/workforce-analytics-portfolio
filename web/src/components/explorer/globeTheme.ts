// Colours for the dark 3D globe scene. Kept free of any rendering library so the legend in the
// explorer chunk can share them without loading Three.js.
// Teal/burgundy were checked with the dataviz palette validator against the scene surface #0C1B30:
// contrast ≥ 3:1, deutan ΔE 13 and normal-vision ΔE 31. Direction is also shown with ▲ ▼ = glyphs.
import type { ChangeStatus } from '../../lib/geo';

export const GLOBE = {
  ocean: '#0C1B30',
  land: '#1A2D47',
  covered: '#1D4652',
  border: '#4C6A8C',
  coveredBorder: '#56B7AA',
  graticule: '#9FB4CC',
  atmosphere: '#4AA3D8',
  selection: '#8EF0E1',
  ink: '#E8EEF5',
};

export const GLOBE_STATUS: Record<ChangeStatus, { color: string; label: string; glyph: string; ring?: boolean }> = {
  growth: { color: '#38C0AD', label: 'Growth', glyph: '▲' },
  new: { color: '#38C0AD', label: 'New (no prior-year staff)', glyph: '▲' },
  reduction: { color: '#C24E88', label: 'Reduction', glyph: '▼' },
  unchanged: { color: '#8FA0B5', label: 'Unchanged', glyph: '=' },
  'no-baseline': { color: '#6F8299', label: 'No prior-year baseline (ring)', glyph: '–', ring: true },
};

export const RING_COLOR = '#C3D0E0';
