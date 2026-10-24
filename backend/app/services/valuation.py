from __future__ import annotations

from typing import Any


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") else None


def dcf(
    fcf_list: list[float],
    wacc: float,
    terminal_growth: float | None = None,
    exit_multiple: float | None = None,
    final_ebitda: float | None = None,
    net_debt: float = 0.0,
    shares: float = 1.0,
    net_cash_adjust: bool = False,
) -> dict[str, Any]:
    """Discounted cash flow valuation.

    ``net_debt`` is signed: debt minus cash. A negative value is net cash and is
    added to equity value. ``net_cash_adjust`` is retained for backwards
    compatibility and does not change the result.
    """
    rate = _finite(wacc)
    if rate is None or rate <= -1:
        return {"error": "WACC must be greater than -100%"}
    flows = [_finite(flow) for flow in (fcf_list or [])]
    if not flows or any(flow is None for flow in flows):
        return {"error": "no valid cash flows"}

    count = len(flows)
    pv_cash_flows = sum(flow / ((1 + rate) ** index) for index, flow in enumerate(flows, start=1))

    terminal_value: float | None = None
    warnings: list[str] = []
    if terminal_growth is not None:
        growth = _finite(terminal_growth)
        if growth is None:
            warnings.append("Terminal growth is invalid; terminal value omitted.")
        elif rate <= growth:
            warnings.append("WACC must exceed terminal growth; terminal value omitted.")
        else:
            terminal_value = flows[-1] * (1 + growth) / (rate - growth)
    elif exit_multiple is not None and final_ebitda is not None:
        multiple = _finite(exit_multiple)
        ebitda = _finite(final_ebitda)
        if multiple is not None and ebitda is not None:
            terminal_value = multiple * ebitda
        else:
            warnings.append("Exit multiple inputs are invalid; terminal value omitted.")
    elif exit_multiple is None and final_ebitda is None:
        warnings.append("No terminal value method supplied; enterprise value excludes terminal value.")
    else:
        warnings.append("Exit multiple inputs are invalid; terminal value omitted.")

    pv_terminal_value = terminal_value / ((1 + rate) ** count) if terminal_value is not None else 0.0
    enterprise_value = pv_cash_flows + pv_terminal_value
    debt = _finite(net_debt) or 0.0
    equity_value = enterprise_value - debt
    share_count = _finite(shares) or 0.0
    value_per_share = equity_value / share_count if share_count > 0 else None

    return {
        "pv_cash_flows": pv_cash_flows,
        "terminal_value": terminal_value,
        "pv_terminal_value": pv_terminal_value,
        "enterprise_value": enterprise_value,
        "net_debt": debt,
        "equity_value": equity_value,
        "value_per_share": value_per_share,
        "wacc": rate,
        "terminal_growth": terminal_growth,
        "exit_multiple": exit_multiple,
        "cash_flow_count": count,
        "warnings": warnings,
    }


def wacc(
    risk_free: float,
    beta: float,
    market_premium: float,
    cost_of_debt: float,
    tax_rate: float,
    equity_weight: float,
    debt_weight: float,
) -> float:
    ke = risk_free + beta * market_premium
    kd_after_tax = cost_of_debt * (1 - tax_rate)
    return equity_weight * ke + debt_weight * kd_after_tax


def sensitivity_table(
    fcf_list: list[float],
    shares: float,
    net_debt: float,
    final_ebitda: float,
    wacc_values: list[float],
    terminal_values: list[float],
    mode: str = "growth",
) -> list[list[float | None]]:
    """2D sensitivity table: rows are WACC, columns are growth or exit multiple."""
    table: list[list[float | None]] = []
    for rate in wacc_values:
        row: list[float | None] = []
        for terminal in terminal_values:
            if mode == "growth":
                result = dcf(fcf_list, rate, terminal_growth=terminal, net_debt=net_debt, shares=shares)
            else:
                result = dcf(
                    fcf_list,
                    rate,
                    exit_multiple=terminal,
                    final_ebitda=final_ebitda,
                    net_debt=net_debt,
                    shares=shares,
                )
            row.append(result.get("value_per_share"))
        table.append(row)
    return table


def reverse_dcf(
    fcf_list: list[float],
    current_price: float,
    shares: float,
    net_debt: float = 0.0,
    terminal_growth: float = 0.025,
    lower: float = 0.001,
    upper: float = 2.0,
) -> dict[str, Any]:
    """Solve for the WACC implied by the current share price.

    The DCF value is monotonically decreasing in WACC for positive cash flows,
    so a bracketed bisection is sufficient and deterministic.
    """
    price = _finite(current_price)
    if price is None or price <= 0:
        return {"error": "current price must be positive"}
    if not fcf_list:
        return {"error": "no cash flows"}
    growth = _finite(terminal_growth)
    if growth is None:
        return {"error": "terminal growth must be finite"}
    if growth >= upper:
        return {"error": "terminal growth must be below the WACC search ceiling"}
    lower = max(lower, growth + 1e-4)
    if lower >= upper:
        return {"error": "no valid WACC search range above terminal growth"}

    def value_at(rate: float) -> float | None:
        result = dcf(fcf_list, rate, terminal_growth=terminal_growth, net_debt=net_debt, shares=shares)
        value = result.get("value_per_share")
        return value if isinstance(value, (int, float)) else None

    low_value = value_at(lower)
    high_value = value_at(upper)
    if low_value is None or high_value is None:
        return {"error": "DCF could not be evaluated over the search range"}
    if low_value < price:
        return {"error": "current price is above the DCF value at the lowest WACC in range", "value_at_lower": low_value}
    if high_value > price:
        return {"error": "current price is below the DCF value at the highest WACC in range", "value_at_upper": high_value}

    low, high = lower, upper
    for _ in range(200):
        middle = (low + high) / 2
        middle_value = value_at(middle)
        if middle_value is None:
            return {"error": "DCF failed during solve"}
        if middle_value > price:
            low = middle
        else:
            high = middle

    implied = (low + high) / 2
    return {
        "implied_wacc": implied,
        "current_price": price,
        "terminal_growth": terminal_growth,
        "enterprise_value_at_implied_wacc": dcf(
            fcf_list,
            implied,
            terminal_growth=terminal_growth,
            net_debt=net_debt,
            shares=shares,
        ).get("enterprise_value"),
    }
