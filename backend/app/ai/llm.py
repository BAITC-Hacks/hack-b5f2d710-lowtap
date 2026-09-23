"""Small provider adapters; scenario arithmetic remains in the engine."""

from typing import TYPE_CHECKING, Any, Protocol

from openai import AsyncOpenAI
from pydantic import BaseModel

from app.ai.rules import RuleBasedExplainer
from app.config import Settings
from app.engine.catalog import Catalog
from app.engine.models import AnalysisReport, EvalResult, Fact, Scenario, TraceStep

if TYPE_CHECKING:
    from app.ai.cache import ReportCache


class ProviderFailure(RuntimeError):
    """A short internal reason safe to expose in a fallback provider label."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class LLMClient(Protocol):
    async def structured_call[ReportT: BaseModel](
        self, system: str, user: str, schema_model: type[ReportT]
    ) -> ReportT:
        """Produce one schema-validated result from server-authored input."""
        ...

    async def tool_loop(
        self, system: str, user: str, tools: list[dict], max_rounds: int
    ) -> tuple[BaseModel, list[TraceStep]]:
        """Run the bounded engine-tool loop introduced in B4."""
        ...


class OpenAIClient:
    def __init__(self, settings: Settings, sdk_client: Any | None = None):
        self.settings = settings
        self.sdk_client = sdk_client
        self.last_usage: dict[str, int] = {}
        self.last_model = settings.openai_model

    async def structured_call[ReportT: BaseModel](
        self, system: str, user: str, schema_model: type[ReportT]
    ) -> ReportT:
        if not self.settings.use_llm:
            raise ProviderFailure("not_configured")
        self.last_usage = {}
        self.last_model = self.settings.openai_model
        if self.sdk_client is not None:
            return await self._parse(self.sdk_client, system, user, schema_model)
        async with AsyncOpenAI(
            api_key=self.settings.openai_api_key,
            # Passing None makes the SDK reread even an empty OPENAI_BASE_URL.
            base_url=self.settings.openai_base_url or "https://api.openai.com/v1",
            timeout=120.0,
            max_retries=1,
        ) as client:
            return await self._parse(client, system, user, schema_model)

    async def _parse[ReportT: BaseModel](
        self, client: Any, system: str, user: str, schema_model: type[ReportT]
    ) -> ReportT:
        response = await client.responses.parse(
            model=self.settings.openai_model,
            input=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            text_format=schema_model,
            temperature=0,
            max_output_tokens=16000,
        )
        usage = getattr(response, "usage", None)
        for name in ("input_tokens", "output_tokens", "total_tokens"):
            value = getattr(usage, name, None)
            if isinstance(value, int):
                self.last_usage[name] = value
        model = getattr(response, "model", None)
        if isinstance(model, str) and model:
            self.last_model = model
        if getattr(response, "status", None) != "completed":
            raise ProviderFailure("incomplete")
        for item in getattr(response, "output", None) or ():
            for content in getattr(item, "content", None) or ():
                if getattr(content, "type", None) == "refusal":
                    raise ProviderFailure("refusal")
        parsed = getattr(response, "output_parsed", None)
        if parsed is None:
            raise ProviderFailure("invalid_output")
        return schema_model.model_validate(parsed)

    async def tool_loop(
        self, system: str, user: str, tools: list[dict], max_rounds: int
    ) -> tuple[BaseModel, list[TraceStep]]:
        raise NotImplementedError("Tool loop is implemented in stage B4")


class CacheClient:
    def __init__(self, cache: ReportCache):
        self.cache = cache

    def get(self, scenario: Scenario, model: str, prompt_version: str) -> AnalysisReport | None:
        return self.cache.get(scenario, model, prompt_version)

    def put(
        self, scenario: Scenario, model: str, prompt_version: str, report: AnalysisReport
    ) -> None:
        self.cache.put(scenario, model, prompt_version, report)


class RulesClient:
    def __init__(self, explainer: RuleBasedExplainer | None = None):
        self.explainer = explainer or RuleBasedExplainer()

    def explain(
        self,
        scenario: Scenario,
        result: EvalResult,
        facts: list[Fact],
        catalog: Catalog | None = None,
    ) -> AnalysisReport:
        return self.explainer.explain(scenario, result, facts, catalog)
