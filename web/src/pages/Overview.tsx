import { Earth, Flag, Plane, Scale, TrendingUp, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EChart } from '../charts/EChart';
import { bars, donut, foot, lines, row } from '../charts/options';
import { C, CATEGORY_COLOR, GENDER_COLOR } from '../charts/theme';
import { DataTable, type Column } from '../components/DataTable';
import { Layout } from '../components/Layout';
import { ChartCard, KpiCard, Segmented, StatRow, ValueLegend } from '../components/ui';
import { CATEGORIES } from '../data/types';
import { fmtMonthShort } from '../lib/dates';
import { fmtInt, fmtPct, fmtPp, fmtSignedInt, fmtSignedPct } from '../lib/format';
import { activeAt, computeKpis, countBy, femaleShare, ratio } from '../lib/metrics';
import { useApp } from '../state/AppData';

interface CountryRow {
  country: string;
  region: string;
  total: number;
  national: number;
  international: number;
  nationalShare: number | null;
  female: number | null;
  prev: number | null;
  change: number | null;
}

export default function Overview() {
  const { model, filters, p, labels } = useApp();
  const [evoMode, setEvoMode] = useState<'total' | 'category'>('category');

  const d = useMemo(() => {
    const k = computeKpis(model, filters);
    const kPrev = p.prevD != null ? computeKpis(model, { ...filters, from: filters.from - 12, to: filters.to - 12 }) : null;
    const a = activeAt(model, p.D, filters);
    const aPrev = p.prevD != null ? activeAt(model, p.prevD, filters) : null;
    const baselineDay = p.P0 - 1;
    const base = activeAt(model, baselineDay, filters);

    const monthly = p.monthEnds.map((day) => activeAt(model, day, filters));
    const monthlyByCat = CATEGORIES.map((cat) => monthly.map((cs) => cs.filter((c) => c.staff_category === cat).length));

    const region = new Map(model.countries.map((c) => [c.name, c.region]));
    const byCountry = new Map<string, CountryRow>();
    for (const c of a) {
      let r = byCountry.get(c.country);
      if (!r) {
        r = { country: c.country, region: region.get(c.country) ?? '', total: 0, national: 0, international: 0, nationalShare: null, female: null, prev: null, change: null };
        byCountry.set(c.country, r);
      }
      r.total++;
      if (c.staff_category === 'National Staff') r.national++;
      else r.international++;
    }
    const prevCount = countBy(aPrev ?? [], (c) => c.country);
    const baseCount = countBy(base, (c) => c.country);
    for (const r of byCountry.values()) {
      r.nationalShare = ratio(r.national, r.total);
      r.female = femaleShare(a.filter((c) => c.country === r.country));
      r.prev = aPrev ? (prevCount.get(r.country) ?? 0) : null;
      r.change = r.prev != null ? r.total - r.prev : null;
    }
    const allCountries = new Set([...byCountry.keys(), ...baseCount.keys()]);
    const growth = [...allCountries]
      .map((c) => ({ country: c, now: byCountry.get(c)?.total ?? 0, base: baseCount.get(c) ?? 0 }))
      .map((g) => ({ ...g, delta: g.now - g.base }))
      .sort((x, y) => y.delta - x.delta);
    const rows = [...byCountry.values()].sort((x, y) => y.total - x.total);
    const catCounts = CATEGORIES.map((cat) => ({ cat, n: a.filter((c) => c.staff_category === cat).length, prev: aPrev?.filter((c) => c.staff_category === cat).length ?? null }));
    const gender = CATEGORIES.map((cat) => {
      const cs = a.filter((c) => c.staff_category === cat);
      const g = countBy(cs, (c) => c.emp.gender);
      return { cat, total: cs.length, F: g.get('Female') ?? 0, M: g.get('Male') ?? 0, U: g.get('Not recorded') ?? 0 };
    }).filter((g) => g.total > 0);
    const genderAll = countBy(a, (c) => c.emp.gender);
    return { k, kPrev, a, monthly, monthlyByCat, rows, growth, catCounts, gender, genderAll, base, baselineDay };
  }, [model, filters, p]);

  const { k, kPrev } = d;
  const months = p.months.map(fmtMonthShort);
  const vsPrev = labels.prevYear ? `vs ${labels.prevYear}` : 'no prior-year baseline';
  const deltaN = (now: number, prev: number | null | undefined) =>
    prev == null ? { value: null, text: '', caption: vsPrev } : { value: now - prev, text: fmtSignedInt(now - prev), caption: vsPrev, polarity: 'neutral' as const };

  const evoOption = useMemo(
    () =>
      evoMode === 'total'
        ? lines({ categories: months, series: [{ name: 'Active staff', data: d.monthly.map((x) => x.length), color: C.teal }], area: true, yMin: 'dataMin', endLabels: true, fmt: fmtInt })
        : bars({
            categories: months,
            series: CATEGORIES.map((cat, i) => ({ name: cat, data: d.monthlyByCat[i], color: CATEGORY_COLOR[cat] })),
            stack: true,
            total: true,
            fmt: fmtInt,
            barMax: 18,
          }),
    [evoMode, d, months],
  );

  const countryRows = d.rows;
  const countryNames = countryRows.map((r) => r.country);
  const tall = Math.max(260, countryRows.length * 24 + 60);

  const columns: Column<CountryRow>[] = [
    { key: 'country', header: 'Country', value: (r) => r.country, render: (r) => <span className="font-medium text-ink">{r.country}</span> },
    { key: 'region', header: 'Region', value: (r) => r.region },
    { key: 'total', header: 'Active staff', value: (r) => r.total, align: 'right', render: (r) => fmtInt(r.total) },
    { key: 'national', header: 'National', value: (r) => r.national, align: 'right', render: (r) => fmtInt(r.national) },
    { key: 'international', header: 'Intl. / Global / HQ', value: (r) => r.international, align: 'right', render: (r) => fmtInt(r.international) },
    { key: 'nationalShare', header: '% National', value: (r) => r.nationalShare, align: 'right', render: (r) => fmtPct(r.nationalShare) },
    { key: 'female', header: '% Women', value: (r) => r.female, align: 'right', render: (r) => fmtPct(r.female) },
    {
      key: 'change',
      header: 'Change YoY',
      value: (r) => r.change,
      align: 'right',
      render: (r) =>
        r.change == null ? '—' : <span className={r.change > 0 ? 'text-good' : r.change < 0 ? 'text-bad' : 'text-muted'}>{fmtSignedInt(r.change)}</span>,
    },
  ];

  return (
    <Layout title="Workforce Overview" description="Executive view of the active workforce: size, composition and growth across countries of operation and staff categories.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard
          icon={UsersRound}
          label="Total Active Staff"
          value={fmtInt(k.headcount)}
          delta={deltaN(k.headcount, k.headcount_prev_year)}
          spark={d.monthly.map((x) => x.length)}
          sub={`Headcount on ${labels.asOf}`}
          info="Employees holding an active contract on the reporting date (contract start ≤ date ≤ contract end). Contracts never overlap, so each person is counted once."
        />
        <KpiCard
          icon={TrendingUp}
          label="Headcount Growth YoY"
          value={fmtSignedPct(k.headcount_growth_yoy)}
          delta={kPrev?.headcount_growth_yoy != null && k.headcount_growth_yoy != null ? { value: k.headcount_growth_yoy - kPrev.headcount_growth_yoy, text: fmtPp(k.headcount_growth_yoy - kPrev.headcount_growth_yoy), caption: 'vs growth a year earlier', polarity: 'neutral' } : undefined}
          sub={k.headcount_prev_year != null ? `${fmtInt(k.headcount_prev_year)} → ${fmtInt(k.headcount)} active staff` : 'Requires 12 months of history'}
          info="(Headcount on reporting date ÷ headcount on the same date one year earlier) − 1."
        />
        <KpiCard
          icon={Plane}
          tone="burgundy"
          label="International Staff"
          value={fmtInt(k.international_staff)}
          delta={deltaN(k.international_staff, kPrev?.international_staff)}
          sub={`${fmtPct(ratio(k.international_staff, k.headcount))} of workforce · excl. Global & HQ`}
          info="Active staff in the International Staff category (internationally recruited, assigned to a country office). Global non-HQ and HQ staff are reported separately to avoid double counting."
        />
        <KpiCard
          icon={Flag}
          label="National Staff"
          value={fmtInt(k.national_staff)}
          delta={deltaN(k.national_staff, kPrev?.national_staff)}
          sub={`${fmtPct(ratio(k.national_staff, k.headcount))} of workforce`}
          info="Active staff recruited nationally in their country of operation (National Staff category)."
        />
        <KpiCard
          icon={Scale}
          tone="burgundy"
          label="Gender Balance"
          value={fmtPct(k.female_share)}
          unit="women"
          delta={kPrev?.female_share != null && k.female_share != null ? { value: k.female_share - kPrev.female_share, text: fmtPp(k.female_share - kPrev.female_share), caption: vsPrev, polarity: 'up-good' } : undefined}
          sub={`${fmtInt(d.genderAll.get('Female') ?? 0)} women · ${fmtInt(d.genderAll.get('Male') ?? 0)} men`}
          info="Women ÷ (women + men) among active staff. Records without gender (see Data Quality) are excluded from the denominator. Includes HQ staff."
        />
        <KpiCard
          icon={Earth}
          label="Countries of Operation"
          value={fmtInt(k.countries_of_operation)}
          sub="Countries with active staff, excluding HQ"
          info="Distinct countries of assignment with at least one active contract on the reporting date, excluding Switzerland (HQ)."
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <ChartCard
          className="xl:col-span-8"
          title="Monthly Workforce Evolution"
          subtitle={`Month-end headcount · ${labels.period}`}
          info="Headcount measured on the last day of each month, split by staff category. Each employee is counted once in the category of their active contract."
          actions={
            <Segmented
              label="Evolution view"
              value={evoMode}
              onChange={setEvoMode}
              options={[
                { value: 'category', label: 'By category' },
                { value: 'total', label: 'Total' },
              ]}
            />
          }
          empty={k.headcount === 0 && d.monthly.every((x) => x.length === 0)}
        >
          <EChart option={evoOption} height={320} label="Monthly workforce evolution" />
        </ChartCard>

        <ChartCard className="xl:col-span-4" title="Staff Type Distribution" subtitle={`Active staff by category · ${labels.asOf}`} empty={k.headcount === 0}
          info="Mutually exclusive staff categories: National, International, Global non-HQ (international staff in global teams outside headquarters) and HQ (headquarters).">
          <EChart
            option={donut(d.catCounts.map((c) => ({ name: c.cat, value: c.n, color: CATEGORY_COLOR[c.cat] })), { value: fmtInt(k.headcount), label: 'active staff' })}
            height={200}
            label="Staff type distribution"
          />
          <div className="mt-3">
            <ValueLegend items={d.catCounts.map((c) => ({ name: c.cat, color: CATEGORY_COLOR[c.cat], value: fmtInt(c.n), share: fmtPct(ratio(c.n, k.headcount)) }))} />
          </div>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard title="Staff by Country" subtitle={`Active staff by country of assignment and category · ${labels.asOf}`} empty={!countryRows.length}
          info="Headcount on the reporting date by country of assignment. HQ staff are assigned to the headquarters country (Switzerland); Global non-HQ staff to regional hubs.">
          <EChart
            height={tall}
            label="Staff by country"
            option={bars({
              categories: countryNames,
              horizontal: true,
              stack: true,
              total: true,
              fmt: fmtInt,
              barMax: 14,
              series: CATEGORIES.map((cat) => ({
                name: cat,
                color: CATEGORY_COLOR[cat],
                data: countryRows.map((r) => d.a.filter((c) => c.country === r.country && c.staff_category === cat).length || null),
              })).filter((s) => s.data.some((x) => x)),
            })}
          />
        </ChartCard>

        <ChartCard title="National vs International Staff" subtitle={`Share of each country's workforce · ${labels.asOf}`} empty={!countryRows.length}
          info="National Staff vs internationally recruited staff (International, Global non-HQ and HQ categories) as a percentage of each country's active headcount.">
          <EChart
            height={tall}
            label="National versus international staff by country"
            option={bars({
              categories: countryNames,
              horizontal: true,
              stack: true,
              barMax: 14,
              yMax: 100,
              axisFmt: (v) => `${v}%`,
              series: [
                { name: 'National', color: C.teal, data: countryRows.map((r) => (r.total ? (r.national / r.total) * 100 : null)) },
                { name: 'International (incl. Global & HQ)', color: C.burgundy, data: countryRows.map((r) => (r.total ? (r.international / r.total) * 100 : null)) },
              ],
              tooltipValue: (s, i) => {
                const r = countryRows[i];
                const n = s === 0 ? r.national : r.international;
                return `${fmtInt(n)} · ${fmtPct(ratio(n, r.total))}`;
              },
              extra: (i) => foot(`Total active staff <b style="float:right;color:#19232D">${fmtInt(countryRows[i].total)}</b>`),
            })}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard title="Gender Distribution" subtitle={`Share of women and men by staff category · ${labels.asOf}`} empty={!d.gender.length}
          info="Gender split of active staff per category, including HQ staff. 'Not recorded' shows records with missing gender in source systems.">
          <EChart
            height={Math.max(200, d.gender.length * 52 + 60)}
            label="Gender distribution by staff category"
            option={bars({
              categories: d.gender.map((g) => g.cat),
              horizontal: true,
              stack: true,
              yMax: 100,
              barMax: 22,
              axisFmt: (v) => `${v}%`,
              series: [
                { name: 'Female', color: GENDER_COLOR.Female, data: d.gender.map((g) => (g.F / g.total) * 100) },
                { name: 'Male', color: GENDER_COLOR.Male, data: d.gender.map((g) => (g.M / g.total) * 100) },
                { name: 'Not recorded', color: GENDER_COLOR['Not recorded'], data: d.gender.map((g) => (g.U ? (g.U / g.total) * 100 : null)) },
              ],
              tooltipValue: (s, i) => {
                const g = d.gender[i];
                const n = [g.F, g.M, g.U][s];
                return `${fmtInt(n)} · ${fmtPct(n / g.total)}`;
              },
            })}
          />
          <div className="mt-4">
            <StatRow
              items={[
                { label: 'Women (all staff)', value: fmtPct(k.female_share), hint: `${fmtInt(d.genderAll.get('Female') ?? 0)} of ${fmtInt(k.headcount)}` },
                ...d.gender.slice(0, 5).map((g) => ({ label: g.cat.replace(' Staff', ''), value: fmtPct(ratio(g.F, g.F + g.M)), hint: `${fmtInt(g.F)} women · ${fmtInt(g.M)} men` })),
              ]}
            />
          </div>
        </ChartCard>

        <ChartCard
          title="Workforce Growth by Country"
          subtitle={`Change in active staff from ${fmtMonthShort(filters.from - 1)} (period start) to ${labels.asOfMonth}`}
          empty={!d.growth.length}
          info="Headcount on the reporting date minus headcount on the day before the selected period starts. Positive = growth, negative = reduction."
        >
          <EChart
            height={Math.max(260, d.growth.length * 22 + 40)}
            label="Workforce growth by country"
            option={{
              ...bars({
                categories: d.growth.map((g) => g.country),
                horizontal: true,
                barMax: 12,
                labels: true,
                labelFmt: (v) => fmtSignedInt(v),
                series: [{ name: 'Change in headcount', color: C.teal, data: d.growth.map((g) => g.delta) }],
                tooltipValue: (_s, i) => fmtSignedInt(d.growth[i].delta),
                extra: (i) => {
                  const g = d.growth[i];
                  return row(C.prev, `Start (${fmtMonthShort(filters.from - 1)})`, fmtInt(g.base)) + row(C.teal, `End (${labels.asOfMonth})`, fmtInt(g.now)) +
                    foot(`Change <b style="float:right;color:#19232D">${fmtSignedPct(g.base ? g.delta / g.base : null)}</b>`);
                },
              }),
              series: [
                {
                  type: 'bar',
                  name: 'Change in headcount',
                  barMaxWidth: 12,
                  data: d.growth.map((g) => ({
                    value: g.delta,
                    itemStyle: { color: g.delta >= 0 ? C.teal : C.burgundy, borderRadius: g.delta >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] },
                    label: { position: g.delta >= 0 ? 'right' : 'left' },
                  })),
                  label: { show: true, color: C.ink2, fontSize: 11, fontWeight: 600, formatter: (q: { value: unknown }) => fmtSignedInt(Number(q.value)) },
                },
              ],
              xAxis: {
                type: 'value',
                min: (v: { min: number }) => (v.min < 0 ? Math.floor(v.min * 1.35) : 0),
                max: (v: { max: number }) => Math.ceil(Math.max(v.max, 1) * 1.15),
                splitLine: { lineStyle: { color: C.grid } },
                axisLabel: { color: C.muted, fontSize: 11 },
              },
            }}
          />
        </ChartCard>
      </div>

      <ChartCard title="Country Summary" subtitle={`All countries of assignment · ${labels.asOf} · sortable and searchable`}
        info="One row per country of assignment with active staff on the reporting date. Change YoY compares with the same date one year earlier.">
        <DataTable
          caption="Country summary"
          rows={countryRows}
          columns={columns}
          rowKey={(r) => r.country}
          initialSort={{ key: 'total', dir: 'desc' }}
          pageSize={10}
          searchPlaceholder="Search country or region…"
        />
      </ChartCard>
    </Layout>
  );
}
