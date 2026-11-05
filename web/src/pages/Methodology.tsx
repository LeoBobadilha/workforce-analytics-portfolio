import { ArrowRight, Database, ExternalLink, FileSpreadsheet, GitMerge, LayoutDashboard, ShieldCheck, Ticket } from 'lucide-react';
import { LINKEDIN_URL, Layout, REPO_URL } from '../components/Layout';
import { Card } from '../components/ui';
import { CATEGORY_COLOR } from '../charts/theme';
import { fmtInt } from '../lib/format';
import { useApp } from '../state/AppData';

const KPIS: { group: string; items: [string, string][] }[] = [
  {
    group: 'Conventions',
    items: [
      ['Reporting date (D)', 'Last day of the "to" month of the selected period. Stock indicators (headcount, open vacancies, active contracts) are measured on D.'],
      ['Period (P)', 'First day of the "from" month to D. Flow indicators (exits, hires, closures, surges) count events dated inside P.'],
      ['Comparison', 'Year-over-year deltas compare with the same month-end one year earlier (simulated history starts Jan 2023, so 2024 has a baseline).'],
      ['Filters', 'Country and staff category apply to the attributes of the record on its own date (active contract, exit record, vacancy position).'],
    ],
  },
  {
    group: 'Workforce',
    items: [
      ['Active staff', 'Count of contracts with start ≤ D ≤ end. Contracts never overlap per employee (rule CTR-08) → each person counted once.'],
      ['Headcount growth YoY', 'Headcount(D) ÷ Headcount(D − 12 months) − 1.'],
      ['Gender balance', 'Women ÷ (women + men) among active staff; records without gender excluded from the denominator.'],
      ['Countries of operation', 'Distinct countries of assignment with ≥ 1 active contract on D, excluding Switzerland (HQ).'],
      ['Global vs International', 'Global = HQ Staff + Global non-HQ Staff. International = International Staff (non-Global).'],
      ['Average age', 'Mean of (D − birth date) / 365.25 for staff with a valid birth date.'],
    ],
  },
  {
    group: 'Diversity & Mobility',
    items: [
      ['Relevant workforce', 'HQ + Global non-HQ + International Staff (National Staff are nationals of the country of operation). If a category filter is set, that category.'],
      ['Global South share', 'GS nationals ÷ (GS + GN nationals) in the relevant workforce on D. Nationality not recorded → excluded. GN = high-income OECD-DAC countries (illustrative).'],
      ['Expatriated staff', 'Proxy: active staff whose nationality ≠ country of assignment (all categories in the filter). Not an official expatriation status; a production model would use the HRIS status. Reconciled against the Excel expatriation tracker (rule REC-03).'],
      ['Surge national share', 'Filled surges deployed with a National Staff contract ÷ all filled surges requested in P.'],
    ],
  },
  {
    group: 'Recruitment & Vacancies',
    items: [
      ['Open vacancies', 'Opened ≤ D and (closed > D or not closed).'],
      ['Vacancy rate', 'Open vacancies(D) ÷ [Headcount(D) + Open vacancies(D)] — total positions.'],
      ['Due vacancy rate', 'Open vacancies whose due date (initially planned closure) < D ÷ the same total positions.'],
      ['Duration to close', 'Closed date − opened date for vacancies filled in P (cancellations excluded). JIRA time_to_done_hours is an operational ticket measure and is not used.'],
      ['Success rate', 'Vacancies closed with a hire ÷ all vacancies closed in P (hires + cancelled positions).'],
      ['Invalid records', 'Vacancies with a resolution date before creation (VAC-05) are excluded from all recruitment metrics.'],
    ],
  },
  {
    group: 'Retention & Development',
    items: [
      ['Retention rate', 'Staff active on D − 12 months (in the filter) still employed on D (any role or country) ÷ that cohort.'],
      ['Turnover (annualised)', 'Separations in P ÷ average month-end headcount in P × 12 ÷ months in P.'],
      ['Voluntary / involuntary', 'Voluntary: resignation, did not wish to renew, retirement. Involuntary: contract not renewed, end of project / funding, dismissal.'],
      ['Appraisal completion', 'Eligible staff (active on D with ≥ 182 days of continuous service) with an appraisal in (D − 365 days, D] ÷ eligible staff.'],
      ['Average tenure', 'Mean years since latest hire date (continuous service) of staff active on D.'],
    ],
  },
  {
    group: 'Global Workforce Explorer',
    items: [
      ['Active staff by country', 'Contracts active at the selected month-end (start ≤ D ≤ end) by country of assignment; HQ staff are counted in the HQ country. Same rule as Total Active Staff, so the map total equals the KPI.'],
      ['YoY change', 'Headcount(month-end) − headcount(same month-end one year earlier). % only when the earlier headcount is above zero; zero → "new"; month before the data → "no baseline".'],
      ['Not Workforce Growth by Country', 'That chart compares the reporting date with the start of the selected period; the map always compares with one year earlier.'],
      ['Bubbles and timeline', 'Bubble area ∝ value, on a scale fixed across the selected period. The month slider is local to the map and stays within the global period, country and category filters.'],
    ],
  },
  {
    group: 'Contracts',
    items: [
      ['Expiring in 4 months', 'Active contracts with planned end in [D, end of the 4th following month] (contracts ending on D included).'],
      ['Expiring international %', 'International Staff expiring within 4 months ÷ active International Staff.'],
      ['Average contract duration', '(Planned end − start + 1) / 30.4375 months, active contracts with a planned end date.'],
      ['Grades 3 & 4', 'International Staff G3/G4: duration of current contracts vs contracts granted to staff onboarded in P (new hire, rehire, internal mobility).'],
    ],
  },
];

const ABOUT: [string, string][] = [
  [
    'Overview',
    'Organisations operating across several countries often hold workforce data in an HRIS, a recruitment ticketing tool and local Excel trackers that overlap and disagree. I developed this portfolio project to show how such sources can be consolidated into one validated model and a consistent set of workforce indicators, using fully synthetic data to demonstrate source integration, KPI validation and interactive reporting.',
  ],
  [
    'Technical approach',
    'Three simulated sources (CORE HR, JIRA and historical Excel trackers) are standardised and merged with an explicit precedence, CORE HR > JIRA > Excel, so no person, contract or vacancy is counted twice. Validation rules flag, impute or exclude problem records, and the model is reconciled against historical snapshot trackers. Each KPI has a documented numerator, denominator and reporting date. The pipeline uses Python and pandas; the dashboards React, TypeScript and Apache ECharts. Automated pytest, Vitest and Playwright checks run in GitHub Actions before each deployment.',
  ],
  [
    'Development',
    'I worked with AI coding assistance (Claude Code) during development, including implementation and interface design, while guiding the requirements, reviewing results and refining the reporting logic.',
  ],
];

const STEPS = [
  { icon: Database, title: 'Extract', text: 'CORE HR CSV extracts, JIRA exports and historical Excel trackers (openpyxl).' },
  { icon: GitMerge, title: 'Transform', text: 'Column mapping, country / grade / outcome standardisation, mixed date formats, de-duplication with source precedence CORE > JIRA > Excel.' },
  { icon: ShieldCheck, title: 'Validate', text: 'Rule-based checks, enrichment from secondary sources, reconciliation with monthly snapshot trackers.' },
  { icon: LayoutDashboard, title: 'Serve', text: 'One compact, record-level model; all KPIs computed in the browser from the same base and cross-checked against a Python reference.' },
];

export default function Methodology() {
  const { dq, model } = useApp();
  return (
    <Layout title="Methodology & KPIs" description="About the project, how the synthetic sources are consolidated, how each indicator is calculated, and the known limitations of the demo.">
      <Card className="p-6">
        <h2 className="text-[15px] font-semibold">About this project</h2>
        <div className="mt-3 grid gap-x-8 gap-y-5 text-[13px] leading-relaxed text-ink-2 lg:grid-cols-3">
          {ABOUT.map(([h, t]) => (
            <div key={h}>
              <h3 className="text-[13px] font-semibold text-ink">{h}</h3>
              <p className="mt-1">{t}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-3 border-t border-line-2 pt-4 text-[13px] lg:flex-row lg:items-start lg:justify-between">
          <p className="max-w-3xl leading-relaxed text-ink-2">
            <b className="font-semibold text-ink">Relation to Power BI.</b> This is a web application, not a Power BI report. I chose
            a web build so the demonstration opens from a link, without signing into a Power BI workspace. The concepts transfer: the
            Python ETL does the kind of preparation often done in Power Query, the record-level tables are the foundation a semantic
            model would be built on, the TypeScript KPI logic could be translated into DAX measures, and the global filters play the
            role of report slicers.
          </p>
          <p className="flex flex-none flex-wrap gap-x-4 gap-y-1 lg:flex-col">
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-teal hover:underline">
              Source code on GitHub <ExternalLink size={13} aria-hidden />
            </a>
            <a href={LINKEDIN_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-teal hover:underline">
              LinkedIn <ExternalLink size={13} aria-hidden />
            </a>
          </p>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-[15px] font-semibold">Data pipeline</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-xl border border-line bg-page p-4">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-50 text-teal"><s.icon size={16} aria-hidden /></span>
                <span className="text-sm font-semibold">{i + 1}. {s.title}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted">{s.text}</p>
              {i < STEPS.length - 1 && <ArrowRight size={16} className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-faint md:block" aria-hidden />}
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {[
          { icon: Database, name: 'CORE HR', text: 'Employee master data, contracts, separations and performance appraisals. Holds International, Global and HQ staff for the full history and National Staff from the January 2025 go-live.', n: dq.lineage.filter((l) => l.source === 'CORE HR').reduce((s, l) => s + l.records, 0) },
          { icon: Ticket, name: 'JIRA Recruitment', text: 'Recruitment requests from 2025 (status, resolution, due date, funnel, time_to_done_hours) and surge requests from 2026. Vacancies still open at go-live were migrated with their legacy reference.', n: dq.lineage.filter((l) => l.source.startsWith('JIRA')).reduce((s, l) => s + l.records, 0) },
          { icon: FileSpreadsheet, name: 'Historical Excel Trackers', text: 'National staff tracker 2023–2024, vacancy tracker 2022–2024, surge tracker 2023–2025, monthly national headcount snapshots and an expatriation tracker used for reconciliation.', n: dq.lineage.filter((l) => l.source.startsWith('Excel')).reduce((s, l) => s + l.records, 0) },
        ].map((s) => (
          <Card key={s.name} className="p-5">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-burgundy-50 text-burgundy"><s.icon size={17} aria-hidden /></span>
              <div>
                <h3 className="text-sm font-semibold">{s.name}</h3>
                <p className="text-xs text-muted tabular">{fmtInt(s.n)} records extracted</p>
              </div>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{s.text}</p>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <h2 className="text-[15px] font-semibold">Staff categories (mutually exclusive)</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            ['National Staff', 'Recruited nationally in the country of operation.'],
            ['International Staff', 'Internationally recruited, assigned to a country office (non-Global).'],
            ['Global non-HQ Staff', 'International staff working for global teams but based in regional hubs.'],
            ['HQ Staff', 'Staff based at headquarters.'],
          ].map(([n, t]) => (
            <div key={n} className="rounded-xl border border-line p-4">
              <p className="flex items-center gap-2 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: CATEGORY_COLOR[n as keyof typeof CATEGORY_COLOR] }} />{n}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{t}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">The category belongs to the contract, so an employee moving from National to International Staff is counted once, in the new category from the start date of the new contract.</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {KPIS.map((g) => (
          <Card key={g.group} className="p-6">
            <h2 className="text-[15px] font-semibold">{g.group}</h2>
            <dl className="mt-3 divide-y divide-line-2">
              {g.items.map(([k, v]) => (
                <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
                  <dt className="text-[13px] font-medium text-ink">{k}</dt>
                  <dd className="text-[13px] leading-relaxed text-ink-2">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <h2 className="text-[15px] font-semibold">Validation & known limitations</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
          <li>{dq.rules_total} automated rules; {fmtInt(dq.issues_total)} issues detected, {fmtInt(dq.issues_resolved)} resolved automatically, {fmtInt(dq.records_merged)} overlapping records merged. Details on the Contracts & Data Quality page.</li>
          <li>Python tests (pytest) check referential integrity, absence of overlapping contracts and that the consolidated model reproduces the simulated monthly headcount exactly; TypeScript tests (Vitest) check that the dashboard KPI engine matches an independent pandas implementation across filter scenarios.</li>
          <li>Staff with missing nationality are excluded from GN/GS ratios; missing or implausible birth dates are excluded from age metrics.</li>
          <li>Surge indicators use the country filter (requesting country office) only; the staff-category filter does not apply.</li>
          <li>Expatriation uses nationality ≠ country of assignment as a proxy; it is not an official expatriation status. Staff without a recorded nationality are one identified source of mismatch with the historical expatriation tracker: differences within that range are treated as explainable, and the remaining {fmtInt(dq.rules.find((r) => r.rule_id === 'REC-03')?.issues_found ?? 0)} country-month values are flagged (rule REC-03).</li>
                    <li>Global North / South classification is illustrative and should be replaced by the organisation's own reference list.</li>
          <li>All records are generated by a seeded simulation (seed {model.meta.seed}); they resemble real HR processes but describe no real person, organisation or workforce statistic.</li>
        </ul>
      </Card>
    </Layout>
  );
}
