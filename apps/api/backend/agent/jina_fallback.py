"""Jina Reader fallback helpers for anti-bot recovery."""

from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import quote

import httpx

BOT_BLOCK_INDICATORS = (
    "cloudflare",
    "attention required",
    "just a moment",
    "captcha",
    "access denied",
    "forbidden",
    "verify you are human",
    "akamai",
    "bot detection",
    "security check",
    "enable javascript and cookies",
)

BOT_BLOCK_STATUS_HINTS = (
    "403 forbidden",
    "error 403",
    "http 403",
    "status code 403",
)

EMPTY_PAGE_URLS = {
    "",
    "about:blank",
}

EMPTY_PAGE_TITLES = {
    "",
    "empty tab",
}

JINA_READER_BASE_URL = "https://r.jina.ai/"
JINA_READER_HEADERS = {
    "Accept": "text/plain, text/markdown;q=0.9, */*;q=0.8",
    "User-Agent": "MinervaAI/0.1 (+https://r.jina.ai)",
}


@dataclass
class JinaFallbackState:
    """Track which blocked pages have fallback markdown available."""

    markdown_by_url: dict[str, str] = field(default_factory=dict)
    active_blocked_url: str | None = None
    last_reachable_url: str | None = None
    prompted_urls: set[str] = field(default_factory=set)


def _normalize_text(value: str) -> str:
    return " ".join(value.casefold().split())


def is_bot_blocked(page_content: str, title: str) -> bool:
    """Return True when a page looks like an anti-bot or CAPTCHA wall."""

    normalized_title = _normalize_text(title)
    normalized_content = _normalize_text(page_content)
    combined = f"{normalized_title}\n{normalized_content}"

    if any(indicator in combined for indicator in BOT_BLOCK_INDICATORS):
        return True

    return any(indicator in combined for indicator in BOT_BLOCK_STATUS_HINTS)


def is_empty_browser_page(url: str | None, page_content: str, title: str) -> bool:
    """Return True when the browser collapsed to an empty tab-like page."""

    normalized_url = (url or "").strip().casefold()
    normalized_title = _normalize_text(title)
    normalized_content = _normalize_text(page_content)

    return (
        normalized_url in EMPTY_PAGE_URLS
        and normalized_title in EMPTY_PAGE_TITLES
        and not normalized_content
    )


async def fetch_page_via_reader_api(target_url: str) -> str:
    """Fetch LLM-ready markdown for a blocked page through Jina Reader."""

    encoded_url = quote(target_url, safe="")
    reader_url = f"{JINA_READER_BASE_URL}{encoded_url}"

    timeout = httpx.Timeout(20.0, connect=10.0)
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        response = await client.get(reader_url, headers=JINA_READER_HEADERS)
        response.raise_for_status()

    markdown = response.text.strip()
    if not markdown:
        raise RuntimeError("Jina Reader returned an empty response.")

    return markdown
