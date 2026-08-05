from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.agent import browser_use_runner as runner_module
from backend.agent.browser_use_runner import BrowserUseRunner
from backend.config import Settings
from backend.contracts.models import EventType


class FakeActionResult:
    def model_dump(self, exclude_none: bool = True) -> dict[str, str]:
        return {"status": "ok"}


class FakeRegistry:
    async def execute_action(self, *, action_name: str, params: dict, **kwargs) -> FakeActionResult:
        return FakeActionResult()


class FakeHistory:
    def is_successful(self) -> bool:
        return True

    def final_result(self) -> str:
        return "done"

    def number_of_steps(self) -> int:
        return 1

    def urls(self) -> list[str]:
        return ["https://example.com/docs"]


class FakeBrowserSession:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.browser_state_reads = 0

    async def take_screenshot(self, path: str) -> None:
        screenshot_path = Path(path)
        screenshot_path.parent.mkdir(parents=True, exist_ok=True)
        screenshot_path.write_bytes(b"png")

    async def get_browser_state_summary(self) -> SimpleNamespace:
        self.browser_state_reads += 1
        return SimpleNamespace(url="https://example.com/docs", title="Docs")


class FakeAgent:
    def __init__(self, *, task: str, llm, browser_session: FakeBrowserSession, save_conversation_path: str):
        self.task = task
        self.llm = llm
        self.browser_session = browser_session
        self.save_conversation_path = save_conversation_path
        self.state = SimpleNamespace(
            last_model_output=SimpleNamespace(next_goal="Inspect the docs page.", memory="Opened docs"),
            n_steps=0,
        )
        self.tools = SimpleNamespace(registry=FakeRegistry())
        self.stop_called = False
        self.closed = False

    def stop(self) -> None:
        self.stop_called = True

    async def run(self, *, max_steps: int, on_step_end) -> FakeHistory:
        await self.tools.registry.execute_action(action_name="click", params={"description": "Open docs link"})
        self.state.n_steps = 1
        await on_step_end(self)
        return FakeHistory()

    def save_history(self, path: Path) -> None:
        Path(path).write_text("{}", encoding="utf-8")

    async def close(self) -> None:
        self.closed = True


class FakeContext:
    def __init__(self, run_dir: Path):
        self.run_id = "run-123"
        self.request = SimpleNamespace(task="Open the docs")
        self.model = "google/gemini-2.5-flash:free"
        self.headless = True
        self.run_dir = run_dir
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.stop_event = SimpleNamespace(is_set=lambda: False)
        self.events: list[dict[str, object]] = []
        self.stop_callback = None
        self.summary: str | None = None
        self.approval_requests: list[dict[str, object]] = []

    async def emit_event(self, event_type: EventType, summary: str, data: dict | None = None) -> dict[str, object]:
        event = {"type": event_type, "summary": summary, "data": data or {}}
        self.events.append(event)
        return event

    async def request_approval(self, action_name: str, params: dict[str, object], reason: str) -> None:
        self.approval_requests.append(
            {"action_name": action_name, "params": params, "reason": reason},
        )

    async def update_summary(self, summary: str) -> None:
        self.summary = summary

    def register_stop_callback(self, callback) -> None:
        self.stop_callback = callback


@pytest.fixture
def base_settings(tmp_path: Path) -> Settings:
    return Settings(
        OPENROUTER_API_KEY="test-key",
        ARTIFACT_ROOT=tmp_path,
        OPENROUTER_MODEL="google/gemini-2.5-flash:free",
    )


def patch_runner_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runner_module, "Agent", FakeAgent)
    monkeypatch.setattr(runner_module, "BrowserSession", FakeBrowserSession)
    monkeypatch.setattr(runner_module, "ChatOpenRouter", lambda **kwargs: SimpleNamespace(**kwargs))


@pytest.mark.asyncio
async def test_runner_skips_step_capture_when_interval_is_zero(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    base_settings: Settings,
) -> None:
    patch_runner_dependencies(monkeypatch)
    settings = base_settings.model_copy(update={"step_screenshot_interval": 0, "include_step_browser_state": False})
    runner = BrowserUseRunner(settings)
    context = FakeContext(tmp_path / "run-no-capture")

    result = await runner.run(context)

    assert context.approval_requests == []
    step_event = next(event for event in context.events if event["summary"] == "Step 1 completed.")
    assert step_event["data"]["step"] == 1
    assert "screenshot" not in step_event["data"]
    assert "timings" in step_event["data"]
    assert result["timings"]["screenshots_captured"] == 0
    assert result["timings"]["browser_state_reads"] == 0
    assert result["timings"]["step_screenshot_interval"] == 0


@pytest.mark.asyncio
async def test_runner_emits_screenshot_and_browser_state_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    base_settings: Settings,
) -> None:
    patch_runner_dependencies(monkeypatch)
    settings = base_settings.model_copy(update={"step_screenshot_interval": 1, "include_step_browser_state": True})
    runner = BrowserUseRunner(settings)
    context = FakeContext(tmp_path / "run-with-capture")

    result = await runner.run(context)

    action_event = next(
        event for event in context.events if event["type"] == EventType.OBSERVATION and event["data"].get("action_name") == "click"
    )
    step_event = next(event for event in context.events if event["summary"] == "Captured browser state after step 1.")

    assert action_event["data"]["timings"]["action_total_ms"] >= 0
    assert step_event["data"]["url"] == "https://example.com/docs"
    assert step_event["data"]["title"] == "Docs"
    assert step_event["data"]["screenshot"] == "screenshots/step-001.png"
    assert (context.run_dir / "screenshots" / "step-001.png").exists()
    assert result["timings"]["screenshots_captured"] == 1
    assert result["timings"]["browser_state_reads"] == 1
    assert result["timings"]["run_duration_ms"] >= 0
