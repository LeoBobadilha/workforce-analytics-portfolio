"""Build the lightweight world map used by the Global Workforce Explorer.

Source: Natural Earth 1:110m Admin 0 – Countries, v5.1.2 (public domain,
https://www.naturalearthdata.com/about/terms-of-use/), vendored in
data/external/ne_110m_admin_0_countries.geojson.

Output: web/public/geo/world-110m.json — a GeoJSON FeatureCollection with only the
properties the app needs (iso3, name, label point), coordinates rounded to 0.1°
(about 11 km, finer than one screen pixel at the rendered scale) and Antarctica removed.

Identifier mapping (Natural Earth ISO_A3 is "-99" for a few features):
  France, Norway           -> ISO_A3_EH (FRA, NOR)
  Somaliland (SOL)         -> merged into Somalia (SOM), matching ISO 3166-1
  N. Cyprus, Kosovo        -> ADM0_A3 (CYN, KOS); not used by the workforce model

Run:  python pipeline/build_geo.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "external" / "ne_110m_admin_0_countries.geojson"
OUT = ROOT / "web" / "public" / "geo" / "world-110m.json"
MERGE_INTO = {"SOL": "SOM"}
DROP = {"ATA"}  # Antarctica: no workforce, large area


def iso3_of(p: dict) -> str:
    for key in ("ISO_A3", "ISO_A3_EH", "ADM0_A3"):
        v = p.get(key)
        if v and v != "-99":
            return v
    raise ValueError(f"no identifier for {p.get('NAME')}")


def rings(geom: dict) -> list:
    """Return the geometry as a list of polygons (each a list of rings)."""
    return [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]


def simplify_ring(ring: list) -> list:
    out = []
    for x, y in ring:
        pt = [round(x, 1), round(y, 1)]
        if not out or pt != out[-1]:
            out.append(pt)
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def build() -> dict:
    src = json.loads(SRC.read_text(encoding="utf-8"))
    features: dict[str, dict] = {}
    for f in src["features"]:
        p = f["properties"]
        code = iso3_of(p)
        if p["ADM0_A3"] in DROP or code in DROP:
            continue
        code = MERGE_INTO.get(p["ADM0_A3"], code)
        polys = [[simplify_ring(r) for r in poly] for poly in rings(f["geometry"])]
        polys = [[r for r in poly if len(r) >= 4] for poly in polys]
        polys = [poly for poly in polys if poly]
        if code in features:  # merged feature (Somaliland -> Somalia): keep the target's name and label point
            features[code]["geometry"]["coordinates"].extend(polys)
            continue
        features[code] = {
            "type": "Feature",
            "properties": {"iso3": code, "name": p["NAME"], "label": [round(p["LABEL_X"], 2), round(p["LABEL_Y"], 2)]},
            "geometry": {"type": "MultiPolygon", "coordinates": polys},
        }
    return {
        "type": "FeatureCollection",
        "metadata": {
            "source": "Natural Earth 1:110m Admin 0 - Countries v5.1.2 (public domain)",
            "processing": "pipeline/build_geo.py: properties reduced, coordinates rounded to 0.1 degree, Antarctica removed, Somaliland merged into Somalia",
        },
        "features": sorted(features.values(), key=lambda f: f["properties"]["iso3"]),
    }


if __name__ == "__main__":
    geo = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(geo, separators=(",", ":")), encoding="utf-8")
    print(f"{len(geo['features'])} countries -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB)")
