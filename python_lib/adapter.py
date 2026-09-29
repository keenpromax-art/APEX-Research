"""The ONLY module allowed to call yfinance.

Runs as a Vercel Python serverless function. Returns raw ticker data as
JSON-serializable dicts; all normalization happens in TypeScript.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

import yfinance as yf


def _safe(fn):
    try:
        result = fn()
    except Exception:
        return None
    if result is None:
        return None
    try:
        if result.empty:
            return None
    except AttributeError:
        pass
    if isinstance(result, dict) and not result:
        return None
    return result


def _float_or_none(value: Any) -> float | None:
    try:
        if value is None:
            return None
        value = float(value)
        return None if math.isnan(value) else value
    except (TypeError, ValueError):
        return None


def _statement_to_dict(df: Any) -> dict[str, Any] | None:
    if df is None:
        return None
    periods = [str(col.date()) for col in df.columns]
    line_items: dict[str, dict[str, float | None]] = {}
    for item in df.index:
        values: dict[str, float | None] = {}
        for col, period in zip(df.columns, periods):
            values[period] = _float_or_none(df.loc[item, col])
        line_items[str(item)] = values
    return {"periods": periods, "lineItems": line_items}


def _price_history_to_list(df: Any) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []
    renamed = df.rename(columns={c: str(c).lower() for c in df.columns})
    out: list[dict[str, Any]] = []
    for ts, row in renamed.iterrows():
        out.append(
            {
                "date": str(ts.date()),
                "close": _float_or_none(row.get("close")),
                "volume": _float_or_none(row.get("volume")),
            }
        )
    return out


def _events_to_list(series: Any) -> list[dict[str, Any]] | None:
    if series is None or series.empty:
        return None
    return [
        {"date": str(ts.date()), "amount": _float_or_none(val)}
        for ts, val in series.tail(40).items()
    ]


def _earnings_to_list(df: Any) -> list[dict[str, Any]] | None:
    if df is None or df.empty:
        return None
    rows: list[dict[str, Any]] = []
    for ts, row in df.iterrows():
        rows.append(
            {
                "date": str(ts.date()) if hasattr(ts, "date") else str(ts),
                "epsEstimate": _float_or_none(row.get("EPS Estimate")),
                "epsActual": _float_or_none(row.get("Reported EPS")),
                "surprisePercent": _float_or_none(row.get("Surprise(%)")),
            }
        )
    return rows


def _holders_to_list(df: Any) -> list[dict[str, Any]] | None:
    if df is None or df.empty:
        return None
    records = df.head(5).to_dict("records")
    clean: list[dict[str, Any]] = []
    for record in records:
        clean.append({str(k): _float_or_none(v) for k, v in record.items()})
    return clean


def _has_valid_identity(info: Any, ticker: str) -> bool:
    """yfinance returns a non-empty stub like {'trailingPegRatio': None} for
    unknown symbols, so a truthy dict is not proof the ticker exists."""
    if not isinstance(info, dict) or not info:
        return False
    for key in (
        "symbol",
        "shortName",
        "longName",
        "quoteType",
        "marketCap",
        "regularMarketPrice",
    ):
        value = info.get(key)
        if value in (None, ""):
            continue
        if key == "symbol" and str(value).upper() != ticker.upper():
            continue
        return True
    return False


def fetch_ticker(ticker: str) -> dict[str, Any]:
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

    has_any = _has_valid_identity(info, ticker) or any(
        item is not None for item in [income, balance, cashflow]
    ) or (history is not None and len(history) > 0)
    if not has_any:
        raise TickerNotFoundError(ticker)

    shares_list = None
    if shares is not None:
        shares_list = [
            {"date": str(ts.date()), "shares": _float_or_none(val)}
            for ts, val in shares.items()
        ]

    return {
        "ticker": ticker,
        "retrievedAt": retrieved_at,
        "info": info,
        "incomeStatement": _statement_to_dict(income),
        "quarterlyIncomeStatement": _statement_to_dict(q_income),
        "balanceSheet": _statement_to_dict(balance),
        "quarterlyBalanceSheet": _statement_to_dict(q_balance),
        "cashFlow": _statement_to_dict(cashflow),
        "quarterlyCashFlow": _statement_to_dict(q_cashflow),
        "priceHistory": _price_history_to_list(history),
        "dividends": _events_to_list(dividends),
        "splits": _events_to_list(splits),
        "sharesOutstanding": shares_list,
        "earningsDates": _earnings_to_list(earnings_dates),
        "majorHolders": _holders_to_list(major_holders),
        "institutionalHolders": _holders_to_list(institutional_holders),
    }


class TickerNotFoundError(Exception):
    pass
