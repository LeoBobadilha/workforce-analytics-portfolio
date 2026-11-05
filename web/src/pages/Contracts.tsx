import { AlertTriangle, CalendarX2, CheckCircle2, Clock3, Database, FileSignature, Infinity as InfinityIcon, Percent } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EChart } from '../charts/EChart';
import { bars, donut, row } from '../charts/options';
import { C, CATEGORY_COLOR, CONTRACT_COLOR } from '../charts/theme';
import { DataTable, type Column } from '../components/DataTable';
import { Layout } from '../components/Layout';
import { Badge, ChartCard, KpiCard, StatRow, ValueLegend } from '../components/ui';
import { CATEGORIES, type Contract, type DQRule } from '../data/types';
import { fmtDay, fmtMonthShort, monthOfDay, range } from '../lib/dates';
import { fmt1, fmtInt, fmtPct } from '../lib/format';
import { activeAt, computeKpis, expiringWindowEnd, isExpiring, mean, plannedDurationMonths, ratio } from '../lib/metrics';
import { useApp } from '../state/AppData';

const GRADES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
const TYPES = ['Fixed-Term', 'Open-Ended', 'Short-Term'] as const;
const ONBOARD = new Set(['New hire', 'Rehire', 'Internal mobility']);
type Status = 'all' | 'expiring' | 'active' | 'open';

interface CRow extends Contract {
  daysLeft: number | null;
  status: 'Expiring ≤ 4 months' | 'Active' | 'Open-ended';
  months: number | null;
}

export default function Contracts() {
  const { model, dq, filters, p, labels } = useApp();
  const [status, setStatus] = useState<Status>('all');

  const d = useMemo(() => {
    const k = computeKpis(model, filters);
    const a = activeAt(model, p.D, filters);
    const winEnd = expiringWindowEnd(filters);
    const next = range(filters.to + 1, filters.to + 12);
    const timeline = CATEGORIES.map((cat) =>
      next.map((mi) => a.filter((c) => c.staff_category === cat && c.planned_end_date != null && monthOfDay(c.planned_end_date) === mi).length),
    );
    const fixed = a.filter((c) => c.planned_end_date != null);
    const durGrade = GRADES.map((g) => ({ g, n: fixed.filter((c) => c.grade === g).length, m: mean(fixed.filter((c) => c.grade === g).map((c) => plannedDurationMonths(c) as number)) })).filter((x) => x.n);
    // Grades 3 & 4 — International Staff (posting D9)
    const intl = activeAt(model, p.D, { country: filters.country, category: 'International Staff' });
    const onboarded = model.contracts.filter(
      (c) => c.staff_category === 'International Staff' && ONBOARD.has(c.start_reason) && c.start_date >= p.P0 && c.start_date <= p.D && (!filters.country || c.country === filters.country),
    );
    const g34 = ['G3', 'G4'].map((g) => {
      const cur = intl.filter((c) => c.grade === g);
      const curFixed = cur.filter((c) => c.planned_end_date != null);
      const nb = onboarded.filter((c) => c.grade === g && c.planned_end_date != null);
      return { g, cur: cur.length, curM: mean(curFixed.map((c) => plannedDurationMonths(c) as number)), nb: nb.length, nbM: mean(nb.map((c) => plannedDurationMonths(c) as number)), exp: cur.filter((c) => isExpiring(c, p.D, winEnd)).length };
    });
    const intlExpByGrade = GRADES.map((g) => {
      const cs = intl.filter((c) => c.grade === g);
      return { g, n: cs.length, exp: cs.filter((c) => isExpiring(c, p.D, winEnd)).length };
    }).filter((x) => x.n);
    const types = TYPES.map((t) => ({ t, n: a.filter((c) => c.contract_type === t).length }));
    const rows: CRow[] = a.map((c) => {
      const exp = isExpiring(c, p.D, winEnd);
      return {
        ...c,
        daysLeft: c.planned_end_date == null ? null : c.planned_end_date - p.D,
        status: c.planned_end_date == null ? 'Open-ended' : exp ? 'Expiring ≤ 4 months' : 'Active',
        months: plannedDurationMonths(c),
      };
    });
    return { k, a, next, timeline, durGrade, g34, intlExpByGrade, types, rows, intl };
  }, [model, filters, p]);

  const { k } = d;
  const filteredRows = d.rows.filter((r) =>
    status === 'all' ? true : status === 'expiring' ? r.status === 'Expiring ≤ 4 months' : status === 'open' ? r.status === 'Open-ended' : r.status === 'Active',
  );
  const intlNA = filters.category != null && filters.category !== 'International Staff';

  const cols: Column<CRow>[] = [
    { key: 'id', header: 'Contract', value: (r) => r.contract_id, render: (r) => <span className="font-medium text-ink">{r.contract_id}</span> },
    { key: 'emp', header: 'Employee', value: (r) => r.employee_id },
    { key: 'title', header: 'Position', value: (r) => r.position_title },
    { key: 'cat', header: 'Category', value: (r) => r.staff_category, render: (r) => (
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ background: CATEGORY_COLOR[r.staff_category] }} />{r.staff_category}</span>) },
    { key: 'country', header: 'Country', value: (r) => r.country },
    { key: 'grade', header: 'Grade', value: (r) => r.grade, align: 'center' },
    { key: 'type', header: 'Type', value: (r) => r.contract_type },
    { key: 'start', header: 'Start', value: (r) => r.start_date, render: (r) => fmtDay(r.start_date) },
    { key: 'end', header: 'Planned end', value: (r) => r.planned_end_date, render: (r) => fmtDay(r.planned_end_date) },
    { key: 'left', header: 'Days left', value: (r) => r.daysLeft, align: 'right', render: (r) => (r.daysLeft == null ? '—' : fmtInt(r.daysLeft)) },
    { key: 'status', header: 'Status', value: (r) => r.status, render: (r) =>
      r.status === 'Expiring ≤ 4 months' ? <Badge tone="warn"><AlertTriangle size={11} />Expiring</Badge> : r.status === 'Open-ended' ? <Badge tone="neutral"><InfinityIcon size={11} />Open-ended</Badge> : <Badge tone="good"><CheckCircle2 size={11} />Active</Badge> },
  ];

  const ruleCols: Column<DQRule>[] = [
    { key: 'id', header: 'Rule', value: (r) => r.rule_id, render: (r) => <span className="font-mono text-xs font-semibold text-ink">{r.rule_id}</span> },
    { key: 'src', header: 'Source', value: (r) => r.source },
    { key: 'dim', header: 'Dimension', value: (r) => r.dimension },
    { key: 'desc', header: 'Validation rule', value: (r) => r.description, render: (r) => <span className="block min-w-[280px] whitespace-normal">{r.description}</span>, width: '38%' },
    { key: 'chk', header: 'Checked', value: (r) => r.records_checked, align: 'right', render: (r) => fmtInt(r.records_checked) },
    { key: 'iss', header: 'Issues', value: (r) => r.issues_found + r.records_merged, align: 'right', render: (r) => (r.status === 'Merged' ? <span className="text-muted">{fmtInt(r.records_merged)} merged</span> : fmtInt(r.issues_found)) },
    { key: 'act', header: 'Action', value: (r) => r.action },
    { key: 'st', header: 'Status', value: (r) => r.status, render: (r) => (
      <Badge tone={r.status === 'Pass' ? 'good' : r.status === 'Warning' ? 'warn' : 'info'}>{r.status}</Badge>) },
  ];

  const rec = dq.reconciliation;

  return (
    <Layout title="Contracts & Data Quality" description="Contract visibility (expiries, durations, Grades 3–4 international staff) and the data-quality controls applied when consolidating CORE HR, JIRA and historical Excel trackers.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard icon={FileSignature} label="Active Contracts" value={fmtInt(k.headcount)} sub={`On ${labels.asOf} · one per active employee`}
          info="Contracts with start ≤ reporting date ≤ end date. Validation rule CTR-08 guarantees no overlapping contracts per employee." />
        <KpiCard icon={CalendarX2} tone="burgundy" label="Contracts Expiring in 4 Months" value={fmtInt(k.contracts_expiring_4m)}
          sub={`Planned end after ${labels.asOf} and by ${fmtDay(expiringWindowEnd(filters))}`}
          info="Active contracts whose planned end date falls within the next four calendar months after the reporting date. Open-ended contracts never expire." />
        <KpiCard icon={Percent} label="Expiring International Contracts" value={intlNA ? 'n/a' : fmtPct(k.intl_expiring_share)}
          sub={intlNA ? 'Select International Staff or All categories' : `${fmtInt(d.intlExpByGrade.reduce((s, x) => s + x.exp, 0))} of ${fmtInt(d.intl.length)} International Staff`}
          info="International Staff whose contract ends within the next four months ÷ all active International Staff (country filter applies)." />
        <KpiCard icon={Clock3} tone="burgundy" label="Average Contract Duration" value={fmt1(k.avg_contract_duration_months)} unit="months"
          sub="Active fixed-term & short-term contracts"
          info="Mean planned duration (planned end − start + 1 day, in months of 30.44 days) of active contracts with a planned end date. Open-ended contracts are excluded." />
        <KpiCard icon={Database} label="Data Completeness" value={fmtPct(dq.overall_completeness / 100, 2)}
          sub={`Key fields in the consolidated model · raw sources ${fmtPct(dq.raw_completeness / 100, 2)}`}
          info="Share of populated values across key fields of the consolidated model (gender, birth date, nationality, hire date, country, grade, contract type, department, closure date and outcome). Pipeline run — not affected by dashboard filters." />
        <KpiCard icon={AlertTriangle} tone="burgundy" label="Data Quality Issues" value={fmtInt(dq.issues_total)}
          sub={`${fmtInt(dq.issues_resolved)} auto-resolved · ${fmtInt(dq.issues_open)} flagged · ${dq.rules_total} rules`}
          info="Issues detected by the validation rules of the latest pipeline run. Resolved = standardised, enriched or de-duplicated automatically; flagged = excluded from metrics or awaiting correction in source." />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <ChartCard className="xl:col-span-8" title="Contract Expiration Timeline" subtitle={`Active contracts by month of planned end · next 12 months after ${labels.asOf}`}
          info="Contracts active on the reporting date, grouped by the calendar month of their planned end date. The first four months form the 4-month expiry window." empty={!d.timeline.some((s) => s.some(Boolean))}>
          <EChart height={300} label="Contract expiration timeline"
            option={{
              ...bars({ categories: d.next.map(fmtMonthShort), stack: true, total: true, fmt: fmtInt, barMax: 30,
                series: CATEGORIES.map((cat, i) => ({ name: cat, color: CATEGORY_COLOR[cat], data: d.timeline[i] })).filter((s) => s.data.some(Boolean)) }),
            }} />
          <p className="mt-2 text-xs text-muted">Months 1–4 ({fmtMonthShort(filters.to + 1)} – {fmtMonthShort(filters.to + 4)}) make up the 4-month expiry window used by the KPIs (which also counts contracts ending on the reporting date itself).</p>
        </ChartCard>
        <ChartCard className="xl:col-span-4" title="Contract Type Distribution" subtitle={`Active contracts · ${labels.asOf}`} empty={!d.a.length}
          info="Active contracts by contract type.">
          <EChart height={200} label="Contract type distribution" option={donut(d.types.map((t) => ({ name: t.t, value: t.n, color: CONTRACT_COLOR[t.t] })), { value: fmtInt(d.a.length), label: 'contracts' })} />
          <div className="mt-3">
            <ValueLegend items={d.types.map((t) => ({ name: t.t, color: CONTRACT_COLOR[t.t], value: fmtInt(t.n), share: fmtPct(ratio(t.n, d.a.length)) }))} />
          </div>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard title="Contract Duration by Grade" subtitle={`Average planned duration of active fixed/short-term contracts · ${labels.asOf}`} empty={!d.durGrade.length}
          info="Mean planned contract length (months) by grade; open-ended contracts excluded.">
          <EChart height={280} label="Contract duration by grade"
            option={bars({ categories: d.durGrade.map((x) => x.g), labels: true, labelFmt: (v) => v.toFixed(1), barMax: 30, legend: false, fmt: (v) => `${v.toFixed(1)} months`, axisFmt: (v) => `${v}`,
              series: [{ name: 'Average duration', color: C.teal, data: d.durGrade.map((x) => x.m) }],
              extra: (i) => row(C.prev, 'Contracts', fmtInt(d.durGrade[i].n)) })} />
        </ChartCard>
        <ChartCard title="Grades 3 and 4 Contract Analysis" subtitle={`International Staff · current contracts vs contracts granted to staff onboarded in ${labels.period}`}
          info="Average planned duration of (a) active International Staff contracts in Grades 3 and 4 and (b) contracts granted to International Staff newly onboarded in the period (new hires, rehires, internal mobility). Expiring = ending within 4 months."
          empty={intlNA || !d.g34.some((x) => x.cur || x.nb)}>
          <EChart height={200} label="Grades 3 and 4 contract analysis"
            option={bars({ categories: d.g34.map((x) => `Grade ${x.g.slice(1)}`), horizontal: true, labels: true, labelFmt: (v) => `${v.toFixed(1)} mo`, barMax: 18, fmt: (v) => `${v.toFixed(1)} months`, axisFmt: (v) => `${v}`,
              series: [{ name: 'Current contracts', color: C.burgundy, data: d.g34.map((x) => x.curM) }, { name: 'Newly onboarded', color: C.amber, data: d.g34.map((x) => x.nbM) }],
              extra: (i) => row(C.burgundy, 'Current International Staff', fmtInt(d.g34[i].cur)) + row(C.amber, 'Onboarded in period', fmtInt(d.g34[i].nb)) + row(C.prev, 'Expiring ≤ 4 months', fmtInt(d.g34[i].exp)) })} />
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">International Staff with contracts ending within 4 months, by grade</p>
            <StatRow items={d.intlExpByGrade.map((x) => ({ label: `Grade ${x.g.slice(1)}`, value: fmtInt(x.exp), hint: `${fmtPct(ratio(x.exp, x.n), 0)} of ${fmtInt(x.n)}` }))} />
          </div>
        </ChartCard>
      </div>

      <ChartCard title="Contract Register" subtitle={`Active contracts on ${labels.asOf} · synthetic, pseudonymised records`}
        info="Record-level view of the contracts behind every KPI on this page. Filter by status, search any column, click headers to sort.">
        <DataTable caption="Contract register" rows={filteredRows} columns={cols} rowKey={(r) => r.contract_id} initialSort={{ key: 'left', dir: 'asc' }} pageSize={12}
          searchPlaceholder="Search contract, employee, country, position…"
          toolbar={
            <label className="flex items-center gap-2 text-xs text-muted">
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className="select h-9 rounded-lg border border-line bg-white pl-3 text-sm text-ink focus:border-teal focus:outline-none">
                <option value="all">All statuses ({fmtInt(d.rows.length)})</option>
                <option value="expiring">Expiring ≤ 4 months ({fmtInt(d.rows.filter((r) => r.status === 'Expiring ≤ 4 months').length)})</option>
                <option value="active">Active ({fmtInt(d.rows.filter((r) => r.status === 'Active').length)})</option>
                <option value="open">Open-ended ({fmtInt(d.rows.filter((r) => r.status === 'Open-ended').length)})</option>
              </select>
            </label>
          } />
      </ChartCard>

      <ChartCard title="Data Quality by Source" subtitle="Field completeness of raw extracts and issues detected · latest pipeline run"
        info="Completeness = populated key fields ÷ expected key fields in each raw source. Issues = records failing a validation rule for that source (expected migration overlaps are reported as merges, not issues). Pipeline-level indicators are not affected by dashboard filters.">
        <div className="grid gap-6 xl:grid-cols-12">
          <div className="xl:col-span-5">
            <EChart height={200} label="Data quality by source"
              option={bars({ categories: dq.sources.map((s) => s.source), horizontal: true, labels: true, labelFmt: (v) => `${v.toFixed(2)}%`, barMax: 20, legend: false, yMin: 95, yMax: 100, axisFmt: (v) => `${v}%`,
                series: [{ name: 'Completeness', color: C.teal, data: dq.sources.map((s) => s.completeness) }],
                tooltipValue: (_s, i) => `${dq.sources[i].completeness.toFixed(2)}%`,
                extra: (i) => row(C.burgundy, 'Issues detected', fmtInt(dq.sources[i].issues)) + row(C.prev, 'Validation rules', fmtInt(dq.sources[i].rules)) })} />
            <p className="mt-1 text-xs text-muted">Axis starts at 95% to make differences between sources visible.</p>
          </div>
          <div className="space-y-4 xl:col-span-7">
            <StatRow items={[
              { label: 'Rules passed', value: `${dq.rules_passed}/${dq.rules_total}`, hint: 'incl. planned merges' },
              { label: 'Headcount reconciliation', value: fmtPct(rec.headcount_matched / rec.headcount_cells), hint: `${fmtInt(rec.headcount_cells)} monthly snapshot cells` },
              { label: 'Expatriation reconciliation', value: fmtPct(rec.expat_matched / rec.expat_cells), hint: `${fmtInt(rec.expat_cells)} cells · exact, or gap within unrecorded nationalities` },
            ]} />
            <div className="rounded-lg bg-page p-3 text-xs text-muted">
              <p className="mb-1.5 font-semibold text-ink-2">Lineage — records extracted per source</p>
              <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {dq.lineage.map((l) => (
                  <li key={`${l.entity}-${l.source}`} className="flex justify-between gap-2"><span>{l.entity} · {l.source}</span><b className="tabular text-ink-2">{fmtInt(l.records)}</b></li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </ChartCard>

      <ChartCard title="Data Validation Summary" subtitle={`${dq.rules_total} automated rules executed by the consolidation pipeline · run ${dq.generated_at.slice(0, 10)}`}
        info="Every rule executed by pipeline/build_model.py while consolidating the sources. Status: Pass = no issue; Resolved = fixed automatically; Merged = expected overlap de-duplicated; Warning = flagged / excluded from metrics.">
        <DataTable caption="Data validation summary" rows={dq.rules} columns={ruleCols} rowKey={(r) => r.rule_id} pageSize={12} searchPlaceholder="Search rules, sources, actions…" />
      </ChartCard>
    </Layout>
  );
}
