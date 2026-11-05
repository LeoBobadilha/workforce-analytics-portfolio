"""KPI calculation tests: hand-checked toy dataset + sanity/consistency checks on the full model."""
import datetime as dt

import pandas as pd
import pytest

from kpis import Filters, compute

d = dt.date


def toy():
    emp = pd.DataFrame([
        # id, gender, birth, nationality, group, first_hire, latest_hire
        ("A", "Female", d(1990, 10, 31), "Kenya", "Global South", d(2020, 1, 1), d(2020, 1, 1)),
        ("B", "Male", d(1980, 10, 31), "France", "Global North", d(2025, 6, 1), d(2025, 6, 1)),
        ("C", "Female", None, "Sudan", "Global South", d(2023, 1, 1), d(2023, 1, 1)),
        ("D", "Male", d(1985, 10, 31), "Sudan", "Global South", d(2024, 3, 1), d(2024, 3, 1)),
    ], columns=["employee_id", "gender", "birth_date", "nationality", "nationality_group", "first_hire_date",
                "latest_hire_date"])
    ctr = pd.DataFrame([
        # contract, employee, start, end, planned_end, type, category, country
        ("C1", "A", d(2024, 1, 1), None, None, "Open-Ended", "International Staff", "Sudan"),
        ("C2", "B", d(2025, 6, 1), d(2026, 11, 30), d(2026, 11, 30), "Fixed-Term", "International Staff", "Chad"),
        ("C3", "C", d(2023, 1, 1), d(2026, 1, 31), d(2026, 12, 31), "Fixed-Term", "National Staff", "Sudan"),
        ("C4", "D", d(2024, 3, 1), d(2026, 12, 31), d(2026, 12, 31), "Fixed-Term", "National Staff", "Sudan"),
    ], columns=["contract_id", "employee_id", "start_date", "end_date", "planned_end_date", "contract_type",
                "staff_category", "country"])
    ctr["grade"] = "G3"
    sep = pd.DataFrame([("C", d(2026, 1, 31), "Voluntary", "Resignation", "National Staff", "Sudan")],
                       columns=["employee_id", "exit_date", "exit_type", "exit_reason", "staff_category", "country"])
    vac = pd.DataFrame([
        # id, country, category, opened, planned, closed, outcome
        ("V1", "Sudan", "National Staff", d(2026, 1, 15), d(2026, 3, 1), d(2026, 3, 16), "National Recruitment"),
        ("V2", "Sudan", "National Staff", d(2026, 9, 1), d(2026, 10, 1), None, None),        # open & due
        ("V3", "Chad", "International Staff", d(2026, 10, 1), d(2026, 12, 1), None, None),   # open, not due
        ("V4", "Chad", "International Staff", d(2026, 2, 1), d(2026, 4, 1), d(2026, 5, 1), "Cancelled Position"),
    ], columns=["vacancy_id", "country", "staff_category", "opened_date", "planned_close_date", "closed_date", "outcome"])
    for col in ("applicants", "shortlisted", "interviewed", "offers"):
        vac[col] = 0
    vac["dq_valid"] = True
    apr = pd.DataFrame([("A", d(2026, 2, 1)), ("D", d(2025, 6, 1))], columns=["employee_id", "appraisal_date"])
    srg = pd.DataFrame([("S1", "Sudan", d(2026, 3, 1), "Filled", "National Staff"),
                        ("S2", "Sudan", d(2026, 4, 1), "Filled", "International Staff"),
                        ("S3", "Chad", d(2026, 4, 1), "Cancelled", None)],
                       columns=["surge_id", "country", "request_date", "status", "deployed_category"])
    return dict(employees=emp, contracts=ctr, separations=sep, vacancies=vac, appraisals=apr, surges=srg)


def test_toy_headcount_and_profile():
    k = compute(toy(), Filters("2026-01", "2026-10"))
    assert k["headcount"] == 3                       # A, B, D active on 31 Oct 2026 (C left in January)
    assert k["headcount_prev_year"] == 4             # A, B (hired Jun 2025), C, D active on 31 Oct 2025
    assert k["headcount_growth_yoy"] == pytest.approx(3 / 4 - 1)
    assert k["international_staff"] == 2 and k["national_staff"] == 1
    assert k["female_share"] == pytest.approx(1 / 3)
    assert k["countries_of_operation"] == 2
    assert k["average_age"] == pytest.approx(((d(2026, 10, 31) - d(1990, 10, 31)).days + (d(2026, 10, 31) - d(1980, 10, 31)).days
                                              + (d(2026, 10, 31) - d(1985, 10, 31)).days) / 365.25 / 3)
    assert k["gs_share"] == pytest.approx(0.5)       # international scope: A (GS) and B (GN)
    assert k["expatriated_staff"] == 2               # A (Kenyan in Sudan), B (French in Chad)


def test_toy_recruitment():
    k = compute(toy(), Filters("2026-01", "2026-10"))
    assert k["open_vacancies"] == 2
    assert k["vacancy_rate"] == pytest.approx(2 / (3 + 2))
    assert k["due_vacancy_rate"] == pytest.approx(1 / (3 + 2))
    assert k["positions_filled"] == 1
    assert k["avg_time_to_hire_days"] == (d(2026, 3, 16) - d(2026, 1, 15)).days
    assert k["recruitment_success_rate"] == pytest.approx(0.5)


def test_toy_retention_turnover_appraisal():
    k = compute(toy(), Filters("2026-01", "2026-10"))
    # cohort on 31 Oct 2025 = A, B, C, D; still employed on 31 Oct 2026 = A, B, D
    assert k["headcount_prev_year"] == 4
    assert k["retention_rate"] == pytest.approx(3 / 4)
    assert k["voluntary_exits"] == 1 and k["involuntary_exits"] == 0
    # month-end headcount Jan..Oct 2026: Jan 4 (C ends 31 Jan, still active), Feb..Oct 3 -> avg 3.1
    assert k["turnover_rate_annualised"] == pytest.approx(1 / 3.1 * 12 / 10)
    # eligible (>= 182 days tenure): A, B, D -> appraisal in last 12 months: A only (D's was June 2025)
    assert k["appraisal_completion"] == pytest.approx(1 / 3)


def test_toy_contracts_and_surges():
    k = compute(toy(), Filters("2026-01", "2026-10"))
    # window [31 Oct 2026, 28 Feb 2027]: B (30 Nov) and D (31 Dec)
    assert k["contracts_expiring_4m"] == 2
    assert k["intl_expiring_share"] == pytest.approx(1 / 2)
    assert k["surge_requests"] == 3
    assert k["surge_national_share"] == pytest.approx(0.5)


def test_toy_filters():
    k = compute(toy(), Filters("2026-01", "2026-10", country="Sudan"))
    assert k["headcount"] == 2
    assert k["open_vacancies"] == 1
    k = compute(toy(), Filters("2026-01", "2026-10", category="National Staff"))
    assert k["headcount"] == 1 and k["international_staff"] == 0


# ---------------------------------------------------------------- full model
def test_category_headcounts_add_up(model):
    k = compute(model, Filters())
    assert k["headcount"] == k["national_staff"] + k["international_staff"] + k["hq_staff"] + k["global_non_hq_staff"]
    by_cat = sum(compute(model, Filters(category=c))["headcount"] for c in
                 ("National Staff", "International Staff", "HQ Staff", "Global non-HQ Staff"))
    assert by_cat == k["headcount"]


def test_country_headcounts_add_up(model):
    total = compute(model, Filters())["headcount"]
    countries = model["contracts"].country.unique()
    assert sum(compute(model, Filters(country=c))["headcount"] for c in countries) == total


@pytest.mark.parametrize("name,lo,hi", [
    ("vacancy_rate", 0.01, 0.12), ("due_vacancy_rate", 0.0, 0.06), ("retention_rate", 0.7, 0.95),
    ("turnover_rate_annualised", 0.08, 0.35), ("appraisal_completion", 0.6, 0.98),
    ("recruitment_success_rate", 0.8, 0.99), ("female_share", 0.3, 0.6), ("gs_share", 0.3, 0.7),
    ("intl_expiring_share", 0.05, 0.6), ("avg_time_to_hire_days", 30, 120), ("average_age", 28, 45),
])
def test_kpi_plausible_ranges(model, name, lo, hi):
    v = compute(model, Filters())[name]
    assert lo <= v <= hi, f"{name}={v}"


def test_vacancy_rate_denominator(model):
    k = compute(model, Filters())
    assert k["vacancy_rate"] == pytest.approx(k["open_vacancies"] / (k["headcount"] + k["open_vacancies"]))
    assert k["due_vacancy_rate"] <= k["vacancy_rate"]
