"""Production runner that executes tasks with browser-use."""

from __future__ import annotations

from typing import Any

from browser_use import Agent, BrowserSession, ChatGoogle

from backend.agent.policies import should_require_approval
from backend.agent.service import ManagedRunContext
from backend.config import Settings
from backend.contracts.models import EventType


class BrowserUseRunner:
    """Execute runs against the browser-use runtime."""

    def __init__(self, settings: Settings):
        self.settings = settings

    async def run(self, context: ManagedRunContext) -> dict[str, Any]:
        browser = BrowserSession(
            headless=context.headless,
            traces_dir=str(context.run_dir / "traces"),
            record_video_dir=str(context.run_dir / "videos"),
            downloads_path=str(context.run_dir / "downloads"),
        )
        llm = ChatGoogle(
            model=context.model,
            api_key=self.settings.google_api_key.get_secret_value(),
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
            await context.update_summary(f'Preparing "{action_name}" action.')
            await context.emit_event(
                EventType.ACTION,
                f'Executing "{action_name}".',
                {
                    "action_name": action_name,
                    "params": params,
                },
            )
            requires_approval, reason = should_require_approval(action_name, params)
            if requires_approval:
                await context.request_approval(action_name, params, reason or "Operator approval required.")
            result = await original_execute_action(action_name=action_name, params=params, **kwargs)
            result_payload = result.model_dump(exclude_none=True) if hasattr(result, "model_dump") else {"result": str(result)}
            summary = f'"{action_name}" completed.'
            event_type = EventType.OBSERVATION
            if isinstance(result_payload, dict) and result_payload.get("error"):
                summary = f'"{action_name}" reported an error.'
                event_type = EventType.ERROR
            await context.emit_event(
                event_type,
                summary,
                {
                    "action_name": action_name,
                    "params": params,
                    "result": result_payload,
                },
            )
            return result

        agent.tools.registry.execute_action = execute_action_with_approval

        async def on_step_end(current_agent: Agent) -> None:
            last_output = current_agent.state.last_model_output
            if last_output is not None:
                plan_summary = last_output.next_goal or "Agent completed a step."
                await context.emit_event(
                    EventType.PLAN,
                    plan_summary,
                    {
                        "step": current_agent.state.n_steps,
                        "memory": last_output.memory,
                        "next_goal": last_output.next_goal,
                    },
                )

            screenshot_path = context.run_dir / "screenshots" / f"step-{current_agent.state.n_steps:03d}.png"
            screenshot_saved = False
            url: str | None = None
            title: str | None = None
            try:
                browser_state = await current_agent.browser_session.get_browser_state_summary()
                url = browser_state.url
                title = browser_state.title
                await current_agent.browser_session.take_screenshot(path=str(screenshot_path))
                screenshot_saved = screenshot_path.exists()
            except Exception as exc:
                await context.emit_event(
                    EventType.ERROR,
                    "Failed to capture post-step state.",
                    {"step": current_agent.state.n_steps, "error": str(exc)},
                )
                return

            await context.emit_event(
                EventType.OBSERVATION,
                f"Captured browser state after step {current_agent.state.n_steps}.",
                {
                    "step": current_agent.state.n_steps,
                    "url": url,
                    "title": title,
                    "screenshot": screenshot_path.relative_to(context.run_dir).as_posix() if screenshot_saved else None,
                },
            )

        history = None
        try:
            history = await agent.run(max_steps=self.settings.max_steps, on_step_end=on_step_end)
            agent.save_history(history_path)
            return {
                "success": bool(history.is_successful()),
                "final_output": history.final_result(),
                "steps": history.number_of_steps(),
                "urls": history.urls(),
            }
        finally:
            try:
                if history is not None and not history_path.exists():
                    agent.save_history(history_path)
            finally:
                await agent.close()
