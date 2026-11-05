import type { Category } from '../data/types';

/**
 * Categorical palette (fixed order, validated with the dataviz palette validator on #FFFFFF:
 * lightness band, chroma floor, adjacent-pair CVD ΔE ≥ 8, normal-vision ΔE ≥ 15).
 * Amber sits below 3:1 contrast, so every chart ships tooltips + direct labels or a table.
 */
export const SLOT = ['#0A9A8B', '#9B4C76', '#E0A030', '#3B6DB3', '#D7774F'] as const;

export const C = {
  teal: SLOT[0],
  burgundy: SLOT[1],
  amber: SLOT[2],
  blue: SLOT[3],
  coral: SLOT[4],
  prev: '#C5CED9', // comparison / de-emphasis (previous year, planned)
  unknown: '#D5DBE3',
  ink: '#19232D',
  ink2: '#334155',
  muted: '#64748B',
  grid: '#EDF0F4',
  axis: '#CBD5E1',
  surface: '#FFFFFF',
};

export const CATEGORY_COLOR: Record<Category, string> = {
  'National Staff': C.teal,
  'International Staff': C.burgundy,
  'Global non-HQ Staff': C.amber,
  'HQ Staff': C.blue,
};

export const GROUP_COLOR: Record<string, string> = {
  'Global South': C.teal,
  'Global North': C.burgundy,
  'Not recorded': C.unknown,
};

export const GENDER_COLOR: Record<string, string> = { Female: C.teal, Male: C.burgundy, 'Not recorded': C.unknown };

export const CONTRACT_COLOR: Record<string, string> = {
  'Fixed-Term': C.teal,
  'Open-Ended': C.burgundy,
  'Short-Term': C.amber,
};

export const OUTCOME_COLOR: Record<string, string> = {
  'National Recruitment': C.teal,
  'External Recruitment': C.burgundy,
  'Internal Mobility': C.amber,
  'Cancelled Position': C.blue,
};

export const FONT = "'Inter Variable', 'Segoe UI', system-ui, sans-serif";
