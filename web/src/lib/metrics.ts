/**
 * KPI engine. Every indicator is derived on the fly from the same record-level model
 * (contracts, separations, vacancies, surges, appraisals) so that filters always act on one
 * consistent base. Definitions mirror pipeline/kpis.py (validated by src/lib/metrics.test.ts)
 * and are documented in docs/KPI_DEFINITIONS.md.
 */
import type { Category, Contract, Model, Separation, Surge, Vacancy } from '../data/types';
import { monthEndDay, monthStartDay, range } from './dates';

export interface Filters {
  from: number; // month index (inclusive)
  to: number; // month index (inclusive)
  country: string | null;
  category: Category | null;
}

export const INTERNATIONAL_SCOPE: Category[] = ['HQ Staff', 'Global non-HQ Staff', 'International Staff'];
export const GLOBAL_CATEGORIES: Category[] = ['HQ Staff', 'Global non-HQ Staff'];

export const daysToYears = (d: number) => d / 365.25;
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const ratio = (a: number, b: number) => (b ? a / b : null);

export interface Period {
  D: number; // period end (last day of `to` month)
  P0: number; // period start (first day of `from` month)
  prevD: number | null; // same month-end one year earlier (null if before simulated history)
  monthEnds: number[];
  months: number[];
}

export function period(m: Model, f: Filters): Period {
  const prev = monthEndDay(f.to - 12);
  return {
    D: monthEndDay(f.to),
    P0: monthStartDay(f.from),
    prevD: prev >= m.simStartDay ? prev : null,
    months: range(f.from, f.to),
    monthEnds: range(f.from, f.to).map(monthEndDay),
  };
}

// ------------------------------------------------------------------ filtered record sets
const matchCC = (f: Pick<Filters, 'country' | 'category'>, country: string, category: Category | null) =>
  (!f.country || country === f.country) && (!f.category || category === f.category);

const activeCache = new WeakMap<Model, Map<string, Contract[]>>();

/** Contracts active on day d (start <= d <= end), filtered by country / staff category. One per employee. */
export function activeAt(m: Model, d: number, f: Pick<Filters, 'country' | 'category'>): Contract[] {
  let cache = activeCache.get(m);
  if (!cache) activeCache.set(m, (cache = new Map()));
  const key = `${d}|${f.country ?? ''}|${f.category ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: Contract[] = [];
  for (const c of m.contracts) {
    if (c.start_date <= d && c.endN >= d && matchCC(f, c.country, c.staff_category)) out.push(c);
  }
  cache.set(key, out);
  return out;
}

export const vacanciesFor = (m: Model, f: Pick<Filters, 'country' | 'category'>): Vacancy[] =>
  m.vacancies.filter((v) => v.dq_valid === 1 && matchCC(f, v.country, v.staff_category));

export const separationsFor = (m: Model, f: Filters, P0: number, D: number): Separation[] =>
  m.separations.filter((s) => s.exit_date >= P0 && s.exit_date <= D && matchCC(f, s.country, s.staff_category));

/** Surges: the country filter applies to the requesting country office; staff category is not applicable. */
export const surgesFor = (m: Model, f: Filters, P0: number, D: number): Surge[] =>
  m.surges.filter((s) => s.request_date >= P0 && s.request_date <= D && (!f.country || s.country === f.country));

export const isOpenAt = (v: Vacancy, d: number) => v.opened_date <= d && (v.closed_date == null || v.closed_date > d);

export const closedIn = (vs: Vacancy[], P0: number, D: number) =>
  vs.filter((v) => v.closed_date != null && v.closed_date >= P0 && v.closed_date <= D);

export const isFilled = (v: Vacancy) => v.outcome != null && v.outcome !== 'Cancelled Position';

export const durationDays = (v: Vacancy) => (v.closed_date as number) - v.opened_date;

/** Scope used for the Global South / Global North ratio: international workforce unless a category is selected. */
export const diversityScope = (a: Contract[], f: Filters) =>
  f.category ? a : a.filter((c) => INTERNATIONAL_SCOPE.includes(c.staff_category));

export const gsShare = (cs: Contract[]) => {
  let gs = 0;
  let gn = 0;
  for (const c of cs) {
    if (c.emp.nationality_group === 'Global South') gs++;
    else if (c.emp.nationality_group === 'Global North') gn++;
  }
  return { gs, gn, share: ratio(gs, gs + gn) };
};

export const femaleShare = (cs: Contract[]) => {
  let fm = 0;
  let ml = 0;
  for (const c of cs) {
    if (c.emp.gender === 'Female') fm++;
    else if (c.emp.gender === 'Male') ml++;
  }
  return ratio(fm, fm + ml);
};

export const averageAge = (cs: Contract[], d: number) =>
  mean(cs.filter((c) => c.emp.birth_date != null).map((c) => daysToYears(d - (c.emp.birth_date as number))));

export const isExpat = (c: Contract) => c.emp.nationality != null && c.emp.nationality !== c.country;

export const tenureStart = (c: Contract, d: number) =>
  c.emp.latest_hire_date <= d ? c.emp.latest_hire_date : c.emp.first_hire_date;

export const plannedDurationMonths = (c: Contract) =>
  c.planned_end_date == null ? null : (c.planned_end_date - c.start_date + 1) / 30.4375;

export function retentionRate(m: Model, f: Filters, d: number): number | null {
  const prev = monthEndDay(monthOfDayIndex(d) - 12);
  if (prev < m.simStartDay) return null;
  const cohort = activeAt(m, prev, f);
  if (!cohort.length) return null;
  const still = new Set(activeAt(m, d, { country: null, category: null }).map((c) => c.employee_id));
  return cohort.filter((c) => still.has(c.employee_id)).length / cohort.length;
}

function monthOfDayIndex(d: number) {
  const dt = new Date(d * 86_400_000);
  return dt.getUTCFullYear() * 12 + dt.getUTCMonth();
}

export function appraisalCompletion(m: Model, a: Contract[], D: number) {
  const done = new Set<string>();
  for (const x of m.appraisals) if (x.appraisal_date > D - 365 && x.appraisal_date <= D) done.add(x.employee_id);
  const eligible = a.filter((c) => D - tenureStart(c, D) >= 182);
  const completed = eligible.filter((c) => done.has(c.employee_id));
  return { eligible, completed, rate: ratio(completed.length, eligible.length) };
}

export const expiringWindowEnd = (f: Filters) => monthEndDay(f.to + 4);

export const isExpiring = (c: Contract, D: number, end: number) =>
  c.planned_end_date != null && c.planned_end_date >= D && c.planned_end_date <= end;

// ------------------------------------------------------------------ headline KPIs (parity with pipeline/kpis.py)
export interface Kpis {
  headcount: number;
  headcount_prev_year: number | null;
  headcount_growth_yoy: number | null;
  international_staff: number;
  national_staff: number;
  hq_staff: number;
  global_non_hq_staff: number;
  female_share: number | null;
  countries_of_operation: number;
  average_age: number | null;
  gs_share: number | null;
  expatriated_staff: number;
  open_vacancies: number;
  vacancy_rate: number | null;
  due_vacancy_rate: number | null;
  positions_filled: number;
  avg_time_to_hire_days: number | null;
  recruitment_success_rate: number | null;
  retention_rate: number | null;
  voluntary_exits: number;
  involuntary_exits: number;
  turnover_rate_annualised: number | null;
  average_tenure_years: number | null;
  appraisal_completion: number | null;
  contracts_expiring_4m: number;
  intl_expiring_share: number | null;
  avg_contract_duration_months: number | null;
  surge_requests: number;
  surge_national_share: number | null;
}

export function computeKpis(m: Model, f: Filters): Kpis {
  const { D, P0, prevD, monthEnds } = period(m, f);
  const a = activeAt(m, D, f);
  const aPrev = prevD != null ? activeAt(m, prevD, f) : null;
  const count = (cat: Category) => a.filter((c) => c.staff_category === cat).length;

  const vs = vacanciesFor(m, f);
  const open = vs.filter((v) => isOpenAt(v, D));
  const positions = a.length + open.length;
  const closed = closedIn(vs, P0, D);
  const filled = closed.filter(isFilled);

  const seps = separationsFor(m, f, P0, D);
  const avgHc = mean(monthEnds.map((d) => activeAt(m, d, f).length)) ?? 0;

  const winEnd = expiringWindowEnd(f);
  const expiring = a.filter((c) => isExpiring(c, D, winEnd));
  const intl = a.filter((c) => c.staff_category === 'International Staff');
  const fixed = a.filter((c) => c.planned_end_date != null);

  const sg = surgesFor(m, f, P0, D);
  const sgFilled = sg.filter((s) => s.status === 'Filled');

  return {
    headcount: a.length,
    headcount_prev_year: aPrev ? aPrev.length : null,
    headcount_growth_yoy: aPrev && aPrev.length ? a.length / aPrev.length - 1 : null,
    international_staff: count('International Staff'),
    national_staff: count('National Staff'),
    hq_staff: count('HQ Staff'),
    global_non_hq_staff: count('Global non-HQ Staff'),
    female_share: femaleShare(a),
    countries_of_operation: new Set(a.filter((c) => c.country !== m.meta.hq_country).map((c) => c.country)).size,
    average_age: averageAge(a, D),
    gs_share: gsShare(diversityScope(a, f)).share,
    expatriated_staff: a.filter(isExpat).length,
    open_vacancies: open.length,
    vacancy_rate: ratio(open.length, positions),
    due_vacancy_rate: ratio(open.filter((v) => v.planned_close_date < D).length, positions),
    positions_filled: filled.length,
    avg_time_to_hire_days: mean(filled.map(durationDays)),
    recruitment_success_rate: ratio(filled.length, closed.length),
    retention_rate: retentionRate(m, f, D),
    voluntary_exits: seps.filter((s) => s.exit_type === 'Voluntary').length,
    involuntary_exits: seps.filter((s) => s.exit_type === 'Involuntary').length,
    turnover_rate_annualised: avgHc ? (seps.length / avgHc) * (12 / monthEnds.length) : null,
    average_tenure_years: mean(a.map((c) => daysToYears(D - tenureStart(c, D)))),
    appraisal_completion: appraisalCompletion(m, a, D).rate,
    contracts_expiring_4m: expiring.length,
    intl_expiring_share: ratio(expiring.filter((c) => c.staff_category === 'International Staff').length, intl.length),
    avg_contract_duration_months: mean(fixed.map((c) => plannedDurationMonths(c) as number)),
    surge_requests: sg.length,
    surge_national_share: ratio(sgFilled.filter((s) => s.deployed_category === 'National Staff').length, sgFilled.length),
  };
}

// ------------------------------------------------------------------ grouping helpers
export function countBy<T>(xs: T[], key: (x: T) => string | null | undefined) {
  const out = new Map<string, number>();
  for (const x of xs) {
    const k = key(x) ?? 'Not recorded';
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

export function groupBy<T>(xs: T[], key: (x: T) => string) {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = out.get(k);
    if (arr) arr.push(x);
    else out.set(k, [x]);
  }
  return out;
}

export const sortDesc = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
