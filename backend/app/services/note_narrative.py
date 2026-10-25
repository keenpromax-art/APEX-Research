"""Narrative support for the short APEX Terminal research note (export PDF).

This module is used only by the small report path (`/api/ai/research` ->
`/api/export/pdf`). It must not be imported by the large institutional report
pipeline (report_engine / report_narrative / pdf_report).

It provides:
- build_facts(): formatted, engine-derived fact strings + numeric domains.
- build_research_messages(): the prompt for the short note.
- validate_report_figures(): flags narrative figures not traceable to engine data.
- figure_correction_message(): one-shot repair instruction for the retry.
"""

from __future__ import annotations

import json
import re
from typing import Any

REPORT_SECTIONS = [
    "executive_summary",
    "business_overview",
    "financial_performance",
    "strengths",
    "risks",
    "catalysts",
    "valuation_view",
    "conclusion",
]

_MAX_WARNINGS = 12


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result or result in (float("inf"), float("-inf")):
        return None
    return result


def _money(value: float | None, currency: str) -> str | None:
    if value is None:
        return None
    sign = "-" if value < 0 else ""
    amount = abs(value)
    code = (currency or "").upper()
    prefix = f"{code} " if code else ""
    if amount >= 1e9:
        return f"{sign}{prefix}{amount / 1e9:,.2f} bn"
    if amount >= 1e6:
        return f"{sign}{prefix}{amount / 1e6:,.2f} m"
    if amount >= 1:
        return f"{sign}{prefix}{amount:,.2f}"
    return f"{sign}{prefix}{amount:,.4f}"


def _pct(value: float | None) -> str | None:
    if value is None:
        return None
    return f"{value * 100:.1f}%"


def _x(value: float | None) -> str | None:
    if value is None:
        return None
    if abs(value) < 0.005:
        return "0.00x (approximately zero)"
    return f"{value:,.2f}x"


def _days(value: float | None) -> str | None:
    if value is None:
        return None
    return f"{value:,.0f} days"


def _fy_label(period_end: Any) -> str | None:
    if not isinstance(period_end, str):
        return None
    match = re.match(r"(\d{4})", period_end)
    if not match:
        return None
    return f"FY{match.group(1)}"


def build_facts(
    ticker: str,
    normalized: dict[str, Any],
    metrics: dict[str, Any],
    note_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    info = normalized.get("info") or {}
    price = normalized.get("price_summary") or {}
    periods = [row for row in (metrics.get("periods") or []) if isinstance(row, dict)]
    latest = periods[0] if periods else {}
    prior = periods[1] if len(periods) > 1 else {}

    currency = str(info.get("currency") or "")
    fy = _fy_label(latest.get("period_end")) or _fy_label(prior.get("period_end"))

    price_close = _num(price.get("last_close"))
    eps = _num(latest.get("eps_diluted"))
    bvps = _num(latest.get("book_value_per_share"))
    market_cap = _num(info.get("marketCap"))
    change = _num(price.get("change"))
    change_pct = _num(price.get("change_pct"))
    dividend_yield = _num(info.get("dividendYield"))
    pe = price_close / eps if price_close is not None and eps not in (None, 0) else None
    pb = price_close / bvps if price_close is not None and bvps not in (None, 0) else None

    def m(value: Any) -> str | None:
        return _money(_num(value), currency)

    high = _num(price.get("high_52w"))
    low = _num(price.get("low_52w"))
    week_range = f"{_money(low, currency)} to {_money(high, currency)}" if high is not None and low is not None else None
    intraday = f"{_money(change, currency)} versus the previous close" if change is not None else None

    pairs: list[tuple[str, str | None]] = [
        ("fiscal_year", fy or "latest fiscal year"),
        ("company", str(info.get("longName") or info.get("shortName") or ticker.upper())),
        ("price", m(price_close)),
        ("previous_close_change_pct", _pct(change_pct)),
        ("intraday_change", intraday),
        ("52_week_range", week_range),
        ("market_cap", m(market_cap)),
        ("currency", currency or "report currency"),
        ("revenue", m(latest.get("revenue"))),
        ("revenue_prior", m(prior.get("revenue"))),
        ("revenue_growth_yoy", _pct(_num(latest.get("revenue_growth")))),
        ("gross_margin", _pct(_num(latest.get("gross_margin")))),
        ("operating_margin", _pct(_num(latest.get("operating_margin")))),
        ("ebitda_margin", _pct(_num(latest.get("ebitda_margin")))),
        ("net_margin", _pct(_num(latest.get("net_margin")))),
        ("net_income", m(latest.get("net_income"))),
        ("net_income_prior", m(prior.get("net_income"))),
        ("eps_diluted", _money(eps, currency)),
        ("operating_cash_flow", m(latest.get("ocf"))),
        ("capex", m(latest.get("capex"))),
        ("free_cash_flow", m(latest.get("fcf"))),
        ("net_debt", m(latest.get("net_debt"))),
        ("net_debt_ebitda", _x(_num(latest.get("net_debt_ebitda")))),
        ("debt_to_equity", _x(_num(latest.get("debt_to_equity")))),
        ("interest_coverage", _x(_num(latest.get("interest_coverage")))),
        ("current_ratio", _x(_num(latest.get("current_ratio")))),
        ("quick_ratio", _x(_num(latest.get("quick_ratio")))),
        ("roa", _pct(_num(latest.get("roa")))),
        ("roe", _pct(_num(latest.get("roe")))),
        ("roic", _pct(_num(latest.get("roic")))),
        ("days_sales_outstanding", _days(_num(latest.get("days_sales_outstanding")))),
        ("days_inventory", _days(_num(latest.get("days_inventory")))),
        ("days_payable", _days(_num(latest.get("days_payable")))),
        ("book_value_per_share", _money(bvps, currency)),
        ("equity", m(latest.get("equity"))),
        ("total_debt", m(latest.get("total_debt"))),
        ("cash", m(latest.get("cash"))),
        ("pe_from_eps", _x(pe)),
        ("pe_reported", _x(_num(info.get("trailingPE")))),
        ("pb_from_book", _x(pb)),
        ("pb_reported", _x(_num(info.get("priceToBook")))),
    ]
    strings = {label: text for label, text in pairs if text}

    money: list[float] = []
    percents: list[float] = []
    multiples: list[float] = []
    days: list[float] = []

    def collect(target: list[float], *values: Any) -> None:
        for value in values:
            number = _num(value)
            if number is not None:
                target.append(number)

    def collect_pct(*values: Any) -> None:
        for value in values:
            number = _num(value)
            if number is not None:
                percents.append(number * 100)

    for row in (latest, prior):
        if not row:
            continue
        collect_pct(
            row.get("revenue_growth"), row.get("gross_margin"), row.get("operating_margin"),
            row.get("ebitda_margin"), row.get("net_margin"), row.get("roa"), row.get("roe"),
            row.get("roic"), row.get("fcf_margin"), row.get("ocf_margin"), row.get("tax_rate"),
        )
        collect(
            multiples,
            row.get("current_ratio"), row.get("quick_ratio"), row.get("debt_to_equity"),
            row.get("net_debt_ebitda"), row.get("interest_coverage"),
        )
        collect(days, row.get("days_sales_outstanding"), row.get("days_inventory"), row.get("days_payable"))

    # Latest period: full balance-sheet and per-share detail. Prior periods:
    # headline flows only (revenue, net income, EBITDA, cash flows). Prior
    # balance-sheet stocks and minor flow lines collide with unrelated claims
    # and are rarely cited in a short note.
    collect(
        money,
        latest.get("revenue"), latest.get("net_income"), latest.get("ebitda"), latest.get("gross_profit"),
        latest.get("ebit"), latest.get("ocf"), latest.get("capex"), latest.get("fcf"), latest.get("equity"),
        latest.get("total_debt"), latest.get("cash"), latest.get("net_debt"), latest.get("eps_diluted"),
        latest.get("book_value_per_share"), latest.get("shares"),
    )
    collect(
        money,
        prior.get("revenue"), prior.get("net_income"), prior.get("ebitda"),
        prior.get("ocf"), prior.get("capex"), prior.get("fcf"),
    )

    collect(
        money,
        price_close, price.get("previous_close"), high, low, eps, bvps, market_cap,
        info.get("sharesOutstanding"), change,
    )
    if dividend_yield is not None:
        percents.append(dividend_yield * 100)
    if change_pct is not None:
        percents.append(change_pct * 100)
    collect(multiples, pe, pb, info.get("trailingPE"), info.get("priceToBook"))

    ambiguous = list(multiples) + [value / 100 for value in percents]
    ambiguous += [value for value in money if abs(value) <= 1e5]

    model_outputs: dict[str, Any] | None = None
    if isinstance(note_payload, dict):
        valuation = note_payload.get("valuation") or {}
        rating = note_payload.get("rating") or {}
        forecast = note_payload.get("forecast") or {}
        labels = list(forecast.get("labels") or [])
        periods_model = list(forecast.get("periods") or [])
        first_model = periods_model[0] if periods_model else {}
        second_model = periods_model[1] if len(periods_model) > 1 else {}
        target = _num(rating.get("target_price"))
        current = _num((note_payload.get("price") or {}).get("current") or (note_payload.get("price") or {}).get("last_close"))
        upside = _num(rating.get("upside"))
        wacc_value = _num(valuation.get("wacc"))
        terminal_growth = _num(valuation.get("terminal_growth"))

        model_pairs: list[tuple[str, str | None]] = [
            ("model_horizon", str(rating.get("horizon") or note_payload.get("horizon") or "12M")),
            ("model_rating", str(rating.get("code") or "NOT RATED")),
            ("model_target_price_e", _money(target, currency)),
            ("model_current_price", _money(current, currency)),
            ("model_implied_upside_e", _pct(upside)),
            ("model_wacc", _pct(wacc_value)),
            ("model_terminal_growth", _pct(terminal_growth)),
            ("model_forecast_label_1", str(labels[0]) + "E" if labels and not str(labels[0]).endswith("E") else str(labels[0]) if labels else None),
            ("model_forecast_revenue_1_e", m(first_model.get("revenue"))),
            ("model_forecast_revenue_growth_1_e", _pct(_num(first_model.get("revenue_growth")))),
            ("model_forecast_ebitda_1_e", m(first_model.get("ebitda"))),
            ("model_forecast_net_income_1_e", m(first_model.get("net_income"))),
            ("model_forecast_fcf_1_e", m(first_model.get("fcf"))),
            ("model_forecast_label_2", str(labels[1]) + "E" if len(labels) > 1 and not str(labels[1]).endswith("E") else str(labels[1]) if len(labels) > 1 else None),
            ("model_forecast_revenue_2_e", m(second_model.get("revenue"))),
            ("model_forecast_fcf_2_e", m(second_model.get("fcf"))),
            ("model_fcf_1_e", m(_num((valuation.get("fcf") or [None])[0]))),
        ]
        strings.update({key: text for key, text in model_pairs if text})
        strings["forecast_status"] = (
            "model estimates marked E; they are not company guidance"
            if periods_model else
            "no deterministic forecast is available for this company"
        )

        collect(
            money,
            target, current, first_model.get("revenue"), first_model.get("ebitda"),
            first_model.get("net_income"), first_model.get("fcf"),
            second_model.get("revenue"), second_model.get("fcf"),
            (_num((valuation.get("fcf") or [None])[0])),
        )
        collect_pct(upside, wacc_value, terminal_growth, first_model.get("revenue_growth"))
        ambiguous.extend([v for v in (target, current, upside, wacc_value, terminal_growth) if v is not None])

        model_outputs = {
            "rating": rating,
            "valuation": valuation,
            "forecast": forecast,
            "provenance_note": (
                "Rating, target price, forecast and valuation outputs are deterministic model estimates; "
                "historical statement figures are reported or engine-calculated actuals."
            ),
        }

    return {
        "strings": strings,
        "domains": {
            "money": money,
            "percents": percents,
            "multiples": multiples,
            "days": days,
            "ambiguous": ambiguous,
        },
        "model_outputs": model_outputs,
    }


def build_research_messages(
    ticker: str,
    normalized: dict[str, Any],
    metrics: dict[str, Any],
    note_payload: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    info = normalized.get("info") or {}
    periods = (metrics.get("periods") or [])[:5]
    facts = build_facts(ticker, normalized, metrics, note_payload)
    verified = {
        "ticker": ticker.upper(),
        "company": info.get("longName") or info.get("shortName"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "country": info.get("country"),
        "currency": info.get("currency"),
        "market_cap": info.get("marketCap"),
        "price_summary": normalized.get("price_summary"),
        "metrics_most_recent_first": periods,
        "data_quality": normalized.get("data_quality"),
        "demo_data": bool(normalized.get("demo")),
    }
    facts_block = json.dumps(facts["strings"], indent=2, default=str)
    model_note = ""
    if facts.get("model_outputs"):
        model_note = (
            "MODEL OUTPUTS (deterministic, labelled estimates):\n"
            + json.dumps(facts["model_outputs"], indent=2, default=str)
            + "\n\nThese are APEX model estimates marked E. Quote them as estimates, never as reported actuals.\n\n"
        )
    prompt = (
        "You are a rigorous institutional equity research analyst. Write a concise, decision-useful "
        f"research note for {ticker.upper()} using ONLY the verified data, FACTS and MODEL OUTPUTS below.\n\n"
        f"VERIFIED DATA:\n{json.dumps(verified, indent=2, default=str)}\n\n"
        f"FACTS (use these exact strings, with their signs and units, whenever you cite a figure):\n{facts_block}\n\n"
        + model_note
        + "Rules:\n"
        "- Quote every figure from the FACTS or MODEL OUTPUTS blocks verbatim. Never recompute, re-round, "
        "convert units, or derive a new ratio. If a figure is not available there, do not state it numerically.\n"
        "- Label reported actuals with their fiscal year (e.g. FY2026). Label every model value as an estimate "
        "(E) and never cite it as reported fact or company guidance.\n"
        "- Never invent news, consensus, guidance, target prices, events, market share or financial figures.\n"
        "- Every quantitative claim must trace to VERIFIED DATA, FACTS or MODEL OUTPUTS.\n"
        "- If evidence is missing, say so explicitly rather than filling the gap.\n"
        "- Make the thesis specific to this company's actual results and model outputs. Avoid generic phrases.\n"
        "- Explain mechanisms: what metric changes, why, and what it does to the valuation or rating.\n"
        "- Distinguish evidence from inference and keep a balanced, non-promotional tone.\n"
        "- The DEMO fixture is synthetic; label it clearly as demo analysis.\n"
        "- Use plain ASCII hyphen-minus '-' for hyphenated terms.\n\n"
        "Return valid JSON only. Required keys: "
        + ", ".join(REPORT_SECTIONS)
        + ". Optional keys: investment_thesis, forecast_assumptions, monitoring, sources_limitations, confidence. "
        "Use strings for prose and arrays of strings for strengths, risks, catalysts, investment_thesis, "
        "forecast_assumptions, monitoring and sources_limitations."
    )
    return [
        {
            "role": "system",
            "content": "You are a rigorous equity research analyst. Return valid JSON only, with no markdown fences.",
        },
        {"role": "user", "content": prompt},
    ]


_CURRENCY = r"(?:INR|Rs\.?|\u20b9)"
_NUM = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d+"
_SCALES = {"bn": 1e9, "billion": 1e9, "mn": 1e6, "mm": 1e6, "million": 1e6, "m": 1e6}

_MONEY_RE = re.compile(
    rf"(?:(?P<sign1>-)\s*)?(?P<cur>{_CURRENCY}\s*)?(?:(?P<sign2>-)\s*)?(?P<num>{_NUM})"
    rf"\s*(?P<unit>bn|billion|mn|mm|million|m)?(?![%\w])"
)
_PCT_RE = re.compile(rf"(?P<num>{_NUM})\s*%")
_X_RE = re.compile(rf"(?<![\w.])(?P<sign>-)?\s*(?P<num>{_NUM})\s*[x\u00d7](?![\w])")
_DAYS_RE = re.compile(rf"(?<![\w.])(?P<sign>-)?\s*(?P<num>{_NUM})\s*days?\b", re.IGNORECASE)
_BARE_DEC_RE = re.compile(r"(?<![\w,.])(?P<num>-?\d+\.\d+)(?![\w,])")
_BARE_COMMA_RE = re.compile(r"(?<![\w.])(?P<num>-?\d{1,3}(?:,\d{3})+)(?![\w,])")


def _to_float(raw: str) -> float | None:
    try:
        return float(raw.replace(",", ""))
    except ValueError:
        return None


def _close(value: float, target: float, *, rel: float, abs_tol: float) -> bool:
    return abs(value - target) <= max(abs(target) * rel, abs_tol)


def _scan_units(text: str, domains: dict[str, list[float]]) -> tuple[list[str], list[tuple[int, int]]]:
    """Flag unit-tagged figures with no verified match; return flags + claimed spans."""
    flags: list[str] = []
    claimed: list[tuple[int, int]] = []
    money = domains["money"]
    percents = domains["percents"]
    multiples = domains["multiples"]
    day_values = domains["days"]

    for match in _PCT_RE.finditer(text):
        claimed.append(match.span())
        value = _to_float(match.group("num"))
        if value is None:
            continue
        if not any(abs(abs(value) - abs(target)) <= 0.6 for target in percents):
            flags.append(match.group(0))

    for match in _X_RE.finditer(text):
        claimed.append(match.span())
        value = _to_float(match.group("num"))
        if value is None:
            continue
        if match.group("sign"):
            value = -value
        if not any(_close(value, target, rel=0.12, abs_tol=0.05) for target in multiples):
            flags.append(match.group(0))

    for match in _DAYS_RE.finditer(text):
        claimed.append(match.span())
        value = _to_float(match.group("num"))
        if value is None:
            continue
        if match.group("sign"):
            value = -value
        if not any(_close(value, target, rel=0.10, abs_tol=1.0) for target in day_values):
            flags.append(match.group(0))

    for match in _MONEY_RE.finditer(text):
        unit = (match.group("unit") or "").lower()
        has_currency = bool(match.group("cur"))
        if not unit and not has_currency:
            continue
        claimed.append(match.span())
        value = _to_float(match.group("num"))
        if value is None:
            continue
        sign = -1.0 if (match.group("sign1") or match.group("sign2")) else 1.0
        raw = value * sign * _SCALES.get(unit, 1.0)
        if not any(_close(raw, target, rel=0.02, abs_tol=0.02) for target in money):
            flags.append(match.group(0))

    return flags, claimed


def validate_report_figures(report: dict[str, Any], facts: dict[str, Any]) -> list[str]:
    """Flag narrative figures that cannot be traced to engine-derived facts."""
    raw_domains = facts.get("domains") or {}
    if not raw_domains:
        return []
    domains = {
        "money": [float(value) for value in raw_domains.get("money") or []],
        "percents": [float(value) for value in raw_domains.get("percents") or []],
        "multiples": [float(value) for value in raw_domains.get("multiples") or []],
        "days": [float(value) for value in raw_domains.get("days") or []],
    }
    ambiguous = [float(value) for value in raw_domains.get("ambiguous") or []]

    warnings: list[str] = []
    for key in REPORT_SECTIONS:
        content = report.get(key)
        if isinstance(content, str):
            chunks = [content]
        elif isinstance(content, (list, tuple)):
            chunks = [str(item) for item in content]
        else:
            continue
        for chunk in chunks:
            text = chunk.replace("\u2212", "-")
            unit_flags, claimed = _scan_units(text, domains)
            for label in unit_flags:
                warnings.append(f'{key}: unverified figure "{label}"')
            for match in _BARE_DEC_RE.finditer(text):
                if any(start <= match.start() < end for start, end in claimed):
                    continue
                value = _to_float(match.group("num"))
                if value is None:
                    continue
                if not any(_close(value, target, rel=0.03, abs_tol=0.005) for target in ambiguous):
                    warnings.append(f'{key}: unverified figure "{match.group(0)}"')
            for match in _BARE_COMMA_RE.finditer(text):
                if any(start <= match.start() < end for start, end in claimed):
                    continue
                value = _to_float(match.group("num"))
                if value is None:
                    continue
                if not any(_close(value, target, rel=0.02, abs_tol=0.02) for target in domains["money"]):
                    warnings.append(f'{key}: unverified figure "{match.group(0)}"')
            if len(warnings) >= _MAX_WARNINGS:
                return warnings[:_MAX_WARNINGS]
    return warnings


def figure_correction_message(warnings: list[str]) -> dict[str, str]:
    listed = "; ".join(warnings[:_MAX_WARNINGS])
    return {
        "role": "user",
        "content": (
            "Your previous answer cited figures that are not in the FACTS block: "
            f"{listed}.\n"
            "Rewrite the complete JSON note using ONLY the FACTS strings verbatim (same sign and unit). "
            "Remove any unverified figure or replace it with a qualitative statement. "
            "Return valid JSON only with the same keys."
        ),
    }
