"""Engine-tool schemas and execution remain strict, reproducible and bounded."""

import json

import pytest

from app.ai.tools import TOOLS, ToolExecutor, build_tools, execute_tool
from app.config import DATA_DIR
from app.engine.catalog import get_catalog
from app.engine.models import Scenario
from app.engine.scoring import evaluate


def scenario(name="example_tz"):
    return Scenario.model_validate_json((DATA_DIR / "scenarios" / f"{name}.json").read_bytes())


def arguments(name="example_tz"):
    return scenario(name).model_dump()


def test_tool_schemas_are_recursively_strict_and_use_catalog_ids():
    assert {tool["name"] for tool in TOOLS} == {
        "evaluate_scenario",
        "best_neighbors",
        "compare_scenarios",
    }
    districts = []

    def inspect(value):
        if isinstance(value, dict):
            if value.get("type") == "object":
                assert value["additionalProperties"] is False
                assert set(value["required"]) == set(value["properties"])
                if "district" in value["properties"]:
                    districts.append(value["properties"]["district"])
            for child in value.values():
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)

    for tool in TOOLS:
        assert tool["type"] == "function"
        assert tool["strict"] is True
        inspect(tool["parameters"])
    assert len(districts) == 4
    for district in districts:
        assert district["enum"] == [*get_catalog().district_ids, None]
        assert district["type"] == ["string", "null"]
    # Schema dictionaries can be passed to an SDK without a shared mutable tree.
    fresh = build_tools()
    fresh[0]["parameters"]["properties"]["decisions"]["items"]["required"].clear()
    assert fresh[1]["parameters"]["properties"]["decisions"]["items"]["required"]
    assert fresh != TOOLS


def test_evaluate_is_compact_and_matches_engine_without_mutating_arguments():
    payload = arguments()
    before = json.dumps(payload)
    output = execute_tool("evaluate_scenario", payload)
    expected = evaluate(scenario())
    for name in ("score", "baseline", "cost", "n_crit", "percentile", "delta", "data_hash"):
        assert output[name] == getattr(expected, name)
    assert output["min_district"] == expected.min_district.model_dump()
    assert output["critical_pairs"] == expected.critical_pairs.model_dump()
    assert output["contributions"] == {
        mid: item.model_dump() for mid, item in expected.contributions.items()
    }
    assert len(output["decisions"]) == 5
    assert len(output["districts"]) == 5
    assert "timeline" not in output
    assert all(
        set(values) == {"d_before", "d_after", "delta"} for values in output["districts"].values()
    )
    assert json.dumps(payload) == before


@pytest.mark.parametrize("name", ["invalid_budget", "unknown_measure", "invalid_four"])
def test_invalid_scenario_returns_violations_without_score(name):
    output = execute_tool("evaluate_scenario", arguments(name))
    assert output["ok"] is False
    assert output["violations"]
    assert "score" not in output
    assert "error" not in output


@pytest.mark.parametrize("objective", ["score", "zero_crit", "min_district", "budget_cap"])
def test_neighbors_are_valid_recomputed_and_follow_objective(objective):
    output = execute_tool("best_neighbors", arguments() | {"objective": objective, "k": 3})
    candidates = output["neighbors"]
    assert output["objective"] == objective
    assert len(candidates) == 3
    expected_ranks = []
    for candidate in candidates:
        checked = evaluate(Scenario.model_validate(candidate))
        for field in ("score", "cost", "n_crit"):
            assert candidate[field] == getattr(checked, field)
        assert candidate["delta"] == pytest.approx(checked.delta, abs=1e-10)
        if objective == "budget_cap":
            assert candidate["cost"] <= evaluate(scenario()).cost
        rank = (-candidate["score"], candidate["cost"], candidate["scenario_id"])
        if objective == "zero_crit":
            rank = (candidate["n_crit"], *rank)
        elif objective == "min_district":
            rank = (-candidate["min_district"]["d"], *rank)
        expected_ranks.append(rank)
    assert expected_ranks == sorted(expected_ranks)


@pytest.mark.parametrize("k", [True, False, 0, -1, 11, 1000000, 1.5, "3", None])
def test_neighbors_rejects_unbounded_or_coerced_limits(k):
    output = execute_tool("best_neighbors", arguments() | {"objective": "score", "k": k})
    assert set(output) == {"error"}


def test_neighbors_rejects_unknown_objective_and_invalid_source():
    assert "error" in execute_tool("best_neighbors", arguments() | {"objective": "fake", "k": 1})
    invalid = execute_tool(
        "best_neighbors", arguments("invalid_budget") | {"objective": "score", "k": 1}
    )
    assert invalid["ok"] is False
    assert invalid["violations"][0]["code"] == "BUDGET_EXCEEDED"


def test_comparison_uses_b_minus_a_and_accepts_reversed_difference():
    a, b = arguments(), arguments("worst_of_all")
    forward = execute_tool("compare_scenarios", {"a": a, "b": b})
    reverse = execute_tool("compare_scenarios", {"a": b, "b": a})
    for field in ("score", "cost", "n_crit"):
        assert forward["delta"][field] == pytest.approx(
            forward["b"][field] - forward["a"][field], abs=1e-10
        )
        assert reverse["delta"][field] == -forward["delta"][field]
    assert forward["delta"]["score"] < 0
    assert forward["delta"]["cost"] == -15
    assert forward["delta"]["n_crit"] == 3


def test_invalid_comparison_collects_both_scenarios_without_scoring(monkeypatch):
    def unexpected(*args, **kwargs):
        pytest.fail("Invalid scenarios must not be scored")

    monkeypatch.setattr("app.ai.tools.evaluate", unexpected)
    output = execute_tool(
        "compare_scenarios", {"a": arguments("invalid_budget"), "b": arguments("unknown_measure")}
    )
    assert output["ok"] is False
    assert [item["code"] for item in output["violations"]] == ["BUDGET_EXCEEDED", "UNKNOWN_MEASURE"]
    assert output["violations"][0]["message"].startswith("Сценарий a:")
    assert output["violations"][1]["message"].startswith("Сценарий b:")
    assert "score" not in output


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        {},
        {"decisions": "x"},
        {"decisions": [{"measure_id": "M1"}]},
        {"decisions": [{"measure_id": 1, "district": None}]},
        {"decisions": [{"measure_id": "M1", "district": "nura", "score": 99}]},
        {"decisions": [], "score": 99},
    ],
)
def test_structural_errors_are_static_and_safe(payload):
    output = execute_tool("evaluate_scenario", payload)
    assert output == {"error": "Аргументы не соответствуют схеме инструмента."}


def test_unexpected_failure_is_sanitized_and_next_execution_still_works(monkeypatch):
    executor = ToolExecutor()
    with monkeypatch.context() as patch:

        def fail(*args, **kwargs):
            raise RuntimeError("secret-that-must-not-leave-the-server")

        patch.setattr("app.ai.tools.evaluate", fail)
        output = executor.execute("evaluate_scenario", arguments())
        assert output == {"error": "Не удалось выполнить инструмент движка."}
    assert executor.execute("evaluate_scenario", arguments())["ok"] is True
    assert executor.execute("secret-tool-name", {}) == {"error": "Неизвестный инструмент движка."}
