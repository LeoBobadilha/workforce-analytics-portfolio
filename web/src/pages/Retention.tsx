import { Award, CalendarClock, DoorOpen, LogOut, RefreshCcw, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { EChart } from '../charts/EChart';
import { bars, lines, row } from '../charts/options';
import { C, CATEGORY_COLOR } from '../charts/theme';
import { Layout } from '../components/Layout';
import { ChartCard, KpiCard } from '../components/ui';
import { CATEGORIES } from '../data/types';
import { fmtMonthShort, monthOfDay } from '../lib/dates';
import { fmt1, fmtInt, fmtPct, fmtPp, fmtSignedInt } from '../lib/format';
import { activeAt, appraisalCompletion, computeKpis, mean, ratio, retentionRate, separationsFor } from '../lib/metrics';
import { useApp } from '../state/AppData';

const DEPARTMENTS = ['Research & Assessment', 'GIS & Data Management', 'Field Operations', 'Programme Management', 'Finance & Compliance', 'HR & Administration', 'Logistics & IT'];
const REASONS: { r: string; t: 'Voluntary' | 'Involuntary' }[] = [
  { r: 'Resignation', t: 'Voluntary' },
  { r: 'Did not wish to renew', t: 'Voluntary' },
  { r: 'Retirement', t: 'Voluntary' },
  { r: 'Contract not renewed', t: 'Involuntary' },
  { r: 'End of project / funding', t: 'Involuntary' },
  { r: 'Dismissal', t: 'Involuntary' },
];

export default function Retention() {
  const { model, filters, p, labels } = useApp();

  const d = useMemo(() => {
    const k = computeKpis(model, filters);
    const kPrev = p.prevD != null ? computeKpis(model, { ...filters, from: filters.from - 12, to: filters.to - 12 }) : null;
    const seps = separationsFor(model, filters, p.P0, p.D);
    const monthIdx = new Map(p.months.map((m, i) => [m, i]));
    const vol = p.months.map(() => 0);
    const inv = p.months.map(() => 0);
    for (const s of seps) {
      const i = monthIdx.get(monthOfDay(s.exit_date));
      if (i == null) continue;
      if (s.exit_type === 'Voluntary') vol[i]++;
      else inv[i]++;
    }
    const retention = p.monthEnds.map((day) => retentionRate(model, filters, day));
    const hcByMonth = (f: typeof filters) => mean(p.monthEnds.map((day) => activeAt(model, day, f).length)) ?? 0;
    const annualise = 12 / p.months.length;
    const countries = [...new Set(activeAt(model, p.D, filters).map((c) => c.country))];
    const byCountry = countries
      .map((country) => {
        const f = { ...filters, country };
        const n = seps.filter((s) => s.country === country).length;
        const avg = hcByMonth(f);
        return { country, n, avg, rate: avg ? (n / avg) * annualise : null };
      })
      .filter((x) => x.avg >= 5)
      .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
    const byCat = CATEGORIES.map((cat) => {
      const n = seps.filter((s) => s.staff_category === cat).length;
      const avg = filters.category && filters.category !== cat ? 0 : hcByMonth({ ...filters, category: cat });
      const v = seps.filter((s) => s.staff_category === cat && s.exit_type === 'Voluntary').length;
      return { cat, n, v, avg, rate: avg ? (n / avg) * annualise : null };
    }).filter((x) => x.avg > 0);
    const reasons = REASONS.map((x) => ({ ...x, n: seps.filter((s) => s.exit_reason === x.r).length }));
    const a = activeAt(model, p.D, filters);
    const appr = DEPARTMENTS.map((dep) => {
      const r = appraisalCompletion(model, a.filter((c) => c.department === dep), p.D);
      return { dep, eligible: r.eligible.length, done: r.completed.length, rate: r.rate };
    }).filter((x) => x.eligible > 0);
    return { k, kPrev, seps, vol, inv, retention, byCountry, byCat, reasons, appr };
  }, [model, filters, p]);

  const { k, kPrev } = d;
  const months = p.months.map(fmtMonthShort);
  const vsPrev = labels.prevYear ? 'vs prior-year period' : 'no prior-year baseline';
  const pp = (a: number | null, b: number | null | undefined, pol: 'up-good' | 'up-bad', caption = vsPrev) =>
    a != null && b != null ? { value: a - b, text: fmtPp(a - b), caption, polarity: pol } : undefined;
  const cnt = (a: number, b: number | undefined) => (b == null ? undefined : { value: a - b, text: fmtSignedInt(a - b), caption: vsPrev, polarity: 'up-bad' as const });
  const tall = Math.max(260, d.byCountry.length * 22 + 40);

  return (
    <Layout title="Retention & Development" description="Staff retention, exits and turnover — voluntary vs involuntary — and performance appraisal completion for eligible staff.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard icon={ShieldCheck} label="Staff Retention Rate" value={fmtPct(k.retention_rate)}
          delta={pp(k.retention_rate, kPrev?.retention_rate, 'up-good', labels.prevYear ? `vs 12 months to ${labels.prevYear}` : '')}
          spark={d.retention} sub="12-month cohort retention at reporting date"
          info="Staff active on the same date one year earlier (in the current filter) who are still employed by the organisation on the reporting date ÷ that cohort. Internal moves count as retained." />
        <KpiCard icon={RefreshCcw} tone="burgundy" label="Annual Turnover Rate" value={fmtPct(k.turnover_rate_annualised)}
          delta={pp(k.turnover_rate_annualised, kPrev?.turnover_rate_annualised, 'up-bad')}
          sub={`${fmtInt(d.seps.length)} exits · annualised over ${p.months.length} months`}
          info="Separations in the period ÷ average month-end headcount in the period, annualised (× 12 ÷ number of months). Internal mobility is not a separation." />
        <KpiCard icon={DoorOpen} label="Voluntary Exits" value={fmtInt(k.voluntary_exits)} delta={cnt(k.voluntary_exits, kPrev?.voluntary_exits)}
          sub={`${fmtPct(ratio(k.voluntary_exits, d.seps.length))} of exits · resignations, non-renewal by staff, retirement`}
          info="Separations initiated by the staff member in the period: resignation, choosing not to renew, retirement." />
        <KpiCard icon={LogOut} tone="burgundy" label="Involuntary Exits" value={fmtInt(k.involuntary_exits)} delta={cnt(k.involuntary_exits, kPrev?.involuntary_exits)}
          sub={`${fmtPct(ratio(k.involuntary_exits, d.seps.length))} of exits · non-renewal, funding end, dismissal`}
          info="Separations initiated by the organisation in the period: contract not renewed, end of project / funding, dismissal." />
        <KpiCard icon={Award} label="Appraisal Completion" value={fmtPct(k.appraisal_completion)} delta={pp(k.appraisal_completion, kPrev?.appraisal_completion, 'up-good')}
          sub="Eligible staff appraised in the past 12 months"
          info="% of eligible staff (active on the reporting date with ≥ 6 months of continuous service) with an appraisal completed in the 12 months up to the reporting date (annual or end-of-probation)." />
        <KpiCard icon={CalendarClock} tone="burgundy" label="Average Tenure" value={fmt1(k.average_tenure_years)} unit="yrs"
          delta={k.average_tenure_years != null && kPrev?.average_tenure_years != null ? { value: k.average_tenure_years - kPrev.average_tenure_years, text: `${(k.average_tenure_years - kPrev.average_tenure_years).toFixed(1)} yrs`, caption: vsPrev, polarity: 'neutral' } : undefined}
          sub="Continuous service of active staff"
          info="Mean years since the latest hire date (continuous service, rehires restart the clock) for staff active on the reporting date." />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <ChartCard className="xl:col-span-8" title="Retention Evolution" subtitle={`Rolling 12-month retention rate at each month-end · ${labels.period}`}
          info="For each month-end M: share of staff active at M − 12 months who are still employed at M." empty={!d.retention.some((x) => x != null)}>
          <EChart height={300} label="Retention evolution"
            option={lines({ categories: months, area: true, endLabels: true, yMin: 'dataMin', fmt: (v) => `${v.toFixed(1)}%`, axisFmt: (v) => `${v}%`,
              series: [{ name: 'Retention rate', color: C.teal, data: d.retention.map((x) => (x == null ? null : Math.round(x * 1000) / 10)) }] })} />
        </ChartCard>
        <ChartCard className="xl:col-span-4" title="Voluntary vs Involuntary Exits" subtitle={`Separations by reason · ${labels.period}`} empty={!d.seps.length}
          info="Exit reasons grouped by who initiated the separation.">
          <EChart height={300} label="Voluntary versus involuntary exits by reason"
            option={{
              ...bars({ categories: d.reasons.map((r) => r.r), horizontal: true, labels: true, fmt: fmtInt, barMax: 18, legend: false, series: [{ name: 'Exits', color: C.teal, data: d.reasons.map((r) => r.n) }],
                extra: (i) => row(d.reasons[i].t === 'Voluntary' ? C.teal : C.burgundy, 'Type', d.reasons[i].t) + row(C.prev, 'Share of exits', fmtPct(ratio(d.reasons[i].n, d.seps.length))) }),
              legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: C.ink2, fontSize: 12 }, data: ['Voluntary', 'Involuntary'] },
              grid: { left: 4, right: 48, top: 36, bottom: 4, containLabel: true },
              series: [
                { type: 'bar', name: 'Voluntary', stack: 'x', barMaxWidth: 18, itemStyle: { color: C.teal, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: C.ink2, fontSize: 11, fontWeight: 600, formatter: (q: { value: unknown }) => (q.value ? fmtInt(Number(q.value)) : '') }, data: d.reasons.map((r) => (r.t === 'Voluntary' ? r.n : null)) },
                { type: 'bar', name: 'Involuntary', stack: 'x', barMaxWidth: 18, itemStyle: { color: C.burgundy, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: C.ink2, fontSize: 11, fontWeight: 600, formatter: (q: { value: unknown }) => (q.value ? fmtInt(Number(q.value)) : '') }, data: d.reasons.map((r) => (r.t === 'Involuntary' ? r.n : null)) },
              ],
            }} />
        </ChartCard>
      </div>

      <ChartCard title="Monthly Employee Exits" subtitle={`Separations per month by type · ${labels.period}`} empty={!d.seps.length}
        info="Separations dated in each month (last day of employment). Contract-end separations cluster at month-ends.">
        <EChart height={280} label="Monthly employee exits"
          option={bars({ categories: months, stack: true, total: true, fmt: fmtInt, barMax: 16,
            series: [{ name: 'Voluntary', color: C.teal, data: d.vol }, { name: 'Involuntary', color: C.burgundy, data: d.inv }] })} />
      </ChartCard>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard title="Turnover by Country" subtitle={`Annualised turnover rate · ${labels.period} · countries with ≥ 5 average staff`} empty={!d.byCountry.length}
          info="Separations in the period ÷ average month-end headcount of the country, annualised.">
          <EChart height={tall} label="Turnover by country"
            option={bars({ categories: d.byCountry.map((c) => c.country), horizontal: true, labels: true, labelFmt: (v) => `${v.toFixed(1)}%`, barMax: 12, legend: false, axisFmt: (v) => `${v}%`,
              series: [{ name: 'Turnover rate', color: C.burgundy, data: d.byCountry.map((c) => (c.rate == null ? null : c.rate * 100)) }],
              tooltipValue: (_s, i) => fmtPct(d.byCountry[i].rate),
              extra: (i) => row(C.prev, 'Exits', fmtInt(d.byCountry[i].n)) + row(C.prev, 'Avg. headcount', fmt1(d.byCountry[i].avg)) })} />
        </ChartCard>
        <div className="grid content-start gap-5">
          <ChartCard title="Turnover by Staff Type" subtitle={`Annualised turnover rate by category · ${labels.period}`} empty={!d.byCat.length}
            info="Separations ÷ average headcount per staff category (category at the time of exit), annualised.">
            <EChart height={240} label="Turnover by staff type"
              option={{
                ...bars({ categories: d.byCat.map((c) => c.cat), labels: true, labelFmt: (v) => `${v.toFixed(1)}%`, barMax: 34, legend: false, axisFmt: (v) => `${v}%`,
                  series: [{ name: 'Turnover rate', color: C.teal, data: d.byCat.map((c) => (c.rate ?? 0) * 100) }],
                  tooltipValue: (_s, i) => fmtPct(d.byCat[i].rate),
                  extra: (i) => row(C.prev, 'Exits', fmtInt(d.byCat[i].n)) + row(C.prev, 'of which voluntary', fmtInt(d.byCat[i].v)) + row(C.prev, 'Avg. headcount', fmt1(d.byCat[i].avg)) }),
                series: [{ type: 'bar', name: 'Turnover rate', barMaxWidth: 34, data: d.byCat.map((c) => ({ value: (c.rate ?? 0) * 100, itemStyle: { color: CATEGORY_COLOR[c.cat], borderRadius: [4, 4, 0, 0] } })),
                  label: { show: true, position: 'top', color: C.ink2, fontSize: 11, fontWeight: 600, formatter: (q: { value: unknown }) => `${Number(q.value).toFixed(1)}%` } }],
              }} />
          </ChartCard>
          <ChartCard title="Performance Appraisals by Department" subtitle={`Completion among eligible staff · 12 months to ${labels.asOf}`} empty={!d.appr.length}
            info="% of eligible staff (≥ 6 months of service) in each department with an appraisal completed in the last 12 months. Bars show completion rate; tooltip shows counts.">
            <EChart height={Math.max(220, d.appr.length * 30 + 30)} label="Performance appraisals by department"
              option={bars({ categories: d.appr.map((a) => a.dep), horizontal: true, labels: true, labelFmt: (v) => `${v.toFixed(0)}%`, barMax: 14, legend: false, yMax: 100, axisFmt: (v) => `${v}%`,
                series: [{ name: 'Completion', color: C.teal, data: d.appr.map((a) => (a.rate ?? 0) * 100) }],
                tooltipValue: (_s, i) => fmtPct(d.appr[i].rate),
                extra: (i) => row(C.prev, 'Appraised', fmtInt(d.appr[i].done)) + row(C.prev, 'Eligible', fmtInt(d.appr[i].eligible)) })} />
          </ChartCard>
        </div>
      </div>
    </Layout>
  );
}
