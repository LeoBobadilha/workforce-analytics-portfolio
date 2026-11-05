"""Shared configuration for the synthetic Workforce Analytics portfolio dataset.

Every value here is illustrative. The country list models a multi-country workforce;
headcounts, nationalities and all other figures are fictional and describe no real
organisation.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
PROCESSED_DIR = ROOT / "data" / "processed"
WEB_DATA_DIR = ROOT / "web" / "public" / "data"

SEED = 20261031

SIM_START = dt.date(2023, 1, 1)      # simulated history (12-month baseline for 2024 YoY)
REPORT_START = dt.date(2024, 1, 1)   # first month exposed in the dashboards
SIM_END = dt.date(2026, 10, 31)      # data cut-off ("as of" date)
CORE_NATIONAL_GO_LIVE = dt.date(2025, 1, 1)  # national staff migrated from Excel into CORE
JIRA_GO_LIVE = dt.date(2025, 1, 1)           # recruitment moved from Excel tracker to JIRA
JIRA_SURGE_GO_LIVE = dt.date(2026, 1, 1)     # surge requests moved from Excel tracker to JIRA

CATEGORIES = ["National Staff", "International Staff", "Global non-HQ Staff", "HQ Staff"]
CAT_SHORT = {"National Staff": "NAT", "International Staff": "INT",
             "Global non-HQ Staff": "GNHQ", "HQ Staff": "HQ"}

GRADES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"]

DEPARTMENTS = [
    "Research & Assessment",
    "GIS & Data Management",
    "Field Operations",
    "Programme Management",
    "Finance & Compliance",
    "HR & Administration",
    "Logistics & IT",
]

CONTRACT_TYPES = ["Open-Ended", "Fixed-Term", "Short-Term"]

# name, iso3, region, national(start, end), international(start, end), female share national
COUNTRIES = [
    ("Afghanistan", "AFG", "Asia & Pacific", (110, 92), (8, 6), 0.22),
    ("Bangladesh", "BGD", "Asia & Pacific", (95, 112), (7, 8), 0.38),
    ("Burkina Faso", "BFA", "West & Central Africa", (72, 60), (6, 5), 0.34),
    ("Central African Republic", "CAF", "West & Central Africa", (60, 56), (6, 6), 0.30),
    ("Chad", "TCD", "West & Central Africa", (52, 86), (5, 8), 0.28),
    ("Colombia", "COL", "Latin America & Caribbean", (48, 60), (4, 5), 0.56),
    ("Democratic Republic of the Congo", "COD", "East & Southern Africa", (120, 140), (10, 12), 0.33),
    ("Ethiopia", "ETH", "East & Southern Africa", (76, 70), (6, 6), 0.36),
    ("Haiti", "HTI", "Latin America & Caribbean", (40, 55), (4, 5), 0.44),
    ("Iraq", "IRQ", "Middle East & North Africa", (100, 80), (8, 6), 0.30),
    ("Jordan", "JOR", "Middle East & North Africa", (40, 46), (6, 7), 0.48),
    ("Kenya", "KEN", "East & Southern Africa", (46, 56), (9, 11), 0.47),
    ("Lebanon", "LBN", "Middle East & North Africa", (52, 70), (5, 7), 0.52),
    ("Libya", "LBY", "Middle East & North Africa", (36, 30), (4, 3), 0.27),
    ("Mali", "MLI", "West & Central Africa", (52, 34), (5, 3), 0.30),
    ("Mozambique", "MOZ", "East & Southern Africa", (44, 50), (4, 5), 0.42),
    ("Myanmar", "MMR", "Asia & Pacific", (60, 66), (5, 6), 0.45),
    ("Niger", "NER", "West & Central Africa", (55, 60), (5, 5), 0.27),
    ("Nigeria", "NGA", "West & Central Africa", (115, 126), (9, 10), 0.37),
    ("Senegal", "SEN", "West & Central Africa", (30, 40), (5, 7), 0.43),
    ("Somalia", "SOM", "East & Southern Africa", (95, 106), (8, 9), 0.29),
    ("South Sudan", "SSD", "East & Southern Africa", (110, 120), (9, 10), 0.30),
    ("Sudan", "SDN", "East & Southern Africa", (55, 122), (5, 11), 0.31),
    ("Syria", "SYR", "Middle East & North Africa", (130, 146), (10, 11), 0.35),
    ("Ukraine", "UKR", "Europe", (150, 112), (14, 9), 0.58),
    ("Yemen", "YEM", "Middle East & North Africa", (105, 110), (8, 8), 0.24),
]

HQ_COUNTRY = ("Switzerland", "CHE", "Headquarters")
HQ_TARGET = (95, 122)

# Global teams based outside headquarters (regional hubs)
GLOBAL_HUBS = {"Kenya": (12, 18), "Jordan": (10, 14), "Senegal": (8, 12)}

# Non-linear trajectories (keyframes) for selected national / international cells.
KEYFRAMES = {
    ("Sudan", "National Staff"): [("2023-01-01", 55), ("2024-03-31", 58), ("2024-09-30", 98), ("2026-10-31", 122)],
    ("Sudan", "International Staff"): [("2023-01-01", 5), ("2024-03-31", 5), ("2024-09-30", 10), ("2026-10-31", 11)],
    ("Ukraine", "National Staff"): [("2023-01-01", 150), ("2024-06-30", 158), ("2025-06-30", 124), ("2026-10-31", 112)],
    ("Ukraine", "International Staff"): [("2023-01-01", 14), ("2024-06-30", 15), ("2025-06-30", 10), ("2026-10-31", 9)],
    ("Lebanon", "National Staff"): [("2023-01-01", 52), ("2024-09-30", 55), ("2025-01-31", 78), ("2026-10-31", 70)],
    ("Mali", "National Staff"): [("2023-01-01", 52), ("2025-03-31", 48), ("2025-09-30", 36), ("2026-10-31", 34)],
}

# Illustrative Global North classification (high-income OECD-DAC countries); everything else = Global South.
GLOBAL_NORTH = {
    "Australia", "Austria", "Belgium", "Canada", "Denmark", "Finland", "France", "Germany",
    "Ireland", "Italy", "Japan", "Netherlands", "New Zealand", "Norway", "Portugal", "Spain",
    "Sweden", "Switzerland", "United Kingdom", "United States",
}

GN_POOL = {
    "France": 14, "United Kingdom": 10, "United States": 8, "Italy": 8, "Germany": 6,
    "Spain": 6, "Belgium": 5, "Canada": 5, "Switzerland": 4, "Netherlands": 3, "Ireland": 3,
    "Sweden": 2, "Norway": 2, "Denmark": 2, "Australia": 2, "Austria": 2, "Portugal": 2,
    "Japan": 1, "Finland": 1, "New Zealand": 1,
}
GN_POOL_HQ = {**GN_POOL, "Switzerland": 18, "France": 20}

GS_POOL = {
    "Kenya": 8, "Lebanon": 6, "India": 6, "Uganda": 5, "Jordan": 5, "Pakistan": 4,
    "Philippines": 4, "Colombia": 4, "Nigeria": 4, "Cameroon": 4, "Senegal": 4, "Ethiopia": 3,
    "Democratic Republic of the Congo": 3, "Syria": 3, "Tunisia": 3, "Morocco": 3, "Egypt": 3,
    "Zimbabwe": 3, "Ghana": 3, "Ukraine": 3, "Iraq": 2, "Bangladesh": 2, "Nepal": 2, "Rwanda": 2,
    "Burkina Faso": 2, "Peru": 2, "Mexico": 2, "Brazil": 2, "Sudan": 2, "South Sudan": 1,
    "Yemen": 1, "Afghanistan": 1, "Mali": 1, "Haiti": 1, "Côte d'Ivoire": 2, "Madagascar": 1,
}

# Neighbouring nationalities occasionally found among national staff
NEIGHBOURS = {
    "Kenya": ["Uganda", "Ethiopia", "Somalia"], "Jordan": ["Syria", "Iraq", "Egypt"],
    "Lebanon": ["Syria"], "Chad": ["Sudan", "Cameroon"], "Sudan": ["South Sudan", "Egypt"],
    "Bangladesh": ["Myanmar"], "Senegal": ["Mali", "Côte d'Ivoire"], "Niger": ["Nigeria", "Mali"],
    "Colombia": ["Peru", "Mexico"], "Somalia": ["Kenya", "Ethiopia"],
}

GRADE_DIST = {
    "National Staff": {"G1": .18, "G2": .38, "G3": .28, "G4": .12, "G5": .04},
    "International Staff": {"G3": .22, "G4": .40, "G5": .26, "G6": .12},
    "Global non-HQ Staff": {"G4": .25, "G5": .45, "G6": .30},
    "HQ Staff": {"G3": .15, "G4": .30, "G5": .30, "G6": .18, "G7": .07},
}

DEPT_DIST = {
    "National Staff": {"Field Operations": .32, "Research & Assessment": .25, "GIS & Data Management": .12,
                       "Programme Management": .05, "Finance & Compliance": .08, "HR & Administration": .08,
                       "Logistics & IT": .10},
    "International Staff": {"Research & Assessment": .40, "GIS & Data Management": .18,
                            "Programme Management": .25, "Finance & Compliance": .07,
                            "HR & Administration": .05, "Logistics & IT": .05},
    "Global non-HQ Staff": {"Research & Assessment": .35, "GIS & Data Management": .25,
                            "Programme Management": .25, "Finance & Compliance": .05,
                            "HR & Administration": .05, "Logistics & IT": .05},
    "HQ Staff": {"Research & Assessment": .25, "GIS & Data Management": .15, "Programme Management": .15,
                 "Finance & Compliance": .15, "HR & Administration": .15, "Logistics & IT": .15},
}

POSITION_TITLES = {
    "Research & Assessment": ["Research Assistant", "Research Officer", "Research Manager"],
    "GIS & Data Management": ["Data Assistant", "GIS Officer", "Data Unit Manager"],
    "Field Operations": ["Field Enumerator", "Field Team Leader", "Field Coordinator"],
    "Programme Management": ["Project Assistant", "Project Officer", "Country Coordinator"],
    "Finance & Compliance": ["Finance Assistant", "Finance Officer", "Finance Manager"],
    "HR & Administration": ["HR Assistant", "HR Officer", "HR Manager"],
    "Logistics & IT": ["Logistics Assistant", "IT Officer", "Logistics Manager"],
}

# Messy spellings found in source systems (raw value -> canonical name)
COUNTRY_VARIANTS = {
    "Democratic Republic of the Congo": ["DRC", "Congo (DRC)", "DR Congo"],
    "Central African Republic": ["CAR", "Central African Rep."],
    "South Sudan": ["South-Sudan", "S. Sudan"],
    "Syria": ["Syrian Arab Republic"],
    "Switzerland": ["HQ Switzerland", "Suisse"],
    "Burkina Faso": ["Burkina"],
    "Myanmar": ["Burma"],
}


def country_canonical_map() -> dict[str, str]:
    mapping = {}
    for canonical, variants in COUNTRY_VARIANTS.items():
        for v in variants:
            mapping[v.lower()] = canonical
    for c in COUNTRIES:
        mapping[c[0].lower()] = c[0]
    mapping[HQ_COUNTRY[0].lower()] = HQ_COUNTRY[0]
    return mapping


def nat_group(nationality: str | None) -> str:
    if not nationality:
        return "Not recorded"
    return "Global North" if nationality in GLOBAL_NORTH else "Global South"
