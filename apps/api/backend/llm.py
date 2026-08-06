"""LLM client factory helpers."""

from __future__ import annotations

from browser_use import ChatGoogle

from backend.config import Settings


def create_google_llm(*, model: str, settings: Settings) -> ChatGoogle:
    """Create a Google AI Studio-backed browser-use chat client."""

    return ChatGoogle(
        model=model,
        api_key=settings.google_api_key.get_secret_value(),
    )
