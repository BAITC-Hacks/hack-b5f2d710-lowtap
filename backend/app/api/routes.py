import asyncio
import json
from contextlib import suppress
from typing import Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from app import __version__
from app.ai.service import analyze
from app.engine.catalog import get_catalog
from app.engine.distribution import load_distribution
from app.engine.models import (
    AnalysisReport,
    ConfigResponse,
    EvalResult,
    HealthResponse,
    Scenario,
    ValidationResult,
)
from app.engine.scoring import InvalidScenario, evaluate, score_decisions
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


def sse_event(name: str, payload: dict) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False)
    return f"event: {name}\ndata: {encoded}\n\n"


async def analysis_events(scenario: Scenario, settings, semaphore, *, provider, cache):
    """Publish each completed step while the model is still running."""
    queue = asyncio.Queue()

    async def on_trace(step):
        await queue.put(("trace", step.model_dump()))

    async def produce():
        try:
            report = await analyze(
                scenario, settings, semaphore, provider=provider, cache=cache, on_trace=on_trace
            )
            await queue.put(("report", report.model_dump()))
        finally:
            await queue.put(("done", {"ok": True}))

    task = asyncio.create_task(produce())
    try:
        while True:
            name, payload = await queue.get()
            if name == "done":
                # Unexpected application errors propagate instead of a fake done.
                await task
                yield sse_event(name, payload)
                return
            yield sse_event(name, payload)
    finally:
        if not task.done():
            task.cancel()
        with suppress(asyncio.CancelledError):
            await task


@router.post(
    "/analyze", response_model=AnalysisReport, responses={422: {"model": ValidationResult}}
)
async def analyze_scenario(
    scenario: Scenario,
    request: Request,
    provider: Literal["auto", "rules"] = "auto",
    stream: int = Query(default=0, ge=0, le=1),
):
    state = request.app.state
    if stream:
        validation = validate(scenario)
        if not validation.ok:
            raise InvalidScenario(validation)
        return StreamingResponse(
            analysis_events(
                scenario,
                state.settings,
                state.analyze_semaphore,
                provider=provider,
                cache=state.report_cache,
            ),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    return await analyze(
        scenario,
        state.settings,
        state.analyze_semaphore,
        provider=provider,
        cache=state.report_cache,
    )
