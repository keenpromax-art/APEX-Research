from __future__ import annotations

import concurrent.futures
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

import pandas as pd
import yfinance as yf

from lib.data.cache import TTLCache
from lib.exceptions import (
    TickerNotFoundError,
    YFinanceError,
    YFinanceTimeoutError,
)


@dataclass
class RawTickerData:
    ticker: str
    retrieved_at: str
    info: dict[str, Any] | None = None
    income_statement: pd.DataFrame | None = None
    quarterly_income_statement: pd.DataFrame | None = None
    balance_sheet: pd.DataFrame | None = None
    quarterly_balance_sheet: pd.DataFrame | None = None
    cash_flow: pd.DataFrame | None = None
    quarterly_cash_flow: pd.DataFrame | None = None
    price_history: pd.DataFrame | None = None
    dividends: pd.Series | None = None
    splits: pd.Series | None = None
    shares_outstanding: pd.Series | None = None
    earnings_dates: pd.DataFrame | None = None
    major_holders: pd.DataFrame | None = None
    institutional_holders: pd.DataFrame | None = None


def _safe(callable_: Callable[[], Any]) -> Any | None:
    try:
        result = callable_()
    except Exception:
        return None
    if result is None:
        return None
    if isinstance(result, pd.DataFrame) and result.empty:
        return None
    if isinstance(result, pd.Series) and result.empty:
        return None
    if isinstance(result, dict) and not result:
        return None
    return result


class YFinanceAdapter:
    """The ONLY module allowed to call yfinance."""

    def __init__(self, timeout: float = 30.0, cache: TTLCache | None = None):
        self._timeout = timeout
        self._cache = cache

    def fetch(self, ticker: str) -> RawTickerData:
        key = ticker.upper()
        if self._cache is not None:
            cached = self._cache.get(key)
            if cached is not None:
                return cached

        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(self._fetch_uncached, key)
                raw = future.result(timeout=self._timeout)
        except concurrent.futures.TimeoutError:
            raise YFinanceTimeoutError(key, self._timeout)
        except (TickerNotFoundError, YFinanceTimeoutError):
            raise
        except Exception as exc:
            raise YFinanceError(key, str(exc))

        if self._is_empty(raw):
            raise TickerNotFoundError(ticker)
        if self._cache is not None:
            self._cache.set(key, raw)
        return raw

    def _fetch_uncached(self, ticker: str) -> RawTickerData:
        tk = yf.Ticker(ticker)
        retrieved_at = datetime.now(timezone.utc).isoformat()

        info = _safe(lambda: tk.info)
        income = _safe(lambda: tk.income_stmt)
        q_income = _safe(lambda: tk.quarterly_income_stmt)
        balance = _safe(lambda: tk.balance_sheet)
        q_balance = _safe(lambda: tk.quarterly_balance_sheet)
        cashflow = _safe(lambda: tk.cashflow)
        q_cashflow = _safe(lambda: tk.quarterly_cashflow)
        history = _safe(lambda: tk.history(period="5y", interval="1d", auto_adjust=False))
        dividends = _safe(lambda: tk.dividends)
        splits = _safe(lambda: tk.splits)
        shares = _safe(lambda: tk.get_shares_full(start="2015-01-01"))
        earnings_dates = _safe(lambda: tk.earnings_dates)
        major_holders = _safe(lambda: tk.major_holders)
        institutional_holders = _safe(lambda: tk.institutional_holders)

        raw = RawTickerData(
            ticker=ticker,
            retrieved_at=retrieved_at,
            info=info,
            income_statement=income,
            quarterly_income_statement=q_income,
            balance_sheet=balance,
            quarterly_balance_sheet=q_balance,
            cash_flow=cashflow,
            quarterly_cash_flow=q_cashflow,
            price_history=history,
            dividends=dividends,
            splits=splits,
            shares_outstanding=shares,
            earnings_dates=earnings_dates,
            major_holders=major_holders,
            institutional_holders=institutional_holders,
        )
        return raw

    @staticmethod
    def _is_empty(raw: RawTickerData) -> bool:
        has_info = bool(raw.info)
        has_statements = any(
            [
                raw.income_statement is not None,
                raw.balance_sheet is not None,
                raw.cash_flow is not None,
            ]
        )
        has_history = raw.price_history is not None and not raw.price_history.empty
        return not (has_info or has_statements or has_history)
