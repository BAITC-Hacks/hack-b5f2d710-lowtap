"""Streaming progress must arrive before completion and stop on disconnect."""

import asyncio
import json
from pathlib import Path

from app.ai.cache import ReportCache
from app.ai.rules import RuleBasedExplainer
from app.api.routes import analysis_events
from app.config import Settings
from app.engine.facts import build_facts
from app.engine.models import Scenario, TraceStep
from app.engine.scoring import evaluate

ROOT = Path(__file__).resolve().parents[2]


def example():
    scenario = Scenario.model_validate_json(
        (ROOT / "data/scenarios/example_tz.json").read_text(encoding="utf-8")
    )
    result = evaluate(scenario)
    report = RuleBasedExplainer().explain(scenario, result, build_facts(scenario, result))
    return scenario, report


def test_trace_is_yielded_before_model_final_answer(monkeypatch, tmp_path):
    scenario, report = example()

    async def run():
        finish = asyncio.Event()
        step = TraceStep(
            n=1,
            kind="agent",
            tool="best_neighbors",
            input={},
            output_summary="Найдены альтернативы",
            ms=1,
            ok=True,
        )

        async def fake_analyze(*args, on_trace, **kwargs):
            await on_trace(step)
            await finish.wait()
            report.trace = [step]
            return report

        monkeypatch.setattr("app.api.routes.analyze", fake_analyze)
        stream = analysis_events(
            scenario, Settings(), asyncio.Semaphore(1), provider="auto", cache=ReportCache(tmp_path)
        )
        first = await asyncio.wait_for(anext(stream), timeout=1)
        assert first.startswith("event: trace\n")
        assert not finish.is_set()
        finish.set()
        remainder = [event async for event in stream]
        assert [event.splitlines()[0] for event in remainder] == ["event: report", "event: done"]
        data = json.loads(remainder[0].split("data: ", 1)[1])
        assert data["trace"] == [step.model_dump()]

    asyncio.run(run())


def test_disconnect_cancels_model_task_and_releases_semaphore(monkeypatch, tmp_path):
    scenario, report = example()

    async def run():
        semaphore = asyncio.Semaphore(1)
        cancelled = asyncio.Event()

        async def fake_analyze(*args, on_trace, **kwargs):
            try:
                async with semaphore:
                    await on_trace(report.trace[0])
                    await asyncio.Event().wait()
            finally:
                cancelled.set()

        monkeypatch.setattr("app.api.routes.analyze", fake_analyze)
        stream = analysis_events(
            scenario, Settings(), semaphore, provider="auto", cache=ReportCache(tmp_path)
        )
        assert (await asyncio.wait_for(anext(stream), timeout=1)).startswith("event: trace")
        assert semaphore.locked()
        await stream.aclose()
        assert cancelled.is_set()
        assert not semaphore.locked()

    asyncio.run(run())
