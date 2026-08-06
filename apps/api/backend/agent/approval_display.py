"""Human-readable descriptions for approval-gated actions."""

from __future__ import annotations

import json
from typing import Any


def _humanize_action_name(action_name: str) -> str:
    return action_name.replace("_", " ").strip()


def _format_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        parts = [_format_value(item) for item in value]
        rendered = ", ".join(part for part in parts if part)
        return rendered or None
    if isinstance(value, dict):
        try:
            return json.dumps(value, separators=(", ", ": "))
        except TypeError:
            return str(value)
    return str(value)


def _find_first(params: dict[str, Any], keys: tuple[str, ...]) -> tuple[str, str] | None:
    for key in keys:
        value = _format_value(params.get(key))
        if value:
            return key, value
    return None


def _quote(value: str) -> str:
    return f'"{value}"'


def _format_target(match: tuple[str, str] | None) -> str | None:
    if match is None:
        return None

    key, value = match
    if key == "url":
        return f"the link to {value}"
    if key in {"selector", "xpath"}:
        return f"element {_quote(value)}"
    return _quote(value)


def _format_field(match: tuple[str, str] | None) -> str | None:
    if match is None:
        return None

    key, value = match
    if key == "index":
        return f"field #{value}"
    if key in {"selector", "xpath"}:
        return f"field {_quote(value)}"
    return _quote(value)


def describe_approval_action(action_name: str, params: dict[str, Any]) -> str:
    """Return a concise description of the exact action awaiting approval."""

    if action_name == "click":
        target = _format_target(
            _find_first(params, ("description", "element", "target", "label", "text", "selector", "url", "xpath"))
        )
        if target:
            return f"Click {target}"
        index = _find_first(params, ("index",))
        if index:
            return f"Click element #{index[1]}"
        return "Click the highlighted element"

    if action_name == "input":
        value = _find_first(params, ("text", "value", "content"))
        field = _format_field(_find_first(params, ("label", "field", "name", "description", "selector", "index")))
        if value and field:
            return f'Type {_quote(value[1])} into {field}'
        if field:
            return f"Type into {field}"
        if value:
            return f'Type {_quote(value[1])}'
        return "Type into the current field"

    if action_name == "send_keys":
        keys = _find_first(params, ("keys", "key", "shortcut", "text", "value"))
        if keys:
            return f'Press {_quote(keys[1])}'
        return "Send keyboard input"

    if action_name == "select_dropdown_option":
        option = _find_first(params, ("value", "option", "text", "selection"))
        field = _format_field(_find_first(params, ("label", "field", "name", "selector", "index")))
        if option and field:
            return f'Select {_quote(option[1])} in {field}'
        if option:
            return f'Select {_quote(option[1])}'
        if field:
            return f"Change {field}"
        return "Change the selected dropdown option"

    if action_name == "upload_file":
        file_match = _find_first(params, ("path", "file", "filename", "name"))
        field = _format_field(_find_first(params, ("label", "field", "selector", "index")))
        if file_match and field:
            return f'Upload {_quote(file_match[1])} to {field}'
        if file_match:
            return f'Upload {_quote(file_match[1])}'
        return "Upload a file"

    if action_name == "save_as_pdf":
        filename = _find_first(params, ("filename", "path", "name"))
        if filename:
            return f'Save the page as PDF {_quote(filename[1])}'
        return "Save the page as PDF"

    if action_name == "close_tab":
        return "Close the current tab"

    match = _find_first(params, ("description", "label", "text", "value", "selector", "url", "index"))
    if match:
        target = _format_target(match)
        if target:
            return f"{_humanize_action_name(action_name).capitalize()} {target}"

    return _humanize_action_name(action_name).capitalize()
