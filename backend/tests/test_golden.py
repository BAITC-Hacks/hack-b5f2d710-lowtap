import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.config import DATA_DIR
from app.engine.catalog import canonical_decisions, get_catalog, scenario_id
from app.engine.golden import GOLDEN_PATH, generate_golden
from app.engine.models import ENGINE_VERSION, Scenario
from app.engine.validator import validate


@pytest.fixture(scope="module")
def golden():
    return generate_golden()


def test_committed_golden_is_current(golden):
    saved = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    assert saved == golden, "Golden устарел: запустите python -m app.cli golden"
    assert golden["data_hash"] == get_catalog().data_hash
    assert golden["engine_version"] == ENGINE_VERSION
    assert golden["seed"] == 42


def test_golden_contains_all_presets_partial_and_random_cases(golden):
    cases = golden["cases"]
    presets = {path.stem for path in (DATA_DIR / "scenarios").glob("*.json")}
    assert len(cases) == 71
    assert len({case["name"] for case in cases}) == 71
    assert presets.issubset({case["name"] for case in cases})
    assert sum(case["valid"] for case in cases) == 59
    assert sum(not case["valid"] for case in cases) == 12
    random_cases = [case for case in cases if case["name"].startswith("random_")]
    assert len(random_cases) == 50
    assert len({scenario_id(Scenario.model_validate(case)) for case in random_cases}) == 50
    for case in cases:
        scenario = Scenario.model_validate(case)
        assert scenario.decisions == canonical_decisions(scenario.decisions)
        assert (
            validate(scenario, allow_partial=case.get("allow_partial", False)).ok == case["valid"]
        )
        if case["valid"]:
            assert "eval" in case and "violations" not in case
        else:
            assert case["violations"] and "eval" not in case


def test_partial_examples_use_first_decisions_and_keep_other_rules(golden):
    example = Scenario.model_validate_json(
        (DATA_DIR / "scenarios/example_tz.json").read_text(encoding="utf-8")
    )
    partials = [case for case in golden["cases"] if case.get("allow_partial")]
    assert len(partials) == 4
    for length, case in enumerate(partials, start=1):
        scenario = Scenario.model_validate(case)
        assert scenario.decisions == canonical_decisions(example.decisions[:length])
        assert case["valid"]
        assert case["eval"]["cost"] <= 100
        assert len(case["eval"]["timeline"]) == 9
        assert validate(scenario).violations[0].code == "NOT_FIVE"


def test_cli_golden_custom_output(tmp_path, golden):
    output = tmp_path / "nested" / "golden.json"
    completed = subprocess.run(
        [sys.executable, "-m", "app.cli", "golden", "--output", str(output)],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "PYTHONUTF8": "1"},
        encoding="utf-8",
        capture_output=True,
        check=True,
    )
    assert "cases 71 | valid 59 | invalid 12 | seed 42" in completed.stdout
    assert json.loads(output.read_text(encoding="utf-8")) == golden
    assert "\\u" not in output.read_text(encoding="utf-8")
