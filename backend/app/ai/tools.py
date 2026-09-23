"""Strict, bounded engine tools exposed to the model through server execution."""

from copy import deepcopy
from typing import Any

from pydantic import ValidationError

from app.engine.catalog import Catalog, canonical_decisions, get_catalog
from app.engine.models import EvalResult, Scenario
from app.engine.scoring import evaluate
from app.engine.search import best_neighbors
from app.engine.validator import validate

OBJECTIVES = ("score", "zero_crit", "min_district", "budget_cap")


def _object(properties: dict) -> dict:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


def build_tools(catalog: Catalog | None = None) -> list[dict]:
    """Build provider schemas from the same IDs used by the validator."""
    catalog = catalog or get_catalog()
    decision = _object(
        {
            "measure_id": {"type": "string", "enum": list(catalog.measures)},
            "district": {
                "type": ["string", "null"],
                "enum": [*catalog.district_ids, None],
                "description": "Район меры; null только для городской меры.",
            },
        }
    )
    decisions = {"type": "array", "items": decision}
    scenario = _object({"decisions": decisions})
    definitions = (
        (
            "evaluate_scenario",
            "Проверь полный набор решений и рассчитай Score, стоимость, критические "
            "показатели и вклады. Для невалидного набора верни нарушения без Score.",
            scenario,
        ),
        (
            "best_neighbors",
            "Найди до k допустимых альтернатив заменой одной меры или её района. "
            "score: максимальный Score; zero_crit: минимум критических пар, затем Score; "
            "min_district: максимум индекса слабейшего района; budget_cap: максимум Score "
            "при стоимости не выше исходного плана. Альтернативы могут быть хуже исходного. "
            "Поле delta всегда относительно бездействия.",
            _object(
                {
                    "decisions": decisions,
                    "objective": {"type": "string", "enum": list(OBJECTIVES)},
                    "k": {"type": "integer", "minimum": 1, "maximum": 10},
                }
            ),
        ),
        (
            "compare_scenarios",
            "Пересчитай два полных сценария a и b; сравни Score, стоимость и число "
            "критических пар. Разницы в delta равны b минус a.",
            _object({"a": scenario, "b": scenario}),
        ),
    )
    return [
        {
            "type": "function",
            "name": name,
            "description": description,
            "parameters": deepcopy(parameters),
            "strict": True,
        }
        for name, description, parameters in definitions
    ]


TOOLS = build_tools()


def _require_keys(value: Any, keys: set[str]) -> None:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError("Invalid argument object")


def _scenario(value: Any) -> Scenario:
    # Scenario also accepts preset metadata in the API; tool input deliberately
    # allows only the strict schema so extra model-supplied fields cannot leak in.
    _require_keys(value, {"decisions"})
    if not isinstance(value["decisions"], list):
        raise ValueError("Invalid decisions array")
    for decision in value["decisions"]:
        _require_keys(decision, {"measure_id", "district"})
    return Scenario.model_validate(value, strict=True)


def _compact(result: EvalResult, scenario: Scenario) -> dict:
    fields = {
        "ok",
        "scenario_id",
        "score",
        "baseline",
        "delta",
        "percentile",
        "cost",
        "remaining",
        "d_avg",
        "min_district",
        "n_crit",
        "critical_pairs",
        "contributions",
        "synergies_triggered",
        "data_hash",
        "engine_version",
    }
    compact = result.model_dump(mode="json", include=fields)
    compact["decisions"] = [item.model_dump() for item in canonical_decisions(scenario.decisions)]
    compact["districts"] = {
        district_id: district.model_dump(include={"d_before", "d_after", "delta"})
        for district_id, district in result.districts.items()
    }
    return compact


class ToolExecutor:
    """Execute model arguments against local data; errors never abort the loop."""

    def __init__(self, catalog: Catalog | None = None):
        self.catalog = catalog or get_catalog()

    def execute(self, name: str, arguments: dict) -> dict:
        try:
            if name == "evaluate_scenario":
                chosen = _scenario(arguments)
                validation = validate(chosen, catalog=self.catalog)
                if not validation.ok:
                    return validation.model_dump()
                return _compact(evaluate(chosen, catalog=self.catalog), chosen)
            if name == "best_neighbors":
                _require_keys(arguments, {"decisions", "objective", "k"})
                objective, k = arguments["objective"], arguments["k"]
                if not isinstance(objective, str) or objective not in OBJECTIVES:
                    raise ValueError("Invalid objective")
                if type(k) is not int or not 1 <= k <= 10:
                    raise ValueError("Invalid result limit")
                chosen = _scenario({"decisions": arguments["decisions"]})
                validation = validate(chosen, catalog=self.catalog)
                if not validation.ok:
                    return validation.model_dump()
                candidates = best_neighbors(chosen, objective=objective, k=k, catalog=self.catalog)
                return {
                    "objective": objective,
                    "neighbors": [item.model_dump(mode="json") for item in candidates],
                }
            if name == "compare_scenarios":
                _require_keys(arguments, {"a", "b"})
                a, b = _scenario(arguments["a"]), _scenario(arguments["b"])
                violations = []
                for label, chosen in (("a", a), ("b", b)):
                    validation = validate(chosen, catalog=self.catalog)
                    for violation in validation.violations:
                        details = violation.model_dump()
                        details["message"] = f"Сценарий {label}: {details['message']}"
                        violations.append(details)
                if violations:
                    return {"ok": False, "violations": violations}
                evaluated_a = evaluate(a, catalog=self.catalog)
                evaluated_b = evaluate(b, catalog=self.catalog)
                return {
                    "a": _compact(evaluated_a, a),
                    "b": _compact(evaluated_b, b),
                    "delta": {
                        "score": round(evaluated_b.score - evaluated_a.score, 10),
                        "cost": evaluated_b.cost - evaluated_a.cost,
                        "n_crit": evaluated_b.n_crit - evaluated_a.n_crit,
                    },
                }
            return {"error": "Неизвестный инструмент движка."}
        except ValidationError, ValueError, TypeError:
            return {"error": "Аргументы не соответствуют схеме инструмента."}
        except Exception:
            # SDK/tool errors may contain credentials or input; only static,
            # server-authored messages cross the boundary back to the model.
            return {"error": "Не удалось выполнить инструмент движка."}


def execute_tool(name: str, arguments: dict, catalog: Catalog | None = None) -> dict:
    return ToolExecutor(catalog).execute(name, arguments)
