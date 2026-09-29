from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from lib.analysis.model import FinancialData, Statement

ALIASES: dict[str, list[str]] = {
    "revenue": ["Total Revenue", "Revenue"],
    "cost_of_revenue": ["Cost Of Revenue", "Cost of Revenue"],
    "gross_profit": ["Gross Profit"],
    "operating_income": ["Operating Income", "EBIT"],
    "ebitda": ["EBITDA"],
    "net_income": ["Net Income", "Net Income Common Stockholders"],
    "diluted_eps": ["Diluted EPS", "Basic EPS"],
    "diluted_shares": ["Diluted Average Shares", "Basic Average Shares"],
    "interest_expense": ["Interest Expense"],
    "pretax_income": ["Pretax Income"],
    "tax_provision": ["Tax Provision"],
    "total_assets": ["Total Assets"],
    "total_debt": ["Total Debt", "Net Debt"],
    "stockholders_equity": ["Stockholders Equity", "Total Stockholder Equity", "Common Stock Equity"],
    "cash_and_equivalents": ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"],
    "current_assets": ["Total Current Assets"],
    "current_liabilities": ["Total Current Liabilities"],
    "inventory": ["Inventory"],
    "receivables": ["Receivables"],
    "goodwill": ["Goodwill"],
    "intangible_assets": ["Intangible Assets"],
    "retained_earnings": ["Retained Earnings"],
    "common_shares_outstanding": ["Common Stock Shares Outstanding", "Share Issued"],
    "operating_cash_flow": ["Operating Cash Flow"],
    "capital_expenditure": ["Capital Expenditure"],
    "free_cash_flow": ["Free Cash Flow"],
    "depreciation_amortization": ["Depreciation And Amortization", "Depreciation Amortization Depletion"],
    "working_capital_change": ["Change In Working Capital", "Changes In Working Capital"],
    "working_capital": ["Working Capital"],
    "cash_dividends_paid": ["Cash Dividends Paid", "Common Stock Dividend Paid"],
    "repurchase_of_capital_stock": ["Repurchase Of Capital Stock"],
    "stock_based_compensation": ["Stock Based Compensation"],
    "end_cash_position": ["End Cash Position"],
}


@dataclass
class Metric:
    key: str
    label: str
    value: float | None
    unit: str
    formula: str
    inputs: list[str] = field(default_factory=list)
    by_period: dict[str, float | None] | None = None


@dataclass
class DerivedMetrics:
    ticker: str
    metrics: dict[str, Metric]

    def as_context(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, metric in self.metrics.items():
            entry: dict[str, Any] = {
                "label": metric.label,
                "value": metric.value,
                "unit": metric.unit,
                "formula": metric.formula,
                "inputs": metric.inputs,
            }
            if metric.by_period is not None:
                entry["byPeriod"] = metric.by_period
            out[key] = entry
        return out


def _norm(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch.isalnum())


class _StatementReader:
    def __init__(self, statement: Statement | None):
        self._statement = statement
        self._resolved: dict[str, str] = {}
        if statement is not None:
            for canonical, aliases in ALIASES.items():
                for alias in aliases:
                    target = self._find(alias)
                    if target is not None:
                        self._resolved[canonical] = target
                        break

    def _find(self, alias: str) -> str | None:
        if self._statement is None:
            return None
        target = _norm(alias)
        for item in self._statement.line_items:
            if _norm(item) == target:
                return item
        for item in self._statement.line_items:
            if target in _norm(item):
                return item
        return None

    def has(self, canonical: str) -> bool:
        return canonical in self._resolved

    def series(self, canonical: str) -> dict[str, float | None]:
        if not self.has(canonical):
            return {}
        return dict(self._statement.line_items[self._resolved[canonical]])

    def value(self, canonical: str, period: str) -> float | None:
        return self.series(canonical).get(period)

    def periods(self) -> list[str]:
        if self._statement is None:
            return []
        return self._statement.periods_desc()

    def path(self, canonical: str, period: str) -> str:
        item = self._resolved.get(canonical, canonical)
        return f"{self._statement.provenance.normalized_field}[{item}][{period}]"

    def source_path(self, canonical: str) -> str:
        item = self._resolved.get(canonical, canonical)
        return f"{self._statement.provenance.normalized_field}[{item}]"


def _safe_div(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


def _pct_change(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return current / previous - 1.0


def _cagr(end: float | None, start: float | None, years: float) -> float | None:
    if end is None or start is None or years <= 0 or start <= 0 or end <= 0:
        return None
    return (end / start) ** (1.0 / years) - 1.0


def _growth_metrics(key: str, label: str, series: dict[str, float | None], periods: list[str], unit: str = "percent") -> list[Metric]:
    metrics: list[Metric] = []
    by_period: dict[str, float | None] = {}
    for previous, current in zip(periods[1:], periods[:-1]):
        value = _pct_change(series.get(current), series.get(previous))
        by_period[current] = value
        metrics.append(
            Metric(
                key=f"{key}_{current}",
                label=f"{label} {current[:4]}",
                value=value,
                unit=unit,
                formula=f"{current} / {previous} - 1",
                inputs=[],
            )
        )
    if periods:
        latest = periods[0]
        metrics.append(
            Metric(
                key=key,
                label=label,
                value=by_period.get(latest),
                unit=unit,
                formula=f"latest period / previous period - 1",
                inputs=[],
                by_period=by_period,
            )
        )
    return metrics


def _ratio_series(key: str, label: str, numerator: dict[str, float | None], denominator: dict[str, float | None], periods: list[str], unit: str = "percent") -> Metric:
    by_period: dict[str, float | None] = {}
    for period in periods:
        by_period[period] = _safe_div(numerator.get(period), denominator.get(period))
    latest = periods[0] if periods else None
    return Metric(
        key=key,
        label=label,
        value=by_period.get(latest) if latest else None,
        unit=unit,
        formula="numerator / denominator per period",
        inputs=[],
        by_period=by_period,
    )


def calculate(data: FinancialData) -> DerivedMetrics:
    income = _StatementReader(data.income_statement)
    balance = _StatementReader(data.balance_sheet)
    cashflow = _StatementReader(data.cash_flow)

    income_periods = income.periods()
    balance_periods = balance.periods()
    cashflow_periods = cashflow.periods()
    all_periods = sorted(set(income_periods) | set(balance_periods) | set(cashflow_periods), reverse=True)

    metrics: dict[str, Metric] = {}

    def add(metric: Metric) -> None:
        metrics[metric.key] = metric

    for canonical, key, label in [
        ("revenue", "revenue_growth", "Revenue growth"),
        ("gross_profit", "gross_profit_growth", "Gross profit growth"),
        ("operating_income", "operating_income_growth", "Operating income growth"),
        ("ebitda", "ebitda_growth", "EBITDA growth"),
        ("net_income", "net_income_growth", "Net income growth"),
        ("diluted_eps", "eps_growth", "EPS growth"),
    ]:
        series = income.series(canonical)
        for metric in _growth_metrics(key, label, series, income_periods):
            metric.inputs = [f"income_statement[{canonical}]"]
            add(metric)

    fcf_series = _fcf_series(cashflow, cashflow_periods)
    for metric in _growth_metrics("fcf_growth", "Free cash flow growth", fcf_series, cashflow_periods):
        metric.inputs = ["cash_flow[operating_cash_flow + capital_expenditure]"]
        add(metric)

    add(_ratio_series("gross_margin", "Gross margin", income.series("gross_profit"), income.series("revenue"), income_periods))
    add(_ratio_series("operating_margin", "Operating margin", income.series("operating_income"), income.series("revenue"), income_periods))
    add(_ratio_series("ebitda_margin", "EBITDA margin", income.series("ebitda"), income.series("revenue"), income_periods))
    add(_ratio_series("net_margin", "Net margin", income.series("net_income"), income.series("revenue"), income_periods))
    add(_ratio_series("fcf_margin", "FCF margin", fcf_series, income.series("revenue"), income_periods))

    latest_income = income_periods[0] if income_periods else None
    latest_balance = balance_periods[0] if balance_periods else None
    latest_cashflow = cashflow_periods[0] if cashflow_periods else None

    if latest_income and latest_balance:
        net_income = income.value("net_income", latest_income)
        equity = balance.value("stockholders_equity", latest_balance)
        assets = balance.value("total_assets", latest_balance)
        add(_point("roe", "Return on equity (latest)", _safe_div(net_income, equity), "percent", "net_income / stockholders_equity", [income.path("net_income", latest_income), balance.path("stockholders_equity", latest_balance)]))
        add(_point("roa", "Return on assets (latest)", _safe_div(net_income, assets), "percent", "net_income / total_assets", [income.path("net_income", latest_income), balance.path("total_assets", latest_balance)]))

        ebit = income.value("operating_income", latest_income)
        tax = income.value("tax_provision", latest_income)
        pretax = income.value("pretax_income", latest_income)
        debt = balance.value("total_debt", latest_balance)
        cash = balance.value("cash_and_equivalents", latest_balance)
        invested_capital = None
        if debt is not None and equity is not None:
            invested_capital = debt + equity - (cash or 0.0)
        nopat = None
        if ebit is not None and pretax is not None and pretax != 0:
            effective_tax = _safe_div(tax, pretax)
            if effective_tax is not None:
                nopat = ebit * (1 - effective_tax)
        add(_point("roic", "Return on invested capital (latest)", _safe_div(nopat, invested_capital), "percent", "NOPAT / (total_debt + equity - cash)", [income.path("operating_income", latest_income), balance.path("total_debt", latest_balance), balance.path("stockholders_equity", latest_balance)]))

    if latest_balance:
        debt = balance.value("total_debt", latest_balance)
        equity = balance.value("stockholders_equity", latest_balance)
        cash = balance.value("cash_and_equivalents", latest_balance)
        current_assets = balance.value("current_assets", latest_balance)
        current_liabilities = balance.value("current_liabilities", latest_balance)
        inventory = balance.value("inventory", latest_balance)
        add(_point("debt_to_equity", "Debt-to-equity (latest)", _safe_div(debt, equity), "ratio", "total_debt / stockholders_equity", [balance.path("total_debt", latest_balance), balance.path("stockholders_equity", latest_balance)]))
        if debt is not None and cash is not None:
            add(_point("net_debt", "Net debt (latest)", debt - cash, "currency", "total_debt - cash_and_equivalents", [balance.path("total_debt", latest_balance), balance.path("cash_and_equivalents", latest_balance)]))
        add(_point("current_ratio", "Current ratio (latest)", _safe_div(current_assets, current_liabilities), "ratio", "current_assets / current_liabilities", [balance.path("current_assets", latest_balance), balance.path("current_liabilities", latest_balance)]))
        if current_assets is not None and inventory is not None and current_liabilities is not None:
            add(_point("quick_ratio", "Quick ratio (latest)", (current_assets - inventory) / current_liabilities, "ratio", "(current_assets - inventory) / current_liabilities", [balance.path("current_assets", latest_balance), balance.path("inventory", latest_balance), balance.path("current_liabilities", latest_balance)]))

    if latest_balance and latest_income:
        ebitda = income.value("ebitda", latest_income)
        debt = balance.value("total_debt", latest_balance)
        cash = balance.value("cash_and_equivalents", latest_balance)
        if ebitda is not None and debt is not None and cash is not None:
            add(_point("net_debt_to_ebitda", "Net debt / EBITDA (latest)", (debt - cash) / ebitda, "ratio", "(total_debt - cash) / ebitda", [balance.path("total_debt", latest_balance), balance.path("cash_and_equivalents", latest_balance), income.path("ebitda", latest_income)]))

    if latest_cashflow and latest_income:
        ocf = cashflow.value("operating_cash_flow", latest_cashflow)
        capex = cashflow.value("capital_expenditure", latest_cashflow)
        fcf = _fcf_value(ocf, capex)
        net_income = income.value("net_income", latest_income)
        revenue = income.value("revenue", latest_income)
        add(_point("cash_conversion", "Cash conversion (FCF / net income, latest)", _safe_div(fcf, net_income), "ratio", "free_cashflow / net_income", ["cash_flow[operating_cash_flow + capital_expenditure]", income.path("net_income", latest_income)]))
        add(_point("capex_to_revenue", "Capex / revenue (latest)", _safe_div(abs(capex) if capex is not None else None, revenue), "percent", "abs(capital_expenditure) / revenue", [cashflow.path("capital_expenditure", latest_cashflow), income.path("revenue", latest_income)]))
        wc_change = cashflow.value("working_capital_change", latest_cashflow)
        if wc_change is None and len(balance_periods) >= 2:
            wc_now = _working_capital(balance, latest_balance)
            wc_prev = _working_capital(balance, balance_periods[1])
            if wc_now is not None and wc_prev is not None:
                wc_change = wc_now - wc_prev
        if wc_change is not None:
            add(_point("working_capital_change", "Working capital change (latest)", wc_change, "currency", "change in (current_assets - current_liabilities)", [balance.path("current_assets", latest_balance), balance.path("current_liabilities", latest_balance)]))

    for canonical, key, label, years in [
        ("revenue", "revenue_cagr_3y", "Revenue CAGR (3y)", 3),
        ("revenue", "revenue_cagr_5y", "Revenue CAGR (5y)", 5),
        ("diluted_eps", "eps_cagr_3y", "EPS CAGR (3y)", 3),
        ("diluted_eps", "eps_cagr_5y", "EPS CAGR (5y)", 5),
    ]:
        series = income.series(canonical)
        cagr = _cagr_over_periods(series, income_periods, years)
        add(_point(key, label, cagr, "percent", f"CAGR over {years} years", [f"income_statement[{canonical}]"]))

    fcf_cagr = _cagr_over_periods(fcf_series, cashflow_periods, 3)
    add(_point("fcf_cagr_3y", "FCF CAGR (3y)", fcf_cagr, "percent", "CAGR over 3 years", ["cash_flow[operating_cash_flow + capital_expenditure]"]))

    income_keys = {"revenue", "gross_profit", "operating_income", "ebitda", "net_income", "diluted_eps"}
    for canonical, key, label in [
        ("revenue", "revenue", "Revenue"),
        ("gross_profit", "gross_profit", "Gross profit"),
        ("operating_income", "operating_income", "Operating income"),
        ("ebitda", "ebitda", "EBITDA"),
        ("net_income", "net_income", "Net income"),
        ("diluted_eps", "diluted_eps", "Diluted EPS"),
        ("operating_cash_flow", "operating_cash_flow", "Operating cash flow"),
        ("total_debt", "total_debt", "Total debt"),
        ("cash_and_equivalents", "cash_and_equivalents", "Cash and equivalents"),
        ("stockholders_equity", "stockholders_equity", "Stockholders equity"),
        ("total_assets", "total_assets", "Total assets"),
    ]:
        if canonical in income_keys:
            reader = income
        elif canonical == "operating_cash_flow":
            reader = cashflow
        else:
            reader = balance
        series = reader.series(canonical)
        if series:
            latest = reader.periods()[0] if reader.periods() else None
            add(Metric(key=key, label=label, value=series.get(latest) if latest else None, unit="currency" if canonical != "diluted_eps" else "number", formula="as reported", inputs=[reader.source_path(canonical)], by_period=series))

    fcf_by_period = {p: fcf_series.get(p) for p in cashflow_periods}
    if fcf_by_period:
        add(Metric(key="free_cash_flow", label="Free cash flow", value=fcf_by_period.get(latest_cashflow) if latest_cashflow else None, unit="currency", formula="operating_cash_flow + capital_expenditure", inputs=["cash_flow[operating_cash_flow + capital_expenditure]"], by_period=fcf_by_period))

    _add_market_metrics(metrics, data, income, balance, income_periods, balance_periods)

    return DerivedMetrics(ticker=data.ticker, metrics=metrics)


def _point(key: str, label: str, value: float | None, unit: str, formula: str, inputs: list[str]) -> Metric:
    return Metric(key=key, label=label, value=value, unit=unit, formula=formula, inputs=inputs)


def _fcf_value(ocf: float | None, capex: float | None) -> float | None:
    if ocf is None or capex is None:
        return None
    return ocf + capex


def _fcf_series(cashflow: _StatementReader, periods: list[str]) -> dict[str, float | None]:
    ocf = cashflow.series("operating_cash_flow")
    capex = cashflow.series("capital_expenditure")
    direct = cashflow.series("free_cash_flow")
    out: dict[str, float | None] = {}
    for period in periods:
        computed = _fcf_value(ocf.get(period), capex.get(period))
        out[period] = computed if computed is not None else direct.get(period)
    return out


def _working_capital(balance: _StatementReader, period: str) -> float | None:
    ca = balance.value("current_assets", period)
    cl = balance.value("current_liabilities", period)
    if ca is None or cl is None:
        return None
    return ca - cl


def _cagr_over_periods(series: dict[str, float | None], periods: list[str], years: int) -> float | None:
    if len(periods) < years + 1:
        return None
    end = series.get(periods[0])
    start = series.get(periods[years])
    return _cagr(end, start, float(years))


def _add_market_metrics(
    metrics: dict[str, Metric],
    data: FinancialData,
    income: _StatementReader,
    balance: _StatementReader,
    income_periods: list[str],
    balance_periods: list[str],
) -> None:
    closes = [row["close"] for row in data.historical_prices if row.get("close") is not None]
    dates = [row["date"] for row in data.historical_prices if row.get("close") is not None]
    price = (data.price or {}).get("price")
    market_cap = (data.market or {}).get("market_cap")
    shares = (data.market or {}).get("shares_outstanding")

    def add(key: str, label: str, value: float | None, unit: str, formula: str, inputs: list[str]) -> None:
        metrics[key] = Metric(key=key, label=label, value=value, unit=unit, formula=formula, inputs=inputs)

    if closes and dates:
        for months, key, label in [(1, "price_return_1m", "1-month price return"), (3, "price_return_3m", "3-month price return"), (6, "price_return_6m", "6-month price return"), (12, "price_return_1y", "1-year price return"), (36, "price_return_3y", "3-year price return"), (60, "price_return_5y", "5-year price return")]:
            idx = _index_n_months_back(dates, months)
            if idx is not None and closes[idx] != 0:
                add(key, label, closes[-1] / closes[idx] - 1.0, "percent", f"close[t] / close[t-{months}m] - 1", ["historical_prices.close"])
        for window, key, label in [(252, "volatility_1y", "Annualized volatility (1y)"), (756, "volatility_3y", "Annualized volatility (3y)")]:
            vol = _annualized_volatility(closes, window)
            add(key, label, vol, "percent", "std(daily returns) * sqrt(252)", ["historical_prices.close"])
        add("max_drawdown_5y", "Max drawdown (5y)", _max_drawdown(closes), "percent", "min(close / running_max(close) - 1)", ["historical_prices.close"])

    latest_income = income_periods[0] if income_periods else None
    latest_balance = balance_periods[0] if balance_periods else None

    if price is not None and latest_income:
        eps = income.value("diluted_eps", latest_income)
        revenue = income.value("revenue", latest_income)
        if eps is not None and eps > 0:
            add("pe_current", "P/E (price / latest annual EPS)", price / eps, "ratio", "price / diluted_eps", ["price", f"income_statement[diluted_eps][{latest_income}]"])
        if revenue is not None and revenue > 0 and market_cap is not None:
            add("ps_current", "P/S (market cap / revenue)", market_cap / revenue, "ratio", "market_cap / revenue", ["market.market_cap", f"income_statement[revenue][{latest_income}]"])

    if price is not None and latest_balance:
        equity = balance.value("stockholders_equity", latest_balance)
        shares_bs = balance.value("common_shares_outstanding", latest_balance)
        shares_eff = shares or shares_bs
        if equity is not None and shares_eff is not None and shares_eff > 0:
            bvps = equity / shares_eff
            if bvps > 0:
                add("pb_current", "P/B (price / book value per share)", price / bvps, "ratio", "price / (stockholders_equity / shares_outstanding)", ["price", balance.path("stockholders_equity", latest_balance), "market.shares_outstanding"])

    if market_cap is not None and latest_balance and latest_income:
        debt = balance.value("total_debt", latest_balance)
        cash = balance.value("cash_and_equivalents", latest_balance)
        ebitda = income.value("ebitda", latest_income)
        revenue = income.value("revenue", latest_income)
        if debt is not None and cash is not None:
            ev = market_cap + debt - cash
            add("ev_current", "Enterprise value", ev, "currency", "market_cap + total_debt - cash", ["market.market_cap", balance.path("total_debt", latest_balance), balance.path("cash_and_equivalents", latest_balance)])
            if ebitda is not None and ebitda > 0:
                add("ev_to_ebitda", "EV / EBITDA", ev / ebitda, "ratio", "ev / ebitda", ["ev_current", f"income_statement[ebitda][{latest_income}]"])
            if revenue is not None and revenue > 0:
                add("ev_to_revenue", "EV / revenue", ev / revenue, "ratio", "ev / revenue", ["ev_current", f"income_statement[revenue][{latest_income}]"])

    if market_cap is not None and market_cap > 0 and latest_cashflow_has_fcf(metrics):
        fcf = metrics.get("free_cash_flow")
        if fcf is not None and fcf.value is not None:
            add("fcf_yield", "FCF yield (FCF / market cap)", fcf.value / market_cap, "percent", "free_cashflow / market_cap", ["cash_flow[operating_cash_flow + capital_expenditure]", "market.market_cap"])


def latest_cashflow_has_fcf(metrics: dict[str, Metric]) -> bool:
    return "free_cash_flow" in metrics


def _index_n_months_back(dates: list[str], months: int) -> int | None:
    if not dates:
        return None
    from datetime import date

    last = date.fromisoformat(dates[-1])
    target_year = last.year - (months // 12)
    target_month = last.month - (months % 12)
    if target_month <= 0:
        target_month += 12
        target_year -= 1
    target = date(target_year, target_month, min(last.day, 28))
    best: int | None = None
    for i, d in enumerate(dates):
        if date.fromisoformat(d) <= target:
            best = i
    return 0 if best is None else best


def _annualized_volatility(closes: list[float], window: int) -> float | None:
    if len(closes) < window + 1:
        return None
    recent = closes[-(window + 1):]
    returns = [recent[i] / recent[i - 1] - 1.0 for i in range(1, len(recent)) if recent[i - 1] != 0]
    if len(returns) < 30:
        return None
    mean = sum(returns) / len(returns)
    variance = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
    return math.sqrt(variance) * math.sqrt(252)


def _max_drawdown(closes: list[float]) -> float | None:
    if not closes:
        return None
    peak = closes[0]
    max_dd = 0.0
    for close in closes:
        if close > peak:
            peak = close
        if peak > 0:
            dd = close / peak - 1.0
            if dd < max_dd:
                max_dd = dd
    return max_dd
