"""Run orchestration and API-facing service layer."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Protocol
from uuid import uuid4

from backend.config import Settings
from backend.contracts.models import (
    ApprovalDecision,
    ArtifactDescriptor,
    CreateRunRequest,
    EventType,
    PendingApprovalResponse,
    RunArtifactsResponse,
    RunEvent,
    RunStatus,
    RunStatusResponse,
    utc_now,
)
from backend.agent.store import RunStore


class ApprovalRejectedError(Exception):
    """Raised when an operator rejects a gated action."""


@dataclass
class PendingApproval:
    id: str
    action_name: str
    params: dict[str, Any]
    reason: str
    requested_at: Any
    event: asyncio.Event = field(default_factory=asyncio.Event)
    decision: ApprovalDecision | None = None
    note: str | None = None


@dataclass
class RunRecord:
    id: str
    request: CreateRunRequest
    model: str
    headless: bool
    status: RunStatus
    run_dir: Path
    created_at: Any
    updated_at: Any
    completed_at: Any = None
    current_step_summary: str | None = None
    last_error: str | None = None
    pending_approval: PendingApproval | None = None
    sequence: int = 0
    subscribers: set[asyncio.Queue[RunEvent | None]] = field(default_factory=set)
    task_handle: asyncio.Task | None = None
    stop_event: asyncio.Event = field(default_factory=asyncio.Event)
    stop_callback: Callable[[], None] | None = None
    event_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class RunnerContext(Protocol):
    run_id: str
    request: CreateRunRequest
    model: str
    headless: bool
    run_dir: Path
    stop_event: asyncio.Event

    async def emit_event(self, event_type: EventType, summary: str, data: dict[str, Any] | None = None) -> RunEvent: ...

    async def request_approval(self, action_name: str, params: dict[str, Any], reason: str) -> None: ...

    async def update_summary(self, summary: str) -> None: ...

    def register_stop_callback(self, callback: Callable[[], None]) -> None: ...


class AgentRunner(Protocol):
    async def run(self, context: "ManagedRunContext") -> dict[str, Any]:
        """Execute a run and return a structured result payload."""


class ManagedRunContext:
    """Runner callbacks that mutate service-managed run state."""

    def __init__(self, service: "RunService", record: RunRecord):
        self._service = service
        self._record = record
        self.run_id = record.id
        self.request = record.request
        self.model = record.model
        self.headless = record.headless
        self.run_dir = record.run_dir
        self.stop_event = record.stop_event

    async def emit_event(self, event_type: EventType, summary: str, data: dict[str, Any] | None = None) -> RunEvent:
        return await self._service._append_event(self._record, event_type, summary, data or {})

    async def request_approval(self, action_name: str, params: dict[str, Any], reason: str) -> None:
        await self._service._request_approval(self._record, action_name, params, reason)

    async def update_summary(self, summary: str) -> None:
        self._record.current_step_summary = summary
        self._record.updated_at = utc_now()

    def register_stop_callback(self, callback: Callable[[], None]) -> None:
        self._record.stop_callback = callback


class RunService:
    """Manage active runs, event delivery, and artifact persistence."""

    def __init__(self, settings: Settings, runner: AgentRunner):
        self.settings = settings
        self.runner = runner
        self.store = RunStore(settings.artifact_root)
        self._runs: dict[str, RunRecord] = {}
        self._lock = asyncio.Lock()
        self._subscriber_queue_size = settings.event_subscriber_queue_size

    def _sanitize_text(self, value: str) -> str:
        return self.settings.redact_sensitive_text(value)

    def _sanitize_data(self, value: Any) -> Any:
        if isinstance(value, str):
            return self._sanitize_text(value)
        if isinstance(value, dict):
            return {key: self._sanitize_data(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._sanitize_data(item) for item in value]
        if isinstance(value, tuple):
            return tuple(self._sanitize_data(item) for item in value)
        return value

    async def create_run(self, request: CreateRunRequest) -> RunStatusResponse:
        run_id = str(uuid4())
        created_at = utc_now()
        record = RunRecord(
            id=run_id,
            request=request,
            model=request.model or self.settings.google_model,
            headless=self.settings.headless,
            status=RunStatus.PENDING,
            run_dir=self.store.create_run_dir(run_id),
            created_at=created_at,
            updated_at=created_at,
        )
        async with self._lock:
            self._runs[run_id] = record

        await self._append_event(
            record,
            EventType.PLAN,
            "Run created.",
            {
                "task": request.task,
                "model": record.model,
                "headless": record.headless,
            },
        )
        record.task_handle = asyncio.create_task(self._execute_run(record), name=f"run-{run_id}")
        return self._status_response(record)

    async def _execute_run(self, record: RunRecord) -> None:
        context = ManagedRunContext(self, record)
        record.status = RunStatus.RUNNING
        record.updated_at = utc_now()
        await self._append_event(record, EventType.PLAN, "Run started.", {"task": record.request.task})
        final_payload: dict[str, Any]
        try:
            final_payload = await self.runner.run(context)
            if record.stop_event.is_set() and record.status != RunStatus.STOPPED:
                record.status = RunStatus.STOPPED
            elif record.status not in {RunStatus.FAILED, RunStatus.STOPPED}:
                record.status = RunStatus.SUCCEEDED if final_payload.get("success", False) else RunStatus.FAILED
        except ApprovalRejectedError as exc:
            error_message = self._sanitize_text(str(exc))
            record.status = RunStatus.FAILED
            record.last_error = error_message
            final_payload = {"success": False, "error": error_message, "final_output": None}
            await self._append_event(record, EventType.ERROR, "Approval rejected.", {"error": error_message})
        except asyncio.CancelledError:
            record.status = RunStatus.STOPPED
            final_payload = {"success": False, "error": "Run cancelled.", "final_output": None}
            await self._append_event(record, EventType.ERROR, "Run cancelled.", {"error": "Run cancelled."})
            raise
        except Exception as exc:
            error_message = self._sanitize_text(str(exc))
            record.status = RunStatus.FAILED
            record.last_error = error_message
            final_payload = {"success": False, "error": error_message, "final_output": None}
            await self._append_event(record, EventType.ERROR, "Run failed.", {"error": error_message})
        finally:
            record.completed_at = utc_now()
            record.updated_at = record.completed_at
            result_summary = {
                RunStatus.SUCCEEDED: "Run completed successfully.",
                RunStatus.STOPPED: "Run stopped.",
            }.get(record.status, "Run finished with errors.")
            await self._append_event(
                record,
                EventType.RESULT,
                result_summary,
                {
                    "status": record.status.value,
                    **final_payload,
                },
            )
            self.store.write_result(record.run_dir, self._status_response(record), final_payload)
            await self._close_subscribers(record)
            await self._evict_run(record.id)

    async def get_run(self, run_id: str) -> RunStatusResponse:
        record = self._runs.get(run_id)
        if record is not None:
            return self._status_response(record)
        return self.store.read_status(self.store.resolve_run_dir(run_id))

    async def list_artifacts(self, run_id: str) -> RunArtifactsResponse:
        artifacts: list[ArtifactDescriptor] = self.store.list_artifacts(self._resolve_run_dir(run_id))
        return RunArtifactsResponse(run_id=run_id, artifacts=artifacts)

    async def get_artifact_path(self, run_id: str, artifact_path: str) -> Path:
        return self.store.resolve_artifact_path(self._resolve_run_dir(run_id), artifact_path)

    async def decide_approval(self, run_id: str, approval_id: str, decision: ApprovalDecision, note: str | None) -> RunStatusResponse:
        record = self._get_active_record(run_id)
        approval = record.pending_approval
        if approval is None or approval.id != approval_id:
            raise KeyError(f"Approval {approval_id} not found for run {run_id}")

        approval.decision = decision
        approval.note = note
        record.pending_approval = None
        record.updated_at = utc_now()
        if decision == ApprovalDecision.APPROVE:
            record.status = RunStatus.RUNNING
        else:
            record.status = RunStatus.FAILED
            record.last_error = f'Operator rejected "{approval.action_name}".'
        approval.event.set()
        return self._status_response(record)

    async def stop_run(self, run_id: str) -> RunStatusResponse:
        record = self._get_active_record(run_id)
        record.stop_event.set()
        record.status = RunStatus.STOPPED
        record.updated_at = utc_now()
        if record.stop_callback is not None:
            record.stop_callback()
        if record.pending_approval is not None:
            record.pending_approval.event.set()
        await self._append_event(record, EventType.ERROR, "Stop requested by operator.", {"status": "stopping"})
        return self._status_response(record)

    async def event_stream(self, run_id: str) -> AsyncIterator[RunEvent]:
        record = self._runs.get(run_id)
        if record is None:
            for event in self.store.iter_events(self.store.resolve_run_dir(run_id)):
                yield event
            return

        queue: asyncio.Queue[RunEvent | None] = asyncio.Queue(maxsize=self._subscriber_queue_size)
        async with record.event_lock:
            replay_until = record.sequence
            record.subscribers.add(queue)

        try:
            for event in self.store.iter_events(record.run_dir, up_to_sequence=replay_until):
                yield event

            while True:
                event = await queue.get()
                if event is None:
                    break
                yield event
        finally:
            record.subscribers.discard(queue)

    async def _append_event(
        self,
        record: RunRecord,
        event_type: EventType,
        summary: str,
        data: dict[str, Any],
    ) -> RunEvent:
        async with record.event_lock:
            record.sequence += 1
            record.current_step_summary = summary
            record.updated_at = utc_now()
            event = RunEvent(
                run_id=record.id,
                sequence=record.sequence,
                type=event_type,
                summary=summary,
                data=self._sanitize_data(data),
            )
            self.store.append_event(record.run_dir, event)
            for subscriber in tuple(record.subscribers):
                self._enqueue(subscriber, event)
            return event

    async def _request_approval(self, record: RunRecord, action_name: str, params: dict[str, Any], reason: str) -> None:
        approval = PendingApproval(
            id=str(uuid4()),
            action_name=action_name,
            params=params,
            reason=reason,
            requested_at=utc_now(),
        )
        record.pending_approval = approval
        record.status = RunStatus.WAITING_FOR_APPROVAL
        await self._append_event(
            record,
            EventType.APPROVAL,
            f'Approval required for "{action_name}".',
            {
                "approval_id": approval.id,
                "action_name": action_name,
                "params": params,
                "reason": reason,
            },
        )

        stop_wait = asyncio.create_task(record.stop_event.wait())
        approval_wait = asyncio.create_task(approval.event.wait())
        done, pending = await asyncio.wait({stop_wait, approval_wait}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()

        if record.pending_approval is approval:
            record.pending_approval = None

        if record.stop_event.is_set():
            raise ApprovalRejectedError("Run stopped while awaiting operator approval.")

        if approval.decision == ApprovalDecision.APPROVE:
            record.status = RunStatus.RUNNING
            await self._append_event(
                record,
                EventType.OBSERVATION,
                f'Approval granted for "{action_name}".',
                {"approval_id": approval.id, "note": approval.note},
            )
            return

        record.status = RunStatus.FAILED
        raise ApprovalRejectedError(f'Operator rejected "{action_name}".')

    async def _close_subscribers(self, record: RunRecord) -> None:
        async with record.event_lock:
            for subscriber in tuple(record.subscribers):
                self._enqueue(subscriber, None)
            record.subscribers.clear()

    async def _evict_run(self, run_id: str) -> None:
        async with self._lock:
            self._runs.pop(run_id, None)

    def _resolve_run_dir(self, run_id: str) -> Path:
        record = self._runs.get(run_id)
        if record is not None:
            return record.run_dir
        return self.store.resolve_run_dir(run_id)

    def _get_active_record(self, run_id: str) -> RunRecord:
        try:
            return self._runs[run_id]
        except KeyError as exc:
            raise KeyError(f"Run {run_id} not found") from exc

    def _enqueue(self, queue: asyncio.Queue[RunEvent | None], item: RunEvent | None) -> None:
        while True:
            try:
                queue.put_nowait(item)
                return
            except asyncio.QueueFull:
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    return

    def _status_response(self, record: RunRecord) -> RunStatusResponse:
        pending_approval = None
        if record.pending_approval is not None:
            pending_approval = PendingApprovalResponse(
                id=record.pending_approval.id,
                action_name=record.pending_approval.action_name,
                params=record.pending_approval.params,
                reason=record.pending_approval.reason,
                requested_at=record.pending_approval.requested_at,
            )

        return RunStatusResponse(
            run_id=record.id,
            status=record.status,
            task=record.request.task,
            model=record.model,
            headless=record.headless,
            current_step_summary=record.current_step_summary,
            created_at=record.created_at,
            updated_at=record.updated_at,
            completed_at=record.completed_at,
            pending_approval_id=record.pending_approval.id if record.pending_approval else None,
            pending_approval=pending_approval,
            last_error=record.last_error,
        )
