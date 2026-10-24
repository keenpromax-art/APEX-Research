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


def test_api_report_preview(client):
    resp = client.post("/api/research/generate", json={"ticker": "TEST", "report_type": "quick", "years": 3})
    assert resp.status_code == 200
    rid = resp.json()["id"]
    try:
        preview = client.get(f"/api/research/reports/{rid}/preview")
        assert preview.status_code == 200
        data = preview.json()
        assert data["id"] == rid
        assert data["page_count"] >= 4
        assert data["rendered"] == data["page_count"]
        first = data["pages"][0]
        assert first["number"] == 1
        assert first["width"] > 0 and first["height"] > 0
        assert first["image"].startswith("data:image/png;base64,")

        capped = client.get(f"/api/research/reports/{rid}/preview", params={"max_pages": 2})
        assert capped.status_code == 200
        assert capped.json()["rendered"] == 2
        assert capped.json()["page_count"] > 2
    finally:
        client.delete(f"/api/research/reports/{rid}")
    assert client.get("/api/research/reports/99999999/preview").status_code == 404


def test_api_report_preview_410_without_pdf(client, patched):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        row = ReportRun(ticker="NOPDF", title="no pdf", report_type="quick", payload={}, config={}, pdf=None, pdf_size=0)
        db.add(row)
        db.commit()
        db.refresh(row)
        preview = client.get(f"/api/research/reports/{row.id}/preview")
        assert preview.status_code == 410
        db.delete(row)
        db.commit()
    finally:
        db.close()


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


# --------------------------------------------------------------------------- #
# Phase 8 — narrative schema validation and constrained retry (mocked gateway)
# --------------------------------------------------------------------------- #

def _valid_structured() -> dict:
    return {
        "company_analysis": {
            "business_model": "Industrial equipment maker selling through distributors.",
            "industry_structure": "Fragmented market with cyclical order books.",
            "competitive_position": "Scale advantages in service network.",
        },
        "financial_analysis": {
            "revenue_story": "Revenue compounded to 5.2B over four years.",
            "margin_story": "EBITDA margin expanded to 26.0%.",
            "cash_conversion": "Cash conversion stands at 1.57x net income.",
            "balance_sheet_view": "Net debt of 1.2B, 0.89x EBITDA.",
        },
        "thesis": {
            "core_question": "Is the valuation gap justified?",
            "central_thesis": "Fair value of $99.18 versus $41.72 last close implies large upside.",
            "value_drivers": ["Margin expansion", "Cash conversion"],
            "invalidators": ["A sustained demand slump"],
            "catalysts": [{"item": "Next quarterly print", "horizon": "next quarter"}],
        },
        "forecast_review": {
            "driver_summary": "Forecast grows revenue at 5.0% with flat 28.0% EBITDA margin.",
            "reasonableness": "Assumptions sit below three-year historical averages.",
        },
        "valuation_interpretation": {
            "fair_value_view": "DCF fair value of $99.18 rests on an 8.0% WACC.",
        },
        "conclusion": {
            "summary": "The numbers support a constructive view.",
            "balanced_view": "Terminal-value dependence caps conviction.",
            "what_would_change_the_view": ["A 100bp higher discount rate"],
        },
        "risks": ["Terminal-value dependence", "Leverage"],
        "limitations": ["Demo fixture data only"],
        "confidence": "medium",
    }


def test_narrative_validate_and_to_legacy():
    from app.services.report_narrative import to_legacy, validate_narrative

    clean, errors = validate_narrative(_valid_structured())
    assert errors == [], errors
    legacy = to_legacy(clean)
    assert legacy["investment_thesis"] == [_valid_structured()["thesis"]["central_thesis"]]
    assert legacy["key_risks"] == ["Terminal-value dependence", "Leverage"]
    assert legacy["catalysts"] == ["Next quarterly print (next quarter)"]
    assert legacy["conclusion"] == "The numbers support a constructive view. Terminal-value dependence caps conviction."
    assert legacy["earnings_review"]
    assert legacy["confidence"] == "medium"
    assert legacy["structured"]["thesis"]["central_thesis"]


def test_narrative_validate_reports_missing_fields():
    from app.services.report_narrative import validate_narrative

    broken = _valid_structured()
    del broken["thesis"]["central_thesis"]
    broken["risks"] = []
    clean, errors = validate_narrative(broken)
    assert any("Group 'thesis' missing required field 'central_thesis'" in e for e in errors)
    assert any("risks" in e for e in errors)
    assert "central_thesis" not in clean.get("thesis", {})


class _FakeGateway:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls: list[list[dict]] = []

    def generate(self, cfg, messages, **kwargs):
        self.calls.append(messages)
        if len(self.responses) > 1:
            return self.responses.pop(0)
        return self.responses[0]


def _dumps(doc: dict) -> str:
    import json

    return json.dumps(doc)


def test_narrative_generate_retries_failed_group(patched):
    from app.services.report_narrative import generate_narrative

    payload = build_report_payload("TEST", {"years": 3})
    invalid = _valid_structured()
    invalid["thesis"]["central_thesis"] = ""  # missing required field -> retry
    gateway = _FakeGateway([_dumps(invalid), _dumps(_valid_structured())])
    narrative, warnings = generate_narrative(gateway, {"ai_model": "test"}, payload)
    assert narrative is not None
    assert len(gateway.calls) == 2  # one constrained retry
    assert narrative["investment_thesis"]
    assert narrative["key_risks"] == ["Terminal-value dependence", "Leverage"]


def test_narrative_generate_degrades_never_raises(patched):
    from app.services.report_narrative import generate_narrative

    payload = build_report_payload("TEST", {"years": 3})

    class RaisingGateway:
        def generate(self, cfg, messages, **kwargs):
            raise RuntimeError("provider down")

    narrative, warnings = generate_narrative(RaisingGateway(), {"ai_model": "test"}, payload)
    assert narrative is None
    assert warnings and "provider down" in warnings[0]

    narrative, warnings = generate_narrative(None, None, payload)
    assert narrative is None
    assert warnings

    empty_groups = {key: {} for key in ("company_analysis", "financial_analysis", "thesis",
                                        "forecast_review", "valuation_interpretation", "conclusion")}
    empty_groups.update({"risks": [], "limitations": [], "confidence": "medium"})
    narrative, warnings = generate_narrative(_FakeGateway([_dumps(empty_groups)]), {"ai_model": "test"}, payload)
    assert narrative is None
    assert any("schema validation" in w for w in warnings)


# --------------------------------------------------------------------------- #
# Phase 8 — PDF QA financial reconciliation on a real render
# --------------------------------------------------------------------------- #

def _extract_text(pdf: bytes) -> str:
    from io import BytesIO

    from pypdf import PdfReader

    return " ".join((page.extract_text() or "") for page in PdfReader(BytesIO(pdf)).pages)


def test_pdf_qa_catches_tampered_financials(patched):
    from app.services.pdf_qa import run_pdf_qa

    payload = build_report_payload("TEST", {"years": 3})
    payload["qc"] = run_qa(payload, {"years": 3})
    pdf = build_research_pdf(payload, {"report_type": "quick"})

    def qa(mutate, expected_check):
        mutated = _deepcopy_payload(payload)
        mutate(mutated)
        issues = run_pdf_qa(pdf, mutated, {"ticker": "TEST", "report_type": "quick"})
        assert any(i["level"] == "error" and i["check"] == expected_check for i in issues), \
            f"{expected_check} not raised: {issues}"

    qa(lambda p: p["rating"].update(target_price=98765.0), "pdf.target_price_mismatch")
    qa(lambda p: p["rating"].update(upside=5.55), "pdf.upside_missing")
    qa(lambda p: p["valuation"]["dcf"].update(value_per_share=4321.0), "pdf.fair_value_mismatch")
    qa(lambda p: p["valuation"].update(wacc=0.42), "pdf.wacc_missing")
    qa(lambda p: p["forecast"]["periods"][0].update(revenue=987654321.0), "pdf.forecast_revenue_missing")

    # and the untampered payload must still pass
    issues = run_pdf_qa(pdf, payload, {"ticker": "TEST", "report_type": "quick"})
    assert [i for i in issues if i["level"] == "error"] == []


def test_pdf_qa_catches_missing_rating_code():
    from io import BytesIO

    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    from app.services.pdf_qa import run_pdf_qa

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    c.drawString(72, 720, "Report body text that never mentions the recommendation band itself.")
    c.save()
    payload = {"ticker": "TEST", "rating": {"code": "BUY"}, "price": {}, "forecast": {}, "sources": []}
    issues = run_pdf_qa(buffer.getvalue(), payload, {"ticker": "TEST"})
    assert any(i["level"] == "error" and i["check"] == "pdf.rating_code_missing" for i in issues)


def _deepcopy_payload(payload: dict) -> dict:
    import copy

    return copy.deepcopy(payload)


def test_pdf_qa_visual_checks():
    from io import BytesIO

    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    from app.services.pdf_qa import run_pdf_qa

    minimal = {"ticker": "TEST", "rating": {}, "price": {}, "forecast": {}, "sources": []}

    # sub-5.5pt type must be flagged
    tiny = BytesIO()
    c = canvas.Canvas(tiny, pagesize=letter)
    c.setFont("Helvetica", 4)
    c.drawString(72, 720, "This line is intentionally rendered at four points to trip the minimum type size check.")
    c.save()
    issues = run_pdf_qa(tiny.getvalue(), minimal, {"ticker": "TEST"})
    assert any(i["check"] == "pdf.tiny_text" and i["level"] == "warning" for i in issues)

    # a page with no ink at all must be a blocking error
    empty = BytesIO()
    blank = canvas.Canvas(empty, pagesize=letter)
    blank.showPage()
    blank.save()
    issues = run_pdf_qa(empty.getvalue(), minimal, {"ticker": "TEST"})
    checks = {(i["check"], i["level"]) for i in issues}
    assert ("pdf.blank_pages", "error") in checks
    assert ("pdf.blank_render", "error") in checks


# --------------------------------------------------------------------------- #
# Phase 8 — fixture variants: negative FCF/earnings, missing quarterly, unrated
# --------------------------------------------------------------------------- #

def test_negative_fcf_report_builds(patched, monkeypatch):
    from app.services.pdf_qa import run_pdf_qa

    normalized = _fake_norm()
    for period in normalized["annual"]["income_statement"]:
        period["items"]["net_income"] = -40
    for period in normalized["annual"]["cash_flow"]:
        period["items"]["operating_cash_flow"] = -10
        period["items"]["free_cash_flow"] = -70

    monkeypatch.setattr(
        report_engine, "load_normalized",
        lambda ticker, **kwargs: (normalized, metrics_service.compute_metrics(normalized)),
    )
    payload = build_report_payload("TEST", {"years": 3, "ai_model": None})
    assert payload["historical"]["metrics"][0]["net_income"] == -40
    assert payload["historical"]["metrics"][0]["fcf"] == -70
    payload["qc"] = run_qa(payload, {"years": 3})
    assert [q for q in payload["qc"] if q.get("level") == "error"] == []
    pdf = build_research_pdf(payload, {"report_type": "quick"})
    assert pdf[:5] == b"%PDF-"
    issues = run_pdf_qa(pdf, payload, {"ticker": "TEST", "report_type": "quick"})
    assert [i for i in issues if i["level"] == "error"] == [], issues


def test_missing_quarterly_report_builds(patched, monkeypatch):
    from app.services.pdf_qa import run_pdf_qa

    normalized = _fake_norm()
    normalized["quarterly"] = {"income_statement": []}
    monkeypatch.setattr(
        report_engine, "load_normalized",
        lambda ticker, **kwargs: (normalized, metrics_service.compute_metrics(normalized)),
    )
    payload = build_report_payload("TEST", {"years": 3, "ai_model": None})
    assert payload["historical"]["quarterly_metrics"] == []
    assert payload["historical"]["quarterly_periods"] == []
    assert payload["market_context"]["operating_drivers"]["quarterly_available"] is False
    pdf = build_research_pdf(payload, {"report_type": "quick"})
    assert pdf[:5] == b"%PDF-"
    issues = run_pdf_qa(pdf, payload, {"ticker": "TEST", "report_type": "quick"})
    assert [i for i in issues if i["level"] == "error"] == [], issues


def test_unrated_report_renders(patched):
    from app.services.pdf_qa import run_pdf_qa

    payload = build_report_payload("TEST", {"years": 3, "ai_model": None})
    payload["rating"] = {"code": "NOT RATED", "mode": "test", "upside": None,
                         "target_price": None, "reasons": ["No reliable estimate."], "horizon": "12M"}
    pdf = build_research_pdf(payload, {"report_type": "quick"})
    assert "NOT RATED" in _extract_text(pdf)
    issues = run_pdf_qa(pdf, payload, {"ticker": "TEST", "report_type": "quick"})
    assert [i for i in issues if i["level"] == "error"] == [], issues


def test_long_horizon_full_report(patched):
    from app.services.pdf_qa import run_pdf_qa

    payload = build_report_payload("TEST", {"years": 7, "ai_model": None})
    assert len(payload["forecast"]["periods"]) == 7
    payload["qc"] = run_qa(payload, {"years": 7})
    assert [q for q in payload["qc"] if q.get("level") == "error"] == []
    pdf = build_research_pdf(payload, {"report_type": "full"})
    from pypdf import PdfReader
    import io

    assert len(PdfReader(io.BytesIO(pdf)).pages) >= 7
    issues = run_pdf_qa(pdf, payload, {"ticker": "TEST", "report_type": "full"})
    assert [i for i in issues if i["level"] == "error"] == [], issues


def test_full_has_toc_and_exec_summary_quick_does_not(patched):
    full = build_research_pdf(build_report_payload("TEST", {"years": 3}), {"report_type": "full"})
    quick = build_research_pdf(build_report_payload("TEST", {"years": 3}), {"report_type": "quick"})
    from pypdf import PdfReader
    import io

    full_text = _extract_text(full)
    quick_text = _extract_text(quick)
    assert "Contents" in full_text
    assert "Executive summary" in full_text
    assert "Executive summary" not in quick_text
    assert "Contents" not in quick_text
    full_pages = len(PdfReader(io.BytesIO(full)).pages)
    quick_pages = len(PdfReader(io.BytesIO(quick)).pages)
    assert full_pages > quick_pages
