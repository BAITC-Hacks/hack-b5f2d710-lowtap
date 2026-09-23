"""Generate data/plan_distribution.json from all valid five-decision plans."""

import argparse
import sys
from pathlib import Path
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def main() -> None:
    from app.engine.distribution import DISTRIBUTION_PATH, write_distribution

    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DISTRIBUTION_PATH)
    args = parser.parse_args()
    started = perf_counter()
    distribution = write_distribution(args.output)
    print(f"Записано: {args.output.resolve()}")
    print(
        f"count={distribution['count']}, "
        f"worse_than_baseline={distribution['worse_than_baseline']}, "
        f"best={distribution['best']:.3f}, worst={distribution['worst']:.3f}, "
        f"quantiles={len(distribution['quantiles'])}, top20={len(distribution['top20'])}"
    )
    print(f"Время: {perf_counter() - started:.2f} с")


if __name__ == "__main__":
    main()
