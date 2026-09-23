"""Offline SDK boundary checks: strict schemas, failures, prompts and lifecycle."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from openai import OpenAIError
from openai.lib._pydantic import to_strict_json_schema
from openai.types.responses import ResponseReasoningItem

from app.ai.llm import OpenAIClient, ProviderFailure
from app.ai.prompts import PROMPT_VERSION, build_prompts
from app.config import Settings
from app.engine.catalog import get_catalog
from app.engine.models import AnalysisReport, Claim, Fact, TraceStep

FAKE_KEY = "offline-test-key-not-a-credential"


@pytest.fixture(autouse=True)
def forbid_external_client(monkeypatch):
    factory = MagicMock(side_effect=AssertionError("Use an injected fake SDK in offline tests"))
    monkeypatch.setattr("app.ai.llm.AsyncOpenAI", factory)
    return factory


def configured_settings(**overrides):
    values = {"openai_api_key": FAKE_KEY, "openai_model": "test-configured-model"}
    values.update(overrides)
    return Settings(**values)


def sdk_response(**overrides):
    values = {
        "status": "completed",
        "output": [],
        "output_parsed": Claim(text="Проверенный факт.", evidence=["F1"]),
        "model": "test-returned-model",
        "usage": SimpleNamespace(input_tokens=10, output_tokens=20, total_tokens=30),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_structured_call_uses_responses_parse_and_requested_schema():
    response = sdk_response(
        output=[ResponseReasoningItem(id="rs_test", summary=[], type="reasoning")]
    )
    parse = AsyncMock(return_value=response)
    sdk = SimpleNamespace(responses=SimpleNamespace(parse=parse))
    client = OpenAIClient(configured_settings(), sdk_client=sdk)

    result = asyncio.run(client.structured_call("Системные правила", "Таблица фактов", Claim))

    assert result == response.output_parsed
    parse.assert_awaited_once()
    arguments = parse.call_args.kwargs
    assert arguments["model"] == "test-configured-model"
    assert arguments["text_format"] is Claim
    assert arguments["input"] == [
        {"role": "system", "content": "Системные правила"},
        {"role": "user", "content": "Таблица фактов"},
    ]
    assert arguments["temperature"] == 0
    assert arguments["max_output_tokens"] == 16000
    assert client.last_usage == {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30}
    assert client.last_model == "test-returned-model"
    assert FAKE_KEY not in repr(arguments)


@pytest.mark.parametrize(
    ("response", "reason"),
    [
        (sdk_response(status="incomplete", incomplete_details=FAKE_KEY), "incomplete"),
        (sdk_response(status="failed", error=FAKE_KEY), "incomplete"),
        (
            sdk_response(
                output=[
                    SimpleNamespace(content=[SimpleNamespace(type="refusal", refusal=FAKE_KEY)])
                ]
            ),
            "refusal",
        ),
        (sdk_response(output_parsed=None), "invalid_output"),
    ],
    ids=["incomplete", "failed", "refusal", "no-parsed-output"],
)
def test_unusable_response_has_only_static_fallback_reason(response, reason):
    sdk = SimpleNamespace(responses=SimpleNamespace(parse=AsyncMock(return_value=response)))
    client = OpenAIClient(configured_settings(), sdk_client=sdk)

    with pytest.raises(ProviderFailure) as failure:
        asyncio.run(client.structured_call("rules", "facts", Claim))

    assert failure.value.reason == reason
    assert str(failure.value) == reason
    assert FAKE_KEY not in str(failure.value)


def test_sdk_errors_are_propagated_without_adapter_logging(caplog):
    original = OpenAIError(FAKE_KEY)
    sdk = SimpleNamespace(responses=SimpleNamespace(parse=AsyncMock(side_effect=original)))
    client = OpenAIClient(configured_settings(), sdk_client=sdk)

    with pytest.raises(OpenAIError) as failure:
        asyncio.run(client.structured_call("rules", "facts", Claim))

    assert failure.value is original
    assert FAKE_KEY not in caplog.text


@pytest.mark.parametrize("base_url", [None, "https://llm.example.test/v1"])
def test_owned_sdk_client_uses_explicit_url_timeout_and_closes(base_url, monkeypatch):
    monkeypatch.setenv("OPENAI_BASE_URL", "")
    parse = AsyncMock(return_value=sdk_response())
    context = AsyncMock()
    context.__aenter__.return_value = SimpleNamespace(responses=SimpleNamespace(parse=parse))
    factory = MagicMock(return_value=context)
    monkeypatch.setattr("app.ai.llm.AsyncOpenAI", factory)
    client = OpenAIClient(configured_settings(openai_base_url=base_url))

    asyncio.run(client.structured_call("rules", "facts", Claim))

    assert factory.call_args.kwargs == {
        "api_key": FAKE_KEY,
        "base_url": base_url or "https://api.openai.com/v1",
        "timeout": 120.0,
        "max_retries": 1,
    }
    context.__aenter__.assert_awaited_once()
    context.__aexit__.assert_awaited_once()


def test_owned_sdk_client_is_closed_on_parse_error(monkeypatch):
    parse = AsyncMock(side_effect=OpenAIError("offline SDK failure"))
    context = AsyncMock()
    context.__aenter__.return_value = SimpleNamespace(responses=SimpleNamespace(parse=parse))
    monkeypatch.setattr("app.ai.llm.AsyncOpenAI", MagicMock(return_value=context))

    with pytest.raises(OpenAIError):
        asyncio.run(OpenAIClient(configured_settings()).structured_call("rules", "facts", Claim))

    context.__aexit__.assert_awaited_once()


@pytest.mark.parametrize(
    "settings",
    [
        configured_settings(openai_api_key=""),
        configured_settings(openai_model=""),
        configured_settings(ai_provider="rules"),
    ],
    ids=["no-key", "no-model", "forced-rules"],
)
def test_unconfigured_provider_never_constructs_sdk(settings, forbid_external_client):
    with pytest.raises(ProviderFailure, match="not_configured"):
        asyncio.run(OpenAIClient(settings).structured_call("rules", "facts", Claim))
    forbid_external_client.assert_not_called()


def test_report_schema_produced_by_installed_sdk_has_no_dynamic_objects():
    schema = to_strict_json_schema(AnalysisReport)

    def check(node):
        if isinstance(node, dict):
            if node.get("type") == "object":
                assert node.get("additionalProperties") is False
                assert set(node.get("required", [])) == set(node.get("properties", {}))
            for value in node.values():
                check(value)
        elif isinstance(node, list):
            for value in node:
                check(value)

    check(schema)
    assert schema["$defs"]["TraceStep"]["properties"]["input"]["properties"] == {}
    # Limiting what the model can author must preserve actual server trace inputs.
    trace = TraceStep(
        n=1,
        kind="server",
        tool="evaluate_scenario",
        input={"scenario_id": "a1", "decisions": []},
        output_summary="ok",
        ms=0,
        ok=True,
    )
    assert trace.model_dump()["input"] == {"scenario_id": "a1", "decisions": []}
    assert (
        TraceStep.model_json_schema(mode="serialization")["properties"]["input"][
            "additionalProperties"
        ]
        is True
    )


def test_prompts_include_facts_catalog_and_no_unstructured_request_input():
    facts = [Fact(id="F1", key="score", value=56.54308, text_ru="Итоговый Score: 56.54.")]
    system, user = build_prompts(facts)
    payload = json.loads(user)

    assert set(payload) == {"FactTable", "task"}
    assert payload["FactTable"] == [fact.model_dump() for fact in facts]
    assert payload["task"] == "Проанализируй сценарий и предложи до 3 улучшений"
    assert PROMPT_VERSION == "2.2.0"
    for district in get_catalog().districts.values():
        assert district["profile_ru"] in system
    for measure in get_catalog().measures.values():
        assert measure["name_ru"] in system
    assert "300 слов" in system
    assert "не вычисляй Score" in system
    assert "evidence" in system
    assert "trace=[]" in system
    assert "city_impact" in system


def test_generation_requires_evidence_but_guard_output_can_have_empty_evidence():
    schema = AnalysisReport.model_json_schema(mode="validation")
    evidence = schema["$defs"]["Claim"]["properties"]["evidence"]
    assert evidence["minItems"] == 1
    assert evidence["items"]["pattern"] == "^F[1-9][0-9]*$"
    output = AnalysisReport.model_json_schema(mode="serialization")
    assert "minItems" not in output["$defs"]["Claim"]["properties"]["evidence"]
    assert Claim(text="Текст сохранён guard.", evidence=[]).evidence == []


@pytest.mark.parametrize("measure_id", ["M3", "M13"])
def test_prompt_mandatory_lag_claim_uses_selected_fact_values_and_ids(measure_id):
    # Deliberately differ from the catalog to catch accidental hardcoded values
    # or recomputation: the prompt must copy the engine FactTable it was given.
    facts = [
        Fact(id="F41", key=f"measure.{measure_id}.lag", value=3, text_ru="Лаг: 3.00."),
        Fact(
            id="F42",
            key=f"measure.{measure_id}.effect_fraction",
            value=0.625,
            text_ru="Доля эффекта: 0.62.",
        ),
    ]
    system, user = build_prompts(facts)
    footer = system.rsplit("\n", 1)[1]
    required = json.loads(footer)["required_lag_claims"]

    assert required == [
        {
            "text": f"{measure_id}: лаг 3.00 квартала; доля эффекта 0.62.",
            "evidence": ["F41", "F42"],
        }
    ]
    assert "risks или consequences" in system
    assert json.loads(user)["FactTable"] == [fact.model_dump() for fact in facts]


def test_prompt_does_not_require_lags_of_unselected_catalog_measures():
    system, _ = build_prompts([Fact(id="F1", key="measure.M7.lag", value=3, text_ru="Лаг: 3.00.")])
    footer = system.rsplit("\n", 1)[1]
    assert json.loads(footer)["required_lag_claims"] == []


def test_prompt_requires_both_selected_long_lags_without_inventing_missing_fraction():
    system, _ = build_prompts(
        [
            Fact(id="F81", key="measure.M13.lag", value=4, text_ru="Лаг: 4.00."),
            Fact(id="F21", key="measure.M3.lag", value=4, text_ru="Лаг: 4.00."),
        ]
    )
    footer = system.rsplit("\n", 1)[1]
    assert json.loads(footer)["required_lag_claims"] == [
        {"text": "M3: лаг 4.00 квартала.", "evidence": ["F21"]},
        {"text": "M13: лаг 4.00 квартала.", "evidence": ["F81"]},
    ]
