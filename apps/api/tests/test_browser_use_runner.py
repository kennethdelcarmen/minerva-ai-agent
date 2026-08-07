from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from backend.agent import browser_use_runner as runner_module
from backend.agent.browser_use_runner import BrowserUseRunner
from backend.config import Settings
from backend.contracts.models import EventType
from backend.agent.jina_fallback import is_bot_blocked, is_empty_browser_page


class FakeActionResult:
    def model_dump(self, exclude_none: bool = True) -> dict[str, str]:
        return {"status": "ok"}


class FakeRegistry:
    async def execute_action(self, *, action_name: str, params: dict, **kwargs) -> FakeActionResult:
        return FakeActionResult()


class FakeHistory:
    def __init__(self, steps: int = 1):
        self.steps = steps

    def is_successful(self) -> bool:
        return True

    def final_result(self) -> str:
        return "done"

    def number_of_steps(self) -> int:
        return self.steps

    def urls(self) -> list[str]:
        return ["https://example.com/docs"]


class FakeBrowserSession:
    instances: list["FakeBrowserSession"] = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.browser_state_reads = 0
        self.closed = False
        self.current_url = "https://example.com/docs"
        self.current_title = "Docs"
        self.page_text = "Example documentation page"
        self.__class__.instances.append(self)

    async def take_screenshot(self, path: str) -> None:
        screenshot_path = Path(path)
        screenshot_path.parent.mkdir(parents=True, exist_ok=True)
        screenshot_path.write_bytes(b"png")

    async def get_browser_state_summary(self) -> SimpleNamespace:
        self.browser_state_reads += 1
        return SimpleNamespace(url="https://example.com/docs", title="Docs")

    async def get_current_page_url(self) -> str:
        return self.current_url

    async def get_current_page_title(self) -> str:
        return self.current_title

    async def get_current_page(self) -> SimpleNamespace:
        async def evaluate(_script: str) -> str:
            return self.page_text

        return SimpleNamespace(evaluate=evaluate)

    async def close(self) -> None:
        self.closed = True


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
        self._message_manager = SimpleNamespace(task=task)
        self.stop_called = False
        self.closed = False

        def add_new_task(new_task: str) -> None:
            wrapped = f"<follow_up_user_request> {new_task.strip()} </follow_up_user_request>"
            if "<initial_user_request>" not in self._message_manager.task:
                self._message_manager.task = f"<initial_user_request>{self._message_manager.task}</initial_user_request>"
            self._message_manager.task += f"\n{wrapped}"

        self._message_manager.add_new_task = add_new_task

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
        self.model = "gemini-3.5-flash-lite"
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
        GOOGLE_API_KEY="test-key",
        ARTIFACT_ROOT=tmp_path,
        GOOGLE_MODEL="gemini-3.5-flash-lite",
        BROWSER_PROVIDER="local",
    )


def patch_runner_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeBrowserSession.instances = []
    monkeypatch.setattr(runner_module, "Agent", FakeAgent)
    monkeypatch.setattr(runner_module, "BrowserSession", FakeBrowserSession)
    monkeypatch.setattr(runner_module, "create_google_llm", lambda **kwargs: SimpleNamespace(**kwargs))


def test_empty_browser_page_detector_matches_blank_tabs() -> None:
    assert is_empty_browser_page("about:blank", "", "")
    assert is_empty_browser_page("about:blank", "", "Empty Tab")
    assert is_empty_browser_page("https://example.com", "", "Docs") is False


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


class MultiStepFakeAgent(FakeAgent):
    async def run(self, *, max_steps: int, on_step_end) -> FakeHistory:
        for step in range(1, 4):
            await self.tools.registry.execute_action(action_name="click", params={"description": f"Step {step}"})
            self.state.n_steps = step
            self.state.last_model_output = SimpleNamespace(
                next_goal=f"Continue to step {step}.",
                memory=f"Completed step {step}",
            )
            await on_step_end(self)
        return FakeHistory(steps=3)


@pytest.mark.asyncio
async def test_runner_captures_every_step_by_default(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    base_settings: Settings,
) -> None:
    patch_runner_dependencies(monkeypatch)
    monkeypatch.setattr(runner_module, "Agent", MultiStepFakeAgent)
    runner = BrowserUseRunner(base_settings)
    context = FakeContext(tmp_path / "run-default-capture")

    result = await runner.run(context)

    screenshot_events = [
        event for event in context.events if event["summary"].startswith("Captured browser state after step")
    ]

    assert [event["data"]["screenshot"] for event in screenshot_events] == [
        "screenshots/step-001.png",
        "screenshots/step-002.png",
        "screenshots/step-003.png",
    ]
    assert result["timings"]["screenshots_captured"] == 3
    assert result["timings"]["step_screenshot_interval"] == 1


@pytest.mark.asyncio
async def test_runner_respects_custom_screenshot_interval(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    base_settings: Settings,
) -> None:
    patch_runner_dependencies(monkeypatch)
    monkeypatch.setattr(runner_module, "Agent", MultiStepFakeAgent)
    settings = base_settings.model_copy(update={"step_screenshot_interval": 2})
    runner = BrowserUseRunner(settings)
    context = FakeContext(tmp_path / "run-periodic-capture")

    result = await runner.run(context)

    screenshot_events = [
        event for event in context.events if event["summary"].startswith("Captured browser state after step")
    ]
    plain_step_events = [event for event in context.events if event["summary"] == "Step 3 completed."]

    assert [event["data"]["step"] for event in screenshot_events] == [1, 2]
    assert [event["data"]["step"] for event in plain_step_events] == [3]
    assert result["timings"]["screenshots_captured"] == 2
    assert result["timings"]["step_screenshot_interval"] == 2


@pytest.mark.asyncio
async def test_runner_passes_resolved_browser_launch_config(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    base_settings: Settings,
) -> None:
    patch_runner_dependencies(monkeypatch)
    settings = base_settings.model_copy(
        update={
            "browser_container_mode": True,
            "browser_launch_args": ["--no-sandbox=false", "--disable-dev-shm-usage=false", "--foo=bar"],
        }
    )
    runner = BrowserUseRunner(settings)

    await runner.run(FakeContext(tmp_path / "run-launch-config"))

    session = FakeBrowserSession.instances[0]
    assert session.kwargs["chromium_sandbox"] is False
    assert session.kwargs["args"] == ["--no-sandbox=false", "--disable-dev-shm-usage=false", "--foo=bar"]
    assert session.kwargs["traces_dir"] == str((tmp_path / "run-launch-config") / "traces")
    assert session.kwargs["record_video_dir"] == str((tmp_path / "run-launch-config") / "videos")
    assert session.kwargs["downloads_path"] == str((tmp_path / "run-launch-config") / "downloads")


@pytest.mark.asyncio
async def test_runner_uses_browserless_cdp_session_when_provider_is_browserless(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    base_settings: Settings,
) -> None:
    patch_runner_dependencies(monkeypatch)
    settings = base_settings.model_copy(
        update={
            "browser_provider": "browserless",
            "browserless_host": "production-sfo.browserless.io",
            "browserless_token": SecretStr("test-token"),
        }
    )
    runner = BrowserUseRunner(settings)

    await runner.run(FakeContext(tmp_path / "run-browserless"))

    session = FakeBrowserSession.instances[0]
    assert session.kwargs["cdp_url"] == "wss://production-sfo.browserless.io?token=test-token"
    assert session.kwargs["is_local"] is False
    assert session.kwargs["traces_dir"] == str((tmp_path / "run-browserless") / "traces")
    assert session.kwargs["record_video_dir"] == str((tmp_path / "run-browserless") / "videos")
    assert session.kwargs["downloads_path"] == str((tmp_path / "run-browserless") / "downloads")
    assert "headless" not in session.kwargs
    assert "args" not in session.kwargs
    assert "chromium_sandbox" not in session.kwargs


@pytest.mark.asyncio
async def test_runner_builds_google_llm_with_selected_model(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    base_settings: Settings,
) -> None:
    patch_runner_dependencies(monkeypatch)
    captured_kwargs: dict[str, object] = {}

    def fake_create_google_llm(**kwargs):
        captured_kwargs.update(kwargs)
        return SimpleNamespace(**kwargs)

    monkeypatch.setattr(runner_module, "create_google_llm", fake_create_google_llm)
    runner = BrowserUseRunner(base_settings)
    context = FakeContext(tmp_path / "run-llm")
    context.model = "gemini-3.6-flash"

    await runner.run(context)

    assert captured_kwargs["model"] == "gemini-3.6-flash"
    assert captured_kwargs["settings"] is base_settings


class FlakyStartupAgent(FakeAgent):
    run_attempts = 0

    async def run(self, *, max_steps: int, on_step_end):
        self.__class__.run_attempts += 1
        if self.__class__.run_attempts == 1:
            raise RuntimeError(
                "Failed to establish CDP connection to browser: "
                "Failed to get session for initial target 123: "
                "Target 123 not found - may have detached or never existed"
            )
        return await super().run(max_steps=max_steps, on_step_end=on_step_end)


class ExplodingAgent(FakeAgent):
    run_attempts = 0

    async def run(self, *, max_steps: int, on_step_end):
        self.__class__.run_attempts += 1
        raise RuntimeError("boom")


@pytest.mark.asyncio
async def test_runner_retries_matching_startup_error_once(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    base_settings: Settings,
) -> None:
    patch_runner_dependencies(monkeypatch)
    FlakyStartupAgent.run_attempts = 0
    monkeypatch.setattr(runner_module, "Agent", FlakyStartupAgent)
    runner = BrowserUseRunner(base_settings)
    context = FakeContext(tmp_path / "run-startup-retry")

    result = await runner.run(context)

    assert result["success"] is True
    assert FlakyStartupAgent.run_attempts == 2
    retry_event = next(event for event in context.events if event["summary"] == "Transient browser startup failure detected. Retrying.")
    assert "ipc: host" in retry_event["data"]["hints"]


@pytest.mark.asyncio
async def test_runner_does_not_retry_non_matching_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    base_settings: Settings,
) -> None:
    patch_runner_dependencies(monkeypatch)
    ExplodingAgent.run_attempts = 0
    monkeypatch.setattr(runner_module, "Agent", ExplodingAgent)
    runner = BrowserUseRunner(base_settings)

    with pytest.raises(RuntimeError, match="boom"):
        await runner.run(FakeContext(tmp_path / "run-no-retry"))

    assert ExplodingAgent.run_attempts == 1


def test_is_bot_blocked_matches_common_anti_bot_markers() -> None:
    assert is_bot_blocked("Please complete the CAPTCHA to continue.", "Just a moment...")
    assert is_bot_blocked("403 Forbidden", "Access Denied")
    assert is_bot_blocked("Akamai bot detection blocked this request.", "Security Check")
    assert is_bot_blocked("Cloudflare Ray ID: 1234", "Attention Required")
    assert is_bot_blocked("Normal product copy with free shipping.", "Example Store") is False


class BlockedPageAgent(FakeAgent):
    observed_fallback_content: list[str] = []
    observed_fallback_task: str = ""

    async def run(self, *, max_steps: int, on_step_end) -> FakeHistory:
        session = self.browser_session
        session.current_url = "https://blocked.example.com/item"
        session.current_title = "Just a moment..."
        session.page_text = "Cloudflare bot protection challenge"

        await self.tools.registry.execute_action(action_name="click", params={"description": "Open blocked page"})
        self.state.n_steps = 1
        await on_step_end(self)

        assert self.state.last_result is not None
        self.__class__.observed_fallback_content = [
            item.extracted_content for item in self.state.last_result if getattr(item, "extracted_content", None)
        ]
        self.__class__.observed_fallback_task = self._message_manager.task

        retry_result = await self.tools.registry.execute_action(action_name="click", params={"description": "Retry blocked"})
        self.state.last_result = [retry_result]
        session.current_url = "https://example.com/recovered"
        session.current_title = "Recovered"
        session.page_text = "Recovered page"
        self.state.n_steps = 2
        self.state.last_model_output = SimpleNamespace(next_goal="Finish the task.", memory="Used fallback content")
        await on_step_end(self)

        await self.tools.registry.execute_action(
            action_name="navigate",
            params={"url": "https://example.com/final", "new_tab": False},
        )
        return FakeHistory(steps=2)


@pytest.mark.asyncio
async def test_runner_fetches_jina_fallback_once_and_continues(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    base_settings: Settings,
) -> None:
    patch_runner_dependencies(monkeypatch)
    BlockedPageAgent.observed_fallback_content = []
    BlockedPageAgent.observed_fallback_task = ""
    monkeypatch.setattr(runner_module, "Agent", BlockedPageAgent)

    fetch_calls: list[str] = []

    async def fake_fetch_page_via_reader_api(target_url: str) -> str:
        fetch_calls.append(target_url)
        return "# Fallback markdown\n\nBlocked product details"

    monkeypatch.setattr(runner_module, "fetch_page_via_reader_api", fake_fetch_page_via_reader_api)

    runner = BrowserUseRunner(base_settings)
    context = FakeContext(tmp_path / "run-jina-fallback")

    result = await runner.run(context)

    assert result["success"] is True
    assert fetch_calls == ["https://blocked.example.com/item"]
    assert BlockedPageAgent.observed_fallback_content == ["# Fallback markdown\n\nBlocked product details"]
    assert "Jina Reader fallback" in BlockedPageAgent.observed_fallback_task
    assert "https://blocked.example.com/item" in BlockedPageAgent.observed_fallback_task
    fallback_event = next(
        event
        for event in context.events
        if event["summary"] == "Anti-bot protection detected. Falling back to Scraper API pipeline..."
    )
    assert fallback_event["data"]["provider"] == "jina-reader"
    blocked_retry_event = next(event for event in context.events if event["summary"] == 'Skipping "click" on blocked page.')
    assert blocked_retry_event["data"]["url"] == "https://blocked.example.com/item"


class BlockedPageFailureAgent(FakeAgent):
    async def run(self, *, max_steps: int, on_step_end) -> FakeHistory:
        session = self.browser_session
        session.current_url = "https://blocked.example.com/manual"
        session.current_title = "Attention Required"
        session.page_text = "CAPTCHA challenge"

        await self.tools.registry.execute_action(action_name="click", params={"description": "Open blocked page"})
        self.state.n_steps = 1
        await on_step_end(self)
        return FakeHistory()


@pytest.mark.asyncio
async def test_runner_returns_structured_blocked_payload_when_jina_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    base_settings: Settings,
) -> None:
    patch_runner_dependencies(monkeypatch)
    monkeypatch.setattr(runner_module, "Agent", BlockedPageFailureAgent)

    async def fake_fetch_page_via_reader_api(_target_url: str) -> str:
        raise RuntimeError("reader unavailable")

    monkeypatch.setattr(runner_module, "fetch_page_via_reader_api", fake_fetch_page_via_reader_api)

    runner = BrowserUseRunner(base_settings)
    context = FakeContext(tmp_path / "run-jina-fallback-failure")

    result = await runner.run(context)

    assert result == {
        "success": False,
        "status": "blocked",
        "message": "Target page requires manual verification.",
        "url": "https://blocked.example.com/manual",
        "final_output": "Target page requires manual verification.",
    }
    failure_event = next(event for event in context.events if event["summary"] == "Reader fallback failed after anti-bot detection.")
    assert failure_event["data"]["url"] == "https://blocked.example.com/manual"


class ImmediateBlockedPageAgent(FakeAgent):
    second_action_error: str | None = None

    async def run(self, *, max_steps: int, on_step_end) -> FakeHistory:
        session = self.browser_session
        session.current_url = "https://blocked.example.com/immediate"
        session.current_title = "Attention Required"
        session.page_text = "Cloudflare bot detection"

        await self.tools.registry.execute_action(action_name="click", params={"description": "Open blocked page"})
        second_result = await self.tools.registry.execute_action(
            action_name="click",
            params={"description": "Retry while still blocked"},
        )
        self.__class__.second_action_error = getattr(second_result, "error", None)
        self.state.n_steps = 1
        await on_step_end(self)
        return FakeHistory()


@pytest.mark.asyncio
async def test_runner_applies_fallback_immediately_after_blocking_action(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    base_settings: Settings,
) -> None:
    patch_runner_dependencies(monkeypatch)
    ImmediateBlockedPageAgent.second_action_error = None
    monkeypatch.setattr(runner_module, "Agent", ImmediateBlockedPageAgent)

    fetch_calls: list[str] = []

    async def fake_fetch_page_via_reader_api(target_url: str) -> str:
        fetch_calls.append(target_url)
        return "# Immediate fallback"

    monkeypatch.setattr(runner_module, "fetch_page_via_reader_api", fake_fetch_page_via_reader_api)

    runner = BrowserUseRunner(base_settings)
    context = FakeContext(tmp_path / "run-jina-immediate")

    result = await runner.run(context)

    assert result["success"] is True
    assert fetch_calls == ["https://blocked.example.com/immediate"]
    assert ImmediateBlockedPageAgent.second_action_error is not None
    assert "Use the provided Jina Reader fallback content" in ImmediateBlockedPageAgent.second_action_error


class BlankPageAfterActionRegistry:
    def __init__(self, session: FakeBrowserSession):
        self._session = session

    async def execute_action(self, *, action_name: str, params: dict, **kwargs) -> FakeActionResult:
        self._session.current_url = "about:blank"
        self._session.current_title = ""
        self._session.page_text = ""
        return FakeActionResult()


class BlankPageAfterActionAgent(FakeAgent):
    retry_error: str | None = None
    observed_fallback_content: list[str] = []

    def __init__(self, *, task: str, llm, browser_session: FakeBrowserSession, save_conversation_path: str):
        super().__init__(task=task, llm=llm, browser_session=browser_session, save_conversation_path=save_conversation_path)
        self.tools = SimpleNamespace(registry=BlankPageAfterActionRegistry(browser_session))

    async def run(self, *, max_steps: int, on_step_end) -> FakeHistory:
        session = self.browser_session
        session.current_url = "https://www.amazon.com/s?k=toothbrush"
        session.current_title = "Amazon.com : toothbrush"
        session.page_text = "Top toothbrush listings"

        await self.tools.registry.execute_action(action_name="click", params={"description": "Open sort menu"})
        retry_result = await self.tools.registry.execute_action(
            action_name="click",
            params={"description": "Retry while browser is blank"},
        )
        self.__class__.retry_error = getattr(retry_result, "error", None)
        self.state.n_steps = 1
        await on_step_end(self)
        self.__class__.observed_fallback_content = [
            item.extracted_content for item in getattr(self.state, "last_result", []) if getattr(item, "extracted_content", None)
        ]
        return FakeHistory()


@pytest.mark.asyncio
async def test_runner_falls_back_when_blocked_page_collapses_to_blank_tab(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    base_settings: Settings,
) -> None:
    patch_runner_dependencies(monkeypatch)
    BlankPageAfterActionAgent.retry_error = None
    BlankPageAfterActionAgent.observed_fallback_content = []
    monkeypatch.setattr(runner_module, "Agent", BlankPageAfterActionAgent)

    fetch_calls: list[str] = []

    async def fake_fetch_page_via_reader_api(target_url: str) -> str:
        fetch_calls.append(target_url)
        return "# Amazon fallback"

    monkeypatch.setattr(runner_module, "fetch_page_via_reader_api", fake_fetch_page_via_reader_api)

    runner = BrowserUseRunner(base_settings)
    context = FakeContext(tmp_path / "run-blank-tab-fallback")

    result = await runner.run(context)

    assert result["success"] is True
    assert fetch_calls == ["https://www.amazon.com/s?k=toothbrush"]
    assert BlankPageAfterActionAgent.retry_error is not None
    assert "Use the provided Jina Reader fallback content" in BlankPageAfterActionAgent.retry_error
    assert BlankPageAfterActionAgent.observed_fallback_content == ["# Amazon fallback"]
