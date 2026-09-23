"""Exhaustive acceptance check, explicitly enabled with pytest -m slow."""

import json
from pathlib import Path

import pytest

from app.engine import distribution
from app.engine.catalog import get_catalog, scenario_id
from app.engine.models import Decision, Scenario
from app.engine.scoring import score_decisions
from app.engine.validator import validate

pytestmark = pytest.mark.slow
ROOT = Path(__file__).resolve().parents[2]


def test_exhaustive_distribution_matches_frozen_acceptance_and_saved_artifact(monkeypatch):
    catalog = get_catalog()
    original_iterator = distribution.iter_scored_plans
    checked_samples = 0

    def independently_checked_plans(current_catalog=None):
        nonlocal checked_samples
        for index, row in enumerate(original_iterator(current_catalog)):
            score, cost, n_crit, measure_ids, assignments = row
            if index % 9973 == 0:
                assigned_districts = iter(assignments)
                scenario = Scenario(
                    decisions=[
                        Decision(
                            measure_id=measure_id,
                            district=(
                                catalog.district_ids[next(assigned_districts)]
                                if catalog.measures[measure_id]["type"] == "district"
                                else None
                            ),
                        )
                        for measure_id in measure_ids
                    ]
                )
                assert validate(scenario).ok
                direct = score_decisions(scenario.decisions)
                assert score == pytest.approx(direct.score, abs=1e-9)
                assert n_crit == direct.n_crit
                assert cost == sum(catalog.measures[mid]["cost"] for mid in measure_ids)
                checked_samples += 1
            yield row

    monkeypatch.setattr(distribution, "iter_scored_plans", independently_checked_plans)
    result = distribution.enumerate_distribution()

    assert checked_samples >= 50
    assert result["count"] == 694395
    assert result["worse_than_baseline"] == 20003
    assert result["best"] == pytest.approx(57.237, abs=5e-4)
    assert result["worst"] == pytest.approx(52.041, abs=5e-4)
    assert result["baseline"] == pytest.approx(52.55768, abs=1e-9)
    assert len(result["quantiles"]) == 1000
    assert result["quantiles"] == sorted(result["quantiles"])
    assert result["quantiles"][0] == result["worst"]
    assert result["quantiles"][-1] == result["best"]
    assert result["quantiles"][989] < 56.543
    assert sum(item["count"] for item in result["bins"]) == result["count"]
    assert all(item["end"] - item["start"] == pytest.approx(0.05) for item in result["bins"])
    assert sum(frequency for _, frequency in result["score_counts"]) == result["count"]
    assert len(result["top20"]) == 20
    assert [item["score"] for item in result["top20"]] == sorted(
        [item["score"] for item in result["top20"]], reverse=True
    )

    optimum_document = json.loads(
        (ROOT / "data/scenarios/optimum.json").read_text(encoding="utf-8")
    )
    optimum = Scenario.model_validate({"decisions": optimum_document["decisions"]})
    assert result["top20"][0]["scenario_id"] == scenario_id(optimum)
    for plan in result["top20"]:
        scenario = Scenario.model_validate({"decisions": plan["decisions"]})
        assert validate(scenario).ok
        assert scenario_id(scenario) == plan["scenario_id"]
        assert score_decisions(scenario.decisions).score == plan["score"]

    persisted = distribution.load_distribution()
    assert persisted is not None, "Generate data/plan_distribution.json before B1 acceptance"
    assert persisted == result
