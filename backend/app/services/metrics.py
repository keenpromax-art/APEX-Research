from __future__ import annotations

from typing import Any


def _get(period: dict | None, key: str) -> float | None:
    items = (period or {}).get("items", {}) or {}
    value = items.get(key)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_div(a: float | None, b: float | None) -> float | None:
    if a is None or b is None or b == 0:
        return None
    return a / b


def _period_end(period: dict | None) -> str:
    value = (period or {}).get("period_end")
    return value if isinstance(value, str) else ""


def _align(income_periods: list[dict], other_periods: list[dict]) -> list[dict]:
    """Align companion statements to the income statement by period end.

    yfinance usually returns the same columns, but coverage can differ (e.g. a
    cash-flow column missing for the oldest period). Positional pairing can
    silently combine different fiscal years, so it is used only when the
    companion statement has no period labels at all.
    """
    by_period = {_period_end(period): period for period in other_periods if _period_end(period)}
    aligned: list[dict] = []
    for index, period in enumerate(income_periods):
        match = by_period.get(_period_end(period))
        if match is None and not by_period and index < len(other_periods):
            match = other_periods[index]
        aligned.append(match or {})
    return aligned


def _previous_period(periods: list[dict], index: int) -> dict | None:
    current = _period_end(periods[index])
    if not current:
        return periods[index + 1] if index + 1 < len(periods) else None
    best: dict | None = None
    best_label: str | None = None
    for other_index, period in enumerate(periods):
        if other_index == index:
            continue
        label = _period_end(period)
        if not label or label >= current:
            continue
        if best_label is None or label > best_label:
            best = period
            best_label = label
    if best is None and index + 1 < len(periods):
        fallback = periods[index + 1]
        if _period_end(fallback) == "":
            return fallback
    return best


def compute_metrics(normalized: dict[str, Any]) -> dict[str, Any]:
    """Compute period-aligned ratios from normalized statements.

    Every derived value records its calculation basis in ``calculation_basis``.
    Missing inputs stay ``None``; no ratio is silently completed with zero.
    """
    annual = normalized.get("annual", {}) or {}
    income_periods = annual.get("income_statement", []) or []
    balance_periods = annual.get("balance_sheet", []) or []
    cashflow_periods = annual.get("cash_flow", []) or []

    balance_aligned = _align(income_periods, balance_periods)
    cashflow_aligned = _align(income_periods, cashflow_periods)

    metrics_by_period: list[dict[str, Any]] = []
    for index, income in enumerate(income_periods):
        balance = balance_aligned[index]
        cashflow = cashflow_aligned[index]
        basis: dict[str, str] = {}

        revenue = _get(income, "revenue")
        gross_profit = _get(income, "gross_profit")
        cogs = _get(income, "cost_of_revenue")
        operating_income = _get(income, "operating_income")
        ebit = _get(income, "ebit")
        da = _get(income, "da")
        ebitda = _get(income, "ebitda")
        if ebitda is None and ebit is not None and da is not None:
            ebitda = ebit + da
            basis["ebitda"] = "calculated: EBIT + D&A"
        elif ebitda is not None:
            basis["ebitda"] = "reported"
        if ebit is None and operating_income is not None:
            ebit = operating_income
            basis["ebit"] = "operating income used as EBIT"
        net_income = _get(income, "net_income")
        tax = _get(income, "tax_expense")
        interest = _get(income, "interest_expense")
        pretax = _get(income, "pretax_income")

        total_assets = _get(balance, "total_assets")
        current_assets = _get(balance, "current_assets")
        current_liabilities = _get(balance, "current_liabilities")
        cash = _get(balance, "cash")
        total_debt = _get(balance, "total_debt")
        equity = _get(balance, "equity")
        receivables = _get(balance, "accounts_receivable")
        inventory = _get(balance, "inventory")
        payables = _get(balance, "accounts_payable")
        shares = _get(balance, "shares_issued")

        operating_cash_flow = _get(cashflow, "operating_cash_flow")
        capex = _get(cashflow, "capex")
        free_cash_flow = _get(cashflow, "free_cash_flow")
        if free_cash_flow is None and operating_cash_flow is not None and capex is not None:
            free_cash_flow = operating_cash_flow - abs(capex)
            basis["fcf"] = "calculated: operating cash flow − |capex|"
        elif free_cash_flow is not None:
            basis["fcf"] = "reported"

        gross_margin = _safe_div(gross_profit, revenue)
        if gross_margin is None and revenue is not None and cogs is not None:
            gross_margin = _safe_div(revenue - cogs, revenue)
            if gross_margin is not None:
                basis["gross_margin"] = "calculated: (revenue − cost of revenue) ÷ revenue"
        elif gross_margin is not None:
            basis["gross_margin"] = "reported gross profit ÷ revenue"

        net_debt = total_debt - cash if total_debt is not None and cash is not None else None
        if net_debt is not None:
            basis["net_debt"] = "calculated: total debt − cash and equivalents"

        tax_rate = _safe_div(tax, pretax) if tax is not None and pretax not in (None, 0) else None
        roic_tax = tax_rate
        roic_tax_basis = "reported effective tax rate"
        if roic_tax is None:
            roic_tax = 0.25
            roic_tax_basis = "assumption: 25% when the effective rate is unavailable"
        if total_debt is not None and equity is not None and cash is not None:
            invested_capital = total_debt + equity - cash
            basis["invested_capital"] = "calculated: total debt + equity − cash"
        else:
            invested_capital = None
        nopat = ebit * (1 - roic_tax) if ebit is not None else None

        cogs_for_days = cogs
        if cogs_for_days is None and revenue is not None and gross_profit is not None:
            cogs_for_days = revenue - gross_profit

        quick_ratio = None
        if current_assets is not None and current_liabilities is not None and inventory is not None:
            quick_ratio = _safe_div(current_assets - inventory, current_liabilities)
            if quick_ratio is not None:
                basis["quick_ratio"] = "calculated: (current assets − inventory) ÷ current liabilities"

        metrics_by_period.append(
            {
                "period_end": income.get("period_end"),
                "revenue": revenue,
                "revenue_growth": None,
                "gross_profit": gross_profit,
                "net_income": net_income,
                "gross_margin": gross_margin,
                "operating_margin": _safe_div(operating_income, revenue) if operating_income is not None else _safe_div(ebit, revenue),
                "ebitda_margin": _safe_div(ebitda, revenue),
                "net_margin": _safe_div(net_income, revenue),
                "ebit": ebit,
                "ebitda": ebitda,
                "eps_diluted": _get(income, "diluted_eps"),
                "tax_rate": tax_rate,
                "roic_tax_rate": roic_tax,
                "roic_tax_basis": roic_tax_basis,
                "interest_coverage": _safe_div(ebit, interest) if interest not in (None, 0) else None,
                "current_ratio": _safe_div(current_assets, current_liabilities),
                "quick_ratio": quick_ratio,
                "cash": cash,
                "total_debt": total_debt,
                "net_debt": net_debt,
                "equity": equity,
                "shares": shares,
                "book_value_per_share": _safe_div(equity, shares),
                "total_assets": total_assets,
                "roa": _safe_div(net_income, total_assets),
                "roe": _safe_div(net_income, equity),
                "roic": _safe_div(nopat, invested_capital),
                "invested_capital": invested_capital,
                "debt_to_equity": _safe_div(total_debt, equity),
                "net_debt_ebitda": _safe_div(net_debt, ebitda) if net_debt is not None and ebitda not in (None, 0) else None,
                "asset_turnover": _safe_div(revenue, total_assets),
                "ocf": operating_cash_flow,
                "capex": capex,
                "fcf": free_cash_flow,
                "ocf_margin": _safe_div(operating_cash_flow, revenue),
                "fcf_margin": _safe_div(free_cash_flow, revenue),
                "capex_intensity": _safe_div(abs(capex) if capex is not None else None, revenue),
                "cash_conversion": _safe_div(operating_cash_flow, net_income) if net_income not in (None, 0) else None,
                "days_sales_outstanding": _safe_div(receivables * 365, revenue) if receivables is not None and revenue else None,
                "days_inventory": _safe_div(inventory * 365, cogs_for_days) if inventory is not None else None,
                "days_payable": _safe_div(payables * 365, cogs_for_days) if payables is not None else None,
                "calculation_basis": basis,
            }
        )

    for index, metric in enumerate(metrics_by_period):
        previous = _previous_period(income_periods, index)
        previous_revenue = _get(previous, "revenue")
        current_revenue = metric.get("revenue")
        if previous_revenue not in (None, 0) and current_revenue is not None:
            metric["revenue_growth"] = (current_revenue - previous_revenue) / previous_revenue
            metric["calculation_basis"]["revenue_growth"] = "calculated: current revenue ÷ prior annual revenue − 1"

    return {"periods": metrics_by_period}
