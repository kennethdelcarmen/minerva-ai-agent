from __future__ import annotations

import pytest

from backend.agent.firecrawl_fallback import (
    extract_target_url_from_blocked_url,
    resolve_firecrawl_source_url,
    scrape_with_firecrawl,
)
from backend.config import Settings


class FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


class FakeAsyncClient:
    calls: list[dict] = []
    responses: list[FakeResponse] = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs

    async def __aenter__(self) -> "FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def post(self, url: str, *, headers: dict, json: dict) -> FakeResponse:
        self.__class__.calls.append({"url": url, "headers": headers, "json": json})
        if not self.__class__.responses:
            raise AssertionError("No fake Firecrawl responses remaining.")
        return self.__class__.responses.pop(0)


def test_extract_target_url_from_blocked_url_supports_shopee_and_google() -> None:
    assert (
        extract_target_url_from_blocked_url(
            "https://shopee.ph/verify/traffic/error?home_url=https%3A%2F%2Fshopee.ph%2Fsearch%3Fkeyword%3Dtoothbrush"
        )
        == "https://shopee.ph/search?keyword=toothbrush"
    )
    assert (
        extract_target_url_from_blocked_url(
            "https://www.google.com/sorry/index?continue=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3Dbest%2Btoothbrush"
        )
        == "https://www.google.com/search?q=best+toothbrush"
    )


def test_resolve_firecrawl_source_url_prefers_requested_then_embedded_then_active() -> None:
    blocked_url = "https://shopee.ph/verify/traffic/error?home_url=https%3A%2F%2Fshopee.ph"

    assert (
        resolve_firecrawl_source_url(
            blocked_url=blocked_url,
            requested_url="https://shopee.ph/search?keyword=toothbrush",
            active_source_url="https://shopee.ph",
        )
        == "https://shopee.ph/search?keyword=toothbrush"
    )
    assert (
        resolve_firecrawl_source_url(
            blocked_url="https://www.google.com/sorry/index?continue=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3Dbest%2Btoothbrush",
            requested_url=None,
            active_source_url="https://www.google.com/",
        )
        == "https://www.google.com/search?q=best+toothbrush"
    )
    assert (
        resolve_firecrawl_source_url(
            blocked_url=blocked_url,
            requested_url=None,
            active_source_url="https://shopee.ph/product/123",
        )
        == "https://shopee.ph"
    )
    assert (
        resolve_firecrawl_source_url(
            blocked_url="https://blocked.example.com/challenge",
            requested_url=None,
            active_source_url=None,
        )
        == "https://blocked.example.com/challenge"
    )


@pytest.mark.asyncio
async def test_scrape_with_firecrawl_retries_with_relaxed_payload_and_uses_html_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        GOOGLE_API_KEY="test-key",
        BROWSER_PROVIDER="local",
        FIRECRAWL_API_KEY="fc-test-key",
    )
    FakeAsyncClient.calls = []
    FakeAsyncClient.responses = [
        FakeResponse({"success": True, "data": {"markdown": "   ", "html": "<html><body></body></html>"}}),
        FakeResponse(
            {
                "success": True,
                "data": {
                    "markdown": "   ",
                    "html": (
                        "<html><body><h1>Page Unavailable</h1>"
                        "<p>Sorry, something went wrong. Please log in and try again.</p></body></html>"
                    ),
                },
            }
        ),
    ]

    from backend.agent import firecrawl_fallback as fallback_module

    monkeypatch.setattr(fallback_module.httpx, "AsyncClient", FakeAsyncClient)

    content = await scrape_with_firecrawl(
        url="https://shopee.sg/verify/traffic/error?home_url=https%3A%2F%2Fshopee.sg",
        settings=settings,
    )

    assert "Page Unavailable" in content
    assert "Please log in and try again." in content
    assert len(FakeAsyncClient.calls) == 2
    assert FakeAsyncClient.calls[0]["json"]["onlyMainContent"] is True
    assert FakeAsyncClient.calls[0]["json"]["onlyCleanContent"] is True
    assert FakeAsyncClient.calls[1]["json"]["onlyMainContent"] is False
    assert FakeAsyncClient.calls[1]["json"]["onlyCleanContent"] is False
