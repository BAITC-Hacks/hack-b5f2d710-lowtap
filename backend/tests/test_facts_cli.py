"""Evidence accuracy and the documented command-line entry point."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.engine.catalog import get_catalog
from app.engine.facts import build_facts
from app.engine.models import Scenario
from app.engine.scoring import evaluate

ROOT = Path(__file__).resolve().parents[2]


def preset(name):
    return Scenario.model_validate_json(
        (ROOT / "data" / "scenarios" / f"{name}.json").read_text(encoding="utf-8")
    )


@pytest.mark.parametrize(
    "name", ["example_tz", "cheapest", "naive_esil", "worst_of_all", "optimum"]
)
def test_facts_are_stable_and_include_every_changed_indicator_and_contribution(name):
    scenario = preset(name)
    result = evaluate(scenario)
    facts = build_facts(scenario, result)
    reverse = Scenario(decisions=list(reversed(scenario.decisions)))
    assert facts == build_facts(reverse, evaluate(reverse))
    assert [fact.id for fact in facts] == [f"F{index + 1}" for index in range(len(facts))]
    values = {fact.key: fact.value for fact in facts}
    assert len(values) == len(facts)
    assert values["score"] == result.score
    assert values["baseline"] == result.baseline
    assert values["n_crit"] == result.n_crit
    for district, state in result.districts.items():
        for indicator, delta in state.deltas.items():
            if delta:
                assert values[f"district.{district}.{indicator}.delta"] == delta
                assert (
                    values[f"district.{district}.{indicator}.after"]
                    == (state.indicators_after[indicator])
                )
    for mid, contribution in result.contributions.items():
        assert values[f"measure.{mid}.shapley"] == contribution.shapley
        assert values[f"measure.{mid}.loo"] == contribution.loo
        assert values[f"measure.{mid}.per_unit"] == contribution.per_unit
    assert all(fact.text_ru.endswith(f"{fact.value:.2f}.") for fact in facts)


def test_facts_distinguish_city_costs_and_actual_population_from_district_costs():
    scenario = preset("example_tz")
    result = evaluate(scenario)
    facts = {fact.key: fact for fact in build_facts(scenario, result)}
    districts = get_catalog().district_ids
    assert (
        sum(facts[f"district.{did}.cost_direct"].value for did in districts)
        + (facts["city.cost"].value)
        == result.cost
    )
    assert sum(facts[f"district.{did}.budget_share"].value for did in districts) + (
        facts["city.budget_share"].value
    ) == pytest.approx(100)
    assert facts["critical.closed.population_share"].value == pytest.approx(16)
    assert "nura" in facts["measure.M7.cost"].text_ru
    assert "district=null" in facts["measure.M12.cost"].text_ru
    assert facts["synergy.triggered.M10+M12.B1"].value == 2
    partial = Scenario(decisions=scenario.decisions[:1])
    values = {
        fact.key: fact.value for fact in build_facts(partial, evaluate(partial, allow_partial=True))
    }
    assert values["measure.M7.effect_fraction"] == 0.625


def test_facts_surface_missed_synergies_and_new_negative_effects():
    scenario = preset("worst_of_all")
    facts = {fact.key: fact for fact in build_facts(scenario, evaluate(scenario))}
    assert facts["district.almaty.T1.delta"].value < 0
    assert facts["critical.new.almaty.T1"].value < 40
    partial = Scenario.model_validate({"decisions": [{"measure_id": "M2", "district": None}]})
    facts = {fact.key: fact for fact in build_facts(partial, evaluate(partial, allow_partial=True))}
    assert facts["synergy.missed.M1+M2.T1"].value == 2
    assert "Неиспользованная" in facts["synergy.missed.M1+M2.T1"].text_ru
    assert "район меры M1 (мера не выбрана)" in facts["synergy.missed.M1+M2.T1"].text_ru


def cli(path, *args):
    return subprocess.run(
        [sys.executable, "-m", "app.cli", "evaluate", str(path), *args],
        cwd=ROOT / "backend",
        env={**os.environ, "PYTHONUTF8": "1"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def test_cli_documented_summary_and_full_json():
    path = ROOT / "data" / "scenarios" / "example_tz.json"
    summary = cli(path)
    assert summary.returncode == 0
    assert "Score 56.543" in summary.stdout
    assert "cost 95 | remaining 5 | n_crit 0" in summary.stdout
    assert "percentile" in summary.stdout and "%" in summary.stdout
    document = cli(path, "--json")
    assert document.returncode == 0
    assert json.loads(document.stdout) == evaluate(preset("example_tz")).model_dump()


def test_cli_invalid_scenario_and_broken_json_have_no_score(tmp_path):
    result = cli(ROOT / "data" / "scenarios" / "invalid_budget.json")
    document = json.loads(result.stdout)
    assert result.returncode == 2
    assert document["ok"] is False
    assert "score" not in document
    assert [item["code"] for item in document["violations"]] == ["BUDGET_EXCEEDED"]
    path = tmp_path / "invalid.json"
    path.write_text('{"decisions":"x"}', encoding="utf-8")
    result = cli(path)
    assert result.returncode == 2
    assert json.loads(result.stdout)["violations"][0]["code"] == "BAD_REQUEST"
    path.write_bytes(b"\xff")
    result = cli(path)
    assert result.returncode == 2
    assert json.loads(result.stdout)["violations"][0]["code"] == "BAD_REQUEST"
