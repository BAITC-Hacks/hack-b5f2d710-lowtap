"""Provider output is untrusted until server evaluation and fact checks pass."""

import pytest

from app.ai.guard import guard_report
from app.ai.rules import RuleBasedExplainer
from app.config import DATA_DIR
from app.engine.facts import build_facts
from app.engine.models import (
    AnalysisReport,
    Claim,
    Fact,
    Recommendation,
    Scenario,
    TraceStep,
    VerifiedNumbers,
)
from app.engine.scoring import evaluate


def scenario(name="example_tz"):
    return Scenario.model_validate_json((DATA_DIR / "scenarios" / f"{name}.json").read_bytes())


def report(**changes):
    values = {
        "summary": "",
        "strengths": [],
        "risks": [],
        "consequences": [],
        "tradeoffs": [],
        "city_impact": [],
        "recommendations": [],
        "provider": "llm",
        "model": "test",
        "prompt_version": "test",
        "trace": [],
        "verified_numbers": VerifiedNumbers(total=99, confirmed=99, unverified=[]),
        "cached": False,
    }
    return AnalysisReport(**(values | changes))


def invented_recommendation(name="example_tz", **changes):
    values = {
        "change": "Рекомендация модели",
        "decisions": scenario(name).decisions,
        "rationale": "Нужно проверить",
        "score": 99.0,
        "delta": 99.0,
        "cost": 99,
        "verified": True,
        "invalid_reason": None,
    }
    return Recommendation(**(values | changes))


def fact(value, index=1):
    return Fact(id=f"F{index}", key=f"test.{index}", value=value, text_ru="Проверенный факт")


def test_guard_overwrites_invented_numbers_and_preserves_original():
    actual = evaluate(scenario())
    original = report(
        summary="Придуманный Score 99.00.",
        strengths=[Claim(text="Score 56.54.", evidence=["F999", "F1"])],
        recommendations=[invented_recommendation(rationale="Обещаем 99.00 балла.")],
    )
    before = original.model_dump()
    guarded = guard_report(original, [fact(actual.score)])
    recommendation = guarded.recommendations[0]
    assert recommendation.score == actual.score
    assert recommendation.delta == actual.delta
    assert recommendation.cost == actual.cost
    assert recommendation.verified
    assert recommendation.invalid_reason is None
    assert guarded.strengths == [Claim(text="Score 56.54.", evidence=["F1"])]
    assert guarded.verified_numbers == VerifiedNumbers(total=3, confirmed=1, unverified=["99.00"])
    assert original.model_dump() == before


@pytest.mark.parametrize(
    "name,code", [("invalid_budget", "BUDGET_EXCEEDED"), ("unknown_measure", "UNKNOWN_MEASURE")]
)
def test_invalid_recommendation_has_no_verified_invented_scores(name, code):
    guarded = guard_report(
        report(summary="Итог 99.00.", recommendations=[invented_recommendation(name)]), []
    )
    recommendation = guarded.recommendations[0]
    assert recommendation.verified is False
    assert (recommendation.score, recommendation.delta, recommendation.cost) == (0, 0, 0)
    assert code in recommendation.invalid_reason
    assert guarded.verified_numbers.unverified == ["99.00"]


@pytest.mark.parametrize(
    "section", ["strengths", "risks", "consequences", "tradeoffs", "city_impact"]
)
def test_unknown_evidence_is_removed_without_removing_claim(section):
    original = report(**{section: [Claim(text="Без доказательства.", evidence=["F999"])]})
    guarded = guard_report(original, [fact(1)])
    assert getattr(guarded, section) == [Claim(text="Без доказательства.", evidence=[])]


def test_signed_comma_decimal_tokens_and_unicode_minus():
    facts = [fact(value, i) for i, value in enumerate((-1.25, -2.5, 3.75, -4.5, 5), 1)]
    guarded = guard_report(report(summary="−1,25; –2.50; +3,75; -4.50; 5.00."), facts)
    assert guarded.verified_numbers == VerifiedNumbers(total=5, confirmed=5, unverified=[])


def test_decimal_precision_does_not_match_prefix_and_all_occurrences_count():
    guarded = guard_report(
        report(summary="57.777; 57.77; 57.777; +57,777."), [fact(57.77), fact(57.777, 2)]
    )
    assert guarded.verified_numbers == VerifiedNumbers(
        total=4, confirmed=1, unverified=["57.777", "+57,777"]
    )


def test_integers_ids_dates_versions_scientific_notation_and_trace_are_not_checked():
    original = report(
        summary="M13 F999, 8 кварталов, 100 у.е.; F1.23 v1.23 01.02.2026 1.0.0 1.23e5.",
        trace=[
            TraceStep(
                n=1,
                kind="agent",
                tool="fake",
                input={"score": 99.0},
                output_summary="99.00",
                ms=99.0,
                ok=True,
            )
        ],
    )
    assert guard_report(original, []).verified_numbers == VerifiedNumbers(
        total=0, confirmed=0, unverified=[]
    )
    original.summary = "99.00"
    assert guard_report(original, []).verified_numbers.unverified == ["99.00"]


def test_only_explicit_trusted_tool_outputs_and_recomputed_results_are_evidence():
    original = report(summary="71.23; 65.43; 99.00.")
    checked = guard_report(
        original,
        [],
        tool_results=[{"score": 71.23, "nested": [{"value": 65.43}], "text": "99.00"}],
    )
    assert checked.verified_numbers == VerifiedNumbers(total=3, confirmed=2, unverified=["99.00"])
    original.summary = "56.54"
    original.recommendations = [invented_recommendation()]
    assert guard_report(original, []).verified_numbers.confirmed == 1


def test_fixed_constants_and_rounding_boundary_are_allowed_but_nearby_values_are_not():
    original = report(summary="100.00; 0.70; 0.30; 0.11; 0.27; 0.62; 0.61.")
    guarded = guard_report(original, [fact(0.625)])
    assert guarded.verified_numbers == VerifiedNumbers(total=7, confirmed=6, unverified=["0.61"])


@pytest.mark.parametrize(
    "name", ["example_tz", "cheapest", "naive_esil", "worst_of_all", "optimum"]
)
def test_rules_provider_passes_same_guard(name):
    chosen = scenario(name)
    result = evaluate(chosen)
    facts = build_facts(chosen, result)
    generated = RuleBasedExplainer().explain(chosen, result, facts)
    checked = guard_report(generated, facts)
    assert checked.verified_numbers.total > 0
    assert checked.verified_numbers.confirmed == checked.verified_numbers.total
    assert checked.verified_numbers.unverified == []
    assert all(item.verified for item in checked.recommendations)
