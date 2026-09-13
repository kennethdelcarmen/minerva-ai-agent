from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend import llm as llm_module
from backend.config import Settings


def test_create_openrouter_llm_passes_model_and_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake_chat_openrouter(**kwargs: object) -> SimpleNamespace:
        captured.update(kwargs)
        return SimpleNamespace(**kwargs)

    monkeypatch.setattr(llm_module, "ChatOpenRouter", fake_chat_openrouter)
    settings = Settings(
        _env_file=None,
        OPENROUTER_API_KEY="test-key",
        BROWSER_PROVIDER="local",
    )

    client = llm_module.create_openrouter_llm(model="openrouter/free", settings=settings)

    assert client.model == "openrouter/free"
    assert captured == {"model": "openrouter/free", "api_key": "test-key"}
