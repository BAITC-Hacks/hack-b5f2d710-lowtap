"""Versioned report cache with atomic writes and portable offline demo entries."""

import json
import os
from hashlib import sha256
from pathlib import Path
from tempfile import NamedTemporaryFile

from app.config import DATA_DIR
from app.engine.catalog import canonical_json, get_catalog, scenario_id
from app.engine.models import ENGINE_VERSION, AnalysisReport, Scenario


def cache_key(scenario: Scenario, model: str, prompt_version: str) -> str:
    """Hash an unambiguous envelope of the canonical scenario and AI versions."""
    envelope = json.dumps(
        [canonical_json(scenario), model, prompt_version],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return sha256(envelope.encode("utf-8")).hexdigest()


def _reject_constant(value: str):
    raise ValueError(f"Invalid JSON constant: {value}")


class ReportCache:
    """Disk-backed cache; an unavailable cache never prevents provider fallback.

    Runtime entries live at ``root/runtime/<cache_key>.json``. Committed demo
    entries use the same ``{metadata, report}`` envelope at
    ``root/demo/<scenario_id>.json``. Demo model matching is relaxed only when
    the caller has no configured model, allowing offline use without a key.
    """

    def __init__(self, root: Path | None = None):
        self.root = Path(root) if root is not None else DATA_DIR / "cache"

    def get(self, scenario: Scenario, model: str, prompt_version: str) -> AnalysisReport | None:
        exact_path = self.root / "runtime" / f"{cache_key(scenario, model, prompt_version)}.json"
        report = self._read(exact_path, scenario, model, prompt_version, allow_saved_model=False)
        if report is not None:
            return report
        demo_path = self.root / "demo" / f"{scenario_id(scenario)}.json"
        return self._read(demo_path, scenario, model, prompt_version, allow_saved_model=not model)

    def _read(
        self,
        path: Path,
        scenario: Scenario,
        model: str,
        prompt_version: str,
        *,
        allow_saved_model: bool,
    ) -> AnalysisReport | None:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"), parse_constant=_reject_constant)
            if not isinstance(payload, dict) or not isinstance(payload.get("metadata"), dict):
                return None
            metadata = payload["metadata"]
            expected = {
                "data_hash": get_catalog().data_hash,
                "engine_version": ENGINE_VERSION,
                "scenario_id": scenario_id(scenario),
                "prompt_version": prompt_version,
            }
            if any(metadata.get(key) != value for key, value in expected.items()):
                return None
            saved_model = metadata.get("model")
            if not isinstance(saved_model, str) or (not allow_saved_model and saved_model != model):
                return None
            report = AnalysisReport.model_validate(payload.get("report"))
            if report.model != saved_model or report.prompt_version != prompt_version:
                return None
            # JSON overflow (1e400), coerced strings, and arbitrary trace.input
            # values can otherwise survive validation as infinities or NaN.
            # Such values break the JSON contract, especially SSE JSON.parse.
            json.dumps(report.model_dump(mode="python"), allow_nan=False)
            # Parsing on every read returns fresh nested objects; callers can mark
            # provider/cache state or run a guard without changing stored reports.
            return report
        except OSError, UnicodeError, ValueError, TypeError:
            return None

    def put(
        self,
        scenario: Scenario,
        model: str,
        prompt_version: str,
        report: AnalysisReport,
    ) -> None:
        temporary: Path | None = None
        try:
            if report.model != model or report.prompt_version != prompt_version:
                return
            # Validate before JSON mode can silently turn an Any-typed infinity
            # in trace.input into null.
            json.dumps(report.model_dump(mode="python"), allow_nan=False)
            payload = {
                "metadata": {
                    "data_hash": get_catalog().data_hash,
                    "engine_version": ENGINE_VERSION,
                    "scenario_id": scenario_id(scenario),
                    "model": model,
                    "prompt_version": prompt_version,
                },
                "report": report.model_dump(mode="json"),
            }
            encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
            directory = self.root / "runtime"
            directory.mkdir(parents=True, exist_ok=True)
            key = cache_key(scenario, model, prompt_version)
            destination = directory / f"{key}.json"
            with NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                newline="\n",
                dir=directory,
                prefix=f".{key}.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                temporary = Path(handle.name)
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, destination)
        except OSError, UnicodeError, ValueError, TypeError:
            # An unwritable cache is a missed optimization, never an API failure.
            return
        finally:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
