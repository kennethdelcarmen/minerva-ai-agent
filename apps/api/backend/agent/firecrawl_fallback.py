"""Firecrawl fallback helpers for anti-bot recovery."""

from __future__ import annotations

from dataclasses import dataclass, field
from html import unescape
import re
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from backend.config import Settings

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

BOT_BLOCK_URL_INDICATORS = (
    "verify/traffic/error",
    "sorry/index",
)

SHOPEE_HOST_MARKERS = (
    "://shopee.",
    ".shopee.",
)

SHOPEE_TRAFFIC_ERROR_COPY = (
    "page unavailable",
    "sorry, something went wrong",
    "please log in and try again",
)

SOURCE_URL_QUERY_KEYS = (
    "continue",
    "home_url",
    "url",
    "redirect_url",
    "return_url",
    "next",
)

EMPTY_PAGE_URLS = {
    "",
    "about:blank",
}

EMPTY_PAGE_TITLES = {
    "",
    "empty tab",
}


@dataclass
class FirecrawlFallbackState:
    """Track which blocked pages have fallback markdown available."""

    markdown_by_url: dict[str, str] = field(default_factory=dict)
    active_blocked_url: str | None = None
    active_source_url: str | None = None
    last_reachable_url: str | None = None
    failed_urls: set[str] = field(default_factory=set)
    reported_failure_urls: set[str] = field(default_factory=set)
    prompted_urls: set[str] = field(default_factory=set)


def _normalize_text(value: str) -> str:
    return " ".join(value.casefold().split())


def is_bot_blocked(url: str | None, page_content: str, title: str) -> bool:
    """Return True when a page looks like an anti-bot or CAPTCHA wall."""

    normalized_url = _normalize_text(url or "")
    normalized_title = _normalize_text(title)
    normalized_content = _normalize_text(page_content)
    combined = f"{normalized_url}\n{normalized_title}\n{normalized_content}"

    if any(indicator in normalized_url for indicator in BOT_BLOCK_URL_INDICATORS):
        return True

    if any(indicator in combined for indicator in BOT_BLOCK_INDICATORS):
        return True

    if any(indicator in combined for indicator in BOT_BLOCK_STATUS_HINTS):
        return True

    if any(host_marker in normalized_url for host_marker in SHOPEE_HOST_MARKERS):
        return sum(copy in combined for copy in SHOPEE_TRAFFIC_ERROR_COPY) >= 2

    return False


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


def _is_http_url(value: str | None) -> bool:
    if not value:
        return False
    parsed = urlparse(value.strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _decode_nested_url(value: str) -> str | None:
    candidate = value.strip()
    for _ in range(3):
        if _is_http_url(candidate):
            return candidate
        decoded = unquote(candidate)
        if decoded == candidate:
            break
        candidate = decoded.strip()
    return candidate if _is_http_url(candidate) else None


def extract_target_url_from_blocked_url(blocked_url: str) -> str | None:
    """Extract the intended destination from a blocked wrapper URL when possible."""

    parsed = urlparse(blocked_url)
    query_params = parse_qs(parsed.query)
    for key in SOURCE_URL_QUERY_KEYS:
        values = query_params.get(key)
        if not values:
            continue
        for value in values:
            decoded = _decode_nested_url(value)
            if decoded and decoded != blocked_url:
                return decoded
    return None


def resolve_firecrawl_source_url(
    *,
    blocked_url: str,
    requested_url: str | None = None,
    active_source_url: str | None = None,
) -> str:
    """Resolve the intended source URL to scrape when the browser is on a blocked page."""

    for candidate in (
        _decode_nested_url(requested_url) if requested_url else None,
        extract_target_url_from_blocked_url(blocked_url),
        _decode_nested_url(active_source_url) if active_source_url else None,
    ):
        if candidate and candidate != blocked_url:
            return candidate

    return blocked_url


def _html_to_text(value: str) -> str:
    without_scripts = re.sub(r"(?is)<(script|style)\b.*?>.*?</\1>", " ", value)
    with_breaks = re.sub(r"(?i)<\s*(br|/p|/div|/li|/tr|/h[1-6])\b[^>]*>", "\n", without_scripts)
    without_tags = re.sub(r"(?s)<[^>]+>", " ", with_breaks)
    lines = [line.strip() for line in unescape(without_tags).splitlines() if line.strip()]
    return "\n".join(lines).strip()


def _extract_firecrawl_content(payload: dict) -> str | None:
    data = payload.get("data")
    if not isinstance(data, dict):
        return None

    markdown = data.get("markdown")
    if isinstance(markdown, str) and markdown.strip():
        return markdown.strip()

    html = data.get("html")
    if isinstance(html, str) and html.strip():
        text = _html_to_text(html)
        if text:
            return text

    return None


async def scrape_with_firecrawl(*, url: str, settings: Settings) -> str:
    """Fetch markdown for a blocked page through Firecrawl's scrape API."""

    api_key = settings.firecrawl_api_key
    if api_key is None:
        raise RuntimeError("FIRECRAWL_API_KEY environment variable is not set.")

    endpoint = f"{settings.firecrawl_base_url.rstrip('/')}/scrape"
    headers = {
        "Authorization": f"Bearer {api_key.get_secret_value()}",
        "Content-Type": "application/json",
    }
    request_payloads = [
        {
            "url": url,
            "formats": ["markdown", "html"],
            "onlyMainContent": True,
            "onlyCleanContent": True,
            "removeBase64Images": True,
            "blockAds": True,
            "proxy": "auto",
        },
        {
            "url": url,
            "formats": ["markdown", "html"],
            "onlyMainContent": False,
            "onlyCleanContent": False,
            "removeBase64Images": True,
            "blockAds": True,
            "proxy": "auto",
        },
    ]

    timeout = httpx.Timeout(60.0, connect=10.0)
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        for payload in request_payloads:
            response = await client.post(endpoint, headers=headers, json=payload)
            response.raise_for_status()
            body = response.json()
            content = _extract_firecrawl_content(body)
            if body.get("success") and content:
                return content

    raise RuntimeError("Firecrawl returned an empty content response.")
