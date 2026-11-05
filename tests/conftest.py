import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))


def _ensure_pipeline():
    if not (ROOT / "data" / "raw" / "_generator_truth.json").exists():
        subprocess.run([sys.executable, str(ROOT / "pipeline" / "generate_sources.py")], check=True)
    if not (ROOT / "data" / "processed" / "contracts.csv").exists():
        subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_model.py")], check=True)


@pytest.fixture(scope="session")
def model():
    _ensure_pipeline()
    from kpis import load
    return load()


@pytest.fixture(scope="session")
def truth():
    _ensure_pipeline()
    return json.loads((ROOT / "data" / "raw" / "_generator_truth.json").read_text())


@pytest.fixture(scope="session")
def dq():
    _ensure_pipeline()
    return json.loads((ROOT / "data" / "processed" / "data_quality_report.json").read_text())
