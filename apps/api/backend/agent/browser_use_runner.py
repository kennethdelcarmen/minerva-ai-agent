"""Production runner that executes tasks with browser-use."""

from __future__ import annotations

from time import perf_counter
from typing import Any

from browser_use import Agent, BrowserSession
from browser_use.llm import ChatOpenRouter

from backend.agent.policies import should_require_approval
from backend.agent.service import ManagedRunContext
from backend.config import Settings
from backend.contracts.models import EventType


class BrowserUseRunner:
    """Execute runs against the browser-use runtime."""

    def __init__(self, settings: Settings):
        self.settings = settings

    @staticmethod
    def _ms(duration_seconds: float) -> float:
        return round(duration_seconds * 1000, 2)

    def _timings_payload(self, **durations: float) -> dict[str, float]:
        if not self.settings.enable_step_timings:
            return {}

        return {name: self._ms(value) for name, value in durations.items()}

    def _should_capture_step_screenshot(self, step_number: int) -> bool:
        interval = self.settings.step_screenshot_interval
        if interval <= 0:
            return False

        return step_number == 1 or step_number % interval == 0

    async def run(self, context: ManagedRunContext) -> dict[str, Any]:
        run_started_at = perf_counter()
        step_started_at = run_started_at
        action_count = 0
        approval_wait_total = 0.0
        screenshots_captured = 0
        browser_state_reads = 0
        browser = BrowserSession(
            headless=context.headless,
            traces_dir=str(context.run_dir / "traces"),
            record_video_dir=str(context.run_dir / "videos"),
            downloads_path=str(context.run_dir / "downloads"),
        )
        llm = ChatOpenRouter(
            model=context.model,
            api_key=self.settings.openrouter_api_key.get_secret_value(),
        )
        history_path = context.run_dir / "history.json"
        agent = Agent(
            task=context.request.task,
            llm=llm,
            browser_session=browser,
            save_conversation_path=str(context.run_dir / "conversation"),
        )
        context.register_stop_callback(agent.stop)

        original_execute_action = agent.tools.registry.execute_action

        async def execute_action_with_approval(*, action_name: str, params: dict, **kwargs):
            nonlocal action_count, approval_wait_total

            action_count += 1
            action_started_at = perf_counter()
            await context.update_summary(f'Preparing "{action_name}" action.')
            await context.emit_event(
                EventType.ACTION,
                f'Executing "{action_name}".',
                {
                    "action_name": action_name,
                    "params": params,
                },
            )
            requires_approval, reason = should_require_approval(
                action_name,
                params,
                approval_mode=self.settings.approval_mode,
            )
            approval_wait = 0.0
            if requires_approval:
                approval_started_at = perf_counter()
                await context.request_approval(action_name, params, reason or "Operator approval required.")
                approval_wait = perf_counter() - approval_started_at
                approval_wait_total += approval_wait

            action_execution_started_at = perf_counter()
            result = await original_execute_action(action_name=action_name, params=params, **kwargs)
            action_execution_duration = perf_counter() - action_execution_started_at
            total_action_duration = perf_counter() - action_started_at
            result_payload = result.model_dump(exclude_none=True) if hasattr(result, "model_dump") else {"result": str(result)}
            summary = f'"{action_name}" completed.'
            event_type = EventType.OBSERVATION
            if isinstance(result_payload, dict) and result_payload.get("error"):
                summary = f'"{action_name}" reported an error.'
                event_type = EventType.ERROR
            event_data = {
                "action_name": action_name,
                "params": params,
                "result": result_payload,
            }
            timings = self._timings_payload(
                approval_wait_ms=approval_wait,
                action_execution_ms=action_execution_duration,
                action_total_ms=total_action_duration,
            )
            if timings:
                event_data["timings"] = timings
            await context.emit_event(
                event_type,
                summary,
                event_data,
            )
            return result

        agent.tools.registry.execute_action = execute_action_with_approval

        async def on_step_end(current_agent: Agent) -> None:
            nonlocal step_started_at, screenshots_captured, browser_state_reads

            step_number = current_agent.state.n_steps
            step_duration = perf_counter() - step_started_at
            last_output = current_agent.state.last_model_output
            if last_output is not None:
                plan_summary = last_output.next_goal or "Agent completed a step."
                await context.emit_event(
                    EventType.PLAN,
                    plan_summary,
                    {
                        "step": step_number,
                        "memory": last_output.memory,
                        "next_goal": last_output.next_goal,
                    },
                )

            should_capture = self._should_capture_step_screenshot(step_number)
            if should_capture:
                screenshot_path = context.run_dir / "screenshots" / f"step-{step_number:03d}.png"
                screenshot_saved = False
                url: str | None = None
                title: str | None = None
                capture_started_at = perf_counter()
                try:
                    if self.settings.include_step_browser_state:
                        browser_state = await current_agent.browser_session.get_browser_state_summary()
                        browser_state_reads += 1
                        url = browser_state.url
                        title = browser_state.title
                    await current_agent.browser_session.take_screenshot(path=str(screenshot_path))
                    screenshot_saved = screenshot_path.exists()
                    if screenshot_saved:
                        screenshots_captured += 1
                except Exception as exc:
                    error_data = {"step": step_number, "error": str(exc)}
                    timings = self._timings_payload(
                        step_duration_ms=step_duration,
                        capture_duration_ms=perf_counter() - capture_started_at,
                    )
                    if timings:
                        error_data["timings"] = timings
                    await context.emit_event(
                        EventType.ERROR,
                        "Failed to capture post-step state.",
                        error_data,
                    )
                    step_started_at = perf_counter()
                    return

                observation_data: dict[str, Any] = {
                    "step": step_number,
                    "screenshot": screenshot_path.relative_to(context.run_dir).as_posix() if screenshot_saved else None,
                }
                if url is not None:
                    observation_data["url"] = url
                if title is not None:
                    observation_data["title"] = title
                timings = self._timings_payload(
                    step_duration_ms=step_duration,
                    capture_duration_ms=perf_counter() - capture_started_at,
                )
                if timings:
                    observation_data["timings"] = timings
                await context.emit_event(
                    EventType.OBSERVATION,
                    f"Captured browser state after step {step_number}.",
                    observation_data,
                )
            else:
                observation_data = {"step": step_number}
                timings = self._timings_payload(step_duration_ms=step_duration)
                if timings:
                    observation_data["timings"] = timings
                await context.emit_event(
                    EventType.OBSERVATION,
                    f"Step {step_number} completed.",
                    observation_data,
                )

            step_started_at = perf_counter()

        history = None
        try:
            history = await agent.run(max_steps=self.settings.max_steps, on_step_end=on_step_end)
            agent.save_history(history_path)
            result_payload = {
                "success": bool(history.is_successful()),
                "final_output": history.final_result(),
                "steps": history.number_of_steps(),
                "urls": history.urls(),
            }
            run_duration = perf_counter() - run_started_at
            timings = self._timings_payload(
                run_duration_ms=run_duration,
                approval_wait_total_ms=approval_wait_total,
            )
            if timings:
                result_payload["timings"] = {
                    **timings,
                    "actions": action_count,
                    "screenshots_captured": screenshots_captured,
                    "browser_state_reads": browser_state_reads,
                    "step_screenshot_interval": self.settings.step_screenshot_interval,
                }
            return result_payload
        finally:
            try:
                if history is not None and not history_path.exists():
                    agent.save_history(history_path)
            finally:
                await agent.close()
