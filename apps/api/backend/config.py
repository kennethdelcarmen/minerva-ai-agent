"""Application configuration."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated
from typing import Any
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from backend.model_catalog import DEFAULT_GOOGLE_MODEL, SUPPORTED_GOOGLE_MODELS, is_supported_google_model

APP_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=APP_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        validate_default=True,
    )

    google_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("GOOGLE_API_KEY"),
        serialization_alias="GOOGLE_API_KEY",
    )
    google_model: str = Field(
        default=DEFAULT_GOOGLE_MODEL,
        validation_alias=AliasChoices("GOOGLE_MODEL"),
        serialization_alias="GOOGLE_MODEL",
    )
    headless: bool = Field(default=True, alias="HEADLESS")
    artifact_root: Path = Field(default=APP_ROOT / ".runs", alias="ARTIFACT_ROOT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    max_steps: int = Field(default=25, alias="MAX_STEPS")
    event_subscriber_queue_size: int = Field(default=128, alias="EVENT_SUBSCRIBER_QUEUE_SIZE", ge=1)
    enable_step_timings: bool = Field(default=True, alias="ENABLE_STEP_TIMINGS")
    step_screenshot_interval: int = Field(default=3, alias="STEP_SCREENSHOT_INTERVAL", ge=0)
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

    @field_validator("google_model")
    @classmethod
    def validate_google_model(cls, value: str) -> str:
        if not is_supported_google_model(value):
            supported_models = ", ".join(sorted(SUPPORTED_GOOGLE_MODELS))
            raise ValueError(f"GOOGLE_MODEL must be one of: {supported_models}.")
        return value

    @model_validator(mode="after")
    def validate_google_api_key(self) -> Settings:
        if self.google_api_key is None:
            raise ValueError("GOOGLE_API_KEY environment variable is not set.")
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
