from __future__ import annotations

from backend.agent.policies import should_require_approval


def test_speed_mode_allows_navigation_like_clicks() -> None:
    requires_approval, reason = should_require_approval(
        "click",
        {"description": "Open docs link"},
        approval_mode="speed",
    )

    assert requires_approval is False
    assert reason is None


def test_speed_mode_keeps_payment_clicks_gated() -> None:
    requires_approval, reason = should_require_approval(
        "click",
        {"description": "Confirm payment"},
        approval_mode="speed",
    )

    assert requires_approval is True
    assert reason is not None


def test_speed_mode_allows_filter_dropdown_changes() -> None:
    requires_approval, reason = should_require_approval(
        "select_dropdown_option",
        {"label": "Sort results", "value": "Price: Low to High"},
        approval_mode="speed",
    )

    assert requires_approval is False
    assert reason is None


def test_strict_mode_still_gates_close_tab() -> None:
    requires_approval, reason = should_require_approval(
        "close_tab",
        {},
        approval_mode="strict",
    )

    assert requires_approval is True
    assert reason is not None
