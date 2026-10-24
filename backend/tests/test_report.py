from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import metrics as metrics_service
from app.services import report_engine
from app.services.pdf_report import build_research_pdf
from app.services.report_engine import (
    build_report_payload,
    DEFAULT_CONFIG,
    resolve_rating,
    run_qa,
)
from app.services.report_narrative import build_messages, parse_narrative
from app.db import ReportRun, SessionLocal


def _fake_norm():
    return {
        "ticker": "TEST",
        "retrieved_at": "2026-01-01T00:00:00Z",
        "info": {
            "longName": "Test Co",
            "exchange": "NASDAQ",
            "currency": "USD",
            "sector": "Tech",
            "sharesOutstanding": 1000,
            "marketCap": 10_000,
        },
        "annual": {
            "income_statement": [
                {"period_end": "2025-12-31", "items": {"revenue": 1000, "gross_profit": 400, "operating_income": 200, "ebit": 200, "ebitda": 250, "net_income": 120, "tax_expense": 30, "pretax_income": 150, "interest_expense": 20, "cost_of_revenue": 600, "operating_expense": 200, "diluted_eps": 0.12, "da": 50}},
            ],
            "balance_sheet": [
                {"period_end": "2025-12-31", "items": {"total_assets": 2000, "current_assets": 800, "current_liabilities": 400, "cash": 100, "total_debt": 500, "equity": 900, "accounts_receivable": 150, "inventory": 100, "accounts_payable": 80, "ppe_net": 800}},
            ],
            "cash_flow": [
                {"period_end": "2025-12-31", "items": {"operating_cash_flow": 180, "capex": -60, "free_cash_flow": 120}},
            ],
        },
        "quarterly": {
            "income_statement": [
                {"period_end": "2025-03-31", "items": {"revenue": 240, "gross_profit": 96, "operating_income": 48, "ebit": 48, "ebitda": 60, "net_income": 28, "diluted_eps": 0.028, "da": 12}},
                {"period_end": "2025-06-30", "items": {"revenue": 250, "gross_profit": 100, "operating_income": 50, "ebit": 50, "ebitda": 62, "net_income": 30, "diluted_eps": 0.03, "da": 12}},
                {"period_end": "2025-09-30", "items": {"revenue": 255, "gross_profit": 102, "operating_income": 51, "ebit": 51, "ebitda": 64, "net_income": 31, "diluted_eps": 0.031, "da": 13}},
                {"period_end": "2025-12-31", "items": {"revenue": 255, "gross_profit": 102, "operating_income": 51, "ebit": 51, "ebitda": 64, "net_income": 31, "diluted_eps": 0.031, "da": 13}},
            ],
        },
        "price_history": [{"date": f"2025-1{i}-0{d}T00:00:00Z", "close": 9 + i + d / 10} for i in range(1, 9) for d in (1, 2, 5)],
        "price_summary": {"last_close": 17.2, "change_pct": 0.5, "low_52w": 8.5, "high_52w": 18.0, "last_date": "2026-01-01"},
        "dividends": [
            {"date": "2025-03-15", "value": 0.05},
            {"date": "2025-09-15", "value": 0.05},
            {"date": "2026-03-15", "value": 0.05},
        ],
        "data_quality": {"alerts": [], "retrieved_at": "2026-01-01"},
    }


@pytest.fixture
def patched(monkeypatch):
    def load(ticker, **kwargs):
        normalized = _fake_norm()
        return normalized, metrics_service.compute_metrics(normalized)

    monkeypatch.setattr(report_engine, "load_normalized", load)
    monkeypatch.setattr(report_engine, "refresh", load)


@pytest.fixture
def client(monkeypatch, patched):
    return TestClient(app)


def test_payload_build(patched):
    payload = build_report_payload("TEST", {"years": 3})
    assert payload["schema"] == "apex.research.v1"
    assert payload["ticker"] == "TEST"
    assert payload["meta"]["currency"] == "USD"
    assert len(payload["forecast"]["periods"]) == 3
    assert payload["forecast"]["balance_ok"] is True
    assert payload["valuation"]["dcf"]["value_per_share"]
    assert payload["rating"]["target_price"] == pytest.approx(payload["valuation"]["dcf"]["value_per_share"])
    assert payload["rating"]["code"] in ("BUY", "HOLD", "SELL", "NOT RATED")
    upside = payload["rating"]["target_price"] / payload["price"]["current"] - 1
    assert payload["rating"]["upside"] == pytest.approx(upside)
    assert len(payload["sources"]) >= 4
    payload["qc"] = run_qa(payload, {"years": 3})
    assert all(issue.get("level") != "error" for issue in payload["qc"])


def test_payload_qa_clean(patched):
    payload = build_report_payload("TEST", {"years": 3, "ai_model": None})
    issues = run_qa(payload, {"years": 3})
    errors = [issue for issue in issues if issue.get("level") == "error"]
    assert errors == []


def test_summary_snapshot_alignment(patched):
    payload = build_report_payload("TEST", {"years": 3})
    snap = payload["summary_snapshot"]
    assert snap["labels"]
    periods = payload["historical"]["periods"]
    metrics = payload["historical"]["metrics"]
    assert len(metrics) == len(periods)
    revenue_row = next(row for row in snap["rows"] if row["label"] == "Revenue")
    assert len(revenue_row["values"]) == len(periods)
    assert all(isinstance(v, (int, float)) or v is None for v in revenue_row["values"])
    assert revenue_row["fmt"] == "money"
    forecast_labels = snap.get("forecast_labels") or []
    assert len(forecast_labels) == len(payload["forecast"]["periods"])


def test_quarterly_metrics_in_payload(patched):
    payload = build_report_payload("TEST", {"years": 3})
    qmetrics = payload["historical"]["quarterly_metrics"]
    qperiods = payload["historical"]["quarterly_periods"]
    assert len(qmetrics) == 4
    assert len(qperiods) == 4
    assert qmetrics[0]["revenue"] == 240


def test_dividend_summary(patched):
    payload = build_report_payload("TEST", {"years": 3})
    div = payload["price"]["dividend"]
    assert div["available"] is True
    assert div["ttm_per_share"] > 0
    assert div["yield"] > 0


def test_pdf_qa_passes_on_render(patched):
    from app.services.pdf_qa import run_pdf_qa

    payload = build_report_payload("TEST", {"years": 3})
    payload["qc"] = run_qa(payload, {"years": 3})
    pdf = build_research_pdf(payload, {"report_type": "quick"})
    issues = run_pdf_qa(pdf, payload, {"ticker": "TEST"})
    errors = [issue for issue in issues if issue["level"] == "error"]
    assert errors == [], errors
    assert any(issue["check"] == "pdf.passed" for issue in issues)


def test_pdf_qa_catches_missing_target():
    from io import BytesIO

    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    from app.services.pdf_qa import run_pdf_qa

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    c.drawString(72, 720, "Some rendered report text without the target.")
    c.save()
    payload = {"ticker": "TEST", "rating": {"target_price": 12345.0}, "price": {}, "forecast": {}, "sources": []}
    issues = run_pdf_qa(buffer.getvalue(), payload, {"ticker": "TEST"})
    assert any(issue["level"] == "error" and issue["check"] == "pdf.target_price_mismatch" for issue in issues)


def test_qa_catches_injected_target(patched):
    payload = build_report_payload("TEST", {"years": 3})
    payload["rating"]["target_price"] = payload["rating"]["target_price"] * 1.5 + 7
    issues = run_qa(payload, {"years": 3})
    assert any(i["level"] == "error" and i["check"] == "target_reconciliation" for i in issues)


def test_rating_bands():
    quality: dict = {}
    buy, _ = resolve_rating(120.0, 100.0, dict(DEFAULT_CONFIG), quality)
    hold, _ = resolve_rating(107.0, 100.0, dict(DEFAULT_CONFIG), quality)
    sell, _ = resolve_rating(92.0, 100.0, dict(DEFAULT_CONFIG), quality)
    assert buy["code"] == "BUY"
    assert hold["code"] == "HOLD"
    assert sell["code"] == "SELL"
    missing, _ = resolve_rating(None, 100.0, dict(DEFAULT_CONFIG), quality)
    assert missing["code"] == "NOT RATED"


def test_pdf_builds_full_and_quick(patched):
    payload = build_report_payload("TEST", {"years": 3})
    payload["narrative"] = {"investment_thesis": ["A grounded thesis sentence."], "bear_case": ["A risk sentence."]}
    full = build_research_pdf(payload, {"report_type": "full"})
    quick = build_research_pdf(payload, {"report_type": "quick"})
    for pdf in (full, quick):
        assert pdf[:5] == b"%PDF-"
        assert len(pdf) > 20_000
    from pypdf import PdfReader
    import io

    assert len(PdfReader(io.BytesIO(full)).pages) >= 7
    assert len(PdfReader(io.BytesIO(quick)).pages) >= 4
    payload["narrative"] = None
    fallback = build_research_pdf(payload, {"report_type": "quick"})
    assert fallback[:5] == b"%PDF-"


def test_narrative_messages_and_parse():
    import json

    content = json.dumps({
        "investment_thesis": ["Bullet one", "Bullet two"],
        "business_overview": "Overview text.",
        "conclusion": "Buy.",
    })
    parsed = parse_narrative("```json\n" + content + "\n```")
    assert parsed is not None
    assert parsed["conclusion"] == "Buy."
    assert parse_narrative("not json at all") is None


def test_api_generate_and_pdf(client):
    resp = client.post("/api/research/generate", json={"ticker": "TEST", "report_type": "quick", "years": 3})
    assert resp.status_code == 200
    summary = resp.json()
    assert summary["ticker"] == "TEST"
    assert summary["status"] in ("complete", "preliminary")
    assert summary["rating"] in ("BUY", "HOLD", "SELL", "NOT RATED")
    rid = summary["id"]

    pdf_resp = client.get(f"/api/research/reports/{rid}/pdf")
    assert pdf_resp.status_code == 200
    assert pdf_resp.content[:5] == b"%PDF-"
    assert "filename=" in pdf_resp.headers["content-disposition"]

    listing = client.get("/api/research/reports", params={"ticker": "TEST"})
    assert listing.status_code == 200
    assert any(row["id"] == rid for row in listing.json())

    rebuild = client.post(f"/api/research/reports/{rid}/rebuild")
    assert rebuild.status_code == 200
    new_id = rebuild.json()["id"]
    assert rebuild.json()["previous_version_id"] == rid
    assert new_id != rid

    detail = client.get(f"/api/research/reports/{new_id}")
    assert detail.status_code == 200
    assert detail.json()["payload"]["schema"] == "apex.research.v1"

    # cleanup versions created by this test
    for version_id in (rid, new_id):
        deleted = client.delete(f"/api/research/reports/{version_id}")
        assert deleted.status_code == 200
    gone = client.get(f"/api/research/reports/{new_id}")
    assert gone.status_code == 404


def test_api_report_missing(client):
    resp = client.get("/api/research/reports/99999999")
    assert resp.status_code == 404
    pdf = client.get("/api/research/reports/99999999/pdf")
    assert pdf.status_code == 404


def test_rows_store_pdf_bytes(patched):
    payload = build_report_payload("TEST", {"years": 3})
    pdf = build_research_pdf(payload, {"report_type": "quick"})
    db = SessionLocal()
    try:
        row = ReportRun(ticker="TEST", title="t", report_type="quick", payload={}, config={}, pdf=pdf, pdf_size=len(pdf))
        db.add(row)
        db.commit()
        db.refresh(row)
        stored = db.get(ReportRun, row.id)
        assert stored.pdf[:5] == b"%PDF-"
        db.delete(stored)
        db.commit()
    finally:
        db.close()
