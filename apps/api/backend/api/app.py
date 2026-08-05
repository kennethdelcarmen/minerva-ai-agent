"""FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.agent.browser_use_runner import BrowserUseRunner
from backend.agent.service import RunService
from backend.api.routes import router
from backend.contracts.models import BrowserReadinessResponse, BrowserReadinessState, BrowserRuntimeReadiness
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


def build_browser_readiness(
    settings: Settings,
    runner: BrowserUseRunner,
    *,
    preflight: BrowserReadinessState,
    last_error: str | None = None,
) -> BrowserReadinessResponse:
    launch_config = runner.browser_launch_config()
    status = "failed" if preflight == BrowserReadinessState.FAILED else "ok"
    return BrowserReadinessResponse(
        status=status,
        browser=BrowserRuntimeReadiness(
            preflight=preflight,
            container_mode=settings.browser_container_mode,
            chromium_sandbox=launch_config.chromium_sandbox,
            launch_args=launch_config.args,
            last_error=last_error,
        ),
    )


def create_app(
    settings: Settings | None = None,
    run_service: RunService | None = None,
    browser_readiness: BrowserReadinessResponse | None = None,
) -> FastAPI:
    """Create the API application."""

    if settings is not None or run_service is not None:
        resolved_settings = settings or get_settings()
        runner = BrowserUseRunner(resolved_settings)
        service = run_service or RunService(resolved_settings, runner)
        app = FastAPI(title="Minerva AI Agent Backend", version="0.1.0")
        app.state.settings = resolved_settings
        app.state.run_service = service
        app.state.browser_readiness = browser_readiness or build_browser_readiness(
            resolved_settings,
            runner,
            preflight=BrowserReadinessState.SKIPPED,
        )
        return configure_app(app, resolved_settings)

    resolved_settings = get_settings()
    runner = BrowserUseRunner(resolved_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = resolved_settings
        app.state.run_service = RunService(resolved_settings, runner)
        if resolved_settings.browser_preflight_on_startup:
            try:
                await runner.run_preflight()
            except Exception as exc:
                app.state.browser_readiness = build_browser_readiness(
                    resolved_settings,
                    runner,
                    preflight=BrowserReadinessState.FAILED,
                    last_error=str(exc),
                )
            else:
                app.state.browser_readiness = build_browser_readiness(
                    resolved_settings,
                    runner,
                    preflight=BrowserReadinessState.PASSED,
                )
        else:
            app.state.browser_readiness = build_browser_readiness(
                resolved_settings,
                runner,
                preflight=BrowserReadinessState.SKIPPED,
            )
        yield

    app = FastAPI(title="Minerva AI Agent Backend", version="0.1.0", lifespan=lifespan)
    return configure_app(app, resolved_settings)


app = create_app()
