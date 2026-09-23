"""Numeric evidence for explanations; all values come from the engine or catalog."""

from app.engine.catalog import Catalog, get_catalog
from app.engine.models import EvalResult, Fact, Scenario


def build_facts(
    scenario: Scenario, result: EvalResult, catalog: Catalog | None = None
) -> list[Fact]:
    catalog = catalog or get_catalog()
    facts: list[Fact] = []

    def add(key: str, value: float, label: str) -> None:
        facts.append(
            Fact(id=f"F{len(facts) + 1}", key=key, value=value, text_ru=f"{label}: {value:.2f}.")
        )

    for key, label in (
        ("score", "Итоговый Score"),
        ("baseline", "Score без мер"),
        ("delta", "Изменение Score"),
        ("cost", "Стоимость сценария, у.е."),
        ("remaining", "Остаток бюджета, у.е."),
        ("d_avg", "Средневзвешенный индекс районов"),
        ("n_crit", "Число критических пар после мер"),
    ):
        add(key, getattr(result, key), label)
    if result.percentile is not None:
        add("percentile", result.percentile, "Доля допустимых наборов со строго меньшим Score, %")
    add(
        "min_district.d",
        result.min_district.d,
        f"Минимальный индекс: {result.min_district.name_ru}",
    )

    for phase in ("before", "after", "closed", "new"):
        pairs = getattr(result.critical_pairs, phase)
        add(f"critical.{phase}.count", len(pairs), f"Число критических пар ({phase})")
        for pair in pairs:
            name = catalog.districts[pair.district_id]["name_ru"]
            add(
                f"critical.{phase}.{pair.district_id}.{pair.indicator}",
                pair.value,
                f"Критическая пара ({phase}): {name}, {pair.indicator}",
            )

    closed_districts = {pair.district_id for pair in result.critical_pairs.closed}
    add(
        "critical.closed.population_share",
        100 * sum(catalog.districts[did]["pop_share"] for did in closed_districts),
        "Доля населения районов, где снят хотя бы один критический показатель, %",
    )
    selected = {decision.measure_id: decision for decision in scenario.decisions}
    for did, district in catalog.districts.items():
        evaluation = result.districts[did]
        name = district["name_ru"]
        for key, label in (
            ("d_before", "Индекс до мер"),
            ("d_after", "Индекс после мер"),
            ("delta", "Изменение индекса"),
        ):
            add(f"district.{did}.{key}", getattr(evaluation, key), f"{label}: {name}")
        # Every changed indicator is evidence, including small negative side effects.
        for indicator, delta in evaluation.deltas.items():
            if delta:
                for key, value, label in (
                    ("before", evaluation.indicators_before[indicator], "до"),
                    ("after", evaluation.indicators_after[indicator], "после"),
                    ("delta", delta, "изменение"),
                ):
                    add(f"district.{did}.{indicator}.{key}", value, f"{name}, {indicator}, {label}")
        direct_cost = sum(
            catalog.measures[decision.measure_id]["cost"]
            for decision in scenario.decisions
            if decision.district == did
        )
        budget_share = 100 * direct_cost / result.cost if result.cost else 0.0
        pop_share = 100 * district["pop_share"]
        add(f"district.{did}.cost_direct", direct_cost, f"Районные меры: {name}, у.е.")
        add(f"district.{did}.budget_share", budget_share, f"Прямые расходы на {name} от затрат, %")
        add(f"district.{did}.population_share", pop_share, f"Доля населения: {name}, %")
        add(
            f"district.{did}.budget_population_gap",
            budget_share - pop_share,
            f"Прямые расходы минус доля населения: {name}, п.п.; городские меры отдельно",
        )

    horizon = catalog.rules["horizon_quarters"]
    city_cost = 0
    for mid in sorted(selected, key=lambda value: int(value[1:])):
        measure = catalog.measures[mid]
        contribution = result.contributions[mid]
        district_id = selected[mid].district
        target = (
            f"{district_id} ({catalog.districts[district_id]['name_ru']})"
            if district_id
            else "весь город (district=null)"
        )
        if measure["type"] == "city":
            city_cost += measure["cost"]
        for key, value, label in (
            ("cost", measure["cost"], "Стоимость, у.е."),
            ("lag", measure["lag"], "Лаг, кварталов"),
            ("effect_fraction", (horizon - measure["lag"]) / horizon, "Реализованная доля эффекта"),
            ("shapley", contribution.shapley, "Вклад Шепли в Score"),
            ("loo", contribution.loo, "Потеря Score при удалении меры"),
            ("per_unit", contribution.per_unit, "Вклад Шепли на у.е."),
        ):
            add(f"measure.{mid}.{key}", value, f"{mid}, {target}: {label}")
    add("city.cost", city_cost, "Стоимость общегородских мер, у.е.")
    add(
        "city.budget_share",
        100 * city_cost / result.cost if result.cost else 0.0,
        "Доля общегородских мер в затратах, %",
    )

    for synergy in catalog.rules["synergies"]:
        pair = synergy["pair"]
        present = [mid for mid in pair if mid in selected]
        if not present:
            continue
        phase = "triggered" if len(present) == 2 else "missed"
        anchor = selected.get(synergy["district_from"])
        district_label = (
            catalog.districts[anchor.district]["name_ru"]
            if anchor
            else f"район меры {synergy['district_from']} (мера не выбрана)"
        )
        label = "Сработавшая синергия" if phase == "triggered" else "Неиспользованная синергия"
        add(
            f"synergy.{phase}.{'+'.join(pair)}.{synergy['bonus_indicator']}",
            synergy["bonus"],
            f"{label} {'+'.join(pair)}, {district_label}, бонус {synergy['bonus_indicator']}",
        )
    return facts
