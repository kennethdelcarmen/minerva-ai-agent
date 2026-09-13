"""LLM client factory helpers."""

from __future__ import annotations

from browser_use.llm import ChatOpenRouter

from backend.config import Settings


def create_openrouter_llm(*, model: str, settings: Settings) -> ChatOpenRouter:
    """Create an OpenRouter-backed browser-use chat client."""

    return ChatOpenRouter(
        model=model,
        api_key=settings.openrouter_api_key.get_secret_value(),
    )
