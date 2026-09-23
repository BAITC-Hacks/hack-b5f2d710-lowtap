"""HTTP-level provider ordering and guardrails, without real network calls."""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient
from openai import APIConnectionError, APIStatusError, APITimeoutError, RateLimitError

from app.ai.cache import ReportCache
from app.ai.llm import ProviderFailure
from app.ai.prompts import PROMPT_VERSION
from app.ai.rules import RuleBasedExplainer
from app.config import Settings
from app.engine.facts import build_facts
from app.engine.models import Scenario
from app.engine.scoring import evaluate
from app.main import create_app

ROOT = Path(__file__).resolve().parents[2]
FAKE_KEY = "test-only-secret-not-for-network"


@pytest.fixture
def setup(monkeypatch, tmp_path):
    scenario = Scenario.model_validate_json(
        (ROOT / "data/scenarios/example_tz.json").read_text(encoding="utf-8")
    )
    result = evaluate(scenario)
    report = RuleBasedExplainer().explain(scenario, result, build_facts(scenario, result))
    call = AsyncMock(return_value=report)
    monkeypatch.setattr(
        "app.ai.service.OpenAIClient",
        MagicMock(
            return_value=SimpleNamespace(
                structured_call=call, last_usage={}, last_model="test-model"
            )
        ),
    )
    monkeypatch.setattr("app.main.check_model", AsyncMock(return_value="ok"))
    cache = ReportCache(tmp_path)
    monkeypatch.setattr("app.main.ReportCache", lambda: cache)
    return scenario, report, call, cache


def settings(cache="0", **kwargs):
    return Settings(openai_api_key=FAKE_KEY, openai_model="test-model", ai_cache=cache, **kwargs)


def test_api_rewrites_fabricated_score_evidence_and_metadata(setup):
    scenario, report, call, _ = setup
    report.summary = "Неподтверждённое число 999.99."
    report.strengths[0].evidence.append("F999")
    report.recommendations[0].score = 99
    expected = evaluate(Scenario(decisions=report.recommendations[0].decisions))
    original = scenario.model_dump() | {"user_text": "DO_NOT_FORWARD_FREE_TEXT"}
    with TestClient(create_app(settings())) as client:
        response = client.post("/api/analyze", json=original)
    assert response.status_code == 200
    data = response.json()
    assert data["provider"] == "llm"
    assert data["model"] == "test-model"
    assert data["cached"] is False
    assert data["recommendations"][0]["score"] == expected.score
    assert data["recommendations"][0]["verified"] is True
    assert "F999" not in data["strengths"][0]["evidence"]
    assert "999.99" in data["verified_numbers"]["unverified"]
    assert data["verified_numbers"]["total"] > 0
    assert "DO_NOT_FORWARD_FREE_TEXT" not in str(call.await_args)
    assert FAKE_KEY not in response.text
    assert [step["n"] for step in data["trace"]] == list(range(1, len(data["trace"]) + 1))


def test_cache_first_skips_llm_and_still_runs_guard(setup):
    scenario, report, call, cache = setup
    report.model = "test-model"
    report.prompt_version = PROMPT_VERSION
    report.recommendations[0].score = 99
    cache.put(scenario, "test-model", PROMPT_VERSION, report)
    with TestClient(create_app(settings("first"))) as client:
        response = client.post("/api/analyze", json=scenario.model_dump())
    assert response.status_code == 200
    data = response.json()
    assert data["provider"] == "cache" and data["cached"]
    assert data["recommendations"][0]["score"] != 99
    assert data["verified_numbers"]["confirmed"] > 0
    call.assert_not_awaited()


def test_successful_llm_response_populates_runtime_cache(setup):
    scenario, _, call, _ = setup
    with TestClient(create_app(settings("first"))) as client:
        first = client.post("/api/analyze", json=scenario.model_dump()).json()
        second = client.post("/api/analyze", json=scenario.model_dump()).json()
    assert first["provider"] == "llm"
    assert second["provider"] == "cache"
    call.assert_awaited_once()


def test_fallback_tries_llm_before_cached_report(setup):
    scenario, report, call, cache = setup
    report.model, report.prompt_version = "test-model", PROMPT_VERSION
    cache.put(scenario, "test-model", PROMPT_VERSION, report)
    call.side_effect = RuntimeError(FAKE_KEY)
    with TestClient(create_app(settings("fallback"))) as client:
        response = client.post("/api/analyze", json=scenario.model_dump())
    assert response.json()["provider"] == "cache"
    assert FAKE_KEY not in response.text
    call.assert_awaited_once()


@pytest.mark.parametrize(
    "reason",
    [
        "rate_limit",
        "timeout",
        "connection",
        "api_status",
        "incomplete",
        "refusal",
        "provider_error",
    ],
)
def test_model_failures_return_rules_http_200_and_never_expose_exception(setup, reason):
    scenario, _, call, _ = setup
    request = httpx.Request("POST", "https://example.invalid/responses")
    response = httpx.Response(429, request=request)
    errors = {
        "rate_limit": RateLimitError(FAKE_KEY, response=response, body=None),
        "timeout": APITimeoutError(request=request),
        "connection": APIConnectionError(message=FAKE_KEY, request=request),
        "api_status": APIStatusError(FAKE_KEY, response=response, body=None),
        "incomplete": ProviderFailure("incomplete"),
        "refusal": ProviderFailure("refusal"),
        "provider_error": RuntimeError(FAKE_KEY),
    }
    call.side_effect = errors[reason]
    with TestClient(create_app(settings())) as client:
        response = client.post("/api/analyze", json=scenario.model_dump())
        assert not client.app.state.analyze_semaphore.locked()
    assert response.status_code == 200
    data = response.json()
    assert data["provider"] == f"rules(fallback:{reason})"
    assert data["verified_numbers"]["total"] == data["verified_numbers"]["confirmed"]
    assert FAKE_KEY not in response.text


def test_busy_semaphore_falls_back_without_waiting_and_rules_bypass(setup):
    scenario, _, call, _ = setup
    with TestClient(create_app(settings(analyze_concurrency=1))) as client:
        semaphore = client.app.state.analyze_semaphore
        client.portal.call(semaphore.acquire)
        response = client.post("/api/analyze", json=scenario.model_dump())
        assert response.json()["provider"] == "rules(fallback:busy)"
        forced = client.post("/api/analyze?provider=rules", json=scenario.model_dump())
        assert forced.json()["provider"] == "rules"
        assert semaphore.locked()
    call.assert_not_awaited()


def test_unconfigured_api_uses_rules_without_creating_client(setup):
    scenario, _, call, _ = setup
    with TestClient(create_app(Settings())) as client:
        response = client.post("/api/analyze", json=scenario.model_dump())
    assert response.status_code == 200
    assert response.json()["provider"] == "rules"
    call.assert_not_awaited()
