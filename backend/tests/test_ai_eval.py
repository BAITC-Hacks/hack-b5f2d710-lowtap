import asyncio
import json
import runpy
from unittest.mock import AsyncMock

import pytest

from app.ai import evaluation
from app.ai.cache import ReportCache
from app.ai.guard import guard_report
from app.ai.rules import RuleBasedExplainer
from app.config import DATA_DIR, ROOT, Settings
from app.engine.catalog import scenario_id
from app.engine.facts import build_facts
from app.engine.models import Claim, Scenario, TraceStep
from app.engine.scoring import evaluate


@pytest.fixture(scope="module")
def cases():
    result = {}
    for name in evaluation.PRESETS:
        scenario = Scenario.model_validate_json(
            (DATA_DIR / "scenarios" / f"{name}.json").read_bytes()
        )
        evaluated = evaluate(scenario)
        facts = build_facts(scenario, evaluated)
        report = guard_report(RuleBasedExplainer().explain(scenario, evaluated, facts), facts)
        result[name] = scenario, report
    return result


def live_report(report, scenario):
    copied = report.model_copy(deep=True)
    copied.provider = "llm"
    copied.model = "test-model"
    copied.prompt_version = "test-eval-v1"
    copied.trace.append(
        TraceStep(
            n=2,
            kind="agent",
            tool="best_neighbors",
            input={**scenario.model_dump(), "objective": "score", "k": 3},
            output_summary="Проверено",
            ms=1.0,
            ok=True,
        )
    )
    return copied


@pytest.mark.parametrize("name", evaluation.PRESETS)
def test_all_presets_pass_offline_checks_and_cover_long_lags(cases, name):
    scenario, report = cases[name]
    row = evaluation.check_report(name, scenario, report)
    assert row["passed"]
    assert all(row["checks"].values())
    assert row["metrics"]["evidence_coverage"] == 1
    assert row["facts"] and row["report"]["trace"]
    assert row["scenario_id"] == scenario_id(scenario)


def test_evidence_threshold_does_not_accept_empty_claims(cases):
    scenario, original = cases["example_tz"]
    report = original.model_copy(deep=True)
    for section in evaluation.CLAIM_SECTIONS:
        setattr(report, section, [Claim(text="Факт.", evidence=["F1"]) for _ in range(2)])
    report.strengths[0].evidence = []
    row = evaluation.check_report("threshold", scenario, report)
    assert row["metrics"]["evidence_coverage"] == 0.9
    assert row["checks"]["evidence_coverage"]
    report.strengths[1].evidence = ["F99999"]
    assert not evaluation.check_report("threshold", scenario, report)["checks"]["evidence_coverage"]
    for section in evaluation.CLAIM_SECTIONS:
        setattr(report, section, [])
    row = evaluation.check_report("empty", scenario, report)
    assert not row["checks"]["evidence_coverage"]
    assert not row["checks"]["sections_populated"]


def test_recommendation_verified_flag_cannot_hide_wrong_score(cases):
    scenario, original = cases["example_tz"]
    report = original.model_copy(deep=True)
    report.recommendations[0].score = 99
    assert not evaluation.check_report("wrong", scenario, report)["checks"][
        "recommendations_verified"
    ]
    report.recommendations[0].decisions = []
    assert not evaluation.check_report("invalid", scenario, report)["checks"][
        "recommendations_verified"
    ]


def test_unverified_decimal_and_missing_semantic_checks_fail(cases):
    scenario, original = cases["naive_esil"]
    report = original.model_copy(deep=True)
    report.risks = [Claim(text="Риск.", evidence=["F1"])]
    report.summary += " Неверное значение 99.00."
    report.verified_numbers.unverified = ["99.00"]
    row = evaluation.check_report("missing", scenario, report)
    assert not row["checks"]["decimal_numbers_verified"]
    assert row["metrics"]["missing_nura_pairs"] == ["S1", "S2"]
    assert row["metrics"]["missing_long_lags"] == ["M3"]
    report.risks[0].text = "Нура: дефицит школ и поликлиник. ЛРТ имеет лаг четыре квартала."
    row = evaluation.check_report("plain_language", scenario, report)
    assert row["checks"]["nura_critical_pairs_mentioned"]
    assert row["checks"]["selected_long_lags_mentioned"]


def test_optimum_rejects_valid_but_worse_recommendations(cases):
    scenario, original = cases["optimum"]
    report = original.model_copy(deep=True)
    report.recommendations = cases["example_tz"][1].model_copy(deep=True).recommendations
    row = evaluation.check_report("optimum_worse", scenario, report)
    assert row["checks"]["recommendations_verified"]
    assert not row["checks"]["recommendations_improve_score"]
    assert not row["passed"]


def test_llm_requires_real_engine_trace(cases):
    scenario, original = cases["example_tz"]
    report = original.model_copy(update={"provider": "llm"}, deep=True)
    assert not evaluation.check_report("llm", scenario, report)["checks"]["agent_used_engine_tools"]
    report = live_report(report, scenario)
    assert evaluation.check_report("llm", scenario, report)["checks"]["agent_used_engine_tools"]


def test_rules_runner_writes_five_jsonl_rows_without_network(tmp_path, monkeypatch):
    def no_llm(*args, **kwargs):
        raise AssertionError("Offline evaluation must not create an OpenAI client")

    monkeypatch.setattr("app.ai.service.OpenAIClient", no_llm)
    output = tmp_path / "eval" / "rules.jsonl"
    rows = asyncio.run(evaluation.run_evaluation(Settings(), provider="rules", output=output))
    assert len(rows) == 5 and all(row["passed"] for row in rows)
    assert [json.loads(line) for line in output.read_text("utf-8").splitlines()] == rows
    assert {row["provider"] for row in rows} == {"rules"}
    assert not list(tmp_path.rglob("demo/*.json"))


def test_warm_requires_configured_llm_before_any_calls(tmp_path, monkeypatch):
    call = AsyncMock()
    monkeypatch.setattr(evaluation, "analyze", call)
    with pytest.raises(ValueError, match="OPENAI_API_KEY/OPENAI_MODEL"):
        asyncio.run(evaluation.run_evaluation(Settings(), output=tmp_path / "x", warm_demo=True))
    call.assert_not_awaited()


def test_warm_forces_live_llm_and_publishes_five_exact_demo_envelopes(tmp_path, monkeypatch, cases):
    by_id = {scenario_id(scenario): report for scenario, report in cases.values()}
    settings_seen = []

    async def fake_analyze(scenario, settings, semaphore, **kwargs):
        settings_seen.append(settings)
        return live_report(by_id[scenario_id(scenario)], scenario)

    monkeypatch.setattr(evaluation, "analyze", fake_analyze)
    cache = ReportCache(tmp_path / "cache")
    rows = asyncio.run(
        evaluation.run_evaluation(
            Settings(
                openai_api_key="unused-test-secret", openai_model="test-model", ai_cache="first"
            ),
            output=tmp_path / "eval.jsonl",
            warm_demo=True,
            cache=cache,
        )
    )
    assert len(rows) == 5 and all(row["passed"] for row in rows)
    assert all(
        settings.ai_cache == "0" and settings.ai_provider == "llm" for settings in settings_seen
    )
    assert len(list((cache.root / "demo").glob("*.json"))) == 5
    for scenario, report in cases.values():
        demo = cache.root / "demo" / f"{scenario_id(scenario)}.json"
        envelope = json.loads(demo.read_text("utf-8"))
        assert envelope["report"] == live_report(report, scenario).model_dump(mode="json")
        assert envelope["metadata"]["scenario_id"] == scenario_id(scenario)
        assert cache.get(scenario, "", "test-eval-v1") is not None
    assert "unused-test-secret" not in (tmp_path / "eval.jsonl").read_text("utf-8")


def test_warm_never_saves_fallback_reports(tmp_path, monkeypatch, cases):
    by_id = {scenario_id(scenario): report for scenario, report in cases.values()}

    async def fake_analyze(scenario, *args, **kwargs):
        return by_id[scenario_id(scenario)].model_copy(deep=True)

    monkeypatch.setattr(evaluation, "analyze", fake_analyze)
    cache = ReportCache(tmp_path / "cache")
    rows = asyncio.run(
        evaluation.run_evaluation(
            Settings(openai_api_key="unused-test", openai_model="test-model"),
            output=tmp_path / "eval.jsonl",
            warm_demo=True,
            cache=cache,
        )
    )
    assert len(rows) == 5 and not any(row["passed"] for row in rows)
    assert all(not row["checks"]["live_llm"] and not row["checks"]["demo_saved"] for row in rows)
    assert not (cache.root / "demo").exists()


@pytest.mark.parametrize("passed,expected", [(True, 0), (False, 1)])
def test_cli_exit_code_reflects_checks(tmp_path, monkeypatch, passed, expected):
    monkeypatch.setattr(Settings, "from_env", classmethod(lambda cls: Settings()))
    runner = AsyncMock(return_value=[{"passed": passed}])
    monkeypatch.setattr(evaluation, "run_evaluation", runner)
    monkeypatch.setattr(
        "sys.argv", ["ai_eval.py", "--provider", "rules", "--output", str(tmp_path / "eval.jsonl")]
    )
    main = runpy.run_path(str(ROOT / "scripts" / "ai_eval.py"))["main"]
    assert main() == expected
    assert runner.await_args.kwargs["provider"] == "rules"


def test_checks_recompute_decimal_verification_instead_of_trusting_report(cases):
    scenario, original = cases["example_tz"]
    report = original.model_copy(deep=True)
    report.summary += " Придуманное число 999.99."
    assert report.verified_numbers.unverified == []
    before = report.model_dump()
    row = evaluation.check_report("tampered_summary", scenario, report)
    assert not row["passed"]
    assert not row["checks"]["decimal_numbers_verified"]
    assert row["metrics"]["unverified_decimals"] == ["999.99"]
    assert not row["metrics"]["verification_counters_match"]
    assert row["report"] == before
    assert report.model_dump() == before


def test_successful_trace_flag_with_invalid_arguments_does_not_count(cases):
    scenario, original = cases["example_tz"]
    report = live_report(original, scenario)
    report.trace[-1].input = {}
    row = evaluation.check_report("invented_tool_call", scenario, report)
    assert not row["passed"]
    assert not row["checks"]["agent_used_engine_tools"]
    assert row["metrics"]["agent_tool_steps"] == 0
    assert row["metrics"]["invalid_agent_tool_steps"] == 1
