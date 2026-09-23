import pytest

from app.engine.catalog import DATA_DIR, get_catalog, scenario_id
from app.engine.models import Decision, Scenario
from app.engine.scoring import score_decisions
from app.engine.search import best_neighbors, neighbors
from app.engine.validator import validate


@pytest.fixture
def example():
    return Scenario.model_validate_json((DATA_DIR / "scenarios/example_tz.json").read_text("utf-8"))


def test_neighbors_are_unique_valid_single_replacements(example):
    alternatives = neighbors(example)
    assert len(alternatives) == 117
    identities = [scenario_id(candidate) for candidate in alternatives]
    assert len(identities) == len(set(identities))
    assert scenario_id(example) not in identities
    original = {(decision.measure_id, decision.district) for decision in example.decisions}
    for candidate in alternatives:
        assert validate(candidate).ok
        changed = {(decision.measure_id, decision.district) for decision in candidate.decisions}
        assert len(original - changed) == len(changed - original) == 1


def test_neighbors_cover_every_valid_single_replacement(example):
    catalog = get_catalog()
    expected = set()
    for index in range(5):
        for measure_id, measure in catalog.measures.items():
            districts = catalog.district_ids if measure["type"] == "district" else [None]
            for district in districts:
                decisions = example.decisions.copy()
                decisions[index] = Decision(measure_id=measure_id, district=district)
                candidate = Scenario(decisions=decisions)
                if validate(candidate).ok and scenario_id(candidate) != scenario_id(example):
                    expected.add(scenario_id(candidate))
    assert {scenario_id(candidate) for candidate in neighbors(example)} == expected


def test_best_neighbors_are_order_independent_and_match_scorer(example):
    result = best_neighbors(example)
    reversed_scenario = Scenario(decisions=list(reversed(example.decisions)))
    assert result == best_neighbors(reversed_scenario)
    assert [item.score for item in result] == sorted((item.score for item in result), reverse=True)
    assert result[0].score == pytest.approx(57.20556)
    baseline = score_decisions([]).score
    for item in result:
        state = score_decisions(item.decisions)
        assert item.score == state.score
        assert item.delta == pytest.approx(state.score - baseline)
        assert item.n_crit == state.n_crit
        assert item.min_district.d == min(state.d.values())


def test_search_objectives_and_caps(example):
    zero_crit = best_neighbors(example, objective="zero_crit", k=500)
    assert [item.n_crit for item in zero_crit] == sorted(item.n_crit for item in zero_crit)
    minimum = best_neighbors(example, objective="min_district", k=500)
    assert [item.min_district.d for item in minimum] == sorted(
        (item.min_district.d for item in minimum), reverse=True
    )
    capped = best_neighbors(example, objective="budget_cap", k=500)
    assert capped and all(item.cost <= 95 for item in capped)
    assert best_neighbors(example, objective="budget_cap", budget_cap=60) == []
    assert best_neighbors(example, k=0) == []
    with pytest.raises(ValueError):
        best_neighbors(example, objective="unknown")
    with pytest.raises(ValueError):
        best_neighbors(example, k=-1)
    with pytest.raises(ValueError):
        best_neighbors(Scenario(decisions=[]))
