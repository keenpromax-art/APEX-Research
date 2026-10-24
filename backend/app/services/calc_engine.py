from __future__ import annotations

from typing import Any


def _number(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _at(value: Any, index: int, default: float) -> float:
    if isinstance(value, (list, tuple)):
        if not value:
            return default
        picked = value[index] if index < len(value) else value[-1]
        return _number(picked, default)
    return _number(value, default)


def _period_end(period: dict | None) -> str:
    value = (period or {}).get("period_end")
    return value if isinstance(value, str) else ""


def _find_period(periods: list[dict], target: dict) -> dict:
    label = _period_end(target)
    if label:
        for period in periods:
            if _period_end(period) == label:
                return period
    return periods[0] if periods else {}


def build_three_statement(hist_last: dict[str, Any], assumptions: dict[str, Any], n_years: int = 5) -> dict[str, Any]:
    """Deterministic, linked three-statement forecast.

    Assumptions accept either scalars or per-year lists. A cash revolver covers
    deficits; ``excess_cash_sweep`` optionally pays debt from surplus cash. The
    balance check is reported every year rather than hidden.
    """
    n_years = max(0, min(int(_number(n_years, 5)), 25))
    base_revenue = _number(hist_last.get("revenue"))
    base_nwc = _number(hist_last.get("nwc"))
    base_ppe = _number(hist_last.get("ppe"))
    base_debt = _number(hist_last.get("debt"))
    base_cash = _number(hist_last.get("cash"))
    base_equity = _number(hist_last.get("equity"))
    base_assets = _number(hist_last.get("total_assets"), base_cash + base_ppe + base_nwc)
    other_assets = _number(hist_last.get("other_assets"), base_assets - base_cash - base_ppe - base_nwc)
    other_net_liabilities = _number(hist_last.get("other_net_liabilities"), base_assets - base_debt - base_equity)
    shares = _number(hist_last.get("shares"), 1.0) or 1.0

    revenue_growth = assumptions.get("revenue_growth", 0.05)
    minimum_cash = _number(assumptions.get("minimum_cash"), 0.0)
    excess_cash_sweep = max(0.0, min(1.0, _number(assumptions.get("excess_cash_sweep"), 0.0)))
    share_dilution = _number(assumptions.get("share_dilution"), 0.0)

    periods: list[dict[str, Any]] = []
    revenue = base_revenue
    net_working_capital = base_nwc
    ppe = base_ppe
    debt = base_debt
    cash = base_cash
    equity = base_equity
    total_interest = 0.0
    peak_debt = debt

    for index in range(n_years):
        growth = _at(revenue_growth, index, 0.05)
        growth = max(growth, -0.99)
        gross_margin = _at(assumptions.get("gross_margin"), index, 0.4)
        operating_ratio = _at(assumptions.get("opex_ratio"), index, 0.2)
        tax_rate = max(0.0, min(1.0, _at(assumptions.get("tax_rate"), index, 0.25)))
        da_pct = _at(assumptions.get("da_pct"), index, 0.03)
        capex_pct = _at(assumptions.get("capex_pct"), index, 0.04)
        nwc_pct = _at(assumptions.get("nwc_pct"), index, 0.15)
        interest_rate = _at(assumptions.get("interest_rate"), index, 0.05)
        payout = max(0.0, min(1.0, _at(assumptions.get("dividend_payout"), index, 0.3)))

        previous_revenue = revenue
        revenue = revenue * (1 + growth)
        cogs = revenue * (1 - gross_margin)
        gross_profit = revenue - cogs
        operating_expense = revenue * operating_ratio
        depreciation = revenue * da_pct
        ebit = gross_profit - operating_expense - depreciation
        ebitda = ebit + depreciation

        interest = debt * interest_rate
        pretax = ebit - interest
        tax = pretax * tax_rate if pretax > 0 else 0.0
        net_income = pretax - tax

        delta_revenue = revenue - previous_revenue
        delta_nwc = delta_revenue * nwc_pct
        net_working_capital += delta_nwc

        capex = revenue * capex_pct
        ppe = ppe + capex - depreciation

        operating_cash_flow = net_income + depreciation - delta_nwc
        free_cash_flow = operating_cash_flow - capex
        dividends = net_income * payout if net_income > 0 else 0.0

        cash_before_financing = cash + free_cash_flow - dividends
        revolver_draw = max(0.0, minimum_cash - cash_before_financing)
        debt += revolver_draw
        cash = cash_before_financing + revolver_draw
        debt_repayment = 0.0
        if excess_cash_sweep > 0 and debt > 0 and cash > minimum_cash:
            debt_repayment = min(debt, (cash - minimum_cash) * excess_cash_sweep)
            debt -= debt_repayment
            cash -= debt_repayment

        equity += net_income - dividends
        shares = shares * (1 + share_dilution)

        total_assets = cash + ppe + net_working_capital + other_assets
        total_liabilities = debt + other_net_liabilities
        balance_check = total_assets - (total_liabilities + equity)
        total_interest += interest
        peak_debt = max(peak_debt, debt)

        periods.append(
            {
                "year": index + 1,
                "revenue": revenue,
                "revenue_growth": growth,
                "cogs": cogs,
                "gross_profit": gross_profit,
                "gross_margin": gross_margin,
                "opex": operating_expense,
                "da": depreciation,
                "ebit": ebit,
                "ebitda": ebitda,
                "ebit_margin": ebit / revenue if revenue else None,
                "ebitda_margin": ebitda / revenue if revenue else None,
                "interest": interest,
                "ebt": pretax,
                "tax": tax,
                "net_income": net_income,
                "net_margin": net_income / revenue if revenue else None,
                "nwc": net_working_capital,
                "delta_nwc": delta_nwc,
                "capex": capex,
                "ppe": ppe,
                "debt": debt,
                "revolver_draw": revolver_draw,
                "debt_repayment": debt_repayment,
                "cash": cash,
                "equity": equity,
                "other_assets": other_assets,
                "other_net_liabilities": other_net_liabilities,
                "total_assets": total_assets,
                "total_liabilities": total_liabilities,
                "balance_check": balance_check,
                "bs_check": balance_check,
                "ocf": operating_cash_flow,
                "fcf": free_cash_flow,
                "dividends": dividends,
                "shares": shares,
                "eps": net_income / shares if shares else None,
            }
        )

    last = periods[-1] if periods else {}
    first = periods[0] if periods else {}
    years = len(periods)
    cagr = None
    if years and base_revenue > 0 and last.get("revenue", 0) > 0:
        cagr = (last["revenue"] / base_revenue) ** (1 / years) - 1

    return {
        "periods": periods,
        "assumptions": assumptions,
        "base": hist_last,
        "summary": {
            "years": years,
            "revenue_cagr": cagr,
            "final_revenue": last.get("revenue"),
            "final_ebitda": last.get("ebitda"),
            "final_net_income": last.get("net_income"),
            "final_fcf": last.get("fcf"),
            "final_cash": last.get("cash"),
            "final_debt": last.get("debt"),
            "final_net_debt": (last.get("debt", 0) - last.get("cash", 0)) if periods else None,
            "total_interest": total_interest,
            "peak_debt": peak_debt if periods else None,
            "balance_ok": all(
                abs(period.get("balance_check", 0.0)) <= max(1.0, abs(period.get("total_assets", 0.0)) * 1e-9)
                for period in periods
            )
            if periods
            else None,
            "max_balance_check": max((abs(period.get("balance_check", 0.0)) for period in periods), default=0.0),
        },
    }


def last_historical(normalized: dict[str, Any], metrics: dict[str, Any] | None = None) -> dict[str, Any]:
    annual = (normalized or {}).get("annual", {}) or {}
    income_periods = annual.get("income_statement", []) or []
    balance_periods = annual.get("balance_sheet", []) or []
    cashflow_periods = annual.get("cash_flow", []) or []
    if not income_periods:
        return {}

    income = income_periods[0]
    balance = _find_period(balance_periods, income)
    cashflow = _find_period(cashflow_periods, income)
    income_items = income.get("items", {}) or {}
    balance_items = balance.get("items", {}) or {}
    cashflow_items = cashflow.get("items", {}) or {}

    revenue = _number(income_items.get("revenue"), 0.0)
    if revenue <= 0:
        return {}

    gross_profit = _number(income_items.get("gross_profit"), 0.0)
    gross_margin = gross_profit / revenue if gross_profit else None
    if gross_margin is None and income_items.get("cost_of_revenue") is not None:
        gross_margin = 1 - _number(income_items.get("cost_of_revenue")) / revenue

    operating_expense = income_items.get("operating_expense") or income_items.get("sga_expense")
    operating_ratio = _number(operating_expense) / revenue if operating_expense is not None else None
    depreciation = income_items.get("da") or cashflow_items.get("da_cf")
    da_pct = _number(depreciation) / revenue if depreciation is not None else None
    capex = cashflow_items.get("capex")
    capex_pct = abs(_number(capex)) / revenue if capex is not None else None

    pretax = income_items.get("pretax_income")
    tax = income_items.get("tax_expense")
    tax_rate = _number(tax) / _number(pretax) if pretax not in (None, 0) and tax is not None else None
    if tax_rate is None or tax_rate < 0 or tax_rate > 1:
        tax_rate = 0.25

    cash = _number(balance_items.get("cash"), 0.0)
    debt = _number(balance_items.get("total_debt"), 0.0)
    equity = _number(balance_items.get("equity"), 0.0)
    ppe = _number(balance_items.get("ppe_net"), 0.0)
    total_assets = _number(balance_items.get("total_assets"), cash + ppe)
    current_assets = balance_items.get("current_assets")
    current_liabilities = balance_items.get("current_liabilities")
    nwc = _number(current_assets) - _number(current_liabilities) if current_assets is not None and current_liabilities is not None else 0.0
    nwc_pct = nwc / revenue if revenue else 0.15
    nwc_pct = max(0.0, min(1.0, nwc_pct))

    interest_expense = _number(income_items.get("interest_expense"), 0.0)
    interest_rate = interest_expense / debt if debt > 0 else 0.05
    dividends_paid = _number(cashflow_items.get("dividends_paid"), 0.0)
    net_income = _number(income_items.get("net_income"), 0.0)
    payout = min(1.0, abs(dividends_paid) / net_income) if net_income > 0 and dividends_paid else 0.3

    shares = _number(balance_items.get("shares_issued"))
    info = (normalized or {}).get("info", {}) or {}
    if not shares:
        shares = _number(info.get("sharesOutstanding") or info.get("impliedSharesOutstanding"), 1.0)
    if not shares:
        shares = 1.0

    return {
        "revenue": revenue,
        "gross_margin": gross_margin if gross_margin is not None else 0.4,
        "opex_ratio": operating_ratio if operating_ratio is not None else 0.2,
        "tax_rate": tax_rate,
        "da_pct": da_pct if da_pct is not None else 0.03,
        "capex_pct": capex_pct if capex_pct is not None else 0.04,
        "nwc_pct": nwc_pct,
        "nwc": nwc,
        "ppe": ppe,
        "debt": debt,
        "cash": cash,
        "equity": equity,
        "total_assets": total_assets,
        "other_assets": total_assets - cash - ppe - nwc,
        "other_net_liabilities": total_assets - debt - equity,
        "shares": shares,
        "interest_rate": interest_rate,
        "dividend_payout": payout,
        "base_period": income.get("period_end"),
    }
