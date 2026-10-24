from __future__ import annotations

from typing import Any

import pandas as pd

# Map yfinance row labels -> canonical keys
INCOME_MAP = {
    "Total Revenue": "revenue",
    "Revenue": "revenue",
    "Operating Revenue": "revenue",
    "Cost Of Revenue": "cost_of_revenue",
    "Gross Profit": "gross_profit",
    "Operating Income": "operating_income",
    "EBIT": "ebit",
    "EBITDA": "ebitda",
    "Net Income": "net_income",
    "Net Income Common Stockholders": "net_income",
    "Diluted EPS": "diluted_eps",
    "Basic EPS": "basic_eps",
    "Tax Provision": "tax_expense",
    "Interest Expense": "interest_expense",
    "Pretax Income": "pretax_income",
    "Operating Expense": "operating_expense",
    "Research Development": "rd_expense",
    "Selling General And Administrative": "sga_expense",
    "Depreciation And Amortization": "da",
    "Reconciled Depreciation": "da",
    "Net Income From Continuing Operation Net Minority Interest": "net_income",
    "Net Income Including Noncontrolling Interests": "net_income",
}

BALANCE_MAP = {
    "Total Assets": "total_assets",
    "Current Assets": "current_assets",
    "Cash And Cash Equivalents": "cash",
    "Cash Cash Equivalents And Short Term Investments": "cash",
    "Accounts Receivable": "accounts_receivable",
    "Inventory": "inventory",
    "Total Liabilities Net Minority Interest": "total_liabilities",
    "Current Liabilities": "current_liabilities",
    "Accounts Payable": "accounts_payable",
    "Total Debt": "total_debt",
    "Long Term Debt": "long_term_debt",
    "Short Term Debt": "short_term_debt",
    "Stockholders Equity": "equity",
    "Total Equity Gross Minority Interest": "equity",
    "Retained Earnings": "retained_earnings",
    "Property Plant And Equipment Net": "ppe_net",
    "Goodwill": "goodwill",
    "Intangible Assets": "intangibles",
    "Shares Issued": "shares_issued",
    "Ordinary Shares Number": "shares_issued",
    "Net Debt": "net_debt",
    "Total Liabilities": "total_liabilities",
}

CASHFLOW_MAP = {
    "Operating Cash Flow": "operating_cash_flow",
    "Cash Flow From Continuing Operating Activities": "operating_cash_flow",
    "Capital Expenditure": "capex",
    "Free Cash Flow": "free_cash_flow",
    "Depreciation And Amortization": "da_cf",
    "Change In Working Capital": "change_in_wc",
    "Cash Flow From Continuing Investing Activities": "investing_cash_flow",
    "Cash Flow From Continuing Financing Activities": "financing_cash_flow",
    "Net PPE Purchase And Sale": "net_ppe",
    "Dividends Paid": "dividends_paid",
    "Repurchase Of Capital Stock": "buybacks",
    "Issuance Of Debt": "debt_issued",
    "Repayment Of Debt": "debt_repaid",
}


def _df_to_periods(df: pd.DataFrame | None, mapping: dict[str, str]) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []
    periods = []
    # columns are timestamps
    for col in df.columns:
        period_label = col.strftime("%Y-%m-%d") if hasattr(col, "strftime") else str(col)
        items: dict[str, Any] = {}
        for idx, row in df.iterrows():
            label = str(idx)
            key = mapping.get(label)
            if key is None:
                # fuzzy match
                for k, v in mapping.items():
                    if k.lower() in label.lower() or label.lower() in k.lower():
                        key = v
                        break
            if key is None:
                continue
            val = row[col] if col in row else row.get(col)
            if pd.isna(val):
                items[key] = None
            else:
                try:
                    items[key] = float(val)
                except (TypeError, ValueError):
                    items[key] = str(val)
        periods.append({"period_end": period_label, "items": items})
    return periods


def normalize_statements(raw) -> dict[str, Any]:
    price_history = _price_history(raw.price_history)
    return {
        "ticker": raw.ticker,
        "retrieved_at": raw.retrieved_at,
        "info": raw.info or {},
        "annual": {
            "income_statement": _df_to_periods(raw.income_statement, INCOME_MAP),
            "balance_sheet": _df_to_periods(raw.balance_sheet, BALANCE_MAP),
            "cash_flow": _df_to_periods(raw.cash_flow, CASHFLOW_MAP),
        },
        "quarterly": {
            "income_statement": _df_to_periods(raw.quarterly_income_statement, INCOME_MAP),
            "balance_sheet": _df_to_periods(raw.quarterly_balance_sheet, BALANCE_MAP),
            "cash_flow": _df_to_periods(raw.quarterly_cash_flow, CASHFLOW_MAP),
        },
        "price_history": price_history,
        "price_summary": _price_summary(price_history),
        "dividends": _series_to_list(raw.dividends),
        "splits": _series_to_list(raw.splits),
        "data_quality": raw.data_quality,
    }


def _price_history(df: pd.DataFrame | None) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []
    out = []
    for idx, row in df.iterrows():
        out.append({
            "date": idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx),
            "open": _f(row.get("Open")),
            "high": _f(row.get("High")),
            "low": _f(row.get("Low")),
            "close": _f(row.get("Close")),
            "volume": _f(row.get("Volume")),
        })
    out.sort(key=lambda point: point["date"])
    return out


def _price_summary(history: list[dict[str, Any]]) -> dict[str, Any] | None:
    closes = [point["close"] for point in history if point.get("close") is not None]
    if not closes:
        return None
    latest = closes[-1]
    previous = closes[-2] if len(closes) > 1 else None
    window = closes[-252:]
    volumes = [point.get("volume") for point in history[-63:] if point.get("volume")]
    return {
        "last_close": latest,
        "last_date": history[-1].get("date"),
        "previous_close": previous,
        "change": (latest - previous) if previous is not None else None,
        "change_pct": ((latest - previous) / previous) if previous else None,
        "high_52w": max(window),
        "low_52w": min(window),
        "avg_volume_3m": (sum(volumes) / len(volumes)) if volumes else None,
    }


def _series_to_list(s: pd.Series | None) -> list[dict[str, Any]]:
    if s is None:
        return []
    out = []
    for idx, val in s.items():
        out.append({"date": (idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)), "value": _f(val)})
    out.sort(key=lambda point: point["date"])
    return out


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
