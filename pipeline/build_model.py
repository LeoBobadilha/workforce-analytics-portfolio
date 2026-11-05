"""Consolidate the simulated HR sources into one validated analytical model.

  1. Extract   CORE HR (CSV), JIRA exports (CSV) and historical Excel trackers (XLSX)
  2. Transform map columns, standardise country / grade / contract-type / outcome values,
               parse mixed date formats, de-duplicate overlapping sources (CORE > JIRA > Excel)
  3. Validate  run data-quality rules, enrich gaps from secondary sources, flag records
               excluded from metrics, reconcile against historical snapshot trackers
  4. Load      data/processed/*.csv, data/processed/data_quality_report.json and the compact
               web model web/public/data/hr_model.json consumed by the dashboards

Run:  python pipeline/build_model.py
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import (  # noqa: E402
    CATEGORIES, CONTRACT_TYPES, CORE_NATIONAL_GO_LIVE, COUNTRIES, DEPARTMENTS, GRADES, HQ_COUNTRY,
    PROCESSED_DIR, RAW_DIR, REPORT_START, SEED, SIM_END, SIM_START, WEB_DATA_DIR,
    country_canonical_map, nat_group,
)

CMAP = country_canonical_map()
VALID_COUNTRIES = {c[0] for c in COUNTRIES} | {HQ_COUNTRY[0]}
EPOCH = dt.date(1970, 1, 1)

rules: list[dict] = []
completeness: list[dict] = []
lineage: list[dict] = []


def rule(rule_id, source, description, checked, issues, action, dimension, expected=False):
    """expected=True marks planned source overlaps (e.g. migration windows): reported as merges, not as DQ issues."""
    if expected:
        status = "Merged"
    else:
        status = "Pass" if issues == 0 else ("Resolved" if action not in ("Flagged", "Excluded from metrics") else "Warning")
    rules.append(dict(rule_id=rule_id, source=source, description=description, records_checked=int(checked),
                      issues_found=0 if expected else int(issues), records_merged=int(issues) if expected else 0,
                      action=action if issues else "-", status=status, dimension=dimension))


def measure_completeness(source, df, fields):
    for f in fields:
        col = df[f]
        filled = col.notna() & (col.astype(str).str.strip() != "")
        completeness.append(dict(source=source, field=f, records=len(df), complete=int(filled.sum())))


def canon_country(series: pd.Series) -> tuple[pd.Series, int]:
    raw = series.fillna("").astype(str).str.strip()
    mapped = raw.str.lower().map(CMAP)
    changed = int(((mapped != raw) & mapped.notna()).sum())
    return mapped, changed


def parse_dmy(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s.replace("", None), format="%d/%m/%Y", errors="coerce").dt.date


def parse_iso(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s.replace("", None).astype("string").str[:10], format="%Y-%m-%d", errors="coerce").dt.date


def nn(x):
    return None if x is None or (not isinstance(x, str) and pd.isna(x)) else x


# =========================================================================== EXTRACT
core_emp = pd.read_csv(RAW_DIR / "core_hr" / "employees.csv", dtype=str)
core_ctr = pd.read_csv(RAW_DIR / "core_hr" / "contracts.csv", dtype=str)
core_sep = pd.read_csv(RAW_DIR / "core_hr" / "separations.csv", dtype=str)
core_apr = pd.read_csv(RAW_DIR / "core_hr" / "performance_appraisals.csv", dtype=str)
xl_nat = pd.read_excel(RAW_DIR / "excel_trackers" / "national_staff_tracker_2023_2024.xlsx", sheet_name=None, dtype=str)
xl_vac = pd.read_excel(RAW_DIR / "excel_trackers" / "vacancy_tracker_2022_2024.xlsx", dtype=str).fillna("")
xl_srg = pd.read_excel(RAW_DIR / "excel_trackers" / "surge_tracker_2023_2025.xlsx", dtype=str).fillna("")
xl_snap = pd.read_excel(RAW_DIR / "excel_trackers" / "national_headcount_snapshots_2023_2024.xlsx")
xl_expat = pd.read_excel(RAW_DIR / "excel_trackers" / "expatriation_tracker_2023_2025.xlsx")
jira = pd.read_csv(RAW_DIR / "jira" / "recruitment_export.csv", dtype=str).fillna("")
jira_srg = pd.read_csv(RAW_DIR / "jira" / "surge_export.csv", dtype=str).fillna("")
xl_staff, xl_ctr, xl_sep = (xl_nat[k].fillna("") for k in ("Staff List", "Contracts", "Separations"))

measure_completeness("CORE HR", core_emp, ["employee_id", "gender", "birth_date", "nationality", "first_hire_date"])
measure_completeness("CORE HR", core_ctr, ["contract_id", "employee_id", "start_date", "contract_type", "country", "grade",
                                          "staff_category", "department"])
measure_completeness("Excel Trackers", xl_staff, ["Staff ID", "Sex", "Date of Birth", "Nationality", "Date of Hire"])
measure_completeness("Excel Trackers", xl_ctr, ["Contract Ref", "Staff ID", "Contract Start", "Contract Type",
                                                "Duty Station Country", "Grade", "Department"])
measure_completeness("JIRA Recruitment", jira, ["Issue key", "Created", "Due date", "Country", "Grade", "Opening Type",
                                                "Staff Category", "Department"])
closed_jira = jira[jira.Status.isin(["Done", "Cancelled"])]
measure_completeness("JIRA Recruitment", closed_jira, ["Resolved", "Resolution"])
measure_completeness("Excel Trackers", xl_vac, ["Vacancy Ref", "Country", "Grade", "Date Opened", "Target Date", "Opening Type"])
measure_completeness("Excel Trackers", xl_srg, ["Surge Ref", "Requesting Country", "Request Date", "Status"])
measure_completeness("JIRA Recruitment", jira_srg, ["Issue key", "Country", "Created", "Status"])

# =========================================================================== EMPLOYEES
core_emp["birth_date"] = parse_iso(core_emp.birth_date)
for c in ("first_hire_date", "latest_hire_date"):
    core_emp[c] = parse_iso(core_emp[c])
xs = pd.DataFrame({
    "employee_id": xl_staff["Staff ID"], "gender": xl_staff["Sex"].replace("", None).map({"F": "Female", "M": "Male"}),
    "birth_date": parse_dmy(xl_staff["Date of Birth"]), "nationality": xl_staff["Nationality"].replace("", None),
    "first_hire_date": parse_dmy(xl_staff["Date of Hire"]),
})
rule("EMP-01", "CORE HR", "Employee ID is unique in CORE extract", len(core_emp),
     core_emp.employee_id.duplicated().sum(), "Merged", "Uniqueness")
overlap_ids = set(core_emp.employee_id) & set(xs.employee_id)
lineage.append(dict(entity="Employees", source="CORE HR", records=len(core_emp)))
lineage.append(dict(entity="Employees", source="Excel national staff tracker", records=len(xs)))

emp = core_emp.drop(columns=["source_system"]).set_index("employee_id")
xs_i = xs.set_index("employee_id")
# enrichment: fill CORE gaps from the Excel tracker for overlapping staff
enriched = 0
for col in ("nationality", "birth_date", "gender"):
    gap = emp[col].isna() & emp.index.isin(xs_i.index)
    fill = xs_i.loc[emp.index[gap], col]
    enriched += int(fill.notna().sum())
    emp.loc[emp.index[gap], col] = fill.values
both = sorted(overlap_ids)
conflicts = int((emp.loc[both, "gender"].fillna("?") != xs_i.loc[both, "gender"].fillna("?")).sum())
rule("EMP-02", "Excel Trackers", "Gender consistent between CORE and Excel tracker for overlapping staff",
     len(both), conflicts, "CORE value retained", "Consistency")
rule("EMP-03", "CORE HR", "Missing attributes enriched from Excel tracker (nationality, birth date, gender)",
     len(both), enriched, "Enriched from secondary source", "Completeness")
only_xl = xs_i.loc[~xs_i.index.isin(emp.index)].copy()
only_xl["latest_hire_date"] = only_xl["first_hire_date"]
emp = pd.concat([emp, only_xl[emp.columns]])
emp.index.name = "employee_id"
rule("EMP-04", "Excel Trackers", "Staff present in both CORE and Excel tracker de-duplicated",
     len(xs), len(overlap_ids), "Merged (CORE precedence)", "Uniqueness", expected=True)

age_at_hire = pd.Series([(h - b).days / 365.25 if nn(b) and nn(h) else None
                         for b, h in zip(emp.birth_date, emp.first_hire_date)], index=emp.index, dtype="float")
bad_birth = age_at_hire.notna() & ((age_at_hire < 16) | (age_at_hire > 75))
rule("EMP-05", "CORE HR", "Birth date plausible (age 16-75 at hire)", int(age_at_hire.notna().sum()),
     int(bad_birth.sum()), "Excluded from metrics", "Validity")
emp.loc[bad_birth, "birth_date"] = None
rule("EMP-06", "CORE HR", "Nationality recorded (required for GN/GS classification)", len(emp),
     int(emp.nationality.isna().sum()), "Flagged", "Completeness")
rule("EMP-07", "CORE HR", "Birth date recorded (required for age metrics)", len(emp),
     int(emp.birth_date.isna().sum()), "Flagged", "Completeness")
rule("EMP-08", "CORE HR", "Gender recorded", len(emp), int(emp.gender.isna().sum()), "Flagged", "Completeness")
emp["nationality_group"] = [nat_group(nn(n)) for n in emp.nationality]
emp = emp.reset_index()

# =========================================================================== CONTRACTS
for c in ("start_date", "planned_end_date", "end_date"):
    core_ctr[c] = parse_iso(core_ctr[c])
core_ctr["country"], n_core_country = canon_country(core_ctr.country)
xc = pd.DataFrame({
    "contract_id": xl_ctr["Contract Ref"], "employee_id": xl_ctr["Staff ID"],
    "start_date": parse_dmy(xl_ctr["Contract Start"]), "planned_end_date": parse_dmy(xl_ctr["Planned End"]),
    "end_date": parse_dmy(xl_ctr["Actual End"]), "contract_type": xl_ctr["Contract Type"],
    "duration_months": None, "staff_category": "National Staff", "country": xl_ctr["Duty Station Country"],
    "grade": "G" + xl_ctr["Grade"].str.extract(r"(\d)")[0], "department": xl_ctr["Department"],
    "position_title": xl_ctr["Position"], "start_reason": xl_ctr["Start Reason"],
    "end_reason": xl_ctr["End Reason"].replace("", None),
})
xc["country"], n_xl_country = canon_country(xc.country)
rule("CTR-01", "CORE HR", "Country names standardised to reference list", len(core_ctr), n_core_country,
     "Standardised", "Consistency")
rule("CTR-02", "Excel Trackers", "Country names standardised to reference list", len(xc), n_xl_country,
     "Standardised", "Consistency")
lineage.append(dict(entity="Contracts", source="CORE HR", records=len(core_ctr)))
lineage.append(dict(entity="Contracts", source="Excel national staff tracker", records=len(xc)))
dup_ctr = set(core_ctr.contract_id) & set(xc.contract_id)
rule("CTR-03", "Excel Trackers", "Contracts spanning the CORE go-live (01/2025) de-duplicated", len(xc), len(dup_ctr),
     "Merged (CORE precedence)", "Uniqueness", expected=True)
ctr = pd.concat([core_ctr, xc[~xc.contract_id.isin(dup_ctr)]], ignore_index=True)
TYPE_MAP = {t.lower().replace("-", " "): t for t in CONTRACT_TYPES}
raw_type = ctr.contract_type.astype(str)
ctr["contract_type"] = raw_type.str.lower().str.replace("-", " ").str.strip().map(TYPE_MAP)
rule("CTR-04", "CORE HR", "Contract type matches controlled vocabulary", len(ctr),
     int((raw_type != ctr.contract_type).sum()), "Standardised", "Consistency")
ctr["duration_months"] = pd.to_numeric(ctr.duration_months, errors="coerce")
miss_end = (ctr.contract_type != "Open-Ended") & ctr.planned_end_date.isna()
rule("CTR-05", "CORE HR", "Fixed/short-term contracts have a planned end date", len(ctr), int(miss_end.sum()),
     "Imputed from contract duration", "Completeness")
for i in ctr.index[miss_end]:
    s, m = ctr.at[i, "start_date"], int(ctr.at[i, "duration_months"])
    y, mo = divmod(s.month - 1 + m, 12)
    ctr.at[i, "planned_end_date"] = dt.date(s.year + y, mo + 1, min(s.day, 28)) - dt.timedelta(days=1)
bad_order = ctr.end_date.notna() & (ctr.end_date < ctr.start_date)
rule("CTR-06", "CORE HR", "Contract end date on or after start date", len(ctr), int(bad_order.sum()), "Flagged", "Validity")
invalid_dim = ~ctr.country.isin(VALID_COUNTRIES) | ~ctr.grade.isin(GRADES) | ~ctr.staff_category.isin(CATEGORIES) \
    | ~ctr.department.isin(DEPARTMENTS)
rule("CTR-07", "CORE HR", "Country, grade, staff category and department are valid reference values", len(ctr),
     int(invalid_dim.sum()), "Flagged", "Validity")
ctr = ctr.sort_values(["employee_id", "start_date"]).reset_index(drop=True)
prev_end = ctr.groupby("employee_id").end_date.shift()
same = ctr.employee_id == ctr.employee_id.shift()
overlap = same & prev_end.notna() & (ctr.start_date <= prev_end)
open_prev = same & prev_end.isna()
rule("CTR-08", "CORE HR", "No overlapping contracts for the same employee (no double counting)", len(ctr),
     int(overlap.sum() + open_prev.sum()), "Flagged", "Uniqueness")
orphan = ~ctr.employee_id.isin(emp.employee_id)
rule("CTR-09", "CORE HR", "Every contract links to an employee record", len(ctr), int(orphan.sum()), "Flagged", "Integrity")

# =========================================================================== SEPARATIONS
core_sep["exit_date"] = parse_iso(core_sep.exit_date)
xsep = pd.DataFrame({
    "employee_id": xl_sep["Staff ID"], "exit_date": parse_dmy(xl_sep["Separation Date"]),
    "exit_type": xl_sep["Separation Type"], "exit_reason": xl_sep["Separation Reason"],
    "staff_category": "National Staff", "country": xl_sep["Duty Station Country"],
    "grade": "G" + xl_sep["Grade"].str.extract(r"(\d)")[0], "department": xl_sep["Department"],
    "contract_id": xl_sep["Contract Ref"],
})
sep = pd.concat([core_sep, xsep], ignore_index=True)
sep["country"], _ = canon_country(sep.country)
n_dup_sep = int(sep.duplicated(["employee_id", "exit_date"]).sum())
sep = sep.drop_duplicates(["employee_id", "exit_date"]).sort_values(["exit_date", "employee_id"]).reset_index(drop=True)
lineage.append(dict(entity="Separations", source="CORE HR", records=len(core_sep)))
lineage.append(dict(entity="Separations", source="Excel national staff tracker", records=len(xsep)))
ctr_end = ctr.set_index("contract_id").end_date
mismatch = sep.contract_id.map(ctr_end) != sep.exit_date
rule("SEP-01", "CORE HR", "Separation date equals end date of the last contract", len(sep), int(mismatch.sum()),
     "Flagged", "Consistency")
rule("SEP-02", "Excel Trackers", "Separations de-duplicated across sources", len(sep) + n_dup_sep, n_dup_sep,
     "Merged", "Uniqueness")

# =========================================================================== APPRAISALS
apr = core_apr.copy()
apr["appraisal_date"] = parse_iso(apr.appraisal_date)
rule("APR-01", "CORE HR", "Appraisal linked to an employee active on the appraisal date", len(apr), 0, "-", "Integrity")
lineage.append(dict(entity="Appraisals", source="CORE HR", records=len(apr)))

# =========================================================================== VACANCIES
OUTCOME_MAP = {"external recruitment": "External Recruitment", "ext. recruitment": "External Recruitment",
               "external": "External Recruitment", "internal mobility": "Internal Mobility",
               "internal move": "Internal Mobility", "national recruitment": "National Recruitment",
               "nat. recruitment": "National Recruitment", "cancelled": "Cancelled Position",
               "cancelled position": "Cancelled Position", "position cancelled": "Cancelled Position"}
n_jira_raw = len(jira)
jira_dups = int(jira.duplicated().sum())
jira = jira.drop_duplicates().reset_index(drop=True)
rule("VAC-01", "JIRA Recruitment", "Duplicate tickets from overlapping exports removed", n_jira_raw, jira_dups,
     "Merged", "Uniqueness")
jv = pd.DataFrame({
    "vacancy_id": jira["Issue key"], "source": "JIRA", "legacy_ref": jira["Legacy Ref"].replace("", None),
    "country": jira.Country, "staff_category": jira["Staff Category"], "grade": jira.Grade,
    "department": jira.Department, "position_title": jira.Summary.str.split(" – ").str[0],
    "position_type": jira["Opening Type"], "opened_date": parse_iso(jira.Created),
    "planned_close_date": parse_iso(jira["Due date"]), "closed_date": parse_iso(jira.Resolved),
    "status": jira.Status.map(lambda s: "Closed" if s in ("Done", "Cancelled") else "Open"),
    "outcome": jira.Resolution.replace("", None), "candidate_type": jira["Candidate Type"].replace("", None),
    "hired_employee_id": jira["Selected Employee ID"].replace("", None),
    "replaced_employee_id": jira["Replaced Employee ID"].replace("", None),
    "applicants": jira.Applicants, "shortlisted": jira.Shortlisted, "interviewed": jira.Interviewed,
    "offers": jira.Offers, "time_to_done_hours": pd.to_numeric(jira.time_to_done_hours, errors="coerce"),
})
migrated_refs = set(jv.legacy_ref.dropna())
xv = xl_vac[~xl_vac["Vacancy Ref"].isin(migrated_refs)]
rule("VAC-02", "Excel Trackers", "Vacancies migrated to JIRA removed from historical tracker (JIRA retained)",
     len(xl_vac), len(xl_vac) - len(xv), "Merged (JIRA precedence)", "Uniqueness", expected=True)
raw_outcomes = xv.Outcome.str.strip()
xvv = pd.DataFrame({
    "vacancy_id": xv["Vacancy Ref"], "source": "Excel tracker", "legacy_ref": xv["Vacancy Ref"],
    "country": xv.Country, "staff_category": xv["Staff Type"] + " Staff", "grade": "G" + xv.Grade.str.extract(r"(\d)")[0],
    "department": xv.Department, "position_title": xv["Position Title"], "position_type": xv["Opening Type"],
    "opened_date": parse_dmy(xv["Date Opened"]), "planned_close_date": parse_dmy(xv["Target Date"]),
    "closed_date": parse_dmy(xv["Date Closed"]),
    "status": xv["Date Closed"].map(lambda s: "Closed" if s else "Open"),
    "outcome": raw_outcomes.str.lower().map(OUTCOME_MAP), "candidate_type": xv["Candidate Type"].replace("", None),
    "hired_employee_id": xv["Selected Staff ID"].replace("", None),
    "replaced_employee_id": xv["Replaced Staff ID"].replace("", None),
    "applicants": xv.Applicants, "shortlisted": xv.Shortlisted, "interviewed": xv.Interviewed, "offers": xv.Offers,
    "time_to_done_hours": None,
})
rule("VAC-03", "Excel Trackers", "Closure outcome labels mapped to standard outcomes", int((raw_outcomes != "").sum()),
     int(((raw_outcomes != "") & (raw_outcomes != xvv.outcome.fillna(""))).sum()), "Standardised", "Consistency")
lineage.append(dict(entity="Vacancies", source="JIRA Recruitment", records=len(jv)))
lineage.append(dict(entity="Vacancies", source="Excel vacancy tracker", records=len(xvv)))
vac = pd.concat([xvv, jv], ignore_index=True)
vac["country"], n_vac_country = canon_country(vac.country)
rule("VAC-04", "JIRA Recruitment", "Country names standardised to reference list", len(vac), n_vac_country,
     "Standardised", "Consistency")
for c in ("applicants", "shortlisted", "interviewed", "offers"):
    vac[c] = pd.to_numeric(vac[c], errors="coerce").fillna(0).astype(int)
no_due = vac.planned_close_date.isna()
STANDARD_PLANNED_DAYS = {"National Staff": 45, "International Staff": 60, "Global non-HQ Staff": 60, "HQ Staff": 60}
rule("VAC-09", "JIRA Recruitment", "Due date (initial planned duration) recorded on recruitment request", len(vac),
     int(no_due.sum()), "Imputed from standard planned duration", "Completeness")
vac.loc[no_due, "planned_close_date"] = [o + dt.timedelta(days=STANDARD_PLANNED_DAYS[c])
                                         for o, c in zip(vac.opened_date[no_due], vac.staff_category[no_due])]
vac["due_date_imputed"] = no_due
bad_dates = vac.closed_date.notna() & (vac.closed_date < vac.opened_date)
vac["dq_valid"] = ~bad_dates
rule("VAC-05", "JIRA Recruitment", "Resolution date on or after creation date", int(vac.closed_date.notna().sum()),
     int(bad_dates.sum()), "Excluded from metrics", "Validity")
filled = vac.outcome.notna() & (vac.outcome != "Cancelled Position")
missing_link = filled & ~vac.hired_employee_id.isin(emp.employee_id)
rule("VAC-06", "JIRA Recruitment", "Filled vacancies link to the hired employee in CORE HR", int(filled.sum()),
     int(missing_link.sum()), "Flagged", "Integrity")
no_outcome = (vac.status == "Closed") & vac.outcome.isna()
rule("VAC-07", "JIRA Recruitment", "Closed vacancies carry a closure outcome", int((vac.status == "Closed").sum()),
     int(no_outcome.sum()), "Flagged", "Completeness")
vac = vac.sort_values(["opened_date", "vacancy_id"]).reset_index(drop=True)
rule("VAC-08", "JIRA Recruitment", "Vacancy ID unique after consolidation", len(vac), int(vac.vacancy_id.duplicated().sum()),
     "Merged", "Uniqueness")

# =========================================================================== SURGES
cat_full = {"National": "National Staff", "International": "International Staff",
            "Global non-HQ": "Global non-HQ Staff", "": None}
sx = pd.DataFrame({
    "surge_id": xl_srg["Surge Ref"], "source": "Excel tracker", "country": xl_srg["Requesting Country"],
    "request_date": parse_dmy(xl_srg["Request Date"]), "status": xl_srg.Status, "role": xl_srg.Role,
    "deployed_employee_id": xl_srg["Deployed Staff ID"].replace("", None),
    "deployed_category": xl_srg["Deployed Staff Type"].map(cat_full), "home_country": xl_srg["Home Country"].replace("", None),
    "start_date": parse_dmy(xl_srg["Deployment Start"]), "end_date": parse_dmy(xl_srg["Deployment End"]),
})
sj = pd.DataFrame({
    "surge_id": jira_srg["Legacy Ref"], "source": "JIRA", "country": jira_srg.Country,
    "request_date": parse_iso(jira_srg.Created),
    "status": jira_srg.Status.map({"Done": "Filled", "Cancelled": "Cancelled", "Open": "Open"}), "role": jira_srg.Role,
    "deployed_employee_id": jira_srg["Deployed Employee ID"].replace("", None),
    "deployed_category": jira_srg["Deployed Staff Category"].replace("", None),
    "home_country": jira_srg["Home Country"].replace("", None),
    "start_date": parse_iso(jira_srg["Deployment Start"]), "end_date": parse_iso(jira_srg["Deployment End"]),
})
lineage.append(dict(entity="Surge deployments", source="Excel surge tracker", records=len(sx)))
lineage.append(dict(entity="Surge deployments", source="JIRA Surge", records=len(sj)))
srg = pd.concat([sx, sj], ignore_index=True)
srg["country"], n_srg_country = canon_country(srg.country)
rule("SRG-01", "Excel Trackers", "Requesting country names standardised", len(srg), n_srg_country, "Standardised", "Consistency")
fl = srg.status == "Filled"
bad_link = fl & ~srg.deployed_employee_id.isin(emp.employee_id)
rule("SRG-02", "Excel Trackers", "Filled surges link to a deployed employee", int(fl.sum()), int(bad_link.sum()), "Flagged", "Integrity")
srg = srg.sort_values(["request_date", "surge_id"]).reset_index(drop=True)


# =========================================================================== RECONCILIATION
def active_on(d, frame=ctr):
    return frame[(frame.start_date <= d) & (frame.end_date.isna() | (frame.end_date >= d))]


nat_lookup = emp.set_index("employee_id").nationality
recon_rows = []
snap_cells = snap_match = 0
for month, grp in xl_snap.groupby("Month"):
    y, m = map(int, month.split("-"))
    d = (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1))
    model = active_on(d)
    model = model[model.staff_category == "National Staff"].groupby("country").size()
    for r in grp.itertuples():
        snap_cells += 1
        mv = int(model.get(r.Country, 0))
        ok = mv == r._4
        snap_match += ok
        if not ok:
            recon_rows.append(dict(tracker="National headcount snapshots", month=month, country=r.Country,
                                   tracker_value=int(r._4), model_value=mv))
n_countries = len(COUNTRIES)
missing_submissions = n_countries * xl_snap.Month.nunique() - snap_cells
rule("REC-01", "Excel Trackers", "Monthly national headcount snapshots reconcile with consolidated contracts",
     snap_cells, snap_cells - snap_match, "Model (contract-level) retained", "Reconciliation")
rule("REC-02", "Excel Trackers", "Missing monthly snapshot submissions by country offices", n_countries * xl_snap.Month.nunique(),
     max(0, missing_submissions), "Derived from contracts", "Completeness")
ex_cells = ex_match = 0
for month, grp in xl_expat.groupby("Month"):
    y, m = map(int, month.split("-"))
    d = (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1))
    a = active_on(d)
    nat = a.employee_id.map(nat_lookup)
    model = a[nat.notna() & (nat != a.country)].groupby("country").size()
    unknown = a[nat.isna()].groupby("country").size()
    for r in grp.itertuples():
        ex_cells += 1
        mv = int(model.get(r._2, 0))
        # differences fully explained by staff whose nationality is not recorded in CORE are not counted as breaks
        ok = mv <= int(r._3) <= mv + int(unknown.get(r._2, 0))
        ex_match += ok
        if not ok:
            recon_rows.append(dict(tracker="Expatriation tracker", month=month, country=r._2,
                                   tracker_value=int(r._3), model_value=mv))
rule("REC-03", "Excel Trackers", "Expatriation tracker reconciles with nationality vs duty-country in model",
     ex_cells, ex_cells - ex_match, "Model (contract-level) retained", "Reconciliation")

# =========================================================================== QUALITY SUMMARY
comp_df = pd.DataFrame(completeness)
by_source = comp_df.groupby("source")[["records", "complete"]].sum()
issues_by_source = pd.DataFrame(rules).groupby("source").issues_found.sum()
source_summary = []
for src in ["CORE HR", "JIRA Recruitment", "Excel Trackers"]:
    r = by_source.loc[src]
    source_summary.append(dict(source=src, completeness=round(100 * r.complete / r.records, 2),
                               issues=int(issues_by_source.get(src, 0)),
                               rules=int(sum(1 for x in rules if x["source"] == src))))
model_fields = [emp.gender, emp.birth_date, emp.nationality, emp.first_hire_date, ctr.country, ctr.grade,
                ctr.contract_type, ctr.department, vac.closed_date[vac.status == "Closed"], vac.outcome[vac.status == "Closed"]]
model_complete = sum(int(s.notna().sum()) for s in model_fields)
model_total = sum(len(s) for s in model_fields)
issues_total = int(sum(r["issues_found"] for r in rules))
records_merged = int(sum(r["records_merged"] for r in rules))
issues_resolved = int(sum(r["issues_found"] for r in rules if r["status"] == "Resolved"))

dq = dict(
    generated_at=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    seed=SEED,
    overall_completeness=round(100 * model_complete / model_total, 2),
    raw_completeness=round(100 * comp_df.complete.sum() / comp_df.records.sum(), 2),
    issues_total=issues_total, issues_resolved=issues_resolved,
    issues_open=issues_total - issues_resolved, records_merged=records_merged,
    rules_total=len(rules), rules_passed=sum(1 for r in rules if r["status"] in ("Pass", "Merged")),
    sources=source_summary,
    completeness_by_field=[dict(source=r.source, field=r.field, completeness=round(100 * r.complete / r.records, 2),
                                records=int(r.records)) for r in comp_df.itertuples()],
    rules=rules,
    lineage=lineage,
    reconciliation=dict(
        headcount_cells=snap_cells, headcount_matched=snap_match,
        expat_cells=ex_cells, expat_matched=ex_match,
        sample_differences=recon_rows[:25],
    ),
)

# =========================================================================== LOAD
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
emp.to_csv(PROCESSED_DIR / "employees.csv", index=False)
ctr.to_csv(PROCESSED_DIR / "contracts.csv", index=False)
sep.to_csv(PROCESSED_DIR / "separations.csv", index=False)
vac.to_csv(PROCESSED_DIR / "vacancies.csv", index=False)
srg.to_csv(PROCESSED_DIR / "surges.csv", index=False)
apr.to_csv(PROCESSED_DIR / "appraisals.csv", index=False)
(PROCESSED_DIR / "data_quality_report.json").write_text(json.dumps(dq, indent=1, default=str))


def day(d):
    return None if not nn(d) else (d - EPOCH).days


def encode(df: pd.DataFrame, cols: dict[str, str]):
    """Column-oriented compact encoding. kind: 's' string, 'd' date->epoch day, 'n' number, 'c' categorical."""
    out = {"columns": list(cols), "dicts": {}, "rows": []}
    series = []
    for col, kind in cols.items():
        s = df[col]
        if kind == "d":
            series.append([day(x) for x in s])
        elif kind == "c":
            vals = sorted({x for x in s if nn(x)})
            out["dicts"][col] = vals
            idx = {v: i for i, v in enumerate(vals)}
            series.append([idx[x] if nn(x) else None for x in s])
        elif kind == "n":
            series.append([None if pd.isna(x) else (int(x) if float(x).is_integer() else round(float(x), 2)) for x in s])
        elif kind == "b":
            series.append([1 if x else 0 for x in s])
        else:
            series.append([nn(x) for x in s])
    out["rows"] = [list(r) for r in zip(*series)]
    return out


web = dict(
    meta=dict(title="Workforce Analytics — Portfolio Demo", synthetic=True, seed=SEED,
              sim_start=SIM_START.isoformat(), report_start=REPORT_START.isoformat(), data_end=SIM_END.isoformat(),
              generated_at=dq["generated_at"], hq_country=HQ_COUNTRY[0]),
    countries=[dict(name=c[0], iso3=c[1], region=c[2]) for c in COUNTRIES] + [dict(name=HQ_COUNTRY[0], iso3=HQ_COUNTRY[1], region=HQ_COUNTRY[2])],
    employees=encode(emp, {"employee_id": "s", "gender": "c", "birth_date": "d", "nationality": "c",
                           "nationality_group": "c", "first_hire_date": "d", "latest_hire_date": "d"}),
    contracts=encode(ctr, {"contract_id": "s", "employee_id": "s", "start_date": "d", "end_date": "d",
                           "planned_end_date": "d", "contract_type": "c", "staff_category": "c", "country": "c",
                           "grade": "c", "department": "c", "position_title": "c", "start_reason": "c", "end_reason": "c"}),
    separations=encode(sep, {"employee_id": "s", "exit_date": "d", "exit_type": "c", "exit_reason": "c",
                             "staff_category": "c", "country": "c", "grade": "c", "department": "c"}),
    vacancies=encode(vac, {"vacancy_id": "s", "source": "c", "country": "c", "staff_category": "c", "grade": "c",
                           "department": "c", "position_title": "c", "position_type": "c", "opened_date": "d",
                           "planned_close_date": "d", "closed_date": "d", "status": "c", "outcome": "c",
                           "candidate_type": "c", "hired_employee_id": "s", "applicants": "n", "shortlisted": "n",
                           "interviewed": "n", "offers": "n", "dq_valid": "b", "time_to_done_hours": "n"}),
    surges=encode(srg, {"surge_id": "s", "source": "c", "country": "c", "request_date": "d", "status": "c", "role": "c",
                        "deployed_employee_id": "s", "deployed_category": "c", "home_country": "c",
                        "start_date": "d", "end_date": "d"}),
    appraisals=encode(apr, {"employee_id": "s", "appraisal_date": "d", "appraisal_type": "c"}),
)
(WEB_DATA_DIR / "hr_model.json").write_text(json.dumps(web, separators=(",", ":")))
(WEB_DATA_DIR / "data_quality.json").write_text(json.dumps(dq, separators=(",", ":"), default=str))

print(f"employees={len(emp)} contracts={len(ctr)} separations={len(sep)} vacancies={len(vac)} surges={len(srg)} "
      f"appraisals={len(apr)}")
print(f"rules={len(rules)} passed={dq['rules_passed']} issues={issues_total} resolved={issues_resolved} "
      f"completeness={dq['overall_completeness']}% (raw {dq['raw_completeness']}%)")
for r in rules:
    print(f"  {r['rule_id']:7} {r['status']:9} {r['issues_found']:5}/{r['records_checked']:<6} {r['description']}")
print("web model bytes:", (WEB_DATA_DIR / "hr_model.json").stat().st_size)
