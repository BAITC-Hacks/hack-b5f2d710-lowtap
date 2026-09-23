"""Offline regression checks of the actual Responses tool-loop boundary."""

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from openai.types.responses import ResponseFunctionToolCall, ResponseReasoningItem

from app.ai.llm import OpenAIClient, ProviderFailure
from app.ai.tools import TOOLS
from app.config import Settings
from app.engine.models import AnalysisReport, Claim, VerifiedNumbers

ROOT = Path(__file__).resolve().parents[2]
FAKE_KEY = "offline-agent-test-not-a-key"


@pytest.fixture(autouse=True)
def no_real_sdk(monkeypatch):
    factory = MagicMock(side_effect=AssertionError("Real network is forbidden in agent tests"))
    monkeypatch.setattr("app.ai.llm.AsyncOpenAI", factory)
    return factory


def settings():
    return Settings(openai_api_key=FAKE_KEY, openai_model="test-agent-model")


def example_arguments():
    document = json.loads((ROOT / "data/scenarios/example_tz.json").read_text(encoding="utf-8"))
    return {"decisions": document["decisions"]}


def tool_call(name="evaluate_scenario", arguments=None, suffix="1"):
    return ResponseFunctionToolCall(
        id=f"fc_{suffix}",
        call_id=f"call_{suffix}",
        type="function_call",
        name=name,
        arguments=json.dumps(example_arguments() if arguments is None else arguments),
        status="completed",
    )


def report():
    claim = Claim(text="Городской эффект описан по фактам.", evidence=["F1"])
    return AnalysisReport(
        summary="Проверенный отчёт.",
        strengths=[claim],
        risks=[claim],
        consequences=[claim],
        tradeoffs=[claim],
        city_impact=[claim],
        recommendations=[],
        provider="llm",
        model="",
        prompt_version="",
        trace=[],
        verified_numbers=VerifiedNumbers(total=0, confirmed=0, unverified=[]),
        cached=False,
    )


def response(*items, **overrides):
    values = {
        "status": "completed",
        "output": list(items),
        "model": "test-agent-model",
        "usage": SimpleNamespace(input_tokens=10, output_tokens=20, total_tokens=30),
        "output_parsed": report(),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def sdk_client(rounds, final=None):
    return SimpleNamespace(
        responses=SimpleNamespace(
            create=AsyncMock(side_effect=rounds),
            parse=AsyncMock(return_value=response() if final is None else final),
        )
    )


def test_loop_executes_real_engine_tool_replays_reasoning_and_string_output():
    reasoning = ResponseReasoningItem(id="rs_test", type="reasoning", summary=[])
    call = tool_call()
    sdk = sdk_client([response(reasoning, call), response()])
    client = OpenAIClient(settings(), sdk_client=sdk)
    final, trace = asyncio.run(client.tool_loop("system", "facts", TOOLS, 6))

    assert final == report()
    assert sdk.responses.create.await_count == 2
    assert sdk.responses.parse.await_count == 1
    first, second = sdk.responses.create.call_args_list
    assert first.kwargs["input"] == [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "facts"},
    ]
    assert first.kwargs["tool_choice"] == "required"
    assert second.kwargs["tool_choice"] == "auto"
    continued = second.kwargs["input"]
    assert reasoning.model_dump(mode="json", exclude_none=True) in continued
    assert call.model_dump(mode="json", exclude_none=True) in continued
    output = next(item for item in continued if item.get("type") == "function_call_output")
    assert output["call_id"] == call.call_id
    assert isinstance(output["output"], str)
    decoded = json.loads(output["output"])
    assert decoded["score"] == pytest.approx(56.543, abs=5e-4)
    assert client.tool_results == [decoded]
    assert len(trace) == 1
    assert trace[0].kind == "agent"
    assert trace[0].tool == "evaluate_scenario"
    assert trace[0].ok
    assert trace[0].input == example_arguments()
    assert trace[0].ms >= 0
    final_args = sdk.responses.parse.call_args.kwargs
    assert final_args["text_format"] is AnalysisReport
    assert final_args["tools"] == TOOLS
    assert final_args["tool_choice"] == "none"
    assert final_args["temperature"] == 0
    assert client.last_usage == {"input_tokens": 30, "output_tokens": 60, "total_tokens": 90}


def test_round_limit_finalizes_once_without_an_extra_create():
    sdk = sdk_client([response(tool_call(suffix="1")), response(tool_call(suffix="2"))])
    client = OpenAIClient(settings(), sdk_client=sdk)
    _, trace = asyncio.run(client.tool_loop("system", "facts", TOOLS, 2))

    assert sdk.responses.create.await_count == 2
    sdk.responses.parse.assert_awaited_once()
    assert [step.kind for step in trace] == ["agent", "agent", "server"]
    assert trace[-1].tool == "agent_round_limit"
    assert trace[-1].input == {"max_rounds": 2}
    assert sdk.responses.parse.call_args.kwargs["tool_choice"] == "none"
    outputs = [
        item
        for item in sdk.responses.parse.call_args.kwargs["input"]
        if item.get("type") == "function_call_output"
    ]
    assert len(outputs) == 2


@pytest.mark.parametrize(
    ("phase", "failure"),
    [
        ("create", "incomplete"),
        ("parse", "incomplete"),
        ("create", "refusal"),
        ("parse", "refusal"),
        ("parse", "missing_parsed"),
    ],
)
def test_incomplete_refusal_and_missing_output_are_safe_provider_failures(phase, failure):
    if failure == "incomplete":
        unusable = response(status="incomplete", incomplete_details=FAKE_KEY)
        expected = "incomplete"
    elif failure == "refusal":
        unusable = response(
            SimpleNamespace(content=[SimpleNamespace(type="refusal", refusal=FAKE_KEY)])
        )
        expected = "refusal"
    else:
        unusable = response(output_parsed=None)
        expected = "invalid_output"
    sdk = (
        sdk_client([unusable])
        if phase == "create"
        else sdk_client([response(tool_call()), response()], final=unusable)
    )
    client = OpenAIClient(settings(), sdk_client=sdk)

    with pytest.raises(ProviderFailure) as caught:
        asyncio.run(client.tool_loop("system", "facts", TOOLS, 6))

    assert caught.value.reason == expected
    assert FAKE_KEY not in str(caught.value)
    if phase == "create":
        sdk.responses.parse.assert_not_awaited()


def test_executor_exception_becomes_error_json_and_loop_continues(monkeypatch):
    execute = MagicMock(side_effect=[RuntimeError(FAKE_KEY), {"ok": True, "score": 56.54308}])
    monkeypatch.setattr("app.ai.tools.ToolExecutor", lambda: SimpleNamespace(execute=execute))
    sdk = sdk_client(
        [response(tool_call(suffix="bad")), response(tool_call(suffix="good")), response()]
    )
    client = OpenAIClient(settings(), sdk_client=sdk)
    _, trace = asyncio.run(client.tool_loop("system", "facts", TOOLS, 6))

    assert [step.ok for step in trace] == [False, True]
    assert sdk.responses.create.await_count == 3
    sdk.responses.parse.assert_awaited_once()
    output = next(
        item
        for item in sdk.responses.create.call_args_list[1].kwargs["input"]
        if item.get("type") == "function_call_output"
    )
    assert isinstance(output["output"], str)
    assert set(json.loads(output["output"])) == {"error"}
    assert FAKE_KEY not in output["output"]
    assert FAKE_KEY not in trace[0].output_summary


@pytest.mark.parametrize("arguments", ["{invalid", "[]", '{"x":NaN}', '{"x":1e400}'])
def test_malformed_arguments_return_error_without_calling_executor(monkeypatch, arguments):
    execute = MagicMock(side_effect=AssertionError("Broken JSON must not reach executor"))
    monkeypatch.setattr("app.ai.tools.ToolExecutor", lambda: SimpleNamespace(execute=execute))
    call = tool_call().model_copy(update={"arguments": arguments})
    sdk = sdk_client([response(call), response()])
    client = OpenAIClient(settings(), sdk_client=sdk)
    _, trace = asyncio.run(client.tool_loop("system", "facts", TOOLS, 6))

    execute.assert_not_called()
    assert trace[0].ok is False
    assert trace[0].input == {}
    assert "error" in client.tool_results[0]
    json.dumps(trace[0].model_dump(), allow_nan=False)
    sdk.responses.parse.assert_awaited_once()


def test_async_trace_callback_arrives_before_final_parse():
    received = []
    sdk = sdk_client([response(tool_call()), response()])

    async def on_trace(step):
        assert sdk.responses.parse.await_count == 0
        received.append(step)

    async def final_parse(**kwargs):
        assert received and received[0].tool == "evaluate_scenario"
        return response()

    sdk.responses.parse.side_effect = final_parse
    client = OpenAIClient(settings(), sdk_client=sdk)
    _, trace = asyncio.run(client.tool_loop("system", "facts", TOOLS, 6, on_trace=on_trace))
    assert received == trace


def test_multiple_function_calls_each_get_matching_output():
    calls = [tool_call(suffix="first"), tool_call(suffix="second")]
    sdk = sdk_client([response(*calls), response()])
    _, trace = asyncio.run(OpenAIClient(settings(), sdk).tool_loop("system", "facts", TOOLS, 6))
    continued = sdk.responses.create.call_args_list[1].kwargs["input"]
    outputs = [item for item in continued if item.get("type") == "function_call_output"]
    assert [item["call_id"] for item in outputs] == [call.call_id for call in calls]
    assert [step.n for step in trace] == [1, 2]


def test_owned_sdk_is_closed_when_loop_fails(monkeypatch):
    sdk = sdk_client([response(status="incomplete")])
    context = AsyncMock()
    context.__aenter__.return_value = sdk
    factory = MagicMock(return_value=context)
    monkeypatch.setattr("app.ai.llm.AsyncOpenAI", factory)

    with pytest.raises(ProviderFailure, match="incomplete"):
        asyncio.run(OpenAIClient(settings()).tool_loop("system", "facts", TOOLS, 6))

    assert factory.call_args.kwargs["timeout"] == 120
    assert factory.call_args.kwargs["max_retries"] == 1
    assert factory.call_args.kwargs["base_url"] == "https://api.openai.com/v1"
    context.__aexit__.assert_awaited_once()


def test_zero_round_limit_never_creates_sdk(no_real_sdk):
    with pytest.raises(ValueError, match="positive"):
        asyncio.run(OpenAIClient(settings()).tool_loop("system", "facts", TOOLS, 0))
    no_real_sdk.assert_not_called()
