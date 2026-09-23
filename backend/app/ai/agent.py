"""A bounded Responses tool loop with server-executed, observable engine tools."""

import asyncio
import json
from collections.abc import Awaitable, Callable
from time import perf_counter
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

from app.ai.llm import ProviderFailure
from app.engine.models import AnalysisReport, TraceStep

if TYPE_CHECKING:
    from app.ai.llm import OpenAIClient

TraceCallback = Callable[[TraceStep], Awaitable[None]]


def _check_response(response: Any) -> None:
    if getattr(response, "status", None) != "completed":
        raise ProviderFailure("incomplete")
    for item in getattr(response, "output", None) or ():
        for content in getattr(item, "content", None) or ():
            if getattr(content, "type", None) == "refusal":
                raise ProviderFailure("refusal")


def _record_response(owner: OpenAIClient, response: Any) -> None:
    usage = getattr(response, "usage", None)
    for name in ("input_tokens", "output_tokens", "total_tokens"):
        value = getattr(usage, name, None)
        if isinstance(value, int):
            owner.last_usage[name] = owner.last_usage.get(name, 0) + value
    model = getattr(response, "model", None)
    if isinstance(model, str) and model:
        owner.last_model = model


def _wire_item(item: BaseModel | dict) -> dict:
    """Replay complete output items, including reasoning and function-call IDs."""
    if isinstance(item, BaseModel):
        return item.model_dump(mode="json", exclude_none=True)
    if isinstance(item, dict):
        return dict(item)
    raise ProviderFailure("invalid_output")


def _summary(result: dict) -> str:
    if "error" in result:
        return "Инструмент вернул ошибку; агент может исправить запрос."
    if result.get("ok") is False:
        return "Сценарий отклонён валидатором; причины переданы агенту."
    if "neighbors" in result:
        return f"Проверено альтернатив: {len(result['neighbors'])}."
    if "score" in result:
        return f"Движок рассчитал Score: {result['score']:.2f}."
    return "Инструмент выполнил сравнение сценариев."


async def run_agent(
    owner: OpenAIClient,
    sdk: Any,
    system: str,
    user: str,
    tools: list[dict],
    max_rounds: int,
    *,
    on_trace: TraceCallback | None = None,
) -> tuple[AnalysisReport, list[TraceStep]]:
    from app.ai.tools import ToolExecutor

    if max_rounds < 1:
        raise ValueError("max_rounds must be positive")
    executor = ToolExecutor()
    items: list[dict] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    trace: list[TraceStep] = []

    async def emit(step: TraceStep) -> None:
        trace.append(step)
        if on_trace is not None:
            await on_trace(step)

    for round_index in range(max_rounds):
        response = await sdk.responses.create(
            model=owner.settings.openai_model,
            input=list(items),
            tools=tools,
            tool_choice="required" if round_index == 0 else "auto",
            temperature=0,
            max_output_tokens=16000,
        )
        _record_response(owner, response)
        _check_response(response)
        output = [_wire_item(item) for item in (getattr(response, "output", None) or ())]
        items.extend(output)
        calls = [item for item in output if item.get("type") == "function_call"]
        if not calls:
            break
        for call in calls:
            started = perf_counter()
            arguments = {}
            try:
                parsed_arguments = json.loads(call["arguments"])
                if not isinstance(parsed_arguments, dict):
                    raise ValueError("Tool arguments must be an object")
                # json.loads accepts NaN and overflowing exponents by default. Reject
                # them before keeping arguments in the public trace or invoking tools.
                json.dumps(parsed_arguments, allow_nan=False)
                arguments = parsed_arguments
                result = await asyncio.to_thread(executor.execute, call["name"], arguments)
                # Tools always return JSON objects. A broken executor is an error output,
                # not an opportunity for the model to invent a successful calculation.
                if not isinstance(result, dict):
                    raise ValueError("Tool result must be an object")
                output_json = json.dumps(result, ensure_ascii=False, allow_nan=False)
            except Exception:
                result = {"error": "Не удалось выполнить инструмент; проверьте имя и аргументы."}
                output_json = json.dumps(result, ensure_ascii=False)
            owner.tool_results.append(result)
            items.append(
                {
                    "type": "function_call_output",
                    "call_id": call["call_id"],
                    "output": output_json,
                }
            )
            await emit(
                TraceStep(
                    n=len(trace) + 1,
                    kind="agent",
                    tool=call["name"],
                    input=arguments,
                    output_summary=_summary(result),
                    ms=(perf_counter() - started) * 1000,
                    ok="error" not in result and result.get("ok") is not False,
                )
            )
    else:
        await emit(
            TraceStep(
                n=len(trace) + 1,
                kind="server",
                tool="agent_round_limit",
                input={"max_rounds": max_rounds},
                output_summary="Лимит раундов достигнут; формируется отчёт без новых инструментов.",
                ms=0,
                ok=True,
            )
        )

    response = await sdk.responses.parse(
        model=owner.settings.openai_model,
        input=[
            *items,
            {"role": "user", "content": "Сформируй итоговый отчёт по схеме из проверенных фактов."},
        ],
        text_format=AnalysisReport,
        tools=tools,
        tool_choice="none",
        temperature=0,
        max_output_tokens=16000,
    )
    _record_response(owner, response)
    _check_response(response)
    parsed = getattr(response, "output_parsed", None)
    if parsed is None:
        raise ProviderFailure("invalid_output")
    return AnalysisReport.model_validate(parsed), trace
