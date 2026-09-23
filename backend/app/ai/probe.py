"""Non-fatal startup check of the configured model's availability."""

import logging

from openai import AsyncOpenAI, OpenAIError

from app.config import Settings
from app.engine.models import ModelStatus

logger = logging.getLogger(__name__)


async def check_model(settings: Settings) -> ModelStatus:
    if not settings.use_llm:
        return "unchecked"
    try:
        async with AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            timeout=120.0,
            max_retries=1,
        ) as client:
            models = await client.models.list()
            async for model in models:
                if model.id == settings.openai_model:
                    return "ok"
    except OpenAIError:
        # SDK errors may contain request details; never log their raw text.
        logger.warning("Список моделей OpenAI недоступен; model_status=unchecked")
        return "unchecked"
    logger.warning("OPENAI_MODEL отсутствует в списке; работа продолжается")
    return "not_in_list"
