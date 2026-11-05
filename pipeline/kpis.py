"""Reference (Python/pandas) implementation of every headline KPI shown in the dashboards.

The web application computes the same indicators client-side in TypeScript (web/src/lib/metrics.ts).
This module computes them independently from data/processed/*.csv for a set of filter scenarios and
writes data/processed/reference_kpis.json; the web test-suite asserts both implementations agree.

Definitions are documented in docs/KPI_DEFINITIONS.md.
"""
from __future__ import annotations

import calendar
import datetime as dt
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import HQ_COUNTRY, PROCESSED_DIR, SIM_START  # noqa: E402

INTERNATIONAL_SCOPE = ("HQ Staff", "Global non-HQ Staff", "International Staff")


def month_end(ym: str, shift: int = 0) -> dt.date:
    y, m = map(int, ym.split("-"))
    y, m = divmod(y * 12 + (m - 1) + shift, 12)
    return dt.date(y, m + 1, calendar.monthrange(y, m + 1)[1])


def month_start(ym: str) -> dt.date:
    y, m = map(int, ym.split("-"))
    return dt.date(y, m, 1)


def month_ends(from_ym: str, to_ym: str):
    d, end = month_end(from_ym), month_end(to_ym)
    i = 0
    while d <= end:
        yield d
        i += 1
        d = month_end(from_ym, i)


@dataclass
class Filters:
    from_month: str = "2024-01"
    to_month: str = "2026-10"
    country: str | None = None
    category: str | None = None


def load(processed: Path = PROCESSED_DIR):
    def rd(name, dates):
        df = pd.read_csv(processed / f"{name}.csv", dtype=str, keep_default_na=False, na_values=[""])
        for c in dates:
            df[c] = pd.to_datetime(df[c], errors="coerce").dt.date
        return df

    m = dict(
        employees=rd("employees", ["birth_date", "first_hire_date", "latest_hire_date"]),
        contracts=rd("contracts", ["start_date", "end_date", "planned_end_date"]),
        separations=rd("separations", ["exit_date"]),
        vacancies=rd("vacancies", ["opened_date", "planned_close_date", "closed_date"]),
        surges=rd("surges", ["request_date", "start_date", "end_date"]),
        appraisals=rd("appraisals", ["appraisal_date"]),
    )
    v = m["vacancies"]
    for c in ("applicants", "shortlisted", "interviewed", "offers"):
        v[c] = v[c].astype(int)
    v["dq_valid"] = v.dq_valid.map({"True": True, "False": False})
    return m


def _f(df, f: Filters, country_col="country", cat_col="staff_category"):
    if f.country:
        df = df[df[country_col] == f.country]
    if f.category and cat_col:
        df = df[df[cat_col] == f.category]
    return df


def active(m, d: dt.date, f: Filters):
    c = m["contracts"]
    c = c[(c.start_date <= d) & (c.end_date.isna() | (c.end_date >= d))]
    return _f(c, f)


def tenure_start(emp_row_first, emp_row_latest, d):
    return emp_row_latest if emp_row_latest <= d else emp_row_first


def compute(m, f: Filters) -> dict:
    D = month_end(f.to_month)
    P0 = month_start(f.from_month)
    prevD = month_end(f.to_month, -12)
    emp = m["employees"].set_index("employee_id")
    a = active(m, D, f)
    hc = len(a)
    out: dict = {"headcount": hc}
    a_prev = active(m, prevD, f) if prevD >= SIM_START else None
    out["headcount_prev_year"] = None if a_prev is None else len(a_prev)
    out["headcount_growth_yoy"] = None if not a_prev is not None or len(a_prev) == 0 else hc / len(a_prev) - 1
    out["international_staff"] = int((a.staff_category == "International Staff").sum())
    out["national_staff"] = int((a.staff_category == "National Staff").sum())
    out["hq_staff"] = int((a.staff_category == "HQ Staff").sum())
    out["global_non_hq_staff"] = int((a.staff_category == "Global non-HQ Staff").sum())
    g = a.employee_id.map(emp.gender)
    fm = int((g == "Female").sum())
    ml = int((g == "Male").sum())
    out["female_share"] = None if fm + ml == 0 else fm / (fm + ml)
    out["countries_of_operation"] = int(a.loc[a.country != HQ_COUNTRY[0], "country"].nunique())
    b = a.employee_id.map(emp.birth_date)
    ages = [(D - x).days / 365.25 for x in b if pd.notna(x)]
    out["average_age"] = None if not ages else sum(ages) / len(ages)

    # diversity (relevant workforce)
    rel = a if f.category else a[a.staff_category.isin(INTERNATIONAL_SCOPE)]
    grp = rel.employee_id.map(emp.nationality_group)
    gs, gn = int((grp == "Global South").sum()), int((grp == "Global North").sum())
    out["gs_share"] = None if gs + gn == 0 else gs / (gs + gn)
    nat = a.employee_id.map(emp.nationality)
    out["expatriated_staff"] = int((nat.notna() & (nat != a.country)).sum())

    # recruitment
    v = _f(m["vacancies"], f)
    v = v[v.dq_valid]
    open_d = v[(v.opened_date <= D) & (v.closed_date.isna() | (v.closed_date > D))]
    out["open_vacancies"] = len(open_d)
    denom = hc + len(open_d)
    out["vacancy_rate"] = None if denom == 0 else len(open_d) / denom
    out["due_vacancy_rate"] = None if denom == 0 else int((open_d.planned_close_date < D).sum()) / denom
    closed_p = v[v.closed_date.notna() & (v.closed_date >= P0) & (v.closed_date <= D)]
    filled = closed_p[closed_p.outcome != "Cancelled Position"]
    cancelled = closed_p[closed_p.outcome == "Cancelled Position"]
    out["positions_filled"] = len(filled)
    out["avg_time_to_hire_days"] = None if len(filled) == 0 else \
        sum((r.closed_date - r.opened_date).days for r in filled.itertuples()) / len(filled)
    out["recruitment_success_rate"] = None if len(closed_p) == 0 else len(filled) / (len(filled) + len(cancelled))

    # retention & turnover
    if a_prev is not None and len(a_prev):
        still = set(active(m, D, Filters()).employee_id)
        out["retention_rate"] = sum(e in still for e in a_prev.employee_id) / len(a_prev)
    else:
        out["retention_rate"] = None
    s = _f(m["separations"], f)
    s = s[(s.exit_date >= P0) & (s.exit_date <= D)]
    out["voluntary_exits"] = int((s.exit_type == "Voluntary").sum())
    out["involuntary_exits"] = int((s.exit_type == "Involuntary").sum())
    mes = list(month_ends(f.from_month, f.to_month))
    avg_hc = sum(len(active(m, d, f)) for d in mes) / len(mes)
    out["turnover_rate_annualised"] = None if avg_hc == 0 else len(s) / avg_hc * 12 / len(mes)
    first = a.employee_id.map(emp.first_hire_date)
    latest = a.employee_id.map(emp.latest_hire_date)
    starts = [l if l <= D else fh for fh, l in zip(first, latest)]
    out["average_tenure_years"] = None if hc == 0 else sum((D - x).days / 365.25 for x in starts) / hc
    eligible = [e for e, st in zip(a.employee_id, starts) if (D - st).days >= 182]
    apr = m["appraisals"]
    apr = apr[(apr.appraisal_date > D - dt.timedelta(days=365)) & (apr.appraisal_date <= D)]
    done = set(apr.employee_id)
    out["appraisal_completion"] = None if not eligible else sum(e in done for e in eligible) / len(eligible)

    # contracts
    win_end = month_end(f.to_month, 4)
    exp = a[a.planned_end_date.notna() & (a.planned_end_date >= D) & (a.planned_end_date <= win_end)]
    out["contracts_expiring_4m"] = len(exp)
    intl = a[a.staff_category == "International Staff"]
    intl_exp = exp[exp.staff_category == "International Staff"]
    out["intl_expiring_share"] = None if len(intl) == 0 else len(intl_exp) / len(intl)
    fixed = a[a.planned_end_date.notna()]
    out["avg_contract_duration_months"] = None if len(fixed) == 0 else \
        sum(((r.planned_end_date - r.start_date).days + 1) / 30.4375 for r in fixed.itertuples()) / len(fixed)

    # surges (country filter = requesting country; category not applicable)
    sg = m["surges"]
    if f.country:
        sg = sg[sg.country == f.country]
    sg = sg[(sg.request_date >= P0) & (sg.request_date <= D)]
    out["surge_requests"] = len(sg)
    fs = sg[sg.status == "Filled"]
    out["surge_national_share"] = None if len(fs) == 0 else float((fs.deployed_category == "National Staff").mean())
    return out


SCENARIOS = {
    "all_default": Filters(),
    "sudan_2025": Filters("2025-01", "2025-12", country="Sudan"),
    "international_all": Filters(category="International Staff"),
    "kenya_global_2026": Filters("2026-01", "2026-10", country="Kenya", category="Global non-HQ Staff"),
    "national_2024": Filters("2024-01", "2024-12", category="National Staff"),
    "ukraine_last12": Filters("2025-11", "2026-10", country="Ukraine"),
}


def main():
    m = load()
    ref = {}
    for name, f in SCENARIOS.items():
        ref[name] = {"filters": f.__dict__, "kpis": compute(m, f)}
    (PROCESSED_DIR / "reference_kpis.json").write_text(json.dumps(ref, indent=1, default=str))
    for name, r in ref.items():
        k = r["kpis"]
        print(name, {x: (round(y, 4) if isinstance(y, float) else y) for x, y in list(k.items())[:12]})
    print(json.dumps({x: (round(y, 4) if isinstance(y, float) else y) for x, y in ref["all_default"]["kpis"].items()}, indent=0))


if __name__ == "__main__":
    main()
