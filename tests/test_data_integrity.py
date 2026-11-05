"""Data-quality and referential-integrity tests on the consolidated model (data/processed)."""
import datetime as dt

import pandas as pd

from config import CATEGORIES, COUNTRIES, DEPARTMENTS, GRADES, HQ_COUNTRY, SIM_END, SIM_START
from kpis import month_ends

VALID_COUNTRIES = {c[0] for c in COUNTRIES} | {HQ_COUNTRY[0]}


def test_primary_keys_unique(model):
    assert model["employees"].employee_id.is_unique
    assert model["contracts"].contract_id.is_unique
    assert model["vacancies"].vacancy_id.is_unique
    assert model["surges"].surge_id.is_unique


def test_reference_values_valid(model):
    c = model["contracts"]
    assert c.staff_category.isin(CATEGORIES).all()
    assert c.grade.isin(GRADES).all()
    assert c.country.isin(VALID_COUNTRIES).all()
    assert c.department.isin(DEPARTMENTS).all()
    assert c.contract_type.isin(["Open-Ended", "Fixed-Term", "Short-Term"]).all()
    assert (c.loc[c.staff_category == "HQ Staff", "country"] == "Switzerland").all()
    assert (c.loc[c.country == "Switzerland", "staff_category"] == "HQ Staff").all()
    v = model["vacancies"]
    assert v.country.isin(VALID_COUNTRIES).all()
    closed = v[v.status == "Closed"]
    assert closed.outcome.isin(["National Recruitment", "Internal Mobility", "External Recruitment",
                                "Cancelled Position"]).all()


def test_contract_dates_ordered(model):
    c = model["contracts"]
    assert (c.end_date.isna() | (c.end_date >= c.start_date)).all()
    fixed = c[c.contract_type != "Open-Ended"]
    assert fixed.planned_end_date.notna().all(), "fixed/short-term contracts need a planned end date"


def test_no_overlapping_contracts(model):
    """One active contract per employee per day -> headcount can never double count."""
    c = model["contracts"].sort_values(["employee_id", "start_date"])
    prev_end = c.groupby("employee_id").end_date.shift()
    same = c.employee_id.eq(c.employee_id.shift())
    assert not (same & prev_end.isna()).any(), "an open-ended contract is followed by another contract"
    assert not (same & (c.start_date <= prev_end)).any()


def test_contracts_link_to_employees(model):
    assert model["contracts"].employee_id.isin(model["employees"].employee_id).all()
    assert model["separations"].employee_id.isin(model["employees"].employee_id).all()
    assert model["appraisals"].employee_id.isin(model["employees"].employee_id).all()


def test_monthly_headcount_matches_generator_truth(model, truth):
    """The consolidated model (CORE + Excel, de-duplicated) reproduces the simulated workforce exactly."""
    c = model["contracts"]
    for d in month_ends("2023-01", "2026-10"):
        a = c[(c.start_date <= d) & (c.end_date.isna() | (c.end_date >= d))]
        exp = truth["monthly_headcount"][d.isoformat()]
        assert len(a) == exp["total"], d
        assert a.employee_id.is_unique, d
        for cat, n in exp["by_category"].items():
            assert int((a.staff_category == cat).sum()) == n, (d, cat)


def test_separation_ends_employment(model):
    c = model["contracts"]
    s = model["separations"]
    assert s.exit_type.isin(["Voluntary", "Involuntary"]).all()
    assert (s.exit_date <= SIM_END).all()
    starts = c.groupby("employee_id").start_date.apply(list)
    ends = c.set_index("contract_id").end_date
    for r in s.itertuples():
        nxt = [x for x in starts[r.employee_id] if x > r.exit_date]
        # after a separation the employee either never returns or is rehired after a gap
        assert not nxt or min(nxt) > r.exit_date + dt.timedelta(days=1)


def test_filled_vacancies_link_to_hire(model):
    v = model["vacancies"]
    c = model["contracts"]
    filled = v[v.outcome.isin(["National Recruitment", "Internal Mobility", "External Recruitment"])]
    assert filled.hired_employee_id.notna().all()
    first_start = c.groupby("employee_id").start_date.apply(sorted)
    for r in filled[filled.dq_valid].itertuples():
        st = [x for x in first_start[r.hired_employee_id] if r.closed_date <= x <= r.closed_date + dt.timedelta(days=61)]
        assert st, f"{r.vacancy_id}: no contract starts within notice period after closure"


def test_vacancy_dates(model):
    v = model["vacancies"]
    ok = v[v.dq_valid]
    assert (ok.closed_date.isna() | (ok.closed_date >= ok.opened_date)).all()
    assert (v.planned_close_date > v.opened_date).all()
    assert (v.opened_date <= SIM_END).all()
    assert ((v.status == "Open") == v.closed_date.isna()).all()
    # funnel is monotonic
    assert (v.applicants >= v.shortlisted).all() and (v.shortlisted >= v.interviewed).all()
    assert (v.interviewed >= v.offers).all()


def test_surges_reference_active_staff(model):
    s = model["surges"]
    c = model["contracts"]
    filled = s[s.status == "Filled"]
    assert filled.deployed_employee_id.notna().all()
    assert (filled.country != filled.home_country).all(), "surge staff are deployed outside their home country"
    for r in filled.itertuples():
        e = c[c.employee_id == r.deployed_employee_id]
        on = e[(e.start_date <= r.start_date) & (e.end_date.isna() | (e.end_date >= r.start_date))]
        assert len(on) == 1


def test_appraisals_for_active_staff(model):
    c = model["contracts"]
    a = model["appraisals"].merge(c[["employee_id", "start_date", "end_date"]], on="employee_id")
    a["covered"] = (a.start_date <= a.appraisal_date) & (a.end_date.isna() | (a.end_date >= a.appraisal_date))
    assert a.groupby(["employee_id", "appraisal_date"]).covered.any().all()


def test_dates_within_window(model):
    assert (model["vacancies"].opened_date >= dt.date(2022, 11, 1)).all()
    assert (model["surges"].request_date >= SIM_START).all()
    assert (model["appraisals"].appraisal_date <= SIM_END).all()


def test_data_quality_report(dq):
    assert dq["rules_total"] >= 25
    assert dq["overall_completeness"] > 98
    ids = [r["rule_id"] for r in dq["rules"]]
    assert len(ids) == len(set(ids))
    # integrity rules that must always pass after consolidation
    must_pass = {"CTR-06", "CTR-07", "CTR-08", "CTR-09", "VAC-06", "VAC-08", "SRG-02"}
    status = {r["rule_id"]: r["status"] for r in dq["rules"]}
    assert all(status[r] == "Pass" for r in must_pass), {r: status[r] for r in must_pass}
    rec = dq["reconciliation"]
    assert rec["headcount_matched"] / rec["headcount_cells"] > 0.95
    assert rec["expat_matched"] / rec["expat_cells"] > 0.94
