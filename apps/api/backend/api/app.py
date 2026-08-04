"""FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.agent.browser_use_runner import BrowserUseRunner
from backend.agent.service import RunService
from backend.api.routes import router
from backend.config import Settings, get_settings


def configure_app(app: FastAPI, settings: Settings) -> FastAPI:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    return app


def create_app(settings: Settings | None = None, run_service: RunService | None = None) -> FastAPI:
    """Create the API application."""

    if settings is not None or run_service is not None:
        resolved_settings = settings or get_settings()
        service = run_service or RunService(resolved_settings, BrowserUseRunner(resolved_settings))
        app = FastAPI(title="Minerva AI Agent Backend", version="0.1.0")
        app.state.settings = resolved_settings
        app.state.run_service = service
        return configure_app(app, resolved_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        resolved_settings = get_settings()
        app.state.settings = resolved_settings
        app.state.run_service = RunService(resolved_settings, BrowserUseRunner(resolved_settings))
        yield

    app = FastAPI(title="Minerva AI Agent Backend", version="0.1.0", lifespan=lifespan)
    return configure_app(app, get_settings())


app = create_app()
