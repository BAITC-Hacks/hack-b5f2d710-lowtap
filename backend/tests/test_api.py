"""B2 HTTP contract checks; no API keys or external network are used."""

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app import main as app_main
from app.config import Settings
from app.engine.catalog import get_catalog
from app.engine.facts import build_facts
from app.engine.models import Scenario
from app.engine.scoring import evaluate

ROOT = Path(__file__).resolve().parents[2]
CLAIM_SECTIONS = ("strengths", "risks", "consequences", "tradeoffs", "city_impact")


def scenario_body(name="example_tz"):
    data = json.loads((ROOT / "data/scenarios" / f"{name}.json").read_text(encoding="utf-8"))
    return {"decisions": data["decisions"]}


@pytest.fixture(autouse=True)
def no_openai_client(monkeypatch):
    factory = MagicMock(
        side_effect=AssertionError("B2 API tests must not construct OpenAI clients")
    )
    monkeypatch.setattr("app.ai.probe.AsyncOpenAI", factory)


@pytest.fixture
def client():
    with TestClient(app_main.create_app(Settings(ai_provider="rules"))) as test_client:
        yield test_client


def assert_validation_error(response, code, *, decision_idx=None):
    assert response.status_code == 422
    body = response.json()
    assert set(body) == {"ok", "violations"}
    assert body["ok"] is False
    assert body["violations"]
    assert {violation["code"] for violation in body["violations"]} == {code}
    for violation in body["violations"]:
        assert set(violation) == {"code", "message", "decision_idx", "measures"}
        assert violation["message"]
        assert isinstance(violation["measures"], list)
    if decision_idx is not None:
        assert any(violation["decision_idx"] == decision_idx for violation in body["violations"])
    return body


def assert_verified_report(report, original_body):
    assert report["provider"] == "rules"
    assert report["summary"]
    assert report["cached"] is False
    scenario = Scenario.model_validate(original_body)
    facts = build_facts(scenario, evaluate(scenario))
    fact_ids = {fact.id for fact in facts}
    for section in CLAIM_SECTIONS:
        assert report[section], section
        for claim in report[section]:
            assert claim["text"]
            assert claim["evidence"]
            assert set(claim["evidence"]) <= fact_ids
    assert report["recommendations"]
    for recommendation in report["recommendations"]:
        assert recommendation["verified"] is True
        assert recommendation["invalid_reason"] is None
        recomputed = evaluate(Scenario.model_validate({"decisions": recommendation["decisions"]}))
        assert recommendation["score"] == pytest.approx(recomputed.score, abs=1e-9)
        assert recommendation["delta"] == pytest.approx(recomputed.delta, abs=1e-9)
        assert recommendation["cost"] == recomputed.cost
    assert report["trace"]
    assert all(step["kind"] == "server" for step in report["trace"])
    assert all(step["ok"] for step in report["trace"])


def test_config_returns_frozen_catalog_distribution_and_stable_hash(client):
    response = client.get("/api/config")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"districts", "measures", "rules", "baseline", "distribution", "data_hash"}
    assert len(body["districts"]) == 5
    assert len(body["measures"]) == 14
    assert body["rules"]["budget"] == 100
    assert body["baseline"] == pytest.approx(52.558, abs=5e-4)
    assert body["distribution"]["count"] == 694395
    assert body["distribution"]["worse_than_baseline"] == 20003
    assert len(body["distribution"]["quantiles"]) == 1000
    assert body["data_hash"] == get_catalog().data_hash
    assert client.get("/api/config").json()["data_hash"] == body["data_hash"]
    assert client.get("/api/health").json()["data_hash"] == body["data_hash"]


def test_validate_uses_http_200_for_semantically_invalid_but_structured_json(client):
    valid = client.post("/api/validate", json=scenario_body())
    assert valid.status_code == 200
    assert valid.json() == {"ok": True, "violations": []}

    invalid = client.post("/api/validate", json=scenario_body("invalid_budget"))
    assert invalid.status_code == 200
    assert invalid.json()["ok"] is False
    assert [item["code"] for item in invalid.json()["violations"]] == ["BUDGET_EXCEEDED"]


@pytest.mark.parametrize(
    ("name", "code", "decision_idx"),
    [
        ("invalid_budget", "BUDGET_EXCEEDED", None),
        ("unknown_measure", "UNKNOWN_MEASURE", 4),
        ("unknown_district", "UNKNOWN_DISTRICT", 0),
    ],
)
def test_evaluate_semantic_errors_use_validation_result_shape(client, name, code, decision_idx):
    response = client.post("/api/evaluate", json=scenario_body(name))
    body = assert_validation_error(response, code, decision_idx=decision_idx)
    if code == "BUDGET_EXCEEDED":
        assert "29" in body["violations"][0]["message"]


@pytest.mark.parametrize("endpoint", ["validate", "evaluate", "analyze?provider=rules"])
@pytest.mark.parametrize("body", [{"decisions": "x"}, {}, {"decisions": [None]}])
def test_structurally_invalid_requests_use_bad_request_shape(client, endpoint, body):
    response = client.post(f"/api/{endpoint}", json=body)
    assert_validation_error(response, "BAD_REQUEST")


@pytest.mark.parametrize("endpoint", ["validate", "evaluate", "analyze?provider=rules"])
def test_broken_json_uses_same_validation_result_shape(client, endpoint):
    response = client.post(
        f"/api/{endpoint}", content='{"decisions":', headers={"Content-Type": "application/json"}
    )
    assert_validation_error(response, "BAD_REQUEST")


def test_evaluate_example_returns_official_engine_result(client):
    response = client.post("/api/evaluate", json=scenario_body())
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["score"] == pytest.approx(56.543, abs=5e-4)
    assert body["cost"] == 95
    assert body["remaining"] == 5
    assert body["n_crit"] == 0
    assert body["percentile"] > 99
    assert body["data_hash"] == get_catalog().data_hash
    assert body["timeline"][0]["score"] == body["baseline"]
    assert body["timeline"][-1]["score"] == body["score"]


@pytest.mark.parametrize("provider_query", ["?provider=rules", ""])
def test_rules_analysis_has_grounded_claims_and_verified_recommendations(client, provider_query):
    original = scenario_body()
    response = client.post(f"/api/analyze{provider_query}", json=original)
    assert response.status_code == 200
    assert_verified_report(response.json(), original)


@pytest.mark.parametrize("query", ["?provider=rules", "?provider=rules&stream=1"])
def test_analyze_rejects_invalid_plan_before_creating_report(client, query):
    response = client.post(f"/api/analyze{query}", json=scenario_body("invalid_budget"))
    assert_validation_error(response, "BUDGET_EXCEEDED")


def test_rules_analysis_bypasses_llm_semaphore(client):
    class ForbiddenSemaphore:
        async def acquire(self):
            raise AssertionError("Rules must bypass the LLM semaphore")

        async def __aenter__(self):
            raise AssertionError("Rules must bypass the LLM semaphore")

        async def __aexit__(self, *args):
            return False

    client.app.state.analyze_semaphore = ForbiddenSemaphore()
    response = client.post("/api/analyze?provider=rules", json=scenario_body())
    assert response.status_code == 200
    assert response.json()["provider"] == "rules"


def test_stream_sends_server_traces_then_complete_report_then_done(client):
    original = scenario_body()
    response = client.post("/api/analyze?provider=rules&stream=1", json=original)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = []
    for block in response.text.replace("\r\n", "\n").strip().split("\n\n"):
        fields = dict(line.split(":", 1) for line in block.splitlines() if ":" in line)
        events.append((fields["event"].strip(), json.loads(fields["data"].strip())))
    names = [name for name, _ in events]
    assert names[-2:] == ["report", "done"]
    assert names[:-2] and set(names[:-2]) == {"trace"}
    report = events[-2][1]
    assert_verified_report(report, original)
    assert [data for name, data in events if name == "trace"] == report["trace"]


def test_dev_cors_accepts_frontend_preflight_and_actual_request(client):
    origin = "http://localhost:5173"
    response = client.options(
        "/api/evaluate",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    response = client.post("/api/evaluate", json=scenario_body(), headers={"Origin": origin})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize("empty_directory", [False, True])
def test_missing_frontend_build_returns_json_hint(tmp_path, monkeypatch, empty_directory):
    target = tmp_path / "dist"
    if empty_directory:
        target.mkdir()
        (target / ".gitkeep").touch()
    monkeypatch.setattr(app_main, "WEB_DIST", target)
    with TestClient(app_main.create_app(Settings(ai_provider="rules"))) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")
        assert isinstance(response.json(), dict)
        assert response.json()
        assert client.get("/api/health").status_code == 200


def test_frontend_static_mount_does_not_shadow_api_or_docs(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<html>B2_TEST_FRONTEND</html>", encoding="utf-8")
    (tmp_path / "bundle-abcd1234.js").write_text("window.b2 = true;", encoding="utf-8")
    monkeypatch.setattr(app_main, "WEB_DIST", tmp_path)
    with TestClient(app_main.create_app(Settings(ai_provider="rules"))) as client:
        for path in ("/", "/index.html"):
            response = client.get(path)
            assert response.status_code == 200
            assert "B2_TEST_FRONTEND" in response.text
            assert response.headers["cache-control"] == "no-cache"
            conditional = client.get(path, headers={"If-None-Match": response.headers["etag"]})
            assert conditional.status_code == 304
            assert conditional.headers["cache-control"] == "no-cache"
            assert conditional.headers["etag"] == response.headers["etag"]
        script = client.get("/bundle-abcd1234.js")
        assert script.text == "window.b2 = true;"
        assert "cache-control" not in script.headers
        script_conditional = client.get(
            "/bundle-abcd1234.js", headers={"If-None-Match": script.headers["etag"]}
        )
        assert script_conditional.status_code == 304
        assert "cache-control" not in script_conditional.headers
        assert client.get("/api/health").json()["status"] == "ok"
        assert client.get("/api/config").status_code == 200
        assert client.post("/api/evaluate", json=scenario_body()).status_code == 200
        assert client.get("/docs").status_code == 200
        schema = client.get("/openapi.json").json()
        assert client.get("/api/openapi.json").json() == schema
        assert "/api/evaluate" in schema["paths"]
        assert "/api/analyze" in schema["paths"]
        for path in ("/api/validate", "/api/evaluate", "/api/analyze"):
            error_schema = schema["paths"][path]["post"]["responses"]["422"]["content"]
            assert error_schema["application/json"]["schema"]["$ref"].endswith("/ValidationResult")
