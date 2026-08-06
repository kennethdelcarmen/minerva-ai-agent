"""Supported Google AI Studio model catalog."""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash-lite"


@dataclass(frozen=True)
class ModelOption:
    id: str
    label: str


GOOGLE_MODEL_OPTIONS: tuple[ModelOption, ...] = (
    ModelOption(id="gemini-3.5-flash-lite", label="Gemini 3.5 Flash-Lite"),
    ModelOption(id="gemini-3.5-flash", label="Gemini 3.5 Flash"),
    ModelOption(id="gemini-3.6-flash", label="Gemini 3.6 Flash"),
)

SUPPORTED_GOOGLE_MODELS = frozenset(option.id for option in GOOGLE_MODEL_OPTIONS)


def is_supported_google_model(model: str) -> bool:
    """Return whether the provided model id is supported."""

    return model in SUPPORTED_GOOGLE_MODELS
