"""Generate the synthetic source systems for the Workforce Analytics portfolio demo.

A single event-driven workforce simulation (Jan 2023 - Oct 2026) produces the ground truth:
employees, contracts, separations, vacancies, internal mobility, surge deployments and
performance appraisals. Every record is linked (vacancy -> hired employee -> contract,
exit -> replacement vacancy, surge -> deployed employee).

The ground truth is then *split* into the three simulated enterprise sources, with the
realistic imperfections that a consolidation pipeline has to handle:

  data/raw/core_hr/            CORE HR extracts (employees, contracts, separations, appraisals)
  data/raw/jira/               JIRA Recruitment and Surge exports (2025+ / 2026+)
  data/raw/excel_trackers/     Historical Excel trackers (national staff, vacancies,
                               surges, monthly headcount and expatriation snapshots)

Run:  python pipeline/generate_sources.py
All data is fictional.
"""
from __future__ import annotations

import bisect
import calendar
import datetime as dt
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import (  # noqa: E402
    CATEGORIES, CORE_NATIONAL_GO_LIVE, COUNTRIES, COUNTRY_VARIANTS, DEPT_DIST, GLOBAL_HUBS,
    GN_POOL, GN_POOL_HQ, GRADE_DIST, GRADES, GS_POOL, HQ_COUNTRY, HQ_TARGET, JIRA_GO_LIVE,
    JIRA_SURGE_GO_LIVE, KEYFRAMES, NEIGHBOURS, POSITION_TITLES, RAW_DIR, SEED, SIM_END,
    SIM_START,
)

rng = np.random.default_rng(SEED)
D = dt.timedelta


# --------------------------------------------------------------------------- helpers
def month_end(y: int, m: int) -> dt.date:
    return dt.date(y, m, calendar.monthrange(y, m)[1])


def months(start: dt.date, end: dt.date):
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield dt.date(y, m, 1), month_end(y, m)
        m += 1
        if m == 13:
            y, m = y + 1, 1


def add_months(d: dt.date, n: int) -> dt.date:
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    return dt.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def rand_day(lo: dt.date, hi: dt.date) -> dt.date:
    if hi <= lo:
        return lo
    return lo + D(days=int(rng.integers(0, (hi - lo).days + 1)))


def pick(dist: dict):
    keys = list(dist)
    p = np.array([dist[k] for k in keys], dtype=float)
    return keys[int(rng.choice(len(keys), p=p / p.sum()))]


def frac_of_period(d: dt.date) -> float:
    return min(1.0, max(0.0, (d - SIM_START).days / (SIM_END - SIM_START).days))


def interp(keyframes, d: dt.date) -> float:
    pts = [(dt.date.fromisoformat(a) if isinstance(a, str) else a, v) for a, v in keyframes]
    if d <= pts[0][0]:
        return pts[0][1]
    for (d0, v0), (d1, v1) in zip(pts, pts[1:]):
        if d <= d1:
            t = (d - d0).days / max(1, (d1 - d0).days)
            return v0 + (v1 - v0) * t
    return pts[-1][1]


# --------------------------------------------------------------------------- cells / targets
CELLS: dict[tuple[str, str], list] = {}
FEMALE_NAT = {}
for name, iso, region, nat, intl, fem in COUNTRIES:
    CELLS[(name, "National Staff")] = KEYFRAMES.get((name, "National Staff"), [(SIM_START, nat[0]), (SIM_END, nat[1])])
    CELLS[(name, "International Staff")] = KEYFRAMES.get((name, "International Staff"), [(SIM_START, intl[0]), (SIM_END, intl[1])])
    FEMALE_NAT[name] = fem
for hub, (a, b) in GLOBAL_HUBS.items():
    CELLS[(hub, "Global non-HQ Staff")] = [(SIM_START, a), (SIM_END, b)]
CELLS[(HQ_COUNTRY[0], "HQ Staff")] = [(SIM_START, HQ_TARGET[0]), (SIM_END, HQ_TARGET[1])]

HARD_TO_STAFF = {"Afghanistan", "Sudan", "Libya", "Yemen", "Haiti", "Central African Republic",
                 "South Sudan", "Somalia"}


def target(cell, d: dt.date) -> float:
    base = interp(CELLS[cell], d)
    if cell[1] == "National Staff":  # assessment season: slightly higher national staffing Apr-Sep
        base *= 1 + 0.02 * math.sin(2 * math.pi * (d.month - 3) / 12)
    return base


def growing(cell, d: dt.date) -> bool:
    return target(cell, add_months(d, 3)) >= target(cell, d) - 0.25


# --------------------------------------------------------------------------- state
employees: dict[str, dict] = {}
contracts: list[dict] = []
current: dict[str, int] = {}          # employee -> index of latest contract
active: set[str] = set()              # employed (incl. signed future start)
exits: list[dict] = []
vacancies: list[dict] = []
open_vac: list[int] = []
appraisals: list[dict] = []
_emp_seq = [10000]
_ctr_seq = [0]
_vac_seq = [0]


def new_emp_id():
    _emp_seq[0] += 1
    return f"E{_emp_seq[0]}"


def new_ctr_id():
    _ctr_seq[0] += 1
    return f"CT{_ctr_seq[0]:06d}"


def draw_nationality(category: str, country: str, d: dt.date) -> str:
    f = frac_of_period(d)
    if category == "National Staff":
        if rng.random() < 0.95 or country not in NEIGHBOURS:
            return country
        return str(rng.choice(NEIGHBOURS[country]))
    if category == "HQ Staff":
        p_gs = 0.30 + 0.10 * f
        return pick(GS_POOL) if rng.random() < p_gs else pick(GN_POOL_HQ)
    p_gs = 0.44 + 0.12 * f
    nat = pick(GS_POOL) if rng.random() < p_gs else pick(GN_POOL)
    if nat == country:  # an international staff member is not a national of the duty country
        nat = pick(GN_POOL)
    return nat


def draw_gender(category: str, country: str) -> str:
    p_f = {"National Staff": FEMALE_NAT.get(country, 0.38), "International Staff": 0.48,
           "Global non-HQ Staff": 0.50, "HQ Staff": 0.58}[category]
    return "Female" if rng.random() < p_f else "Male"


def draw_age(category: str) -> float:
    mu, sd = {"National Staff": (32, 7), "International Staff": (35.5, 6.5),
              "Global non-HQ Staff": (38, 6.5), "HQ Staff": (37.5, 8)}[category]
    return float(np.clip(rng.normal(mu, sd), 21, 61))


def draw_grade(category: str, dept: str) -> str:
    g = pick(GRADE_DIST[category])
    if dept == "Field Operations" and g > "G3":
        g = "G3"
    return g


def draw_contract_terms(category: str, grade: str):
    """Return (contract_type, duration_months or None for open-ended)."""
    if category == "National Staff":
        opts = {("Fixed-Term", 12): .64, ("Fixed-Term", 6): .22, ("Short-Term", 3): .09, ("Open-Ended", None): .05}
    elif category == "International Staff":
        if grade in ("G3", "G4"):
            opts = {("Fixed-Term", 6): .32, ("Fixed-Term", 12): .38, ("Short-Term", 3): .25, ("Fixed-Term", 24): .05}
        else:
            opts = {("Fixed-Term", 12): .52, ("Fixed-Term", 24): .24, ("Fixed-Term", 6): .14, ("Short-Term", 3): .10}
    elif category == "Global non-HQ Staff":
        opts = {("Fixed-Term", 12): .50, ("Fixed-Term", 24): .40, ("Fixed-Term", 6): .10}
    else:
        opts = {("Open-Ended", None): .22, ("Fixed-Term", 12): .35, ("Fixed-Term", 24): .33, ("Short-Term", 6): .10}
    return pick(opts)


def make_contract(emp_id, start, category, country, grade, dept, title, reason, ctype=None, dur=None):
    if ctype is None:
        ctype, dur = draw_contract_terms(category, grade)
    planned_end = None if dur is None else add_months(start, dur) - D(days=1)
    c = dict(contract_id=new_ctr_id(), employee_id=emp_id, start_date=start, planned_end_date=planned_end,
             end_date=planned_end, contract_type=ctype, duration_months=dur, staff_category=category,
             country=country, grade=grade, department=dept, position_title=title,
             start_reason=reason, end_reason=None)
    contracts.append(c)
    current[emp_id] = len(contracts) - 1
    return c


def title_for(dept: str, grade: str) -> str:
    level = 0 if grade in ("G1", "G2") else (1 if grade in ("G3", "G4") else 2)
    return POSITION_TITLES[dept][level]


def new_employee(category, country, hire_date, d_ref) -> str:
    eid = new_emp_id()
    age = draw_age(category)
    birth = hire_date - D(days=int(age * 365.25))
    employees[eid] = dict(employee_id=eid, gender=draw_gender(category, country), birth_date=birth,
                          nationality=draw_nationality(category, country, d_ref),
                          first_hire_date=hire_date, latest_hire_date=hire_date)
    return eid


def cell_of(eid):
    c = contracts[current[eid]]
    return (c["country"], c["staff_category"])


# --------------------------------------------------------------------------- vacancy logic
def planned_days(category):
    if category == "National Staff":
        return int(rng.choice([30, 45, 60], p=[.45, .4, .15]))
    if category == "Global non-HQ Staff":
        return int(rng.choice([60, 90], p=[.7, .3]))
    return int(rng.choice([45, 60, 90], p=[.4, .45, .15]))


def time_to_fill(category, grade, country, opened):
    median = {"National Staff": 52, "International Staff": 80, "Global non-HQ Staff": 88, "HQ Staff": 68}[category]
    median *= 1 + 0.06 * (int(grade[1]) - 3)
    if country in HARD_TO_STAFF:
        median *= 1.28
    median *= 1.12 - 0.22 * frac_of_period(opened)  # process improvement over time
    return max(12, int(rng.lognormal(math.log(median), 0.38)))


def open_vacancy(country, category, grade, dept, opened, position_type, replaced=None):
    _vac_seq[0] += 1
    cancel = rng.random() < 0.075
    dur = int(rng.lognormal(math.log(38), 0.5)) if cancel else time_to_fill(category, grade, country, opened)
    v = dict(vacancy_seq=_vac_seq[0], country=country, staff_category=category, grade=grade, department=dept,
             position_title=title_for(dept, grade), position_type=position_type, opened_date=opened,
             planned_close_date=opened + D(days=planned_days(category)),
             decision_date=opened + D(days=max(7, dur)), will_cancel=cancel, closed_date=None,
             status="Open", outcome=None, candidate_type=None, hired_employee_id=None,
             replaced_employee_id=replaced, hire_start_date=None)
    vacancies.append(v)
    open_vac.append(len(vacancies) - 1)
    return v


def end_contract(eid, end_date, reason):
    c = contracts[current[eid]]
    c["end_date"] = end_date
    c["end_reason"] = reason


def maybe_replace(c, exit_date, lead, m_start, m_end):
    cell = (c["country"], c["staff_category"])
    p_replace = 0.88 if growing(cell, exit_date) else 0.45
    if rng.random() < p_replace:
        opened = min(max(exit_date - D(days=lead), m_start, SIM_START), m_end)
        open_vacancy(c["country"], c["staff_category"], c["grade"], c["department"], opened, "Replacement",
                     c["employee_id"])


def record_exit(eid, exit_date, exit_type, reason, m_start=None, m_end=None, replace=True):
    c = contracts[current[eid]]
    end_contract(eid, exit_date, "Separation")
    active.discard(eid)
    exits.append(dict(employee_id=eid, exit_date=exit_date, exit_type=exit_type, exit_reason=reason,
                      staff_category=c["staff_category"], country=c["country"], grade=c["grade"],
                      department=c["department"], contract_id=c["contract_id"]))
    if replace:  # unplanned separations: recruitment starts during the notice period
        maybe_replace(c, exit_date, int(rng.integers(0, 30)), m_start or exit_date, m_end or exit_date)


# --------------------------------------------------------------------------- initial population
for cell in CELLS:
    country, category = cell
    n = round(target(cell, SIM_START))
    for _ in range(n):
        dept = pick(DEPT_DIST[category])
        grade = draw_grade(category, dept)
        ctype, dur = draw_contract_terms(category, grade)
        tenure_years = min(rng.exponential({"National Staff": 3.0, "HQ Staff": 3.5}.get(category, 2.2)), 12)
        if dur is None:
            start = SIM_START - D(days=int(rng.integers(30, 2000)))
        else:
            span = (add_months(SIM_START, dur) - SIM_START).days
            start = SIM_START - D(days=int(rng.integers(0, span)))
        hire = min(start, SIM_START - D(days=int(tenure_years * 365)))
        eid = new_employee(category, country, hire, SIM_START - D(days=400))
        make_contract(eid, start, category, country, grade, dept, title_for(dept, grade), "Migrated (pre-2023)",
                      ctype, dur)
        active.add(eid)
    for _ in range(int(round(n * 0.04))):
        dept = pick(DEPT_DIST[category])
        open_vacancy(country, category, draw_grade(category, dept), dept,
                     rand_day(dt.date(2022, 11, 1), dt.date(2022, 12, 31)),
                     "Replacement" if rng.random() < 0.6 else "New Position")


# --------------------------------------------------------------------------- monthly simulation
RESIGN = {"National Staff": .0060, "International Staff": .0088, "Global non-HQ Staff": .0060, "HQ Staff": .0050}
NON_RENEW = {"National Staff": .085, "International Staff": .15, "Global non-HQ Staff": .10, "HQ Staff": .06}


def promote(grade):
    i = GRADES.index(grade)
    return GRADES[min(i + 1, len(GRADES) - 1)]


def choose_mover(v, pools, close_date, start):
    country, category, grade = v["country"], v["staff_category"], v["grade"]
    candidates = []
    if category == "National Staff":
        candidates = [e for e in pools.get((country, "National Staff"), []) if contracts[current[e]]["grade"] <= grade]
    elif category == "International Staff":
        if rng.random() < 0.35:
            src = [k for k in pools if k[1] == "National Staff" and k[0] != country]
            candidates = [e for k in src for e in pools[k] if contracts[current[e]]["grade"] >= "G3"]
        else:
            src = [k for k in pools if k[1] == "International Staff" and k[0] != country]
            candidates = [e for k in src for e in pools[k]]
    elif category == "Global non-HQ Staff":
        candidates = [e for k in pools if k[1] == "International Staff" for e in pools[k]]
    else:
        candidates = [e for k in pools if k[1] in ("International Staff", "Global non-HQ Staff") for e in pools[k]]
    ok = []
    for e in candidates:
        c = contracts[current[e]]
        if c["start_date"] < start - D(days=30) and (c["planned_end_date"] is None or c["planned_end_date"] >= start - D(days=1)):
            ok.append(e)
    if not ok:
        return None
    return ok[int(rng.integers(0, len(ok)))]


def choose_rehire(v, close_date):
    pool = [x["employee_id"] for x in exits
            if x["staff_category"] == v["staff_category"] and x["employee_id"] not in active
            and x["exit_date"] <= close_date - D(days=180) and x["exit_type"] == "Voluntary"
            and (v["staff_category"] != "National Staff" or x["country"] == v["country"])]
    if not pool:
        return None
    return pool[int(rng.integers(0, len(pool)))]


def resolve_vacancy(v, pools):
    close = v["decision_date"]
    v["closed_date"] = close
    if v["will_cancel"]:
        v["status"], v["outcome"] = "Closed", "Cancelled Position"
        return
    category = v["staff_category"]
    notice = int(rng.integers(7, 31)) if category == "National Staff" else int(rng.integers(21, 61))
    start = close + D(days=notice)
    p_internal = 0.18 if category == "National Staff" else 0.32
    eid = None
    if rng.random() < p_internal:
        eid = choose_mover(v, pools, close, start)
        if eid is not None:
            old = contracts[current[eid]]
            old_cell = (old["country"], old["staff_category"])
            pools[old_cell].remove(eid)
            end_contract(eid, start - D(days=1), "Internal mobility")
            make_contract(eid, start, category, v["country"], v["grade"], v["department"], v["position_title"],
                          "Internal mobility")
            v["outcome"], v["candidate_type"] = "Internal Mobility", "Ongoing Staff"
            if rng.random() < 0.6 and start <= SIM_END:
                open_vacancy(old["country"], old["staff_category"], old["grade"], old["department"],
                             max(close, start - D(days=20)), "Replacement", eid)
    if eid is None:
        v["outcome"] = "National Recruitment" if category == "National Staff" else "External Recruitment"
        if rng.random() < 0.075:
            eid = choose_rehire(v, close)
        if eid is not None:
            v["candidate_type"] = "Former Staff"
            employees[eid]["latest_hire_date"] = start
            make_contract(eid, start, category, v["country"], v["grade"], v["department"], v["position_title"], "Rehire")
        else:
            v["candidate_type"] = "External Candidate"
            eid = new_employee(category, v["country"], start, start)
            make_contract(eid, start, category, v["country"], v["grade"], v["department"], v["position_title"], "New hire")
        active.add(eid)
    v["status"], v["hired_employee_id"], v["hire_start_date"] = "Closed", eid, start


for m_start, m_end in months(SIM_START, SIM_END):
    # 1a) renewal decisions are taken ~2 months ahead; planned separations open an advance replacement vacancy
    horizon = m_end + D(days=62)
    for eid in sorted(active):
        c = contracts[current[eid]]
        pe = c["planned_end_date"]
        if pe is None or c["end_reason"] is not None or "decision" in c or pe > horizon:
            continue
        cell = (c["country"], c["staff_category"])
        age = (pe - employees[eid]["birth_date"]).days / 365.25
        p_exit = NON_RENEW[c["staff_category"]] + (0.0 if growing(cell, pe) else 0.16)
        if age >= 62:
            c["decision"] = ("Voluntary", "Retirement")
        elif rng.random() < p_exit:
            if growing(cell, pe):
                c["decision"] = pick({("Voluntary", "Did not wish to renew"): .45, ("Involuntary", "Contract not renewed"): .40,
                                      ("Involuntary", "End of project / funding"): .15})
            else:
                c["decision"] = pick({("Voluntary", "Did not wish to renew"): .25, ("Involuntary", "Contract not renewed"): .25,
                                      ("Involuntary", "End of project / funding"): .50})
        else:
            c["decision"] = ("Renew",)
        if c["decision"][0] != "Renew":
            maybe_replace(c, pe, int(rng.integers(20, 75)), m_start, m_end)

    # 1b) execute decisions for contracts ending this month
    for eid in sorted(active):
        c = contracts[current[eid]]
        pe = c["planned_end_date"]
        if pe is None or c["end_reason"] is not None or pe > m_end:
            continue
        decision = c.pop("decision")
        if decision[0] != "Renew":
            record_exit(eid, pe, *decision, replace=False)
        else:
            c["end_reason"] = "Renewed"
            grade = promote(c["grade"]) if rng.random() < 0.06 and c["staff_category"] != "National Staff" or rng.random() < 0.04 else c["grade"]
            if c["department"] == "Field Operations" and grade > "G3":
                grade = "G3"
            title = title_for(c["department"], grade) if grade != c["grade"] else c["position_title"]
            ctype, dur = draw_contract_terms(c["staff_category"], grade)
            if c["contract_type"] == "Open-Ended":
                ctype, dur = "Open-Ended", None
            make_contract(eid, pe + D(days=1), c["staff_category"], c["country"], grade, c["department"], title,
                          "Renewal" if grade == c["grade"] else "Renewal with promotion", ctype, dur)

    # 2) mid-contract separations (resignations, dismissals)
    for eid in sorted(active):
        c = contracts[current[eid]]
        lo = max(m_start, c["start_date"])
        hi = m_end if c["planned_end_date"] is None else min(m_end, c["planned_end_date"] - D(days=1))
        if lo > hi:
            continue
        r = rng.random()
        if r < RESIGN[c["staff_category"]]:
            c.pop("decision", None)
            record_exit(eid, rand_day(lo, hi), "Voluntary", "Resignation", m_start, m_end)
        elif r < RESIGN[c["staff_category"]] + 0.0004:
            c.pop("decision", None)
            record_exit(eid, rand_day(lo, hi), "Involuntary", "Dismissal", m_start, m_end)

    # 3) new positions to follow workforce plan
    committed = defaultdict(int)
    for eid in active:
        committed[cell_of(eid)] += 1
    for i in open_vac:
        v = vacancies[i]
        committed[(v["country"], v["staff_category"])] += 1
    for cell in CELLS:
        gap = target(cell, m_end) - committed[cell]
        n_new = int(gap) + (1 if rng.random() < gap - int(gap) else 0) if gap > 0 else 0
        for _ in range(n_new):
            dept = pick(DEPT_DIST[cell[1]])
            open_vacancy(cell[0], cell[1], draw_grade(cell[1], dept), dept, rand_day(m_start, m_end), "New Position")

    # 4) resolve vacancies decided this month (in date order)
    pools = defaultdict(list)
    for eid in sorted(active):
        c = contracts[current[eid]]
        if c["start_date"] <= m_end:
            pools[(c["country"], c["staff_category"])].append(eid)
    due = sorted([i for i in open_vac if vacancies[i]["decision_date"] <= m_end], key=lambda i: vacancies[i]["decision_date"])
    for i in due:
        open_vac.remove(i)
        resolve_vacancy(vacancies[i], pools)

# Vacancies still pending at the cut-off are open; those decided after the cut-off are reported as open.
for i in open_vac:
    v = vacancies[i]
    v["status"] = "Open"


# --------------------------------------------------------------------------- appraisals
def employment_spells():
    """Employee -> list of (start, end) contiguous contract spans."""
    by_emp = defaultdict(list)
    for c in contracts:
        by_emp[c["employee_id"]].append(c)
    return by_emp


by_emp = employment_spells()


def active_contract_on(eid, d):
    for c in by_emp[eid]:
        if c["start_date"] <= d and (c["end_date"] is None or c["end_date"] >= d):
            return c
    return None


DEPT_APPRAISAL = {"Research & Assessment": .90, "GIS & Data Management": .88, "Field Operations": .76,
                  "Programme Management": .86, "Finance & Compliance": .92, "HR & Administration": .95,
                  "Logistics & IT": .80}
for cycle in (2022, 2023, 2024, 2025):
    w0, w1 = dt.date(cycle, 12, 1), dt.date(cycle + 1, 3, 31)
    ref = max(w0, SIM_START)
    for eid, emp in employees.items():
        c = active_contract_on(eid, ref)
        if c is None or emp["latest_hire_date"] > dt.date(cycle, 6, 1):
            continue
        p = DEPT_APPRAISAL[c["department"]] + 0.025 * (cycle - 2022) - (0.03 if c["staff_category"] == "National Staff" else 0)
        if rng.random() < min(p, 0.98):
            d = rand_day(max(w0, SIM_START), min(w1, SIM_END))
            if active_contract_on(eid, d) is not None:
                appraisals.append(dict(employee_id=eid, appraisal_date=d, appraisal_type="Annual", cycle=f"{cycle}-{cycle + 1}",
                                       rating=pick({"Exceeds expectations": .18, "Meets expectations": .70,
                                                    "Partially meets": .10, "Does not meet": .02})))
for eid, emp in employees.items():  # end-of-probation appraisals
    h = emp["latest_hire_date"]
    if h < SIM_START:
        continue
    d = h + D(days=int(rng.integers(75, 120)))
    if d <= SIM_END and rng.random() < 0.72 and active_contract_on(eid, d) is not None:
        appraisals.append(dict(employee_id=eid, appraisal_date=d, appraisal_type="End of probation", cycle="Probation",
                               rating=pick({"Meets expectations": .85, "Exceeds expectations": .1, "Partially meets": .05})))


# --------------------------------------------------------------------------- surges
SURGE_EVENTS = [("Haiti", "2024-03", "2024-05", 2), ("Sudan", "2024-05", "2024-09", 4), ("Chad", "2024-06", "2024-09", 2),
                ("Lebanon", "2024-10", "2024-12", 4), ("Democratic Republic of the Congo", "2025-02", "2025-04", 3),
                ("Myanmar", "2025-04", "2025-05", 3), ("Afghanistan", "2025-09", "2025-10", 2),
                ("Sudan", "2026-02", "2026-04", 2), ("Mozambique", "2026-03", "2026-04", 2), ("Ukraine", "2023-02", "2023-04", 2)]
surges = []
ops = [c[0] for c in COUNTRIES]
weights = np.array([CELLS[(c, "National Staff")][0][1] for c in ops], dtype=float)
weights /= weights.sum()
seq = 0
for m_start, m_end in months(SIM_START, SIM_END):
    reqs = [str(rng.choice(ops, p=weights)) for _ in range(int(rng.poisson(5.5)))]
    ym = m_start.strftime("%Y-%m")
    for country, a, b, extra in SURGE_EVENTS:
        if a <= ym <= b:
            reqs += [country] * int(rng.poisson(extra))
    for country in reqs:
        seq += 1
        req = rand_day(m_start, m_end)
        days_old = (SIM_END - req).days
        s = dict(surge_seq=seq, requesting_country=country, request_date=req, status="Open", deployed_employee_id=None,
                 deployed_category=None, home_country=None, start_date=None, end_date=None,
                 role=pick({"Assessment Specialist": .35, "GIS Specialist": .2, "Field Coordinator": .2,
                            "Data Manager": .15, "Research Manager": .1}))
        r = rng.random()
        lead = int(rng.integers(7, 30))
        if r < 0.11 and days_old > 14:
            s["status"] = "Cancelled"
        elif days_old > lead:
            start = req + D(days=lead)
            p_nat = 0.27 + 0.20 * frac_of_period(req)
            want = "National Staff" if rng.random() < p_nat else "International Staff"
            cands = [c for c in contracts if c["staff_category"] in ((want,) if want == "National Staff" else ("International Staff", "Global non-HQ Staff"))
                     and c["country"] != country and c["start_date"] <= start - D(days=60)
                     and (c["end_date"] is None or c["end_date"] >= start + D(days=30))
                     and c["grade"] >= "G3"]
            if cands:
                c = cands[int(rng.integers(0, len(cands)))]
                dur = int(rng.integers(30, 91))
                end = start + D(days=dur)
                if c["end_date"] is not None:
                    end = min(end, c["end_date"])
                s.update(status="Filled", deployed_employee_id=c["employee_id"], deployed_category=c["staff_category"],
                         home_country=c["country"], start_date=start, end_date=end)
            else:
                s["status"] = "Cancelled"
        surges.append(s)


# --------------------------------------------------------------------------- ground-truth checks
def headcount_on(d):
    out = defaultdict(int)
    for c in contracts:
        if c["start_date"] <= d and (c["end_date"] is None or c["end_date"] >= d):
            out[(c["country"], c["staff_category"])] += 1
    return out


truth = {}
for m_start, m_end in months(SIM_START, SIM_END):
    hc = headcount_on(m_end)
    truth[m_end.isoformat()] = {"total": sum(hc.values()),
                                "by_category": {cat: sum(v for k, v in hc.items() if k[1] == cat) for cat in CATEGORIES}}

# --------------------------------------------------------------------------- write sources
RAW_DIR.mkdir(parents=True, exist_ok=True)
for sub in ("core_hr", "jira", "excel_trackers"):
    (RAW_DIR / sub).mkdir(exist_ok=True)

emp_df = pd.DataFrame(employees.values())
for c in contracts:
    c.pop("decision", None)
ctr_df = pd.DataFrame(contracts)
exit_df = pd.DataFrame(exits)
vac_df = pd.DataFrame(vacancies)
apr_df = pd.DataFrame(appraisals)
srg_df = pd.DataFrame(surges)

# vacancy identifiers: Excel tracker refs for pre-JIRA vacancies, JIRA keys for the rest (migrated ones keep a legacy ref)
vac_df = vac_df.sort_values(["opened_date", "vacancy_seq"]).reset_index(drop=True)
legacy, jira_key = [], []
yr_seq = defaultdict(int)
jira_n = 1000
for _, v in vac_df.iterrows():
    if v.opened_date < JIRA_GO_LIVE:
        yr_seq[v.opened_date.year] += 1
        legacy.append(f"HVT-{v.opened_date.year}-{yr_seq[v.opened_date.year]:04d}")
    else:
        legacy.append(None)
    still_open = pd.isna(v.closed_date) or v.closed_date >= JIRA_GO_LIVE
    if v.opened_date >= JIRA_GO_LIVE or still_open:
        jira_n += 1
        jira_key.append(f"REC-{jira_n}")
    else:
        jira_key.append(None)
vac_df["legacy_ref"] = legacy
vac_df["jira_key"] = jira_key


def rnd_country(name: str, p: float) -> str:
    if name in COUNTRY_VARIANTS and rng.random() < p:
        return str(rng.choice(COUNTRY_VARIANTS[name]))
    return name


def s_or_none(x):
    return x if isinstance(x, str) and x else None


def funnel(v):
    outcome = s_or_none(v.outcome)
    base = {"National Staff": 72, "International Staff": 54, "Global non-HQ Staff": 48, "HQ Staff": 95}[v.staff_category]
    if outcome == "Internal Mobility":
        base *= 0.45
    if v.status == "Open":
        age = (SIM_END - v.opened_date).days
        base *= min(1, age / 30)
    applicants = int(rng.poisson(max(base, 1)))
    shortlisted = int(rng.binomial(applicants, 0.16))
    interviewed = int(rng.binomial(shortlisted, 0.55))
    offers = 0
    if outcome not in (None, "Cancelled Position"):
        shortlisted = max(shortlisted, 3)
        interviewed = max(interviewed, 2)
        offers = 1 + int(rng.random() < 0.12)
        applicants = max(applicants, shortlisted)
    elif outcome == "Cancelled Position":
        offers = int(rng.random() < 0.25)
        interviewed = max(interviewed, offers)
    return applicants, shortlisted, interviewed, offers


fun = [funnel(v) for v in vac_df.itertuples()]
vac_df["applicants"], vac_df["shortlisted"], vac_df["interviewed"], vac_df["offers"] = zip(*fun)

# ---- CORE HR: employees (all non-national staff; national staff employed on/after go-live)
ctr_df["is_core"] = (ctr_df.staff_category != "National Staff") | (ctr_df.end_date.isna()) | (ctr_df.end_date >= CORE_NATIONAL_GO_LIVE)
ctr_df["is_excel"] = (ctr_df.staff_category == "National Staff") & (ctr_df.start_date < CORE_NATIONAL_GO_LIVE)
core_emp_ids = set(ctr_df.loc[ctr_df.is_core, "employee_id"])
excel_emp_ids = set(ctr_df.loc[ctr_df.is_excel, "employee_id"])


def fmt(d):
    return None if d is None or (isinstance(d, float) and math.isnan(d)) or pd.isna(d) else d.isoformat()


core_emp = emp_df[emp_df.employee_id.isin(core_emp_ids)].copy()
core_emp["exit_date"] = core_emp.employee_id.map(exit_df.sort_values("exit_date").groupby("employee_id").exit_date.last())
n = len(core_emp)
idx = rng.choice(n, size=int(n * 0.011), replace=False)
core_emp.iloc[idx, core_emp.columns.get_loc("nationality")] = None
idx = rng.choice(n, size=int(n * 0.014), replace=False)
core_emp.iloc[idx, core_emp.columns.get_loc("birth_date")] = None
idx = rng.choice(n, size=4, replace=False)  # impossible birth dates (data-entry errors)
for i in idx:
    core_emp.iat[i, core_emp.columns.get_loc("birth_date")] = dt.date(2019, 5, 17) if i % 2 else dt.date(1901, 1, 1)
idx = rng.choice(n, size=int(n * 0.005), replace=False)
core_emp.iloc[idx, core_emp.columns.get_loc("gender")] = None
core_emp = core_emp.drop(columns=["exit_date"])
for col in ("birth_date", "first_hire_date", "latest_hire_date"):
    core_emp[col] = core_emp[col].map(fmt)
core_emp.insert(0, "source_system", "CORE")
core_emp.to_csv(RAW_DIR / "core_hr" / "employees.csv", index=False)

core_ctr = ctr_df[ctr_df.is_core].drop(columns=["is_core", "is_excel"]).copy()
core_ctr["country"] = [rnd_country(c, 0.06) for c in core_ctr.country]
ct = core_ctr.contract_type.copy()
mask = rng.random(len(ct)) < 0.03
ct[mask] = [x.lower().replace("-", " ") for x in ct[mask]]
core_ctr["contract_type"] = ct
fe = core_ctr[(core_ctr.contract_type == "Fixed-Term") & core_ctr.planned_end_date.notna()].index
missing_end = rng.choice(fe, size=6, replace=False)  # fixed-term contracts without planned end date
core_ctr.loc[missing_end, "planned_end_date"] = None
for col in ("start_date", "planned_end_date", "end_date"):
    core_ctr[col] = core_ctr[col].map(fmt)
core_ctr.to_csv(RAW_DIR / "core_hr" / "contracts.csv", index=False)

core_exit = exit_df[(exit_df.staff_category != "National Staff") | (exit_df.exit_date >= CORE_NATIONAL_GO_LIVE)].copy()
core_exit["exit_date"] = core_exit.exit_date.map(fmt)
core_exit.to_csv(RAW_DIR / "core_hr" / "separations.csv", index=False)

apr = apr_df.copy()
apr["appraisal_date"] = apr.appraisal_date.map(fmt)
apr.to_csv(RAW_DIR / "core_hr" / "performance_appraisals.csv", index=False)

# ---- Excel: national staff tracker (pre-2025 history) - different column names and formats
xl_emp = emp_df[emp_df.employee_id.isin(excel_emp_ids)].copy()
first_nat = ctr_df[ctr_df.is_excel].sort_values("start_date").groupby("employee_id").first()
xl_emp = xl_emp.join(first_nat[["country", "grade"]], on="employee_id")
xl_emp_out = pd.DataFrame({
    "Staff ID": xl_emp.employee_id,
    "Sex": xl_emp.gender.map({"Female": "F", "Male": "M"}),
    "Date of Birth": [d.strftime("%d/%m/%Y") for d in xl_emp.birth_date],
    "Nationality": xl_emp.nationality,
    "Duty Station Country": [rnd_country(c, 0.10) for c in xl_emp.country],
    "Date of Hire": [d.strftime("%d/%m/%Y") for d in xl_emp.first_hire_date],
})
# manual tracker gaps: missing birth dates / nationalities for some national staff
gap = rng.choice(len(xl_emp_out), size=int(len(xl_emp_out) * 0.02), replace=False)
xl_emp_out.iloc[gap, xl_emp_out.columns.get_loc("Date of Birth")] = ""
gap = rng.choice(len(xl_emp_out), size=int(len(xl_emp_out) * 0.015), replace=False)
xl_emp_out.iloc[gap, xl_emp_out.columns.get_loc("Nationality")] = ""
# manual-entry conflicts with CORE for overlapping staff (CORE takes precedence in the pipeline)
overlap = xl_emp_out["Staff ID"].isin(core_emp_ids).to_numpy().nonzero()[0]
conf = rng.choice(overlap, size=max(1, int(len(overlap) * 0.02)), replace=False)
xl_emp_out.iloc[conf, xl_emp_out.columns.get_loc("Sex")] = ["M" if s == "F" else "F" for s in xl_emp_out.iloc[conf]["Sex"]]
xl_ctr = ctr_df[ctr_df.is_excel].copy()
xl_ctr_out = pd.DataFrame({
    "Contract Ref": xl_ctr.contract_id, "Staff ID": xl_ctr.employee_id,
    "Duty Station Country": [rnd_country(c, 0.10) for c in xl_ctr.country],
    "Grade": ["Grade " + g[1] for g in xl_ctr.grade], "Department": xl_ctr.department,
    "Position": xl_ctr.position_title, "Contract Type": xl_ctr.contract_type,
    "Contract Start": [d.strftime("%d/%m/%Y") for d in xl_ctr.start_date],
    "Planned End": [d.strftime("%d/%m/%Y") if d is not None and not pd.isna(d) else "" for d in xl_ctr.planned_end_date],
    "Actual End": [d.strftime("%d/%m/%Y") if d is not None and not pd.isna(d) else "" for d in xl_ctr.end_date],
    "Start Reason": xl_ctr.start_reason, "End Reason": xl_ctr.end_reason.fillna(""),
})
xl_sep = exit_df[(exit_df.staff_category == "National Staff") & (exit_df.exit_date < CORE_NATIONAL_GO_LIVE)]
xl_sep_out = pd.DataFrame({
    "Staff ID": xl_sep.employee_id, "Separation Date": [d.strftime("%d/%m/%Y") for d in xl_sep.exit_date],
    "Separation Type": xl_sep.exit_type, "Separation Reason": xl_sep.exit_reason,
    "Duty Station Country": xl_sep.country, "Grade": ["Grade " + g[1] for g in xl_sep.grade],
    "Department": xl_sep.department, "Contract Ref": xl_sep.contract_id,
})
with pd.ExcelWriter(RAW_DIR / "excel_trackers" / "national_staff_tracker_2023_2024.xlsx") as xw:
    xl_emp_out.to_excel(xw, sheet_name="Staff List", index=False)
    xl_ctr_out.to_excel(xw, sheet_name="Contracts", index=False)
    xl_sep_out.to_excel(xw, sheet_name="Separations", index=False)

# ---- Excel: historical vacancy tracker (vacancies opened before JIRA go-live)
OUTCOME_VARIANTS = {"External Recruitment": ["External Recruitment", "Ext. Recruitment", "external"],
                    "Internal Mobility": ["Internal Mobility", "internal mobility", "Internal move"],
                    "National Recruitment": ["National Recruitment", "Nat. Recruitment"],
                    "Cancelled Position": ["Cancelled", "Cancelled Position", "Position cancelled"]}
hv = vac_df[vac_df.legacy_ref.notna()].copy()
migrated = hv.jira_key.notna()
hv_out = pd.DataFrame({
    "Vacancy Ref": hv.legacy_ref, "Country": [rnd_country(c, 0.10) for c in hv.country],
    "Staff Type": hv.staff_category.str.replace(" Staff", ""), "Grade": ["Grade " + g[1] for g in hv.grade],
    "Department": hv.department, "Position Title": hv.position_title,
    "Opening Type": hv.position_type, "Date Opened": [d.strftime("%d/%m/%Y") for d in hv.opened_date],
    "Target Date": [d.strftime("%d/%m/%Y") for d in hv.planned_close_date],
    # vacancies migrated to JIRA were still open when the tracker was frozen
    "Date Closed": ["" if mig or d is None or pd.isna(d) else d.strftime("%d/%m/%Y") for d, mig in zip(hv.closed_date, migrated)],
    "Outcome": ["" if mig or s_or_none(o) is None else str(rng.choice(OUTCOME_VARIANTS[o])) for o, mig in zip(hv.outcome, migrated)],
    "Candidate Type": ["" if mig or s_or_none(c) is None else c for c, mig in zip(hv.candidate_type, migrated)],
    "Selected Staff ID": ["" if mig or s_or_none(e) is None else e for e, mig in zip(hv.hired_employee_id, migrated)],
    "Replaced Staff ID": hv.replaced_employee_id.fillna(""),
    "Applicants": hv.applicants, "Shortlisted": hv.shortlisted, "Interviewed": hv.interviewed, "Offers": hv.offers,
    "Status (at freeze)": ["Open - migrated to JIRA" if mig else "Closed" for mig in migrated],
})
hv_out.to_excel(RAW_DIR / "excel_trackers" / "vacancy_tracker_2022_2024.xlsx", index=False, sheet_name="Vacancies")

# ---- JIRA recruitment export
jv = vac_df[vac_df.jira_key.notna()].copy()
STAGES = ["Shortlisting", "Interviewing", "Offer Stage"]
status_out = []
for v in jv.itertuples():
    if v.status == "Open" or s_or_none(v.outcome) is None:
        status_out.append(str(rng.choice(STAGES, p=[.45, .4, .15])))
    else:
        status_out.append("Cancelled" if v.outcome == "Cancelled Position" else "Done")
onboard_hours = rng.integers(3, 16, size=len(jv)) * 24
jira_out = pd.DataFrame({
    "Issue key": jv.jira_key, "Issue Type": "Recruitment Request",
    "Summary": [f"{t} – {c} ({g})" for t, c, g in zip(jv.position_title, jv.country, jv.grade)],
    "Status": status_out, "Resolution": jv.outcome.fillna(""),
    "Created": [d.isoformat() + "T09:00:00" for d in jv.opened_date],
    "Due date": [d.isoformat() for d in jv.planned_close_date],
    "Resolved": ["" if d is None or pd.isna(d) else d.isoformat() + "T17:00:00" for d in jv.closed_date],
    "Country": jv.country, "Staff Category": jv.staff_category, "Grade": jv.grade, "Department": jv.department,
    "Opening Type": jv.position_type, "Candidate Type": jv.candidate_type.fillna(""),
    "Selected Employee ID": jv.hired_employee_id.fillna(""), "Replaced Employee ID": jv.replaced_employee_id.fillna(""),
    "Expected Start Date": ["" if d is None or pd.isna(d) else d.isoformat() for d in jv.hire_start_date],
    "Applicants": jv.applicants, "Shortlisted": jv.shortlisted, "Interviewed": jv.interviewed, "Offers": jv.offers,
    "Legacy Ref": jv.legacy_ref.fillna(""),
})
# operational measure: created -> ticket done incl. onboarding admin (differs from duration-to-close)
tth = []
for v, extra in zip(jv.itertuples(), onboard_hours):
    tth.append("" if pd.isna(v.closed_date) or v.status == "Open" else int((v.closed_date - v.opened_date).days * 24 + extra))
jira_out["time_to_done_hours"] = tth
# data-entry errors: resolution timestamp before creation
closed_idx = jira_out.index[jira_out.Resolved != ""].to_numpy()
bad = rng.choice(closed_idx, size=5, replace=False)
for i in bad:
    created = dt.date.fromisoformat(jira_out.at[i, "Created"][:10])
    jira_out.at[i, "Resolved"] = (created - D(days=int(rng.integers(2, 20)))).isoformat() + "T17:00:00"
jira_out.loc[rng.choice(jira_out.index, size=int(len(jira_out) * 0.04), replace=False), "Country"] = \
    [rnd_country(c, 1.0) for c in jira_out.loc[rng.choice(jira_out.index, size=int(len(jira_out) * 0.04), replace=False), "Country"]]
no_due = rng.choice(jira_out.index, size=int(len(jira_out) * 0.015), replace=False)  # due date not set on ticket
jira_out.loc[no_due, "Due date"] = ""
dups = jira_out.sample(n=9, random_state=SEED)  # duplicated rows from overlapping exports
jira_out = pd.concat([jira_out, dups]).sort_values("Created").reset_index(drop=True)
jira_out.to_csv(RAW_DIR / "jira" / "recruitment_export.csv", index=False)

# ---- Surges: Excel tracker (<= 2025) and JIRA (2026)
srg_df["ref"] = [f"SRG-{r.request_date.year}-{r.surge_seq:04d}" for r in srg_df.itertuples()]
old = srg_df[srg_df.request_date < JIRA_SURGE_GO_LIVE]
new = srg_df[srg_df.request_date >= JIRA_SURGE_GO_LIVE]
pd.DataFrame({
    "Surge Ref": old.ref, "Requesting Country": [rnd_country(c, 0.12) for c in old.requesting_country],
    "Request Date": [d.strftime("%d/%m/%Y") for d in old.request_date], "Role": old.role,
    "Status": old.status, "Deployed Staff ID": old.deployed_employee_id.fillna(""),
    "Deployed Staff Type": old.deployed_category.fillna("").str.replace(" Staff", ""),
    "Home Country": old.home_country.fillna(""),
    "Deployment Start": [d.strftime("%d/%m/%Y") if d is not None and not pd.isna(d) else "" for d in old.start_date],
    "Deployment End": [d.strftime("%d/%m/%Y") if d is not None and not pd.isna(d) else "" for d in old.end_date],
}).to_excel(RAW_DIR / "excel_trackers" / "surge_tracker_2023_2025.xlsx", index=False, sheet_name="Surge Requests")
pd.DataFrame({
    "Issue key": [f"SURGE-{i + 101}" for i in range(len(new))], "Issue Type": "Surge Request",
    "Legacy Ref": new.ref.values, "Country": new.requesting_country.values,
    "Created": [d.isoformat() for d in new.request_date],
    "Status": new.status.map({"Filled": "Done", "Cancelled": "Cancelled", "Open": "Open"}).values,
    "Role": new.role.values, "Deployed Employee ID": new.deployed_employee_id.fillna("").values,
    "Deployed Staff Category": new.deployed_category.fillna("").values, "Home Country": new.home_country.fillna("").values,
    "Deployment Start": [fmt(d) or "" for d in new.start_date], "Deployment End": [fmt(d) or "" for d in new.end_date],
}).to_csv(RAW_DIR / "jira" / "surge_export.csv", index=False)

# ---- Excel: monthly snapshot trackers (manually maintained -> small discrepancies)
emp_nat = emp_df.set_index("employee_id").nationality
snap_rows, expat_rows = [], []
for m_start, m_end in months(SIM_START, dt.date(2025, 12, 31)):
    hc = headcount_on(m_end)
    for (country, cat), val in hc.items():
        if cat == "National Staff" and m_end < CORE_NATIONAL_GO_LIVE:
            reported = val
            r = rng.random()
            if r < 0.03:
                reported = val + int(rng.choice([-2, -1, 1, 2]))
            if r > 0.985:
                continue  # month not submitted by the country office
            snap_rows.append({"Month": m_end.strftime("%Y-%m"), "Country": country, "Staff Type": "National",
                              "Headcount (reported)": reported})
    ex = defaultdict(int)
    for c in contracts:
        if c["start_date"] <= m_end and (c["end_date"] is None or c["end_date"] >= m_end):
            if emp_nat[c["employee_id"]] != c["country"]:
                ex[c["country"]] += 1
    for country, val in ex.items():
        reported = val + (int(rng.choice([-1, 1])) if rng.random() < 0.04 else 0)
        expat_rows.append({"Month": m_end.strftime("%Y-%m"), "Duty Country": country, "Expatriated Staff": reported})
pd.DataFrame(snap_rows).to_excel(RAW_DIR / "excel_trackers" / "national_headcount_snapshots_2023_2024.xlsx",
                                 index=False, sheet_name="Monthly Headcount")
pd.DataFrame(expat_rows).to_excel(RAW_DIR / "excel_trackers" / "expatriation_tracker_2023_2025.xlsx",
                                  index=False, sheet_name="Expatriation")

# ---- generator truth (used by tests to prove the pipeline reconstructs the workforce exactly)
(RAW_DIR / "_generator_truth.json").write_text(json.dumps({
    "seed": SEED, "employees": len(employees), "contracts": len(contracts), "exits": len(exits),
    "vacancies": len(vacancies), "surges": len(surges), "appraisals": len(appraisals),
    "monthly_headcount": truth,
}, indent=1))

print(f"employees={len(employees)} contracts={len(contracts)} exits={len(exits)} vacancies={len(vacancies)} "
      f"surges={len(surges)} appraisals={len(appraisals)}")
for k in ("2024-01-31", "2024-12-31", "2025-10-31", "2026-10-31"):
    print(k, truth[k])
