"""Exact Shapley and leave-one-out contributions to the complete Score."""

from math import factorial, fsum

from app.engine.catalog import Catalog, canonical_decisions, get_catalog
from app.engine.models import Contribution, Decision
from app.engine.scoring import score_decisions


def attribute(decisions: list[Decision], catalog: Catalog | None = None) -> dict[str, Contribution]:
    """Evaluate all 2**n subsets, including nonlinear critical penalties.

    Callers supply validated decisions. The empty subset has the actual baseline
    Score, and a synergy occurs only in subsets containing both of its measures.
    For a full five-decision scenario, exactly 32 subsets are scored once each.
    """
    catalog = catalog or get_catalog()
    decisions = canonical_decisions(decisions)
    n = len(decisions)
    if not n:
        return {}
    scores = [
        score_decisions(
            [decision for i, decision in enumerate(decisions) if mask & (1 << i)],
            catalog,
        ).score
        for mask in range(1 << n)
    ]
    full_mask = (1 << n) - 1
    weights = [factorial(k) * factorial(n - k - 1) / factorial(n) for k in range(n)]
    result = {}
    for i, decision in enumerate(decisions):
        bit = 1 << i
        shapley = fsum(
            weights[mask.bit_count()] * (scores[mask | bit] - scores[mask])
            for mask in range(1 << n)
            if not mask & bit
        )
        result[decision.measure_id] = Contribution(
            shapley=shapley,
            loo=round(scores[full_mask] - scores[full_mask ^ bit], 10),
            per_unit=shapley / catalog.measures[decision.measure_id]["cost"],
        )
    return result
