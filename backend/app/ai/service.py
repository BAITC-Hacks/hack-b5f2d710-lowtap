"""Provider ordering, concurrency and server verification for every report."""

import asyncio
import json
from collections.abc import Awaitable, Callable
from time import perf_counter

from openai import APIConnectionError, APIStatusError, APITimeoutError, RateLimitError
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app.ai.cache import ReportCache
from app.ai.guard import guard_report
from app.ai.llm import CacheClient, OpenAIClient, ProviderFailure, RulesClient
from app.ai.prompts import PROMPT_VERSION, build_prompts
from app.ai.tools import TOOLS, ToolExecutor
from app.config import Settings
from app.engine.facts import build_facts
from app.engine.models import AnalysisReport, Scenario, TraceStep
from app.engine.scoring import evaluate
from app.engine.validator import validate


def _recommendations_improve(report: AnalysisReport, original_score: float) -> bool:
    """An improvement is determined by complete decisions, never model numbers."""
    for recommendation in report.recommendations:
        proposed = Scenario(decisions=recommendation.decisions)
        if not validate(proposed).ok or evaluate(proposed).score <= original_score:
            return False
    return True


def _needs_revision(report: AnalysisReport, facts, original_score: float) -> bool:
    known_ids = {fact.id for fact in facts}
    claims = [
        claim
        for section in (
            report.strengths,
            report.risks,
            report.consequences,
            report.tradeoffs,
            report.city_impact,
        )
        for claim in section
    ]
    covered = sum(bool(set(claim.evidence) & known_ids) for claim in claims)
    return (bool(claims) and covered / len(claims) < 0.9) or not _recommendations_improve(
        report, original_score
    )


def failure_reason(exc: Exception) -> str:
    """Never put raw SDK messages, request payloads or credentials in a response."""
    if isinstance(exc, ProviderFailure):
        return exc.reason
    if isinstance(exc, RateLimitError):
        return "rate_limit"
    if isinstance(exc, APITimeoutError):
        return "timeout"
    if isinstance(exc, APIConnectionError):
        return "connection"
    if isinstance(exc, APIStatusError):
        return "api_status"
    if isinstance(exc, ValidationError):
        return "invalid_output"
    return "provider_error"


def _prepare(scenario: Scenario):
    started = perf_counter()
    result = evaluate(scenario)
    evaluation_ms = (perf_counter() - started) * 1000
    started = perf_counter()
    facts = build_facts(scenario, result)
    facts_ms = (perf_counter() - started) * 1000
    trace = [
        TraceStep(
            n=1,
            kind="server",
            tool="evaluate_scenario",
            input={"scenario_id": result.scenario_id},
            output_summary=f"Score {result.score:.3f}; критических пар {result.n_crit}",
            ms=evaluation_ms,
            ok=True,
        ),
        TraceStep(
            n=2,
            kind="server",
            tool="build_facts",
            input={"scenario_id": result.scenario_id},
            output_summary=f"Сформировано фактов: {len(facts)}",
            ms=facts_ms,
            ok=True,
        ),
    ]
    return result, facts, trace


async def analyze(
    scenario: Scenario,
    settings: Settings,
    semaphore: asyncio.Semaphore,
    *,
    provider: str = "auto",
    cache: ReportCache | None = None,
    on_trace: Callable[[TraceStep], Awaitable[None]] | None = None,
) -> AnalysisReport:
    # CPU work runs outside the event loop, so health/rules remain responsive
    # during a slow model request. Validation always happens before providers.
    result, facts, initial_trace = await run_in_threadpool(_prepare, scenario)
    trace = []
    tool_results = []

    async def emit(step: TraceStep) -> None:
        step = step.model_copy(update={"n": len(trace) + 1}, deep=True)
        trace.append(step)
        if on_trace is not None:
            await on_trace(step.model_copy(deep=True))

    for step in initial_trace:
        await emit(step)
    report = None
    reason = None
    cache_client = CacheClient(cache if cache is not None else ReportCache())
    forced_rules = provider == "rules" or settings.ai_provider == "rules"
    order = (
        []
        if forced_rules
        else {
            "first": ["cache", "llm"],
            "fallback": ["llm", "cache"],
            "0": ["llm"],
        }[settings.ai_cache]
    )
    for candidate in order:
        started = perf_counter()
        if candidate == "cache":
            report = await run_in_threadpool(
                cache_client.get, scenario, settings.openai_model, PROMPT_VERSION
            )
            await emit(
                TraceStep(
                    n=0,
                    kind="server",
                    tool="cache_read",
                    input={"scenario_id": result.scenario_id},
                    output_summary="Найден сохранённый отчёт." if report else "Отчёта в кэше нет.",
                    ms=(perf_counter() - started) * 1000,
                    ok=True,
                )
            )
            if report is not None:
                report.provider, report.cached = "cache", True
                # Re-execute cached tool inputs to recover trusted numbers;
                # neither model-authored nor cached output text is evidence.
                executor = ToolExecutor()
                names = {tool["name"] for tool in TOOLS}
                for step in report.trace:
                    if step.tool in names:
                        tool_results.append(
                            await run_in_threadpool(executor.execute, step.tool, step.input)
                        )
                break
            continue
        if not settings.use_llm:
            continue
        if semaphore.locked():
            reason = "busy"
        else:
            await semaphore.acquire()
            try:
                client = OpenAIClient(settings)
                system, user = build_prompts(facts)
                report, _ = await client.tool_loop(
                    system, user, TOOLS, settings.max_tool_rounds, on_trace=emit
                )
                report = AnalysisReport.model_validate(report.model_dump())
                tool_results.extend(client.tool_results)
                if await run_in_threadpool(_needs_revision, report, facts, result.score):
                    # One bounded revision uses server results, never silently
                    # edits the model's decision arrays or claims. Guard still
                    # runs below even when this revised draft remains imperfect.
                    revision_started = perf_counter()
                    alternatives = await run_in_threadpool(
                        ToolExecutor().execute,
                        "best_neighbors",
                        {**scenario.model_dump(), "objective": "score", "k": 3},
                    )
                    alternatives["neighbors"] = [
                        item
                        for item in alternatives.get("neighbors", [])
                        if item["score"] > result.score
                    ]
                    tool_results.append(alternatives)
                    await emit(
                        TraceStep(
                            n=0,
                            kind="server",
                            tool="best_neighbors",
                            input={**scenario.model_dump(), "objective": "score", "k": 3},
                            output_summary=(
                                "Требуется исправить ограничения, evidence или отсутствие "
                                "улучшения; подготовлены допустимые улучшения."
                            ),
                            ms=(perf_counter() - revision_started) * 1000,
                            ok=True,
                        )
                    )
                    revision_user = json.loads(user)
                    revision_user["verified_alternatives"] = alternatives
                    revision_user["task"] = (
                        "Сформируй исправленный краткий отчёт. Для каждого утверждения обязательны "
                        "существующие F-id из FactTable. Рекомендации выбирай ТОЛЬКО из "
                        "verified_alternatives: скопируй весь массив decisions одного варианта "
                        "без изменений; не смешивай разные варианты. Эти варианты проверены "
                        "серверным инструментом и строго улучшают Score исходного сценария. "
                        "Если verified_alternatives.neighbors пуст, верни recommendations=[]: "
                        "не предлагай ухудшения или равноценные замены. "
                        "Сохрани обязательные замечания о Нуре и лагах."
                    )
                    previous_usage = dict(client.last_usage)
                    report = await client.structured_call(
                        system, json.dumps(revision_user, ensure_ascii=False), AnalysisReport
                    )
                    report = AnalysisReport.model_validate(report.model_dump())
                    for name, value in previous_usage.items():
                        client.last_usage[name] = client.last_usage.get(name, 0) + value
                    improved = await run_in_threadpool(
                        _recommendations_improve, report, result.score
                    )
                    await emit(
                        TraceStep(
                            n=0,
                            kind="server",
                            tool="revise_report",
                            input={"attempt": 1},
                            output_summary=(
                                "Получена исправленная версия; далее общий guard."
                                if improved
                                else "Исправленные рекомендации не улучшают исходный план."
                            ),
                            ms=(perf_counter() - revision_started) * 1000,
                            ok=improved,
                        )
                    )
                    if not improved:
                        raise ProviderFailure("non_improving_recommendation")
                usage = client.last_usage
                completed_summary = (
                    f"Получен отчёт агента; модель {client.last_model}; "
                    f"токены: вход {usage.get('input_tokens', 0)}, "
                    f"выход {usage.get('output_tokens', 0)}."
                )
                # All operational metadata is assigned by the server.
                report.provider = "llm"
                report.model = settings.openai_model
                report.prompt_version = PROMPT_VERSION
                report.cached = False
                report.trace = []
            except Exception as exc:
                reason = failure_reason(exc)
                report = None
            finally:
                semaphore.release()
        await emit(
            TraceStep(
                n=0,
                kind="server",
                tool="agent_loop",
                input={"model": settings.openai_model},
                output_summary=(
                    completed_summary
                    if report is not None
                    else f"Переход к следующему провайдеру: {reason}."
                ),
                ms=(perf_counter() - started) * 1000,
                ok=report is not None,
            )
        )
        if report is not None:
            break
    if report is None:
        report = await run_in_threadpool(RulesClient().explain, scenario, result, facts)
        if reason:
            report.provider = f"rules(fallback:{reason})"
    for step in report.trace:
        await emit(step)
    started = perf_counter()
    report = await run_in_threadpool(guard_report, report, facts, tool_results=tool_results)
    await emit(
        TraceStep(
            n=0,
            kind="server",
            tool="guard_report",
            input={"scenario_id": result.scenario_id},
            output_summary=(
                f"Подтверждено чисел: {report.verified_numbers.confirmed} "
                f"из {report.verified_numbers.total}."
            ),
            ms=(perf_counter() - started) * 1000,
            ok=True,
        )
    )
    report.trace = trace
    if report.provider == "llm" and settings.ai_cache != "0":
        await run_in_threadpool(
            cache_client.put, scenario, settings.openai_model, PROMPT_VERSION, report
        )
    return report
