import json
from time import perf_counter
from typing import Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from app import __version__
from app.ai.rules import RuleBasedExplainer
from app.engine.catalog import get_catalog
from app.engine.distribution import load_distribution
from app.engine.facts import build_facts
from app.engine.models import (
    AnalysisReport,
    ConfigResponse,
    EvalResult,
    HealthResponse,
    Scenario,
    TraceStep,
    ValidationResult,
)
from app.engine.scoring import evaluate, score_decisions
from app.engine.validator import validate

router = APIRouter(prefix="/api")


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    return HealthResponse(
        provider="llm" if settings.use_llm else "rules",
        ai_cache=settings.ai_cache,
        model=settings.openai_model,
        model_fast=settings.openai_model_fast,
        has_key=settings.has_key,
        model_status=request.app.state.model_status,
        data_hash=request.app.state.data_hash,
        version=__version__,
    )


@router.get("/config", response_model=ConfigResponse)
def config() -> ConfigResponse:
    catalog = get_catalog()
    distribution = load_distribution(catalog)
    fields = ("count", "worse_than_baseline", "best", "worst", "quantiles", "bins")
    return ConfigResponse(
        districts=list(catalog.districts.values()),
        measures=list(catalog.measures.values()),
        rules=catalog.rules,
        baseline=round(score_decisions([], catalog).score, 3),
        distribution={key: distribution[key] for key in fields} if distribution else None,
        data_hash=catalog.data_hash,
    )


@router.post(
    "/validate", response_model=ValidationResult, responses={422: {"model": ValidationResult}}
)
def validate_scenario(scenario: Scenario) -> ValidationResult:
    return validate(scenario)


@router.post("/evaluate", response_model=EvalResult, responses={422: {"model": ValidationResult}})
def evaluate_scenario(scenario: Scenario) -> EvalResult:
    return evaluate(scenario)


def report_events(report: AnalysisReport):
    """Only engine/server steps exist in B2; B4 adds live tool progress."""
    for step in report.trace:
        yield f"event: trace\ndata: {json.dumps(step.model_dump(), ensure_ascii=False)}\n\n"
    yield f"event: report\ndata: {json.dumps(report.model_dump(), ensure_ascii=False)}\n\n"
    yield 'event: done\ndata: {"ok":true}\n\n'


@router.post(
    "/analyze", response_model=AnalysisReport, responses={422: {"model": ValidationResult}}
)
def analyze_scenario(
    scenario: Scenario,
    provider: Literal["auto", "rules"] = "auto",
    stream: int = Query(default=0, ge=0, le=1),
):
    # Both B2 providers use deterministic rules; rules never acquire the LLM semaphore.
    del provider
    started = perf_counter()
    result = evaluate(scenario)
    evaluation_ms = (perf_counter() - started) * 1000
    started = perf_counter()
    facts = build_facts(scenario, result)
    facts_ms = (perf_counter() - started) * 1000
    report = RuleBasedExplainer().explain(scenario, result, facts)
    report.trace = [
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
        *report.trace,
    ]
    for index, step in enumerate(report.trace, start=1):
        step.n = index
    if stream:
        return StreamingResponse(
            report_events(report),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    return report
