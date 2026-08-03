"""FastAPI dependencies."""

from __future__ import annotations

from fastapi import Request

from backend.agent.service import RunService


def get_run_service(request: Request) -> RunService:
    """Return the configured run service."""

    return request.app.state.run_service
