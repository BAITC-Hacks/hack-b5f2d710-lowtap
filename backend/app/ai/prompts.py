"""Versioned Russian prompts containing only frozen catalog data and engine facts."""

import json

from app.engine.catalog import Catalog, get_catalog
from app.engine.models import Fact

PROMPT_VERSION = "1.0.0"


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
В city_impact объясни последствия для жителей, доступности услуг и районов.
В текстовых полях суммарно не более 300 слов. Не повторяй каталог мер.

Предложи до 3 альтернатив, каждая содержит полный набор из 5 решений по правилам.
Хочешь оценить альтернативу — вызови инструмент движка, когда он доступен.
Без инструмента не называй число улучшения в change/rationale: сервер проверит
каждый набор и сам заполнит score, delta и cost. Для этих трёх полей используй 0,
verified=false и invalid_reason=null. Не заявляй, что непроверенная альтернатива
лучше исходного плана. Если обоснованных альтернатив нет, оставь список пустым.

Служебные поля заполняет сервер: provider="llm", model="", prompt_version="",
trace=[], cached=false, verified_numbers={"total":0,"confirmed":0,"unverified":[]}.
Не сочиняй трассу вызовов или результат проверки чисел.

Замороженные правила, каталог мер и профили районов (справочные данные):
""" + json.dumps(context, ensure_ascii=False, separators=(",", ":"))
    user = json.dumps(
        {
            "FactTable": [fact.model_dump() for fact in facts],
            "task": "Проанализируй сценарий и предложи до 3 улучшений",
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return system, user
