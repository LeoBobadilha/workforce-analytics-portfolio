import { AlarmClock, BriefcaseBusiness, CheckCircle2, Gauge, Target, Timer } from 'lucide-react';
import { useMemo } from 'react';
import { EChart } from '../charts/EChart';
import { bars, donut, foot, row } from '../charts/options';
import { C, OUTCOME_COLOR, SLOT } from '../charts/theme';
import { DataTable, type Column } from '../components/DataTable';
import { Layout } from '../components/Layout';
import { Badge, ChartCard, KpiCard, ValueLegend } from '../components/ui';
import type { Vacancy } from '../data/types';
import { fmtDay, fmtMonthShort } from '../lib/dates';
import { fmtInt, fmtPct, fmtPp, fmtSignedInt } from '../lib/format';
import { closedIn, computeKpis, durationDays, isFilled, isOpenAt, mean, ratio, vacanciesFor } from '../lib/metrics';
import { useApp } from '../state/AppData';

const GRADES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
const OUTCOMES = ['National Recruitment', 'External Recruitment', 'Internal Mobility', 'Cancelled Position'];
const CANDIDATES = ['External Candidate', 'Ongoing Staff', 'Former Staff'];

interface OpenRow extends Vacancy {
  age: number;
  due: boolean;
}

export default function Recruitment() {
  const { model, filters, p, labels } = useApp();

  const d = useMemo(() => {
    const k = computeKpis(model, filters);
    const kPrev = p.prevD != null ? computeKpis(model, { ...filters, from: filters.from - 12, to: filters.to - 12 }) : null;
    const vs = vacanciesFor(model, filters);
    const monthly = p.monthEnds.map((day) => {
      const o = vs.filter((v) => isOpenAt(v, day));
      return { np: o.filter((v) => v.position_type === 'New Position').length, rp: o.filter((v) => v.position_type === 'Replacement').length, due: o.filter((v) => v.planned_close_date < day).length };
    });
    const closed = closedIn(vs, p.P0, p.D);
    const filled = closed.filter(isFilled);
    const opened = vs.filter((v) => v.opened_date >= p.P0 && v.opened_date <= p.D);
    const durBy = (key: (v: Vacancy) => string, keys?: string[]) => {
      const m = new Map<string, Vacancy[]>();
      for (const v of filled) {
        const kk = key(v);
        m.set(kk, [...(m.get(kk) ?? []), v]);
      }
      const ks = keys ? keys.filter((x) => m.has(x)) : [...m.keys()];
      return ks
        .map((x) => ({ key: x, n: m.get(x)!.length, actual: mean(m.get(x)!.map(durationDays)) as number, planned: mean(m.get(x)!.map((v) => v.planned_close_date - v.opened_date)) as number }))
        .sort((a, b) => (keys ? 0 : b.actual - a.actual));
    };
    const byCountry = durBy((v) => v.country);
    const byGrade = durBy((v) => v.grade, GRADES);
    const outcomes = OUTCOMES.map((o) => ({ o, n: closed.filter((v) => v.outcome === o).length, dur: mean(closed.filter((v) => v.outcome === o && o !== 'Cancelled Position').map(durationDays)) }));
    const cands = CANDIDATES.map((c) => ({ c, n: filled.filter((v) => v.candidate_type === c).length, dur: mean(filled.filter((v) => v.candidate_type === c).map(durationDays)) }));
    const types = (['New Position', 'Replacement'] as const).map((t) => ({ t, n: opened.filter((v) => v.position_type === t).length }));
    const funnel = [
      { s: 'Applicants', n: filled.reduce((a, v) => a + v.applicants, 0) },
      { s: 'Shortlisted', n: filled.reduce((a, v) => a + v.shortlisted, 0) },
      { s: 'Interviewed', n: filled.reduce((a, v) => a + v.interviewed, 0) },
      { s: 'Offers made', n: filled.reduce((a, v) => a + v.offers, 0) },
      { s: 'Hired', n: filled.length },
    ];
    const openRows: OpenRow[] = vs.filter((v) => isOpenAt(v, p.D)).map((v) => ({ ...v, age: p.D - v.opened_date, due: v.planned_close_date < p.D }));
    const plannedAvg = mean(opened.map((v) => v.planned_close_date - v.opened_date));
    const durs = filled.map(durationDays).sort((a, b) => a - b);
    const median = durs.length ? durs[Math.floor(durs.length / 2)] : null;
    return { k, kPrev, monthly, closed, filled, opened, byCountry, byGrade, outcomes, cands, types, funnel, openRows, plannedAvg, median };
  }, [model, filters, p]);

  const { k, kPrev } = d;
  const months = p.months.map(fmtMonthShort);
  const vsPrev = labels.prevYear ? `vs ${labels.prevYear}` : 'no prior-year baseline';
  const ppDelta = (a: number | null, b: number | null | undefined, pol: 'up-good' | 'up-bad') =>
    a != null && b != null ? { value: a - b, text: fmtPp(a - b), caption: vsPrev, polarity: pol } : undefined;

  const durationTooltip = (rows: { key: string; n: number; actual: number; planned: number }[]) => (i: number) =>
    foot(`${fmtInt(rows[i].n)} positions filled · ${rows[i].actual > rows[i].planned ? `${Math.round(rows[i].actual - rows[i].planned)} days over plan` : 'within plan'}`);

  const columns: Column<OpenRow>[] = [
    { key: 'id', header: 'Vacancy', value: (r) => r.vacancy_id, render: (r) => <span className="font-medium text-ink">{r.vacancy_id}</span> },
    { key: 'title', header: 'Position', value: (r) => r.position_title },
    { key: 'country', header: 'Country', value: (r) => r.country },
    { key: 'cat', header: 'Category', value: (r) => r.staff_category },
    { key: 'grade', header: 'Grade', value: (r) => r.grade, align: 'center' },
    { key: 'type', header: 'Opening', value: (r) => r.position_type },
    { key: 'opened', header: 'Opened', value: (r) => r.opened_date, render: (r) => fmtDay(r.opened_date) },
    { key: 'duedate', header: 'Due date', value: (r) => r.planned_close_date, render: (r) => fmtDay(r.planned_close_date) },
    { key: 'age', header: 'Days open', value: (r) => r.age, align: 'right' },
    { key: 'status', header: 'Status', value: (r) => (r.due ? 'Overdue' : 'On track'), render: (r) => (r.due ? <Badge tone="warn"><AlarmClock size={11} />Overdue</Badge> : <Badge tone="good"><CheckCircle2 size={11} />On track</Badge>) },
    { key: 'src', header: 'Source', value: (r) => r.source },
  ];

  return (
    <Layout title="Recruitment & Vacancies" description="Vacancy stock, vacancy and due-vacancy rates, recruitment duration to close, closure outcomes and the recruitment funnel — consolidated from JIRA (2025+) and the historical Excel vacancy tracker.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard icon={BriefcaseBusiness} label="Open Vacancies" value={fmtInt(k.open_vacancies)}
          delta={kPrev ? { value: k.open_vacancies - kPrev.open_vacancies, text: fmtSignedInt(k.open_vacancies - kPrev.open_vacancies), caption: vsPrev, polarity: 'up-bad' } : undefined}
          spark={d.monthly.map((m) => m.np + m.rp)} sub={`Open on ${labels.asOf}`}
          info="Vacancies opened on or before the reporting date and not yet closed (closed date after the reporting date or empty)." />
        <KpiCard icon={Gauge} tone="burgundy" label="Vacancy Rate" value={fmtPct(k.vacancy_rate)} delta={ppDelta(k.vacancy_rate, kPrev?.vacancy_rate, 'up-bad')}
          sub={`${fmtInt(k.open_vacancies)} open ÷ ${fmtInt(k.headcount + k.open_vacancies)} positions`}
          info="Numerator: open vacancies on the reporting date. Denominator: total positions = active headcount + open vacancies on the same date, same filters." />
        <KpiCard icon={AlarmClock} label="Due Vacancy Rate" value={fmtPct(k.due_vacancy_rate)} delta={ppDelta(k.due_vacancy_rate, kPrev?.due_vacancy_rate, 'up-bad')}
          sub={`${fmtInt(d.openRows.filter((r) => r.due).length)} vacancies past their due date`}
          info="Numerator: open vacancies whose due date (initially planned closure) has already passed on the reporting date. Denominator: same total positions as the vacancy rate." />
        <KpiCard icon={Timer} tone="burgundy" label="Average Time to Hire" value={fmtInt(k.avg_time_to_hire_days)} unit="days"
          delta={k.avg_time_to_hire_days != null && kPrev?.avg_time_to_hire_days != null ? { value: k.avg_time_to_hire_days - kPrev.avg_time_to_hire_days, text: `${fmtSignedInt(Math.round(k.avg_time_to_hire_days - kPrev.avg_time_to_hire_days))} days`, caption: 'vs prior-year period', polarity: 'up-bad' } : undefined}
          sub={`Median ${fmtInt(d.median)} · planned ${fmtInt(d.plannedAvg)} days`}
          info="Duration to close = closed date − opened date, averaged over vacancies filled (not cancelled) in the period. Records with invalid dates are excluded. Distinct from JIRA's operational time_to_done_hours, which also includes onboarding admin." />
        <KpiCard icon={CheckCircle2} label="Positions Filled" value={fmtInt(k.positions_filled)} sub={`Closed with a hire in ${labels.period}`}
          info="Vacancies closed in the period with outcome National Recruitment, External Recruitment or Internal Mobility." />
        <KpiCard icon={Target} tone="burgundy" label="Recruitment Success Rate" value={fmtPct(k.recruitment_success_rate)}
          delta={ppDelta(k.recruitment_success_rate, kPrev?.recruitment_success_rate, 'up-good')}
          sub={`${fmtInt(d.closed.length - d.filled.length)} positions cancelled`}
          info="Vacancies closed with a hire ÷ all vacancies closed in the period (hires + cancelled positions)." />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <ChartCard className="xl:col-span-8" title="Monthly Open Vacancies" subtitle={`Vacancies open at each month-end by opening type · ${labels.period}`}
          info="Stock of open vacancies on the last day of each month. Tooltip shows how many were already past their due date." empty={!d.monthly.some((m) => m.np + m.rp)}>
          <EChart height={300} label="Monthly open vacancies"
            option={bars({
              categories: months,
              stack: true,
              total: true,
              fmt: fmtInt,
              barMax: 16,
              series: [
                { name: 'Replacement', color: C.burgundy, data: d.monthly.map((m) => m.rp) },
                { name: 'New Position', color: C.teal, data: d.monthly.map((m) => m.np) },
              ],
              extra: (i) => `<div style="color:#64748B;margin-top:4px">of which overdue: <b style="color:#19232D">${d.monthly[i].due}</b></div>`,
            })} />
        </ChartCard>
        <ChartCard className="xl:col-span-4" title="Recruitment Funnel" subtitle={`Vacancies filled in ${labels.period}`} empty={!d.filled.length}
          info="Candidate pipeline aggregated over vacancies filled in the period: applicants → shortlisted → interviewed → offers → hired. Tooltip shows stage conversion.">
          <EChart height={300} label="Recruitment funnel"
            option={{
              ...bars({ categories: d.funnel.map((f) => f.s), horizontal: true, labels: true, fmt: fmtInt, barMax: 26, legend: false, series: [{ name: 'Candidates', color: C.teal, data: d.funnel.map((f) => f.n) }],
                tooltipValue: (_s, i) => fmtInt(d.funnel[i].n),
                extra: (i) => (i ? foot(`Conversion from ${d.funnel[i - 1].s.toLowerCase()} <b style="float:right;margin-left:12px;color:#19232D">${fmtPct(ratio(d.funnel[i].n, d.funnel[i - 1].n))}</b>`) : '') }),
              series: [{
                type: 'bar', name: 'Candidates', barMaxWidth: 26,
                data: d.funnel.map((f, i) => ({ value: f.n, itemStyle: { color: ['#5DB5A9', '#3AA597', '#1E9A8D', '#127A70', '#0B5B53'][i], borderRadius: [0, 4, 4, 0] } })),
                label: { show: true, position: 'right', color: C.ink2, fontSize: 11, fontWeight: 600, formatter: (q: { value: unknown }) => fmtInt(Number(q.value)) },
              }],
            }} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard title="Recruitment Duration by Country" subtitle={`Average days to close vs initially planned duration · filled in ${labels.period}`} empty={!d.byCountry.length}
          info="Actual = closed − opened; Planned = due date − opened (initial planned duration). Averages over vacancies filled in the period.">
          <EChart height={Math.max(280, d.byCountry.length * 26 + 60)} label="Recruitment duration by country"
            option={bars({
              categories: d.byCountry.map((r) => r.key), horizontal: true, barMax: 9, fmt: (v) => `${Math.round(v)} days`, axisFmt: (v) => `${v}`,
              series: [{ name: 'Planned', color: C.prev, data: d.byCountry.map((r) => r.planned) }, { name: 'Actual', color: C.teal, data: d.byCountry.map((r) => r.actual) }],
              extra: durationTooltip(d.byCountry),
            })} />
        </ChartCard>
        <div className="grid gap-5">
          <ChartCard title="Recruitment Duration by Grade" subtitle={`Average days to close · filled in ${labels.period}`} empty={!d.byGrade.length}
            info="Average duration to close by grade of the position, against the initially planned duration.">
            <EChart height={250} label="Recruitment duration by grade"
              option={bars({
                categories: d.byGrade.map((r) => r.key), fmt: (v) => `${Math.round(v)} days`, axisFmt: (v) => `${v}`, barMax: 22,
                series: [{ name: 'Planned', color: C.prev, data: d.byGrade.map((r) => r.planned) }, { name: 'Actual', color: C.teal, data: d.byGrade.map((r) => r.actual) }],
                extra: durationTooltip(d.byGrade),
              })} />
          </ChartCard>
          <ChartCard title="Internal vs External Recruitment" subtitle={`Positions filled by candidate type · ${labels.period}`} empty={!d.filled.length}
            info="Hires by candidate type: external candidates, ongoing staff (internal mobility) and former staff (rehires). Tooltip shows average duration to close.">
            <EChart height={190} label="Internal versus external recruitment"
              option={bars({
                categories: d.cands.map((c) => c.c), horizontal: true, labels: true, fmt: fmtInt, barMax: 20, legend: false,
                series: [{ name: 'Positions filled', color: C.teal, data: d.cands.map((c) => c.n) }],
                extra: (i) => row(C.prev, 'Avg. duration to close', `${fmtInt(d.cands[i].dur)} days`) + row(C.prev, 'Share of hires', fmtPct(ratio(d.cands[i].n, d.filled.length))),
              })} />
          </ChartCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard title="New Position vs Replacement" subtitle={`Vacancies opened in ${labels.period}`} empty={!d.opened.length}
          info="Openings split between newly created positions and replacements of departing or moving staff.">
          <div className="grid items-center gap-4 sm:grid-cols-2">
            <EChart height={210} label="New position versus replacement" option={donut(d.types.map((t, i) => ({ name: t.t, value: t.n, color: SLOT[i] })), { value: fmtInt(d.opened.length), label: 'opened' })} />
            <ValueLegend items={d.types.map((t, i) => ({ name: t.t, color: SLOT[i], value: fmtInt(t.n), share: fmtPct(ratio(t.n, d.opened.length)) }))} />
          </div>
        </ChartCard>
        <ChartCard title="Vacancy Closure Outcomes" subtitle={`Vacancies closed in ${labels.period}`} empty={!d.closed.length}
          info="How vacancies were closed: National Recruitment, External Recruitment, Internal Mobility or Cancelled Position (labels standardised across JIRA and the Excel tracker).">
          <EChart height={210} label="Vacancy closure outcomes"
            option={{
              ...bars({ categories: d.outcomes.map((o) => o.o), horizontal: true, labels: true, fmt: fmtInt, barMax: 20, legend: false, series: [{ name: 'Vacancies', color: C.teal, data: d.outcomes.map((o) => o.n) }],
                extra: (i) => row(C.prev, 'Share of closures', fmtPct(ratio(d.outcomes[i].n, d.closed.length))) + (d.outcomes[i].dur != null ? row(C.prev, 'Avg. duration', `${fmtInt(d.outcomes[i].dur)} days`) : '') }),
              series: [{
                type: 'bar', name: 'Vacancies', barMaxWidth: 20,
                data: d.outcomes.map((o) => ({ value: o.n, itemStyle: { color: OUTCOME_COLOR[o.o], borderRadius: [0, 4, 4, 0] } })),
                label: { show: true, position: 'right', color: C.ink2, fontSize: 11, fontWeight: 600 },
              }],
            }} />
        </ChartCard>
      </div>

      <ChartCard title="Open Vacancies" subtitle={`${fmtInt(d.openRows.length)} vacancies open on ${labels.asOf} · sortable and searchable`}
        info="Record-level list of open vacancies. 'Overdue' = due date (initially planned closure) already passed.">
        <DataTable caption="Open vacancies" rows={d.openRows} columns={columns} rowKey={(r) => r.vacancy_id} initialSort={{ key: 'age', dir: 'desc' }} pageSize={10}
          searchPlaceholder="Search vacancy, position, country…" />
      </ChartCard>
    </Layout>
  );
}
