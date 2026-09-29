import math

from lib.analysis.calculator import calculate
from tests.conftest import make_raw_data
from lib.analysis.normalizer import normalize


def test_revenue_growth(normalized, derived):
    assert derived.metrics["revenue_growth"].value == 1000.0 / 900.0 - 1.0


def test_margins(normalized, derived):
    assert math.isclose(derived.metrics["gross_margin"].value, 0.4, rel_tol=1e-9)
    assert math.isclose(derived.metrics["operating_margin"].value, 0.2, rel_tol=1e-9)
    assert math.isclose(derived.metrics["net_margin"].value, 0.15, rel_tol=1e-9)
    assert math.isclose(derived.metrics["ebitda_margin"].value, 0.25, rel_tol=1e-9)


def test_roe_roa(normalized, derived):
    assert math.isclose(derived.metrics["roe"].value, 0.15, rel_tol=1e-9)
    assert math.isclose(derived.metrics["roa"].value, 0.075, rel_tol=1e-9)


def test_leverage_and_liquidity(normalized, derived):
    assert math.isclose(derived.metrics["debt_to_equity"].value, 0.5, rel_tol=1e-9)
    assert derived.metrics["net_debt"].value == 300.0
    assert math.isclose(derived.metrics["current_ratio"].value, 2.0, rel_tol=1e-9)
    assert math.isclose(derived.metrics["quick_ratio"].value, 1.75, rel_tol=1e-9)


def test_free_cash_flow(normalized, derived):
    assert derived.metrics["free_cash_flow"].value == 200.0
    assert math.isclose(derived.metrics["fcf_margin"].value, 0.2, rel_tol=1e-9)
    assert math.isclose(derived.metrics["cash_conversion"].value, 200.0 / 150.0, rel_tol=1e-9)


def test_valuation_multiples(normalized, derived):
    assert math.isclose(derived.metrics["pe_current"].value, 50.0, rel_tol=1e-9)
    assert math.isclose(derived.metrics["pb_current"].value, 150.0 / (1000.0 / 50.0), rel_tol=1e-9)
    assert math.isclose(derived.metrics["ps_current"].value, 7500.0 / 1000.0, rel_tol=1e-9)
    assert derived.metrics["ev_current"].value == 7500.0 + 500.0 - 200.0


def test_price_metrics(normalized, derived):
    assert derived.metrics["price_return_1y"].value is not None
    assert derived.metrics["price_return_1y"].value > 0
    assert derived.metrics["volatility_1y"].value is not None
    assert derived.metrics["volatility_1y"].value > 0
    assert derived.metrics["max_drawdown_5y"].value is not None
    assert derived.metrics["max_drawdown_5y"].value <= 0


def test_missing_inputs_return_none_never_fabricated():
    raw = make_raw_data(with_income=False, with_balance=False, with_cashflow=False, with_history=False)
    data = normalize(raw)
    derived = calculate(data)
    for key in ["revenue_growth", "roe", "free_cash_flow", "price_return_1y", "gross_margin"]:
        metric = derived.metrics.get(key)
        assert metric is None or metric.value is None, f"{key} must be absent or null"


def test_cagr_insufficient_periods(normalized, derived):
    assert derived.metrics["revenue_cagr_3y"].value is None
    assert derived.metrics["revenue_cagr_5y"].value is None


def test_provenance_inputs_present(normalized, derived):
    roe = derived.metrics["roe"]
    assert roe.inputs == [
        "financials.income_stmt[Net Income][2025-03-31]",
        "financials.balance_sheet[Stockholders Equity][2025-03-31]",
    ]
    assert roe.formula == "net_income / stockholders_equity"
