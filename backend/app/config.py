"""Environment configuration and paths independent of the working directory."""

import os
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
WEB_DIST = ROOT / "web" / "dist"

load_dotenv(ROOT / ".env", override=False, encoding="utf-8")


@dataclass(frozen=True)
class Settings:
    openai_api_key: str = field(default="", repr=False)
    openai_model: str = ""
    openai_model_fast: str = ""
    openai_base_url: str | None = None
    ai_provider: str = "auto"
    ai_cache: str = "first"
    max_tool_rounds: int = 6
    analyze_concurrency: int = 2

    @classmethod
    def from_env(cls) -> Settings:
        settings = cls(
            openai_api_key=os.getenv("OPENAI_API_KEY", "").strip(),
            openai_model=os.getenv("OPENAI_MODEL", "").strip(),
            openai_model_fast=os.getenv("OPENAI_MODEL_FAST", "").strip(),
            openai_base_url=os.getenv("OPENAI_BASE_URL", "").strip() or None,
            ai_provider=os.getenv("AI_PROVIDER", "auto"),
            ai_cache=os.getenv("AI_CACHE", "first"),
            max_tool_rounds=int(os.getenv("MAX_TOOL_ROUNDS", "6")),
            analyze_concurrency=int(os.getenv("ANALYZE_CONCURRENCY", "2")),
        )
        if settings.ai_provider not in {"auto", "llm", "rules"}:
            raise ValueError("AI_PROVIDER должен быть auto, llm или rules")
        if settings.ai_cache not in {"first", "fallback", "0"}:
            raise ValueError("AI_CACHE должен быть first, fallback или 0")
        if settings.max_tool_rounds < 1 or settings.analyze_concurrency < 1:
            raise ValueError("MAX_TOOL_ROUNDS и ANALYZE_CONCURRENCY должны быть > 0")
        return settings

    @property
    def has_key(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def use_llm(self) -> bool:
        return self.ai_provider != "rules" and self.has_key and bool(self.openai_model)


def data_hash() -> str:
    """Hash the frozen inputs in the contract's byte order, without separators."""
    digest = sha256()
    for name in ("districts.json", "measures.json", "rules.json"):
        digest.update((DATA_DIR / name).read_bytes())
    return digest.hexdigest()[:12]
