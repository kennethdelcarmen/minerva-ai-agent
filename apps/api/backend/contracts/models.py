"""Shared request, response, and event contracts."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator

from backend.model_catalog import DEFAULT_GOOGLE_MODEL, GOOGLE_MODEL_OPTIONS, is_supported_google_model


def utc_now() -> datetime:
    """Return a timezone-aware UTC timestamp."""

    return datetime.now(timezone.utc)


class RunStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    WAITING_FOR_APPROVAL = "waiting_for_approval"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    STOPPED = "stopped"


class EventType(str, Enum):
    PLAN = "plan"
    ACTION = "action"
    OBSERVATION = "observation"
    APPROVAL = "approval"
    ERROR = "error"
    RESULT = "result"


class ApprovalDecision(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"


class CreateRunRequest(BaseModel):
    task: str = Field(min_length=1, description="Natural-language browser task.")
    model: str | None = Field(default=None, description="Optional Google AI Studio model override.")

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str | None) -> str | None:
        if value is None:
            return value

        if not is_supported_google_model(value):
            supported_models = ", ".join(option.id for option in GOOGLE_MODEL_OPTIONS)
            raise ValueError(f"model must be one of: {supported_models}")
        return value


class ApprovalDecisionRequest(BaseModel):
    decision: ApprovalDecision
    note: str | None = None


class PendingApprovalResponse(BaseModel):
    id: str
    action_name: str
    params: dict[str, Any]
    reason: str
    requested_at: datetime


class ModelOptionResponse(BaseModel):
    id: str
    label: str


class ModelCatalogResponse(BaseModel):
    default_model: str = Field(default=DEFAULT_GOOGLE_MODEL)
    models: list[ModelOptionResponse]


class ArtifactKind(str, Enum):
    EVENT_LOG = "event_log"
    SCREENSHOT = "screenshot"
    RESULT = "result"
    TRACE = "trace"
    VIDEO = "video"
    HISTORY = "history"
    OTHER = "other"


class ArtifactDescriptor(BaseModel):
    kind: ArtifactKind
    path: str
    size_bytes: int


class RunEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    run_id: str
    sequence: int
    type: EventType
    summary: str
    timestamp: datetime = Field(default_factory=utc_now)
    data: dict[str, Any] = Field(default_factory=dict)


class RunStatusResponse(BaseModel):
    run_id: str
    status: RunStatus
    task: str
    model: str
    headless: bool
    current_step_summary: str | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    pending_approval_id: str | None = None
    pending_approval: PendingApprovalResponse | None = None
    last_error: str | None = None


class RunArtifactsResponse(BaseModel):
    run_id: str
    artifacts: list[ArtifactDescriptor]


class BrowserReadinessState(str, Enum):
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


class BrowserRuntimeReadiness(BaseModel):
    preflight: BrowserReadinessState
    provider: Literal["browserless", "local"]
    endpoint_host: str | None = None
    container_mode: bool
    chromium_sandbox: bool | None
    launch_args: list[str]
    last_error: str | None = None


class BrowserReadinessResponse(BaseModel):
    status: Literal["ok", "failed"]
    browser: BrowserRuntimeReadiness


class BrowserActionEnvelope(BaseModel):
    action_name: str
    params: dict[str, Any]


def classify_artifact(path: Path) -> ArtifactKind:
    """Infer the artifact kind from the relative path and extension."""

    if path.name == "events.jsonl":
        return ArtifactKind.EVENT_LOG
    if path.suffix.lower() == ".png":
        return ArtifactKind.SCREENSHOT
    if path.name == "result.json":
        return ArtifactKind.RESULT
    if "trace" in path.parts or path.suffix.lower() in {".zip", ".trace"}:
        return ArtifactKind.TRACE
    if path.suffix.lower() in {".webm", ".mp4"}:
        return ArtifactKind.VIDEO
    if path.name == "history.json":
        return ArtifactKind.HISTORY
    return ArtifactKind.OTHER
