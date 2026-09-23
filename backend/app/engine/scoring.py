"""Deterministic scoring, timeline and scenario evaluation from the frozen rules."""

from dataclasses import dataclass

from app.engine.catalog import Catalog, canonical_decisions, get_catalog, scenario_id
from app.engine.models import (
    ENGINE_VERSION,
    Components,
    CriticalPair,
    CriticalPairs,
    Decision,
    DistrictResult,
    EvalResult,
    MinDistrict,
    Scenario,
    SynergyTriggered,
    TimelinePoint,
    ValidationResult,
    WaterfallItem,
)
from app.engine.validator import validate


@dataclass(slots=True)
class ScoreState:
    """The small, internal result used for subsets and search candidates."""

    score: float
    d_avg: float
    d: dict[str, float]
    indicators: dict[str, dict[str, float]]
    n_crit: int
    synergies: list[SynergyTriggered]


class InvalidScenario(ValueError):
    """A structurally correct request that violates one or more game rules."""

    def __init__(self, validation: ValidationResult) -> None:
        self.validation = validation
        self.violations = validation.violations
        super().__init__("; ".join(item.message for item in self.violations))


def clip(value: float) -> float:
    """Clamp an indicator only after all effects and synergies are added."""
    return max(0.0, min(100.0, value))


def score_decisions(
    decisions: list[Decision], catalog: Catalog | None = None, q: int = 8
) -> ScoreState:
    """Score validated decisions or their subsets, without enforcing the count.

    Subsets are necessary for Shapley attribution. Public callers must validate
    complete scenarios before using this primitive. Rounding to ten decimals
    removes binary floating-point noise for distribution ties without rounding
    away the model's precision to the three decimals used in the UI.
    """
    catalog = catalog or get_catalog()
    horizon = catalog.rules["horizon_quarters"]
    if not isinstance(q, int) or not 0 <= q <= horizon:
        raise ValueError(f"Quarter must be an integer from 0 to {horizon}")

    indicators = {
        district_id: {key: float(district["indicators"][key]) for key in catalog.indicators}
        for district_id, district in catalog.districts.items()
    }
    ordered = canonical_decisions(decisions)
    selected = {decision.measure_id: decision for decision in ordered}
    for decision in ordered:
        measure = catalog.measures[decision.measure_id]
        fraction = max(0, q - measure["lag"]) / horizon
        targets = catalog.district_ids if measure["type"] == "city" else (decision.district,)
        for district_id in targets:
            for indicator, effect in measure["effects"].items():
                indicators[district_id][indicator] += effect * fraction

    synergies = []
    for synergy in catalog.rules["synergies"]:
        pair = synergy["pair"]
        if not all(measure_id in selected for measure_id in pair):
            continue
        first_quarter = max(catalog.measures[mid]["lag"] for mid in pair) + 1
        if q < first_quarter:
            continue
        district_id = selected[synergy["district_from"]].district
        indicator = synergy["bonus_indicator"]
        indicators[district_id][indicator] += synergy["bonus"]
        synergies.append(
            SynergyTriggered(
                pair=pair,
                district_id=district_id,
                indicator=indicator,
                bonus=synergy["bonus"],
            )
        )

    weights = {indicator["code"]: indicator["weight"] for indicator in catalog.rules["indicators"]}
    threshold = catalog.rules["critical_threshold"]
    n_crit = 0
    d = {}
    for district_id, values in indicators.items():
        for indicator, value in values.items():
            values[indicator] = clip(value)
            n_crit += values[indicator] < threshold
        d[district_id] = round(sum(weights[key] * value for key, value in values.items()), 10)
    d_avg = round(
        sum(catalog.districts[key]["pop_share"] * value for key, value in d.items()),
        10,
    )
    formula = catalog.rules["score"]
    score = round(
        formula["d_avg_weight"] * d_avg
        + formula["min_weight"] * min(d.values())
        - formula["crit_penalty"] * n_crit,
        10,
    )
    return ScoreState(score, d_avg, d, indicators, n_crit, synergies)


def _critical_pairs(state: ScoreState, threshold: float) -> list[CriticalPair]:
    return [
        CriticalPair(district_id=district_id, indicator=key, value=value)
        for district_id, indicators in state.indicators.items()
        for key, value in indicators.items()
        if value < threshold
    ]


def evaluate(
    scenario: Scenario, catalog: Catalog | None = None, *, allow_partial: bool = False
) -> EvalResult:
    """Validate before computing the complete public result, with no LLM calls."""
    # Keep the scalar scorer usable by attribution without an import cycle.
    from app.engine.attribution import attribute
    from app.engine.distribution import percentile

    catalog = catalog or get_catalog()
    validation = validate(scenario, catalog, allow_partial=allow_partial)
    if not validation.ok:
        raise InvalidScenario(validation)

    decisions = canonical_decisions(scenario.decisions)
    base = score_decisions([], catalog)
    final = score_decisions(decisions, catalog)
    contributions = attribute(decisions, catalog)
    cost = sum(catalog.measures[item.measure_id]["cost"] for item in decisions)
    minimum_id = min(final.d, key=final.d.__getitem__)
    before = _critical_pairs(base, catalog.rules["critical_threshold"])
    after = _critical_pairs(final, catalog.rules["critical_threshold"])
    before_keys = {(pair.district_id, pair.indicator) for pair in before}
    after_keys = {(pair.district_id, pair.indicator) for pair in after}
    formula = catalog.rules["score"]

    return EvalResult(
        ok=True,
        scenario_id=scenario_id(scenario),
        score=final.score,
        baseline=base.score,
        delta=round(final.score - base.score, 10),
        percentile=percentile(final.score, catalog),
        cost=cost,
        remaining=catalog.rules["budget"] - cost,
        d_avg=final.d_avg,
        min_district=MinDistrict(
            id=minimum_id,
            name_ru=catalog.districts[minimum_id]["name_ru"],
            d=final.d[minimum_id],
        ),
        n_crit=final.n_crit,
        components=Components(
            d_avg_term=round(formula["d_avg_weight"] * final.d_avg, 10),
            min_term=round(formula["min_weight"] * final.d[minimum_id], 10),
            crit_term=-formula["crit_penalty"] * final.n_crit,
            d_avg_term_base=round(formula["d_avg_weight"] * base.d_avg, 10),
            min_term_base=round(formula["min_weight"] * min(base.d.values()), 10),
            crit_term_base=-formula["crit_penalty"] * base.n_crit,
        ),
        critical_pairs=CriticalPairs(
            before=before,
            after=after,
            closed=[
                pair for pair in before if (pair.district_id, pair.indicator) not in after_keys
            ],
            new=[pair for pair in after if (pair.district_id, pair.indicator) not in before_keys],
        ),
        districts={
            district_id: DistrictResult(
                d_before=base.d[district_id],
                d_after=final.d[district_id],
                delta=round(final.d[district_id] - base.d[district_id], 10),
                indicators_before=base.indicators[district_id],
                indicators_after=final.indicators[district_id],
                deltas={
                    key: round(
                        final.indicators[district_id][key] - base.indicators[district_id][key],
                        10,
                    )
                    for key in catalog.indicators
                },
            )
            for district_id in catalog.district_ids
        },
        contributions=contributions,
        waterfall=[
            WaterfallItem(
                label=catalog.measures[decision.measure_id]["name_ru"],
                measure_id=decision.measure_id,
                delta=contributions[decision.measure_id].shapley,
            )
            for decision in sorted(decisions, key=lambda item: int(item.measure_id[1:]))
        ],
        synergies_triggered=final.synergies,
        timeline=[
            TimelinePoint(q=q, score=state.score, n_crit=state.n_crit, d=state.d)
            for q in range(catalog.rules["horizon_quarters"] + 1)
            for state in [score_decisions(decisions, catalog, q=q)]
        ],
        data_hash=catalog.data_hash,
        engine_version=ENGINE_VERSION,
    )
