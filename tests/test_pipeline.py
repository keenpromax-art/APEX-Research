import time

import pytest

from lib.exceptions import (
    AIOutputError,
    AITimeoutError,
    TickerNotFoundError,
    YFinanceError,
    YFinanceTimeoutError,
)
from tests.conftest import StubAdapter, StubProvider, make_raw_data
from lib.ai.engine import AIEngine
from app.api import AnalysisPipeline


def _pipeline(behavior, responses=None, sleep=0.0, ai_timeout=120.0):
    adapter = StubAdapter(behavior)
    provider = StubProvider(responses=responses, sleep=sleep)
    engine = AIEngine(provider, timeout=ai_timeout)
    return AnalysisPipeline(adapter, engine), provider


def test_valid_ticker_produces_blocks(pipeline_components, valid_document):
    pipeline, provider = pipeline_components(lambda t: make_raw_data(t), responses=[valid_document])
    result = pipeline.run(["TEST"], "Analyze this company.", lambda s: None)
    assert result["title"] == "Test Analysis"
    assert len(result["blocks"]) == 9
    assert result["blocks"][0]["type"] == "heading"
    assert result["meta"]["tickers"] == ["TEST"]


def test_missing_income_statement_flagged_and_continues(pipeline_components, minimal_document):
    def behavior(t):
        return make_raw_data(t, with_income=False)

    pipeline, _ = pipeline_components(behavior, responses=[minimal_document])
    result = pipeline.run(["TEST"], "Analyze.", lambda s: None)
    assert result["blocks"]


def test_partial_data_only_info(pipeline_components, minimal_document):
    def behavior(t):
        return make_raw_data(t, with_income=False, with_balance=False, with_cashflow=False, with_history=False)

    pipeline, _ = pipeline_components(behavior, responses=[minimal_document])
    result = pipeline.run(["TEST"], "Analyze.", lambda s: None)
    assert result["blocks"]


def test_multi_ticker_both_datasets_in_context(pipeline_components, valid_document):
    seen = {}

    class RecordingProvider(StubProvider):
        def generate(self, messages, *, temperature=0.2, timeout=120.0):
            import json

            payload = json.loads(messages[1]["content"].split("```json\n")[1].rsplit("\n```", 1)[0])
            seen["tickers"] = [c["ticker"] for c in payload["companies"]]
            return valid_document

    adapter = StubAdapter(lambda t: make_raw_data(t))
    engine = AIEngine(RecordingProvider(), timeout=120.0)
    pipeline = AnalysisPipeline(adapter, engine)
    pipeline.run(["AAA", "BBB"], "Compare.", lambda s: None)
    assert seen["tickers"] == ["AAA", "BBB"]


def test_ai_timeout_raises_clear_error(pipeline_components):
    pipeline, _ = pipeline_components(lambda t: make_raw_data(t), sleep=2.0, ai_timeout=0.3)
    with pytest.raises(AITimeoutError):
        pipeline.run(["TEST"], "Analyze.", lambda s: None)


def test_ai_malformed_output_retries_then_succeeds(pipeline_components, valid_document):
    pipeline, provider = pipeline_components(
        lambda t: make_raw_data(t), responses=["{invalid json", valid_document]
    )
    result = pipeline.run(["TEST"], "Analyze.", lambda s: None)
    assert result["title"] == "Test Analysis"
    assert provider.calls == 2


def test_ai_persistent_malformed_output_raises(pipeline_components):
    pipeline, provider = pipeline_components(lambda t: make_raw_data(t), responses=["{invalid", "still invalid"])
    with pytest.raises(AIOutputError):
        pipeline.run(["TEST"], "Analyze.", lambda s: None)
    assert provider.calls == 2


def test_yfinance_timeout_raises_clear_error(pipeline_components):
    def behavior(t):
        time.sleep(2.0)
        return make_raw_data(t)

    pipeline, _ = pipeline_components(behavior)
    with pytest.raises(YFinanceTimeoutError):
        pipeline.run(["TEST"], "Analyze.", lambda s: None)


def test_yfinance_failure_raises_clear_error(pipeline_components):
    def behavior(t):
        raise RuntimeError("network exploded")

    pipeline, _ = pipeline_components(behavior)
    with pytest.raises(YFinanceError):
        pipeline.run(["TEST"], "Analyze.", lambda s: None)


def test_ticker_not_found_raises(pipeline_components):
    from lib.data.adapter import RawTickerData

    pipeline, _ = pipeline_components(lambda t: RawTickerData(ticker=t, retrieved_at="2026-01-01"))
    with pytest.raises(TickerNotFoundError):
        pipeline.run(["NOPE"], "Analyze.", lambda s: None)


def test_fetch_once_per_request(pipeline_components, valid_document):
    calls = []

    def behavior(t):
        calls.append(t)
        return make_raw_data(t)

    pipeline, _ = pipeline_components(behavior, responses=[valid_document])
    pipeline.run(["TEST"], "Analyze.", lambda s: None)
    assert calls == ["TEST"]
