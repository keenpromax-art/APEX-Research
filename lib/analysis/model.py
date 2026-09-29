from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Provenance:
    """Traceability for every dataset. Nothing loses its source identity."""

    ticker: str
    source: str
    retrieved_at: str
    period: str | None = None
    currency: str | None = None
    frequency: str | None = None
    original_field: str | None = None
    normalized_field: str | None = None


@dataclass
class Statement:
    """A financial statement: line items mapped to period values.

    line_items: {original yfinance line item name: {period: value or None}}
    Values are None when yfinance does not provide them. Never fabricated.
    """

    frequency: str
    periods: list[str]
    line_items: dict[str, dict[str, float | None]]
    provenance: Provenance

    def periods_desc(self) -> list[str]:
        return sorted(self.periods, reverse=True)

    def annual_periods(self) -> list[str]:
        if self.frequency != "annual":
            return []
        return self.periods_desc()


@dataclass
class FinancialData:
    """The single normalized internal data model.

    Internal only — NOT a report structure. Extensible via metadata:
    any field yfinance exposes beyond the normalized set is preserved
    there so new data can flow through without redesigning the app.
    """

    ticker: str
    retrieval_timestamp: str
    company: dict[str, Any] | None = None
    market: dict[str, Any] | None = None
    price: dict[str, Any] | None = None
    historical_prices: list[dict[str, Any]] = field(default_factory=list)
    income_statement: Statement | None = None
    balance_sheet: Statement | None = None
    cash_flow: Statement | None = None
    income_statement_quarterly: Statement | None = None
    balance_sheet_quarterly: Statement | None = None
    cash_flow_quarterly: Statement | None = None
    valuation: dict[str, Any] | None = None
    ownership: dict[str, Any] | None = None
    dividends: list[dict[str, Any]] | None = None
    splits: list[dict[str, Any]] | None = None
    earnings: dict[str, Any] | None = None
    analyst_data: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


@dataclass
class DataQuality:
    """Completeness snapshot so the AI knows when its dataset is incomplete."""

    ticker: str
    currency: str | None = None
    statements: dict[str, dict[str, Any]] = field(default_factory=dict)
    missing_statements: list[str] = field(default_factory=list)
    missing_fields: list[str] = field(default_factory=list)
    historical_observations: int = 0
    historical_date_range: str | None = None
    data_freshness: str | None = None
    dividends_available: bool = False
    splits_available: bool = False
    analyst_data_available: bool = False
    notes: list[str] = field(default_factory=list)
