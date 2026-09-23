"""One AI deadline leaves time for a guarded fallback before the browser aborts."""

import asyncio
import json
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.ai.cache import ReportCache
from app.ai.llm import OpenAIClient
from app.ai.prompts import PROMPT_VERSION
from app.ai.rules import RuleBasedExplainer
from app.ai.service import analyze
from app.api.routes import analysis_events
from app.config import DATA_DIR, Settings
from app.engine.facts import build_facts
from app.engine.models import Scenario
from app.engine.scoring import evaluate


@pytest.fixture(scope="module")
def example():
    scenario = Scenario.model_validate_json((DATA_DIR / "scenarios/example_tz.json").read_bytes())
    result = evaluate(scenario)
    report = RuleBasedExplainer().explain(scenario, result, build_facts(scenario, result))
    return scenario, report


def settings(cache="0"):
    return Settings(openai_api_key="offline-test-key", openai_model="test-model", ai_cache=cache)


def draft_needing_revision(report):
    draft = report.model_copy(deep=True)
    draft.recommendations[0].decisions = []
    return draft


def test_deadline_cancels_actual_sdk_await_and_sse_finishes_with_guarded_rules(
    monkeypatch, tmp_path, example
):
    scenario, _ = example
    monkeypatch.setattr("app.ai.service.AI_TIMEOUT_SECONDS", 0.03)

    async def run():
        entered = asyncio.Event()
        cancelled = asyncio.Event()

        async def create(**kwargs):
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        sdk = SimpleNamespace(
            responses=SimpleNamespace(create=AsyncMock(side_effect=create), parse=AsyncMock())
        )
        client = OpenAIClient(settings(), sdk_client=sdk)
        monkeypatch.setattr("app.ai.service.OpenAIClient", lambda _: client)
        semaphore = asyncio.Semaphore(1)

        async def collect():
            return [
                event
                async for event in analysis_events(
                    scenario,
                    settings(),
                    semaphore,
                    provider="auto",
                    cache=ReportCache(tmp_path),
                )
            ]

        events = await asyncio.wait_for(collect(), timeout=2)
        assert entered.is_set() and cancelled.is_set()
        assert not semaphore.locked()
        sdk.responses.parse.assert_not_awaited()
        assert events[-2].startswith("event: report\n")
        assert events[-1].startswith("event: done\n")
        report = json.loads(events[-2].split("data: ", 1)[1])
        assert report["provider"] == "rules(fallback:timeout)"
        assert report["verified_numbers"]["confirmed"] == report["verified_numbers"]["total"]
        assert all(item["verified"] for item in report["recommendations"])
        step = next(step for step in report["trace"] if step["tool"] == "agent_loop")
        assert step["ok"] is False
        assert "timeout" in step["output_summary"]

    asyncio.run(run())


def test_initial_loop_and_revision_share_one_deadline(monkeypatch, tmp_path, example):
    scenario, report = example
    monkeypatch.setattr("app.ai.service.AI_TIMEOUT_SECONDS", 0.20)

    async def run():
        revision_cancelled = asyncio.Event()

        async def loop(*args, **kwargs):
            # Each model phase individually fits the budget; their sum does not.
            await asyncio.sleep(0.08)
            return draft_needing_revision(report), []

        async def revision(*args, **kwargs):
            try:
                await asyncio.sleep(0.16)
                return report.model_copy(deep=True)
            except asyncio.CancelledError:
                revision_cancelled.set()
                raise

        client = SimpleNamespace(
            tool_loop=AsyncMock(side_effect=loop),
            structured_call=AsyncMock(side_effect=revision),
            tool_results=[],
            last_usage={},
            last_model="test-model",
        )
        monkeypatch.setattr("app.ai.service.OpenAIClient", lambda _: client)
        semaphore = asyncio.Semaphore(1)
        result = await analyze(scenario, settings(), semaphore, cache=ReportCache(tmp_path))
        assert result.provider == "rules(fallback:timeout)"
        assert revision_cancelled.is_set()
        client.structured_call.assert_awaited_once()
        assert not semaphore.locked()

    asyncio.run(run())


def test_deadline_includes_server_tool_preparing_revision(monkeypatch, tmp_path, example):
    scenario, report = example
    monkeypatch.setattr("app.ai.service.AI_TIMEOUT_SECONDS", 0.05)
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()

    def slow_tool(*args):
        entered.set()
        try:
            assert release.wait(timeout=2)
            return {"neighbors": []}
        finally:
            finished.set()

    monkeypatch.setattr("app.ai.service.ToolExecutor", lambda: SimpleNamespace(execute=slow_tool))
    client = SimpleNamespace(
        tool_loop=AsyncMock(return_value=(draft_needing_revision(report), [])),
        structured_call=AsyncMock(),
        tool_results=[],
        last_usage={},
        last_model="test-model",
    )
    monkeypatch.setattr("app.ai.service.OpenAIClient", lambda _: client)

    async def run():
        semaphore = asyncio.Semaphore(1)
        try:
            result = await asyncio.wait_for(
                analyze(scenario, settings(), semaphore, cache=ReportCache(tmp_path)), timeout=1
            )
            assert entered.is_set() and not finished.is_set()
            assert result.provider == "rules(fallback:timeout)"
            assert not semaphore.locked()
            client.structured_call.assert_not_awaited()
        finally:
            # A Python worker cannot be killed; its bounded, pure computation can
            # finish independently, but must no longer delay the fallback response.
            release.set()

    asyncio.run(run())
    assert finished.wait(timeout=1)


def test_timeout_uses_fallback_cache_and_rechecks_recommendations(monkeypatch, tmp_path, example):
    scenario, report = example
    stored = report.model_copy(deep=True)
    stored.model, stored.prompt_version = "test-model", PROMPT_VERSION
    stored.recommendations[0].score = 99
    cache = ReportCache(tmp_path)
    cache.put(scenario, "test-model", PROMPT_VERSION, stored)
    monkeypatch.setattr("app.ai.service.AI_TIMEOUT_SECONDS", 0.03)

    async def run():
        cancelled = asyncio.Event()

        async def loop(*args, **kwargs):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        monkeypatch.setattr(
            "app.ai.service.OpenAIClient", lambda _: SimpleNamespace(tool_loop=loop)
        )
        semaphore = asyncio.Semaphore(1)
        result = await analyze(scenario, settings("fallback"), semaphore, cache=cache)
        assert cancelled.is_set() and not semaphore.locked()
        assert result.provider == "cache" and result.cached
        assert result.recommendations[0].score != 99
        assert result.recommendations[0].verified
        assert result.verified_numbers.total == result.verified_numbers.confirmed

    asyncio.run(run())


@pytest.mark.parametrize("phase", ["loop", "revision"])
def test_caller_cancellation_propagates_without_fallback(monkeypatch, tmp_path, example, phase):
    scenario, report = example
    monkeypatch.setattr("app.ai.service.AI_TIMEOUT_SECONDS", 60.0)
    rules = MagicMock(side_effect=AssertionError("Cancellation must not invoke fallback"))
    monkeypatch.setattr("app.ai.service.RulesClient", rules)

    async def run():
        entered = asyncio.Event()
        cancelled = asyncio.Event()

        async def block():
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        async def loop(*args, **kwargs):
            if phase == "loop":
                await block()
            return draft_needing_revision(report), []

        async def revision(*args, **kwargs):
            await block()

        client = SimpleNamespace(
            tool_loop=loop,
            structured_call=revision,
            tool_results=[],
            last_usage={},
            last_model="test-model",
        )
        monkeypatch.setattr("app.ai.service.OpenAIClient", lambda _: client)
        semaphore = asyncio.Semaphore(1)
        task = asyncio.create_task(
            analyze(scenario, settings(), semaphore, cache=ReportCache(tmp_path))
        )
        await asyncio.wait_for(entered.wait(), timeout=1)
        assert semaphore.locked()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cancelled.is_set() and not semaphore.locked()
        rules.assert_not_called()

    asyncio.run(run())
