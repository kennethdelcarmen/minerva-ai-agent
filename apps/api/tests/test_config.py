from __future__ import annotations

import os

import pytest
from pydantic import ValidationError

from backend.config import Settings


def test_settings_require_openrouter_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_settings_accept_json_cors_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", '["https://app.example.com","https://admin.example.com"]')

    settings = Settings(_env_file=None)

    assert settings.cors_allow_origins == ["https://app.example.com", "https://admin.example.com"]


def test_settings_accept_csv_cors_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "https://app.example.com, https://admin.example.com")

    settings = Settings(_env_file=None)

    assert settings.cors_allow_origins == ["https://app.example.com", "https://admin.example.com"]


def test_headless_defaults_to_true(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.delenv("HEADLESS", raising=False)

    settings = Settings(_env_file=None)

    assert settings.headless is True
