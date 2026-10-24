from __future__ import annotations

"""AI narrative stage of the research pipeline.

The model works as an analyst interpreting verified financial evidence, never
as a calculator. A deterministic evidence pack (Stage A) is prepared from the
payload; the model returns a structured JSON report schema covering company
understanding, historical analysis, thesis, forecast assessment, valuation
interpretation and conclusion (Stages B–G in one validated call, with a
constrained per-group retry on failure). All figures must trace to the evidence
pack; every significant conclusion follows Observation → Evidence →
Interpretation → Investment implication. Narrative failure never blocks the
report — it degrades to a fully deterministic document with warnings.
"""

import json
import re
from typing import Any

# --------------------------------------------------------------------------- #
# structured schema
# --------------------------------------------------------------------------- #

NARRATIVE_SCHEMA: dict[str, Any] = {
    "company_analysis": {
        "required": ["business_model", "industry_structure", "competitive_position"],
        "optional": ["moat_evidence", "moat_limits", "structural_trends"],
    },
    "financial_analysis": {
        "required": ["revenue_story", "margin_story", "cash_conversion", "balance_sheet_view"],
        "optional": ["earnings_quality", "observations", "inconsistencies"],
    },
    "thesis": {
        "required": ["core_question", "central_thesis", "value_drivers", "invalidators"],
        "optional": ["market_overlooking", "catalysts", "leading_indicators", "open_questions"],
    },
    "forecast_review": {
        "required": ["driver_summary", "reasonableness"],
        "optional": ["stretch_assumptions", "valuation_consequences"],
    },
    "valuation_interpretation": {
        "required": ["fair_value_view"],
        "optional": ["value_driver_commentary", "terminal_dependence", "peer_context", "key_limitations"],
    },
    "conclusion": {
        "required": ["summary"],
        "optional": ["balanced_view", "what_would_change_the_view"],
    },
    "risks": "list",
    "limitations": "list",
    "confidence": "low|medium|high",
}

GROUP_KEYS = (
    "company_analysis",
    "financial_analysis",
    "thesis",
    "forecast_review",
    "valuation_interpretation",
    "conclusion",
)

# Legacy flat keys the PDF layer still reads (aliases derived after validation).
LEGACY_KEYS = (
    "business_overview", "competitive_position", "earnings_commentary",
    "investment_thesis", "bull_case", "base_case", "bear_case",
    "earnings_quality", "key_questions", "conclusion", "key_risks",
    "catalysts", "limitations", "earnings_review",
)

SECTOR_MODULES = {
    "financial": {
        "keywords": ("bank", "insurance", "financial", "credit", "asset management", "capital market"),
        "emphasis": (
            "For a financial company, prioritise net interest margin or fee income mix, asset quality and "
            "credit costs where disclosed, capital adequacy, deposit or funding mix, and underwriting discipline. "
            "Skip industrial working-capital commentary unless the data actually supports it."
        ),
    },
    "energy": {
        "keywords": ("oil", "gas", "energy", "petroleum", "renewable"),
        "emphasis": (
            "For an energy company, prioritise production volumes, realised pricing vs benchmarks, reserve life, "
            "finding and development costs, and capital discipline where the data supports it."
        ),
    },
    "consumer": {
        "keywords": ("consumer", "retail", "apparel", "beverage", "food", "restaurant", "luxury"),
        "emphasis": (
            "For a consumer business, prioritise volume vs price growth, same-store or like-for-like metrics where "
            "disclosed, distribution breadth, brand/pricing power evidence, and inventory turns."
        ),
    },
    "software": {
        "keywords": ("software", "saas", "information technolog", "internet", "cloud", "digital"),
        "emphasis": (
            "For a software or platform business, prioritise recurring-revenue evidence, retention or churn where "
            "disclosed, customer acquisition efficiency, operating leverage, and growth efficiency (growth per unit of spend)."
        ),
    },
    "industrial": {
        "keywords": ("industrial", "machinery", "manufactur", "engineering", "construction", "aerospace", "defence", "automotive"),
        "emphasis": (
            "For an industrial or capital-goods business, prioritise order book or backlog where disclosed, capacity "
            "and utilisation evidence, operating leverage, working-capital intensity, and capital expenditure cycles."
        ),
    },
}


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _pct(value: Any, digits: int = 1) -> str:
    number = _finite(value)
    return "n/a" if number is None else f"{number * 100:.{digits}f}%"


def _money(value: Any, currency: str = "USD") -> str:
    number = _finite(value)
    if number is None:
        return "n/a"
    symbols = {"USD": "$", "INR": "₹", "EUR": "€", "GBP": "£", "JPY": "¥"}
    symbol = symbols.get(currency.upper(), "")
    abs_value = abs(number)
    sign = "-" if number < 0 else ""
    if abs_value >= 1e12:
        return f"{sign}{symbol}{abs_value / 1e12:.2f}T"
    if abs_value >= 1e9:
        return f"{sign}{symbol}{abs_value / 1e9:.2f}B"
    if abs_value >= 1e6:
        return f"{sign}{symbol}{abs_value / 1e6:.1f}M"
    if abs_value >= 1e3:
        return f"{sign}{symbol}{abs_value / 1e3:.1f}k"
    return f"{sign}{symbol}{abs_value:,.2f}"


def _num(value: Any, digits: int = 2) -> str:
    number = _finite(value)
    return "n/a" if number is None else f"{number:,.{digits}f}"


def detect_industry_module(meta: dict[str, Any]) -> tuple[str, str]:
    """Pick the industry emphasis from sector/industry text; default industrial-neutral."""
    text = f"{meta.get('sector') or ''} {meta.get('industry') or ''}".lower()
    for name, module in SECTOR_MODULES.items():
        if any(keyword in text for keyword in module["keywords"]):
            return name, module["emphasis"]
    return "general", (
        "Choose the operating drivers that the disclosed data actually supports (for example margin structure, "
        "cash conversion, capital intensity, leverage); do not force industry-specific metrics that are absent."
    )


# --------------------------------------------------------------------------- #
# Stage A — evidence preparation
# --------------------------------------------------------------------------- #

_PROVENANCE_KEYS = (
    "revenue", "revenue_growth", "gross_profit", "gross_margin", "ebitda", "ebitda_margin",
    "ebit", "operating_margin", "net_income", "net_margin", "eps_diluted", "roe", "roa", "roic",
    "current_ratio", "quick_ratio", "net_debt", "net_debt_ebitda", "debt_to_equity",
    "book_value_per_share", "fcf", "ocf", "capex", "cash_conversion", "capex_intensity",
    "fcf_margin", "interest_coverage", "asset_turnover", "days_sales_outstanding",
    "days_inventory", "days_payable", "equity", "total_debt", "cash", "total_assets",
)


def build_evidence_pack(payload: dict[str, Any]) -> dict[str, Any]:
    """Stage A: a clean, label-oriented analytical dataset for the analyst model."""
    meta = payload.get("meta") or {}
    price = payload.get("price") or {}
    historical = payload.get("historical") or {}
    metrics = historical.get("metrics") or []
    periods = historical.get("periods") or []
    valuation = payload.get("valuation") or {}
    dcf = valuation.get("dcf") or {}
    forecast = payload.get("forecast") or {}
    currency = str(meta.get("currency") or "USD")

    def row_with_labels(rows: list[dict], labels: list[str]) -> list[dict]:
        out = []
        for index, row in enumerate(rows):
            entry = {"period": labels[index] if index < len(labels) else str(row.get("period_end") or "")[:10]}
            for key in _PROVENANCE_KEYS:
                if key in row and row.get(key) is not None:
                    entry[key] = row.get(key)
            out.append(entry)
        return out

    wacc_meta = valuation.get("wacc_meta") or {}
    evidence = {
        "company": {
            "ticker": payload.get("ticker"),
            "name": meta.get("name"),
            "exchange": meta.get("exchange"),
            "currency": currency,
            "sector": meta.get("sector"),
            "industry": meta.get("industry"),
            "country": meta.get("country"),
            "employees": meta.get("employees"),
            "website": meta.get("website"),
            "business_summary_from_source": (str(meta.get("summary") or "")[:900] or None),
            "fiscal_latest_period_end": str((metrics[0].get("period_end") if metrics else "") or "")[:10],
            "is_demo_fixture": bool(meta.get("demo") or (payload.get("data_quality") or {}).get("demo")),
        },
        "market": {
            "price": price.get("current"),
            "price_date": str(price.get("price_date") or "")[:10],
            "change_pct": price.get("change_pct"),
            "low_52w": price.get("low_52w"),
            "high_52w": price.get("high_52w"),
            "market_cap": meta.get("market_cap"),
            "shares": meta.get("shares"),
            "dividend": price.get("dividend"),
        },
        "historical_annual_oldest_to_newest": row_with_labels(metrics[::-1], periods[::-1]),
        "historical_annual_note": "Reported figures as normalised from the data source. Order is oldest to newest.",
        "quarterly_recent_first": row_with_labels(
            (historical.get("quarterly_metrics") or [])[:4],
            (historical.get("quarterly_periods") or [])[:4],
        ),
        "forecast": {
            "years": forecast.get("years"),
            "base_period": forecast.get("base_period"),
            "labels": forecast.get("labels"),
            "assumptions_engine_assigned": (forecast.get("assumptions") or {}).get("values"),
            "analyst_overrides_applied": (forecast.get("assumptions") or {}).get("overrides"),
            "projected_periods": [
                {k: p.get(k) for k in (
                    "revenue", "revenue_growth", "ebitda", "ebitda_margin", "ebit_margin",
                    "net_income", "eps", "ocf", "capex", "fcf", "cash", "debt", "dividends",
                ) if p.get(k) is not None}
                for p in (forecast.get("periods") or [])
            ],
            "provenance_note": (
                "Every projected figure is produced by the deterministic APEX forecast engine from the "
                "listed assumptions; these are model outputs, not company guidance."
            ),
        },
        "valuation": {
            "method": valuation.get("method"),
            "rationale": valuation.get("rationale"),
            "wacc": valuation.get("wacc"),
            "wacc_mode": wacc_meta.get("mode"),
            "terminal_mode": valuation.get("terminal_mode"),
            "terminal_growth": valuation.get("terminal_growth"),
            "exit_multiple": valuation.get("exit_multiple"),
            "net_debt_used": valuation.get("net_debt"),
            "shares_used": valuation.get("shares"),
            "fcf_by_year": valuation.get("fcf"),
            "dcf": {k: dcf.get(k) for k in (
                "pv_cash_flows", "terminal_value", "pv_terminal_value", "enterprise_value",
                "net_debt", "equity_value", "value_per_share", "cash_flow_count",
            )},
            "terminal_value_share_of_ev": (
                (dcf.get("pv_terminal_value") / dcf.get("enterprise_value"))
                if _finite(dcf.get("enterprise_value")) and _finite(dcf.get("pv_terminal_value"))
                and dcf.get("enterprise_value")
                else None
            ),
            "reverse_dcf": valuation.get("reverse_dcf"),
            "sensitivity_note": (
                "A 5x5 WACC × terminal-parameter sensitivity grid is published in the report; "
                "quote conclusions from it rather than inventing alternative scenarios."
            ),
        },
        "scenarios": payload.get("scenarios"),
        "rating": payload.get("rating"),
        "market_context": {
            "multiples": (payload.get("market_context") or {}).get("multiples"),
            "peers": (payload.get("market_context") or {}).get("peers"),
            "operating_drivers": (payload.get("market_context") or {}).get("operating_drivers"),
        },
        "data_quality": {
            "alerts": (payload.get("data_quality") or {}).get("alerts"),
            "retrieved_at": (payload.get("data_quality") or {}).get("retrieved_at"),
            "stale": (payload.get("data_quality") or {}).get("stale"),
            "gaps": payload.get("gaps"),
        },
        "sources": [
            {k: s.get(k) for k in ("ref", "label", "where", "retrieved_at") if s.get(k)}
            for s in (payload.get("sources") or [])[:10]
        ],
        "formatting_reference": {
            "money_example": _money(metrics[0].get("revenue"), currency) if metrics else "$1.23B",
            "pct_example": _pct((metrics[0] or {}).get("net_margin")),
            "note": "Quote figures using the units and precision of these examples when referring to the data.",
        },
    }
    return json.loads(json.dumps(evidence, default=str))


# --------------------------------------------------------------------------- #
# Stage B–G — prompt construction
# --------------------------------------------------------------------------- #

def _rules_block(evidence: dict[str, Any]) -> str:
    demo_line = (
        "THIS REPORT USES A SYNTHETIC DEMO FIXTURE. Label it as synthetic wherever you characterise the business."
        if (evidence.get("company") or {}).get("is_demo_fixture")
        else "Use the data as given; if something material is absent, say the data cannot answer it."
    )
    return (
        "You are an institutional equity research analyst at APEX Research interpreting VERIFIED ANALYTICAL EVIDENCE "
        "produced by deterministic engines. Non-negotiable rules:\n"
        "(1) Never state a number that is not in the evidence pack; when you quote a figure, copy it exactly.\n"
        "(2) Never invent guidance, events, segment splits, analyst estimates, consensus, positioning or dates.\n"
        "(3) Never claim a moat without evidence; state the evidence and its limits.\n"
        "(4) Do not assert what 'the market' believes unless the reverse-DCF or scenario data supports the statement.\n"
        "(5) Every significant conclusion must follow Observation → Evidence → Interpretation → Investment implication.\n"
        "(6) You may not compute or change any valuation output; quote the engines' outputs as given.\n"
        "(7) Missing data is disclosed, never estimated or zero-filled.\n"
        f"(8) {demo_line}\n"
        "(9) Keep a balanced, non-promotional analyst tone.\n"
        "Return valid JSON only, no markdown fences."
    )


def build_messages(payload: dict[str, Any], only_groups: list[str] | None = None, validation_errors: list[str] | None = None) -> list[dict[str, str]]:
    evidence = build_evidence_pack(payload)
    meta = payload.get("meta") or {}
    ticker = payload.get("ticker", "")
    module_name, module_emphasis = detect_industry_module(meta)

    schema_spec = {
        "company_analysis": {
            "business_model": "string — how the company makes money, grounded in the source summary and scale data",
            "industry_structure": "string — industry logic only where the evidence supports it; otherwise say the data is insufficient",
            "competitive_position": "string — positioning and barriers, evidence-based",
            "moat_evidence": "array of strings — concrete evidence for competitive advantages",
            "moat_limits": "array of strings — limits of that evidence / counter-evidence",
            "structural_trends": "array of strings — only trends inferable from the disclosed data",
        },
        "financial_analysis": {
            "revenue_story": "string — growth path, its sources where inferable, deceleration or acceleration",
            "margin_story": "string — gross/EBITDA/EBIT/net margin trends and incremental profitability",
            "cash_conversion": "string — OCF/FCF vs earnings, working capital, conversion trend",
            "balance_sheet_view": "string — leverage, coverage, liquidity, resilience",
            "earnings_quality": "string — sustainability and quality of reported earnings",
            "observations": "array of objects {observation, evidence, interpretation, implication} — the core analytic units",
            "inconsistencies": "array of strings — material inconsistencies or accounting-quality concerns, or []",
        },
        "thesis": {
            "core_question": "string — the single question this investment answers",
            "central_thesis": "string — the company-specific argument, 3-6 sentences",
            "value_drivers": "array of strings — fundamental drivers of future value",
            "market_overlooking": "string — only if the evidence (e.g. reverse DCF gap) supports it, else empty string",
            "catalysts": "array of objects {item, horizon} — evidence-grounded catalysts with time horizons",
            "invalidators": "array of strings — what would invalidate the thesis",
            "leading_indicators": "array of strings — what to monitor each quarter",
            "open_questions": "array of strings — unresolved questions requiring further diligence",
        },
        "forecast_review": {
            "driver_summary": "string — what drives the engine's revenue, margin, capex and working-capital paths",
            "reasonableness": "string — whether assumptions look conservative or aggressive versus the reported history",
            "stretch_assumptions": "array of strings — assumptions needing notable improvement or deterioration versus history",
            "valuation_consequences": "string — which assumptions most move fair value, using the sensitivity evidence",
        },
        "valuation_interpretation": {
            "fair_value_view": "string — price vs fair value, upside/downside, what the DCF rests on",
            "value_driver_commentary": "string — which cash flows and parameters drive most of the value",
            "terminal_dependence": "string — terminal-value share commentary using the evidence figure",
            "peer_context": "string — peer multiples comparison only when peer rows exist, else empty string",
            "key_limitations": "array of strings — valuation uncertainties",
        },
        "conclusion": {
            "summary": "string — 3-5 sentences reconciling fundamentals, trajectory, valuation and risks",
            "balanced_view": "string — what must go right vs wrong",
            "what_would_change_the_view": "array of strings — concrete falsifiers or re-rating triggers",
        },
        "risks": "array of strings — 4-6 principal, company-specific risks",
        "limitations": "array of strings — data and method limitations for this report",
        "confidence": "one of low|medium|high — your confidence given the evidence completeness",
    }
    if only_groups:
        schema_spec = {k: v for k, v in schema_spec.items() if k in only_groups or k in ("risks", "limitations", "confidence")}

    system = _rules_block(evidence)
    user_parts = [
        f"Write the analytical narrative for {ticker} ({(meta.get('name') or '').strip()}).",
        f"INDUSTRY MODULE: {module_name}. {module_emphasis}",
        "",
        "VERIFIED ANALYTICAL EVIDENCE PACK:",
        json.dumps(evidence, indent=1, default=str),
        "",
        "Return a JSON object with exactly these top-level keys and shapes:",
        json.dumps(schema_spec, indent=1),
    ]
    if validation_errors:
        user_parts += [
            "",
            "A previous attempt failed validation with these errors — fix them exactly:",
            json.dumps(validation_errors, indent=1),
            "Return the FULL corrected JSON object for the requested groups only.",
        ]
    user_parts += [
        "",
        "Analytical standards: the observations array is the heart of the financial analysis — use it for the 3-5 most "
        "investment-relevant patterns, each as Observation → Evidence (cite the period/figure) → Interpretation → "
        "Investment implication. Keep each string under 700 characters where practical. Do not restate the same ratio "
        "twice without adding a new interpretation. The rating itself is deterministic — you interpret it, you do not set it.",
    ]
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(user_parts)},
    ]


# --------------------------------------------------------------------------- #
# parsing & validation
# --------------------------------------------------------------------------- #

def _strip_fences(text: str) -> str:
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text[:-3]
    start, end = text.find("{"), text.rfind("}")
    return text[start : end + 1] if start >= 0 and end > start else text


def _as_str_list(value: Any, limit: int = 8) -> list[str]:
    if isinstance(value, str):
        return [value.strip()[:600]] if value.strip() else []
    if isinstance(value, list):
        return [str(item).strip()[:600] for item in value[:limit] if str(item).strip()]
    return []


def _as_object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def validate_narrative(parsed: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Validate the structured response; return (clean_narrative, errors)."""
    errors: list[str] = []
    clean: dict[str, Any] = {}

    for group in GROUP_KEYS:
        spec = NARRATIVE_SCHEMA[group]
        raw = _as_object(parsed.get(group))
        if not raw:
            errors.append(f"Missing or non-object group '{group}'.")
            continue
        out_group: dict[str, Any] = {}
        for key in spec["required"]:
            value = raw.get(key)
            if isinstance(value, str) and value.strip():
                out_group[key] = value.strip()[:2000]
            elif isinstance(value, list) and value:
                out_group[key] = _as_str_list(value)
            else:
                errors.append(f"Group '{group}' missing required field '{key}'.")
        for key in spec["optional"]:
            value = raw.get(key)
            if isinstance(value, str) and value.strip():
                out_group[key] = value.strip()[:2000]
            elif isinstance(value, list):
                if key == "observations":
                    out_group[key] = [
                        {k: str(o.get(k) or "").strip()[:700] for k in ("observation", "evidence", "interpretation", "implication") if str(o.get(k) or "").strip()}
                        for o in value[:6] if isinstance(o, dict) and str(o.get("observation") or "").strip()
                    ]
                elif value and isinstance(value[0], dict):
                    out_group[key] = [
                        {k: str(v).strip()[:400] for k, v in o.items() if isinstance(v, str) and v.strip()}
                        for o in value[:6] if isinstance(o, dict)
                    ]
                else:
                    out_group[key] = _as_str_list(value)
        if out_group:
            clean[group] = out_group

    risks = _as_str_list(parsed.get("risks"), limit=8)
    if not risks:
        errors.append("Missing 'risks' list.")
    clean["risks"] = risks
    clean["limitations"] = _as_str_list(parsed.get("limitations"), limit=8)
    confidence = str(parsed.get("confidence") or "").strip().lower()
    clean["confidence"] = confidence if confidence in ("low", "medium", "high") else "medium"
    return clean, errors


def to_legacy(narrative: dict[str, Any]) -> dict[str, Any]:
    """Project the validated structured narrative onto the flat keys the PDF reads."""
    out: dict[str, Any] = {}
    company = narrative.get("company_analysis") or {}
    fin = narrative.get("financial_analysis") or {}
    thesis = narrative.get("thesis") or {}
    forecast = narrative.get("forecast_review") or {}
    valuation = narrative.get("valuation_interpretation") or {}
    conclusion = narrative.get("conclusion") or {}

    def join(*values: Any) -> str:
        parts = [str(v).strip() for v in values if isinstance(v, str) and v.strip()]
        return " ".join(parts)

    out["business_overview"] = join(company.get("business_model"), company.get("industry_structure"))
    out["competitive_position"] = join(
        company.get("competitive_position"),
        "Evidence for advantages: " + "; ".join(company.get("moat_evidence") or []) if company.get("moat_evidence") else "",
        "Limits: " + "; ".join(company.get("moat_limits") or []) if company.get("moat_limits") else "",
    )
    out["earnings_commentary"] = join(fin.get("revenue_story"), fin.get("margin_story"))
    out["earnings_review"] = join(fin.get("revenue_story"), fin.get("margin_story"), fin.get("cash_conversion"))
    out["earnings_quality"] = join(fin.get("earnings_quality"), fin.get("cash_conversion"))
    out["balance_sheet_view"] = fin.get("balance_sheet_view") or ""
    out["investment_thesis"] = [thesis.get("central_thesis")] if thesis.get("central_thesis") else []
    out["central_thesis"] = thesis.get("central_thesis") or ""
    out["core_question"] = thesis.get("core_question") or ""
    out["value_drivers"] = thesis.get("value_drivers") or []
    out["invalidators"] = thesis.get("invalidators") or []
    out["leading_indicators"] = thesis.get("leading_indicators") or []
    out["market_overlooking"] = thesis.get("market_overlooking") or ""
    out["catalysts"] = [
        (f"{c.get('item')} ({c.get('horizon')})" if isinstance(c, dict) and c.get("item") else str(c))
        for c in (thesis.get("catalysts") or [])[:6]
        if (isinstance(c, dict) and c.get("item")) or isinstance(c, str)
    ]
    out["key_questions"] = _as_str_list(thesis.get("open_questions"), limit=6)
    out["key_risks"] = list(narrative.get("risks") or [])
    out["forecast_review"] = join(forecast.get("driver_summary"), forecast.get("reasonableness"))
    out["forecast_reasonableness"] = forecast.get("reasonableness") or ""
    out["stretch_assumptions"] = forecast.get("stretch_assumptions") or []
    out["valuation_commentary"] = join(valuation.get("fair_value_view"), valuation.get("value_driver_commentary"))
    out["terminal_dependence"] = valuation.get("terminal_dependence") or ""
    out["peer_context"] = valuation.get("peer_context") or ""
    out["conclusion"] = join(conclusion.get("summary"), conclusion.get("balanced_view"))
    out["what_would_change_the_view"] = _as_str_list(conclusion.get("what_would_change_the_view"), limit=5)
    out["limitations"] = list(narrative.get("limitations") or [])
    out["confidence"] = narrative.get("confidence") or "medium"
    # structured payload for richer PDF sections
    out["structured"] = narrative
    # keep only non-empty legacy strings
    return {k: v for k, v in out.items() if v not in ("", [], None)}


def parse_narrative(content: str) -> dict[str, Any] | None:
    """Parse and validate model output; returns the legacy-compatible dict or None."""
    candidate = _strip_fences(content)
    try:
        parsed = json.loads(candidate)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    # accept either the new structured schema or a legacy flat response
    if any(isinstance(parsed.get(key), dict) for key in GROUP_KEYS):
        clean, _errors = validate_narrative(parsed)
        if not any(isinstance(clean.get(key), dict) and clean.get(key) for key in GROUP_KEYS):
            return None
        return to_legacy(clean)
    # legacy flat fallback (older models / mocks)
    narrative: dict[str, Any] = {}
    for key in LEGACY_KEYS:
        value = parsed.get(key)
        if isinstance(value, list):
            narrative[key] = [str(item)[:400] for item in value[:8]]
        elif isinstance(value, str) and value.strip():
            narrative[key] = value.strip()[:4000]
    return narrative or None


def narrative_warnings(narrative: dict[str, Any] | None) -> list[str]:
    if not narrative:
        return ["AI narrative unavailable; the report contains deterministic content only."]
    warnings: list[str] = []
    structured = narrative.get("structured")
    if structured:
        missing = [key for key in GROUP_KEYS if key not in structured]
        if missing:
            warnings.append("AI narrative incomplete; missing analytical groups: " + ", ".join(missing))
        if structured.get("confidence") == "low":
            warnings.append("AI narrative confidence is low given evidence completeness; read conclusions with caution.")
    else:
        missing = [key for key in ("investment_thesis", "conclusion") if key not in narrative]
        if missing:
            warnings.append("AI narrative incomplete; missing sections: " + ", ".join(missing))
    return warnings


# --------------------------------------------------------------------------- #
# orchestration
# --------------------------------------------------------------------------- #

def generate_narrative(gateway, cfg, payload: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    """Run the narrative stage: evidence → structured generation → validation →
    one constrained retry for failed groups → legacy projection.

    Returns (narrative | None, warnings). A failure never raises: the caller
    proceeds with a fully deterministic report and attaches the warnings.
    """
    if cfg is None or gateway is None:
        return None, ["No AI model configured; the report contains deterministic content only."]

    def _call(messages: list[dict[str, str]], max_tokens: int) -> str:
        return gateway.generate(
            cfg,
            messages,
            temperature=0.25,
            max_tokens=max_tokens,
            timeout=180.0,
            json_mode=True,
        )

    try:
        content = _call(build_messages(payload), max_tokens=4200)
    except Exception as exc:  # noqa: BLE001 - degrade with a warning
        return None, [f"AI narrative stage failed ({exc}); deterministic content only."]

    candidate = _strip_fences(content)
    try:
        parsed = json.loads(candidate)
    except Exception:
        return None, ["AI narrative returned unparseable output; deterministic content only."]
    if not isinstance(parsed, dict):
        return None, ["AI narrative returned a non-object response; deterministic content only."]

    # New structured schema? (a group counts only when it is an object —
    # legacy flat responses use a plain-string "conclusion")
    if any(isinstance(parsed.get(key), dict) for key in GROUP_KEYS):
        clean, errors = validate_narrative(parsed)
        if not any(isinstance(clean.get(key), dict) and clean.get(key) for key in GROUP_KEYS):
            return None, ["AI narrative failed schema validation; deterministic content only."]
        if errors:
            failed_groups = sorted({
                match.group(1)
                for err in errors
                for match in [re.match(r"Group '([^']+)'", err)]
                if match
            })
            try:
                retry_content = _call(
                    build_messages(payload, only_groups=failed_groups or list(GROUP_KEYS), validation_errors=errors),
                    max_tokens=3200,
                )
                retry_parsed = json.loads(_strip_fences(retry_content))
                if isinstance(retry_parsed, dict):
                    retry_clean, retry_errors = validate_narrative(retry_parsed)
                    # merge: retry fills what it can, original keeps the rest
                    for key, value in retry_clean.items():
                        if key not in clean or (isinstance(value, dict) and not clean.get(key)):
                            clean[key] = value
                        elif isinstance(value, dict) and isinstance(clean.get(key), dict):
                            clean[key] = {**clean[key], **value}
                    errors = retry_errors
            except Exception as exc:  # noqa: BLE001
                errors = errors + [f"Constrained retry failed ({exc})."]
        if not clean:
            return None, ["AI narrative failed schema validation; deterministic content only."]
        legacy = to_legacy(clean)
        warnings = narrative_warnings(legacy)
        if errors:
            warnings.append("AI narrative partially validated; unresolved issues: " + "; ".join(errors[:4]))
        return legacy, warnings

    # Legacy flat fallback
    narrative = parse_narrative(content)
    if narrative is None:
        return None, ["AI narrative returned unparseable output; deterministic content only."]
    return narrative, narrative_warnings(narrative)
