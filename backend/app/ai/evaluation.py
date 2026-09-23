"""Reproducible five-preset AI checks and verified offline-demo publication."""

import asyncio
import json
import os
import re
from dataclasses import replace
from pathlib import Path
from tempfile import NamedTemporaryFile

from app.ai.cache import ReportCache, cache_key
from app.ai.guard import guard_report
from app.ai.service import analyze
from app.ai.tools import ToolExecutor
from app.config import DATA_DIR, Settings
from app.engine.catalog import get_catalog, scenario_id
from app.engine.facts import build_facts
from app.engine.models import ENGINE_VERSION, AnalysisReport, Scenario
from app.engine.scoring import evaluate
from app.engine.validator import validate

DEFAULT_OUTPUT = DATA_DIR / "cache" / "eval" / "latest.jsonl"
PRESETS = ("example_tz", "cheapest", "naive_esil", "worst_of_all", "optimum")
CLAIM_SECTIONS = ("strengths", "risks", "consequences", "tradeoffs", "city_impact")
AGENT_TOOLS = {"evaluate_scenario", "best_neighbors", "compare_scenarios"}
INDICATOR_WORDS = {
    "S1": ("школ", "детсад", "дошкол", "детск", "садик"),
    "S2": ("поликлин", "первичн", "медпом", "здоров", "медицин"),
}
MEASURE_WORDS = {"M3": ("лрт",), "M13": ("теплосет", "водосет", "сетей")}


def _pair_mentioned(texts: list[str], indicator: str) -> bool:
    return any(
        ("нур" in text or "nura" in text)
        and (indicator.lower() in text or any(word in text for word in INDICATOR_WORDS[indicator]))
        for text in texts
    )


def _lag_mentioned(texts: list[str], measure_id: str) -> bool:
    return any(
        (
            re.search(rf"\b{measure_id.lower()}\b", text)
            or any(word in text for word in MEASURE_WORDS[measure_id])
        )
        and any(word in text for word in ("лаг", "квартал", "задерж"))
        for text in texts
    )


def check_report(name: str, scenario: Scenario, report: AnalysisReport) -> dict:
    """Check only server facts, evaluated alternatives, and visible report text."""
    result = evaluate(scenario)
    facts = build_facts(scenario, result)
    fact_ids = {fact.id for fact in facts}
    claims = [claim for section in CLAIM_SECTIONS for claim in getattr(report, section)]
    evidenced = sum(bool(claim.evidence) and set(claim.evidence) <= fact_ids for claim in claims)
    coverage = evidenced / len(claims) if claims else 0.0
    recommendation_checks = []
    improvement_checks = []
    for recommendation in report.recommendations:
        proposed = Scenario(decisions=recommendation.decisions)
        consistent = recommendation.verified and recommendation.invalid_reason is None
        improves = False
        if validate(proposed).ok:
            actual = evaluate(proposed)
            improves = actual.score > result.score
            consistent = (
                consistent
                and abs(recommendation.score - actual.score) <= 1e-9
                and abs(recommendation.delta - actual.delta) <= 1e-9
                and recommendation.cost == actual.cost
            )
        else:
            consistent = False
        recommendation_checks.append(consistent)
        improvement_checks.append(improves)
    texts = [report.summary, *(claim.text for claim in claims)]
    word_count = sum(len(text.split()) for text in texts) + sum(
        len(rec.change.split()) + len(rec.rationale.split()) for rec in report.recommendations
    )
    texts = [text.lower().replace("м3", "m3").replace("м13", "m13") for text in texts]
    nura_pairs = sorted(
        {pair.indicator for pair in result.critical_pairs.after if pair.district_id == "nura"}
    )
    selected_slow = sorted(
        {decision.measure_id for decision in scenario.decisions} & MEASURE_WORDS.keys()
    )
    missing_pairs = [indicator for indicator in nura_pairs if not _pair_mentioned(texts, indicator)]
    missing_lags = [
        measure_id for measure_id in selected_slow if not _lag_mentioned(texts, measure_id)
    ]
    agent_steps = [
        step
        for step in report.trace
        if step.kind == "agent" and step.tool in AGENT_TOOLS and step.ok
    ]
    executor = ToolExecutor()
    replayed = []
    for step in agent_steps:
        output = executor.execute(step.tool, step.input)
        if "error" not in output and output.get("ok") is not False:
            replayed.append(output)
    # Report counters and tool success labels are not evidence. Recalculate
    # numbers from facts and fresh engine outputs, keeping the original report
    # and the recommendation consistency checks above untouched.
    checked_numbers = guard_report(report, facts, tool_results=replayed).verified_numbers
    checks = {
        "text_under_300_words": word_count <= 300,
        "recommendations_verified": all(recommendation_checks),
        "recommendations_improve_score": all(improvement_checks),
        "evidence_coverage": coverage >= 0.9,
        "sections_populated": all(getattr(report, section) for section in CLAIM_SECTIONS),
        "decimal_numbers_verified": (
            not checked_numbers.unverified and checked_numbers.total == checked_numbers.confirmed
        ),
        "nura_critical_pairs_mentioned": not missing_pairs,
        "selected_long_lags_mentioned": not missing_lags,
        "agent_used_engine_tools": report.provider not in {"llm", "cache"} or bool(replayed),
    }
    return {
        "name": name,
        "scenario_id": scenario_id(scenario),
        "scenario": scenario.model_dump(),
        "data_hash": result.data_hash,
        "engine_version": ENGINE_VERSION,
        "model": report.model,
        "prompt_version": report.prompt_version,
        "provider": report.provider,
        "passed": all(checks.values()),
        "checks": checks,
        "metrics": {
            "text_words": word_count,
            "recommendations": len(recommendation_checks),
            "recommendations_verified": sum(recommendation_checks),
            "claims": len(claims),
            "claims_with_valid_evidence": evidenced,
            "evidence_coverage": coverage,
            "unverified_decimals": checked_numbers.unverified,
            "decimal_numbers_total": checked_numbers.total,
            "decimal_numbers_confirmed": checked_numbers.confirmed,
            "verification_counters_match": checked_numbers == report.verified_numbers,
            "missing_nura_pairs": missing_pairs,
            "missing_long_lags": missing_lags,
            "agent_tool_steps": len(replayed),
            "invalid_agent_tool_steps": len(agent_steps) - len(replayed),
        },
        "facts": [fact.model_dump() for fact in facts],
        "report": report.model_dump(mode="json"),
    }


def publish_demo(cache: ReportCache, scenario: Scenario, report: AnalysisReport) -> Path:
    """Publish the exact cache envelope from a successful, checked live report."""
    if (
        report.provider != "llm"
        or report.cached
        or not check_report("demo", scenario, report)["passed"]
    ):
        raise ValueError("Демо-кэш требует проверенный живой отчёт с вызовом инструмента")
    cache.put(scenario, report.model, report.prompt_version, report)
    runtime = (
        cache.root / "runtime" / f"{cache_key(scenario, report.model, report.prompt_version)}.json"
    )
    encoded = runtime.read_bytes()
    payload = json.loads(encoded)
    expected_metadata = {
        "data_hash": get_catalog().data_hash,
        "engine_version": ENGINE_VERSION,
        "scenario_id": scenario_id(scenario),
        "model": report.model,
        "prompt_version": report.prompt_version,
    }
    if payload.get("metadata") != expected_metadata or payload.get("report") != report.model_dump(
        mode="json"
    ):
        raise ValueError("Запись runtime-кэша не подтверждена")
    destination = cache.root / "demo" / f"{scenario_id(scenario)}.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(dir=destination.parent, suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return destination


async def run_evaluation(
    settings: Settings,
    *,
    provider: str = "auto",
    output: Path = DEFAULT_OUTPUT,
    warm_demo: bool = False,
    cache: ReportCache | None = None,
) -> list[dict]:
    """Evaluate presets sequentially; persist every completed row immediately."""
    if provider not in {"auto", "rules"}:
        raise ValueError("provider должен быть auto или rules")
    if warm_demo:
        if provider == "rules" or not settings.has_key or not settings.openai_model:
            raise ValueError("--warm-demo требует provider=auto и OPENAI_API_KEY/OPENAI_MODEL")
        settings = replace(settings, ai_cache="0", ai_provider="llm")
    cache = cache if cache is not None else ReportCache()
    semaphore = asyncio.Semaphore(settings.analyze_concurrency)
    rows = []
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="\n") as handle:
        for name in PRESETS:
            scenario = Scenario.model_validate_json(
                (DATA_DIR / "scenarios" / f"{name}.json").read_bytes()
            )
            report = await analyze(scenario, settings, semaphore, provider=provider, cache=cache)
            row = check_report(name, scenario, report)
            if warm_demo:
                row["checks"]["live_llm"] = report.provider == "llm" and not report.cached
                row["checks"]["demo_saved"] = False
                if all(value for key, value in row["checks"].items() if key != "demo_saved"):
                    try:
                        publish_demo(cache, scenario, report)
                        row["checks"]["demo_saved"] = True
                    except OSError, ValueError, TypeError:
                        # Keep the report/checks for diagnosis, without raw exception details.
                        row["metrics"]["demo_write_error"] = True
                row["passed"] = all(row["checks"].values())
            handle.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
            handle.flush()
            rows.append(row)
            status = "PASS" if row["passed"] else "FAIL"
            failed = [key for key, value in row["checks"].items() if not value]
            suffix = f" | {', '.join(failed)}" if failed else ""
            print(f"{name}: {status} | provider={report.provider}{suffix}", flush=True)
    return rows
