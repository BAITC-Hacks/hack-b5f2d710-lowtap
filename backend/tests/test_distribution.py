import json
from dataclasses import replace

import pytest

from app.engine import distribution
from app.engine.catalog import DATA_DIR, get_catalog, scenario_id
from app.engine.models import ENGINE_VERSION, Scenario
from app.engine.scoring import score_decisions


def test_saved_distribution_has_complete_consistent_counts():
    data = distribution.load_distribution()
    assert data["count"] == 694395
    assert data["worse_than_baseline"] == 20003
    assert data["baseline"] == pytest.approx(52.55768)
    assert data["best"] == pytest.approx(57.237, abs=5e-4)
    assert data["worst"] == pytest.approx(52.041, abs=5e-4)
    assert len(data["quantiles"]) == 1000
    assert data["quantiles"] == sorted(data["quantiles"])
    assert data["quantiles"][0] == data["worst"]
    assert data["quantiles"][-1] == data["best"]
    assert data["quantiles"][989] < 56.543
    assert sum(bin_["count"] for bin_ in data["bins"]) == data["count"]
    assert all(bin_["end"] - bin_["start"] == pytest.approx(0.05) for bin_ in data["bins"])
    assert sum(frequency for _, frequency in data["score_counts"]) == data["count"]
    assert len(data["top20"]) == 20
    assert len({item["scenario_id"] for item in data["top20"]}) == 20
    optimum = Scenario.model_validate_json((DATA_DIR / "scenarios/optimum.json").read_text("utf-8"))
    assert data["top20"][0]["scenario_id"] == scenario_id(optimum)
    for item in data["top20"]:
        scenario = Scenario.model_validate(item)
        assert score_decisions(scenario.decisions).score == item["score"]


def test_percentile_uses_strict_less_with_ties(tmp_path, monkeypatch):
    path = tmp_path / "distribution.json"
    path.write_text(
        json.dumps(
            {
                "data_hash": get_catalog().data_hash,
                "engine_version": ENGINE_VERSION,
                "count": 6,
                "score_counts": [[10.0, 2], [20.0, 3], [30.0, 1]],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(distribution, "DISTRIBUTION_PATH", path)
    assert distribution.percentile(9) == 0
    assert distribution.percentile(10) == 0
    assert distribution.percentile(20) == pytest.approx(100 / 3)
    assert distribution.percentile(20 + 1e-12) == pytest.approx(100 / 3)
    assert distribution.percentile(21) == pytest.approx(500 / 6)
    assert distribution.percentile(30) == pytest.approx(500 / 6)
    assert distribution.percentile(31) == 100


def test_missing_and_stale_distribution(tmp_path, monkeypatch):
    monkeypatch.setattr(distribution, "DISTRIBUTION_PATH", tmp_path / "missing.json")
    assert distribution.load_distribution() is None
    assert distribution.percentile(54) is None
    with pytest.raises(ValueError, match="устарело"):
        distribution.load_distribution(
            catalog=replace(get_catalog(), data_hash="stale"),
            path=DATA_DIR / "plan_distribution.json",
        )
