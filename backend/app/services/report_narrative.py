from __future__ import annotations

"""AI narrative stage of the research pipeline.

The model receives a compact, verified snapshot of the deterministic payload
and writes only qualitative interpretation sections. It is never allowed to
introduce figures: the prompt restricts it, and the PDF tags every narrative
block as AI-assisted. Narrative failure never blocks the report — it degrades
gracefully to a fully deterministic document with a warning.
"""

import json
from typing import Any

NARRATIVE_SECTIONS = [
    "business_overview",
    "competitive_position",
    "earnings_commentary",
    "investment_thesis",
    "bull_case",
    "base_case",
    "bear_case",
    "earnings_quality",
    "key_questions",
    "conclusion",
]

SECTION_TITLES = {
    "business_overview": "Business overview",
    "competitive_position": "Competitive position and moat",
    "earnings_commentary": "Earnings commentary",
    "investment_thesis": "Investment thesis",
    "bull_case": "Bull case",
    "base_case": "Base case",
    "bear_case": "Bear case",
    "earnings_quality": "Earnings quality and cash conversion",
    "key_questions": "Key unresolved questions",
    "conclusion": "Conclusion",
}

_PROVENANCE_KEYS = (
    "revenue", "revenue_growth", "gross_margin", "operating_margin", "net_margin",
    "ebitda_margin", "ebit", "ebitda", "eps_diluted", "roe", "roa", "roic",
    "current_ratio", "net_debt", "book_value_per_share", "fcf", "ocf",
    "cash_conversion", "capex_intensity", "days_sales_outstanding",
    "days_inventory", "days_payable", "interest_coverage", "debt_to_equity",
)


def _snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    metrics = payload.get("historical", {}).get("metrics") or []
    trimmed_metrics = [
        {key: row.get(key) for key in ("period_end", *_PROVENANCE_KEYS) if key in row or key == "period_end"}
        for row in metrics[:5]
    ]
    valuation = payload.get("valuation", {})
    dcf_result = valuation.get("dcf") or {}
    snapshot = {
        "ticker": payload.get("ticker"),
        "meta": payload.get("meta"),
        "price": {key: payload["price"].get(key) for key in ("current", "change_pct", "low_52w", "high_52w")},
        "metrics_most_recent_first": trimmed_metrics,
        "forecast": {
            "years": payload.get("forecast", {}).get("years"),
            "base_period": payload.get("forecast", {}).get("base_period"),
            "assumptions_engine_assigned": payload.get("forecast", {}).get("assumptions", {}).get("values"),
            "analyst_overrides": payload.get("forecast", {}).get("assumptions", {}).get("overrides"),
            "summary": payload.get("forecast", {}).get("summary"),
        },
        "valuation": {
            "method": valuation.get("method"),
            "wacc": valuation.get("wacc"),
            "terminal_mode": valuation.get("terminal_mode"),
            "terminal_growth": valuation.get("terminal_growth"),
            "exit_multiple": valuation.get("exit_multiple"),
            "net_debt": valuation.get("net_debt"),
            "shares": valuation.get("shares"),
            "fcf_by_forecast_year": valuation.get("fcf"),
            "dcf_result": {key: dcf_result.get(key) for key in ("pv_cash_flows", "terminal_value", "pv_terminal_value", "enterprise_value", "equity_value", "value_per_share", "warnings")},
            "reverse_dcf": valuation.get("reverse_dcf"),
        },
        "scenarios": payload.get("scenarios"),
        "rating": payload.get("rating"),
        "market_context": {
            "multiples": (payload.get("market_context") or {}).get("multiples"),
            "peers": (payload.get("market_context") or {}).get("peers"),
            "operating_drivers": (payload.get("market_context") or {}).get("operating_drivers"),
        },
        "quarterly": {
            "periods": payload.get("historical", {}).get("quarterly_periods"),
            "metrics": (payload.get("historical", {}).get("quarterly_metrics") or [])[:4],
        },
        "data_gaps": payload.get("gaps"),
        "data_quality": payload.get("data_quality"),
    }
    return json.loads(json.dumps(snapshot, default=str))


def build_messages(payload: dict[str, Any]) -> list[dict[str, str]]:
    snapshot = _snapshot(payload)
    ticker = payload.get("ticker", "")
    system = (
        "You are an institutional equity research analyst at APEX Research. "
        "You write the narrative sections of a broker-style research note. "
        "You are given VERIFIED ANALYTICAL DATA produced by deterministic engines. "
        "Rules that cannot be broken: "
        "(1) Never state a number that is not in the verified data; when quoting figures, use exactly those from the data. "
        "(2) Never invent guidance, events, analyst estimates, peer data or dates. "
        "(3) Note explicitly when the data is a synthetic demo fixture or flagged stale. "
        "(4) Keep a balanced analyst tone; avoid promotional language. "
        "(5) You may not compute or change any valuation output — quote the engines' outputs as given. "
        "Return valid JSON only, no markdown fences."
    )
    user = (
        f"Write the narrative sections of a research note for {ticker}.\n\n"
        f"VERIFIED ANALYTICAL DATA:\n{json.dumps(snapshot, indent=2, default=str)}\n\n"
        "Return a JSON object with exactly these keys (strings or arrays of short strings):\n"
        + ", ".join(NARRATIVE_SECTIONS)
        + "\n\nGuidance: business_overview and competitive_position describe the business and its moat; "
        "earnings_commentary interprets the historical metrics; investment_thesis states the core argument "
        "grounded in the engines' valuation; bull/base/bear cases mirror the scenario table; earnings_quality "
        "comments on cash conversion and balance-sheet strength; key_questions lists what the data cannot answer; "
        "conclusion summarises in 2-3 sentences. Label the demo fixture as synthetic if demo=true."
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def parse_narrative(content: str) -> dict[str, Any] | None:
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text[:-3]
    start, end = text.find("{"), text.rfind("}")
    candidate = text[start : end + 1] if start >= 0 and end > start else text
    try:
        parsed = json.loads(candidate)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    narrative: dict[str, Any] = {}
    for key in NARRATIVE_SECTIONS:
        if key not in parsed:
            continue
        value = parsed[key]
        if isinstance(value, list):
            narrative[key] = [str(item)[:400] for item in value[:8]]
        elif isinstance(value, str):
            narrative[key] = value.strip()[:4000]
    narrative["__raw__"] = text[:2000] if not narrative else None
    narrative.pop("__raw__", None)
    return narrative or None


def narrative_warnings(narrative: dict[str, Any] | None) -> list[str]:
    if not narrative:
        return ["AI narrative unavailable; the report contains deterministic content only."]
    missing = [key for key in NARRATIVE_SECTIONS if key not in narrative]
    if missing:
        return ["AI narrative incomplete; missing sections: " + ", ".join(missing)]
    return []


def generate_narrative(gateway, cfg, payload: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    """Call the AI gateway for the narrative stage and fail gracefully.

    Returns (narrative | None, warnings). A failure never raises: the caller
    should proceed with a fully deterministic report and attach the warnings.
    """
    if cfg is None or gateway is None:
        return None, ["No AI model configured; the report contains deterministic content only."]
    try:
        content = gateway.generate(
            cfg,
            build_messages(payload),
            temperature=0.3,
            max_tokens=2600,
            timeout=150.0,
            json_mode=True,
        )
    except Exception as exc:  # noqa: BLE001 - degrade with a warning
        return None, [f"AI narrative stage failed ({exc}); deterministic content only."]
    narrative = parse_narrative(content)
    if narrative is None:
        return None, ["AI narrative returned unparseable output; deterministic content only."]
    return narrative, narrative_warnings(narrative)
