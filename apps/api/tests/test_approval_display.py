from __future__ import annotations

from backend.agent.approval_display import describe_approval_action


def test_describe_approval_action_prefers_specific_click_target() -> None:
    description = describe_approval_action("click", {"description": "Submit checkout form", "index": 4})

    assert description == 'Click "Submit checkout form"'


def test_describe_approval_action_falls_back_to_index_when_needed() -> None:
    description = describe_approval_action("click", {"index": 4})

    assert description == "Click element #4"
