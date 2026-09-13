"""Supported OpenRouter model catalog."""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_OPENROUTER_MODEL = "openrouter/free"


@dataclass(frozen=True)
class ModelOption:
    id: str
    label: str


OPENROUTER_MODEL_OPTIONS: tuple[ModelOption, ...] = (
    ModelOption(id="openrouter/free", label="OpenRouter Free Router"),
)

SUPPORTED_OPENROUTER_MODELS = frozenset(option.id for option in OPENROUTER_MODEL_OPTIONS)


def is_supported_openrouter_model(model: str) -> bool:
    """Return whether the provided model id is supported."""

    return model in SUPPORTED_OPENROUTER_MODELS
