import { Compass, Flag, Languages, LifeBuoy, PlaneTakeoff, Scale } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EChart } from '../charts/EChart';
import { bars, donut, foot, lines } from '../charts/options';
import { C, CONTRACT_COLOR, GENDER_COLOR, GROUP_COLOR } from '../charts/theme';
import { Layout } from '../components/Layout';
import { ChartCard, KpiCard, Segmented, ValueLegend } from '../components/ui';
import type { Contract } from '../data/types';
import { fmtMonthShort, monthOfDay, quarterLabel } from '../lib/dates';
import { fmtInt, fmtPct, fmtPp } from '../lib/format';
import { activeAt, countBy, diversityScope, gsShare, isExpat, ratio, sortDesc, surgesFor } from '../lib/metrics';
import { useApp } from '../state/AppData';

type Group = 'all' | 'Global South' | 'Global North';
const GRADES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];

export default function Diversity() {
  const { model, filters, p, labels } = useApp();
  const [group, setGroup] = useState<Group>('all');
  const inGroup = (c: Contract) => group === 'all' || c.emp.nationality_group === group;

  const d = useMemo(() => {
    const a = activeAt(model, p.D, filters);
    const scope = diversityScope(a, filters);
    const ratioNow = gsShare(scope);
    const prev = p.prevD != null ? gsShare(diversityScope(activeAt(model, p.prevD, filters), filters)) : null;
    const monthly = p.monthEnds.map((day) => gsShare(diversityScope(activeAt(model, day, filters), filters)));
    const grades = GRADES.map((g) => ({ g, ...gsShare(scope.filter((c) => c.grade === g)) })).filter((x) => x.gs + x.gn > 0);
    // toggle-filtered profile
    const sel = scope.filter(inGroup);
    const gender = countBy(sel, (c) => c.emp.gender);
    const types = countBy(sel, (c) => c.contract_type);
    const nat = sortDesc(countBy(sel.filter((c) => c.emp.nationality), (c) => c.emp.nationality));
    const groupOf = new Map(model.employees.map((e) => [e.nationality ?? '', e.nationality_group]));
    const byCountry = [...new Set(sel.map((c) => c.country))]
      .map((country) => {
        const cs = sel.filter((c) => c.country === country);
        const s = gsShare(cs);
        return { country, total: cs.length, gs: s.gs, gn: s.gn, nats: new Set(cs.map((c) => c.emp.nationality).filter(Boolean)).size };
      })
      .sort((x, y) => y.total - x.total);
    // expatriation: all staff in filter (incl. national staff working outside their nationality country)
    const expat = p.monthEnds.map((day) => {
      const cs = activeAt(model, day, filters).filter((c) => isExpat(c) && inGroup(c));
      return { gs: cs.filter((c) => c.emp.nationality_group === 'Global South').length, gn: cs.filter((c) => c.emp.nationality_group === 'Global North').length };
    });
    const expatNow = a.filter((c) => isExpat(c) && inGroup(c)).length;
    // surges by quarter
    const sg = surgesFor(model, filters, p.P0, p.D);
    const quarters = [...new Set(p.months.map(quarterLabel))];
    const qOf = (day: number) => quarterLabel(monthOfDay(day));
    const filled = sg.filter((s) => s.status === 'Filled');
    const sq = quarters.map((q) => {
      const fs = filled.filter((s) => qOf(s.request_date) === q);
      return {
        q,
        nat: fs.filter((s) => s.deployed_category === 'National Staff').length,
        intl: fs.filter((s) => s.deployed_category !== 'National Staff').length,
        requested: sg.filter((s) => qOf(s.request_date) === q).length,
      };
    });
    const natShare = ratio(filled.filter((s) => s.deployed_category === 'National Staff').length, filled.length);
    return { a, scope, ratioNow, prev, monthly, grades, sel, gender, types, nat, groupOf, byCountry, expat, expatNow, sq, sg, filled, natShare };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, filters, p, group]);

  const months = p.months.map(fmtMonthShort);
  const vsPrev = labels.prevYear ? `vs ${labels.prevYear}` : 'no prior-year baseline';
  const gsS = d.ratioNow.share;
  const scopeLabel = filters.category ? filters.category : 'International workforce (HQ, Global non-HQ, International)';
  const groupLabel = group === 'all' ? 'All nationality groups' : group;
  const top = d.nat.slice(0, 15);
  const genderItems = (['Female', 'Male', 'Not recorded'] as const).map((g) => ({ name: g, value: d.gender.get(g) ?? 0, color: GENDER_COLOR[g] })).filter((x) => x.value);
  const typeItems = (['Fixed-Term', 'Open-Ended', 'Short-Term'] as const).map((t) => ({ name: t, value: d.types.get(t) ?? 0, color: CONTRACT_COLOR[t] }));

  const toggle = (
    <Segmented<Group>
      label="Nationality group"
      value={group}
      onChange={setGroup}
      options={[
        { value: 'all', label: 'All' },
        { value: 'Global South', label: 'Global South' },
        { value: 'Global North', label: 'Global North' },
      ]}
    />
  );

  return (
    <Layout
      title="Diversity & Mobility"
      description="Global South / Global North representation, nationality mix, expatriation and surge deployments. The nationality-group toggle filters the diversity profile without duplicating pages."
      actions={
        <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-2 py-1">
          <span className="text-xs font-medium text-muted">Nationality group</span>
          {toggle}
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard icon={Scale} label="Global South Share" value={fmtPct(gsS)}
          delta={gsS != null && d.prev?.share != null ? { value: gsS - d.prev.share, text: fmtPp(gsS - d.prev.share), caption: vsPrev, polarity: 'neutral' } : undefined}
          sub={`${fmtInt(d.ratioNow.gs)} GS · ${fmtInt(d.ratioNow.gn)} GN staff`}
          info="Global South nationals ÷ (Global South + Global North) in the relevant workforce on the reporting date. Relevant workforce = HQ + Global non-HQ + International Staff (or the selected category). Staff without recorded nationality are excluded." />
        <KpiCard icon={Compass} tone="burgundy" label="GS : GN Ratio" value={d.ratioNow.gn ? `${(d.ratioNow.gs / d.ratioNow.gn).toFixed(2)} : 1` : '—'}
          sub={`Global North share ${fmtPct(gsS == null ? null : 1 - gsS)}`}
          info="Number of Global South nationals per Global North national in the relevant workforce. Classification is illustrative: Global North = high-income OECD-DAC countries." />
        <KpiCard icon={Languages} label="Nationalities Represented" value={fmtInt(new Set(d.sel.map((c) => c.emp.nationality).filter(Boolean)).size)}
          sub={`${groupLabel} · relevant workforce`}
          info="Distinct nationalities among active staff in the relevant workforce and selected nationality group." />
        <KpiCard icon={PlaneTakeoff} tone="burgundy" label="Expatriated Staff" value={fmtInt(d.expatNow)}
          sub={`Working outside their country of nationality · ${fmtPct(ratio(d.expatNow, d.a.length))}`}
          info="Active staff (all categories in the filter) whose nationality differs from their country of assignment, on the reporting date. A proxy, not an official expatriation status." />
        <KpiCard icon={LifeBuoy} label="Surge Requests" value={fmtInt(d.sg.length)}
          sub={`${fmtInt(d.filled.length)} filled · ${fmtPct(ratio(d.filled.length, d.sg.length))} fill rate`}
          info="Surge deployment requests raised in the selected period (Excel surge tracker ≤ 2025, JIRA from 2026). The country filter applies to the requesting country office." />
        <KpiCard icon={Flag} tone="burgundy" label="Surges Filled by National Staff" value={fmtPct(d.natShare)}
          sub="Share of filled surges in the period"
          info="Filled surge deployments where the deployed person held a National Staff contract, ÷ all filled surges in the period." />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <ChartCard className="xl:col-span-8" title="GN / GS Historical Evolution" subtitle={`Share of relevant workforce at each month-end · ${labels.period}`}
          info="Monthly Global South vs Global North composition of the relevant workforce. Always shows both groups (toggle applies to the profile charts)."
          empty={!d.monthly.some((m) => m.gs + m.gn)}>
          <EChart height={300} label="Global North and Global South evolution"
            option={lines({
              categories: months,
              stack: true,
              yMax: 100,
              axisFmt: (v) => `${v}%`,
              series: [
                { name: 'Global South', color: GROUP_COLOR['Global South'], data: d.monthly.map((m) => (m.share == null ? null : m.share * 100)) },
                { name: 'Global North', color: GROUP_COLOR['Global North'], data: d.monthly.map((m) => (m.share == null ? null : (1 - m.share) * 100)) },
              ],
              tooltipValue: (s, i) => {
                const m = d.monthly[i];
                const n = s === 0 ? m.gs : m.gn;
                return `${fmtInt(n)} · ${fmtPct(ratio(n, m.gs + m.gn))}`;
              },
            })} />
        </ChartCard>
        <ChartCard className="xl:col-span-4" title="Diversity by Grade" subtitle={`GS / GN share within each grade · ${labels.asOf}`} empty={!d.grades.length}
          info="Global South vs Global North share of the relevant workforce in each grade on the reporting date.">
          <EChart height={300} label="Diversity by grade"
            option={bars({
              categories: d.grades.map((g) => g.g),
              horizontal: true,
              stack: true,
              yMax: 100,
              barMax: 18,
              axisFmt: (v) => `${v}%`,
              series: [
                { name: 'Global South', color: GROUP_COLOR['Global South'], data: d.grades.map((g) => (g.gs / (g.gs + g.gn)) * 100) },
                { name: 'Global North', color: GROUP_COLOR['Global North'], data: d.grades.map((g) => (g.gn / (g.gs + g.gn)) * 100) },
              ],
              tooltipValue: (s, i) => {
                const g = d.grades[i];
                const n = s === 0 ? g.gs : g.gn;
                return `${fmtInt(n)} · ${fmtPct(n / (g.gs + g.gn))}`;
              },
            })} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-12">
        <ChartCard className="xl:col-span-4" title="Gender Distribution" subtitle={`${groupLabel} · ${labels.asOf}`} empty={!d.sel.length}
          info="Gender split of the relevant workforce, filtered by the nationality-group toggle.">
          <EChart height={190} label="Gender distribution" option={donut(genderItems, { value: fmtPct(ratio(d.gender.get('Female') ?? 0, (d.gender.get('Female') ?? 0) + (d.gender.get('Male') ?? 0)), 0), label: 'women' })} />
          <div className="mt-3">
            <ValueLegend items={genderItems.map((g) => ({ name: g.name, color: g.color, value: fmtInt(g.value), share: fmtPct(ratio(g.value, d.sel.length)) }))} />
          </div>
        </ChartCard>
        <ChartCard className="xl:col-span-4" title="Contract Type Profile" subtitle={`${groupLabel} · ${labels.asOf}`} empty={!d.sel.length}
          info="Contract types of the relevant workforce, filtered by the nationality-group toggle.">
          <EChart height={190} label="Contract types" option={donut(typeItems, { value: fmtInt(d.sel.length), label: 'staff' })} />
          <div className="mt-3">
            <ValueLegend items={typeItems.map((g) => ({ name: g.name, color: g.color, value: fmtInt(g.value), share: fmtPct(ratio(g.value, d.sel.length)) }))} />
          </div>
        </ChartCard>
        <ChartCard className="lg:col-span-2 xl:col-span-4" title="Nationality Ranking" subtitle={`Top ${top.length} nationalities · ${groupLabel}`} empty={!top.length}
          info="Most represented nationalities in the relevant workforce on the reporting date. Use the toggle to rank Global South or Global North nationalities only.">
          <EChart height={Math.max(220, top.length * 22 + 50)} label="Nationality ranking"
            option={{
              ...bars({ categories: top.map((x) => x[0]), horizontal: true, labels: true, barMax: 12, fmt: fmtInt, series: [{ name: 'Staff', color: C.teal, data: top.map((x) => x[1]) }], legend: false }),
              series: [
                {
                  type: 'bar',
                  name: 'Staff',
                  barMaxWidth: 12,
                  data: top.map(([n, v]) => ({ value: v, itemStyle: { color: GROUP_COLOR[d.groupOf.get(n) ?? 'Not recorded'], borderRadius: [0, 4, 4, 0] } })),
                  label: { show: true, position: 'right', color: C.ink2, fontSize: 11, fontWeight: 600 },
                },
              ],
            }} />
          <div className="mt-2 flex gap-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: GROUP_COLOR['Global South'] }} />Global South</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: GROUP_COLOR['Global North'] }} />Global North</span>
          </div>
        </ChartCard>
      </div>

      <ChartCard title="Geographic Workforce Diversity" subtitle={`${scopeLabel} by country of assignment · ${groupLabel} · ${labels.asOf}`} empty={!d.byCountry.length}
        info="Relevant workforce per country of assignment, split by nationality group, with the number of distinct nationalities in each country (tooltip).">
        <EChart height={320} label="Geographic workforce diversity"
          option={bars({
            categories: d.byCountry.map((c) => c.country),
            stack: true,
            total: true,
            fmt: fmtInt,
            axisLabelRotate: 40,
            barMax: 18,
            series: [
              { name: 'Global South', color: GROUP_COLOR['Global South'], data: d.byCountry.map((c) => c.gs || null) },
              { name: 'Global North', color: GROUP_COLOR['Global North'], data: d.byCountry.map((c) => c.gn || null) },
            ].filter((s) => s.data.some(Boolean)),
            extra: (i) => foot(`Nationalities represented <b style="float:right;margin-left:12px;color:#19232D">${d.byCountry[i].nats}</b>`),
          })} />
      </ChartCard>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard title="Expatriation Trends" subtitle={`Staff working outside their country of nationality, month-end · ${groupLabel}`}
          info="Monthly count of active staff whose nationality differs from the country of assignment (all categories in the filter). A proxy, not an official expatriation status. Reconciled against the historical Excel expatriation tracker — see Data Quality."
          empty={!d.expat.some((x) => x.gs + x.gn)}>
          <EChart height={300} label="Expatriation trends"
            option={bars({
              categories: months,
              stack: true,
              total: true,
              fmt: fmtInt,
              barMax: 14,
              series: [
                { name: 'Global South nationals', color: GROUP_COLOR['Global South'], data: d.expat.map((x) => x.gs) },
                { name: 'Global North nationals', color: GROUP_COLOR['Global North'], data: d.expat.map((x) => x.gn) },
              ].filter((s) => group === 'all' || s.name.startsWith(group)),
            })} />
        </ChartCard>
        <ChartCard title="National vs International Surge Deployment" subtitle={`Filled surge deployments by quarter of request · ${labels.period}`}
          info="Surge requests filled by staff holding a National Staff contract vs internationally recruited staff (International / Global non-HQ). Category and nationality toggles do not apply."
          empty={!d.filled.length}>
          <EChart height={300} label="National versus international surge deployment"
            option={bars({
              categories: d.sq.map((q) => q.q),
              stack: true,
              total: true,
              fmt: fmtInt,
              barMax: 26,
              series: [
                { name: 'National Staff', color: C.teal, data: d.sq.map((q) => q.nat) },
                { name: 'International Staff', color: C.burgundy, data: d.sq.map((q) => q.intl) },
              ],
              extra: (i) => {
                const q = d.sq[i];
                return foot(`Requests raised ${q.requested} · national share ${fmtPct(ratio(q.nat, q.nat + q.intl), 0)}`);
              },
            })} />
        </ChartCard>
      </div>
    </Layout>
  );
}
