"""Contract and numerical regression tests for the deterministic B1 engine."""

import json
import re
from copy import deepcopy
from hashlib import sha256
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.engine.attribution import attribute
from app.engine.catalog import get_catalog, scenario_id
from app.engine.distribution import load_distribution, percentile
from app.engine.models import ENGINE_VERSION, Decision, Scenario
from app.engine.scoring import InvalidScenario, clip, evaluate, score_decisions
from app.engine.validator import validate

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS = ROOT / "data" / "scenarios"
PRESET_FILES = sorted(SCENARIOS.glob("*.json"))
VALID_PRESETS = ["example_tz", "cheapest", "naive_esil", "worst_of_all", "optimum"]


def load_scenario(name):
    document = json.loads((SCENARIOS / f"{name}.json").read_text(encoding="utf-8"))
    return Scenario.model_validate({"decisions": document["decisions"]})


def decisions(*pairs):
    return [Decision(measure_id=measure, district=district) for measure, district in pairs]


def codes(validation):
    return [item.code for item in validation.violations]


@pytest.mark.parametrize("path", PRESET_FILES, ids=lambda path: path.stem)
def test_every_frozen_scenario_matches_expected(path):
    document = json.loads(path.read_text(encoding="utf-8"))
    scenario = Scenario.model_validate({"decisions": document["decisions"]})
    expected = document["expected"]
    validation = validate(scenario)

    assert validation.ok is expected["valid"]
    if expected["valid"]:
        assert validation.violations == []
        result = evaluate(scenario)
        assert result.ok is True
        assert result.score == pytest.approx(expected["score"], abs=5e-4)
        assert result.cost == expected["cost"]
        assert result.remaining == 100 - expected["cost"]
        assert result.n_crit == expected["n_crit"]
    else:
        assert codes(validation) == expected["violations"]
        assert all(re.search("[А-Яа-я]", item.message) for item in validation.violations)
        with pytest.raises(InvalidScenario) as rejected:
            evaluate(scenario)
        assert codes(rejected.value.validation) == expected["violations"]


def test_catalog_hash_and_source_loading_are_independent_of_cwd(tmp_path, monkeypatch):
    expected = sha256(
        b"".join(
            (ROOT / "data" / name).read_bytes()
            for name in ("districts.json", "measures.json", "rules.json")
        )
    ).hexdigest()[:12]
    monkeypatch.chdir(tmp_path)
    get_catalog.cache_clear()
    catalog = get_catalog()

    assert catalog.data_hash == expected
    assert len(catalog.districts) == 5
    assert len(catalog.measures) == 14
    assert len(catalog.indicators) == 10
    assert set(catalog.district_ids) == {"esil", "almaty", "saryarka", "baikonur", "nura"}


@pytest.mark.parametrize("name", VALID_PRESETS)
def test_decision_order_does_not_change_result_or_scenario_id(name):
    scenario = load_scenario(name)
    reverse = Scenario(decisions=list(reversed(scenario.decisions)))

    assert scenario_id(scenario) == scenario_id(reverse)
    assert re.fullmatch("[a-f0-9]{12}", scenario_id(scenario))
    assert evaluate(scenario).model_dump() == evaluate(reverse).model_dump()


def test_scenario_id_changes_with_district_assignment():
    first = load_scenario("example_tz")
    second = first.model_copy(deep=True)
    second.decisions[0] = second.decisions[0].model_copy(update={"district": "esil"})
    assert scenario_id(first) != scenario_id(second)


def test_validator_returns_all_independent_violations():
    scenario = Scenario(
        decisions=decisions(
            ("M1", "esil"),
            ("M3", "nura"),
            ("M4", "nura"),
            ("M7", "nura"),
            ("M99", "nura"),
            ("M12", "nura"),
        )
    )
    validation = validate(scenario)
    assert not validation.ok
    assert set(codes(validation)) == {
        "NOT_FIVE",
        "UNKNOWN_MEASURE",
        "DISTRICT_FORBIDDEN",
        "INCOMPATIBLE_M1_M3",
        "CONFLICT_M4_M7",
        "BUDGET_EXCEEDED",
    }


def test_duplicates_do_not_inflate_direction_count():
    validation = validate(load_scenario("invalid_dup"))
    assert codes(validation) == ["DUPLICATE"]
    assert validation.violations[0].measures == ["M8"]


@pytest.mark.parametrize(
    ("name", "measure", "new_district"),
    [
        ("invalid_conflict_m4m7", "M7", "esil"),
        ("invalid_conflict_m5m13", "M13", "esil"),
    ],
)
def test_same_district_conflicts_are_allowed_in_different_districts(name, measure, new_district):
    scenario = load_scenario(name)
    scenario.decisions = [
        item.model_copy(update={"district": new_district}) if item.measure_id == measure else item
        for item in scenario.decisions
    ]
    assert validate(scenario).ok


@pytest.mark.parametrize(
    ("name", "index", "measure"),
    [("unknown_measure", 4, "M99"), ("unknown_district", 0, "M7")],
)
def test_unknown_identifiers_include_decision_location(name, index, measure):
    violation = validate(load_scenario(name)).violations[0]
    assert violation.decision_idx == index
    assert measure in violation.measures


def test_budget_error_reports_excess_and_exact_budget_is_accepted():
    violation = validate(load_scenario("invalid_budget")).violations[0]
    assert violation.code == "BUDGET_EXCEEDED"
    assert "29" in violation.message
    assert "у.е." in violation.message
    assert validate(load_scenario("naive_esil")).ok


def test_scenario_structure_keeps_semantic_validation_in_engine():
    assert codes(validate(Scenario(decisions=[]))) == ["NOT_FIVE"]
    assert Decision(measure_id="M99").district is None
    with pytest.raises(ValidationError):
        Scenario.model_validate({"decisions": "x"})


def test_partial_evaluation_skips_only_required_decision_count():
    partial = Scenario(decisions=decisions(("M7", "nura")))
    assert codes(validate(partial)) == ["NOT_FIVE"]
    assert validate(partial, allow_partial=True).ok
    assert evaluate(partial, allow_partial=True).cost == 24

    conflict = Scenario(decisions=decisions(("M1", "esil"), ("M3", "nura")))
    assert codes(validate(conflict, allow_partial=True)) == ["INCOMPATIBLE_M1_M3"]
    with pytest.raises(InvalidScenario):
        evaluate(conflict, allow_partial=True)


def test_baseline_uses_population_weights_and_global_critical_count():
    state = score_decisions([])
    assert state.d == pytest.approx(
        {"esil": 62.99, "almaty": 57.06, "saryarka": 54.65, "baikonur": 56.63, "nura": 49.18}
    )
    assert state.d_avg == pytest.approx(56.8624)
    assert state.n_crit == 2
    assert state.score == pytest.approx(52.55768, abs=1e-9)


def test_lag_scales_effect_and_district_measure_stays_local():
    state = score_decisions(decisions(("M3", "nura")))
    baseline = score_decisions([])
    assert state.indicators["nura"]["T1"] == 63
    assert state.indicators["nura"]["T2"] == 50
    assert state.indicators["nura"]["E2"] == 67
    for district in ("esil", "almaty", "saryarka", "baikonur"):
        assert state.indicators[district] == baseline.indicators[district]


def test_city_measure_reaches_all_five_districts():
    baseline = score_decisions([])
    state = score_decisions(decisions(("M2", None)))
    for district in get_catalog().district_ids:
        assert state.indicators[district]["T1"] == baseline.indicators[district]["T1"] + 3
        assert state.indicators[district]["B2"] == baseline.indicators[district]["B2"] + 2.25


@pytest.mark.parametrize(
    ("first", "second", "district", "indicator"),
    [("M1", "M2", "esil", "T1"), ("M10", "M12", "nura", "B1"), ("M5", "M6", "saryarka", "E2")],
)
def test_synergy_is_fixed_local_and_independent_of_order(first, second, district, indicator):
    pair = decisions((first, district), (second, None))
    baseline = score_decisions([])
    one = score_decisions(pair[:1])
    other = score_decisions(pair[1:])
    combined = score_decisions(pair)
    assert not one.synergies
    assert not other.synergies
    assert combined.indicators == score_decisions(list(reversed(pair))).indicators
    for district_id in get_catalog().district_ids:
        independent = (
            one.indicators[district_id][indicator]
            + other.indicators[district_id][indicator]
            - baseline.indicators[district_id][indicator]
        )
        assert combined.indicators[district_id][indicator] - independent == pytest.approx(
            2 if district_id == district else 0
        )


@pytest.mark.parametrize(
    ("value", "expected"), [(-8, 0), (0, 0), (39.9, 39.9), (40, 40), (95 + 16, 100)]
)
def test_clip(value, expected):
    assert clip(value) == expected


@pytest.mark.parametrize(("value", "expected_critical"), [(39.9, 2), (40, 1)])
def test_critical_threshold_is_strict(value, expected_critical):
    catalog = deepcopy(get_catalog())
    catalog.districts["nura"]["indicators"]["S1"] = value
    assert score_decisions([], catalog=catalog).n_crit == expected_critical


def test_clipping_happens_after_positive_and_negative_effects_are_combined():
    catalog = deepcopy(get_catalog())
    catalog.districts["almaty"]["indicators"]["T1"] = 99
    state = score_decisions(decisions(("M1", "almaty"), ("M11", "almaty")), catalog)
    # 99 + 4.5 - 1.75 clips to 100; clipping after M1 alone would incorrectly give 98.25.
    assert state.indicators["almaty"]["T1"] == 100


def test_critical_count_includes_districts_without_measures():
    assert evaluate(load_scenario("naive_esil")).n_crit == 2
    worst = evaluate(load_scenario("worst_of_all"))
    assert worst.n_crit == 3
    assert {(item.district_id, item.indicator) for item in worst.critical_pairs.new} == {
        ("almaty", "T1")
    }


@pytest.mark.parametrize(
    ("district", "expected", "n_crit"), [("almaty", 51.687, 3), ("nura", 52.875, 2)]
)
def test_negative_transport_effect_in_partial_scenarios(district, expected, n_crit):
    state = score_decisions(decisions(("M11", district)))
    assert state.score == pytest.approx(expected, abs=5e-4)
    assert state.n_crit == n_crit


@pytest.mark.parametrize("name", VALID_PRESETS)
def test_attribution_and_waterfall_reconcile_with_raw_score_delta(name):
    scenario = load_scenario(name)
    result = evaluate(scenario)
    contributions = attribute(scenario.decisions)
    assert sum(item.shapley for item in contributions.values()) == pytest.approx(
        result.delta, abs=1e-8
    )
    assert sum(item.delta for item in result.waterfall) == pytest.approx(result.delta, abs=1e-8)
    assert len(result.waterfall) == 5
    assert [item.measure_id for item in result.waterfall] == sorted(
        contributions, key=lambda measure: int(measure[1:])
    )
    for decision in scenario.decisions:
        measure_id = decision.measure_id
        contribution = contributions[measure_id]
        without = [item for item in scenario.decisions if item.measure_id != measure_id]
        assert contribution.loo == pytest.approx(
            result.score - score_decisions(without).score, abs=1e-8
        )
        assert contribution.per_unit == pytest.approx(
            contribution.shapley / get_catalog().measures[measure_id]["cost"], abs=1e-9
        )


@pytest.mark.parametrize("name", VALID_PRESETS)
def test_evaluation_components_districts_and_timeline_are_consistent(name):
    result = evaluate(load_scenario(name))
    components = result.components
    assert result.score - result.baseline == pytest.approx(result.delta, abs=1e-9)
    assert components.d_avg_term + components.min_term + components.crit_term == pytest.approx(
        result.score, abs=1e-9
    )
    assert (
        components.d_avg_term_base + components.min_term_base + components.crit_term_base
    ) == pytest.approx(result.baseline, abs=1e-9)
    assert result.min_district.d == min(item.d_after for item in result.districts.values())
    assert [point.q for point in result.timeline] == list(range(9))
    assert result.timeline[0].score == result.baseline
    assert result.timeline[8].score == result.score
    assert result.timeline[8].n_crit == result.n_crit
    for district_id, state in result.districts.items():
        assert state.delta == pytest.approx(state.d_after - state.d_before, abs=1e-9)
        assert len(state.indicators_after) == 10
        for indicator in get_catalog().indicators:
            assert state.deltas[indicator] == pytest.approx(
                state.indicators_after[indicator] - state.indicators_before[indicator], abs=1e-9
            )
        assert result.timeline[8].d[district_id] == state.d_after


def test_timeline_effects_start_after_lag_and_cross_critical_threshold():
    school = decisions(("M7", "nura"))
    clinic = decisions(("M8", "nura"))
    assert score_decisions(school, q=3).indicators["nura"]["S1"] == 38
    assert score_decisions(school, q=4).indicators["nura"]["S1"] == 40
    assert score_decisions(school, q=4).n_crit == 1
    assert score_decisions(clinic, q=5).indicators["nura"]["S2"] == 38.5
    assert score_decisions(clinic, q=6).indicators["nura"]["S2"] == 40.25
    assert score_decisions(clinic, q=6).n_crit == 1


@pytest.mark.parametrize(
    ("first", "second", "district", "start"),
    [("M1", "M2", "esil", 3), ("M10", "M12", "nura", 2), ("M5", "M6", "saryarka", 5)],
)
def test_timeline_synergy_starts_when_both_measures_are_active(first, second, district, start):
    pair = decisions((first, district), (second, None))
    assert score_decisions(pair, q=start - 1).synergies == []
    assert len(score_decisions(pair, q=start).synergies) == 1


def test_evaluation_does_not_mutate_frozen_catalog_or_decisions():
    scenario = load_scenario("example_tz")
    decisions_before = scenario.model_dump()
    catalog = get_catalog()
    districts_before = deepcopy(catalog.districts)
    measures_before = deepcopy(catalog.measures)

    evaluate(scenario)

    assert scenario.model_dump() == decisions_before
    assert catalog.districts == districts_before
    assert catalog.measures == measures_before


def test_score_has_no_bonus_for_unspent_budget():
    scenario = load_scenario("example_tz")
    regular = evaluate(scenario)
    catalog = deepcopy(get_catalog())
    catalog.measures["M7"]["cost"] -= 10

    cheaper = evaluate(scenario, catalog)

    assert cheaper.cost == regular.cost - 10
    assert cheaper.remaining == regular.remaining + 10
    assert cheaper.score == regular.score


def test_shapley_treats_identical_effects_symmetrically():
    catalog = deepcopy(get_catalog())
    catalog.measures["M8"]["effects"] = dict(catalog.measures["M7"]["effects"])
    pair = decisions(("M7", "nura"), ("M8", "nura"))
    contributions = attribute(pair, catalog)
    delta = score_decisions(pair, catalog).score - score_decisions([], catalog).score
    assert contributions["M7"].shapley == pytest.approx(delta / 2, abs=1e-9)
    assert contributions["M8"].shapley == pytest.approx(delta / 2, abs=1e-9)


def test_percentile_counts_strictly_lower_scores_and_preserves_ties(tmp_path, monkeypatch):
    path = tmp_path / "distribution.json"
    path.write_text(
        json.dumps(
            {
                "data_hash": get_catalog().data_hash,
                "engine_version": ENGINE_VERSION,
                "count": 4,
                "score_counts": [[10, 2], [20, 1], [30, 1]],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr("app.engine.distribution.DISTRIBUTION_PATH", path)
    for score, expected in [(9, 0), (10, 0), (10.5, 50), (20, 50), (30, 75), (31, 100)]:
        assert percentile(score) == expected


def test_missing_distribution_is_optional(tmp_path, monkeypatch):
    path = tmp_path / "absent.json"
    monkeypatch.setattr("app.engine.distribution.DISTRIBUTION_PATH", path)
    assert load_distribution() is None
    assert percentile(55) is None


@pytest.mark.parametrize("stale_field", ["data_hash", "engine_version"])
def test_stale_distribution_cannot_silently_supply_percentiles(tmp_path, stale_field):
    document = {
        "data_hash": get_catalog().data_hash,
        "engine_version": ENGINE_VERSION,
        "count": 1,
        "score_counts": [[55, 1]],
    }
    document[stale_field] = "outdated"
    path = tmp_path / f"{stale_field}.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(ValueError, match="Распределение устарело"):
        load_distribution(path=path)
