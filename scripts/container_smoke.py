"""Check the built application over HTTP with no SDK or external credentials."""

import argparse
import json
import sys
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
from time import monotonic, sleep
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PRESETS = ("example_tz", "cheapest", "naive_esil", "worst_of_all", "optimum")


class ScriptAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            source = dict(attrs).get("src", "")
            if source.startswith("/") and not source.startswith("//"):
                self.sources.append(source)


def read_scenario(name: str) -> dict:
    source = json.loads(
        (ROOT / "data/scenarios" / f"{name}.json").read_text(encoding="utf-8")
    )
    return {"decisions": source["decisions"]}


def run_checks(base_url: str) -> None:
    def request(path: str, body: dict | None = None, expected_status: int = 200):
        encoded = (
            json.dumps(body, ensure_ascii=False).encode("utf-8")
            if body is not None
            else None
        )
        http_request = Request(
            urljoin(base_url.rstrip("/") + "/", path.lstrip("/")),
            data=encoded,
            headers={"Content-Type": "application/json"} if encoded is not None else {},
        )
        try:
            response = urlopen(http_request, timeout=20)
        except HTTPError as exc:
            response = exc
        with response:
            status = response.status
            content_type = response.headers.get("Content-Type", "")
            text = response.read().decode("utf-8")
        assert status == expected_status, (
            f"{path}: expected HTTP {expected_status}, got {status}"
        )
        return content_type, text

    def get_json(path: str, body: dict | None = None, expected_status: int = 200):
        content_type, text = request(path, body, expected_status)
        assert "application/json" in content_type, f"{path}: expected JSON response"
        return json.loads(text)

    deadline = monotonic() + 60
    while True:
        try:
            health = get_json("/api/health")
            break
        except URLError, TimeoutError, AssertionError:
            if monotonic() >= deadline:
                raise
            sleep(1)
    assert health["status"] == "ok"
    assert health["provider"] == "rules"
    assert health["has_key"] is False, "Container smoke must run without an API key"
    assert health["model"] == health["model_fast"] == ""
    assert health["model_status"] == "unchecked"
    assert health["ai_cache"] == "first"

    config = get_json("/api/config")
    assert len(config["districts"]) == 5
    assert len(config["measures"]) == 14
    assert config["distribution"]["count"] == 694395
    assert config["distribution"]["worse_than_baseline"] == 20003
    expected_hash = sha256(
        b"".join(
            (ROOT / "data" / filename).read_bytes()
            for filename in ("districts.json", "measures.json", "rules.json")
        )
    ).hexdigest()[:12]
    assert config["data_hash"] == health["data_hash"] == expected_hash

    example = read_scenario("example_tz")
    evaluated = get_json("/api/evaluate", example)
    assert abs(evaluated["score"] - 56.543) <= 5e-4
    assert evaluated["cost"] == 95
    assert evaluated["n_crit"] == 0
    assert evaluated["percentile"] > 99
    rejected = get_json("/api/evaluate", read_scenario("invalid_budget"), 422)
    assert rejected["ok"] is False
    assert [item["code"] for item in rejected["violations"]] == ["BUDGET_EXCEEDED"]

    rules = get_json("/api/analyze?provider=rules", example)
    assert rules["provider"] == "rules"
    for section in ("strengths", "risks", "consequences", "tradeoffs", "city_impact"):
        assert rules[section]
    assert rules["recommendations"]
    for recommendation in rules["recommendations"]:
        assert recommendation["verified"] is True
        assert recommendation["invalid_reason"] is None
    assert not rules["verified_numbers"]["unverified"]

    content_type, text = request("/api/analyze?provider=rules&stream=1", example)
    assert content_type.startswith("text/event-stream")
    events = []
    for block in text.replace("\r\n", "\n").strip().split("\n\n"):
        fields = dict(line.split(":", 1) for line in block.splitlines() if ":" in line)
        events.append((fields["event"].strip(), json.loads(fields["data"].strip())))
    event_names = [name for name, _ in events]
    assert event_names[-2:] == ["report", "done"]
    assert event_names[:-2] and set(event_names[:-2]) == {"trace"}
    assert events[-2][1]["provider"] == "rules"

    for name in PRESETS:
        cached = get_json("/api/analyze", read_scenario(name))
        assert cached["provider"] == "cache", (
            f"{name}: committed demo cache was not loaded"
        )
        assert cached["cached"] is True
        assert any(step["kind"] == "agent" and step["ok"] for step in cached["trace"])
        assert not cached["verified_numbers"]["unverified"]
        assert all(item["verified"] for item in cached["recommendations"])

    content_type, root = request("/")
    if (ROOT / "web/package.json").exists():
        assert "text/html" in content_type
        assert "<html" in root.lower()
        assets = ScriptAssets()
        assets.feed(root)
        assert assets.sources, "Built frontend must reference a local JavaScript asset"
        for source in assets.sources:
            _, asset = request(source)
            assert asset.strip()
    else:
        assert "application/json" in content_type
        assert json.loads(root)
    assert "text/html" in request("/docs")[0]
    assert "/api/evaluate" in get_json("/openapi.json")["paths"]
    print("PASS: health, 5 districts, 14 measures, 694395 plans, 20003 below baseline")
    print("PASS: example score 56.543, cost 95, n_crit 0; invalid plan HTTP 422")
    print(
        "PASS: rules report, SSE trace/report/done, 5/5 keyless demo cache, frontend assets"
    )


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    try:
        run_checks(args.base_url)
    except (AssertionError, URLError, TimeoutError, ValueError, OSError) as exc:
        print(f"FAIL: container smoke ({type(exc).__name__}): {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
