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
    compatibility and does not change the result. All present values are
    calculated at full precision; rounding is a presentation-layer concern.
    """
    rate = _finite(wacc)
    warnings: list[str] = []
    if rate is None or rate <= -1:
        return {"error": "WACC must be greater than -100%"}
    if rate < 0:
        warnings.append("WACC is negative; results are not economically meaningful for a normal going concern.")

    flows = [_finite(flow) for flow in (fcf_list or [])]
    if not flows or any(flow is None for flow in flows):
        return {"error": "no valid cash flows"}

    count = len(flows)
    discount_factors = [1.0 / ((1.0 + rate) ** index) for index in range(1, count + 1)]
    pv_cash_flows_by_year = [flow * factor for flow, factor in zip(flows, discount_factors)]
    pv_cash_flows = sum(pv_cash_flows_by_year)

    terminal_value: float | None = None
    if terminal_growth is not None:
        growth = _finite(terminal_growth)
        if growth is None:
            warnings.append("Terminal growth is invalid; terminal value omitted.")
        elif rate <= growth:
            warnings.append("WACC must exceed terminal growth; terminal value omitted.")
        else:
            terminal_value = flows[-1] * (1 + growth) / (rate - growth)
            if growth > 0.05:
                warnings.append("Terminal growth exceeds the common long-run nominal GDP band; review the assumption.")
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

    terminal_discount_factor = 1.0 / ((1.0 + rate) ** count) if count else 1.0
    pv_terminal_value = terminal_value * terminal_discount_factor if terminal_value is not None else 0.0
    enterprise_value = pv_cash_flows + pv_terminal_value
    debt = _finite(net_debt)
    if debt is None:
        debt = 0.0
        if net_debt is not None:
            warnings.append("Net debt was invalid; the equity bridge uses zero and must be reviewed.")
    equity_value = enterprise_value - debt
    share_count = _finite(shares)
    if share_count is None or share_count <= 0:
        warnings.append("Share count is unavailable or non-positive; no value per share is published.")
        value_per_share = None
    else:
        value_per_share = equity_value / share_count

    terminal_value_share = (
        pv_terminal_value / enterprise_value
        if enterprise_value not in (0.0, None) and _finite(enterprise_value) is not None
        else None
    )

    return {
        "pv_cash_flows": pv_cash_flows,
        "pv_cash_flows_by_year": pv_cash_flows_by_year,
        "discount_factors": discount_factors,
        "terminal_value": terminal_value,
        "terminal_discount_factor": terminal_discount_factor,
        "pv_terminal_value": pv_terminal_value,
        "terminal_value_share_of_ev": terminal_value_share,
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
    """CAPM-weighted WACC. Use ``wacc_details`` for validation and diagnostics."""
    ke = risk_free + beta * market_premium
    kd_after_tax = cost_of_debt * (1 - tax_rate)
    return equity_weight * ke + debt_weight * kd_after_tax


def wacc_details(
    risk_free: float,
    beta: float,
    market_premium: float,
    cost_of_debt: float,
    tax_rate: float,
    equity_weight: float,
    debt_weight: float,
) -> dict[str, Any]:
    """Validate and expose a WACC build-up rather than returning only a scalar."""
    inputs = {
        "risk_free": _finite(risk_free),
        "beta": _finite(beta),
        "market_premium": _finite(market_premium),
        "cost_of_debt": _finite(cost_of_debt),
        "tax_rate": _finite(tax_rate),
        "equity_weight": _finite(equity_weight),
        "debt_weight": _finite(debt_weight),
    }
    warnings: list[str] = []
    for key in inputs:
        if inputs[key] is None:
            warnings.append(f"WACC input '{key}' is invalid; the blend cannot be published.")
    if any(inputs[key] is None for key in inputs):
        return {"inputs": inputs, "warnings": warnings, "error": "invalid WACC inputs"}

    total_weight = inputs["equity_weight"] + inputs["debt_weight"]
    if total_weight <= 0:
        warnings.append("Capital weights sum to zero or a negative value; WACC is invalid.")
    elif abs(total_weight - 1.0) > 0.001:
        warnings.append(
            f"Capital weights sum to {total_weight:.3f}, not 1.000; APEX uses the supplied weights as given "
            "and does not silently renormalize."
        )
    if not 0 <= inputs["tax_rate"] <= 1:
        warnings.append("Tax rate is outside 0–100%.")

    cost_of_equity = inputs["risk_free"] + inputs["beta"] * inputs["market_premium"]
    after_tax_cost_of_debt = inputs["cost_of_debt"] * (1 - inputs["tax_rate"])
    blend = inputs["equity_weight"] * cost_of_equity + inputs["debt_weight"] * after_tax_cost_of_debt
    if _finite(blend) is None:
        return {"inputs": inputs, "warnings": warnings, "error": "WACC calculation failed"}
    return {
        "inputs": inputs,
        "cost_of_equity": cost_of_equity,
        "after_tax_cost_of_debt": after_tax_cost_of_debt,
        "weight_total": total_weight,
        "value": blend,
        "warnings": warnings,
    }


def sensitivity_table(
    fcf_list: list[float],
    shares: float,
    net_debt: float,
    final_ebitda: float,
    wacc_values: list[float],
    terminal_values: list[float],
    mode: str = "growth",
) -> list[list[float | None]]:
    """2D sensitivity table: rows are WACC, columns are growth or exit multiple.

    Cells with an invalid WACC/growth relationship are ``None``, not zero.
    """
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
    *,
    grid_points: int = 257,
) -> dict[str, Any]:
    """Solve for the WACC implied by the observed share price.

    With positive cash flows and WACC above terminal growth, value is monotonic.
    Rather than assuming that, APEX brackets the root on a deterministic rate
    grid, then uses bisection and reports convergence and the reproduced value.
    Negative or non-monotonic cash-flow cases are disclosed rather than hidden.
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
    lower = max(_finite(lower) or 0.001, growth + 1e-4)
    upper = _finite(upper) or 2.0
    if lower >= upper:
        return {"error": "no valid WACC search range above terminal growth"}

    warnings: list[str] = []
    finite_flows = [_finite(flow) for flow in fcf_list]
    if any(flow is None for flow in finite_flows):
        return {"error": "cash flows contain invalid values"}
    if any(flow <= 0 for flow in finite_flows):
        warnings.append(
            "Cash flows include zero or negative values; the value-to-rate function may not be monotonic. "
            "The reported root is the first deterministic sign change."
        )

    def value_at(rate: float) -> float | None:
        result = dcf(finite_flows, rate, terminal_growth=terminal_growth, net_debt=net_debt, shares=shares)
        value = result.get("value_per_share")
        return value if isinstance(value, (int, float)) else None

    grid_n = max(17, min(int(grid_points), 1025))
    grid = [lower + (upper - lower) * i / (grid_n - 1) for i in range(grid_n)]
    values = [value_at(rate) for rate in grid]
    if any(value is None for value in values):
        return {"error": "DCF could not be evaluated over the search range"}

    def objective(rate: float) -> float | None:
        value = value_at(rate)
        return None if value is None else value - price

    bracket: tuple[float, float] | None = None
    solutions = 0
    for index in range(grid_n - 1):
        left_value = values[index] - price
        right_value = values[index + 1] - price
        if abs(left_value) <= 1e-12:
            solutions += 1
            if bracket is None:
                bracket = (grid[index], grid[index])
            break
        if left_value > 0 > right_value:
            solutions += 1
            if bracket is None:
                bracket = (grid[index], grid[index + 1])
                break

    if bracket is None:
        low_value = values[0]
        high_value = values[-1]
        if low_value < price:
            return {
                "error": "current price is above the DCF value at the lowest WACC in range",
                "value_at_lower": low_value,
            }
        if high_value > price:
            return {
                "error": "current price is below the DCF value at the highest WACC in range",
                "value_at_upper": high_value,
            }
        return {"error": "no discount-rate root found in the search range"}

    low, high = bracket
    if low == high:
        implied = low
    else:
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

    reproduced = value_at(implied)
    if reproduced is None:
        return {"error": "implied-WACC solution could not be verified"}
    tolerance = max(1e-6, abs(price) * 1e-8)
    residual = reproduced - price
    converged = abs(residual) <= tolerance
    result: dict[str, Any] = {
        "implied_wacc": implied,
        "current_price": price,
        "terminal_growth": terminal_growth,
        "enterprise_value_at_implied_wacc": dcf(
            finite_flows,
            implied,
            terminal_growth=terminal_growth,
            net_debt=net_debt,
            shares=shares,
        ).get("enterprise_value"),
        "value_at_implied_wacc": reproduced,
        "price_residual": residual,
        "price_tolerance": tolerance,
        "converged": converged,
        "root_solutions_in_range": solutions,
    }
    if solutions > 1:
        warnings.append("Multiple implied-WACC solutions were found; the lowest is reported.")
    if not converged:
        warnings.append("Bisection did not reproduce the observed price within tolerance.")
    result["warnings"] = warnings
    return result


def reverse_dcf_growth(
    fcf_list: list[float],
    current_price: float,
    shares: float,
    net_debt: float = 0.0,
    wacc: float = 0.10,
    lower: float = -0.05,
    upper: float = 0.08,
) -> dict[str, Any]:
    """Solve for terminal growth implied by the observed share price.

    Value is increasing in terminal growth while WACC exceeds growth. The same
    deterministic grid-bracket plus bisection discipline is used as in the
    implied-WACC solver.
    """
    price = _finite(current_price)
    rate = _finite(wacc)
    if price is None or price <= 0:
        return {"error": "current price must be positive"}
    if rate is None:
        return {"error": "WACC must be finite"}
    low = max(_finite(lower) or -0.05, -0.99)
    high = _finite(upper) or 0.08
    if high >= rate:
        high = rate - 1e-5
    if low >= high:
        return {"error": "no valid terminal-growth search range below WACC"}
    finite_flows = [_finite(flow) for flow in fcf_list]
    if not finite_flows or any(flow is None for flow in finite_flows):
        return {"error": "no valid cash flows"}

    def value_at(growth: float) -> float | None:
        result = dcf(finite_flows, rate, terminal_growth=growth, net_debt=net_debt, shares=shares)
        value = result.get("value_per_share")
        return value if isinstance(value, (int, float)) else None

    grid_n = 257
    grid = [low + (high - low) * i / (grid_n - 1) for i in range(grid_n)]
    values = [value_at(growth) for growth in grid]
    if any(value is None for value in values):
        return {"error": "DCF could not be evaluated over the growth range"}

    bracket: tuple[float, float] | None = None
    solutions = 0
    for index in range(grid_n - 1):
        left_value = values[index] - price
        right_value = values[index + 1] - price
        if abs(left_value) <= 1e-12:
            solutions += 1
            if bracket is None:
                bracket = (grid[index], grid[index])
            break
        if left_value < 0 < right_value:
            solutions += 1
            if bracket is None:
                bracket = (grid[index], grid[index + 1])
                break
    if bracket is None:
        if values[-1] < price:
            return {"error": "current price is above the value at the highest terminal growth in range", "value_at_upper": values[-1]}
        return {"error": "current price is below the value at the lowest terminal growth in range", "value_at_lower": values[0]}

    low, high = bracket
    if low == high:
        implied = low
    else:
        for _ in range(200):
            middle = (low + high) / 2
            middle_value = value_at(middle)
            if middle_value is None:
                return {"error": "DCF failed during growth solve"}
            if middle_value < price:
                low = middle
            else:
                high = middle
        implied = (low + high) / 2

    reproduced = value_at(implied)
    tolerance = max(1e-6, abs(price) * 1e-8)
    residual = (reproduced or 0.0) - price
    return {
        "implied_terminal_growth": implied,
        "wacc": rate,
        "current_price": price,
        "value_at_implied_growth": reproduced,
        "price_residual": residual,
        "price_tolerance": tolerance,
        "converged": abs(residual) <= tolerance,
        "root_solutions_in_range": solutions,
        "warnings": (["Multiple implied-growth solutions were found; the lowest is reported."] if solutions > 1 else []),
    }
