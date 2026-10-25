from __future__ import annotations

import pytest

from app.services.metrics import compute_metrics
from app.services.calc_engine import last_historical, build_three_statement


def _norm():
    return {
        "ticker": "TEST",
        "retrieved_at": "2026-01-01T00:00:00Z",
        "info": {"sharesOutstanding": 1000},
        "annual": {
            "income_statement": [
                {"period_end": "2025-03-31", "items": {"revenue": 1000, "gross_profit": 400, "operating_income": 200, "ebit": 200, "ebitda": 250, "net_income": 120, "tax_expense": 30, "pretax_income": 150, "interest_expense": 20, "cost_of_revenue": 600, "operating_expense": 200, "diluted_eps": 0.12, "da": 50}},
                {"period_end": "2024-03-31", "items": {"revenue": 800, "gross_profit": 320, "operating_income": 160, "ebit": 160, "ebitda": 200, "net_income": 96, "tax_expense": 24, "pretax_income": 120, "interest_expense": 16, "cost_of_revenue": 480, "operating_expense": 160, "diluted_eps": 0.096, "da": 40}},
            ],
            "balance_sheet": [
                {"period_end": "2025-03-31", "items": {"total_assets": 2000, "current_assets": 800, "current_liabilities": 400, "cash": 100, "total_debt": 500, "equity": 900, "accounts_receivable": 150, "inventory": 100, "accounts_payable": 80, "ppe_net": 800}},
                {"period_end": "2024-03-31", "items": {"total_assets": 1700, "current_assets": 700, "current_liabilities": 350, "cash": 90, "total_debt": 450, "equity": 800, "accounts_receivable": 120, "inventory": 90, "accounts_payable": 70, "ppe_net": 700}},
            ],
            "cash_flow": [
                {"period_end": "2025-03-31", "items": {"operating_cash_flow": 180, "capex": -60, "free_cash_flow": 120}},
                {"period_end": "2024-03-31", "items": {"operating_cash_flow": 150, "capex": -50, "free_cash_flow": 100}},
            ],
        },
        "quarterly": {},
        "data_quality": {"alerts": []},
    }


def test_metrics_basic_ratios():
    m = compute_metrics(_norm())
    p = m["periods"][0]
    assert p["gross_margin"] == pytest.approx(0.4)
    assert p["operating_margin"] == pytest.approx(0.2)
    assert p["net_margin"] == pytest.approx(0.12)
    assert p["current_ratio"] == pytest.approx(2.0)
    assert p["roe"] == pytest.approx(120 / 900)
    assert p["roa"] == pytest.approx(120 / 2000)
    assert p["revenue_growth"] == pytest.approx((1000 - 800) / 800)
    assert p["net_debt"] == pytest.approx(400)
    assert p["fcf"] == pytest.approx(120)


def test_metrics_missing_data_is_none_not_zero():
    norm = _norm()
    norm["annual"]["income_statement"][0]["items"]["gross_profit"] = None
    norm["annual"]["income_statement"][0]["items"]["cost_of_revenue"] = None
    m = compute_metrics(norm)
    assert m["periods"][0]["gross_margin"] is None


def test_metrics_record_calculation_basis():
    norm = _norm()
    norm["annual"]["income_statement"][0]["items"].pop("ebitda", None)
    norm["annual"]["cash_flow"][0]["items"].pop("free_cash_flow", None)
    m = compute_metrics(norm)
    p = m["periods"][0]
    assert p["ebitda"] == pytest.approx(250)
    assert p["calculation_basis"]["ebitda"] == "calculated: EBIT + D&A"
    assert p["calculation_basis"]["fcf"] == "calculated: operating cash flow − |capex|"


def test_quick_ratio_requires_inventory_not_zero_fill():
    norm = _norm()
    norm["annual"]["balance_sheet"][0]["items"]["inventory"] = None
    m = compute_metrics(norm)
    assert m["periods"][0]["quick_ratio"] is None


def test_base_year_records_documented_defaults_and_operating_nwc():
    norm = _norm()
    norm["annual"]["income_statement"][0]["items"].pop("gross_profit", None)
    norm["annual"]["income_statement"][0]["items"].pop("cost_of_revenue", None)
    norm["annual"]["balance_sheet"][0]["items"].pop("short_term_debt", None)
    base = last_historical(norm, compute_metrics(norm))
    assert base["gross_margin"] == 0.4
    assert base["assumption_provenance"]["gross_margin"] == "engine default: 40% gross margin"
    # Operating NWC excludes cash from current assets; short-term debt is not available here.
    assert base["nwc"] == pytest.approx(300.0)
    assert any(gap["area"] == "nwc" for gap in base["model_input_gaps"])


def test_last_historical_requires_revenue_instead_of_zero_filling():
    norm = _norm()
    norm["annual"]["income_statement"][0]["items"]["revenue"] = None
    assert last_historical(norm, compute_metrics(norm)) == {}


def test_three_statement_projects_and_links():
    norm = _norm()
    m = compute_metrics(norm)
    base = last_historical(norm, m)
    res = build_three_statement(base, {"revenue_growth": 0.10, "gross_margin": 0.4, "opex_ratio": 0.2, "tax_rate": 0.2, "da_pct": 0.05, "capex_pct": 0.06, "nwc_pct": 0.1, "interest_rate": 0.05, "dividend_payout": 0.3}, 3)
    ps = res["periods"]
    assert len(ps) == 3
    assert ps[0]["revenue"] == pytest.approx(1100)
    assert ps[1]["revenue"] == pytest.approx(1210)
    assert ps[2]["revenue"] == pytest.approx(1331)
    for p in ps:
        assert p["net_income"] == pytest.approx(p["ebt"] - p["tax"])
        assert p["gross_profit"] == pytest.approx(p["revenue"] - p["cogs"])
        assert p["equity"] == pytest.approx(base["equity"] + sum(x["net_income"] - x["dividends"] for x in ps[: p["year"]]))
    # cash roll-forward: cash_t = cash_{t-1} + fcf - dividends
    prev_cash = base["cash"]
    for p in ps:
        assert p["cash"] == pytest.approx(prev_cash + p["fcf"] - p["dividends"])
        prev_cash = p["cash"]


def test_shares_fallback_from_info():
    norm = _norm()
    norm["annual"]["balance_sheet"][0]["items"].pop("shares_issued", None)
    m = compute_metrics(norm)
    base = last_historical(norm, m)
    assert base["shares"] == 1000


def test_metrics_align_companion_statements_by_period_end():
    norm = _norm()
    norm["annual"]["balance_sheet"].reverse()
    norm["annual"]["cash_flow"].reverse()
    m = compute_metrics(norm)
    latest = m["periods"][0]
    assert latest["period_end"] == "2025-03-31"
    assert latest["cash"] == pytest.approx(100)
    assert latest["roe"] == pytest.approx(120 / 900)
    assert latest["fcf"] == pytest.approx(120)


def test_last_historical_matches_periods_when_ordered_differently():
    norm = _norm()
    norm["annual"]["balance_sheet"].reverse()
    norm["annual"]["cash_flow"].reverse()
    base = last_historical(norm, compute_metrics(norm))
    assert base["cash"] == pytest.approx(100)
    assert base["debt"] == pytest.approx(500)
    assert base["base_period"] == "2025-03-31"


def test_three_statement_accepts_per_year_assumptions():
    norm = _norm()
    base = last_historical(norm, compute_metrics(norm))
    res = build_three_statement(
        base,
        {"revenue_growth": [0.10, 0.20], "gross_margin": 0.4, "opex_ratio": 0.2, "tax_rate": 0.2},
        2,
    )
    assert res["periods"][0]["revenue"] == pytest.approx(1100)
    assert res["periods"][1]["revenue"] == pytest.approx(1320)
    assert res["summary"]["revenue_cagr"] == pytest.approx((1320 / 1000) ** 0.5 - 1)


def test_three_statement_share_dilution_reduces_eps():
    norm = _norm()
    base = last_historical(norm, compute_metrics(norm))
    res = build_three_statement(
        base,
        {"revenue_growth": 0.10, "gross_margin": 0.4, "opex_ratio": 0.2, "tax_rate": 0.2, "share_dilution": 0.10},
        3,
    )
    assert res["periods"][-1]["shares"] == pytest.approx(base["shares"] * 1.1**3)
    for period in res["periods"]:
        assert period["eps"] == pytest.approx(period["net_income"] / period["shares"])


def test_three_statement_revolver_covers_minimum_cash():
    norm = _norm()
    base = last_historical(norm, compute_metrics(norm))
    res = build_three_statement(
        base,
        {"revenue_growth": 0.10, "gross_margin": 0.4, "opex_ratio": 0.2, "tax_rate": 0.2, "minimum_cash": 5000.0},
        3,
    )
    assert res["periods"][0]["revolver_draw"] > 0
    for period in res["periods"]:
        assert period["cash"] >= 5000.0 - 1e-6
    assert res["summary"]["balance_ok"] is True


def test_three_statement_excess_cash_sweeps_debt():
    norm = _norm()
    base = last_historical(norm, compute_metrics(norm))
    res = build_three_statement(
        base,
        {
            "revenue_growth": 0.10,
            "gross_margin": 0.4,
            "opex_ratio": 0.2,
            "tax_rate": 0.2,
            "dividend_payout": 0.0,
            "minimum_cash": 0.0,
            "excess_cash_sweep": 1.0,
        },
        2,
    )
    first = res["periods"][0]
    assert first["debt_repayment"] > 0
    assert first["cash"] == pytest.approx(0.0, abs=1e-6)
    assert first["debt"] < base["debt"]
    assert res["summary"]["balance_ok"] is True
