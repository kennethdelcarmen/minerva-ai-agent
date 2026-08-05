from __future__ import annotations

import asyncio
import os
import time
from contextlib import contextmanager
from pathlib import Path
from threading import Event
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.agent.service import ManagedRunContext, RunService

os.environ.setdefault("OPENROUTER_API_KEY", "test-key")
os.environ.setdefault("OPENROUTER_MODEL", "google/gemini-2.5-flash:free")

from backend.api.app import create_app
from backend.config import Settings
from backend.contracts.models import EventType


class FakeRunner:
    def __init__(self, mode: str = "success"):
        self.mode = mode
        self.started = Event()
        self.finished = Event()
        self.stop_seen = Event()

    async def run(self, context: ManagedRunContext) -> dict[str, Any]:
        context.register_stop_callback(lambda: self.stop_seen.set())
        self.started.set()
        await context.emit_event(EventType.PLAN, "Fake runner planning.", {"task": context.request.task})
        await context.emit_event(
            EventType.ACTION,
            'Executing "click".',
            {"action_name": "click", "params": {"index": 1}},
        )

        if self.mode == "approval":
            await context.request_approval("click", {"index": 1}, "Click requires approval.")
            await context.emit_event(EventType.OBSERVATION, "Approval handled.", {"action_name": "click"})

        if self.mode == "stop":
            while not context.stop_event.is_set():
                await asyncio.sleep(0.01)
            self.finished.set()
            return {"success": False, "final_output": None, "error": "Stopped."}

        if self.mode == "error":
            raise RuntimeError("fake runner failure")

        self.finished.set()
        return {"success": True, "final_output": "done", "steps": 1}


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        OPENROUTER_API_KEY="test-key",
        ARTIFACT_ROOT=tmp_path,
        HEADLESS=True,
        OPENROUTER_MODEL="google/gemini-2.5-flash:free",
    )


@contextmanager
def create_test_client(settings: Settings, runner: FakeRunner):
    service = RunService(settings, runner)
    app = create_app(settings=settings, run_service=service)
    with TestClient(app) as client:
        yield client


def wait_for_status(client: TestClient, run_id: str, expected: str, timeout: float = 2.0) -> dict[str, Any]:
    deadline = time.time() + timeout
    last_status: dict[str, Any] | None = None
    while time.time() < deadline:
        last_status = client.get(f"/runs/{run_id}").json()
        if last_status["status"] == expected:
            return last_status
        time.sleep(0.01)
    raise AssertionError(f"run did not reach status {expected!r}; last status was {last_status}")


def test_healthcheck(settings: Settings) -> None:
    runner = FakeRunner()
    with create_test_client(settings, runner) as client:
        response = client.get("/healthz")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


def test_create_run_and_status(settings: Settings) -> None:
    runner = FakeRunner()
    with create_test_client(settings, runner) as client:
        response = client.post("/runs", json={"task": "Open example.com"})
        assert response.status_code == 201
        payload = response.json()
        assert payload["status"] in {"pending", "running"}
        run_id = payload["run_id"]

        assert runner.finished.wait(timeout=2)

        status = client.get(f"/runs/{run_id}")
        assert status.status_code == 200
        assert status.json()["task"] == "Open example.com"
        assert status.json()["headless"] is True


def test_create_run_ignores_client_headless_override(settings: Settings) -> None:
    runner = FakeRunner()
    with create_test_client(settings, runner) as client:
        response = client.post("/runs", json={"task": "Open example.com", "headless": False})
        assert response.status_code == 201
        assert response.json()["headless"] is True


def test_sse_stream_emits_typed_events(settings: Settings) -> None:
    runner = FakeRunner()
    with create_test_client(settings, runner) as client:
        run_id = client.post("/runs", json={"task": "Collect events"}).json()["run_id"]

        with client.stream("GET", f"/runs/{run_id}/events") as response:
            body = "".join(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk for chunk in response.iter_raw())

        assert "event: plan" in body
        assert "event: action" in body
        assert "event: result" in body


def test_approval_blocks_until_decision(settings: Settings) -> None:
    runner = FakeRunner(mode="approval")
    with create_test_client(settings, runner) as client:
        run_id = client.post("/runs", json={"task": "Click gated button"}).json()["run_id"]

        status = wait_for_status(client, run_id, "waiting_for_approval")

        approval_id = status["pending_approval_id"]
        assert status["pending_approval"] == {
            "id": approval_id,
            "action_name": "click",
            "params": {"index": 1},
            "reason": "Click requires approval.",
            "requested_at": status["pending_approval"]["requested_at"],
        }
        response = client.post(
            f"/runs/{run_id}/approvals/{approval_id}",
            json={"decision": "approve", "note": "Proceed"},
        )
        assert response.status_code == 200

        wait_for_status(client, run_id, "succeeded")


def test_approval_rejection_is_terminal(settings: Settings) -> None:
    runner = FakeRunner(mode="approval")
    with create_test_client(settings, runner) as client:
        run_id = client.post("/runs", json={"task": "Reject gated click"}).json()["run_id"]

        status = wait_for_status(client, run_id, "waiting_for_approval")

        approval_id = status["pending_approval_id"]
        response = client.post(
            f"/runs/{run_id}/approvals/{approval_id}",
            json={"decision": "reject", "note": "Stop"},
        )
        assert response.status_code == 200

        wait_for_status(client, run_id, "failed")


def test_stop_cancels_active_run(settings: Settings) -> None:
    runner = FakeRunner(mode="stop")
    with create_test_client(settings, runner) as client:
        run_id = client.post("/runs", json={"task": "Stop me"}).json()["run_id"]

        response = client.post(f"/runs/{run_id}/stop")
        assert response.status_code == 200
        assert response.json()["status"] == "stopped"

        assert runner.stop_seen.wait(timeout=1)


def test_artifacts_are_persisted(settings: Settings) -> None:
    runner = FakeRunner()
    with create_test_client(settings, runner) as client:
        run_id = client.post("/runs", json={"task": "Persist artifacts"}).json()["run_id"]

        wait_for_status(client, run_id, "succeeded")

        artifacts = client.get(f"/runs/{run_id}/artifacts")
        assert artifacts.status_code == 200
        artifact_paths = {item["path"] for item in artifacts.json()["artifacts"]}
        assert "events.jsonl" in artifact_paths
        assert "result.json" in artifact_paths


def test_artifact_file_is_served(settings: Settings) -> None:
    runner = FakeRunner()
    with create_test_client(settings, runner) as client:
        run_id = client.post("/runs", json={"task": "Serve artifact"}).json()["run_id"]

        wait_for_status(client, run_id, "succeeded")

        screenshot_path = settings.artifact_root / run_id / "screenshots" / "step-001.png"
        screenshot_path.write_bytes(b"png-bytes")

        artifact = client.get(f"/runs/{run_id}/artifacts/screenshots/step-001.png")
        assert artifact.status_code == 200
        assert artifact.content == b"png-bytes"


def test_artifact_path_traversal_is_rejected(settings: Settings) -> None:
    runner = FakeRunner()
    with create_test_client(settings, runner) as client:
        run_id = client.post("/runs", json={"task": "Reject traversal"}).json()["run_id"]

        wait_for_status(client, run_id, "succeeded")

        traversal = client.get(f"/runs/{run_id}/artifacts/..%2Foutside.txt")
        assert traversal.status_code == 400
