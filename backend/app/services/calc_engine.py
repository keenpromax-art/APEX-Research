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


def _optional_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result or result in (float("inf"), float("-inf")):
        return None
    return result


def last_historical(normalized: dict[str, Any], metrics: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build the forecast base year without silently substituting missing data.

    Where a required driver is unavailable, a documented modelling default is
    used and recorded in ``assumption_provenance`` and ``model_input_gaps``.
    The report layer must disclose those defaults; they are never presented as
    reported company data.
    """
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

    revenue = _optional_number(income_items.get("revenue"))
    if revenue is None or revenue <= 0:
        return {}

    provenance: dict[str, str] = {}
    gaps: list[dict[str, str]] = []

    def with_default(key: str, value: Any, default: float, source: str, default_note: str) -> float:
        number = _optional_number(value)
        if number is not None:
            provenance[key] = source
            return number
        provenance[key] = f"engine default: {default_note}"
        gaps.append({"area": key, "severity": "warning", "detail": default_note})
        return default

    metric_periods = (metrics or {}).get("periods") or []
    latest_metric = metric_periods[0] if metric_periods else {}
    revenue_growth = with_default(
        "revenue_growth",
        latest_metric.get("revenue_growth"),
        0.05,
        "engine-inferred from the latest reported annual revenue growth",
        "revenue growth unavailable; the model uses a disclosed 5.0% annual default",
    )

    gross_margin: float | None = None
    gross_profit = _optional_number(income_items.get("gross_profit"))
    cost_of_revenue = _optional_number(income_items.get("cost_of_revenue"))
    if gross_profit is not None:
        gross_margin = gross_profit / revenue
        provenance["gross_margin"] = "reported gross profit ÷ latest annual revenue"
    elif cost_of_revenue is not None:
        gross_margin = 1 - cost_of_revenue / revenue
        provenance["gross_margin"] = "calculated from reported revenue and cost of revenue"
    if gross_margin is None:
        gross_margin = 0.4
        provenance["gross_margin"] = "engine default: 40% gross margin"
        gaps.append({"area": "gross_margin", "severity": "warning", "detail": "gross profit and cost of revenue unavailable; using a disclosed 40% margin default"})

    operating_expense = income_items.get("operating_expense")
    operating_source = "reported operating expense"
    if operating_expense is None and income_items.get("sga_expense") is not None:
        operating_expense = income_items.get("sga_expense")
        operating_source = "reported SG&A used as operating expense"
    operating_ratio = with_default(
        "opex_ratio",
        (_optional_number(operating_expense) / revenue if operating_expense is not None else None),
        0.2,
        operating_source + " ÷ revenue",
        "operating expense unavailable; using a disclosed 20% of revenue default",
    )

    depreciation = income_items.get("da")
    depreciation_source = "reported depreciation and amortization"
    if depreciation is None and cashflow_items.get("da_cf") is not None:
        depreciation = cashflow_items.get("da_cf")
        depreciation_source = "cash-flow-statement D&A"
    da_pct = with_default(
        "da_pct",
        (_optional_number(depreciation) / revenue if depreciation is not None else None),
        0.03,
        depreciation_source + " ÷ revenue",
        "D&A unavailable; using a disclosed 3% of revenue default",
    )

    capex = _optional_number(cashflow_items.get("capex"))
    capex_pct = with_default(
        "capex_pct",
        (abs(capex) / revenue if capex is not None else None),
        0.04,
        "|reported capex| ÷ revenue",
        "capex unavailable; using a disclosed 4% of revenue default",
    )

    pretax = _optional_number(income_items.get("pretax_income"))
    tax = _optional_number(income_items.get("tax_expense"))
    reported_tax_rate = tax / pretax if tax is not None and pretax not in (None, 0) else None
    if reported_tax_rate is not None and 0 <= reported_tax_rate <= 1:
        tax_rate = reported_tax_rate
        provenance["tax_rate"] = "reported tax expense ÷ pretax income"
    else:
        tax_rate = 0.25
        provenance["tax_rate"] = "engine default: 25% tax rate"
        gaps.append({"area": "tax_rate", "severity": "warning", "detail": "effective tax rate unavailable or invalid; using a disclosed 25% default"})

    cash = with_default(
        "cash", balance_items.get("cash"), 0.0, "reported cash and equivalents",
        "cash unavailable; using a disclosed zero opening cash balance",
    )
    debt = with_default(
        "debt", balance_items.get("total_debt"), 0.0, "reported total debt",
        "total debt unavailable; using a disclosed zero opening debt balance",
    )
    equity = with_default(
        "equity", balance_items.get("equity"), 0.0, "reported shareholders' equity",
        "equity unavailable; using a disclosed zero opening equity",
    )
    ppe = with_default(
        "ppe", balance_items.get("ppe_net"), 0.0, "reported net PP&E",
        "net PP&E unavailable; using a disclosed zero opening PP&E",
    )

    total_assets_reported = _optional_number(balance_items.get("total_assets"))
    if total_assets_reported is not None:
        total_assets = total_assets_reported
        provenance["total_assets"] = "reported total assets"
    else:
        total_assets = cash + ppe
        provenance["total_assets"] = "engine fallback: cash + net PP&E"
        gaps.append({"area": "total_assets", "severity": "warning", "detail": "total assets unavailable; balance-sheet opening residual is incomplete"})

    current_assets = _optional_number(balance_items.get("current_assets"))
    current_liabilities = _optional_number(balance_items.get("current_liabilities"))
    short_term_debt = _optional_number(balance_items.get("short_term_debt"))
    if current_assets is not None and current_liabilities is not None:
        # Operating NWC excludes cash. Short-term debt is excluded when exposed;
        # otherwise this limitation is disclosed instead of silently netting it.
        operating_assets = current_assets - (cash if cash is not None else 0.0)
        operating_liabilities = current_liabilities - (short_term_debt if short_term_debt is not None else 0.0)
        nwc = operating_assets - operating_liabilities
        if short_term_debt is not None:
            provenance["nwc"] = "calculated operating NWC: current assets − cash − (current liabilities − short-term debt)"
        else:
            provenance["nwc"] = "calculated operating NWC: current assets − cash − current liabilities; short-term debt split unavailable"
            gaps.append({"area": "nwc", "severity": "info", "detail": "short-term debt not separated; current liabilities are treated as operating liabilities"})
        nwc_pct = max(0.0, min(1.0, nwc / revenue))
        provenance["nwc_pct"] = "base-year operating NWC ÷ revenue"
    else:
        nwc = 0.0
        nwc_pct = 0.15
        provenance["nwc"] = "engine default: zero opening operating working capital"
        provenance["nwc_pct"] = "engine default: 15% incremental working capital"
        gaps.append({"area": "nwc", "severity": "warning", "detail": "current assets/liabilities unavailable; using disclosed operating-NWC defaults"})

    interest_expense = _optional_number(income_items.get("interest_expense"))
    if interest_expense is not None and debt > 0:
        interest_rate = interest_expense / debt
        provenance["interest_rate"] = "reported interest expense ÷ opening total debt"
    else:
        interest_rate = 0.05
        provenance["interest_rate"] = "engine default: 5% interest rate"
        gaps.append({"area": "interest_rate", "severity": "warning", "detail": "interest expense or debt unavailable; using a disclosed 5% rate default"})

    dividends_paid = _optional_number(cashflow_items.get("dividends_paid"))
    net_income = _optional_number(income_items.get("net_income")) or 0.0
    if dividends_paid is not None and net_income > 0:
        payout = min(1.0, abs(dividends_paid) / net_income)
        provenance["dividend_payout"] = "|reported dividends paid| ÷ net income"
    elif dividends_paid is not None:
        payout = 0.0
        provenance["dividend_payout"] = "no positive net income; modelled payout set to zero"
    else:
        payout = 0.3
        provenance["dividend_payout"] = "engine default: 30% payout"
        gaps.append({"area": "dividend_payout", "severity": "warning", "detail": "dividends paid unavailable; using a disclosed 30% payout default"})

    balance_shares = _optional_number(balance_items.get("shares_issued"))
    info = (normalized or {}).get("info", {}) or {}
    info_shares = _optional_number(info.get("sharesOutstanding") or info.get("impliedSharesOutstanding"))
    if balance_shares is not None and balance_shares > 0:
        shares = balance_shares
        shares_available = True
        provenance["shares"] = "balance-sheet shares issued"
    elif info_shares is not None and info_shares > 0:
        shares = info_shares
        shares_available = True
        provenance["shares"] = "provider company-info shares outstanding"
    else:
        # Keep the statement engine usable for operating forecasts, but mark the
        # share count unavailable so valuation must not publish a per-share value.
        shares = 1.0
        shares_available = False
        provenance["shares"] = "unavailable; one-share placeholder for EPS-only diagnostics"
        gaps.append({"area": "shares", "severity": "error", "detail": "no share count available; per-share valuation is suppressed"})

    other_assets = total_assets - cash - ppe - nwc
    other_net_liabilities = total_assets - debt - equity
    provenance["other_assets"] = "base-year balance-sheet residual"
    provenance["other_net_liabilities"] = "base-year balance-sheet residual"

    return {
        "revenue": revenue,
        "revenue_growth": revenue_growth,
        "gross_margin": gross_margin,
        "opex_ratio": operating_ratio,
        "tax_rate": tax_rate,
        "da_pct": da_pct,
        "capex_pct": capex_pct,
        "nwc_pct": nwc_pct,
        "nwc": nwc,
        "ppe": ppe,
        "debt": debt,
        "cash": cash,
        "equity": equity,
        "total_assets": total_assets,
        "other_assets": other_assets,
        "other_net_liabilities": other_net_liabilities,
        "shares": shares,
        "shares_available": shares_available,
        "interest_rate": interest_rate,
        "dividend_payout": payout,
        "base_period": income.get("period_end"),
        "assumption_provenance": provenance,
        "model_input_gaps": gaps,
    }
