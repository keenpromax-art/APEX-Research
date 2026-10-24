from __future__ import annotations

"""Synthetic DEMO company fixture.

Only used when the user explicitly opens ticker "DEMO". Every view must label
this as demo data. Never used as a fallback for real tickers.
"""

import math
from datetime import date, timedelta

INFO = {
    "longName": "Demo Industrial Corp (synthetic)",
    "shortName": "DEMO CORP",
    "exchange": "DEMO",
    "currency": "USD",
    "sector": "Industrials",
    "industry": "Synthetic Machinery",
    "country": "US",
    "website": "https://example.com",
    "sharesOutstanding": 120_000_000,
    "marketCap": 5_000_000_000,
    "longBusinessSummary": "Synthetic demo company for evaluating APEX Terminal without live market data. All numbers are fabricated for demonstration only.",
    "fullTimeEmployees": 18_500,
}

# Four years of history, most recent first (like yfinance ordering)
IS = [
    {"period_end": "2025-12-31", "items": {"revenue": 5200, "cost_of_revenue": 2912, "gross_profit": 2288, "operating_expense": 832, "operating_income": 1040, "ebit": 1040, "ebitda": 1352, "pretax_income": 936, "tax_expense": 234, "net_income": 702, "interest_expense": 104, "diluted_eps": 5.85, "da": 312}},
    {"period_end": "2024-12-31", "items": {"revenue": 4800, "cost_of_revenue": 2736, "gross_profit": 2064, "operating_expense": 768, "operating_income": 912, "ebit": 912, "ebitda": 1186, "pretax_income": 816, "tax_expense": 204, "net_income": 612, "interest_expense": 96, "diluted_eps": 5.10, "da": 274}},
    {"period_end": "2023-12-31", "items": {"revenue": 4250, "cost_of_revenue": 2465, "gross_profit": 1785, "operating_expense": 680, "operating_income": 765, "ebit": 765, "ebitda": 994, "pretax_income": 680, "tax_expense": 170, "net_income": 510, "interest_expense": 85, "diluted_eps": 4.25, "da": 229}},
    {"period_end": "2022-12-31", "items": {"revenue": 3800, "cost_of_revenue": 2242, "gross_profit": 1558, "operating_expense": 608, "operating_income": 684, "ebit": 684, "ebitda": 890, "pretax_income": 610, "tax_expense": 152, "net_income": 458, "interest_expense": 74, "diluted_eps": 3.82, "da": 206}},
]

BS = [
    {"period_end": "2025-12-31", "items": {"total_assets": 6400, "current_assets": 2400, "current_liabilities": 1200, "cash": 800, "total_debt": 2000, "equity": 3200, "accounts_receivable": 720, "inventory": 640, "accounts_payable": 520, "ppe_net": 3200, "goodwill": 900, "shares_issued": 120_000_000}},
    {"period_end": "2024-12-31", "items": {"total_assets": 5900, "current_assets": 2200, "current_liabilities": 1100, "cash": 700, "total_debt": 1900, "equity": 3000, "accounts_receivable": 660, "inventory": 600, "accounts_payable": 480, "ppe_net": 3050, "goodwill": 900}},
    {"period_end": "2023-12-31", "items": {"total_assets": 5300, "current_assets": 1980, "current_liabilities": 1020, "cash": 650, "total_debt": 1750, "equity": 2750, "accounts_receivable": 580, "inventory": 530, "accounts_payable": 430, "ppe_net": 2900, "goodwill": 900}},
    {"period_end": "2022-12-31", "items": {"total_assets": 4900, "current_assets": 1840, "current_liabilities": 940, "cash": 600, "total_debt": 1650, "equity": 2500, "accounts_receivable": 520, "inventory": 460, "accounts_payable": 390, "ppe_net": 2750, "goodwill": 900}},
]

CF = [
    {"period_end": "2025-12-31", "items": {"operating_cash_flow": 1100, "capex": -420, "free_cash_flow": 680, "da_cf": 312, "change_in_wc": -80}},
    {"period_end": "2024-12-31", "items": {"operating_cash_flow": 990, "capex": -390, "free_cash_flow": 600, "da_cf": 274, "change_in_wc": -60}},
    {"period_end": "2023-12-31", "items": {"operating_cash_flow": 860, "capex": -350, "free_cash_flow": 510, "da_cf": 229, "change_in_wc": -55}},
    {"period_end": "2022-12-31", "items": {"operating_cash_flow": 760, "capex": -310, "free_cash_flow": 450, "da_cf": 206, "change_in_wc": -50}},
]

# Quarterly income statement for FY2025; line items sum to the FY2025 annual
# totals above so the quarterly follow-through reconciles to the annual base.
Q_IS = [
    {"period_end": "2025-03-31", "items": {"revenue": 1180, "cost_of_revenue": 661, "gross_profit": 519, "operating_expense": 189, "operating_income": 240, "ebit": 240, "ebitda": 321, "pretax_income": 216, "tax_expense": 54, "net_income": 162, "interest_expense": 24, "diluted_eps": 1.35, "da": 76}},
    {"period_end": "2025-06-30", "items": {"revenue": 1260, "cost_of_revenue": 706, "gross_profit": 554, "operating_expense": 202, "operating_income": 260, "ebit": 260, "ebitda": 339, "pretax_income": 234, "tax_expense": 58, "net_income": 176, "interest_expense": 26, "diluted_eps": 1.47, "da": 76}},
    {"period_end": "2025-09-30", "items": {"revenue": 1340, "cost_of_revenue": 750, "gross_profit": 590, "operating_expense": 214, "operating_income": 275, "ebit": 275, "ebitda": 352, "pretax_income": 250, "tax_expense": 63, "net_income": 187, "interest_expense": 26, "diluted_eps": 1.56, "da": 73}},
    {"period_end": "2025-12-31", "items": {"revenue": 1420, "cost_of_revenue": 795, "gross_profit": 625, "operating_expense": 227, "operating_income": 265, "ebit": 265, "ebitda": 340, "pretax_income": 236, "tax_expense": 59, "net_income": 177, "interest_expense": 28, "diluted_eps": 1.47, "da": 87}},
]

DIVIDENDS = [
    {"date": "2023-06-15", "value": 0.80},
    {"date": "2023-12-15", "value": 0.85},
    {"date": "2024-06-14", "value": 0.85},
    {"date": "2024-12-13", "value": 0.90},
    {"date": "2025-06-13", "value": 0.90},
    {"date": "2025-12-12", "value": 0.95},
    {"date": "2026-06-12", "value": 0.95},
]

_PRICE_END = date(2026, 10, 23)
PRICE = []
for _index in range(120):
    _day = _PRICE_END - timedelta(days=119 - _index)
    _close = 38 + 0.02 * _index + 2.2 * math.sin(_index / 9)
    PRICE.append(
        {
            "date": _day.isoformat(),
            "open": round(_close - 0.35, 2),
            "high": round(_close + 0.6, 2),
            "low": round(_close - 0.7, 2),
            "close": round(_close, 2),
            "volume": 1_500_000 + (_index % 11) * 85_000,
        }
    )


def demo_normalized(ticker: str = "DEMO") -> dict:
    import copy

    per_share = {"diluted_eps", "basic_eps", "shares_issued"}

    def scale(periods):
        out = []
        for p in periods:
            items = {}
            for k, v in p["items"].items():
                items[k] = v if (k in per_share or not isinstance(v, (int, float))) else v * 1_000_000
            out.append({"period_end": p["period_end"], "items": items})
        return out

    return {
        "ticker": ticker,
        "retrieved_at": "demo-fixture",
        "info": INFO,
        "annual": {
            "income_statement": scale(IS),
            "balance_sheet": scale(BS),
            "cash_flow": scale(CF),
        },
        "quarterly": {
            "income_statement": scale(Q_IS),
            "balance_sheet": [],
            "cash_flow": [],
        },
        "price_history": PRICE,
        "price_summary": {
            "last_close": PRICE[-1]["close"],
            "last_date": PRICE[-1]["date"],
            "previous_close": PRICE[-2]["close"],
            "change": PRICE[-1]["close"] - PRICE[-2]["close"],
            "change_pct": (PRICE[-1]["close"] - PRICE[-2]["close"]) / PRICE[-2]["close"],
            "high_52w": max(point["close"] for point in PRICE),
            "low_52w": min(point["close"] for point in PRICE),
            "avg_volume_3m": sum(point["volume"] for point in PRICE[-63:]) / min(63, len(PRICE)),
        },
        "dividends": DIVIDENDS,
        "splits": [],
        "data_quality": {"alerts": [{"level": "info", "message": "DEMO fixture: synthetic data for evaluation only"}], "retrieved_at": "demo-fixture"},
        "demo": True,
    }
