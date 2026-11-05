"""The world map asset is reproducible, small, and covers every country in the workforce model."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

import build_geo  # noqa: E402
from config import COUNTRIES, HQ_COUNTRY  # noqa: E402

GEO = ROOT / "web" / "public" / "geo" / "world-110m.json"


def load():
    return json.loads(GEO.read_text(encoding="utf-8"))


def test_committed_map_is_reproducible_from_natural_earth_source():
    assert build_geo.build() == load()


def test_map_asset_size_budget():
    assert GEO.stat().st_size < 160 * 1024


def test_every_model_country_has_one_feature():
    iso = [f["properties"]["iso3"] for f in load()["features"]]
    assert len(iso) == len(set(iso))
    model = {c[1] for c in COUNTRIES} | {HQ_COUNTRY[1]}
    assert model <= set(iso), model - set(iso)


def test_documented_identifier_mappings():
    feats = {f["properties"]["iso3"]: f for f in load()["features"]}
    assert "ATA" not in feats  # Antarctica removed
    assert "SOL" not in feats and "SOM" in feats  # Somaliland merged into Somalia
    assert {"FRA", "NOR"} <= set(feats)  # ISO_A3 "-99" resolved via ISO_A3_EH
    assert feats["SOM"]["properties"]["name"] == "Somalia"
