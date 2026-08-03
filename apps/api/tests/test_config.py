from __future__ import annotations

import os

import pytest
from pydantic import ValidationError

from backend.config import Settings


def test_settings_require_google_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)
