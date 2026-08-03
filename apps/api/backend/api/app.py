"""FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.agent.browser_use_runner import BrowserUseRunner
from backend.agent.service import RunService
from backend.api.routes import router
from backend.config import Settings, get_settings


def create_app(settings: Settings | None = None, run_service: RunService | None = None) -> FastAPI:
    """Create the API application."""

    if settings is not None or run_service is not None:
        resolved_settings = settings or get_settings()
        service = run_service or RunService(resolved_settings, BrowserUseRunner(resolved_settings))
        app = FastAPI(title="Minerva AI Agent Backend", version="0.1.0")
        app.state.settings = resolved_settings
        app.state.run_service = service
        app.include_router(router)
        return app

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        resolved_settings = get_settings()
        app.state.settings = resolved_settings
        app.state.run_service = RunService(resolved_settings, BrowserUseRunner(resolved_settings))
        yield

    app = FastAPI(title="Minerva AI Agent Backend", version="0.1.0", lifespan=lifespan)
    app.include_router(router)
    return app


app = create_app()
