from fastapi import APIRouter, Request

from app import __version__
from app.engine.models import HealthResponse

router = APIRouter(prefix="/api")


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    return HealthResponse(
        provider="llm" if settings.use_llm else "rules",
        ai_cache=settings.ai_cache,
        model=settings.openai_model,
        model_fast=settings.openai_model_fast,
        has_key=settings.has_key,
        model_status=request.app.state.model_status,
        data_hash=request.app.state.data_hash,
        version=__version__,
    )
