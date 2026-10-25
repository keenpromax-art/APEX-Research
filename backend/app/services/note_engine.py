"""Deterministic payload for the concise APEX research note.

This module isolates the compact-note pathway. It reuses the same calculation
engines as the institutional report, but does not import or render the large
institutional PDF template.
"""

from __future__ import annotations

from typing import Any

from .report_engine import build_payload_from_data


def _minimal_note_payload(
    ticker: str,
    normalized: dict[str, Any],
    metrics: dict[str, Any],
) -> dict[str, Any]:
    """Actual-only fallback when the company has no usable annual base year.

    The note remains auditable: it clearly suppresses forecast and valuation
    outputs instead of silently producing an unsupported target price.
    """
    info = normalized.get("info") or {}
    quality = normalized.get("data_quality") or {}
    price_summary = normalized.get("price_summary") or {}
    price_history = normalized.get("price_history") or []
    metrics_periods = list(metrics.get("periods") or [])
    ticker = str(ticker or normalized.get("ticker") or "").upper()
    generated = normalized.get("retrieved_at")
    return {
        "schema": "apex.research.v1",
        "note_schema": "apex.note.v1",
        "artifact": "concise_research_note",
        "ticker": ticker,
        "report_date": str(generated or "")[:10],
        "generated_at": generated,
        "meta": {
            "name": info.get("longName") or info.get("shortName") or ticker,
            "exchange": info.get("exchange"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "country": info.get("country"),
            "website": info.get("website"),
            "summary": info.get("longBusinessSummary"),
            "employees": info.get("fullTimeEmployees"),
            "currency": info.get("currency") or "USD",
            "market_cap": info.get("marketCap"),
            "shares": info.get("sharesOutstanding") or info.get("impliedSharesOutstanding"),
            "demo": bool(normalized.get("demo")),
            "header_note": "APEX RESEARCH",
        },
        "price": {
            "current": price_summary.get("last_close"),
            "change_pct": price_summary.get("change_pct"),
            "low_52w": price_summary.get("low_52w"),
            "high_52w": price_summary.get("high_52w"),
            "series": price_history[-260:],
            "price_date": price_summary.get("last_date"),
            "source_note": "Yahoo Finance close prices" + (" (cached)" if quality.get("stale") else ""),
        },
        "historical": {
            "metrics": metrics_periods[:6],
            "periods": [f"FY{str(row.get('period_end') or '')[:4]}" for row in metrics_periods[:6]],
            "quarterly_metrics": [],
            "quarterly_periods": [],
        },
        "forecast": {
            "years": 0,
            "base_period": None,
            "labels": [],
            "assumptions": {"values": {}, "overrides": [], "provenance": {}},
            "model_input_gaps": [],
            "periods": [],
            "summary": None,
            "balance_ok": None,
            "max_balance_check": None,
        },
        "valuation": {
            "method": "unavailable",
            "rationale": "No usable annual base year is available; forecast and valuation are suppressed rather than estimated.",
            "wacc": None,
            "wacc_meta": {},
            "terminal_mode": None,
            "terminal_growth": None,
            "exit_multiple": None,
            "net_debt": None,
            "net_debt_basis": "unavailable",
            "shares": None,
            "shares_basis": "unavailable",
            "fcf": [],
            "dcf": {"error": "No usable annual financial data is available for this ticker."},
            "dcf_warnings": [],
            "sensitivity": {"wacc_values": [], "terminal_values": [], "terminal_label": "terminal growth", "table": []},
            "reverse_dcf": None,
            "reverse_dcf_growth": None,
        },
        "scenarios": {"design": "Scenarios are unavailable without a deterministic forecast."},
        "rating": {
            "code": "NOT RATED",
            "mode": "apex_default",
            "upside": None,
            "target_price": None,
            "horizon": "12M",
            "reasons": ["No deterministic valuation is available because the annual base year is unusable."],
        },
        "gaps": [{
            "area": "annual financial data",
            "severity": "warning",
            "detail": "No usable annual financial statements were returned; the note contains actuals only.",
        }],
        "sources": [{
            "ref": "S1", "kind": "reported", "label": "Yahoo Finance via yfinance",
            "where": "company info, prices and reported statements where exposed",
            "retrieved_at": generated,
        }],
        "source_documents": [],
        "provenance_count": 1,
        "data_quality": {
            "stale": bool(quality.get("stale")),
            "demo": bool(normalized.get("demo")),
            "alerts": quality.get("alerts") or [],
            "retrieved_at": quality.get("retrieved_at") or generated,
        },
        "narrative": None,
        "qc": [],
    }


def build_note_payload_from_data(
    ticker: str,
    normalized: dict[str, Any],
    metrics: dict[str, Any],
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the auditable payload behind the concise note."""
    cfg = dict(config or {})
    cfg.setdefault("report_type", "quick")
    cfg.setdefault("years", 3)
    cfg.setdefault("horizon", "12M")
    try:
        payload = build_payload_from_data(ticker, normalized, metrics, cfg)
    except Exception:
        # Preserve the short-note pathway when only actuals are usable.
        payload = _minimal_note_payload(ticker, normalized, metrics)
    payload["artifact"] = "concise_research_note"
    payload["note_schema"] = "apex.note.v1"
    # Keep the compact note compact by default.
    payload.setdefault("source_documents", [])
    return payload
