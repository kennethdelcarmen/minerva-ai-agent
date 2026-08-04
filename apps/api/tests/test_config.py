from __future__ import annotations

import os

import pytest
from pydantic import ValidationError

from backend.config import Settings


def test_settings_require_openrouter_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)
