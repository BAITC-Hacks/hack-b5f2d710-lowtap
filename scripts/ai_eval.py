"""Run the five-preset AI evaluation, optionally warming verified live demos."""

import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def main() -> int:
    from app.ai.evaluation import DEFAULT_OUTPUT, run_evaluation
    from app.config import Settings

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", choices=("auto", "rules"), default="auto")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--warm-demo", action="store_true", help="Сохранить живые отчёты в demo-кэш"
    )
    args = parser.parse_args()
    try:
        rows = asyncio.run(
            run_evaluation(
                Settings.from_env(),
                provider=args.provider,
                output=args.output,
                warm_demo=args.warm_demo,
            )
        )
    except ValueError as exc:
        parser.error(str(exc))
    except OSError:
        print("Не удалось записать результат mini-eval.", file=sys.stderr)
        return 1
    passed = sum(row["passed"] for row in rows)
    print(f"Результат: {passed}/{len(rows)} | {args.output.resolve()}")
    return 0 if passed == len(rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
