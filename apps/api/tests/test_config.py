from __future__ import annotations

import os

import pytest
from pydantic import ValidationError

from backend.config import Settings


@pytest.fixture(autouse=True)
def clear_google_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_MODEL", raising=False)
    monkeypatch.delenv("BROWSER_PROVIDER", raising=False)
    monkeypatch.delenv("BROWSERLESS_HOST", raising=False)
    monkeypatch.delenv("BROWSERLESS_TOKEN", raising=False)


def test_settings_require_google_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setenv("BROWSER_PROVIDER", "local")

    with pytest.raises(ValidationError, match="GOOGLE_API_KEY environment variable is not set."):
        Settings(_env_file=None)


def test_settings_default_to_browserless_when_token_is_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSERLESS_TOKEN", "test-token")

    settings = Settings(_env_file=None)

    assert settings.browser_provider == "browserless"
    assert settings.browserless_host == "production-sfo.browserless.io"


def test_settings_require_browserless_token_in_browserless_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")

    with pytest.raises(
        ValidationError,
        match="BROWSERLESS_TOKEN environment variable is not set when BROWSER_PROVIDER=browserless.",
    ):
        Settings(_env_file=None)


def test_settings_accept_json_cors_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSER_PROVIDER", "local")
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", '["https://app.example.com","https://admin.example.com"]')

    settings = Settings(_env_file=None)

    assert settings.cors_allow_origins == ["https://app.example.com", "https://admin.example.com"]


def test_settings_accept_csv_cors_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSER_PROVIDER", "local")
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "https://app.example.com, https://admin.example.com")

    settings = Settings(_env_file=None)

    assert settings.cors_allow_origins == ["https://app.example.com", "https://admin.example.com"]


def test_headless_defaults_to_true(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSER_PROVIDER", "local")
    monkeypatch.delenv("HEADLESS", raising=False)

    settings = Settings(_env_file=None)

    assert settings.headless is True


def test_speed_defaults_enable_timings_and_sparse_screenshots(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSER_PROVIDER", "local")

    settings = Settings(_env_file=None)

    assert settings.enable_step_timings is True
    assert settings.google_model == "gemini-3.5-flash-lite"
    assert settings.step_screenshot_interval == 3
    assert settings.include_step_browser_state is False
    assert settings.approval_mode == "speed"


def test_settings_accept_explicit_speed_controls(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSER_PROVIDER", "local")
    monkeypatch.setenv("ENABLE_STEP_TIMINGS", "false")
    monkeypatch.setenv("STEP_SCREENSHOT_INTERVAL", "0")
    monkeypatch.setenv("INCLUDE_STEP_BROWSER_STATE", "true")
    monkeypatch.setenv("APPROVAL_MODE", "strict")

    settings = Settings(_env_file=None)

    assert settings.enable_step_timings is False
    assert settings.step_screenshot_interval == 0
    assert settings.include_step_browser_state is True
    assert settings.approval_mode == "strict"


def test_settings_accept_browser_launch_args_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSER_PROVIDER", "local")
    monkeypatch.setenv("BROWSER_LAUNCH_ARGS", '["--foo=bar","--disable-dev-shm-usage"]')

    settings = Settings(_env_file=None)

    assert settings.browser_launch_args == ["--foo=bar", "--disable-dev-shm-usage"]


def test_settings_reject_non_array_browser_launch_args(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSER_PROVIDER", "local")
    monkeypatch.setenv("BROWSER_LAUNCH_ARGS", '{"flag":"--foo"}')

    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_container_mode_defaults_disable_sandbox_and_add_container_args(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSER_PROVIDER", "local")
    monkeypatch.setenv("BROWSER_CONTAINER_MODE", "true")

    settings = Settings(_env_file=None)

    assert settings.resolved_browser_chromium_sandbox is False
    assert settings.resolved_browser_launch_args == ["--disable-dev-shm-usage", "--no-sandbox"]


def test_local_mode_defaults_keep_sandbox_and_skip_container_args(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSER_PROVIDER", "local")

    settings = Settings(_env_file=None)

    assert settings.browser_provider == "local"
    assert settings.resolved_browser_chromium_sandbox is True
    assert settings.resolved_browser_launch_args == []


def test_user_browser_launch_args_override_default_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSER_PROVIDER", "local")
    monkeypatch.setenv("BROWSER_CONTAINER_MODE", "true")
    monkeypatch.setenv("BROWSER_LAUNCH_ARGS", '["--no-sandbox=false","--disable-dev-shm-usage=false","--foo=bar"]')

    settings = Settings(_env_file=None)

    assert settings.resolved_browser_launch_args == [
        "--no-sandbox=false",
        "--disable-dev-shm-usage=false",
        "--foo=bar",
    ]


def test_settings_reject_unsupported_google_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSER_PROVIDER", "local")
    monkeypatch.setenv("GOOGLE_MODEL", "gpt-5")

    with pytest.raises(ValidationError, match="GOOGLE_MODEL must be one of:"):
        Settings(_env_file=None)


def test_browserless_cdp_url_is_composed_from_host_and_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSERLESS_TOKEN", "test-token")

    settings = Settings(_env_file=None)

    assert settings.resolved_browserless_cdp_url == "wss://production-sfo.browserless.io?token=test-token"


def test_redact_sensitive_text_scrubs_browserless_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("BROWSERLESS_TOKEN", "test-token")

    settings = Settings(_env_file=None)

    assert settings.redact_sensitive_text("wss://host?token=test-token") == "wss://host?token=[REDACTED]"
