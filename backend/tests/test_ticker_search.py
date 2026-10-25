from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.services import ticker_search

_FIXTURE = {
    "quotes": [
        {"symbol": "INOXWIND.NS", "shortname": "INOX WIND LIMITED", "longname": "Inox Wind Limited", "exchange": "NSI", "quoteType": "EQUITY"},
        {"symbol": "INOXWIND.BO", "shortname": "Inox Wind Limited", "exchange": "BSE", "quoteType": "EQUITY"},
        {"symbol": "AAPL", "shortname": "Apple Inc.", "exchange": "NMS", "quoteType": "EQUITY"},
        {"shortname": "row without symbol"},
        {"symbol": "", "shortname": "empty symbol row"},
    ]
}


def test_search_maps_and_filters(monkeypatch):
    calls: list[str] = []

    def fake_fetch(query: str, limit: int) -> dict:
        calls.append(query)
        return _FIXTURE

    monkeypatch.setattr(ticker_search, "_fetch_yahoo", fake_fetch)
    client = TestClient(app)
    response = client.get("/api/ticker/search", params={"q": "inox wind"})
    assert response.status_code == 200
    body = response.json()
    assert body["query"] == "inox wind"
    results = body["results"]
    assert [row["symbol"] for row in results] == ["INOXWIND.NS", "INOXWIND.BO", "AAPL"]
    assert results[0]["name"] == "Inox Wind Limited"
    assert results[0]["exchange"] == "NSI"
    assert results[0]["quote_type"] == "EQUITY"
    assert results[1]["name"] == "Inox Wind Limited"
    assert calls == ["inox wind"]

    cached = client.get("/api/ticker/search", params={"q": "inox wind"})
    assert cached.status_code == 200
    assert len(cached.json()["results"]) == 3
    assert calls == ["inox wind"], "second identical query should be served from cache"


def test_search_limit_is_passed_and_respected(monkeypatch):
    seen: dict[str, int] = {}

    def fake_fetch(query: str, limit: int) -> dict:
        seen["limit"] = limit
        return _FIXTURE

    monkeypatch.setattr(ticker_search, "_fetch_yahoo", fake_fetch)
    client = TestClient(app)
    results = client.get("/api/ticker/search", params={"q": "apple", "limit": 2}).json()["results"]
    assert seen["limit"] == 2
    assert len(results) == 2


def test_search_short_or_missing_query_skips_upstream(monkeypatch):
    def fail_fetch(query: str, limit: int) -> dict:
        raise AssertionError("short queries must not hit the network")

    monkeypatch.setattr(ticker_search, "_fetch_yahoo", fail_fetch)
    client = TestClient(app)
    assert client.get("/api/ticker/search", params={"q": "a"}).json()["results"] == []
    assert client.get("/api/ticker/search", params={"q": "  "}).json()["results"] == []
    assert client.get("/api/ticker/search").json()["results"] == []


def test_search_upstream_failure_returns_empty(monkeypatch):
    def boom(query: str, limit: int) -> dict:
        raise RuntimeError("yahoo down")

    monkeypatch.setattr(ticker_search, "_fetch_yahoo", boom)
    client = TestClient(app)
    response = client.get("/api/ticker/search", params={"q": "MSFT"})
    assert response.status_code == 200
    assert response.json()["results"] == []


def test_search_normalization_unit():
    rows = ticker_search._normalize(
        {"quotes": [{"symbol": " MSFT ", "shortname": "Microsoft Corporation"}, {"symbol": "VOO", "quoteType": "ETF"}]},
        limit=5,
    )
    assert rows == [
        {"symbol": "MSFT", "name": "Microsoft Corporation", "exchange": "", "quote_type": ""},
        {"symbol": "VOO", "name": "VOO", "exchange": "", "quote_type": "ETF"},
    ]
