import sys

# Configure UTF-8 before application imports; pytest can replace stdout with StringIO.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.ai.cache import ReportCache
from app.ai.probe import check_model
from app.api.routes import router
from app.config import WEB_DIST, Settings, data_hash
from app.engine.distribution import load_distribution
from app.engine.models import ValidationResult, Violation
from app.engine.scoring import InvalidScenario


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings if settings is not None else Settings.from_env()
        app.state.data_hash = data_hash()
        app.state.model_status = await check_model(app.state.settings)
        app.state.analyze_semaphore = asyncio.Semaphore(app.state.settings.analyze_concurrency)
        app.state.report_cache = ReportCache()
        # Load the exact CDF before serving requests; subsequent evaluations stay fast.
        load_distribution()
        yield

    app = FastAPI(title="Аким на 5 часов", version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(InvalidScenario)
    async def invalid_scenario_handler(request: Request, exc: InvalidScenario):
        return JSONResponse(status_code=422, content=exc.validation.model_dump())

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(request: Request, exc: RequestValidationError):
        violations = []
        for error in exc.errors():
            location = error["loc"]
            index = (
                location[2]
                if len(location) > 2 and location[1] == "decisions" and isinstance(location[2], int)
                else None
            )
            path = ".".join(str(part) for part in location)
            violations.append(
                Violation(
                    code="BAD_REQUEST",
                    message=f"Некорректная структура запроса: {path}.",
                    decision_idx=index,
                    measures=[],
                )
            )
        result = ValidationResult(ok=False, violations=violations)
        return JSONResponse(status_code=422, content=result.model_dump())

    app.include_router(router)
    if WEB_DIST.is_dir():
        app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="frontend")
    else:

        @app.get("/", include_in_schema=False)
        def frontend_hint():
            return {"message": "Бэкенд запущен. Соберите web/dist для интерфейса.", "docs": "/docs"}

    return app


app = create_app()
