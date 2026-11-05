import { Building2, Cake, Earth, Globe2, Hourglass, Plane } from 'lucide-react';
import { useMemo } from 'react';
import { EChart } from '../charts/EChart';
import { bars, lines } from '../charts/options';
import { C, CATEGORY_COLOR, CONTRACT_COLOR } from '../charts/theme';
import { Layout } from '../components/Layout';
import { ChartCard, KpiCard } from '../components/ui';
import { CATEGORIES, type Category, type Contract } from '../data/types';
import { fmtMonthShort } from '../lib/dates';
import { fmt1, fmtInt, fmtPct, fmtSignedInt, fmtSignedPct } from '../lib/format';
import { activeAt, averageAge, countBy, diversityScope, GLOBAL_CATEGORIES, ratio } from '../lib/metrics';
import { useApp } from '../state/AppData';

const GRADES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
const TYPES = ['Fixed-Term', 'Open-Ended', 'Short-Term'] as const;

const isGlobal = (c: Contract) => GLOBAL_CATEGORIES.includes(c.staff_category);
const isIntl = (c: Contract) => c.staff_category === 'International Staff';

export default function Profile() {
  const { model, filters, p, labels } = useApp();

  const d = useMemo(() => {
    const a = activeAt(model, p.D, filters);
    const aPrev = p.prevD != null ? activeAt(model, p.prevD, filters) : null;
    const monthly = p.monthEnds.map((day) => ({ day, cs: activeAt(model, day, filters) }));
    const glob = a.filter(isGlobal);
    const intl = a.filter(isIntl);
    const scope = diversityScope(a, filters); // international workforce unless a category is selected
    const scopePrev = aPrev ? diversityScope(aPrev, filters) : [];
    const byC = countBy(scope, (c) => c.country);
    const byCPrev = countBy(scopePrev, (c) => c.country);
    const countries = [...new Set([...byC.keys(), ...byCPrev.keys()])].sort((x, y) => (byC.get(y) ?? 0) - (byC.get(x) ?? 0));
    const catNow = CATEGORIES.map((cat) => a.filter((c) => c.staff_category === cat).length);
    const catPrev = CATEGORIES.map((cat) => (aPrev ? aPrev.filter((c) => c.staff_category === cat).length : null));
    const grades = GRADES.filter((g) => a.some((c) => c.grade === g));
    const typeByCat = CATEGORIES.map((cat) => {
      const cs = a.filter((c) => c.staff_category === cat);
      return { cat, total: cs.length, counts: TYPES.map((t) => cs.filter((c) => c.contract_type === t).length) };
    }).filter((x) => x.total > 0);
    return {
      a, aPrev, monthly, glob, intl, countries, byC, byCPrev, catNow, catPrev, grades, typeByCat,
      gPrev: aPrev?.filter(isGlobal).length ?? null,
      iPrev: aPrev?.filter(isIntl).length ?? null,
      age: averageAge(a, p.D),
      agePrev: aPrev ? averageAge(aPrev, p.prevD as number) : null,
      ageG: averageAge(glob, p.D),
      ageI: averageAge(intl, p.D),
      hq: a.filter((c) => c.staff_category === 'HQ Staff').length,
      gnhq: a.filter((c) => c.staff_category === 'Global non-HQ Staff').length,
    };
  }, [model, filters, p]);

  const months = p.months.map(fmtMonthShort);
  const vsPrev = labels.prevYear ? `vs ${labels.prevYear}` : 'no prior-year baseline';
  const dn = (now: number, prev: number | null) =>
    prev == null ? { value: null, text: '', caption: vsPrev } : { value: now - prev, text: fmtSignedInt(now - prev), caption: vsPrev, polarity: 'neutral' as const };
  const scopeLabel = filters.category ? filters.category : 'International workforce (HQ, Global non-HQ, International)';
  const hasIntl = d.glob.length + d.intl.length > 0;

  return (
    <Layout
      title="Global Workforce Profile"
      description="Global vs International populations, grades, contract types and age profile. Global = HQ staff + Global non-HQ staff; International = internationally recruited staff assigned to country offices."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard icon={Globe2} label="Global Workforce" value={fmtInt(d.glob.length)} delta={dn(d.glob.length, d.gPrev)}
          spark={d.monthly.map((m) => m.cs.filter(isGlobal).length)}
          sub="HQ + Global non-HQ staff"
          info="Global = HQ Staff (headquarters) + Global non-HQ Staff (international staff working for global teams outside headquarters). Each person belongs to exactly one category on a given date." />
        <KpiCard icon={Plane} tone="burgundy" label="International Workforce" value={fmtInt(d.intl.length)} delta={dn(d.intl.length, d.iPrev)}
          spark={d.monthly.map((m) => m.cs.filter(isIntl).length)} sub="Non-Global international staff in country offices"
          info="International Staff category only: internationally recruited staff assigned to a country office, excluding Global teams." />
        <KpiCard icon={Building2} label="HQ Staff" value={fmtInt(d.hq)} sub={`${fmtPct(ratio(d.hq, d.glob.length))} of Global workforce`}
          info="Active staff in the HQ Staff category (based at headquarters)." />
        <KpiCard icon={Earth} tone="burgundy" label="Global non-HQ Staff" value={fmtInt(d.gnhq)} sub="Global teams in regional hubs"
          info="International staff working for global teams but based outside HQ (regional hubs)." />
        <KpiCard icon={Cake} label="Average Employee Age" value={fmt1(d.age)} unit="yrs"
          delta={d.age != null && d.agePrev != null ? { value: d.age - d.agePrev, text: `${d.age - d.agePrev >= 0 ? '+' : '−'}${Math.abs(d.age - d.agePrev).toFixed(1)} yrs`, caption: vsPrev, polarity: 'neutral' } : undefined}
          sub="All active staff in the current filter"
          info="Mean age on the reporting date of active staff with a recorded, plausible birth date (records failing validation are excluded)." />
        <KpiCard icon={Hourglass} tone="burgundy" label="Average Age · Global vs Intl." value={`${fmt1(d.ageG)} / ${fmt1(d.ageI)}`} unit="yrs"
          sub="Global / International populations"
          info="Mean age of the Global population (HQ + Global non-HQ) and of International Staff, on the reporting date." />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <ChartCard className="xl:col-span-8" title="Global vs International Workforce" subtitle={`Month-end headcount · ${labels.period}`}
          info="Monthly evolution of the two international populations. National Staff are excluded from this view."
          empty={!d.monthly.some((m) => m.cs.some((c) => isGlobal(c) || isIntl(c)))}>
          <EChart height={300} label="Global versus International workforce evolution"
            option={lines({
              categories: months,
              endLabels: true,
              fmt: fmtInt,
              series: [
                { name: 'International', color: C.burgundy, data: d.monthly.map((m) => m.cs.filter(isIntl).length) },
                { name: 'Global (HQ + Global non-HQ)', color: C.blue, data: d.monthly.map((m) => m.cs.filter(isGlobal).length) },
              ],
            })} />
        </ChartCard>
        <ChartCard className="xl:col-span-4" title="Headcount Comparison" subtitle={labels.prevYear ? `${labels.asOf} vs ${labels.prevYear}` : 'Previous-year baseline not available'}
          info="Active staff by category on the reporting date compared with the same date one year earlier." empty={!d.a.length}>
          <EChart height={300} label="Headcount current versus previous year by category"
            option={bars({
              categories: ['National', 'International', 'Global non-HQ', 'HQ'],
              axisLabelRotate: 0,
              fmt: fmtInt,
              series: [
                { name: labels.prevYear ? `Previous year` : 'Previous year (n/a)', color: C.prev, data: d.catPrev },
                { name: 'Current', color: C.teal, data: d.catNow },
              ],
              extra: (i) => {
                const prev = d.catPrev[i];
                return prev ? `<div style="margin-top:6px;color:#64748B">Change ${fmtSignedInt(d.catNow[i] - prev)} (${fmtSignedPct(d.catNow[i] / prev - 1)})</div>` : '';
              },
            })} />
        </ChartCard>
      </div>

      <ChartCard title="Staff Distribution by Country — Current vs Previous Year" subtitle={`${scopeLabel} · ${labels.asOf}${labels.prevYear ? ` vs ${labels.prevYear}` : ''}`}
        info="Numerical distribution by country of assignment with a comparison to one year earlier. Scope is the international workforce unless a staff category filter is applied."
        empty={!d.countries.length}>
        <EChart height={340} label="Staff distribution by country current versus previous year"
          option={bars({
            categories: d.countries,
            fmt: fmtInt,
            axisLabelRotate: 40,
            barMax: 14,
            series: [
              { name: 'Previous year', color: C.prev, data: d.countries.map((c) => (d.aPrev ? (d.byCPrev.get(c) ?? 0) : null)) },
              { name: 'Current', color: C.teal, data: d.countries.map((c) => d.byC.get(c) ?? 0) },
            ],
          })} />
      </ChartCard>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard title="Workforce by Grade" subtitle={`Active staff by grade and category · ${labels.asOf}`} empty={!d.grades.length}
          info="Grade of the active contract on the reporting date. National staff concentrate in G1–G4; international and Global staff in G3–G7.">
          <EChart height={300} label="Workforce by grade"
            option={bars({
              categories: d.grades,
              stack: true,
              total: true,
              fmt: fmtInt,
              barMax: 34,
              series: CATEGORIES.map((cat: Category) => ({
                name: cat,
                color: CATEGORY_COLOR[cat],
                data: d.grades.map((g) => d.a.filter((c) => c.grade === g && c.staff_category === cat).length || null),
              })).filter((s) => s.data.some(Boolean)),
            })} />
        </ChartCard>
        <ChartCard title="Employment Contract Types" subtitle={`Share of active contracts by type within each category · ${labels.asOf}`} empty={!d.typeByCat.length}
          info="Open-Ended = no planned end date; Fixed-Term = 6–24 month contracts; Short-Term = contracts of 3–6 months.">
          <EChart height={300} label="Employment contract types by staff category"
            option={bars({
              categories: d.typeByCat.map((t) => t.cat),
              horizontal: true,
              stack: true,
              yMax: 100,
              axisFmt: (v) => `${v}%`,
              series: TYPES.map((t, i) => ({ name: t, color: CONTRACT_COLOR[t], data: d.typeByCat.map((x) => (x.counts[i] ? (x.counts[i] / x.total) * 100 : null)) })),
              tooltipValue: (s, i) => `${fmtInt(d.typeByCat[i].counts[s])} · ${fmtPct(d.typeByCat[i].counts[s] / d.typeByCat[i].total)}`,
            })} />
        </ChartCard>
      </div>

      <ChartCard title="Average Age Evolution" subtitle={`Mean age at each month-end · ${labels.period}`}
        info="Average age of active staff with a valid birth date, measured at each month-end, for the Global, International and National populations."
        empty={!d.monthly.some((m) => m.cs.length)}>
        <EChart height={300} label="Average age evolution"
          option={lines({
            categories: months,
            fmt: (v) => `${v.toFixed(1)} yrs`,
            axisFmt: (v) => `${v}`,
            yMin: 'dataMin',
            endLabels: true,
            series: [
              { name: 'Global', color: C.blue, data: d.monthly.map((m) => averageAge(m.cs.filter(isGlobal), m.day)) },
              { name: 'International', color: C.burgundy, data: d.monthly.map((m) => averageAge(m.cs.filter(isIntl), m.day)) },
              { name: 'National', color: C.teal, data: d.monthly.map((m) => averageAge(m.cs.filter((c) => c.staff_category === 'National Staff'), m.day)) },
            ].filter((s) => s.data.some((x) => x != null)),
          })} />
        {!hasIntl && <p className="mt-2 text-xs text-muted">No Global or International staff in the current filter.</p>}
      </ChartCard>
    </Layout>
  );
}
