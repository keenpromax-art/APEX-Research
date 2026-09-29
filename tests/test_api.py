import json

from fastapi.testclient import TestClient

from app.api import AnalysisPipeline, create_app
from lib.ai.engine import AIEngine
from lib.config import Settings
from lib.data.adapter import RawTickerData
from tests.conftest import StubAdapter, StubProvider, make_raw_data


def _settings():
    return Settings(
        ai_provider="openrouter",
        openrouter_api_key="stub",
        openrouter_model="stub",
        groq_api_key=None,
        groq_model="stub",
        gemini_api_key=None,
        gemini_model="stub",
        cache_ttl_seconds=60,
        yfinance_timeout_seconds=5,
        ai_timeout_seconds=30,
    )


def _client(adapter, provider):
    engine = AIEngine(provider, timeout=30.0)
    pipeline = AnalysisPipeline(adapter, engine)
    return TestClient(create_app(_settings(), pipeline=pipeline))


def _sse_lines(response, prefix):
    return [line for line in response.iter_lines() if line.startswith(prefix)]


def test_invalid_ticker_returns_400_json():
    client = _client(StubAdapter(lambda t: make_raw_data(t)), StubProvider())
    response = client.get("/api/analyze", params={"tickers": "!!!bad!!!"})
    assert response.status_code == 400
    assert "error" in response.json()


def test_too_many_tickers_rejected():
    client = _client(StubAdapter(lambda t: make_raw_data(t)), StubProvider())
    response = client.get("/api/analyze", params={"tickers": "A,B,C,D,E,F"})
    assert response.status_code == 400


def test_not_found_ticker_streams_clear_error():
    adapter = StubAdapter(lambda t: RawTickerData(ticker=t, retrieved_at="2026-01-01"))
    client = _client(adapter, StubProvider())
    with client.stream("GET", "/api/analyze", params={"tickers": "NOPE"}) as response:
        data_lines = _sse_lines(response, "data: ")
    assert any("Unable to retrieve data" in line for line in data_lines)


def test_successful_analysis_streams_status_then_result(valid_document):
    client = _client(StubAdapter(lambda t: make_raw_data(t)), StubProvider(responses=[valid_document]))
    with client.stream("GET", "/api/analyze", params={"tickers": "TEST"}) as response:
        body = "".join(response.iter_lines())
    assert "event: status" in body
    assert "Fetching data..." in body
    assert "AI analyzing..." in body
    assert "event: result" in body
    assert "Test Analysis" in body


def test_multi_ticker_input_accepted(valid_document):
    client = _client(StubAdapter(lambda t: make_raw_data(t)), StubProvider(responses=[valid_document]))
    with client.stream("GET", "/api/analyze", params={"tickers": "AAA, BBB"}) as response:
        body = "".join(response.iter_lines())
    assert "event: result" in body


def test_provider_factory_selects_configured_provider():
    from lib.ai.provider import GeminiProvider, GroqProvider, OpenRouterProvider, build_provider

    base = dict(
        openrouter_api_key="k",
        openrouter_model="m",
        groq_api_key="k",
        groq_model="m",
        gemini_api_key="k",
        gemini_model="m",
        cache_ttl_seconds=60,
        yfinance_timeout_seconds=5,
        ai_timeout_seconds=30,
    )
    assert isinstance(build_provider(Settings(ai_provider="openrouter", **base)), OpenRouterProvider)
    assert isinstance(build_provider(Settings(ai_provider="groq", **base)), GroqProvider)
    assert isinstance(build_provider(Settings(ai_provider="gemini", **base)), GeminiProvider)
    assert build_provider(Settings(ai_provider="unknown", **base)) is None
    assert build_provider(Settings(ai_provider="groq", groq_api_key=None, **{k: v for k, v in base.items() if k != "groq_api_key"})) is None
