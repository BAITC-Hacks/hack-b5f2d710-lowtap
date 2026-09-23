"""Frozen task data and stable scenario identities."""

import json
from dataclasses import dataclass
from functools import lru_cache
from hashlib import sha256

from app.config import DATA_DIR
from app.engine.models import Decision, Scenario


@dataclass(frozen=True)
class Catalog:
    districts: dict[str, dict]
    measures: dict[str, dict]
    rules: dict
    data_hash: str

    @property
    def indicators(self) -> tuple[str, ...]:
        return tuple(item["code"] for item in self.rules["indicators"])

    @property
    def district_ids(self) -> tuple[str, ...]:
        return tuple(self.districts)


@lru_cache(maxsize=1)
def get_catalog() -> Catalog:
    names = ("districts.json", "measures.json", "rules.json")
    raw = [(DATA_DIR / name).read_bytes() for name in names]
    districts, measures, rules = [json.loads(item) for item in raw]
    return Catalog(
        districts={item["id"]: item for item in districts["districts"]},
        measures={item["id"]: item for item in measures["measures"]},
        rules=rules,
        data_hash=sha256(b"".join(raw)).hexdigest()[:12],
    )


def canonical_decisions(decisions: list[Decision]) -> list[Decision]:
    """The hash contract sorts string IDs lexically (M1, M10, ..., M2)."""
    return sorted(decisions, key=lambda decision: (decision.measure_id, decision.district or ""))


def canonical_json(scenario: Scenario) -> str:
    return json.dumps(
        {"decisions": [item.model_dump() for item in canonical_decisions(scenario.decisions)]},
        ensure_ascii=False,
        separators=(",", ":"),
    )


def scenario_id(scenario: Scenario) -> str:
    return sha256(canonical_json(scenario).encode("utf-8")).hexdigest()[:12]
