"""Provider-independent contract for reports produced from engine facts."""

from typing import Protocol

from app.engine.catalog import Catalog
from app.engine.models import AnalysisReport, EvalResult, Fact, Scenario

RULES_PROMPT_VERSION = "rules-1.0.0"


class Explainer(Protocol):
    def explain(
        self,
        scenario: Scenario,
        result: EvalResult,
        facts: list[Fact],
        catalog: Catalog | None = None,
    ) -> AnalysisReport:
        """Explain a validated scenario using its calculated result and evidence."""
        ...
