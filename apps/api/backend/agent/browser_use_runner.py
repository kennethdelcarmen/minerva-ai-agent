"""Production runner that executes tasks with browser-use."""

from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Any

from browser_use import Agent, BrowserSession
from browser_use.agent.views import ActionResult

from backend.agent.jina_fallback import JinaFallbackState, fetch_page_via_reader_api, is_bot_blocked
from backend.agent.policies import should_require_approval
from backend.agent.service import ManagedRunContext
from backend.config import Settings
from backend.contracts.models import EventType
from backend.llm import create_google_llm


@dataclass(frozen=True)
class BrowserLaunchConfig:
    provider: str
    endpoint_host: str | None
    args: list[str]
    chromium_sandbox: bool | None


class ReaderFallbackBlockedError(Exception):
    """Raised when a blocked page cannot be recovered through Jina Reader."""

    def __init__(self, url: str, message: str = "Target page requires manual verification."):
        self.url = url
        self.message = message
        super().__init__(message)


class BrowserUseRunner:
    """Execute runs against the browser-use runtime."""

    STARTUP_ERROR_PATTERNS = (
        "failed to establish cdp connection",
        "failed to get session for initial target",
        "may have detached or never existed",
    )

    def __init__(self, settings: Settings):
        self.settings = settings

    @staticmethod
    def _ms(duration_seconds: float) -> float:
        return round(duration_seconds * 1000, 2)

    def browser_launch_config(self) -> BrowserLaunchConfig:
        if self.settings.browser_provider == "browserless":
            return BrowserLaunchConfig(
                provider="browserless",
                endpoint_host=self.settings.browserless_host,
                args=[],
                chromium_sandbox=None,
            )

        return BrowserLaunchConfig(
            provider="local",
            endpoint_host=None,
            args=self.settings.resolved_browser_launch_args,
            chromium_sandbox=self.settings.resolved_browser_chromium_sandbox,
        )

    def _timings_payload(self, **durations: float) -> dict[str, float]:
        if not self.settings.enable_step_timings:
            return {}

        return {name: self._ms(value) for name, value in durations.items()}

    @classmethod
    def is_startup_error(cls, error: Exception) -> bool:
        message = str(error).lower()
        return any(pattern in message for pattern in cls.STARTUP_ERROR_PATTERNS)

    def _should_capture_step_screenshot(self, step_number: int) -> bool:
        interval = self.settings.step_screenshot_interval
        if interval <= 0:
            return False

        return step_number == 1 or step_number % interval == 0

    def _build_browser_session(self, *, headless: bool, run_dir) -> BrowserSession:
        common_kwargs = {
            "traces_dir": str(run_dir / "traces"),
            "record_video_dir": str(run_dir / "videos"),
            "downloads_path": str(run_dir / "downloads"),
        }
        if self.settings.browser_provider == "browserless":
            return BrowserSession(
                cdp_url=self.settings.resolved_browserless_cdp_url,
                is_local=False,
                **common_kwargs,
            )

        launch_config = self.browser_launch_config()
        return BrowserSession(
            headless=headless,
            args=launch_config.args,
            chromium_sandbox=launch_config.chromium_sandbox,
            **common_kwargs,
        )

    def _sanitized_error(self, error: Exception) -> str:
        return self.settings.redact_sensitive_text(str(error))

    async def _close_browser_session(self, browser: BrowserSession | None) -> None:
        if browser is None:
            return

        close = getattr(browser, "close", None)
        if close is None:
            return

        await close()

    async def _get_current_page_url(self, browser: BrowserSession) -> str | None:
        try:
            return await browser.get_current_page_url()
        except Exception:
            return None

    async def _get_current_page_snapshot(self, browser: BrowserSession) -> tuple[str | None, str | None, str]:
        url = await self._get_current_page_url(browser)

        try:
            title = await browser.get_current_page_title()
        except Exception:
            title = None

        page_content = ""
        try:
            page = await browser.get_current_page()
            if page is not None:
                page_content = await page.evaluate(
                    """
                    () => {
                      const candidates = [
                        document.body?.innerText,
                        document.documentElement?.innerText,
                      ];
                      for (const candidate of candidates) {
                        if (typeof candidate === "string" && candidate.trim().length > 0) {
                          return candidate;
                        }
                      }
                      return "";
                    }
                    """
                )
        except Exception:
            page_content = ""

        return url, title, page_content

    def _fallback_action_result(self, *, url: str, markdown: str) -> ActionResult:
        guidance = (
            f"Browser interaction hit anti-bot protection on {url}. "
            "Use the attached Jina Reader markdown as the source material for this page. "
            "Do not keep retrying blocked actions on this same page. "
            "Continue browser actions only after navigating to a different reachable page if the task still requires it."
        )
        return ActionResult(
            extracted_content=markdown,
            include_extracted_content_only_once=True,
            long_term_memory=guidance,
        )

    def _fallback_retry_error(self, *, url: str) -> ActionResult:
        return ActionResult(
            error=(
                f"Current page {url} is blocked by anti-bot protection. "
                "Use the provided Jina Reader fallback content instead of retrying browser actions on this page."
            ),
        )

    def _fallback_prompt_instruction(self, *, url: str) -> str:
        return (
            f"The live browser page at {url} is blocked by anti-bot or CAPTCHA protection. "
            "A Jina Reader fallback for this same page has been attached to your recent observations. "
            "Use that fallback content for extraction and reasoning on this page instead of retrying blocked interactions. "
            "If the broader task needs additional pages, resume normal browser-use actions only after navigating to a different reachable page."
        )

    async def _get_or_fetch_jina_fallback(
        self,
        *,
        current_agent: Agent,
        context: ManagedRunContext,
        fallback_state: JinaFallbackState,
        url: str,
    ) -> ActionResult:
        markdown = fallback_state.markdown_by_url.get(url)
        if markdown is None:
            await context.emit_event(
                EventType.OBSERVATION,
                "Anti-bot protection detected. Falling back to Scraper API pipeline...",
                {"url": url, "provider": "jina-reader"},
            )
            markdown = await fetch_page_via_reader_api(url)
            fallback_state.markdown_by_url[url] = markdown

        fallback_state.active_blocked_url = url
        fallback_result = self._fallback_action_result(url=url, markdown=markdown)

        if url not in fallback_state.prompted_urls:
            instruction = self._fallback_prompt_instruction(url=url)
            message_manager = getattr(current_agent, "_message_manager", None)
            if message_manager is not None and hasattr(message_manager, "add_new_task"):
                message_manager.add_new_task(instruction)
                current_agent.task = getattr(message_manager, "task", current_agent.task)
            fallback_state.prompted_urls.add(url)

        return fallback_result

    async def run_preflight(self) -> None:
        preflight_dir = self.settings.artifact_root / "_preflight"
        browser: BrowserSession | None = None
        try:
            browser = self._build_browser_session(headless=True, run_dir=preflight_dir)
            await browser.get_browser_state_summary()
        finally:
            await self._close_browser_session(browser)

    async def run(self, context: ManagedRunContext) -> dict[str, Any]:
        max_attempts = self.settings.browser_startup_retry_count + 1
        remediation_hints = (
            "Verify Docker uses ipc: host, Chromium gets --disable-dev-shm-usage, "
            "--no-sandbox is active when sandboxing is disabled, and restart the container "
            "to clear stale browser processes."
        )

        for attempt in range(1, max_attempts + 1):
            try:
                return await self._run_once(context)
            except Exception as exc:
                should_retry = attempt < max_attempts and self.is_startup_error(exc)
                if not should_retry:
                    raise

                await context.emit_event(
                    EventType.ERROR,
                    "Transient browser startup failure detected. Retrying.",
                    {
                        "attempt": attempt,
                        "max_attempts": max_attempts,
                        "error": self._sanitized_error(exc),
                        "provider": self.browser_launch_config().provider,
                        "endpoint_host": self.browser_launch_config().endpoint_host,
                        "launch_args": self.browser_launch_config().args,
                        "chromium_sandbox": self.browser_launch_config().chromium_sandbox,
                        "hints": remediation_hints,
                    },
                )

        raise RuntimeError("Browser run exhausted startup retries.")

    async def _run_once(self, context: ManagedRunContext) -> dict[str, Any]:
        run_started_at = perf_counter()
        step_started_at = run_started_at
        action_count = 0
        approval_wait_total = 0.0
        screenshots_captured = 0
        browser_state_reads = 0
        browser: BrowserSession | None = None
        agent: Agent | None = None
        history = None
        history_path = context.run_dir / "history.json"
        fallback_state = JinaFallbackState()

        try:
            browser = self._build_browser_session(headless=context.headless, run_dir=context.run_dir)
            llm = create_google_llm(model=context.model, settings=self.settings)
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

                current_url = await self._get_current_page_url(agent.browser_session)
                blocked_url = fallback_state.active_blocked_url
                if blocked_url is not None and current_url == blocked_url:
                    target_url = str(params.get("url", "")).strip()
                    navigation_allowed = action_name == "navigate" and bool(target_url) and target_url != blocked_url
                    if action_name != "done" and not navigation_allowed:
                        result = self._fallback_retry_error(url=blocked_url)
                        result_payload = result.model_dump(exclude_none=True)
                        await context.emit_event(
                            EventType.ERROR,
                            f'Skipping "{action_name}" on blocked page.',
                            {
                                "action_name": action_name,
                                "params": params,
                                "result": result_payload,
                                "url": blocked_url,
                            },
                        )
                        return result

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
                fallback_applied = False
                fallback_url: str | None = None
                fallback_chars = 0
                current_url_after_action, current_title_after_action, page_content_after_action = await self._get_current_page_snapshot(
                    agent.browser_session
                )
                if fallback_state.active_blocked_url is not None and current_url_after_action != fallback_state.active_blocked_url:
                    fallback_state.active_blocked_url = None

                if current_url_after_action and is_bot_blocked(page_content_after_action, current_title_after_action or ""):
                    try:
                        result = await self._get_or_fetch_jina_fallback(
                            current_agent=agent,
                            context=context,
                            fallback_state=fallback_state,
                            url=current_url_after_action,
                        )
                        fallback_applied = True
                        fallback_url = current_url_after_action
                        fallback_chars = len(fallback_state.markdown_by_url.get(current_url_after_action, ""))
                    except Exception as exc:
                        await context.emit_event(
                            EventType.ERROR,
                            "Reader fallback failed after anti-bot detection.",
                            {"url": current_url_after_action, "error": self._sanitized_error(exc)},
                        )
                        raise ReaderFallbackBlockedError(current_url_after_action) from exc

                action_execution_duration = perf_counter() - action_execution_started_at
                total_action_duration = perf_counter() - action_started_at
                result_payload = (
                    result.model_dump(exclude_none=True) if hasattr(result, "model_dump") else {"result": str(result)}
                )
                if fallback_applied and fallback_url is not None:
                    result_payload = {
                        "status": "fallback_injected",
                        "source": "jina-reader",
                        "url": fallback_url,
                        "content_chars": fallback_chars,
                    }
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
                current_url, current_title, page_content = await self._get_current_page_snapshot(current_agent.browser_session)
                if fallback_state.active_blocked_url is not None and current_url != fallback_state.active_blocked_url:
                    fallback_state.active_blocked_url = None

                if current_url and is_bot_blocked(page_content, current_title or ""):
                    try:
                        fallback_result = await self._get_or_fetch_jina_fallback(
                            current_agent=current_agent,
                            context=context,
                            fallback_state=fallback_state,
                            url=current_url,
                        )
                        last_result = getattr(current_agent.state, "last_result", None)
                        current_markdown = fallback_state.markdown_by_url.get(current_url)
                        already_injected = bool(
                            last_result
                            and current_markdown is not None
                            and any(
                                getattr(item, "extracted_content", None) == current_markdown for item in last_result
                            )
                        )
                        if not already_injected:
                            if last_result:
                                last_result.append(fallback_result)
                            else:
                                current_agent.state.last_result = [fallback_result]
                    except Exception as exc:
                        await context.emit_event(
                            EventType.ERROR,
                            "Reader fallback failed after anti-bot detection.",
                            {"url": current_url, "error": self._sanitized_error(exc)},
                        )
                        raise ReaderFallbackBlockedError(current_url) from exc

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
                        error_data = {"step": step_number, "error": self._sanitized_error(exc)}
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
        except ReaderFallbackBlockedError as exc:
            return {
                "success": False,
                "status": "blocked",
                "message": exc.message,
                "url": exc.url,
                "final_output": exc.message,
            }
        finally:
            try:
                if history is not None and agent is not None and not history_path.exists():
                    agent.save_history(history_path)
            finally:
                if agent is not None:
                    await agent.close()
                else:
                    await self._close_browser_session(browser)
