"""Canonical API schemas (pydantic v2)."""

from typing import Literal

from pydantic import BaseModel

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
