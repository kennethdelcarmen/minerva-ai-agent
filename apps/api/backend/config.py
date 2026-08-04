"""Application configuration."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=APP_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openrouter_api_key: SecretStr = Field(
        validation_alias=AliasChoices("OPENROUTER_API_KEY"),
        serialization_alias="OPENROUTER_API_KEY",
    )
    openrouter_model: str = Field(
        default="google/gemini-2.5-flash:free",
        validation_alias=AliasChoices("OPENROUTER_MODEL"),
        serialization_alias="OPENROUTER_MODEL",
    )
    headless: bool = Field(default=False, alias="HEADLESS")
    artifact_root: Path = Field(default=APP_ROOT / ".runs", alias="ARTIFACT_ROOT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    max_steps: int = Field(default=25, alias="MAX_STEPS")
    cors_allow_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"],
        alias="CORS_ALLOW_ORIGINS",
    )


@lru_cache
def get_settings() -> Settings:
    """Return cached settings loaded from the environment."""

    return Settings()
