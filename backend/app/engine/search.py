"""Deterministic, validated one-decision alternatives for recommendations."""

from typing import Literal

from app.engine.catalog import Catalog, canonical_decisions, get_catalog, scenario_id
from app.engine.models import Decision, MinDistrict, Neighbor, Scenario
from app.engine.scoring import score_decisions
from app.engine.validator import validate

Objective = Literal["score", "zero_crit", "min_district", "budget_cap"]


def neighbors(scenario: Scenario, catalog: Catalog | None = None) -> list[Scenario]:
    """Replace one decision, including changing its district, and validate each result."""
    catalog = catalog or get_catalog()
    decisions = canonical_decisions(scenario.decisions)
    seen: set[tuple[tuple[str, str], ...]] = set()
    original = tuple((item.measure_id, item.district or "") for item in decisions)
    alternatives: list[Scenario] = []
    for index in range(len(decisions)):
        remaining_ids = {item.measure_id for i, item in enumerate(decisions) if i != index}
        for measure_id, measure in sorted(catalog.measures.items()):
            if measure_id in remaining_ids:
                continue
            districts = catalog.district_ids if measure["type"] == "district" else (None,)
            for district in districts:
                candidate = decisions.copy()
                candidate[index] = Decision(measure_id=measure_id, district=district)
                candidate = canonical_decisions(candidate)
                key = tuple((item.measure_id, item.district or "") for item in candidate)
                if key == original or key in seen:
                    continue
                seen.add(key)
                replacement = Scenario(decisions=candidate)
                if validate(replacement, catalog=catalog).ok:
                    alternatives.append(replacement)
    return sorted(alternatives, key=lambda item: scenario_id(item))


def best_neighbors(
    scenario: Scenario,
    objective: Objective = "score",
    k: int = 3,
    catalog: Catalog | None = None,
    budget_cap: int | None = None,
) -> list[Neighbor]:
    """Rank valid alternatives without computing their timelines or Shapley values.

    ``zero_crit`` minimizes remaining critical pairs, then maximizes score.
    ``min_district`` maximizes the lowest district score, then the total score.
    ``budget_cap`` maximizes score below the cap (current spend when omitted).
    ``delta`` is relative to the baseline, matching the evaluation contract.
    """
    if objective not in {"score", "zero_crit", "min_district", "budget_cap"}:
        raise ValueError(f"Неизвестная цель поиска: {objective}")
    if k < 0:
        raise ValueError("k должно быть неотрицательным")
    if k == 0:
        return []
    catalog = catalog or get_catalog()
    if not validate(scenario, catalog=catalog).ok:
        raise ValueError("Для поиска нужен валидный исходный сценарий")
    if budget_cap is None:
        budget_cap = sum(catalog.measures[item.measure_id]["cost"] for item in scenario.decisions)
    baseline = score_decisions([], catalog=catalog).score
    results = []
    for alternative in neighbors(scenario, catalog=catalog):
        cost = sum(catalog.measures[item.measure_id]["cost"] for item in alternative.decisions)
        if objective == "budget_cap" and cost > budget_cap:
            continue
        state = score_decisions(alternative.decisions, catalog=catalog)
        minimum_id = min(catalog.district_ids, key=lambda district: state.d[district])
        results.append(
            Neighbor(
                decisions=alternative.decisions,
                scenario_id=scenario_id(alternative),
                score=state.score,
                delta=state.score - baseline,
                cost=cost,
                n_crit=state.n_crit,
                min_district=MinDistrict(
                    id=minimum_id,
                    name_ru=catalog.districts[minimum_id]["name_ru"],
                    d=state.d[minimum_id],
                ),
            )
        )

    def rank(item: Neighbor) -> tuple:
        common = (-round(item.score, 10), item.cost, item.scenario_id)
        if objective == "zero_crit":
            return (item.n_crit, *common)
        if objective == "min_district":
            return (-round(item.min_district.d, 10), *common)
        return common

    return sorted(results, key=rank)[:k]
