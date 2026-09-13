"""Application configuration."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated
from typing import Any
from typing import Literal
from urllib.parse import quote

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from backend.model_catalog import DEFAULT_OPENROUTER_MODEL, SUPPORTED_OPENROUTER_MODELS, is_supported_openrouter_model

APP_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=APP_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        validate_default=True,
    )

    openrouter_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("OPENROUTER_API_KEY"),
        serialization_alias="OPENROUTER_API_KEY",
    )
    openrouter_model: str = Field(
        default=DEFAULT_OPENROUTER_MODEL,
        validation_alias=AliasChoices("OPENROUTER_MODEL"),
        serialization_alias="OPENROUTER_MODEL",
    )
    browser_provider: Literal["browserless", "local"] = Field(default="browserless", alias="BROWSER_PROVIDER")
    browserless_host: str = Field(default="production-sfo.browserless.io", alias="BROWSERLESS_HOST")
    browserless_token: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("BROWSERLESS_TOKEN"),
        serialization_alias="BROWSERLESS_TOKEN",
    )
    firecrawl_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("FIRECRAWL_API_KEY"),
        serialization_alias="FIRECRAWL_API_KEY",
    )
    firecrawl_base_url: str = Field(default="https://api.firecrawl.dev/v2", alias="FIRECRAWL_BASE_URL")
    headless: bool = Field(default=True, alias="HEADLESS")
    artifact_root: Path = Field(default=APP_ROOT / ".runs", alias="ARTIFACT_ROOT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    max_steps: int = Field(default=25, alias="MAX_STEPS")
    event_subscriber_queue_size: int = Field(default=128, alias="EVENT_SUBSCRIBER_QUEUE_SIZE", ge=1)
    enable_step_timings: bool = Field(default=True, alias="ENABLE_STEP_TIMINGS")
    step_screenshot_interval: int = Field(default=1, alias="STEP_SCREENSHOT_INTERVAL", ge=0)
    include_step_browser_state: bool = Field(default=False, alias="INCLUDE_STEP_BROWSER_STATE")
    approval_mode: Literal["strict", "speed"] = Field(default="speed", alias="APPROVAL_MODE")
    browser_container_mode: bool = Field(default=False, alias="BROWSER_CONTAINER_MODE")
    browser_preflight_on_startup: bool = Field(default=False, alias="BROWSER_PREFLIGHT_ON_STARTUP")
    browser_launch_args: Annotated[list[str], NoDecode] = Field(default_factory=list, alias="BROWSER_LAUNCH_ARGS")
    browser_chromium_sandbox: bool | None = Field(default=None, alias="BROWSER_CHROMIUM_SANDBOX")
    browser_startup_retry_count: int = Field(default=1, alias="BROWSER_STARTUP_RETRY_COUNT", ge=0)
    cors_allow_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"],
        alias="CORS_ALLOW_ORIGINS",
    )

    @field_validator("cors_allow_origins", mode="before")
    @classmethod
    def parse_cors_allow_origins(cls, value: object) -> object:
        if not isinstance(value, str):
            return value

        stripped = value.strip()
        if not stripped:
            return []

        if stripped.startswith("["):
            decoded = json.loads(stripped)
            if not isinstance(decoded, list) or any(not isinstance(item, str) for item in decoded):
                raise ValueError("CORS_ALLOW_ORIGINS must be a JSON array of strings.")
            return decoded

        return [origin.strip() for origin in stripped.split(",") if origin.strip()]

    @field_validator("browser_launch_args", mode="before")
    @classmethod
    def parse_browser_launch_args(cls, value: object) -> object:
        if not isinstance(value, str):
            return value

        stripped = value.strip()
        if not stripped:
            return []

        decoded = json.loads(stripped)
        if not isinstance(decoded, list) or any(not isinstance(item, str) for item in decoded):
            raise ValueError("BROWSER_LAUNCH_ARGS must be a JSON array of strings.")
        return decoded

    @field_validator("openrouter_model")
    @classmethod
    def validate_openrouter_model(cls, value: str) -> str:
        if not is_supported_openrouter_model(value):
            supported_models = ", ".join(sorted(SUPPORTED_OPENROUTER_MODELS))
            raise ValueError(f"OPENROUTER_MODEL must be one of: {supported_models}.")
        return value

    @model_validator(mode="after")
    def validate_openrouter_api_key(self) -> Settings:
        if self.openrouter_api_key is None:
            raise ValueError("OPENROUTER_API_KEY environment variable is not set.")
        if self.browser_provider == "browserless" and self.browserless_token is None:
            raise ValueError("BROWSERLESS_TOKEN environment variable is not set when BROWSER_PROVIDER=browserless.")
        return self

    @property
    def resolved_browser_chromium_sandbox(self) -> bool:
        if self.browser_chromium_sandbox is not None:
            return self.browser_chromium_sandbox

        return not self.browser_container_mode

    @property
    def resolved_browser_launch_args(self) -> list[str]:
        default_args: list[str] = []
        if self.browser_container_mode:
            default_args.append("--disable-dev-shm-usage")
        if not self.resolved_browser_chromium_sandbox:
            default_args.append("--no-sandbox")

        return _merge_browser_launch_args(default_args, self.browser_launch_args)

    @property
    def resolved_browserless_cdp_url(self) -> str:
        token = self.browserless_token
        if token is None:
            raise ValueError("BROWSERLESS_TOKEN environment variable is not set when BROWSER_PROVIDER=browserless.")

        return f"wss://{self.browserless_host}?token={quote(token.get_secret_value(), safe='')}"

    def redact_sensitive_text(self, text: str) -> str:
        redacted = text
        for secret_value in (self.openrouter_api_key, self.browserless_token, self.firecrawl_api_key):
            if secret_value is None:
                continue
            secret = secret_value.get_secret_value()
            for candidate in {secret, quote(secret, safe="")}:
                if candidate:
                    redacted = redacted.replace(candidate, "[REDACTED]")
        return redacted


def _browser_arg_key(arg: str) -> str:
    stripped = arg.strip()
    if not stripped.startswith("-"):
        return stripped

    normalized = stripped.lstrip("-")
    key, _, _ = normalized.partition("=")
    return key


def _merge_browser_launch_args(default_args: list[str], user_args: list[str]) -> list[str]:
    merged: dict[str, str] = {}

    for arg in [*default_args, *user_args]:
        key = _browser_arg_key(arg)
        if key in merged:
            merged.pop(key)
        merged[key] = arg

    return list(merged.values())


@lru_cache
def get_settings() -> Settings:
    """Return cached settings loaded from the environment."""

    return Settings()
