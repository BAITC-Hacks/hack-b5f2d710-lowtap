"""The offline explainer must be useful and every recommendation reproducible."""

import json
import re

import pytest

from app.ai.rules import RuleBasedExplainer
from app.config import DATA_DIR
from app.engine.facts import build_facts
from app.engine.models import Scenario
from app.engine.scoring import evaluate

PRESETS = ("example_tz", "cheapest", "naive_esil", "worst_of_all", "optimum")
SECTIONS = ("strengths", "risks", "consequences", "tradeoffs", "city_impact")


def explain(name):
    scenario = Scenario.model_validate_json((DATA_DIR / "scenarios" / f"{name}.json").read_bytes())
    result = evaluate(scenario)
    facts = build_facts(scenario, result)
    return result, facts, RuleBasedExplainer().explain(scenario, result, facts)


@pytest.mark.parametrize("name", PRESETS)
def test_reports_have_valid_evidence_and_reproducible_recommendations(name):
    result, facts, report = explain(name)
    by_id = {fact.id: fact for fact in facts}
    assert report.provider == "rules"
    assert report.model == ""
    assert report.cached is False
    for section in SECTIONS:
        claims = getattr(report, section)
        assert claims
        for claim in claims:
            assert claim.text
            assert claim.evidence
            assert set(claim.evidence) <= by_id.keys()
            # Every decimal in a claim must occur in that claim's own evidence.
            for token in re.findall(r"[+−\-–]?\d+[.,]\d{1,2}", claim.text):
                value = float(token.replace(",", ".").replace("−", "-").replace("–", "-"))
                assert any(abs(value - by_id[fid].value) <= 0.0050001 for fid in claim.evidence)
    assert len(report.recommendations) <= 3
    for recommendation in report.recommendations:
        expected = evaluate(Scenario(decisions=recommendation.decisions))
        assert recommendation.verified
        assert recommendation.invalid_reason is None
        assert recommendation.score == expected.score
        assert recommendation.cost == expected.cost
        assert recommendation.delta == expected.delta
        assert recommendation.score > result.score
    texts = [report.summary]
    texts.extend(claim.text for section in SECTIONS for claim in getattr(report, section))
    texts.extend(item.change + " " + item.rationale for item in report.recommendations)
    assert len(" ".join(texts).split()) <= 300
    assert report.trace[0].tool == "best_neighbors"
    assert report.trace[0].kind == "server"
    assert report.trace[0].ok


@pytest.mark.parametrize("name,measure", [("naive_esil", "M3"), ("worst_of_all", "M13")])
def test_critical_nura_and_long_lags_are_explicit(name, measure):
    _, _, report = explain(name)
    risks = " ".join(claim.text for claim in report.risks)
    assert "Нура S1=38.00" in risks
    assert "Нура S2=35.00" in risks
    assert f"{measure}: лаг 4.00" in risks
    assert "доля эффекта 0.50" in risks


def test_optimum_does_not_recommend_worse_plans():
    _, _, report = explain("optimum")
    assert report.recommendations == []


def test_reversing_decisions_preserves_report_except_runtime():
    payload = json.loads((DATA_DIR / "scenarios" / "example_tz.json").read_text(encoding="utf-8"))
    scenario = Scenario.model_validate(payload)
    reverse = Scenario(decisions=list(reversed(scenario.decisions)))
    reports = []
    for candidate in (scenario, reverse):
        result = evaluate(candidate)
        report = RuleBasedExplainer().explain(candidate, result, build_facts(candidate, result))
        report.trace = []
        reports.append(report)
    assert reports[0] == reports[1]
