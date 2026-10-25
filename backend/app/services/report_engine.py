from __future__ import annotations

"""Deterministic research report engine.

Builds the complete, auditable data payload behind an institutional equity
research report. Every number is one of: reported (from Yahoo Finance via the
normalizer), calculated (deterministic metrics engine), model (three-statement
forecast / DCF engines) or analyst-configured (explicit assumption). The AI
stage only writes narrative sections against this payload and may never
produce a final figure.

All outputs are JSON-safe (no NaN/Inf), period-aligned, and carry provenance.
"""

import math
from typing import Any

from .calc_engine import build_three_statement, last_historical
from .data_access import load_normalized, refresh
from ..exceptions import DataError, TickerNotFoundError
from .metrics import compute_metrics
from .narrative_qa import duplicate_sentence_issues, flatten_narrative_text
from .valuation import dcf, reverse_dcf, reverse_dcf_growth, sensitivity_table, wacc, wacc_details

CALC_ASSUMPTION_KEYS = [
    "revenue_growth",
    "gross_margin",
    "opex_ratio",
    "tax_rate",
    "da_pct",
    "capex_pct",
    "nwc_pct",
    "interest_rate",
    "dividend_payout",
    "minimum_cash",
    "excess_cash_sweep",
    "share_dilution",
]

DEFAULT_WACC_INPUTS: dict[str, float] = {
    "risk_free": 0.04,
    "beta": 1.0,
    "market_premium": 0.055,
    "cost_of_debt": 0.06,
    "tax_rate": 0.25,
    "equity_weight": 0.7,
    "debt_weight": 0.3,
}

DEFAULT_CONFIG: dict[str, Any] = {
    "report_type": "full",  # quick | full
    "years": 5,
    "horizon": "12M",
    "valuation_method": "dcf",
    "terminal_mode": "growth",  # growth | multiple
    "terminal_growth": 0.025,
    "exit_multiple": 10.0,
    "wacc": None,  # explicit override; else derived from wacc_inputs
    "wacc_inputs": {},
    "assumptions": {},  # analyst overrides for the forecast
    "rating_mode": "auto",  # auto | manual
    "manual_rating": None,  # BUY | HOLD | SELL when manual
    "manual_target_price": None,  # analyst target override when manual
    "ai_model": None,  # AI model name; narrative only
    "title": None,
    "report_date": None,  # override the cover date (YYYY-MM-DD); default = generation date
    "peers": [],  # optional comparable tickers (same provider)
    "source_documents": [],  # [{title, url, note}] analyst-provided references
    "force_refresh": False,
}

# Scenario design (deterministic and documented in the methodology section):
# bear  : revenue growth -2pp on every forecast year, WACC +1pp
# base  : as configured
# bull  : revenue growth +2pp on every forecast year, WACC -1pp
SCENARIOS = {
    "bear": {"growth_delta": -0.02, "wacc_delta": 0.01},
    "base": {"growth_delta": 0.0, "wacc_delta": 0.0},
    "bull": {"growth_delta": 0.02, "wacc_delta": -0.01},
}

RATING_BANDS = (("BUY", 0.15), ("HOLD", -0.05), ("SELL", None))
RATING_COLORS = {"BUY": "pos", "HOLD": "warn", "SELL": "neg", "NOT RATED": "muted"}

PRICE_HISTORY_CAP = 260  # one trading year


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def _clean(value: Any) -> Any:
    """Recursively make a value JSON-safe."""
    if value is None or isinstance(value, (str, bool)):
        return value
    number = _finite(value)
    if number is not None:
        return number
    if isinstance(value, dict):
        return {str(key): _clean(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_clean(item) for item in value]
    return str(value)


def _shift_growth(assumptions: dict[str, Any], delta: float) -> dict[str, Any]:
    """Apply a uniform revenue-growth delta across scalars or per-year lists."""
    out = dict(assumptions)
    growth = out.get("revenue_growth")
    if growth is None:
        return out
    if isinstance(growth, (list, tuple)):
        out["revenue_growth"] = [
            max(-0.9, (_finite(g) or 0.0) + delta) for g in growth
        ]
    else:
        base = _finite(growth)
        if base is not None:
            out["revenue_growth"] = max(-0.9, base + delta)
    return out


def _merge_assumptions(
    base: dict[str, Any],
    overrides: dict[str, Any],
    provenance: dict[str, str] | None = None,
) -> tuple[dict[str, Any], list[str], dict[str, str]]:
    """Merge analyst overrides onto engine-inferred base-year assumptions."""
    base_provenance = dict(provenance or base.get("assumption_provenance") or {})
    merged = {key: value for key, value in base.items() if key in CALC_ASSUMPTION_KEYS or key == "base_period"}
    merged.update({key: base[key] for key in base if key not in merged})
    applied: list[str] = []
    output_provenance: dict[str, str] = dict(base_provenance)
    for key, value in (overrides or {}).items():
        if key not in CALC_ASSUMPTION_KEYS:
            continue
        if value is None or value == "":
            continue
        if isinstance(value, (list, tuple)) and value:
            clean_list = [_finite(item) for item in value]
            if any(item is None for item in clean_list):
                continue
            merged[key] = clean_list
            applied.append(key)
            output_provenance[key] = "analyst override: per-year schedule"
            continue
        number = _finite(value)
        if number is None:
            continue
        merged[key] = number
        applied.append(key)
        output_provenance[key] = "analyst override"
    for key in merged:
        output_provenance.setdefault(key, "engine-inferred from the forecast base year")
    return merged, applied, output_provenance


def _growth_schedule(base_growth: float | None, terminal_growth: float | None, years: int) -> list[float]:
    """Fade base-year growth toward the configured terminal growth.

    This prevents the engine from mechanically repeating one unsupported growth
    rate across every forecast year. The schedule is deterministic and
    disclosed as a model convention, not company guidance.
    """
    start = _finite(base_growth)
    end = _finite(terminal_growth)
    if start is None:
        start = 0.05
    if end is None:
        end = start
    if years <= 1 or abs(start - end) < 1e-9:
        return [max(-0.90, start)]
    return [max(-0.90, start + (end - start) * index / (years - 1)) for index in range(years)]


def _wacc_value(config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    explicit = _finite(config.get("wacc"))
    if explicit is not None and explicit > -1:
        return explicit, {
            "mode": "explicit",
            "value": explicit,
            "note": "Analyst-supplied discount rate; no CAPM build-up is implied.",
        }
    inputs = {**DEFAULT_WACC_INPUTS}
    for key, value in (config.get("wacc_inputs") or {}).items():
        number = _finite(value)
        if number is not None and key in inputs:
            inputs[key] = number
    details = wacc_details(**inputs)
    value = details.get("value")
    if value is None:
        # Preserve a numeric WACC for legacy callers, while exposing the error.
        value = wacc(**inputs)
    return value, {
        "mode": "capm",
        "inputs": inputs,
        "value": value,
        "details": details,
        "warnings": details.get("warnings") or [],
    }


def _period_fy(period_end: Any) -> str:
    label = str(period_end or "")
    match = label[:4]
    return f"FY{match}" if match else "—"


def _fiscal_end_note(normalized: dict[str, Any]) -> str | None:
    months = []
    for period in ((normalized.get("annual", {}) or {}).get("income_statement") or [])[:4]:
        label = str(period.get("period_end") or "")
        if len(label) >= 7:
            months.append(int(label[5:7]))
    if not months:
        return None
    modal = max(set(months), key=months.count)
    names = {3: "March", 6: "June", 9: "September", 12: "December"}
    month_name = names.get(modal, f"month {modal:02d}")
    return f"fiscal years end in {month_name}; FY labels use the year of the period end"


def _quarter_label(period_end: Any) -> str:
    label = str(period_end or "")
    if len(label) >= 7:
        year, month = label[:4], int(label[5:7])
        quarter = (month - 1) // 3 + 1
        return f"Q{quarter} FY{year}"
    return label or "—"


def _forecast_labels(base_period: Any, n_years: int) -> list[str]:
    try:
        base_year = int(str(base_period)[:4])
    except (TypeError, ValueError):
        return [f"Y{i + 1}E" for i in range(n_years)]
    return [f"FY{base_year + i + 1}E" for i in range(n_years)]


def dividend_summary(normalized: dict[str, Any], current_price: float | None) -> dict[str, Any]:
    """Trailing-twelve-month dividend per share and yield, when history exists."""
    dividends = normalized.get("dividends") or []
    if not dividends:
        return {"available": False, "note": "No dividend history reported by the provider."}
    dated = sorted(
        (d for d in dividends if d.get("date") and _finite(d.get("value")) is not None),
        key=lambda d: str(d["date"]),
    )
    if not dated:
        return {"available": False, "note": "Dividend history present but unusable."}
    last_date = str(dated[-1]["date"])[:10]
    try:
        from datetime import datetime, timedelta

        cutoff = (datetime.strptime(last_date, "%Y-%m-%d") - timedelta(days=365)).strftime("%Y-%m-%d")
    except ValueError:
        cutoff = ""
    ttm = sum(_finite(d.get("value")) or 0.0 for d in dated if str(d.get("date"))[:10] >= cutoff)
    if ttm <= 0:
        ttm = _finite(dated[-1].get("value")) or 0.0
    yield_ = (ttm / current_price) if (ttm > 0 and current_price and current_price > 0) else None
    return {
        "available": True,
        "ttm_per_share": ttm,
        "yield": yield_,
        "last_payment": last_date,
        "payments": len(dated),
    }


def build_market_multiples(
    price: float | None,
    market_cap: float | None,
    net_debt: float | None,
    shares: float | None,
    latest: dict[str, Any],
) -> dict[str, Any]:
    """Spot multiples at the last close against the latest reported FY.

    Every ratio is labelled with its measurement basis; ratios that cannot be
    formed (negative earnings, missing price) are omitted rather than guessed.
    """
    out: dict[str, Any] = {
        "basis": "last close ÷ latest reported FY figures (spot, not TTM)",
        "price": price,
        "rows": [],
    }
    if not price or price <= 0:
        out["note"] = "No market price available; multiples not formed."
        return out

    def add(label: str, value: float | None, note: str = "") -> None:
        if value is not None and value == value and abs(value) != float("inf"):
            out["rows"].append({"label": label, "value": value, "note": note})

    eps = _finite(latest.get("eps_diluted"))
    if eps is not None and eps > 0:
        add("P/E (diluted, latest FY)", price / eps)
    bvps = _finite(latest.get("book_value_per_share"))
    if bvps is not None and bvps > 0:
        add("P/B (latest FY book)", price / bvps)
    ebitda = _finite(latest.get("ebitda"))
    ev = None
    if market_cap is not None and net_debt is not None:
        ev = market_cap + net_debt
    if ev is not None and ebitda is not None and ebitda > 0:
        add("EV/EBITDA (latest FY)", ev / ebitda)
    ebit = _finite(latest.get("ebit"))
    if ev is not None and ebit is not None and ebit > 0:
        add("EV/EBIT (latest FY)", ev / ebit)
    if market_cap is not None and market_cap > 0:
        fcf = _finite(latest.get("fcf"))
        if fcf is not None:
            add("FCF yield (latest FY)", fcf / market_cap)
        ni = _finite(latest.get("net_income"))
        if ni is not None:
            add("Earnings yield (latest FY)", ni / market_cap)
    if not out["rows"]:
        out["note"] = "Insufficient price/earnings data or an incomplete net-debt bridge to form market multiples."
    return out


def build_operating_drivers(info: dict[str, Any], metrics_periods: list[dict], quarterly_metrics: dict[str, Any]) -> dict[str, Any]:
    """Sector-aware operating metrics derived from reported statements.

    Only metrics that can be computed from the normalized statements are
    included. Sector-specific series that the provider does not expose (loans,
    deposits, transaction volumes, unit volumes) are explicitly named as gaps
    rather than fabricated.
    """
    sector = str(info.get("sector") or "")
    industry = str(info.get("industry") or "")
    haystack = f"{sector} {industry}".lower()
    financial = any(token in haystack for token in ("bank", "financial", "insurance", "credit"))
    consumer = any(token in haystack for token in ("consumer", "retail", "beverage", "food", "apparel"))
    tech = any(token in haystack for token in ("software", "information techn", "semiconductor", "tech"))

    rows: list[dict[str, str]] = []
    for period in metrics_periods[:1]:
        def fmt(key: str, label: str, kind: str) -> None:
            value = _finite(period.get(key))
            if value is not None:
                rows.append({"label": label, "value": value, "kind": kind})

        fmt("asset_turnover", "Asset turnover (revenue ÷ total assets)", "x")
        fmt("roic", "ROIC (latest FY)", "pct")
        fmt("fcf_margin", "FCF margin (latest FY)", "pct")
        fmt("capex_intensity", "Capex intensity (% of revenue)", "pct")
        fmt("days_sales_outstanding", "Days sales outstanding", "x")
        fmt("days_inventory", "Days inventory", "x")
        fmt("days_payable", "Days payable", "x")
        if not financial:
            fmt("net_debt_ebitda", "Net debt / EBITDA", "x")
        fmt("interest_coverage", "Interest coverage (EBIT ÷ interest)", "x")
        fmt("cash_conversion", "Cash conversion (OCF ÷ net income)", "x")

    unavailable: list[str] = []
    if financial:
        unavailable += [
            "Loan growth, deposit growth, NIM, asset-quality and capital-adequacy series are not exposed by the statement adapter.",
            "Net debt / EBITDA is suppressed because balance-sheet leverage is not a normal financial-sector metric.",
        ]
    if consumer:
        unavailable += ["Volume, realization and market-share series are not disclosed in the structured data feed."]
    if tech:
        unavailable += ["Utilization, headcount and deal-tipeline disclosures are not part of the structured feed."]
    quarterly_ok = bool(quarterly_metrics.get("periods"))
    if not quarterly_ok:
        unavailable.append("Quarterly operating follow-through is unavailable for this listing.")

    return {
        "sector": sector or "—",
        "industry": industry or "—",
        "classification": "financials" if financial else "consumer" if consumer else "technology" if tech else "general",
        "rows": rows,
        "unavailable": unavailable,
        "quarterly_available": quarterly_ok,
    }


def build_peer_comps(peers: Any, subject_normalized: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Comparable-company snapshot using the same provider for each peer."""
    peer_list = [str(p).strip().upper() for p in (peers or []) if str(p).strip()][:6]
    out: dict[str, Any] = {"requested": peer_list, "rows": [], "note": None}
    gaps: list[dict[str, str]] = []
    if not peer_list:
        out["note"] = "No peer group configured; peer comparison omitted rather than invented."
        return out, gaps

    subject = str(subject_normalized.get("ticker") or "").upper()
    for peer in peer_list:
        if peer == subject:
            continue
        try:
            norm, m = load_normalized(peer)
        except Exception as error:  # noqa: BLE001 - peers degrade to a gap
            gaps.append({"area": "peer data", "severity": "info", "detail": f"Peer {peer} unavailable ({type(error).__name__}); excluded from the comparison."})
            continue
        info = norm.get("info") or {}
        periods = list(m.get("periods") or [])
        latest = periods[0] if periods else {}
        p_summary = norm.get("price_summary") or {}
        p_price = _finite(p_summary.get("last_close"))
        p_mcap = _finite(info.get("marketCap"))
        p_shares = _finite(info.get("sharesOutstanding") or info.get("impliedSharesOutstanding"))
        if p_mcap is None and p_price and p_shares:
            p_mcap = p_price * p_shares
        bs = (norm.get("annual", {}) or {}).get("balance_sheet") or []
        p_debt = _finite((bs[0].get("items") or {}).get("total_debt")) if bs else None
        p_cash = _finite((bs[0].get("items") or {}).get("cash")) if bs else None
        p_net_debt = (p_debt - p_cash) if (p_debt is not None and p_cash is not None) else None
        eps = _finite(latest.get("eps_diluted"))
        ebitda = _finite(latest.get("ebitda"))
        equity = _finite(latest.get("equity"))
        pe = (p_price / eps) if (p_price and eps and eps > 0) else None
        ev = (p_mcap + p_net_debt) if (p_mcap is not None and p_net_debt is not None) else None
        ev_ebitda = (ev / ebitda) if (ev is not None and ebitda and ebitda > 0) else None
        pb = (p_mcap / equity) if (p_mcap is not None and equity and equity > 0) else None
        missing: list[str] = []
        if pe is None:
            missing.append("P/E")
        if ev_ebitda is None:
            missing.append("EV/EBITDA")
        if pb is None:
            missing.append("P/B")
        if missing:
            gaps.append({
                "area": "peer data",
                "severity": "info",
                "detail": f"Peer {peer} is shown with {', '.join(missing)} unavailable because its matching inputs are incomplete; they are not inferred.",
            })
        out["rows"].append({
            "ticker": peer,
            "name": info.get("shortName") or peer,
            "price": p_price,
            "price_date": p_summary.get("last_date"),
            "market_cap": p_mcap,
            "pe": pe,
            "ev_ebitda": ev_ebitda,
            "pb": pb,
            "revenue_growth": _finite(latest.get("revenue_growth")),
            "gross_margin": _finite(latest.get("gross_margin")),
            "currency": info.get("currency"),
            "incomplete": missing,
        })
    if not out["rows"]:
        out["note"] = "Peer group was requested but no peer could be resolved from the provider."
    else:
        out["note"] = "Peer multiples use each peer's own last close and latest reported FY, retrieved via the same provider as S1."
    return out, gaps


def valuation_rationale(cfg: dict[str, Any], latest: dict[str, Any], sector: str | None = None) -> str:
    method = str(cfg.get("valuation_method") or "dcf")
    if method == "dcf":
        fcf = _finite(latest.get("fcf"))
        is_financial = any(token in str(sector or "").lower() for token in ("bank", "financial", "insurance", "credit"))
        if fcf is not None and fcf > 0:
            prefix = (
                "A discounted-cash-flow framework is used because the company converts earnings into positive free cash flow, "
                "so intrinsic value can be tied to modelled cash generation rather than to a multiple that may embed cycle peaks or troughs. "
            )
        else:
            prefix = (
                "A discounted-cash-flow framework is applied, but the latest reported free cash flow is not positive; "
                "the terminal value therefore carries more of the valuation and the output should be treated as preliminary. "
            )
        if is_financial:
            return prefix + (
                "For banks and other financial companies, unlevered FCF and enterprise-value bridges are structurally "
                "less appropriate because funding is part of operations; treat the output as a screening cross-check and "
                "prioritise earnings, capital adequacy and P/B evidence where available."
            )
        return prefix + (
            "The DCF is cross-checked with a reverse DCF (the discount rate the current price implies) and a "
            "WACC-versus-terminal-parameter sensitivity grid."
        )
    return f"Valuation method '{method}' requested; the displayed bridge documents whichever engine output is available."


# --------------------------------------------------------------------------- #
# payload construction
# --------------------------------------------------------------------------- #

def build_report_payload(ticker: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build the complete deterministic report payload for a ticker."""
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    ticker = ticker.strip().upper()
    force = bool(cfg.get("force_refresh"))

    try:
        normalized, metrics = refresh(ticker) if force else load_normalized(ticker)
    except (DataError, TickerNotFoundError):
        raise
    except Exception as error:  # pragma: no cover - defensive
        raise DataError(ticker, str(error)) from error
    return build_payload_from_data(ticker, normalized, metrics, cfg)


def build_payload_from_data(
    ticker: str,
    normalized: dict[str, Any],
    metrics: dict[str, Any],
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the report payload from already normalized provider data.

    This is the shared deterministic core used by both report pathways. The
    small research note consumes the same engine output but renders a compact
    PDF; it never bypasses these calculations.
    """
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    ticker = ticker.strip().upper()

    info = normalized.get("info", {}) or {}
    annual = normalized.get("annual", {}) or {}
    quarterly = normalized.get("quarterly", {}) or {}
    metrics_periods = list(metrics.get("periods") or [])
    price_summary = normalized.get("price_summary") or {}
    is_demo = bool(normalized.get("demo"))
    quality = normalized.get("data_quality", {}) or {}
    alerts = list(quality.get("alerts") or [])
    stale = bool(quality.get("stale"))

    # ---------------- price / market data ----------------
    price_history = [
        {"date": point.get("date"), "close": _finite(point.get("close"))}
        for point in (normalized.get("price_history") or [])[-PRICE_HISTORY_CAP:]
        if _finite(point.get("close")) is not None
    ]
    current_price = _finite(price_summary.get("last_close"))
    change_pct = _finite(price_summary.get("change_pct"))
    low_52w = _finite(price_summary.get("low_52w"))
    high_52w = _finite(price_summary.get("high_52w"))
    price_date = price_summary.get("last_date") or (price_history[-1].get("date") if price_history else None)
    avg_volume = _finite(price_summary.get("avg_volume_3m"))
    dividend = dividend_summary(normalized, current_price)

    currency = info.get("currency") or "USD"
    shares_balance = latest_balance_value(annual, "shares_issued")
    shares_info = _finite(info.get("sharesOutstanding") or info.get("impliedSharesOutstanding"))
    shares = first_not_none(shares_balance, shares_info)
    market_cap = _finite(info.get("marketCap"))
    if market_cap is None and current_price and shares:
        market_cap = current_price * shares

    latest_metrics = metrics_periods[0] if metrics_periods else {}

    # ---------------- forecast ----------------
    base = last_historical(normalized, metrics)
    if not base:
        raise DataError(
            ticker,
            "No usable annual financial data returned for this ticker; a "
            "deterministic forecast and valuation cannot be built. Consider "
            "generating a preliminary (data-gap) report instead.",
        )
    merged_assumptions, applied_overrides, assumption_provenance = _merge_assumptions(
        base, cfg.get("assumptions"), base.get("assumption_provenance")
    )
    n_years = max(1, min(int(_finite(cfg.get("years")) or 5), 10))
    if "revenue_growth" not in applied_overrides:
        base_growth = _finite(base.get("revenue_growth"))
        schedule = _growth_schedule(base_growth, terminal_growth_later := _finite(cfg.get("terminal_growth")), n_years)
        merged_assumptions["revenue_growth"] = schedule
        assumption_provenance["revenue_growth"] = (
            "engine convention: fade the latest reported growth to the configured terminal growth "
            f"({', '.join(f'{g:.1%}' for g in schedule)})"
        )
    else:
        terminal_growth_later = _finite(cfg.get("terminal_growth"))
    forecast = build_three_statement(base, merged_assumptions, n_years)
    forecast_periods = forecast.get("periods") or []

    # ---------------- valuation ----------------
    wacc_value, wacc_meta = _wacc_value(cfg)
    wacc_rate = _finite(wacc_value)
    if wacc_rate is None:
        wacc_rate = 0.10
        wacc_meta["warning"] = "WACC was invalid; a disclosed 10% fallback is used for the screening valuation."
    wacc_warnings = [str(w) for w in (wacc_meta.get("warnings") or [])]

    net_debt_stat = _sub(
        latest_balance_value(annual, "total_debt"),
        latest_balance_value(annual, "cash"),
    )
    net_debt_available = net_debt_stat is not None
    net_debt = net_debt_stat if net_debt_available else 0.0
    net_debt_basis = (
        "reported balance sheet: total debt − cash"
        if net_debt_available else
        "model assumption: zero net debt because balance-sheet debt or cash is unavailable"
    )
    if not net_debt_available:
        wacc_warnings.append("Net debt is unavailable; the equity bridge explicitly assumes zero until data are supplied.")

    fcf_list = [_finite(period.get("fcf")) for period in forecast_periods]
    shares_for_valuation = _finite(shares)
    shares_available = bool(shares_for_valuation and shares_for_valuation > 0)
    if not shares_available:
        wacc_warnings.append("Share count is unavailable; DCF, sensitivity and reverse-DCF per-share values are suppressed.")

    terminal_growth = terminal_growth_later
    exit_multiple = _finite(cfg.get("exit_multiple"))
    if fcf_list and all(value is not None for value in fcf_list) and shares_available:
        if (cfg.get("terminal_mode") or "growth") == "growth" and terminal_growth is not None:
            dcf_result = dcf(
                fcf_list, wacc_rate, terminal_growth=terminal_growth,
                net_debt=net_debt, shares=shares_for_valuation,
            )
        else:
            final_ebitda = _finite(forecast_periods[-1].get("ebitda")) if forecast_periods else None
            dcf_result = dcf(
                fcf_list, wacc_rate, exit_multiple=exit_multiple, final_ebitda=final_ebitda,
                net_debt=net_debt, shares=shares_for_valuation,
            )
    else:
        missing_input = "share count" if not shares_available else "forecast free cash flow"
        dcf_result = {"error": f"Valuation cannot be published because {missing_input} is unavailable."}
    dcf_warnings = list(wacc_warnings) + [str(w) for w in (dcf_result.get("warnings") or [])]
    target_price = _finite(dcf_result.get("value_per_share"))

    # sensitivity grid (5x5 around the configured inputs)
    if shares_available and fcf_list and all(value is not None for value in fcf_list):
        wacc_values = [round(wacc_rate + offset, 5) for offset in (-0.02, -0.01, 0.0, 0.01, 0.02) if wacc_rate + offset > (terminal_growth or -1.0) + 0.005]
        if not wacc_values:
            wacc_values = [wacc_rate]
        if (cfg.get("terminal_mode") or "growth") == "growth" and terminal_growth is not None:
            terminal_values = [max(0.0, round(terminal_growth + g, 5)) for g in (-0.01, -0.005, 0.0, 0.005, 0.01)]
        else:
            terminal_values = [round((exit_multiple or 10.0) + delta, 2) for delta in (2.0, 1.0, 0.0, -1.0, -2.0)]
        sensitivity = sensitivity_table(
            fcf_list, shares_for_valuation, net_debt,
            _finite((forecast_periods[-1] or {}).get("ebitda")) or 0.0,
            wacc_values, terminal_values,
            "growth" if (cfg.get("terminal_mode") or "growth") == "growth" else "multiple",
        )
    else:
        wacc_values, terminal_values, sensitivity = [], [], []

    reverse_dcf_result: dict[str, Any] | None = None
    reverse_growth_result: dict[str, Any] | None = None
    if current_price and current_price > 0 and shares_available and fcf_list and all(value is not None for value in fcf_list):
        if terminal_growth is not None:
            reverse_dcf_result = reverse_dcf(
                fcf_list, current_price, shares_for_valuation, net_debt=net_debt,
                terminal_growth=terminal_growth,
            )
            if "error" in reverse_dcf_result:
                reverse_dcf_result = {"unavailable": reverse_dcf_result.get("error")}
        if wacc_rate > 0:
            reverse_growth_result = reverse_dcf_growth(
                fcf_list, current_price, shares_for_valuation, net_debt=net_debt, wacc=wacc_rate,
            )
            if "error" in reverse_growth_result:
                reverse_growth_result = {"unavailable": reverse_growth_result.get("error")}

    # ---------------- scenarios ----------------
    scenarios = {}
    for name, spec in SCENARIOS.items():
        scenario_assumptions = _shift_growth(merged_assumptions, spec["growth_delta"])
        scenario_forecast = build_three_statement(base, scenario_assumptions, n_years)
        scenario_fcf = [_finite(p.get("fcf")) for p in (scenario_forecast.get("periods") or [])]
        scenario_wacc = round(wacc_rate + spec["wacc_delta"], 5)
        scenario_valid = (
            shares_available
            and scenario_fcf
            and all(value is not None for value in scenario_fcf)
            and wacc_rate + spec["wacc_delta"] > (terminal_growth or -1.0) + 0.002
        )
        if not scenario_valid:
            scenario_result: dict[str, Any] = {
                "error": (
                    f"scenario WACC {scenario_wacc:.2%} does not exceed terminal growth"
                    if scenario_fcf and all(value is not None for value in scenario_fcf) and shares_available
                    else "valuation inputs are incomplete"
                )
            }
        elif (cfg.get("terminal_mode") or "growth") == "growth" and terminal_growth is not None:
            scenario_result = dcf(
                scenario_fcf, scenario_wacc, terminal_growth=terminal_growth,
                net_debt=net_debt, shares=shares_for_valuation,
            )
        else:
            scenario_final = scenario_forecast.get("periods") or [{}]
            scenario_result = dcf(
                scenario_fcf, scenario_wacc, exit_multiple=exit_multiple,
                final_ebitda=_finite(scenario_final[-1].get("ebitda")),
                net_debt=net_debt, shares=shares_for_valuation,
            )
        scenarios[name] = {
            "target_price": _finite(scenario_result.get("value_per_share")) if "error" not in scenario_result else None,
            "wacc": scenario_wacc,
            "growth_delta": spec["growth_delta"],
            "enterprise_value": _finite(scenario_result.get("enterprise_value")) if "error" not in scenario_result else None,
            "equity_value": _finite(scenario_result.get("equity_value")) if "error" not in scenario_result else None,
            "fcf": scenario_fcf,
            "assumptions": {key: value for key, value in scenario_assumptions.items() if key in CALC_ASSUMPTION_KEYS},
            "error": scenario_result.get("error") if "error" in scenario_result else None,
        }

    # ---------------- input and data gaps ----------------
    gaps: list[dict[str, str]] = list(base.get("model_input_gaps") or [])
    if not net_debt_available:
        gaps.append({
            "area": "valuation net debt",
            "severity": "warning",
            "detail": "Balance-sheet debt or cash is unavailable; the DCF bridge explicitly assumes zero net debt.",
        })
    if not shares_available:
        gaps.append({
            "area": "valuation shares",
            "severity": "error",
            "detail": "No reliable share count is available; target price and upside are suppressed.",
        })

    # ---------------- quarterly follow-through ----------------
    quarterly_metrics: dict[str, Any] = {}
    if quarterly.get("income_statement"):
        quarterly_metrics = compute_metrics({"annual": quarterly})

    # ---------------- market multiples & operating drivers ----------------
    multiples = build_market_multiples(current_price, market_cap, net_debt, shares, latest_metrics)
    drivers = build_operating_drivers(info, metrics_periods, quarterly_metrics)
    peers_block, peer_gaps = build_peer_comps(cfg.get("peers"), normalized)
    gaps.extend(peer_gaps)

    # ---------------- rating ----------------
    rating, rating_rationale = resolve_rating(target_price, current_price, cfg, quality)

    # ---------------- gaps ----------------
    gaps.extend(build_gaps(annual, quarterly, alerts, price_history, metrics_periods, stale))

    # ---------------- sources ----------------
    sources = build_sources(normalized, cfg, peers=bool(peers_block.get("rows")), documents=cfg.get("source_documents"))

    report_date = str(cfg.get("report_date") or "")[:10] or utc_iso()[:10]

    payload: dict[str, Any] = {
        "schema": "apex.research.v1",
        "generated_at": utc_iso(),
        "report_date": report_date,
        "ticker": ticker,
        "meta": {
            "name": info.get("longName") or info.get("shortName") or ticker,
            "exchange": info.get("exchange"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "country": info.get("country"),
            "website": info.get("website"),
            "summary": info.get("longBusinessSummary"),
            "employees": info.get("fullTimeEmployees"),
            "currency": currency,
            "market_cap": market_cap,
            "shares": shares,
            "demo": is_demo,
            "header_note": "APEX RESEARCH",
        },
        "price": {
            "current": current_price,
            "change_pct": change_pct,
            "low_52w": low_52w,
            "high_52w": high_52w,
            "series": price_history,
            "price_date": price_date,
            "avg_volume_3m": avg_volume,
            "dividend": dividend,
            "as_of": utc_iso(),
            "source_note": "Yahoo Finance close prices" + (" (cached)" if stale else ""),
        },
        "historical": {
            "metrics": metrics_periods[:6],
            "periods": [_period_fy(p.get("period_end")) for p in metrics_periods[:6]],
            "fiscal_note": _fiscal_end_note(normalized),
            "statements": {
                name: _statement_payload(rows)
                for name, rows in annual.items()
            },
            "quarterly": {
                name: _statement_payload(rows)
                for name, rows in (quarterly or {}).items()
            },
            "quarterly_metrics": (quarterly_metrics.get("periods") or [])[:8],
            "quarterly_periods": [_quarter_label(p.get("period_end")) for p in (quarterly_metrics.get("periods") or [])[:8]],
        },
        "market_context": {
            "multiples": multiples,
            "operating_drivers": drivers,
            "peers": peers_block,
        },
        "forecast": {
            "years": n_years,
            "base_period": base.get("base_period"),
            "labels": _forecast_labels(base.get("base_period"), n_years),
            "assumptions": {
                "values": merged_assumptions,
                "overrides": applied_overrides,
                "provenance": assumption_provenance,
                "growth_convention": (
                    "Revenue growth is a per-year schedule that fades latest reported growth toward the configured "
                    "terminal growth unless the analyst supplies an explicit growth override."
                ),
            },
            "model_input_gaps": base.get("model_input_gaps") or [],
            "periods": forecast_periods,
            "summary": forecast.get("summary"),
            "balance_ok": bool((forecast.get("summary") or {}).get("balance_ok"))
            if (forecast.get("summary") or {}).get("balance_ok") is not None else False,
            "max_balance_check": _finite((forecast.get("summary") or {}).get("max_balance_check")),
        },
        "valuation": {
            "method": cfg.get("valuation_method") or "dcf",
            "rationale": valuation_rationale(cfg, latest_metrics, info.get("sector")),
            "wacc": wacc_rate,
            "wacc_meta": _clean(wacc_meta),
            "wacc_warnings": wacc_warnings,
            "terminal_mode": cfg.get("terminal_mode") or "growth",
            "terminal_growth": terminal_growth,
            "exit_multiple": exit_multiple,
            "net_debt": net_debt,
            "net_debt_basis": net_debt_basis,
            "shares": shares,
            "shares_basis": (base.get("assumption_provenance") or {}).get("shares"),
            "fcf": fcf_list,
            "dcf": _clean(dcf_result),
            "dcf_warnings": _clean(dcf_warnings),
            "sensitivity": {
                "wacc_values": wacc_values,
                "terminal_values": terminal_values,
                "terminal_label": "terminal growth" if (cfg.get("terminal_mode") or "growth") == "growth" else "exit multiple",
                "table": _clean(sensitivity),
            },
            "reverse_dcf": _clean(reverse_dcf_result),
            "reverse_dcf_growth": _clean(reverse_growth_result),
        },
        "scenarios": {
            **scenarios,
            "design": "bear: revenue growth −2pp + WACC +1pp · bull: revenue growth +2pp − WACC −1pp",
        },
        "rating": rating,
        "gaps": gaps,
        "sources": sources,
        "source_documents": _clean(cfg.get("source_documents") or []),
        "provenance_count": len(sources),
        "data_quality": {
            "stale": stale,
            "demo": is_demo,
            "alerts": alerts,
            "retrieved_at": quality.get("retrieved_at") or normalized.get("retrieved_at"),
        },
        "narrative": None,  # filled by the AI stage; qualitative only
        "qc": [],  # filled by run_qa
    }

    payload["summary_snapshot"] = build_summary_snapshot(payload, cfg)
    return _clean(payload)


# --------------------------------------------------------------------------- #
# rating
# --------------------------------------------------------------------------- #

def resolve_rating(target_price: float | None, current_price: float | None, cfg: dict[str, Any], quality: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    rationale: list[str] = []
    if not target_price or not current_price or current_price <= 0:
        info = {
            "code": "NOT RATED",
            "mode": "auto",
            "upside": None,
            "horizon": cfg.get("horizon") or "12M",
            "reason": "Valuation or market price unavailable; issued as preliminary research only.",
        }
        return info, ["Rating withheld: deterministic target price or market price was not derivable."]

    reasons: list[str] = []
    if quality.get("stale"):
        reasons.append("Data served from cache because Yahoo Finance was unavailable; figures may be stale.")

    upside = target_price / current_price - 1
    mode = cfg.get("rating_mode") or "auto"
    if mode == "manual" and (cfg.get("manual_rating") or "").strip():
        code = str(cfg["manual_rating"]).strip().upper()
        if code not in ("BUY", "HOLD", "SELL", "NOT RATED"):
            code = "NOT RATED"
            reasons.insert(0, "Manual rating was not one of BUY/HOLD/SELL; suppressed to NOT RATED.")
        reasons.insert(0, "Analyst override applied: rating set explicitly by configuration.")
        mode_label = "analyst override"
    else:
        code = "NOT RATED"
        mode_label = "apex_default (upside bands: BUY ≥ +15%, HOLD −5%…+15%, SELL < −5%; 12M horizon)"
        for band_code, band_floor in RATING_BANDS:
            if band_floor is None:
                code = band_code  # SELL is the residual
                break
            if upside >= band_floor:
                code = band_code
                break
        rationale.append(
            f"Upside {upside:+.1%} = target {target_price:,.2f} ÷ price {current_price:,.2f} − 1, ranked against the default bands."
        )

    target = _finite(cfg.get("manual_target_price")) if mode == "manual" else None
    if target is not None:
        reasons.append(f"Analyst target override {target:,.2f} replaces the model target {target_price:,.2f}.")
        target_price = target
        upside = target / current_price - 1

    return {
        "code": code,
        "mode": mode_label,
        "upside": upside,
        "target_price": target_price,
        "reasons": reasons + rationale,
        "horizon": cfg.get("horizon") or "12M",
    }, []


# --------------------------------------------------------------------------- #
# gaps / sources / snapshot
# --------------------------------------------------------------------------- #

def build_gaps(annual: dict[str, Any], quarterly: dict[str, Any], alerts: list[dict], price_history: list, metrics_periods: list, stale: bool) -> list[dict[str, str]]:
    gaps: list[dict[str, str]] = []
    for alert in alerts:
        level = alert.get("level", "info")
        if level in ("warning", "info"):
            gaps.append({"area": "data coverage", "severity": level, "detail": str(alert.get("message", ""))})
    if not price_history:
        gaps.append({"area": "market data", "severity": "warning", "detail": "No share-price history; cover chart and upside unavailable."})
    if not (quarterly.get("income_statement") or []):
        gaps.append({"area": "quarterly follow-through", "severity": "info", "detail": "Provider returned no quarterly income statement."})
    periods = len(metrics_periods)
    if periods < 3:
        gaps.append({"area": "history depth", "severity": "warning", "detail": f"Only {periods} annual periods available; trend analysis is thin."})
    if stale:
        gaps.append({"area": "freshness", "severity": "warning", "detail": "Live fetch failed; cached data served and labelled."})
    return gaps


def build_sources(
    normalized: dict[str, Any],
    cfg: dict[str, Any],
    peers: bool = False,
    documents: list | None = None,
) -> list[dict[str, str]]:
    retrieved = str(normalized.get("retrieved_at") or "") or "unknown"
    sources = [
        {"ref": "S1", "kind": "reported", "label": "Yahoo Finance via yfinance", "where": "annual & quarterly statements, prices, share counts, dividends, company info", "retrieved_at": retrieved},
        {"ref": "S2", "kind": "calculated", "label": "APEX metrics engine", "where": "margins, returns, working-capital, leverage and operating ratios derived from S1", "retrieved_at": retrieved},
        {"ref": "S3", "kind": "model", "label": "APEX three-statement forecast engine", "where": "Y1–YN forecast statements, free cash flow per year", "retrieved_at": "generated_at"},
        {"ref": "S4", "kind": "model", "label": "APEX valuation engine (DCF / WACC / sensitivity / reverse DCF)", "where": "EV → equity → target price bridge", "retrieved_at": "generated_at"},
        {"ref": "S5", "kind": "assumption", "label": "Analyst configuration", "where": "forecast & valuation overrides, peer set, report date (labelled in tables)", "retrieved_at": "report config"},
    ]
    if peers:
        sources.append({"ref": "S7", "kind": "reported", "label": "Peer tickers via Yahoo Finance (same adapter as S1)", "where": "peer market cap, multiples, growth and margins", "retrieved_at": retrieved})
    for index, doc in enumerate(documents or [], start=1):
        title = str((doc or {}).get("title") or f"Document {index}")[:120]
        url = str((doc or {}).get("url") or "").strip()
        note = str((doc or {}).get("note") or "").strip()
        where = "analyst-supplied reference" + (f": {note[:160]}" if note else "")
        sources.append({"ref": f"D{index}", "kind": "document", "label": title + (f" — {url}" if url else ""), "where": where, "retrieved_at": "analyst upload"})
    if cfg.get("ai_model"):
        sources.append({"ref": "S6", "kind": "ai", "label": f'AI narrative model: {cfg["ai_model"]}', "where": "qualitative interpretation only; no final figures", "retrieved_at": "generated_at"})
    return sources


def build_summary_snapshot(payload: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    """Historical (chronological) + forecast highlights for the cover table.

    History runs oldest → newest left to right; forecast columns continue the
    sequence with model years. Each row's values are index-aligned with
    ``labels``: ``values`` covers the historical labels, ``forecast`` the
    forecast labels.
    """
    metrics = payload["historical"]["metrics"]
    hist_labels = payload["historical"]["periods"]
    fcast_periods = payload["forecast"]["periods"]
    fcast_labels = payload["forecast"].get("labels") or []

    hist_n = min(3, len(metrics))
    hist = metrics[:hist_n][::-1]  # oldest → newest
    hist_labels = hist_labels[:hist_n][::-1]
    fcast_n = min(3, len(fcast_periods))
    fcast = fcast_periods[:fcast_n]
    fcast_labels = fcast_labels[:fcast_n]

    def row(label: str, hist_key: str, fcast_key: str, fmt: str) -> dict[str, Any]:
        return {
            "label": label,
            "values": [_finite(m.get(hist_key)) for m in hist],
            "forecast": [_finite(p.get(fcast_key)) for p in fcast],
            "fmt": fmt,
        }

    return {
        "labels": hist_labels,
        "forecast_labels": fcast_labels,
        "rows": [
            row("Revenue", "revenue", "revenue", "money"),
            row("EBITDA", "ebitda", "ebitda", "money"),
            row("Net income", "net_income", "net_income", "money"),
            row("Free cash flow", "fcf", "fcf", "money"),
            row("Gross margin", "gross_margin", "gross_margin", "pct"),
            row("EBITDA margin", "ebitda_margin", "ebitda_margin", "pct"),
            row("Net margin", "net_margin", "net_margin", "pct"),
            row("ROE", "roe", None, "pct"),
            row("Net debt", "net_debt", None, "money"),
        ],
        "note": "History: reported engine metrics (S2), oldest → newest. Forecast columns (italic, tinted): model years S3.",
    }


# --------------------------------------------------------------------------- #
# statement payload (for PDF appendix + excel)
# --------------------------------------------------------------------------- #

LINE_ORDER = [
    "revenue", "cost_of_revenue", "gross_profit", "operating_expense", "operating_income",
    "ebit", "da", "ebitda", "interest_expense", "pretax_income", "tax_expense",
    "net_income", "diluted_eps",
    "total_assets", "current_assets", "cash", "accounts_receivable", "inventory",
    "accounts_payable", "current_liabilities", "total_debt", "ppe_net", "equity", "shares_issued",
    "operating_cash_flow", "capex", "free_cash_flow", "da_cf", "change_in_wc", "dividends_paid",
]

STATEMENT_LABELS = {
    "income_statement": "Income statement",
    "balance_sheet": "Balance sheet",
    "cash_flow": "Cash flow statement",
}


def _statement_payload(rows: list) -> dict[str, Any]:
    periods: list[str] = []
    values: dict[str, dict[str, Any]] = {}
    for row in rows[:6]:
        label = _period_fy(row.get("period_end"))
        if label in periods:
            continue
        periods.append(label)
        items = row.get("items") or {}
        for key, value in items.items():
            values.setdefault(str(key), {})[label] = _finite(value)
    ordered = [key for key in LINE_ORDER if key in values]
    scales = [max((abs(v) for v in values[key].values() if isinstance(v, (int, float))), default=0.0) for key in ordered]
    return {
        "periods": periods,
        "lines": [
            {"key": key, "label": key.replace("_", " ").title(), "values": values[key], "scale": scale}
            for key, scale in zip(ordered, scales)
        ],
    }


def latest_balance_value(annual: dict[str, Any], key: str) -> float | None:
    rows = (annual.get("balance_sheet") or []) or []
    for row in rows[:1]:
        value = _finite((row.get("items") or {}).get(key))
        if value is not None:
            return value
    return None


def first_not_none(*values):
    for value in values:
        if value is not None:
            return value
    return None


def _sub(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    return a - b


def utc_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- #
# quality control
# --------------------------------------------------------------------------- #

def run_qa(payload: dict[str, Any], cfg: dict[str, Any]) -> list[dict[str, str]]:
    """Validate consistency between the report, the model and the engines."""
    issues: list[dict[str, str]] = []

    def add(level: str, check: str, detail: str):
        issues.append({"level": level, "check": check, "detail": detail})

    valuation = payload.get("valuation", {})
    dcf_result = valuation.get("dcf") or {}
    fcf_list_sens = [_finite(value) for value in (valuation.get("fcf") or [])]
    shares_available_sens = bool(_finite(valuation.get("shares")) and _finite(valuation.get("shares")) > 0 and fcf_list_sens and all(v is not None for v in fcf_list_sens))
    target = _finite(dcf_result.get("value_per_share"))
    rating = payload.get("rating") or {}
    displayed_target = _finite(rating.get("target_price"))
    auto_mode = str(rating.get("mode", "")).startswith("apex_default")

    # 1. displayed target reconciliation against an independent DCF re-run
    if target is not None:
        rerun = dcf(
            valuation.get("fcf") or [],
            valuation.get("wacc", 0.1),
            terminal_growth=valuation.get("terminal_growth") if valuation.get("terminal_mode") == "growth" else None,
            exit_multiple=valuation.get("exit_multiple") if valuation.get("terminal_mode") != "growth" else None,
            final_ebitda=max((p.get("ebitda") or 0.0) for p in payload["forecast"]["periods"]) if valuation.get("terminal_mode") != "growth" and payload["forecast"]["periods"] else 0.0,
            net_debt=valuation.get("net_debt") or 0.0,
            shares=valuation.get("shares") or 1.0,
        )
        rerun_target = _finite(rerun.get("value_per_share"))
        if auto_mode and displayed_target is not None and (
            rerun_target is None or abs(rerun_target - displayed_target) > max(0.01, abs(displayed_target) * 1e-6)
        ):
            add("error", "target_reconciliation", f"Displayed target {displayed_target} does not match recomputed DCF {rerun_target}.")
        if not auto_mode and displayed_target is not None and displayed_target != target:
            add("info", "target_reconciliation", f"Analyst target override {displayed_target} is displayed in place of the model value {target} (documented, not an error).")
    else:
        add("warning", "target_reconciliation", "No defensible target price: valuation incomplete or cash flows invalid.")

    # 1b. DCF arithmetic at full internal precision
    if not dcf_result.get("error"):
        fcf = [_finite(value) for value in (valuation.get("fcf") or [])]
        rate = _finite(valuation.get("wacc"))
        if fcf and all(v is not None for v in fcf) and rate is not None:
            recompute_pvs = [value / ((1.0 + rate) ** index) for index, value in enumerate(fcf, start=1)]
            stored_pvs = [_finite(value) for value in (dcf_result.get("pv_cash_flows_by_year") or [])]
            stored_pv = _finite(dcf_result.get("pv_cash_flows"))
            if stored_pv is None or abs(stored_pv - sum(recompute_pvs)) > max(1e-7, abs(stored_pv) * 1e-10):
                add("error", "dcf_pv_sum", "PV of explicit cash flows does not equal the sum of annual present values.")
            if stored_pvs and any(abs(a - b) > max(1e-7, abs(a) * 1e-10) for a, b in zip(stored_pvs, recompute_pvs)):
                add("error", "dcf_yearly_pv", "One or more annual DCF present values do not reconcile.")
            terminal_mode = valuation.get("terminal_mode")
            stored_tv = _finite(dcf_result.get("terminal_value"))
            if terminal_mode == "growth" and stored_tv is not None:
                expected_tv = fcf[-1] * (1 + _finite(valuation.get("terminal_growth") or 0)) / (rate - _finite(valuation.get("terminal_growth") or 0))
                if abs(stored_tv - expected_tv) > max(1e-7, abs(expected_tv) * 1e-10):
                    add("error", "dcf_terminal_value", "Terminal value does not reconcile to perpetuity-growth inputs.")
            stored_ev = _finite(dcf_result.get("enterprise_value"))
            stored_pv_tv = _finite(dcf_result.get("pv_terminal_value"))
            if stored_ev is not None and stored_pv is not None and stored_pv_tv is not None:
                if abs(stored_ev - (stored_pv + stored_pv_tv)) > max(1e-7, abs(stored_ev) * 1e-10):
                    add("error", "dcf_enterprise_value", "Enterprise value does not equal PV of cash flows plus PV of terminal value.")
            stored_net_debt = _finite(dcf_result.get("net_debt"))
            stored_equity = _finite(dcf_result.get("equity_value"))
            if stored_ev is not None and stored_net_debt is not None and stored_equity is not None:
                if abs(stored_equity - (stored_ev - stored_net_debt)) > max(1e-7, abs(stored_equity) * 1e-10):
                    add("error", "equity_bridge", "Equity value does not equal enterprise value minus net debt.")
            stored_shares = _finite(valuation.get("shares"))
            stored_vps = _finite(dcf_result.get("value_per_share"))
            if stored_shares and stored_shares > 0 and stored_vps is not None:
                if abs(stored_vps - stored_equity / stored_shares) > max(1e-7, abs(stored_vps) * 1e-10):
                    add("error", "value_per_share_bridge", "Value per share does not equal equity value divided by shares.")

    # 1c. independently recompute the sensitivity grid
    sens = valuation.get("sensitivity") or {}
    sens_grid = sens.get("table") or []
    if sens_grid and shares_available_sens and fcf_list_sens:
        recomputed = sensitivity_table(
            fcf_list_sens,
            _finite(valuation.get("shares")) or 0.0,
            _finite(valuation.get("net_debt")) or 0.0,
            _finite((payload["forecast"]["periods"][-1] if payload["forecast"]["periods"] else {}).get("ebitda")) or 0.0,
            sens.get("wacc_values") or [],
            sens.get("terminal_values") or [],
            "growth" if valuation.get("terminal_mode") == "growth" else "multiple",
        )
        mismatched_cells = 0
        for row_index, row in enumerate(recomputed):
            stored_row = sens_grid[row_index] if row_index < len(sens_grid) else []
            for col_index, expected in enumerate(row):
                stored = _finite(stored_row[col_index]) if col_index < len(stored_row) else None
                expected_f = _finite(expected)
                if stored is None and expected_f is None:
                    continue
                if stored is None or expected_f is None or abs(stored - expected_f) > max(0.01, abs(expected_f or 0) * 1e-8):
                    mismatched_cells += 1
        if mismatched_cells:
            add("error", "sensitivity_reconciliation", f"{mismatched_cells} sensitivity cells failed an independent DCF re-run.")

    # 1d. reverse-DCF convergence must reproduce the market price
    reverse = valuation.get("reverse_dcf") or {}
    implied_wacc = _finite(reverse.get("implied_wacc"))
    if implied_wacc is not None:
        converged = bool(reverse.get("converged"))
        reproduced = _finite(reverse.get("value_at_implied_wacc"))
        current = _finite((payload.get("price") or {}).get("current"))
        if not converged or reproduced is None or current is None or abs(reproduced - current) > max(0.01, current * 1e-6):
            add("error", "reverse_dcf_convergence", "Reverse-DCF result did not reproduce the observed market price within tolerance.")
    reverse_growth = valuation.get("reverse_dcf_growth") or {}
    implied_growth = _finite(reverse_growth.get("implied_terminal_growth"))
    if implied_growth is not None and not bool(reverse_growth.get("converged")):
        add("error", "reverse_growth_convergence", "Reverse terminal-growth result did not reproduce the observed market price within tolerance.")

    # 1e. scenario prices reconcile to their scenario cash flows
    for name in ("bear", "base", "bull"):
        scenario = (payload.get("scenarios") or {}).get(name) or {}
        scenario_target = _finite(scenario.get("target_price"))
        scenario_fcf = [_finite(value) for value in (scenario.get("fcf") or [])]
        if scenario_target is None:
            continue
        scenario_shares = _finite(valuation.get("shares"))
        if not scenario_shares or scenario_shares <= 0:
            add("error", "scenario_reconciliation", f"{name.capitalize()} scenario publishes a per-share value without a share count.")
            continue
        rerun_scenario = dcf(
            scenario_fcf,
            _finite(scenario.get("wacc")) or 0.10,
            terminal_growth=valuation.get("terminal_growth") if valuation.get("terminal_mode") == "growth" else None,
            exit_multiple=valuation.get("exit_multiple") if valuation.get("terminal_mode") != "growth" else None,
            final_ebitda=_finite((payload["forecast"]["periods"][-1] if payload["forecast"]["periods"] else {}).get("ebitda")) or 0.0,
            net_debt=_finite(valuation.get("net_debt")) or 0.0,
            shares=scenario_shares,
        )
        rerun_target = _finite(rerun_scenario.get("value_per_share"))
        if rerun_target is None or abs(rerun_target - scenario_target) > max(0.01, abs(scenario_target) * 1e-6):
            add("error", "scenario_reconciliation", f"{name.capitalize()} scenario target does not match an independent DCF re-run.")

    # 2. rating consistency with published bands (auto mode)
    upside = _finite(rating.get("upside"))
    code = rating.get("code")
    if code not in (None, "NOT RATED") and upside is not None and str(rating.get("mode", "")).startswith("apex_default"):
        expected = "BUY" if upside >= 0.15 else ("HOLD" if upside >= -0.05 else "SELL")
        if expected != code:
            add("error", "rating_bands", f"Rating {code} inconsistent with upside {upside:+.1%} (expected {expected}).")

    # 3. forecast balance check
    if not payload.get("forecast", {}).get("balance_ok", False):
        add("warning", "balance_reconciliation", "Forecast balance check reported a mismatch; see the response summary for max delta.")

    # 4. currency + period labels
    if not payload.get("meta", {}).get("currency"):
        add("warning", "currency_label", "Currency missing from metadata; figures shown without a unit.")
    if not payload.get("price", {}).get("price_date"):
        add("info", "price_timestamp", "No last-trade date recorded; the cover price is labelled without a timestamp.")

    years = payload["forecast"].get("years")
    if not years:
        add("error", "forecast_horizon", "Forecast built with zero years.")

    # 4b. cover highlights index alignment (guard against label/value drift)
    snap = payload.get("summary_snapshot") or {}
    labels = snap.get("labels") or []
    f_labels = snap.get("forecast_labels") or []
    for r in snap.get("rows") or []:
        if len(r.get("values") or []) != len(labels):
            add("error", "cover_alignment", f"Row '{r.get('label')}' history length {len(r.get('values') or [])} != {len(labels)} labels.")
        if len(r.get("forecast") or []) != len(f_labels):
            add("error", "cover_alignment", f"Row '{r.get('label')}' forecast length {len(r.get('forecast') or [])} != {len(f_labels)} labels.")

    # 4c. forecast internal consistency (revenue path, EPS sign, margins)
    fperiods = payload["forecast"].get("periods") or []
    for p in fperiods:
        rev, ni, sh = _finite(p.get("revenue")), _finite(p.get("net_income")), _finite(p.get("shares"))
        eps = _finite(p.get("eps"))
        if rev is not None and rev <= 0:
            add("warning", "forecast_revenue", f"Forecast year {p.get('year')} has non-positive revenue.")
        if eps is not None and ni is not None and sh:
            if abs(eps - ni / sh) > max(0.01, abs(eps) * 1e-3):
                add("error", "eps_reconciliation", f"Forecast year {p.get('year')} EPS {eps} != net income/shares {ni/sh}.")
        for mk in ("gross_margin", "ebitda_margin", "net_margin"):
            mv = _finite(p.get(mk))
            if mv is not None and (mv < -1 or mv > 1):
                add("warning", "margin_sanity", f"Forecast year {p.get('year')} {mk}={mv:.2%} outside [-100%,100%].")

    # 5. provenance present
    if len(payload.get("sources") or []) < 4:
        add("warning", "provenance", "Source register incomplete.")

    # 5b. valuation input assumptions must be disclosed, not hidden
    if valuation.get("wacc_warnings"):
        add("warning", "valuation_inputs", "; ".join(str(w) for w in valuation.get("wacc_warnings")[:4]))
    for gap in payload.get("forecast", {}).get("model_input_gaps") or []:
        if gap.get("severity") in ("warning", "error"):
            add("warning", "forecast_input_defaults", f"{gap.get('area')}: {gap.get('detail')}")
    if payload.get("valuation", {}).get("net_debt_basis") and "assumption" in str(payload["valuation"]["net_debt_basis"]):
        add("warning", "net_debt_assumption", str(payload["valuation"]["net_debt_basis"]))

    # 6. NaN sanitisation
    def scan(value: Any, path: str) -> None:
        if isinstance(value, float):
            if math.isnan(value) or math.isinf(value):
                add("error", "value_sanitation", f"Non-finite value slipped into payload at {path}.")
        elif isinstance(value, dict):
            for key, item in value.items():
                scan(item, f"{path}.{key}")
        elif isinstance(value, list):
            for index, item in enumerate(value):
                scan(item, f"{path}[{index}]")

    scan(payload, "payload")

    # 7. material data gaps disclosed
    warning_gaps = [g for g in payload.get("gaps", []) if g.get("severity") == "warning"]
    if warning_gaps:
        add("info", "gaps_disclosed", f"{len(warning_gaps)} data gaps disclosed in the source & gaps section.")

    # 8. narrative duplication/placeholder quality
    narrative = payload.get("narrative")
    if narrative:
        repeated = duplicate_sentence_issues(flatten_narrative_text(narrative))
        if repeated:
            add("warning", "narrative_duplication", f"Repeated narrative sentences: {repeated[:3]}")
        for token in ("TODO", "TBD", "{ticker}", "{{ticker}}", "lorem ipsum"):
            if token.lower() in flatten_narrative_text(narrative).lower():
                add("error", "narrative_placeholder", f"Unresolved placeholder '{token}' found in narrative.")
    return issues
