from __future__ import annotations

import threading
import time

from curl_cffi import requests as curl_requests

_SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search"
_CACHE_TTL_SECONDS = 300.0
_CACHE_MAX_ENTRIES = 500
_MIN_QUERY_LENGTH = 2
_MAX_LIMIT = 25

_cache: dict[str, tuple[float, list[dict]]] = {}
_lock = threading.Lock()


def _fetch_yahoo(query: str, limit: int) -> dict:
    response = curl_requests.get(
        _SEARCH_URL,
        params={
            "q": query,
            "quotesCount": limit,
            "newsCount": 0,
            "listsCount": 0,
            "enableFuzzyQuery": True,
            "quotesQueryId": "tss_match_phrase_query",
            "newsQueryId": "news_cie_vespa",
            "enableCb": "true",
            "enableNavLinks": "true",
        },
        impersonate="chrome",
        timeout=10,
    )
    if response.status_code != 200:
        raise RuntimeError(f"yahoo search failed with HTTP {response.status_code}")
    return response.json()


def _normalize(raw: dict, limit: int) -> list[dict]:
    rows: list[dict] = []
    for item in raw.get("quotes") or []:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or "").strip()
        if not symbol:
            continue
        name = str(item.get("longname") or item.get("shortname") or "").strip() or symbol
        rows.append(
            {
                "symbol": symbol,
                "name": name,
                "exchange": str(item.get("exchange") or "").strip(),
                "quote_type": str(item.get("quoteType") or "").strip(),
            }
        )
        if len(rows) >= limit:
            break
    return rows


def _remember(key: str, rows: list[dict]) -> None:
    with _lock:
        if len(_cache) >= _CACHE_MAX_ENTRIES:
            for old_key, _entry in sorted(_cache.items(), key=lambda kv: kv[1][0])[: _CACHE_MAX_ENTRIES // 2]:
                _cache.pop(old_key, None)
        _cache[key] = (time.monotonic() + _CACHE_TTL_SECONDS, rows)


def search_tickers(query: str, limit: int = 8) -> list[dict]:
    cleaned = " ".join((query or "").split())
    if len(cleaned) < _MIN_QUERY_LENGTH:
        return []
    limit = max(1, min(int(limit), _MAX_LIMIT))
    key = cleaned.lower()
    now = time.monotonic()
    with _lock:
        cached = _cache.get(key)
        if cached and cached[0] > now:
            return [dict(row) for row in cached[1]]
    try:
        rows = _normalize(_fetch_yahoo(cleaned, limit), limit)
    except Exception:
        return []
    _remember(key, rows)
    return rows
