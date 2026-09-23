"""Deterministic fixtures for checking parity with the frontend's engine."""

import json
from pathlib import Path
from random import Random

from app.config import DATA_DIR
from app.engine.catalog import Catalog, canonical_decisions, get_catalog, scenario_id
from app.engine.models import ENGINE_VERSION, Decision, Scenario
from app.engine.scoring import evaluate
from app.engine.validator import validate

GOLDEN_PATH = DATA_DIR / "golden.json"
GOLDEN_SEED = 42
RANDOM_CASES = 50


def _case(name: str, scenario: Scenario, catalog: Catalog, *, allow_partial: bool = False) -> dict:
    scenario = Scenario(decisions=canonical_decisions(scenario.decisions))
    validation = validate(scenario, catalog=catalog, allow_partial=allow_partial)
    case = {
        "name": name,
        "decisions": [decision.model_dump() for decision in scenario.decisions],
        "valid": validation.ok,
    }
    if allow_partial:
        case["allow_partial"] = True
    if validation.ok:
        case["eval"] = evaluate(scenario, catalog=catalog, allow_partial=allow_partial).model_dump()
    else:
        case["violations"] = [violation.model_dump() for violation in validation.violations]
    return case


def generate_golden(catalog: Catalog | None = None) -> dict:
    """Return all presets, four partial examples, and 50 unique valid random plans.

    The explicit random generator, ordered catalogs, and absence of timestamps
    make the entire artifact reproducible. Random plans exclude the presets.
    Invalid scenarios carry violations only, never an evaluated score.
    """
    catalog = catalog or get_catalog()
    cases = []
    seen = set()
    for path in sorted((DATA_DIR / "scenarios").glob("*.json")):
        scenario = Scenario.model_validate_json(path.read_text(encoding="utf-8"))
        cases.append(_case(path.stem, scenario, catalog))
        seen.add(scenario_id(scenario))

    example = Scenario.model_validate_json(
        (DATA_DIR / "scenarios" / "example_tz.json").read_text(encoding="utf-8")
    )
    for length in range(1, catalog.rules["decisions_required"]):
        scenario = Scenario(decisions=example.decisions[:length])
        cases.append(_case(f"example_tz_partial_{length}", scenario, catalog, allow_partial=True))

    rng = Random(GOLDEN_SEED)
    measure_ids = sorted(catalog.measures)
    district_ids = sorted(catalog.district_ids)
    random_count = 0
    for _ in range(100_000):
        selected = rng.sample(measure_ids, catalog.rules["decisions_required"])
        scenario = Scenario(
            decisions=[
                Decision(
                    measure_id=measure_id,
                    district=(
                        rng.choice(district_ids)
                        if catalog.measures[measure_id]["type"] == "district"
                        else None
                    ),
                )
                for measure_id in selected
            ]
        )
        identity = scenario_id(scenario)
        if identity in seen or not validate(scenario, catalog=catalog).ok:
            continue
        seen.add(identity)
        random_count += 1
        cases.append(_case(f"random_{random_count:02d}", scenario, catalog))
        if random_count == RANDOM_CASES:
            break
    else:
        raise ValueError("Не удалось подобрать 50 уникальных допустимых сценариев")
    return {
        "data_hash": catalog.data_hash,
        "engine_version": ENGINE_VERSION,
        "seed": GOLDEN_SEED,
        "cases": cases,
    }


def write_golden(path: Path = GOLDEN_PATH, catalog: Catalog | None = None) -> dict:
    golden = generate_golden(catalog)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(golden, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return golden
