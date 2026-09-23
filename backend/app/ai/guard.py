"""Recompute recommendations and check report evidence after every provider."""

import re
from bisect import bisect_left
from collections.abc import Iterator
from math import isfinite
from typing import Any

from app.engine.catalog import Catalog, get_catalog
from app.engine.models import AnalysisReport, Fact, Scenario, VerifiedNumbers
from app.engine.scoring import evaluate
from app.engine.validator import validate

CLAIM_SECTIONS = ("strengths", "risks", "consequences", "tradeoffs", "city_impact")
# Consume complete decimal tokens so 57.777 can never become a match for 57.77.
# IDs, dates, versions and scientific notation are outside this decimal contract.
DECIMAL = re.compile(r"(?<![\w.,+−\-–])[+−\-–]?\d+[.,](\d+)(?!\w|[.,]\d)")
TOLERANCE = 0.005 + 1e-9


def _numbers(value: Any) -> Iterator[float]:
    """Read numeric JSON values only; never treat free-form text as evidence."""
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        number = float(value)
        if isfinite(number):
            yield number
    elif isinstance(value, dict):
        for item in value.values():
            yield from _numbers(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _numbers(item)


def _matches(value: float, trusted: list[float]) -> bool:
    index = bisect_left(trusted, value)
    return any(abs(value - item) <= TOLERANCE for item in trusted[max(0, index - 1) : index + 1])


def guard_report(
    report: AnalysisReport,
    facts: list[Fact],
    catalog: Catalog | None = None,
    tool_results: list[dict] | None = None,
) -> AnalysisReport:
    """Return a guarded copy without discarding claims or blocking the report.

    ``tool_results`` must be outputs captured by the server when it executes
    tools, never values copied from the model's trace or other report fields.
    Recommendation numbers become evidence only after server recomputation.

    Counts refer to decimal occurrences in user-facing text. ``unverified``
    contains distinct original tokens in encounter order. More than two decimal
    places violates the report format and is always unverified, even if a value
    happens to exist in the facts. Integer literals and metadata are not checked.
    """
    catalog = catalog or get_catalog()
    guarded = report.model_copy(deep=True)
    known_ids = {fact.id for fact in facts}
    trusted_values = set(_numbers([fact.value for fact in facts]))
    # Fixed task constants include the budget, horizon, score and indicator
    # weights; population shares are the other constants allowed by the spec.
    trusted_values.update(_numbers(catalog.rules))
    trusted_values.update(_numbers([item["pop_share"] for item in catalog.districts.values()]))
    trusted_values.update(_numbers(tool_results or []))

    for recommendation in guarded.recommendations:
        scenario = Scenario(decisions=recommendation.decisions)
        validation = validate(scenario, catalog=catalog)
        if validation.ok:
            evaluated = evaluate(scenario, catalog=catalog)
            recommendation.score = evaluated.score
            recommendation.delta = evaluated.delta
            recommendation.cost = evaluated.cost
            recommendation.verified = True
            recommendation.invalid_reason = None
            trusted_values.update(_numbers(evaluated.model_dump()))
        else:
            recommendation.score = 0.0
            recommendation.delta = 0.0
            recommendation.cost = 0
            recommendation.verified = False
            recommendation.invalid_reason = "; ".join(
                f"{violation.code}: {violation.message}" for violation in validation.violations
            )

    texts = [guarded.summary]
    for section in CLAIM_SECTIONS:
        for claim in getattr(guarded, section):
            claim.evidence = [fact_id for fact_id in claim.evidence if fact_id in known_ids]
            texts.append(claim.text)
    for recommendation in guarded.recommendations:
        texts.extend((recommendation.change, recommendation.rationale))

    trusted = sorted(trusted_values)
    total = confirmed = 0
    unverified = []
    seen_unverified = set()
    for text in texts:
        for token in DECIMAL.finditer(text):
            total += 1
            original = token.group()
            normalized = original.replace(",", ".").replace("−", "-").replace("–", "-")
            if len(token.group(1)) <= 2 and _matches(float(normalized), trusted):
                confirmed += 1
            elif original not in seen_unverified:
                unverified.append(original)
                seen_unverified.add(original)
    guarded.verified_numbers = VerifiedNumbers(
        total=total, confirmed=confirmed, unverified=unverified
    )
    return guarded
