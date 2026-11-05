# KPI Definitions

Every indicator in the dashboards is computed **in the browser** from one record-level model
(`web/public/data/hr_model.json`) by [`web/src/lib/metrics.ts`](../web/src/lib/metrics.ts).
An independent pandas implementation ([`pipeline/kpis.py`](../pipeline/kpis.py)) computes the same
headline KPIs for several filter scenarios, and [`web/src/lib/metrics.test.ts`](../web/src/lib/metrics.test.ts)
asserts that both agree to 6 decimal places.

## Conventions

| Term | Definition |
|---|---|
| **Reporting date (D)** | Last calendar day of the "to" month of the selected period. Stock indicators are measured on D. |
| **Period (P)** | From the first day of the "from" month to D. Flow indicators count events dated inside P. |
| **Previous year (D − 12m)** | Same month-end one year earlier. The simulation starts in January 2023, so 2024 has a 12-month baseline. |
| **Active** | A contract is active on day *d* when `start_date ≤ d ≤ end_date` (no end date = open-ended). |
| **Filters** | *Country* and *staff category* are applied to the attributes of each record on its own date: the active contract (stocks), the separation record (exits), the position (vacancies). |
| **One person, one category** | Contracts never overlap for the same employee (validation rule CTR-08), so each person is counted once, in the category of their active contract. |

### Staff categories (mutually exclusive)

| Category | Definition |
|---|---|
| National Staff | Recruited nationally in the country of operation. |
| International Staff | Internationally recruited and assigned to a country office (non-Global). |
| Global non-HQ Staff | International staff working for global teams but based outside HQ (regional hubs). |
| HQ Staff | Based at headquarters. |
| *Global* population | HQ Staff + Global non-HQ Staff. |
| *International* population | International Staff. |

## 1 · Workforce Overview

| KPI | Formula |
|---|---|
| Total Active Staff | Count of active contracts on D. |
| Headcount Growth YoY | `Headcount(D) / Headcount(D − 12m) − 1`. |
| International Staff | Active staff in the International Staff category (share = ÷ total active staff). |
| National Staff | Active staff in the National Staff category. |
| Gender Balance | `women / (women + men)` among active staff; missing gender excluded from the denominator. |
| Countries of Operation | Distinct countries of assignment with ≥ 1 active contract on D, excluding Switzerland (HQ). |
| Workforce Growth by Country | `Headcount(D) − Headcount(day before period start)` per country. |

### Global Workforce Explorer (3D globe and 2D map on the Workforce Overview)

| Metric | Definition |
|---|---|
| Map month (M) | Local timeline month, within the global period; defaults to the reporting month. Changing it does not change the dashboard reporting date. |
| Active staff by country | Contracts active on the last day of M (`start ≤ D ≤ end`) by country of assignment, under the global country and staff-category filters. HQ staff are counted in the HQ country. Summed over countries it equals Total Active Staff for the same date and filters. |
| YoY change | `Headcount(M) − Headcount(M − 12 months)` per country. |
| YoY change % | `YoY change ÷ Headcount(M − 12 months)`, only when that headcount is above zero. Zero → shown as *new (no prior-year staff)*; a comparison month before the data starts → *no baseline* (never shown as zero growth). |
| Difference from Workforce Growth by Country | That chart compares D with the day before the selected period starts; the map always compares with the same month-end one year earlier. |
| Bubble size | Area proportional to the value (diameter ∝ √value), on a scale fixed across the selected period so months are comparable; values below the 5 px visibility floor are enlarged to it. |
| Colour | Direction of the YoY change: teal growth, burgundy reduction, grey unchanged, dashed outline no baseline. Each state also has a ▲ ▼ = – glyph in labels and lists. |
| Globe column height | Linear in the value on a scale fixed across the selected period: headcount ÷ largest country headcount (Active staff), or \|YoY change\| ÷ largest \|change\| (YoY change); a minimum visible height of 1.2 % of the tallest column. In YoY mode, a country without a baseline is a ring with no column; in Active-staff mode it gets a column plus a ring. |
| Globe marker position | The country's Natural Earth label point (the same anchor as the 2D bubble); it represents the country total, not a location of staff. |
| Guided exploration | The 3 largest positive and 3 largest negative YoY changes at the selected month and filters (countries without a baseline excluded). Equal changes share a rank and are labelled *joint*; order within a tie follows the ranked list (larger headcount, then name). |
| Largest increase / reduction (summary panel) | The largest positive and the most negative YoY change among countries with a baseline. Every country tied at that value is named (*Sudan and Chad ▲ +13 each*; more than three: *A, B and N others*, full list in the accessible label). Same ordering as the YoY ranked list and the tour. |

## 2 · Global Workforce Profile

| KPI | Formula |
|---|---|
| Global / International Workforce | Active staff in the Global (HQ + Global non-HQ) / International populations on D. |
| Average Employee Age | Mean of `(D − birth_date) / 365.25` for staff with a valid birth date (rule EMP-05 removes implausible dates). |
| Distribution by Country vs Previous Year | International workforce (HQ + Global non-HQ + International, or the selected category) by country on D and on D − 12m. |
| Average Age Evolution | Average age at each month-end in P, per population. |

## 3 · Diversity & Mobility

| KPI | Formula |
|---|---|
| Relevant workforce | HQ + Global non-HQ + International Staff (National Staff are nationals of the country of operation). If a staff-category filter is set, that category. |
| Global South Share | `GS / (GS + GN)` nationals in the relevant workforce on D. Staff without recorded nationality are excluded. |
| GS : GN Ratio | `GS / GN`. |
| Nationality classification | Global North = high-income OECD-DAC countries (illustrative list in `pipeline/config.py`); all others = Global South. |
| GN/GS toggle | Filters gender, contract type, nationality ranking, geographic diversity and expatriation charts to one group, so no duplicated pages are needed. |
| Expatriated Staff | Proxy: active staff whose nationality ≠ country of assignment. Not an official expatriation status; a production model would use the HRIS status. Reconciled against the Excel expatriation tracker (REC-03): differences within the number of staff with no recorded nationality are treated as explainable, the rest are flagged. |
| Surge national share | Filled surges where the deployed person held a National Staff contract ÷ all filled surges requested in P. The country filter applies to the requesting country office; the category filter does not apply to surges. |

## 4 · Recruitment & Vacancies

| KPI | Formula |
|---|---|
| Open Vacancies | `opened_date ≤ D` and (`closed_date > D` or not closed). |
| Vacancy Rate | **Numerator:** open vacancies on D. **Denominator:** total positions = active headcount(D) + open vacancies(D), same filters. |
| Due Vacancy Rate | **Numerator:** open vacancies whose due date (initially planned closure) is before D. **Denominator:** the same total positions. |
| Average Time to Hire | Duration to close = `closed_date − opened_date`, averaged over vacancies **filled** in P (cancellations excluded). |
| Positions Filled | Vacancies closed in P with outcome National Recruitment, External Recruitment or Internal Mobility. |
| Recruitment Success Rate | Filled ÷ all vacancies closed in P (filled + Cancelled Position). |
| Initial planned duration | `due_date − opened_date`. Missing JIRA due dates are imputed from the standard duration (rule VAC-09). |
| Excluded records | Vacancies whose resolution date is before their creation date (rule VAC-05) are excluded from all recruitment metrics. |

`time_to_done_hours` (JIRA) measures ticket creation → ticket done, **including onboarding admin**, so it is consistently longer than the
duration to close. It is kept in the model for comparison but not used for the KPI.

## 5 · Retention & Development

| KPI | Formula |
|---|---|
| Staff Retention Rate | Cohort = staff active on D − 12m (in the filter). Retained = members of the cohort still employed on D (any role or country). Rate = retained ÷ cohort. |
| Annual Turnover Rate | `separations in P / average month-end headcount in P × 12 / months in P`. Internal mobility is not a separation. |
| Voluntary Exits | Resignation, did not wish to renew, retirement. |
| Involuntary Exits | Contract not renewed, end of project / funding, dismissal. |
| Appraisal Completion | Eligible = active on D with ≥ 182 days of continuous service. Completed = appraisal (annual or end-of-probation) dated in `(D − 365 days, D]`. Rate = completed ÷ eligible. |
| Average Tenure | Mean of `(D − latest_hire_date) / 365.25` for active staff (rehires restart the clock). |

## 6 · Contracts & Data Quality

| KPI | Formula |
|---|---|
| Active Contracts | Same as active staff (one contract per person). |
| Contracts Expiring in 4 Months | Active contracts with `planned_end_date` in `[D, last day of the 4th following month]`. Open-ended contracts never expire. |
| Expiring International Contracts (%) | International Staff expiring within 4 months ÷ active International Staff. |
| Average Contract Duration | Mean `(planned_end − start + 1) / 30.4375` months over active contracts with a planned end date. |
| Grades 3 & 4 analysis | International Staff G3/G4: mean duration of current contracts vs contracts granted to staff onboarded in P (new hire, rehire, internal mobility); expiries ≤ 4 months by grade. |
| Data Completeness | Populated key fields ÷ expected key fields in the consolidated model (pipeline run). |
| Data Quality Issues | Records failing a validation rule in the latest pipeline run (planned migration overlaps reported separately as merges). |
