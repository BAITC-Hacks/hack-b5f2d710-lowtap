"""Provider ordering, concurrency and server verification for every report."""

import asyncio
from time import perf_counter

from openai import APIConnectionError, APIStatusError, APITimeoutError, RateLimitError
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app.ai.cache import ReportCache
from app.ai.guard import guard_report
from app.ai.llm import CacheClient, OpenAIClient, ProviderFailure, RulesClient
from app.ai.prompts import PROMPT_VERSION, build_prompts
from app.config import Settings
from app.engine.facts import build_facts
from app.engine.models import AnalysisReport, Scenario, TraceStep
from app.engine.scoring import evaluate


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
) -> AnalysisReport:
    # CPU work runs outside the event loop, so health/rules remain responsive
    # during a slow model request. Validation always happens before providers.
    result, facts, trace = await run_in_threadpool(_prepare, scenario)
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
            trace.append(
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
                report = await client.structured_call(system, user, AnalysisReport)
                usage = client.last_usage
                completed_summary = (
                    f"Получен структурированный отчёт; модель {client.last_model}; "
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
        trace.append(
            TraceStep(
                n=0,
                kind="server",
                tool="structured_call",
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
    trace.extend(report.trace)
    started = perf_counter()
    report = await run_in_threadpool(guard_report, report, facts)
    trace.append(
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
    for index, step in enumerate(report.trace, start=1):
        step.n = index
    if report.provider == "llm" and settings.ai_cache != "0":
        await run_in_threadpool(
            cache_client.put, scenario, settings.openai_model, PROMPT_VERSION, report
        )
    return report
