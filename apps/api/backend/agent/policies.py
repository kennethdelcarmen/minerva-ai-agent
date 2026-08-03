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
    "close_tab",
    "save_as_pdf",
}


def should_require_approval(action_name: str, params: dict[str, Any]) -> tuple[bool, str | None]:
    """Return whether the action must be approved before execution."""

    if action_name in SAFE_ACTIONS:
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
        if action_name == "close_tab":
            return True, "Closing a tab can discard browser state or interrupt a workflow."
        if action_name == "save_as_pdf":
            return True, "Saving a file creates a local artifact and should be reviewable."

    if any(keyword in action_name for keyword in ("delete", "remove", "submit", "logout", "login", "purchase", "checkout")):
        return True, f'Action "{action_name}" is treated as review-required.'

    return True, f'Action "{action_name}" is not classified as safe, so operator approval is required.'
