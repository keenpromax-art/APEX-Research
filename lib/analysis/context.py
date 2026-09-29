from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lib.analysis.calculator import DerivedMetrics, _StatementReader
from lib.analysis.model import DataQuality, FinancialData, Statement

_PRICE_SERIES_POINTS = 520
_KEY_FIELDS = [
    ("income_statement", "revenue"),
    ("income_statement", "net_income"),
    ("income_statement", "diluted_eps"),
    ("balance_sheet", "total_debt"),
    ("balance_sheet", "stockholders_equity"),
    ("cash_flow", "operating_cash_flow"),
]


def build_context(
    financials: list[FinancialData],
    derived: list[DerivedMetrics],
    user_request: str,
) -> dict[str, Any]:
    companies = [
        _company_context(data, metrics)
        for data, metrics in zip(financials, derived)
    ]
    return {
        "userRequest": user_request,
        "companies": companies,
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "tickers": [data.ticker for data in financials],
            "dataSource": "yfinance",
        },
    }


def _company_context(data: FinancialData, metrics: DerivedMetrics) -> dict[str, Any]:
    return {
        "ticker": data.ticker,
        "retrievalTimestamp": data.retrieval_timestamp,
        "company": data.company,
        "market": data.market,
        "price": data.price,
        "financials": {
            "income_statement": _statement_context(data.income_statement),
            "balance_sheet": _statement_context(data.balance_sheet),
            "cash_flow": _statement_context(data.cash_flow),
            "quarterly": {
                "income_statement": _statement_context(data.income_statement_quarterly),
                "balance_sheet": _statement_context(data.balance_sheet_quarterly),
                "cash_flow": _statement_context(data.cash_flow_quarterly),
            },
        },
        "historical": _historical_context(data),
        "derivedMetrics": metrics.as_context(),
        "series": _series_context(data, metrics),
        "valuation": data.valuation,
        "ownership": data.ownership,
        "dividends": data.dividends,
        "splits": data.splits,
        "earnings": data.earnings,
        "analystData": data.analyst_data,
        "dataQuality": _data_quality(data),
    }


def _statement_context(statement: Statement | None) -> dict[str, Any] | None:
    if statement is None:
        return None
    return {
        "frequency": statement.frequency,
        "periods": statement.periods_desc(),
        "lineItems": statement.line_items,
        "provenance": _provenance_context(statement.provenance),
    }


def _provenance_context(prov: Any) -> dict[str, Any]:
    return {
        "ticker": prov.ticker,
        "source": prov.source,
        "retrievedAt": prov.retrieved_at,
        "period": prov.period,
        "currency": prov.currency,
        "frequency": prov.frequency,
        "originalField": prov.original_field,
        "normalizedField": prov.normalized_field,
    }


def _historical_context(data: FinancialData) -> dict[str, Any]:
    prices = data.historical_prices
    if not prices:
        return {"observations": 0, "dateRange": None, "price": []}
    sample = prices[-_PRICE_SERIES_POINTS:]
    return {
        "observations": len(prices),
        "dateRange": [prices[0]["date"], prices[-1]["date"]],
        "price": [{"date": row["date"], "close": row["close"]} for row in sample],
    }


def _series_context(data: FinancialData, metrics: DerivedMetrics) -> dict[str, list[dict[str, Any]]]:
    series: dict[str, list[dict[str, Any]]] = {}
    prices = data.historical_prices
    if prices:
        sample = prices[-_PRICE_SERIES_POINTS:]
        series["price"] = [
            {"label": row["date"], "value": row["close"]}
            for row in sample
            if row.get("close") is not None
        ]
    for key, metric in metrics.metrics.items():
        if not metric.by_period:
            continue
        points = [
            {"label": period[:4] if len(period) >= 4 else period, "value": value}
            for period, value in sorted(metric.by_period.items(), reverse=True)
            if value is not None
        ]
        if points:
            series[key] = points
    return series


def _data_quality(data: FinancialData) -> dict[str, Any]:
    quality = DataQuality(
        ticker=data.ticker,
        currency=(data.market or {}).get("currency"),
        data_freshness=data.retrieval_timestamp,
        dividends_available=data.dividends is not None,
        splits_available=data.splits is not None,
        analyst_data_available=data.analyst_data is not None,
    )

    statements: dict[str, dict[str, Any]] = {}
    for name, statement in [
        ("income_statement", data.income_statement),
        ("balance_sheet", data.balance_sheet),
        ("cash_flow", data.cash_flow),
    ]:
        if statement is None:
            quality.missing_statements.append(name)
            quality.notes.append(f"{name.replace('_', ' ').title()} unavailable.")
        else:
            statements[name] = {
                "frequency": statement.frequency,
                "periods": statement.periods_desc(),
                "lineItemCount": len(statement.line_items),
            }
            if len(statement.periods) < 3:
                quality.notes.append(
                    f"Only {len(statement.periods)} annual periods available in {name.replace('_', ' ')}."
                )
    quality.statements = statements

    for statement_name, canonical in _KEY_FIELDS:
        statement = getattr(data, statement_name)
        if statement is None:
            continue
        reader = _StatementReader(statement)
        if not reader.has(canonical):
            quality.missing_fields.append(f"{statement_name}.{canonical}")

    if not data.historical_prices:
        quality.notes.append("Price history unavailable.")
    else:
        quality.historical_observations = len(data.historical_prices)
        quality.historical_date_range = (
            f"{data.historical_prices[0]['date']} to {data.historical_prices[-1]['date']}"
        )

    if data.analyst_data is None:
        quality.notes.append("Analyst data not provided by yfinance for this ticker.")
    if data.dividends is None:
        quality.notes.append("Dividend data unavailable.")

    return {
        "ticker": quality.ticker,
        "currency": quality.currency,
        "statements": quality.statements,
        "missingStatements": quality.missing_statements,
        "missingFields": quality.missing_fields,
        "historicalObservations": quality.historical_observations,
        "historicalDateRange": quality.historical_date_range,
        "dataFreshness": quality.data_freshness,
        "dividendsAvailable": quality.dividends_available,
        "splitsAvailable": quality.splits_available,
        "analystDataAvailable": quality.analyst_data_available,
        "notes": quality.notes,
    }
