"""Versioned Russian prompts containing only frozen catalog data and engine facts."""

import json

from app.engine.catalog import Catalog, get_catalog
from app.engine.models import Fact

PROMPT_VERSION = "2.2.0"


def build_prompts(facts: list[Fact], catalog: Catalog | None = None) -> tuple[str, str]:
    catalog = catalog or get_catalog()
    context = {
        "rules": catalog.rules,
        "measures": list(catalog.measures.values()),
        "districts": [
            {
                "id": district["id"],
                "name_ru": district["name_ru"],
                "profile_ru": district["profile_ru"],
                "pop_share": district["pop_share"],
            }
            for district in catalog.districts.values()
        ],
    }
    system = """Ты — аналитик акимата Астаны. Напиши краткую записку на русском языке по схеме.
Движок считает, ты объясняешь проверенные факты и предлагаешь возможные изменения.
Правила: бюджет 100 у.е.; ровно 5 разных решений; не более 2 мер одного направления.
M1 и M3 несовместимы в любых районах; M4 и M7, M5 и M13 — только в одном районе.
Районной мере нужен district из каталога, городской мере нужен district=null.
Горизонт 8 кварталов; доля эффекта (8−lag)/8; синергии фиксированы в районе
district_from и не масштабируются лагом. Критический показатель строго меньше 40.

Каждое число в тексте бери только из FactTable или результата инструмента;
не вычисляй Score, дельты, проценты, вклады или результаты альтернатив сам.
Числа из фактов показывай с двумя знаками после запятой без изменения значения
за пределами округления. Не подменяй точное число округлённым из описания правил.
Каждое утверждение в strengths, risks, consequences, tradeoffs и city_impact
снабди непустым evidence из существующих F-id; не выдумывай идентификаторы.
Заполни все пять разделов; отмечай неопределённость и ограничения модели.
Явно опиши исходные критические показатели Нуры S1 (школы и детсады) и S2
(поликлиники): какие закрыты, какие остаются критическими после решений.
Если выбрана M3 или M13, обязательно упомяни эту меру и её лаг из фактов.
В city_impact объясни последствия для жителей, доступности услуг и районов.
Целевой объём ВСЕХ текстовых полей вместе — 220 слов, строгий максимум 300 слов.
Summary: не более 25 слов. В каждом разделе 1–2 коротких утверждения, не более
12 слов каждое. В каждой рекомендации change не более 10 слов, rationale
не более 12 слов. Ссылки evidence не надо повторять в тексте. Не повторяй каталог.

Предложи до 3 альтернатив, каждая содержит полный набор из 5 решений по правилам.
Когда доступны инструменты, обязательно используй хотя бы один: best_neighbors
ищет улучшения, evaluate_scenario проверяет полный набор, compare_scenarios сравнивает.
Восстанови исходный набор по measure.M*.cost в FactTable: район указан в text_ru,
а для общегородской меры district=null. Хочешь оценить альтернативу — вызови инструмент.
Для recommendations выбирай до 3 допустимых улучшений из проверенных инструментом;
score, delta и cost копируй из результата инструмента без самостоятельного расчёта.
delta — изменение относительно базового состояния города, не исходного сценария.
Если оптимум уже достигнут, честно сообщи об этом и оставь recommendations пустым.
Без инструментов не называй число улучшения в change/rationale; в полях score,
delta и cost используй 0, verified=false и invalid_reason=null. Сервер перепроверит
все рекомендации. Не утверждай, что непроверенная альтернатива лучше исходного плана.

Служебные поля заполняет сервер: provider="llm", model="", prompt_version="",
trace=[], cached=false, verified_numbers={"total":0,"confirmed":0,"unverified":[]}.
Не сочиняй трассу вызовов или результат проверки чисел.

Замороженные правила, каталог мер и профили районов (справочные данные):
""" + json.dumps(context, ensure_ascii=False, separators=(",", ":"))
    by_key = {fact.key: fact for fact in facts}
    required_lag_claims = []
    for measure_id in ("M3", "M13"):
        # build_facts emits measure facts only for decisions in the current plan.
        # Read both numbers and evidence IDs directly; never infer selection or
        # recompute the realized fraction from the full reference catalog.
        lag = by_key.get(f"measure.{measure_id}.lag")
        if lag is None:
            continue
        fraction = by_key.get(f"measure.{measure_id}.effect_fraction")
        text = f"{measure_id}: лаг {lag.value:.2f} квартала"
        evidence = [lag.id]
        if fraction is not None:
            text += f"; доля эффекта {fraction.value:.2f}"
            evidence.append(fraction.id)
        required_lag_claims.append({"text": text + ".", "evidence": evidence})
    # Keep the scenario-specific checklist after the large reference catalog so
    # compression into the word budget cannot hide a selected measure's long lag.
    system += """

ОБЯЗАТЕЛЬНЫЕ ТЕМЫ ТЕКУЩЕГО СЦЕНАРИЯ — финальная проверка перед ответом.
Включи каждое следующее короткое утверждение в risks или consequences: сохрани
ID меры, слово «лаг», число кварталов и указанные evidence. Можно скопировать
утверждения дословно. Они уже краткие и входят в общий лимит 300 слов; сокращай
другие описания, а не эти обязательные факты. Пустой список означает, что среди
выбранных мер нет M3/M13: не переноси их из справочного каталога в текущий план.
""" + json.dumps({"required_lag_claims": required_lag_claims}, ensure_ascii=False)
    user = json.dumps(
        {
            "FactTable": [fact.model_dump() for fact in facts],
            "task": "Проанализируй сценарий и предложи до 3 улучшений",
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return system, user
