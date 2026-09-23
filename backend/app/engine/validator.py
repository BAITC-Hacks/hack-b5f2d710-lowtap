"""Collect every semantic violation before any official scoring."""

from collections import defaultdict

from app.engine.catalog import Catalog, get_catalog
from app.engine.models import Scenario, ValidationResult, Violation


def validate(
    scenario: Scenario, catalog: Catalog | None = None, *, allow_partial: bool = False
) -> ValidationResult:
    catalog = catalog or get_catalog()
    rules = catalog.rules
    violations = []

    def add(code: str, message: str, measures: list[str], idx: int | None = None) -> None:
        violations.append(
            Violation(code=code, message=message, decision_idx=idx, measures=measures)
        )

    count = len(scenario.decisions)
    required = rules["decisions_required"]
    if count > required or (not allow_partial and count != required):
        add("NOT_FIVE", f"Нужно ровно {required} решений; получено {count}.", [])

    seen = set()
    known = {}
    directions = defaultdict(set)
    cost = 0
    for idx, decision in enumerate(scenario.decisions):
        mid, district = decision.measure_id, decision.district
        if mid in seen:
            add("DUPLICATE", f"Мера {mid} выбрана повторно.", [mid], idx)
        seen.add(mid)
        measure = catalog.measures.get(mid)
        if measure is None:
            add("UNKNOWN_MEASURE", f"Неизвестная мера {mid}.", [mid], idx)
        if district is not None and district not in catalog.districts:
            add("UNKNOWN_DISTRICT", f"Неизвестный район «{district}».", [mid], idx)
        if measure is None:
            continue
        known.setdefault(mid, []).append(decision)
        directions[measure["direction"]].add(mid)
        cost += measure["cost"]
        if measure["type"] == "district" and district is None:
            add("DISTRICT_REQUIRED", f"Для меры {mid} нужно выбрать район.", [mid], idx)
        elif measure["type"] == "city" and district is not None:
            add(
                "DISTRICT_FORBIDDEN",
                f"Мера {mid} действует на весь город: район запрещён.",
                [mid],
                idx,
            )

    for direction, measure_ids in sorted(directions.items()):
        if len(measure_ids) > rules["max_per_direction"]:
            add(
                "DIRECTION_LIMIT",
                f"В направлении {direction} выбрано больше {rules['max_per_direction']} мер.",
                sorted(measure_ids, key=lambda mid: int(mid[1:])),
            )

    for incompatibility in rules["incompatibilities"]:
        first, second = incompatibility["pair"]
        if first not in known or second not in known:
            continue
        same_district = any(
            a.district in catalog.districts and a.district == b.district
            for a in known[first]
            for b in known[second]
        )
        if incompatibility["scope"] == "any" or same_district:
            add(
                incompatibility["code"],
                f"Меры {first} и {second} несовместимы: {incompatibility['reason_ru']}.",
                [first, second],
            )
    if cost > rules["budget"]:
        add(
            "BUDGET_EXCEEDED",
            f"Бюджет {rules['budget']} у.е.: превышение на {cost - rules['budget']} у.е.",
            sorted(known, key=lambda mid: int(mid[1:])),
        )
    return ValidationResult(ok=not violations, violations=violations)
