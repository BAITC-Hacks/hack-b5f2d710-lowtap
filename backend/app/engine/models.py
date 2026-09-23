"""Canonical API schemas (pydantic v2)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

ENGINE_VERSION = "1.0.0"

ModelStatus = Literal["ok", "not_in_list", "unchecked"]


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    provider: Literal["llm", "rules"]
    ai_cache: Literal["first", "fallback", "0"]
    model: str
    model_fast: str
    has_key: bool
    model_status: ModelStatus
    data_hash: str
    version: str


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    measure_id: str
    district: str | None = None


class Scenario(BaseModel):
    # Preset files also contain name_ru and expected; only decisions are API input.
    decisions: list[Decision]


class Violation(BaseModel):
    code: str
    message: str
    decision_idx: int | None = None
    measures: list[str]


class ValidationResult(BaseModel):
    ok: bool
    violations: list[Violation]


class MinDistrict(BaseModel):
    id: str
    name_ru: str
    d: float


class Components(BaseModel):
    d_avg_term: float
    min_term: float
    crit_term: float
    d_avg_term_base: float
    min_term_base: float
    crit_term_base: float


class CriticalPair(BaseModel):
    district_id: str
    indicator: str
    value: float


class CriticalPairs(BaseModel):
    before: list[CriticalPair]
    after: list[CriticalPair]
    closed: list[CriticalPair]
    new: list[CriticalPair]


class DistrictResult(BaseModel):
    d_before: float
    d_after: float
    delta: float
    indicators_before: dict[str, float]
    indicators_after: dict[str, float]
    deltas: dict[str, float]


class Contribution(BaseModel):
    shapley: float
    loo: float
    per_unit: float


class WaterfallItem(BaseModel):
    label: str
    measure_id: str
    delta: float


class SynergyTriggered(BaseModel):
    pair: list[str]
    district_id: str
    indicator: str
    bonus: float


class TimelinePoint(BaseModel):
    q: int
    score: float
    n_crit: int
    d: dict[str, float]


class EvalResult(BaseModel):
    ok: Literal[True] = True
    scenario_id: str
    score: float
    baseline: float
    delta: float
    percentile: float | None
    cost: int
    remaining: int
    d_avg: float
    min_district: MinDistrict
    n_crit: int
    components: Components
    critical_pairs: CriticalPairs
    districts: dict[str, DistrictResult]
    contributions: dict[str, Contribution]
    waterfall: list[WaterfallItem]
    synergies_triggered: list[SynergyTriggered]
    timeline: list[TimelinePoint]
    data_hash: str
    engine_version: str


class Fact(BaseModel):
    id: str
    key: str
    value: float
    text_ru: str


class Neighbor(BaseModel):
    decisions: list[Decision]
    score: float
    delta: float
    cost: int
    n_crit: int
    min_district: MinDistrict
    scenario_id: str
