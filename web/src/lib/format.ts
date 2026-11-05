const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtInt = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '—' : nf0.format(v));
export const fmt1 = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '—' : nf1.format(v));
export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(digits)}%`;
export const fmtSignedPct = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v * 100).toFixed(digits)}%`;
export const fmtSignedInt = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${nf0.format(Math.abs(v))}`;
export const fmtPp = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v * 100).toFixed(1)} pp`;
export const fmtDays = (v: number | null | undefined) => (v == null ? '—' : `${nf0.format(v)} days`);
