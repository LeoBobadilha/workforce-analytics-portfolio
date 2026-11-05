// Dates are stored as integer "epoch days" (days since 1970-01-01, UTC).
// Months are integer indexes: year * 12 + (month - 1).

export const DAY_MS = 86_400_000;

export const dayOf = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);

export const monthIndex = (y: number, m: number) => y * 12 + (m - 1);

export const monthYear = (mi: number) => ({ y: Math.floor(mi / 12), m: (mi % 12) + 1 });

/** Last calendar day of a month index (epoch day). */
export const monthEndDay = (mi: number) => {
  const { y, m } = monthYear(mi);
  return Math.round(Date.UTC(y, m, 0) / DAY_MS);
};

export const monthStartDay = (mi: number) => {
  const { y, m } = monthYear(mi);
  return dayOf(y, m, 1);
};

export const monthOfDay = (day: number) => {
  const dt = new Date(day * DAY_MS);
  return monthIndex(dt.getUTCFullYear(), dt.getUTCMonth() + 1);
};

export const parseYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return monthIndex(y, m);
};

export const parseIsoDay = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return dayOf(y, m, d);
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const fmtMonth = (mi: number) => {
  const { y, m } = monthYear(mi);
  return `${MONTHS[m - 1]} ${y}`;
};

export const fmtMonthShort = (mi: number) => {
  const { y, m } = monthYear(mi);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
};

export const fmtMonthLong = (mi: number) => {
  const { y, m } = monthYear(mi);
  return `${MONTHS_LONG[m - 1]} ${y}`;
};

export const fmtDay = (day: number | null | undefined) => {
  if (day == null) return '—';
  const dt = new Date(day * DAY_MS);
  return `${String(dt.getUTCDate()).padStart(2, '0')} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
};

export const quarterLabel = (mi: number) => {
  const { y, m } = monthYear(mi);
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
};

export const range = (a: number, b: number) => {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
};
