from __future__ import annotations

import math

import pytest

from app.services.valuation import dcf, reverse_dcf, sensitivity_table, wacc as calc_wacc
from app.services.advanced import lbo, black_scholes, bond_price


def test_dcf_single_year_perpetuity_growth():
    res = dcf([100.0], wacc=0.10, terminal_growth=0.0, net_debt=0.0, shares=10.0)
    # PV cf = 100/1.1 = 90.909; TV = 100/0.10 = 1000; PV TV = 909.09; EV=1000; eq=1000; per share=100
    assert res["pv_cash_flows"] == pytest.approx(90.909, rel=1e-3)
    assert res["terminal_value"] == pytest.approx(1000.0)
    assert res["enterprise_value"] == pytest.approx(1000.0, rel=1e-3)
    assert res["value_per_share"] == pytest.approx(100.0, rel=1e-3)


def test_dcf_net_debt_bridge():
    res = dcf([50.0, 50.0], wacc=0.10, terminal_growth=0.0, net_debt=100.0, shares=10.0)
    # EV = 50/1.1 + 50/1.21 + (50/0.1)/1.21 = 45.4545+41.3223+413.2231=500
    assert res["enterprise_value"] == pytest.approx(500.0, rel=1e-2)
    assert res["equity_value"] == pytest.approx(400.0, rel=1e-2)
    assert res["value_per_share"] == pytest.approx(40.0, rel=1e-2)


def test_dcf_exit_multiple():
    res = dcf([10.0], wacc=0.10, exit_multiple=8.0, final_ebitda=20.0, net_debt=0.0, shares=1.0)
    assert res["terminal_value"] == pytest.approx(160.0)
    assert res["pv_terminal_value"] == pytest.approx(160.0 / 1.1)


def test_sensitivity_table_shape():
    table = sensitivity_table([100.0], 10.0, 0.0, 10.0, [0.09, 0.10, 0.11], [0.0, 0.01, 0.02], mode="growth")
    assert len(table) == 3
    assert len(table[0]) == 3
    assert all(v is not None for row in table for v in row)


def test_wacc_formula():
    # ke = 0.04 + 1.2*0.06 = 0.112 ; kd after tax = 0.08*0.75=0.06
    w = calc_wacc(0.04, 1.2, 0.06, 0.08, 0.25, 0.6, 0.4)
    assert w == pytest.approx(0.6 * 0.112 + 0.4 * 0.06)


def test_black_scholes_atm_call_known_value():
    # S=K=100, T=1, r=0, sigma=0.2 -> call approx 7.9656
    res = black_scholes(100, 100, 1, 0.0, 0.2)
    assert res["price"] == pytest.approx(7.9656, abs=1e-3)
    assert res["delta"] == pytest.approx(0.5398, abs=1e-3)
    assert res["gamma"] == pytest.approx(0.0199, abs=1e-3)


def test_black_scholes_put_call_parity():
    call = black_scholes(100, 95, 1, 0.05, 0.25, option_type="call")["price"]
    put = black_scholes(100, 95, 1, 0.05, 0.25, option_type="put")["price"]
    assert call - put == pytest.approx(100 - 95 * math.exp(-0.05), abs=1e-6)


def test_bond_price_par():
    res = bond_price(1000, 0.05, 0.05, 10, 2)
    assert res["price"] == pytest.approx(1000.0, abs=1e-6)


def test_bond_price_discount():
    res = bond_price(1000, 0.05, 0.06, 10, 2)
    assert res["price"] < 1000
    assert res["duration"] > 0


def test_dcf_net_cash_adds_to_equity_value():
    res = dcf([100.0], wacc=0.10, terminal_growth=0.0, net_debt=-100.0, shares=10.0)
    assert res["equity_value"] == pytest.approx(1100.0, rel=1e-3)
    assert res["value_per_share"] == pytest.approx(110.0, rel=1e-3)


def test_dcf_warns_when_wacc_below_terminal_growth():
    res = dcf([100.0], wacc=0.02, terminal_growth=0.03)
    assert res["terminal_value"] is None
    assert res["pv_terminal_value"] == 0.0
    assert any("exceed" in warning for warning in res["warnings"])


def test_dcf_rejects_empty_or_invalid_flows():
    assert "error" in dcf([], 0.10)
    assert "error" in dcf([None], 0.10)


def test_dcf_warns_when_no_terminal_value_method_is_supplied():
    res = dcf([100.0], wacc=0.10)
    assert res["terminal_value"] is None
    assert any("No terminal value" in warning for warning in res["warnings"])


def test_reverse_dcf_recovers_supplied_wacc():
    flows = [100.0, 110.0, 121.0]
    base = dcf(flows, 0.10, terminal_growth=0.025, net_debt=50.0, shares=10.0)
    res = reverse_dcf(flows, base["value_per_share"], 10.0, net_debt=50.0, terminal_growth=0.025)
    assert res["implied_wacc"] == pytest.approx(0.10, abs=1e-6)
    assert res["enterprise_value_at_implied_wacc"] == pytest.approx(base["enterprise_value"], rel=1e-6)


def test_reverse_dcf_handles_unreachable_price():
    res = reverse_dcf([100.0], 1e9, 1.0, terminal_growth=0.025)
    assert "error" in res


def test_black_scholes_theta_rho_and_vega_signs():
    call = black_scholes(100, 100, 1, 0.05, 0.2, option_type="call")
    put = black_scholes(100, 100, 1, 0.05, 0.2, option_type="put")
    assert call["theta"] < 0
    assert call["rho"] > 0
    assert call["vega"] > 0
    assert call["gamma"] > 0
    assert put["rho"] < 0


def test_black_scholes_zero_vol_is_forward_value():
    res = black_scholes(100, 90, 1, 0.05, 0.0)
    assert res["price"] == pytest.approx(100 - 90 * math.exp(-0.05))
    assert "warning" in res


def test_lbo_schedule_ties_to_exit_bridge():
    res = lbo(100, 8, 9, 5, 0.05, 0.25, 0.25, 0.07, 0.5)
    assert res["purchase_price"] == pytest.approx(800)
    assert len(res["schedule"]) == 5
    balance = res["debt"]
    for row in res["schedule"]:
        assert row["debt_balance"] == pytest.approx(balance - row["debt_paydown"])
        balance = row["debt_balance"]
    assert res["debt_balance_exit"] == pytest.approx(balance)
    assert res["net_exit_proceeds"] == pytest.approx(res["exit_value"] - res["exit_fees"] - balance)
    assert res["moic"] == pytest.approx(res["net_exit_proceeds"] / res["equity"])
    assert res["irr"] == pytest.approx(res["moic"] ** (1 / 5) - 1)


def test_lbo_sponsor_equity_pct_controls_leverage():
    res = lbo(100, 8, 9, 5, 0.05, 0.25, 0.25, 0.07, 0.5, sponsor_equity_pct=0.5)
    assert res["debt_pct"] == pytest.approx(0.5)
    assert res["debt"] == pytest.approx(res["total_sources"] * 0.5)
    assert res["equity"] == pytest.approx(res["total_sources"] * 0.5)


def test_bond_par_and_risk_measures():
    res = bond_price(1000, 0.05, 0.05, 10, 2)
    assert res["price"] == pytest.approx(1000.0, abs=1e-6)
    assert res["current_yield"] == pytest.approx(0.05)
    assert res["modified_duration"] < res["macaulay_duration"]
    assert res["convexity"] > 0


def test_bond_modified_duration_approximates_price_change():
    base = bond_price(1000, 0.05, 0.06, 10, 2)
    bumped = bond_price(1000, 0.05, 0.0601, 10, 2)
    estimated = -base["modified_duration"] * 0.0001 * base["price"]
    assert (bumped["price"] - base["price"]) == pytest.approx(estimated, rel=0.02)


def test_bond_rejects_invalid_yield_range():
    assert "error" in bond_price(1000, 0.05, -2.0, 10, 2)
    assert "error" in bond_price(1000, 0.05, 0.05, 0, 2)
