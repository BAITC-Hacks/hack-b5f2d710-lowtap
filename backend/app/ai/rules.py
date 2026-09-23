"""Russian explanations backed by engine facts, with no network or LLM calls."""

from time import perf_counter

from app.ai.base import RULES_PROMPT_VERSION
from app.engine.catalog import Catalog, get_catalog
from app.engine.models import (
    AnalysisReport,
    Claim,
    Decision,
    EvalResult,
    Fact,
    Recommendation,
    Scenario,
    TraceStep,
    VerifiedNumbers,
)
from app.engine.scoring import evaluate
from app.engine.search import best_neighbors


class RuleBasedExplainer:
    """A deterministic report with the same evidence contract as an AI provider."""

    def explain(
        self,
        scenario: Scenario,
        result: EvalResult,
        facts: list[Fact],
        catalog: Catalog | None = None,
    ) -> AnalysisReport:
        catalog = catalog or get_catalog()
        by_key = {fact.key: fact for fact in facts}

        def number(key: str, *, signed: bool = False) -> str:
            return format(by_key[key].value, "+.2f" if signed else ".2f")

        def claim(text: str, *keys: str) -> Claim:
            return Claim(text=text, evidence=list(dict.fromkeys(by_key[key].id for key in keys)))

        strengths = []
        ranked_measures = sorted(
            result.contributions,
            key=lambda mid: (-result.contributions[mid].shapley, int(mid[1:])),
        )
        for mid in ranked_measures[:3]:
            key = f"measure.{mid}.shapley"
            if by_key[key].value > 0:
                strengths.append(claim(f"{mid}: вклад в Score {number(key, signed=True)}.", key))
        if result.critical_pairs.closed:
            keys = [
                f"critical.closed.{pair.district_id}.{pair.indicator}"
                for pair in result.critical_pairs.closed
            ]
            labels = [
                f"{catalog.districts[pair.district_id]['name_ru']} {pair.indicator}"
                for pair in result.critical_pairs.closed
            ]
            strengths.append(claim(f"Сняты критические показатели: {', '.join(labels)}.", *keys))
        if not strengths:
            strengths.append(claim(f"План укладывается в бюджет: {number('cost')} у.е.", "cost"))

        risks = []
        if result.critical_pairs.after:
            keys = [
                f"critical.after.{pair.district_id}.{pair.indicator}"
                for pair in result.critical_pairs.after
            ]
            labels = [
                f"{catalog.districts[pair.district_id]['name_ru']} {pair.indicator}={number(key)}"
                for pair, key in zip(result.critical_pairs.after, keys, strict=True)
            ]
            risks.append(claim(f"Критические показатели после мер: {'; '.join(labels)}.", *keys))
        slow_measures = sorted(
            (
                decision.measure_id
                for decision in scenario.decisions
                if catalog.measures[decision.measure_id]["lag"] >= 3
            ),
            key=lambda mid: int(mid[1:]),
        )
        if slow_measures:
            keys = []
            labels = []
            for mid in slow_measures:
                lag, fraction = f"measure.{mid}.lag", f"measure.{mid}.effect_fraction"
                keys.extend((lag, fraction))
                labels.append(f"{mid}: лаг {number(lag)} квартала, доля эффекта {number(fraction)}")
            risks.append(claim(f"К концу горизонта эффект неполный: {'; '.join(labels)}.", *keys))
        if not risks:
            risks.append(
                claim(
                    f"Самый низкий индекс сохраняется в районе {result.min_district.name_ru}: "
                    f"{number('min_district.d')}.",
                    "min_district.d",
                )
            )

        changed_districts = sorted(
            result.districts,
            key=lambda did: (-abs(result.districts[did].delta), did),
        )
        consequences = []
        for did in changed_districts[:2]:
            before, after = f"district.{did}.d_before", f"district.{did}.d_after"
            consequences.append(
                claim(
                    f"{catalog.districts[did]['name_ru']}: "
                    f"индекс {number(before)} → {number(after)}.",
                    before,
                    after,
                )
            )

        concentrated = max(
            catalog.district_ids,
            key=lambda did: abs(by_key[f"district.{did}.budget_population_gap"].value),
        )
        spending = f"district.{concentrated}.budget_share"
        population = f"district.{concentrated}.population_share"
        tradeoffs = [
            claim(
                f"{catalog.districts[concentrated]['name_ru']}: прямые расходы {number(spending)}% "
                f"затрат при доле жителей {number(population)}%; "
                "городские меры учитываются отдельно.",
                spending,
                population,
            )
        ]
        missed = next((fact for fact in facts if fact.key.startswith("synergy.missed.")), None)
        if missed:
            tradeoffs.append(claim(missed.text_ru, missed.key))
        else:
            tradeoffs.append(
                claim(f"Остаток бюджета {number('remaining')} у.е. не повышает Score.", "remaining")
            )

        city_impact = []
        if result.critical_pairs.closed:
            key = "critical.closed.population_share"
            city_impact.append(
                claim(
                    f"В районах с {number(key)}% жителей снят хотя бы один критический показатель.",
                    key,
                )
            )
        changes = [
            (delta, did, indicator)
            for did, district in result.districts.items()
            for indicator, delta in district.deltas.items()
            if delta > 0
        ]
        if changes:
            _, did, indicator = max(changes)
            key = f"district.{did}.{indicator}.after"
            indicator_name = next(
                item["name_ru"] for item in catalog.rules["indicators"] if item["code"] == indicator
            )
            city_impact.append(
                claim(
                    f"{catalog.districts[did]['name_ru']}: показатель «{indicator_name}» "
                    f"вырос до {number(key)} балла по модели.",
                    key,
                    f"district.{did}.{indicator}.delta",
                )
            )
        if not city_impact:
            city_impact.append(claim(f"Индекс города по модели: {number('d_avg')}.", "d_avg"))

        started = perf_counter()
        candidates = best_neighbors(scenario, objective="score", k=3, catalog=catalog)
        recommendations = []
        original = {(decision.measure_id, decision.district) for decision in scenario.decisions}

        def label(decision: Decision) -> str:
            target = (
                catalog.districts[decision.district]["name_ru"]
                if decision.district
                else "весь город"
            )
            return f"{decision.measure_id} ({target})"

        for candidate in candidates:
            if candidate.score <= result.score:
                continue
            alternative = Scenario(decisions=candidate.decisions)
            verified = evaluate(alternative, catalog=catalog)
            replacement = {
                (decision.measure_id, decision.district) for decision in candidate.decisions
            }
            removed = next(
                item
                for item in scenario.decisions
                if (item.measure_id, item.district) not in replacement
            )
            added = next(
                item
                for item in candidate.decisions
                if (item.measure_id, item.district) not in original
            )
            recommendations.append(
                Recommendation(
                    change=f"{label(removed)} → {label(added)}.",
                    decisions=candidate.decisions,
                    rationale="Score выше исходного; все ограничения проверены движком.",
                    score=verified.score,
                    delta=verified.delta,
                    cost=verified.cost,
                    verified=True,
                    invalid_reason=None,
                )
            )

        trace = TraceStep(
            n=1,
            kind="server",
            tool="best_neighbors",
            input={**scenario.model_dump(), "objective": "score", "k": 3},
            output_summary=f"Проверены альтернативы; улучшений: {len(recommendations)}.",
            ms=round((perf_counter() - started) * 1000, 3),
            ok=True,
        )
        return AnalysisReport(
            summary=(
                f"Score {number('score')}, изменение к базе {number('delta', signed=True)}; "
                f"расходы {number('cost')} у.е."
            ),
            strengths=strengths,
            risks=risks,
            consequences=consequences,
            tradeoffs=tradeoffs,
            city_impact=city_impact,
            recommendations=recommendations,
            provider="rules",
            model="",
            prompt_version=RULES_PROMPT_VERSION,
            trace=[trace],
            verified_numbers=VerifiedNumbers(total=0, confirmed=0, unverified=[]),
            cached=False,
        )
