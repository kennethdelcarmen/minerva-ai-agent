"""Application configuration."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    google_api_key: SecretStr = Field(
        validation_alias=AliasChoices("GOOGLE_API_KEY", "GEMINI_API_KEY"),
        serialization_alias="GOOGLE_API_KEY",
    )
    google_model: str = Field(
        default="gemini-3.6-flash",
        validation_alias=AliasChoices("GOOGLE_MODEL", "GEMINI_MODEL"),
        serialization_alias="GOOGLE_MODEL",
    )
    headless: bool = Field(default=False, alias="HEADLESS")
    artifact_root: Path = Field(default=Path(".runs"), alias="ARTIFACT_ROOT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    max_steps: int = Field(default=25, alias="MAX_STEPS")


@lru_cache
def get_settings() -> Settings:
    """Return cached settings loaded from the environment."""

    return Settings()
