from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import pytest

from lib.ai.engine import AIEngine
from lib.ai.provider import AIProvider
from lib.analysis.calculator import calculate
from lib.analysis.context import build_context
from lib.analysis.normalizer import normalize
from lib.data.adapter import RawTickerData, YFinanceAdapter


def _statement_df(rows: dict[str, list[float]], periods: list[str]) -> pd.DataFrame:
    return pd.DataFrame.from_dict(rows, orient="index", columns=pd.to_datetime(periods))


def _price_history(days: int = 600, start: float = 100.0) -> pd.DataFrame:
    dates = [date(2024, 1, 1) + timedelta(days=i) for i in range(days)]
    closes = [start * (1.001 ** i) for i in range(days)]
    return pd.DataFrame({"Close": closes, "Volume": [1000] * days}, index=pd.to_datetime(dates))


def make_raw_data(ticker: str = "TEST", *, with_income: bool = True, with_balance: bool = True, with_cashflow: bool = True, with_history: bool = True) -> RawTickerData:
    periods = ["2025-03-31", "2024-03-31"]
    income = _statement_df(
        {
            "Total Revenue": [1000.0, 900.0],
            "Cost Of Revenue": [600.0, 550.0],
            "Gross Profit": [400.0, 350.0],
            "Operating Income": [200.0, 180.0],
            "EBITDA": [250.0, 220.0],
            "Net Income": [150.0, 130.0],
            "Diluted EPS": [3.0, 2.6],
            "Diluted Average Shares": [50.0, 50.0],
        },
        periods,
    )
    balance = _statement_df(
        {
            "Total Assets": [2000.0, 1900.0],
            "Total Debt": [500.0, 480.0],
            "Stockholders Equity": [1000.0, 950.0],
            "Cash And Cash Equivalents": [200.0, 180.0],
            "Total Current Assets": [800.0, 750.0],
            "Total Current Liabilities": [400.0, 380.0],
            "Inventory": [100.0, 90.0],
            "Common Stock Shares Outstanding": [50.0, 50.0],
        },
        periods,
    )
    cashflow = _statement_df(
        {
            "Operating Cash Flow": [300.0, 280.0],
            "Capital Expenditure": [-100.0, -90.0],
            "Free Cash Flow": [200.0, 190.0],
            "Change In Working Capital": [10.0, 5.0],
        },
        periods,
    )
    info = {
        "shortName": "Test Co",
        "longName": "Test Company Ltd",
        "sector": "Technology",
        "industry": "Software",
        "currency": "USD",
        "regularMarketPrice": 150.0,
        "regularMarketChange": 2.0,
        "regularMarketChangePercent": 0.0135,
        "marketCap": 7500.0,
        "sharesOutstanding": 50.0,
        "trailingPE": 10.0,
        "priceToBook": 3.0,
        "dividendYield": 0.02,
    }
    return RawTickerData(
        ticker=ticker,
        retrieved_at="2026-09-28T00:00:00+00:00",
        info=info,
        income_statement=income if with_income else None,
        balance_sheet=balance if with_balance else None,
        cash_flow=cashflow if with_cashflow else None,
        price_history=_price_history() if with_history else None,
        dividends=pd.Series([1.0, 1.1], index=pd.to_datetime(["2025-06-01", "2025-09-01"])),
        splits=None,
        shares_outstanding=pd.Series([50.0], index=pd.to_datetime(["2025-01-01"])),
        earnings_dates=None,
        major_holders=None,
        institutional_holders=None,
    )


class StubAdapter(YFinanceAdapter):
    def __init__(self, behavior):
        super().__init__(timeout=0.5)
        self._behavior = behavior

    def _fetch_uncached(self, ticker: str) -> RawTickerData:
        return self._behavior(ticker)


class StubProvider(AIProvider):
    def __init__(self, responses: list[str] | None = None, sleep: float = 0.0):
        self._responses = list(responses or [])
        self._sleep = sleep
        self.calls = 0

    def generate(self, messages, *, temperature: float = 0.2, timeout: float = 120.0) -> str:
        from lib.exceptions import AITimeoutError

        self.calls += 1
        if self._sleep and self._sleep > timeout:
            raise AITimeoutError(timeout)
        if self._sleep:
            import time

            time.sleep(self._sleep)
        if self._responses:
            return self._responses.pop(0)
        return "{}"


@pytest.fixture
def raw_data():
    return make_raw_data()


@pytest.fixture
def normalized(raw_data):
    return normalize(raw_data)


@pytest.fixture
def derived(normalized):
    return calculate(normalized)


@pytest.fixture
def context(normalized, derived):
    return build_context([normalized], [derived], "Analyze this company.")


@pytest.fixture
def valid_document(context) -> str:
    revenue = context["companies"][0]["financials"]["income_statement"]["lineItems"]["Total Revenue"]["2025-03-31"]
    growth = context["companies"][0]["derivedMetrics"]["revenue_growth"]["value"]
    return (
        '{"title":"Test Analysis","summary":"Revenue was 1000 last year.",'
        '"blocks":['
        '{"type":"heading","level":2,"content":"Overview"},'
        '{"type":"paragraph","content":"Revenue grew to 1000 from 900."},'
        f'{{"type":"metric","label":"Revenue growth","value":{growth},"unit":"percent","metricKey":"revenue_growth"}},'
        '{"type":"table","columns":["Item","FY2025"],"rows":[["Revenue",1000]]},'
        '{"type":"callout","variant":"info","content":"Data as of 2026."},'
        '{"type":"list","ordered":false,"items":["First point about 150"]},'
        '{"type":"formula","expression":"1000 / 900 - 1","result":0.1111111111111111},'
        '{"type":"provenance","items":[{"claim":"Revenue increased","value":1000,"source":"yfinance"}]},'
        '{"type":"chart","title":"Price","chartType":"line","ref":"price"}'
        "]}"
    )


@pytest.fixture
def minimal_document() -> str:
    return (
        '{"title":"Minimal Analysis","summary":"Price was 150 and market cap 7500.",'
        '"blocks":['
        '{"type":"heading","level":2,"content":"Overview"},'
        '{"type":"paragraph","content":"The stock traded at 150 with a market cap of 7500."},'
        '{"type":"callout","variant":"uncertainty","content":"Financial statements unavailable."},'
        '{"type":"table","columns":["Item","Value"],"rows":[["Price",150],["Market Cap",7500]]}'
        "]}"
    )


@pytest.fixture
def pipeline_components():
    def make(behavior, responses=None, sleep=0.0, ai_timeout=120.0):
        adapter = StubAdapter(behavior)
        provider = StubProvider(responses=responses, sleep=sleep)
        engine = AIEngine(provider, timeout=ai_timeout)
        from app.api import AnalysisPipeline

        return AnalysisPipeline(adapter, engine), provider

    return make
