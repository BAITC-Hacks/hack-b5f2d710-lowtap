"""Offline checks of the B0 health contract and startup configuration."""

from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from openai import OpenAIError

from app import __version__
from app.config import Settings
from app.main import create_app

FAKE_KEY = "test-only-secret-never-send"
ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def forbid_unmocked_openai(monkeypatch):
    """No test can accidentally send a local .env key to the network."""
    client_factory = MagicMock(side_effect=AssertionError("Unexpected OpenAI client"))
    monkeypatch.setattr("app.ai.probe.AsyncOpenAI", client_factory)
    return client_factory


def test_health_contract_and_data_hash_from_unrelated_workdir(tmp_path, monkeypatch):
    frozen_bytes = b"".join(
        (ROOT / "data" / name).read_bytes()
        for name in ("districts.json", "measures.json", "rules.json")
    )
    expected_hash = sha256(frozen_bytes).hexdigest()[:12]
    monkeypatch.chdir(tmp_path)

    with TestClient(create_app(Settings(ai_cache="fallback"))) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "provider": "rules",
        "ai_cache": "fallback",
        "model": "",
        "model_fast": "",
        "has_key": False,
        "model_status": "unchecked",
        "data_hash": expected_hash,
        "version": __version__,
    }


def test_rules_mode_does_not_probe_or_expose_key(forbid_unmocked_openai):
    settings = Settings(
        openai_api_key=FAKE_KEY,
        openai_model="test-main",
        openai_model_fast="test-fast",
        ai_provider="rules",
    )

    with TestClient(create_app(settings)) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["provider"] == "rules"
    assert response.json()["has_key"] is True
    assert response.json()["model_status"] == "unchecked"
    assert FAKE_KEY not in response.text
    assert FAKE_KEY not in repr(settings)
    forbid_unmocked_openai.assert_not_called()


@pytest.mark.parametrize(
    ("listed_models", "raises_error", "expected_status"),
    [
        (["test-other", "test-main"], False, "ok"),
        (["test-other"], False, "not_in_list"),
        ([], True, "unchecked"),
    ],
    ids=["available", "missing", "sdk-error"],
)
def test_startup_model_status_is_nonfatal_and_secret_safe(
    listed_models, raises_error, expected_status, monkeypatch, caplog
):
    page = MagicMock()
    page.__aiter__.return_value = [SimpleNamespace(id=name) for name in listed_models]
    list_models = AsyncMock(return_value=page)
    if raises_error:
        list_models.side_effect = OpenAIError(f"Request failed with {FAKE_KEY}")
    sdk_client = SimpleNamespace(models=SimpleNamespace(list=list_models))
    context = AsyncMock()
    context.__aenter__.return_value = sdk_client
    monkeypatch.setattr("app.ai.probe.AsyncOpenAI", MagicMock(return_value=context))
    settings = Settings(openai_api_key=FAKE_KEY, openai_model="test-main")

    with TestClient(create_app(settings)) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["provider"] == "llm"
    assert response.json()["model_status"] == expected_status
    assert response.json()["has_key"] is True
    list_models.assert_awaited_once()
    assert FAKE_KEY not in response.text
    assert FAKE_KEY not in caplog.text


@pytest.mark.parametrize(
    ("api_key", "model", "provider", "has_key", "use_llm"),
    [
        ("", "test-main", "auto", False, False),
        (FAKE_KEY, "", "auto", True, False),
        (FAKE_KEY, "", "llm", True, False),
        (FAKE_KEY, "test-main", "rules", True, False),
        (FAKE_KEY, "test-main", "auto", True, True),
    ],
    ids=["no-key", "no-model", "forced-llm-without-model", "forced-rules", "configured"],
)
def test_environment_provider_selection(api_key, model, provider, has_key, use_llm, monkeypatch):
    # Set every supported variable, regardless of an existing local .env.
    values = {
        "OPENAI_API_KEY": api_key,
        "OPENAI_MODEL": model,
        "OPENAI_MODEL_FAST": "",
        "OPENAI_BASE_URL": " ",
        "AI_PROVIDER": provider,
        "AI_CACHE": "first",
        "MAX_TOOL_ROUNDS": "6",
        "ANALYZE_CONCURRENCY": "2",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)

    settings = Settings.from_env()

    assert settings.has_key is has_key
    assert settings.use_llm is use_llm
    assert settings.openai_base_url is None
    assert settings.openai_model_fast == ""
    assert FAKE_KEY not in repr(settings)
