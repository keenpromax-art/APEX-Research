"""Tests for the yfinance serverless adapter (the only module that calls yfinance)."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python_lib"))

import pandas as pd
import pytest
from adapter import TickerNotFoundError, fetch_ticker


def make_statement(rows: dict[str, list[float]]) -> pd.DataFrame:
    periods = pd.to_datetime(["2025-03-31", "2024-03-31"])
    return pd.DataFrame(rows, index=periods).T


class FakeTicker:
    def __init__(self, ticker):
        self.ticker = ticker
        self.income_stmt = make_statement(
            {"Total Revenue": [1000.0, 900.0], "Net Income": [150.0, 130.0]}
        )
        self.balance_sheet = make_statement({"Total Assets": [2000.0, 1900.0]})
        self.cashflow = make_statement({"Operating Cash Flow": [300.0, 280.0]})
        self.quarterly_income_stmt = pd.DataFrame()
        self.quarterly_balance_sheet = pd.DataFrame()
        self.quarterly_cashflow = pd.DataFrame()
        dates = pd.date_range("2024-01-01", periods=100, freq="D")
        self._history_df = pd.DataFrame(
            {"Close": range(100, 200), "Volume": [1000] * 100}, index=dates
        )
        self.dividends = pd.Series([1.0], index=pd.to_datetime(["2025-06-01"]))
        self.splits = pd.Series(dtype=float)
        self.earnings_dates = pd.DataFrame()
        self.major_holders = pd.DataFrame()
        self.institutional_holders = pd.DataFrame()
        self.info = {"shortName": "Test", "currency": "USD", "regularMarketPrice": 150.0}

    def history(self, period=None, interval=None, auto_adjust=None):
        return self._history_df

    def get_shares_full(self, start=None):
        return pd.Series([50.0], index=pd.to_datetime(["2025-01-01"]))


class EmptyTicker(FakeTicker):
    def __init__(self, ticker):
        super().__init__(ticker)
        self.income_stmt = pd.DataFrame()
        self.balance_sheet = pd.DataFrame()
        self.cashflow = pd.DataFrame()
        self.history = pd.DataFrame()
        self.info = {}


def test_fetch_ticker_returns_structured_data(monkeypatch):
    monkeypatch.setattr("adapter.yf.Ticker", FakeTicker)
    data = fetch_ticker("TEST")
    assert data["ticker"] == "TEST"
    assert data["info"]["shortName"] == "Test"
    assert data["incomeStatement"]["lineItems"]["Total Revenue"]["2025-03-31"] == 1000.0
    assert data["priceHistory"][0]["close"] == 100.0
    assert data["dividends"][0]["amount"] == 1.0


def test_fetch_ticker_raises_for_empty_ticker(monkeypatch):
    monkeypatch.setattr("adapter.yf.Ticker", EmptyTicker)
    with pytest.raises(TickerNotFoundError):
        fetch_ticker("NOPE")


class NanTicker(FakeTicker):
    def __init__(self, ticker):
        super().__init__(ticker)
        self.income_stmt = make_statement({"Total Revenue": [float("nan"), 900.0]})


def test_fetch_ticker_converts_nan_to_null(monkeypatch):
    monkeypatch.setattr("adapter.yf.Ticker", NanTicker)
    data = fetch_ticker("TEST")
    assert data["incomeStatement"]["lineItems"]["Total Revenue"]["2025-03-31"] is None
