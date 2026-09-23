import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import argparse
import json
from pathlib import Path

from pydantic import ValidationError

from app import __version__
from app.engine.golden import GOLDEN_PATH, write_golden
from app.engine.models import Scenario, ValidationResult, Violation
from app.engine.scoring import InvalidScenario, evaluate


def main() -> None:
    parser = argparse.ArgumentParser(description="Бэкенд «Аким на 5 часов»")
    parser.add_argument("--version", action="version", version=__version__)
    commands = parser.add_subparsers(dest="command")
    evaluate_parser = commands.add_parser("evaluate", help="Оценить сценарий по формуле ТЗ")
    evaluate_parser.add_argument("scenario", type=Path, help="Путь к JSON сценария")
    evaluate_parser.add_argument("--json", action="store_true", help="Полный EvalResult в JSON")
    golden_parser = commands.add_parser("golden", help="Обновить фикстуры паритета движков")
    golden_parser.add_argument(
        "--output", type=Path, default=GOLDEN_PATH, help="Путь выходного JSON"
    )
    args = parser.parse_args()
    if args.command is None:
        parser.print_help()
        return
    if args.command == "golden":
        golden = write_golden(args.output)
        valid = sum(case["valid"] for case in golden["cases"])
        print(f"Записано: {args.output.resolve()}")
        print(
            f"cases {len(golden['cases'])} | valid {valid} | "
            f"invalid {len(golden['cases']) - valid} | seed {golden['seed']}"
        )
        print(f"data_hash {golden['data_hash']} | engine_version {golden['engine_version']}")
        return
    try:
        scenario = Scenario.model_validate_json(args.scenario.read_text(encoding="utf-8"))
        result = evaluate(scenario)
    except InvalidScenario as exc:
        print(json.dumps(exc.validation.model_dump(), ensure_ascii=False, indent=2))
        raise SystemExit(2) from None
    except (OSError, UnicodeError, ValidationError) as exc:
        validation = ValidationResult(
            ok=False,
            violations=[Violation(code="BAD_REQUEST", message=f"Ошибка JSON: {exc}", measures=[])],
        )
        print(json.dumps(validation.model_dump(), ensure_ascii=False, indent=2))
        raise SystemExit(2) from None
    if args.json:
        print(json.dumps(result.model_dump(), ensure_ascii=False, indent=2))
        return
    percentile = "нет распределения" if result.percentile is None else f"{result.percentile:.3f}%"
    print(f"Score {result.score:.3f} | baseline {result.baseline:.3f} | delta {result.delta:+.3f}")
    print(f"cost {result.cost} | remaining {result.remaining} | n_crit {result.n_crit}")
    print(f"percentile {percentile} | scenario_id {result.scenario_id}")


if __name__ == "__main__":
    main()
