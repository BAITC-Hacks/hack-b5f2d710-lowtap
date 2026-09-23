"""Exhaustive valid-plan distribution and exact strict-less percentiles.

Enumeration factors the calculation by district: for a fixed set of measures,
each district's result depends only on the subset assigned there. This reduces
the inner loop from 50 indicator calculations to five table lookups. The slow
test cross-checks this optimization with the public validator and scorer.
"""

import json
from bisect import bisect_left
from collections import Counter
from functools import lru_cache
from heapq import heappush, heapreplace
from itertools import combinations, product
from math import floor
from pathlib import Path

from app.config import DATA_DIR
from app.engine.catalog import Catalog, get_catalog, scenario_id
from app.engine.models import ENGINE_VERSION, Decision, Scenario

DISTRIBUTION_PATH = DATA_DIR / "plan_distribution.json"
SCORE_DIGITS = 10


def _combinations(catalog: Catalog):
    rules = catalog.rules
    for ids in combinations(sorted(catalog.measures), rules["decisions_required"]):
        measures = [catalog.measures[measure_id] for measure_id in ids]
        cost = sum(measure["cost"] for measure in measures)
        if cost > rules["budget"]:
            continue
        if (
            max(Counter(measure["direction"] for measure in measures).values())
            > rules["max_per_direction"]
        ):
            continue
        if any(
            rule["scope"] == "any" and set(rule["pair"]).issubset(ids)
            for rule in rules["incompatibilities"]
        ):
            continue
        yield ids, cost


def _district_tables(catalog: Catalog, ids: tuple[str, ...], local_ids: tuple[str, ...]):
    weights = {item["code"]: item["weight"] for item in catalog.rules["indicators"]}
    horizon = catalog.rules["horizon_quarters"]
    threshold = catalog.rules["critical_threshold"]
    local_bits = {measure_id: 1 << i for i, measure_id in enumerate(local_ids)}
    effects = {
        measure_id: {
            code: effect * (horizon - catalog.measures[measure_id]["lag"]) / horizon
            for code, effect in catalog.measures[measure_id]["effects"].items()
        }
        for measure_id in ids
    }
    synergies = [rule for rule in catalog.rules["synergies"] if set(rule["pair"]).issubset(ids)]
    tables = []
    for district_id in catalog.district_ids:
        table = []
        for mask in range(1 << len(local_ids)):
            indicators = dict(catalog.districts[district_id]["indicators"])
            for measure_id in ids:
                if measure_id not in local_bits or mask & local_bits[measure_id]:
                    for code, effect in effects[measure_id].items():
                        indicators[code] += effect
            for synergy in synergies:
                source_bit = local_bits[synergy["district_from"]]
                if mask & source_bit:
                    indicators[synergy["bonus_indicator"]] += synergy["bonus"]
            clipped = {code: max(0, min(100, value)) for code, value in indicators.items()}
            d = sum(weights[code] * clipped[code] for code in catalog.indicators)
            n_crit = sum(value < threshold for value in clipped.values())
            table.append((d, n_crit))
        tables.append(table)
    return tables


def _decisions(catalog: Catalog, ids: tuple[str, ...], assignments: tuple[int, ...]):
    district_iter = iter(assignments)
    return [
        Decision(
            measure_id=measure_id,
            district=(
                catalog.district_ids[next(district_iter)]
                if catalog.measures[measure_id]["type"] == "district"
                else None
            ),
        )
        for measure_id in ids
    ]


def iter_scored_plans(catalog: Catalog | None = None):
    """Yield (score, cost, n_crit, measure_ids, district_indices) exactly once per plan."""
    catalog = catalog or get_catalog()
    district_count = len(catalog.district_ids)
    population = [catalog.districts[did]["pop_share"] for did in catalog.district_ids]
    formula = catalog.rules["score"]
    for ids, cost in _combinations(catalog):
        local_ids = tuple(mid for mid in ids if catalog.measures[mid]["type"] == "district")
        tables = _district_tables(catalog, ids, local_ids)
        conflicts = [
            (local_ids.index(rule["pair"][0]), local_ids.index(rule["pair"][1]))
            for rule in catalog.rules["incompatibilities"]
            if rule["scope"] == "same_district" and set(rule["pair"]).issubset(ids)
        ]
        for assignments in product(range(district_count), repeat=len(local_ids)):
            if any(assignments[left] == assignments[right] for left, right in conflicts):
                continue
            masks = [0] * district_count
            for i, district in enumerate(assignments):
                masks[district] |= 1 << i
            district_states = [table[mask] for table, mask in zip(tables, masks, strict=True)]
            d_avg = sum(
                pop * item[0] for pop, item in zip(population, district_states, strict=True)
            )
            n_crit = sum(item[1] for item in district_states)
            score = (
                formula["d_avg_weight"] * d_avg
                + formula["min_weight"] * min(item[0] for item in district_states)
                - formula["crit_penalty"] * n_crit
            )
            yield round(score, SCORE_DIGITS), cost, n_crit, ids, assignments


def enumerate_distribution(catalog: Catalog | None = None) -> dict:
    """Build the reproducible distribution, including an exact score-frequency CDF."""
    from app.engine.scoring import score_decisions

    catalog = catalog or get_catalog()
    counts: Counter[float] = Counter()
    top = []
    for ordinal, (score, cost, n_crit, ids, assignments) in enumerate(iter_scored_plans(catalog)):
        counts[score] += 1
        item = (score, -ordinal, cost, n_crit, ids, assignments)
        if len(top) < 20:
            heappush(top, item)
        elif item > top[0]:
            heapreplace(top, item)
    if not counts:
        raise ValueError("Каталог не содержит допустимых планов")
    scores = sorted(counts)
    cumulative = []
    count = 0
    for score in scores:
        count += counts[score]
        cumulative.append(count)

    def at_rank(rank: int) -> float:
        return scores[bisect_left(cumulative, rank + 1)]

    quantiles = []
    for i in range(1000):
        rank = i * (count - 1) / 999
        lower = floor(rank)
        fraction = rank - lower
        quantiles.append(
            round(
                at_rank(lower) * (1 - fraction) + at_rank(min(lower + 1, count - 1)) * fraction, 10
            )
        )
    bin_counts: Counter[int] = Counter()
    for score, frequency in counts.items():
        bin_counts[floor(round(score * 20, 8))] += frequency
    bins = [
        {"start": index / 20, "end": (index + 1) / 20, "count": bin_counts[index]}
        for index in range(min(bin_counts), max(bin_counts) + 1)
    ]
    top20 = []
    for score, _, cost, n_crit, ids, assignments in sorted(top, reverse=True):
        decisions = _decisions(catalog, ids, assignments)
        top20.append(
            {
                "score": score,
                "cost": cost,
                "n_crit": n_crit,
                "scenario_id": scenario_id(Scenario(decisions=decisions)),
                "decisions": [decision.model_dump() for decision in decisions],
            }
        )
    # The rules' 52.558 is rounded for display. Counts need the exact 52.55768.
    baseline = round(score_decisions([], catalog=catalog).score, SCORE_DIGITS)
    return {
        "data_hash": catalog.data_hash,
        "engine_version": ENGINE_VERSION,
        "count": count,
        "baseline": baseline,
        "worse_than_baseline": sum(
            frequency for score, frequency in counts.items() if score < baseline
        ),
        "best": scores[-1],
        "worst": scores[0],
        "quantile_definition": "linear interpolation at p=i/999, i=0..999",
        "quantiles": quantiles,
        "bin_width": 0.05,
        "bins": bins,
        "top20": top20,
        "score_digits": SCORE_DIGITS,
        "score_counts": [[score, counts[score]] for score in scores],
    }


def write_distribution(path: Path = DISTRIBUTION_PATH, catalog: Catalog | None = None) -> dict:
    distribution = enumerate_distribution(catalog)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(distribution, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    _load_cached.cache_clear()
    return distribution


@lru_cache(maxsize=4)
def _load_cached(path: str, mtime_ns: int, expected_hash: str):
    del mtime_ns  # Included in the cache key so regeneration is visible immediately.
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("data_hash") != expected_hash or data.get("engine_version") != ENGINE_VERSION:
        raise ValueError("Распределение устарело: запустите scripts/enumerate_plans.py")
    scores, cumulative = [], [0]
    for score, frequency in data["score_counts"]:
        scores.append(score)
        cumulative.append(cumulative[-1] + frequency)
    if cumulative[-1] != data["count"]:
        raise ValueError("Некорректное число планов в распределении")
    return data, scores, cumulative


def load_distribution(catalog: Catalog | None = None, path: Path | None = None) -> dict | None:
    catalog = catalog or get_catalog()
    path = path or DISTRIBUTION_PATH
    if not path.exists():
        return None
    return _load_cached(str(path), path.stat().st_mtime_ns, catalog.data_hash)[0]


def percentile(score: float, catalog: Catalog | None = None) -> float | None:
    """Percentage strictly below score, resolving floating point ties at 10 decimals."""
    catalog = catalog or get_catalog()
    if not DISTRIBUTION_PATH.exists():
        return None
    data, scores, cumulative = _load_cached(
        str(DISTRIBUTION_PATH), DISTRIBUTION_PATH.stat().st_mtime_ns, catalog.data_hash
    )
    index = bisect_left(scores, round(score, SCORE_DIGITS))
    return 100 * cumulative[index] / data["count"]
