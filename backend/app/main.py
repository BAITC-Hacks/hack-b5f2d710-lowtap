import sys

# Configure UTF-8 before application imports; pytest can replace stdout with StringIO.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import __version__
from app.ai.probe import check_model
from app.api.routes import router
from app.config import Settings, data_hash


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings if settings is not None else Settings.from_env()
        app.state.data_hash = data_hash()
        app.state.model_status = await check_model(app.state.settings)
        yield

    app = FastAPI(title="Аким на 5 часов", version=__version__, lifespan=lifespan)
    app.include_router(router)
    return app


app = create_app()
