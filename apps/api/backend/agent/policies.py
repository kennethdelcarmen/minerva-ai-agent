"""Approval policy for browser actions."""

from __future__ import annotations

from typing import Any

SAFE_ACTIONS = {
    "navigate",
    "search",
    "go_back",
    "go_forward",
    "scroll",
    "wait",
    "extract",
    "find_elements",
    "search_page",
    "screenshot",
    "switch_tab",
    "get_dropdown_options",
    "done",
}

GATED_ACTIONS = {
    "click",
    "input",
    "send_keys",
    "select_dropdown_option",
    "upload_file",
    "save_as_pdf",
}

RISKY_KEYWORDS = {
    "delete",
    "remove",
    "logout",
    "log out",
    "login",
    "log in",
    "sign in",
    "sign-in",
    "sign up",
    "submit",
    "confirm",
    "purchase",
    "buy",
    "checkout",
    "payment",
    "pay",
    "download",
    "upload",
    "authorize",
}

SAFE_NAVIGATION_HINTS = {
    "link",
    "open",
    "home",
    "back",
    "next page",
    "previous page",
    "learn more",
    "details",
    "pricing",
    "documentation",
    "docs",
    "read more",
}

SAFE_FILTER_HINTS = {
    "sort",
    "filter",
    "view",
    "show",
    "results",
    "per page",
    "order",
}


def _flatten_param_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value.lower()]
    if isinstance(value, dict):
        strings: list[str] = []
        for key, item in value.items():
            strings.append(str(key).lower())
            strings.extend(_flatten_param_strings(item))
        return strings
    if isinstance(value, (list, tuple, set)):
        strings: list[str] = []
        for item in value:
            strings.extend(_flatten_param_strings(item))
        return strings
    return []


def _contains_any(strings: list[str], keywords: set[str]) -> bool:
    return any(keyword in value for value in strings for keyword in keywords)


def _looks_like_safe_navigation_click(params: dict[str, Any]) -> bool:
    strings = _flatten_param_strings(params)
    if not strings or _contains_any(strings, RISKY_KEYWORDS):
        return False

    return _contains_any(strings, SAFE_NAVIGATION_HINTS)


def _looks_like_safe_filter_change(params: dict[str, Any]) -> bool:
    strings = _flatten_param_strings(params)
    if not strings or _contains_any(strings, RISKY_KEYWORDS):
        return False

    return _contains_any(strings, SAFE_FILTER_HINTS)


def should_require_approval(
    action_name: str,
    params: dict[str, Any],
    *,
    approval_mode: str = "strict",
) -> tuple[bool, str | None]:
    """Return whether the action must be approved before execution."""

    if action_name in SAFE_ACTIONS:
        return False, None

    if approval_mode == "speed":
        if action_name == "close_tab":
            return False, None
        if action_name == "click" and _looks_like_safe_navigation_click(params):
            return False, None
        if action_name == "select_dropdown_option" and _looks_like_safe_filter_change(params):
            return False, None

    if action_name in GATED_ACTIONS:
        if action_name == "click":
            return True, "Clicks can submit forms, trigger downloads, or perform destructive actions."
        if action_name == "input":
            return True, "Typing can submit credentials or alter form state."
        if action_name == "send_keys":
            return True, "Keyboard shortcuts can submit forms or trigger downloads."
        if action_name == "select_dropdown_option":
            return True, "Changing a dropdown can alter filters, forms, or account state."
        if action_name == "upload_file":
            return True, "File upload is a write-like action that should be operator-approved."
        if action_name == "save_as_pdf":
            return True, "Saving a file creates a local artifact and should be reviewable."

    if action_name == "close_tab":
        return True, "Closing a tab can discard browser state or interrupt a workflow."

    if any(keyword in action_name for keyword in ("delete", "remove", "submit", "logout", "login", "purchase", "checkout")):
        return True, f'Action "{action_name}" is treated as review-required.'

    return True, f'Action "{action_name}" is not classified as safe, so operator approval is required.'
