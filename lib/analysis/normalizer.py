from __future__ import annotations

from typing import Any

import pandas as pd

from lib.analysis.model import FinancialData, Provenance, Statement
from lib.data.adapter import RawTickerData

_INFO_COMPANY_FIELDS = {
    "shortName": "name",
    "longName": "long_name",
    "sector": "sector",
    "industry": "industry",
    "longBusinessSummary": "summary",
    "website": "website",
    "fullTimeEmployees": "employees",
    "country": "country",
    "exchange": "exchange",
    "quoteType": "quote_type",
}

_INFO_MARKET_FIELDS = {
    "currency": "currency",
    "financialCurrency": "financial_currency",
    "marketCap": "market_cap",
    "sharesOutstanding": "shares_outstanding",
    "fiftyTwoWeekHigh": "fifty_two_week_high",
    "fiftyTwoWeekLow": "fifty_two_week_low",
    "fiftyDayAverage": "fifty_day_average",
    "twoHundredDayAverage": "two_hundred_day_average",
    "beta": "beta",
    "averageVolume": "average_volume",
    "lastSplitFactor": "last_split_factor",
    "lastSplitDate": "last_split_date",
}

_INFO_PRICE_FIELDS = {
    "regularMarketPrice": "price",
    "regularMarketChange": "change",
    "regularMarketChangePercent": "change_percent",
    "regularMarketPreviousClose": "previous_close",
    "regularMarketOpen": "open",
    "regularMarketDayHigh": "day_high",
    "regularMarketDayLow": "day_low",
    "regularMarketVolume": "volume",
    "regularMarketTime": "quote_timestamp",
    "marketState": "market_state",
}

_INFO_VALUATION_FIELDS = {
    "trailingPE": "trailing_pe",
    "forwardPE": "forward_pe",
    "pegRatio": "peg_ratio",
    "priceToBook": "price_to_book",
    "priceToSalesTrailing12Months": "price_to_sales",
    "enterpriseValue": "enterprise_value",
    "enterpriseToRevenue": "ev_to_revenue",
    "enterpriseToEbitda": "ev_to_ebitda",
    "dividendYield": "dividend_yield",
    "dividendRate": "dividend_rate",
    "payoutRatio": "payout_ratio",
    "trailingEps": "trailing_eps",
    "forwardEps": "forward_eps",
    "bookValue": "book_value",
    "profitMargins": "profit_margin",
    "grossMargins": "gross_margin",
    "operatingMargins": "operating_margin",
    "ebitdaMargins": "ebitda_margin",
    "returnOnEquity": "return_on_equity",
    "returnOnAssets": "return_on_assets",
    "returnOnCapital": "return_on_capital",
    "currentRatio": "current_ratio",
    "quickRatio": "quick_ratio",
    "totalDebt": "total_debt",
    "totalCash": "total_cash",
    "totalRevenue": "total_revenue",
    "revenueGrowth": "revenue_growth",
    "earningsGrowth": "earnings_growth",
    "earningsQuarterlyGrowth": "earnings_quarterly_growth",
    "debtToEquity": "debt_to_equity",
    "freeCashflow": "free_cashflow",
    "operatingCashflow": "operating_cashflow",
    "revenuePerShare": "revenue_per_share",
    "targetHighPrice": "target_high",
    "targetLowPrice": "target_low",
    "targetMeanPrice": "target_mean",
    "targetMedianPrice": "target_median",
    "recommendationKey": "recommendation_key",
    "recommendationMean": "recommendation_mean",
    "numberOfAnalystOpinions": "number_of_analyst_opinions",
}

_DIVIDEND_EVENTS = 40


def normalize(raw: RawTickerData) -> FinancialData:
    info = raw.info or {}
    currency = info.get("currency") or info.get("financialCurrency")
    ticker = raw.ticker

    return FinancialData(
        ticker=ticker,
        retrieval_timestamp=raw.retrieved_at,
        company=_company(info),
        market=_pick(info, _INFO_MARKET_FIELDS),
        price=_pick(info, _INFO_PRICE_FIELDS),
        historical_prices=_price_history(raw.price_history),
        income_statement=_statement(raw.income_statement, "annual", ticker, raw.retrieved_at, currency, "income_stmt"),
        balance_sheet=_statement(raw.balance_sheet, "annual", ticker, raw.retrieved_at, currency, "balance_sheet"),
        cash_flow=_statement(raw.cash_flow, "annual", ticker, raw.retrieved_at, currency, "cashflow"),
        income_statement_quarterly=_statement(raw.quarterly_income_statement, "quarterly", ticker, raw.retrieved_at, currency, "quarterly_income_stmt"),
        balance_sheet_quarterly=_statement(raw.quarterly_balance_sheet, "quarterly", ticker, raw.retrieved_at, currency, "quarterly_balance_sheet"),
        cash_flow_quarterly=_statement(raw.quarterly_cash_flow, "quarterly", ticker, raw.retrieved_at, currency, "quarterly_cashflow"),
        valuation=_valuation(info),
        ownership=_ownership(raw),
        dividends=_events(raw.dividends),
        splits=_events(raw.splits),
        earnings=_earnings(raw.earnings_dates),
        analyst_data=_analyst(info),
        metadata=_metadata(raw, info),
    )


def _pick(info: dict[str, Any], field_map: dict[str, str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for source_key, normalized_key in field_map.items():
        if source_key in info and info[source_key] is not None:
            out[normalized_key] = info[source_key]
    return out or None


def _company(info: dict[str, Any]) -> dict[str, Any] | None:
    return _pick(info, _INFO_COMPANY_FIELDS)


def _valuation(info: dict[str, Any]) -> dict[str, Any] | None:
    return _pick(info, _INFO_VALUATION_FIELDS)


def _analyst(info: dict[str, Any]) -> dict[str, Any] | None:
    analyst_keys = [
        "recommendationKey",
        "recommendationMean",
        "numberOfAnalystOpinions",
        "targetHighPrice",
        "targetMeanPrice",
        "targetLowPrice",
        "targetMedianPrice",
    ]
    out: dict[str, Any] = {}
    for key in analyst_keys:
        if key in info and info[key] is not None:
            out[_INFO_VALUATION_FIELDS.get(key, key)] = info[key]
    return out or None


def _statement(
    df: pd.DataFrame | None,
    frequency: str,
    ticker: str,
    retrieved_at: str,
    currency: str | None,
    yf_name: str,
) -> Statement | None:
    if df is None:
        return None
    periods = [pd.Timestamp(col).date().isoformat() for col in df.columns]
    line_items: dict[str, dict[str, float | None]] = {}
    for item in df.index:
        name = str(item)
        values: dict[str, float | None] = {}
        for col, period in zip(df.columns, periods):
            value = df.loc[item, col]
            values[period] = None if pd.isna(value) else float(value)
        line_items[name] = values
    provenance = Provenance(
        ticker=ticker,
        source="yfinance",
        retrieved_at=retrieved_at,
        currency=currency,
        frequency=frequency,
        original_field=f"yfinance.Ticker({ticker}).{yf_name}",
        normalized_field=f"financials.{yf_name}",
    )
    return Statement(frequency=frequency, periods=periods, line_items=line_items, provenance=provenance)


def _price_history(df: pd.DataFrame | None) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []
    renamed = df.rename(columns={c: str(c).lower() for c in df.columns})
    out: list[dict[str, Any]] = []
    for ts, row in renamed.iterrows():
        close = row.get("close")
        volume = row.get("volume")
        out.append(
            {
                "date": ts.date().isoformat(),
                "close": None if pd.isna(close) else float(close),
                "volume": None if pd.isna(volume) else int(volume),
            }
        )
    return out


def _events(series: pd.Series | None) -> list[dict[str, Any]] | None:
    if series is None or series.empty:
        return None
    out: list[dict[str, Any]] = []
    for ts, value in series.tail(_DIVIDEND_EVENTS).items():
        out.append({"date": ts.date().isoformat(), "amount": float(value)})
    return out


def _earnings(df: pd.DataFrame | None) -> dict[str, Any] | None:
    if df is None or df.empty:
        return None
    rows: list[dict[str, Any]] = []
    for ts, row in df.iterrows():
        rows.append(
            {
                "date": pd.Timestamp(ts).date().isoformat(),
                "eps_estimate": _float_or_none(row.get("EPS Estimate")),
                "eps_actual": _float_or_none(row.get("Reported EPS")),
                "surprise_percent": _float_or_none(row.get("Surprise(%)")),
            }
        )
    return {"recent": rows}


def _ownership(raw: RawTickerData) -> dict[str, Any] | None:
    major = None
    if raw.major_holders is not None and not raw.major_holders.empty:
        major = raw.major_holders.head(5).astype(object).where(pd.notna(raw.major_holders.head(5)), None).to_dict("records")
    institutions = None
    if raw.institutional_holders is not None and not raw.institutional_holders.empty:
        institutions = raw.institutional_holders.head(5).astype(object).where(pd.notna(raw.institutional_holders.head(5)), None).to_dict("records")
    if major is None and institutions is None:
        return None
    return {"major_holders": major, "institutional_holders": institutions}


def _metadata(raw: RawTickerData, info: dict[str, Any]) -> dict[str, Any]:
    meta: dict[str, Any] = {"info": info}
    if raw.shares_outstanding is not None:
        meta["shares_outstanding_series"] = {
            str(ts.date()): int(val) for ts, val in raw.shares_outstanding.items()
        }
    return meta


def _float_or_none(value: Any) -> float | None:
    try:
        if value is None or pd.isna(value):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None
