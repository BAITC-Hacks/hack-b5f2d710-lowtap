import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.ai.cache import ReportCache, cache_key
from app.config import DATA_DIR
from app.engine.catalog import scenario_id
from app.engine.models import AnalysisReport, Claim, Scenario, TraceStep, VerifiedNumbers


@pytest.fixture
def scenario():
    return Scenario.model_validate_json((DATA_DIR / "scenarios/example_tz.json").read_bytes())


@pytest.fixture
def report():
    return AnalysisReport(
        summary="Проверенный отчёт",
        strengths=[Claim(text="Показатель вырос.", evidence=["F1"])],
        risks=[],
        consequences=[],
        tradeoffs=[],
        city_impact=[],
        recommendations=[],
        provider="llm",
        model="test-model",
        prompt_version="test-prompt-v1",
        trace=[
            TraceStep(
                n=1,
                kind="server",
                tool="test",
                input={"nested": {"value": 1}},
                output_summary="Готово",
                ms=1.0,
                ok=True,
            )
        ],
        verified_numbers=VerifiedNumbers(total=1, confirmed=1, unverified=[]),
        cached=False,
    )


def runtime_path(root, scenario, report):
    return root / "runtime" / f"{cache_key(scenario, report.model, report.prompt_version)}.json"


def save_demo(root, scenario, report):
    cache = ReportCache(root)
    cache.put(scenario, report.model, report.prompt_version, report)
    runtime = runtime_path(root, scenario, report)
    demo = root / "demo" / f"{scenario_id(scenario)}.json"
    demo.parent.mkdir(parents=True, exist_ok=True)
    runtime.replace(demo)
    return demo


def test_key_is_canonical_and_unambiguous(scenario):
    reversed_scenario = Scenario(decisions=list(reversed(scenario.decisions)))
    assert cache_key(scenario, "model", "prompt") == cache_key(reversed_scenario, "model", "prompt")
    assert cache_key(scenario, "ab", "c") != cache_key(scenario, "a", "bc")
    assert len(cache_key(scenario, "model", "prompt")) == 64


def test_round_trip_preserves_metadata_and_returns_independent_objects(tmp_path, scenario, report):
    cache = ReportCache(tmp_path)
    assert cache.get(scenario, report.model, report.prompt_version) is None
    cache.put(scenario, report.model, report.prompt_version, report)
    encoded = runtime_path(tmp_path, scenario, report).read_text(encoding="utf-8")
    assert "Проверенный отчёт" in encoded
    saved = json.loads(encoded)
    assert saved["metadata"]["model"] == report.model
    assert saved["metadata"]["scenario_id"] == scenario_id(scenario)
    loaded = cache.get(scenario, report.model, report.prompt_version)
    assert loaded == report and loaded is not report
    loaded.provider = "cache"
    loaded.cached = True
    loaded.strengths[0].evidence.append("MUTATED")
    loaded.trace[0].input["nested"]["value"] = 2
    report.summary = "Changed after storing"
    second = cache.get(scenario, report.model, report.prompt_version)
    assert second.summary == "Проверенный отчёт"
    assert second.provider == "llm" and second.cached is False
    assert second.strengths[0].evidence == ["F1"]
    assert second.trace[0].input["nested"]["value"] == 1


@pytest.mark.parametrize(
    "field", ["data_hash", "engine_version", "scenario_id", "model", "prompt_version"]
)
def test_metadata_mismatches_are_misses(tmp_path, scenario, report, field):
    cache = ReportCache(tmp_path)
    cache.put(scenario, report.model, report.prompt_version, report)
    path = runtime_path(tmp_path, scenario, report)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["metadata"][field] = "stale"
    path.write_text(json.dumps(payload), encoding="utf-8")
    assert cache.get(scenario, report.model, report.prompt_version) is None


@pytest.mark.parametrize("body", [b"{", b"[]", b"null", b"{}", b"\xff", b'{"x":NaN}'])
def test_corrupt_files_are_misses(tmp_path, scenario, report, body):
    path = runtime_path(tmp_path, scenario, report)
    path.parent.mkdir(parents=True)
    path.write_bytes(body)
    assert ReportCache(tmp_path).get(scenario, report.model, report.prompt_version) is None


@pytest.mark.parametrize("field", ["model", "prompt_version", "recommendations"])
def test_corrupt_report_or_report_metadata_mismatch_is_a_miss(tmp_path, scenario, report, field):
    cache = ReportCache(tmp_path)
    cache.put(scenario, report.model, report.prompt_version, report)
    path = runtime_path(tmp_path, scenario, report)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["report"][field] = "invalid"
    path.write_text(json.dumps(payload), encoding="utf-8")
    assert cache.get(scenario, report.model, report.prompt_version) is None


def test_demo_can_supply_offline_model_but_obeys_versions(tmp_path, scenario, report):
    save_demo(tmp_path, scenario, report)
    cache = ReportCache(tmp_path)
    assert cache.get(scenario, "", report.prompt_version) == report
    assert cache.get(scenario, report.model, report.prompt_version) == report
    assert cache.get(scenario, "other-model", report.prompt_version) is None
    assert cache.get(scenario, "", "other-prompt") is None


def test_exact_cache_wins_over_demo(tmp_path, scenario, report):
    save_demo(tmp_path, scenario, report)
    newer = report.model_copy(update={"summary": "Свежий отчёт"}, deep=True)
    cache = ReportCache(tmp_path)
    cache.put(scenario, newer.model, newer.prompt_version, newer)
    assert cache.get(scenario, report.model, report.prompt_version) == newer
    assert cache.get(scenario, "", report.prompt_version) == report


def test_read_and_write_errors_are_harmless(tmp_path, scenario, report):
    cache = ReportCache(tmp_path)
    with patch.object(Path, "read_text", side_effect=PermissionError):
        assert cache.get(scenario, report.model, report.prompt_version) is None
    with patch.object(Path, "mkdir", side_effect=PermissionError):
        assert cache.put(scenario, report.model, report.prompt_version, report) is None
    assert not tmp_path.joinpath("runtime").exists()


def test_failed_atomic_replace_preserves_old_entry_and_removes_temporary(
    tmp_path, scenario, report
):
    cache = ReportCache(tmp_path)
    cache.put(scenario, report.model, report.prompt_version, report)
    newer = report.model_copy(update={"summary": "New"}, deep=True)
    with patch("app.ai.cache.os.replace", side_effect=PermissionError):
        cache.put(scenario, report.model, report.prompt_version, newer)
    assert cache.get(scenario, report.model, report.prompt_version) == report
    assert len(list(tmp_path.joinpath("runtime").iterdir())) == 1


def test_put_rejects_conflicting_model_metadata(tmp_path, scenario, report):
    cache = ReportCache(tmp_path)
    cache.put(scenario, "other-model", report.prompt_version, report)
    assert cache.get(scenario, "other-model", report.prompt_version) is None
    assert not tmp_path.joinpath("runtime").exists()


@pytest.mark.parametrize("nonfinite", ["nan", "inf", "-inf"])
def test_nonfinite_trace_duration_strings_are_cache_misses(tmp_path, scenario, report, nonfinite):
    cache = ReportCache(tmp_path)
    cache.put(scenario, report.model, report.prompt_version, report)
    path = runtime_path(tmp_path, scenario, report)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["report"]["trace"][0]["ms"] = nonfinite
    path.write_text(json.dumps(payload), encoding="utf-8")
    assert cache.get(scenario, report.model, report.prompt_version) is None


def test_overflow_inside_untyped_trace_input_is_a_cache_miss(tmp_path, scenario, report):
    cache = ReportCache(tmp_path)
    cache.put(scenario, report.model, report.prompt_version, report)
    path = runtime_path(tmp_path, scenario, report)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["report"]["trace"][0]["input"] = {"nested": ["OVERFLOW_PLACEHOLDER"]}
    encoded = json.dumps(payload).replace('"OVERFLOW_PLACEHOLDER"', "1e400")
    path.write_text(encoded, encoding="utf-8")
    assert cache.get(scenario, report.model, report.prompt_version) is None


@pytest.mark.parametrize("nonfinite", [float("nan"), float("inf"), float("-inf")])
def test_put_nonfinite_report_is_noop(tmp_path, scenario, report, nonfinite):
    cache = ReportCache(tmp_path)
    cache.put(scenario, report.model, report.prompt_version, report)
    modified = report.model_copy(deep=True)
    modified.trace[0] = modified.trace[0].model_copy(update={"ms": nonfinite})
    cache.put(scenario, report.model, report.prompt_version, modified)
    assert cache.get(scenario, report.model, report.prompt_version) == report
    assert len(list(tmp_path.joinpath("runtime").iterdir())) == 1


def test_put_nonfinite_untyped_trace_input_is_noop(tmp_path, scenario, report):
    cache = ReportCache(tmp_path)
    report.trace[0].input = {"nested": [float("inf")]}
    cache.put(scenario, report.model, report.prompt_version, report)
    assert not tmp_path.joinpath("runtime").exists()
