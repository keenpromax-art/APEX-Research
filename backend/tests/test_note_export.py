from __future__ import annotations

import io
import json

from fastapi.testclient import TestClient
from pypdf import PdfReader

import app.routers.ai as ai_mod
from app.main import app
from app.routers.export import (
    _fmt_compact,
    _fmt_dcf_value,
    _fmt_money,
    _fmt_pct,
    _fmt_x,
    _kpi_rows,
    _sanitize,
)
from app.services.note_narrative import (
    build_facts,
    figure_correction_message,
    validate_report_figures,
)

U_NONBREAKING_HYPHEN = "\u2011"
U_ALMOST_EQUAL = "\u2248"
U_RUPEE = "\u20b9"


def _note_norm():
    return {
        "ticker": "NOTEX",
        "retrieved_at": "2026-10-23T00:00:00Z",
        "info": {
            "longName": "Inox Wind Limited",
            "exchange": "NSI",
            "currency": "INR",
            "sector": "Industrials",
            "industry": "Renewable Energy Equipment",
            "marketCap": 101_845_057_536,
        },
        "price_summary": {
            "last_close": 58.93,
            "previous_close": 62.11,
            "change": -3.18,
            "change_pct": -0.0512,
            "high_52w": 157.25,
            "low_52w": 58.93,
            "last_date": "2026-10-23",
        },
        "annual": {},
        "quarterly": {},
        "data_quality": {"alerts": [{"level": "warning", "message": "Missing quarterly cash flow"}]},
    }


def _note_metrics():
    return {
        "periods": [
            {
                "period_end": "2026-03-31",
                "revenue": 42_113_015_000,
                "revenue_growth": 0.2008,
                "gross_margin": 0.3234,
                "operating_margin": 0.1711,
                "ebitda_margin": 0.2327,
                "net_margin": 0.1066,
                "net_income": 4_489_000_000,
                "ebitda": 9_795_000_000,
                "eps_diluted": 2.390782,
                "book_value_per_share": 36.93,
                "ocf": -5_981_235_000,
                "capex": -6_493_231_000,
                "fcf": -12_474_466_000,
                "net_debt": 14_561_324_000,
                "net_debt_ebitda": 1.4858,
                "debt_to_equity": 0.2486,
                "interest_coverage": 6.6546,
                "current_ratio": -1.22e-07,
                "quick_ratio": -2.1926,
                "roa": 0.0372,
                "roe": 0.0704,
                "roic": 0.0674,
                "days_sales_outstanding": 427.18,
                "days_inventory": 229.34,
                "days_payable": 152.33,
                "equity": 63_824_910_000,
                "total_debt": 15_869_467_000,
                "cash": 1_308_143_000,
                "shares": 1_728_237_822,
            },
            {
                "period_end": "2025-03-31",
                "revenue": 35_071_000_000,
                "net_income": 3_057_000_000,
                "ebitda": 7_900_000_000,
                "ocf": 1_100_000_000,
                "capex": -4_000_000_000,
                "fcf": -2_900_000_000,
            },
        ]
    }


def _good_report():
    return {
        "executive_summary": (
            "Inox Wind Limited closed at INR 58.93, down 5.12% versus the previous close. "
            "FY2026 revenue was INR 42.11 bn, up 20.1% year over year, with a gross margin of 32.3% "
            "and a net margin of 10.7%."
        ),
        "strengths": ["Gross margin of 32.3% and operating margin of 17.1% in FY2026."],
        "risks": ["Free cash flow was -INR 12.47 bn in FY2026."],
        "conclusion": "The base case rests on reported fundamentals alone.",
    }


def _bad_report():
    return {
        "executive_summary": (
            "Revenue was INR 777.77 bn and margins hit 88.8% with leverage at 9.9x, "
            "against a peer set of 45.2% and book value of 1,234.56."
        )
    }


class _FakeGateway:
    def __init__(self, responses, stream_responses=None):
        self.responses = list(responses)
        self.stream_responses = list(stream_responses or [])
        self.calls = []
        self.stream_calls = []
        self._models = {}

    def list_models(self):
        return [{"name": name, "enabled": True} for name in self._models]

    def register(self, config):
        self._models[config.name] = config

    def unregister(self, name):
        self._models.pop(name, None)

    def get(self, name):
        return self._models.get(name)

    def generate(self, config, messages, **kwargs):
        self.calls.append(messages)
        return self.responses.pop(0)

    def generate_stream(self, config, messages, **kwargs):
        self.stream_calls.append(messages)
        for piece in self.stream_responses:
            yield piece


def _extract(pdf_bytes):
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = " ".join(page.extract_text() or "" for page in reader.pages)
    return len(reader.pages), text, "".join(text.split())


def test_sanitize_folds_unrenderable_glyphs():
    folded = _sanitize(f"a{U_NONBREAKING_HYPHEN}b {U_ALMOST_EQUAL}23.3% {U_RUPEE}100 x \U0001f600!")
    assert folded == "a-b ~23.3% INR 100 x !"
    kept = _sanitize("em—dash – en · bullet “quote”")
    assert kept == "em—dash – en · bullet “quote”"


def test_formatters_match_facts_conventions():
    assert _fmt_compact(44_218_665_750) == "44.22 bn"
    assert _fmt_compact(-12_474_466_000) == "-12.47 bn"
    assert _fmt_compact(1_308_143_000) == "1.31 bn"
    assert _fmt_money(-12_474_466_000, "INR") == "-INR 12.47 bn"
    assert _fmt_money(58.93, "INR") == "INR 58.93"
    assert _fmt_pct(0.2008, signed=True) == "+20.1%"
    assert _fmt_pct(0.3234) == "32.3%"
    assert _fmt_x(1.4858) == "1.49x"
    assert _fmt_dcf_value("wacc", 0.093, "INR") == "9.3%"
    assert _fmt_dcf_value("terminal_growth", 0.04, "INR") == "4.0%"
    assert _fmt_dcf_value("value_per_share", 61.4, "INR") == "INR 61.40"
    assert _fmt_dcf_value("exit_multiple", 12.5, "INR") == "12.5x"
    assert _fmt_dcf_value("enterprise_value", 95e9, "INR") == "95.00 bn"


def test_kpi_rows_from_engine_shape():
    body = {
        "company": {
            "currency": "INR",
            "market_cap": 101_845_057_536,
            "last_data_date": "2026-03-31",
        },
        "price_summary": {"last_close": 58.93, "change_pct": -0.0512},
        "actuals": {
            "eps_diluted": 2.390782,
            "book_value_per_share": 36.93,
            "revenue_growth": 0.2008,
            "operating_margin": 0.1711,
            "net_debt_ebitda": 1.4858,
            "fcf": -12_474_466_000,
        },
    }
    rows = _kpi_rows(body)
    by_label = {label: (value, sub) for label, value, sub in rows}
    assert by_label["Price"] == ("INR 58.93", "-5.1% vs prev. close")
    assert by_label["Market cap"] == ("INR 101.85 bn", "INR")
    assert by_label["P/E (trailing)"][0] == "24.65x"
    assert by_label["Revenue growth"] == ("+20.1%", "FY2026 YoY")
    assert by_label["Net debt / EBITDA"] == ("1.49x", "leverage")
    assert by_label["Free cash flow"] == ("-INR 12.47 bn", "FY2026")


def test_validator_flags_invented_figures_and_passes_good():
    facts = build_facts("NOTEX", _note_norm(), _note_metrics())
    assert validate_report_figures(_good_report(), facts) == []

    warnings = validate_report_figures(_bad_report(), facts)
    assert len(warnings) >= 3
    joined = " | ".join(warnings)
    assert "INR 777.77 bn" in joined
    assert "88.8%" in joined
    assert "9.9x" in joined

    correction = figure_correction_message(warnings)
    assert correction["role"] == "user"
    assert "INR 777.77 bn" in correction["content"]


def _rich_payload():
    forecast = {
        "assumptions": {
            "base_period": "2026-03-31",
            "revenue": 42_113_015_000,
            "gross_margin": 0.3234,
            "opex_ratio": 0.5053,
            "tax_rate": 0.2462,
            "capex_pct": 0.1542,
            "interest_rate": 0.085,
            "dividend_payout": 0.0,
            "shares": 1_728_237_822,
        },
        "periods": [
            {"year": idx + 1, "revenue": rev, "ebitda": ebit, "net_income": ni, "capex": capex, "ocf": ocf, "fcf": fcf}
            for idx, (rev, ebit, ni, capex, ocf, fcf) in enumerate(
                [
                    (44_218_665_750, 10_400_000_000, 7_010_000_000, 6_820_000_000, 7_190_000_000, 368_806_121),
                    (46_429_599_038, 11_100_000_000, 7_520_000_000, 7_100_000_000, 7_900_000_000, 800_000_000),
                    (48_751_079_000, 11_900_000_000, 8_100_000_000, 7_400_000_000, 8_700_000_000, 1_300_000_000),
                    (51_188_633_000, 12_800_000_000, 8_700_000_000, 7_800_000_000, 9_500_000_000, 1_700_000_000),
                    (53_748_065_000, 13_700_000_000, 9_400_000_000, 8_200_000_000, 10_400_000_000, 2_200_000_000),
                ]
            )
        ],
    }
    return {
        "ticker": "NOTEX",
        "title": "NOTEX — APEX Terminal Research Report",
        "company": {
            "name": "Inox Wind Limited",
            "exchange": "NSI",
            "currency": "INR",
            "sector": "Industrials",
            "industry": "Renewable Energy Equipment",
            "last_data_date": "2026-03-31",
            "market_cap": 101_845_057_536,
        },
        "actuals": {
            "revenue": 42_113_015_000,
            "ebitda": 9_795_000_000,
            "net_income": 4_489_000_000,
            "fcf": -12_474_466_000,
            "revenue_growth": 0.2008,
            "operating_margin": 0.1711,
            "net_debt_ebitda": 1.4858,
            "eps_diluted": 2.390782,
            "book_value_per_share": 36.93,
        },
        "price_summary": {"last_close": 58.93, "change_pct": -0.0512},
        "forecast": forecast,
        "assumptions": forecast["assumptions"],
        "dcf": {
            "wacc": 0.093,
            "terminal_growth": 0.04,
            "value_per_share": 61.4,
            "enterprise_value": 95_000_000_000,
            "exit_multiple": 12.5,
            "warnings": ["Terminal growth exceeds the long-run nominal GDP band"],
        },
        "report": {
            "executive_summary": (
                "Inox Wind Limited trades at INR 58.93 after a 5.12% move, at the low end of its "
                f"52-week range of INR 58.93 to INR 157.25. FY2026 revenue reached INR 42.11 bn "
                f"({U_ALMOST_EQUAL}20.1% growth) with EBITDA margin of 23.3%."
            ),
            "business_overview": "A well" + U_NONBREAKING_HYPHEN + "known wind turbine supplier serving utilities.",
            "strengths": [
                "Gross margin of 32.3% in FY2026.",
                "Order book supported by sector tailwinds.",
            ],
            "risks": [
                "Operating cash flow of -INR 5.98 bn in FY2026.",
                "Receivable days of 427 extend the cash cycle.",
            ],
            "catalysts": ["New capacity announcements in the sector."],
            "valuation_view": "The model value per share of INR 61.40 sits above the last close.",
            "conclusion": "Base case is anchored to reported figures only.",
            "disclaimer": "Not investment advice. Verify every figure before use.",
            "figure_warnings": [
                'executive_summary: unverified figure "INR 99.99 bn"',
            ],
        },
        "data_quality": {"alerts": [{"level": "warning", "message": "Missing quarterly cash flow"}]},
    }


def test_rich_pdf_renders_clean_design():
    c = TestClient(app)
    r = c.post("/api/export/pdf", json=_rich_payload())
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")

    pages, text, tight = _extract(r.content)
    assert pages >= 1

    assert "\u2011" not in text
    assert U_ALMOST_EQUAL not in text
    assert "\ufffd" not in text

    assert "InoxWindLimited" in tight
    assert "APEXTERMINAL" in tight
    assert "MARKETCAP" in tight
    assert "INR58.93" in tight
    assert "101.85bn" in tight
    assert "24.65x" in tight
    assert "ExecutiveSummary" in tight
    assert "well-known" in tight
    assert "~20.1%" in tight
    assert "FY2026(A)" in tight
    assert "FY2027(P)" in tight
    assert "44.22bn" in tight
    assert "42.11bn" in tight
    assert "oppositecapexsign" in tight
    assert "notcompanyguidance" in tight
    assert "Modelassumptions" in tight
    assert "Baseperiod" in tight
    assert "32.3%" in tight
    assert "Figurewarnings" in tight
    assert "99.99" in tight
    assert "Modelwarnings" in tight
    assert "Dataquality" in tight
    assert "Missingquarterlycashflow" in tight
    assert "notinvestmentadvice" in tight
    assert f"Page1of{pages}" in tight


def test_minimal_pdf_payload_still_renders():
    payload = {
        "ticker": "TEST",
        "title": "Test & Co <report>",
        "forecast": {"periods": [{"year": 1, "revenue": 100.0, "ebitda": 25.0, "net_income": 10.0, "fcf": 8.0}]},
        "dcf": {"wacc": 0.1, "value_per_share": 42.0, "warnings": []},
        "report": {"executive_summary": "Solid & <safe> text"},
    }
    c = TestClient(app)
    r = c.post("/api/export/pdf", json=payload)
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")

    _pages, text, tight = _extract(r.content)
    assert "Test & Co <report>" in text
    assert "Y1(P)" in tight
    assert "100.00" in tight
    assert "10.0%" in tight
    assert "42.00" in tight
    assert "Sources&Limitations" in tight


_MODEL_BODY = {
    "name": "Note Test Provider",
    "provider": "openai_compatible",
    "model_id": "note-test-model",
    "base_url": "http://127.0.0.1:9/v1",
    "api_key": "test-key",
    "enabled": True,
}


def _register_model(c):
    r = c.post("/api/ai/models", json=_MODEL_BODY)
    assert r.status_code in (200, 409)


def test_research_retries_unverified_figures(monkeypatch):
    fake = _FakeGateway([json.dumps(_bad_report()), json.dumps(_good_report())])
    monkeypatch.setattr(ai_mod, "load_normalized", lambda ticker: (_note_norm(), _note_metrics()))
    monkeypatch.setattr(ai_mod, "get_gateway", lambda: fake)

    c = TestClient(app)
    _register_model(c)
    try:
        r = c.post(
            "/api/ai/research",
            json={"ticker": "NOTEX", "model": "Note Test Provider"},
        )
        assert r.status_code == 200, r.text
        payload = r.json()
        assert len(fake.calls) == 2
        retry_content = " ".join(m["content"] for m in fake.calls[1])
        assert "unverified figure" in retry_content
        report = payload["report"]
        assert report["executive_summary"] == _good_report()["executive_summary"]
        assert "figure_warnings" not in report
        assert report.get("disclaimer")
        assert payload["model"] == "Note Test Provider"
    finally:
        c.delete("/api/ai/models/Note%20Test%20Provider")


def test_research_keeps_warnings_when_retry_still_unverified(monkeypatch):
    fake = _FakeGateway([json.dumps(_bad_report()), json.dumps(_bad_report())])
    monkeypatch.setattr(ai_mod, "load_normalized", lambda ticker: (_note_norm(), _note_metrics()))
    monkeypatch.setattr(ai_mod, "get_gateway", lambda: fake)

    c = TestClient(app)
    _register_model(c)
    try:
        r = c.post(
            "/api/ai/research",
            json={"ticker": "NOTEX", "model": "Note Test Provider"},
        )
        assert r.status_code == 200, r.text
        report = r.json()["report"]
        assert len(fake.calls) == 2
        assert report.get("figure_warnings")
        assert any("INR 777.77 bn" in item for item in report["figure_warnings"])
    finally:
        c.delete("/api/ai/models/Note%20Test%20Provider")


def test_research_stream_returns_done_with_validated_report(monkeypatch):
    fake = _FakeGateway([], stream_responses=[json.dumps(_good_report())])
    monkeypatch.setattr(ai_mod, "load_normalized", lambda ticker: (_note_norm(), _note_metrics()))
    monkeypatch.setattr(ai_mod, "get_gateway", lambda: fake)

    c = TestClient(app)
    _register_model(c)
    try:
        r = c.post(
            "/api/ai/research/stream",
            json={"ticker": "NOTEX", "model": "Note Test Provider"},
        )
        assert r.status_code == 200, r.text
        assert "event: done" in r.text
        assert len(fake.stream_calls) == 1
        data_line = [line for line in r.text.splitlines() if line.startswith("data: ") and "report" in line]
        assert data_line
        done_payload = json.loads(data_line[-1][len("data: ") :])
        assert done_payload["report"]["executive_summary"] == _good_report()["executive_summary"]
        assert "figure_warnings" not in done_payload["report"]
    finally:
        c.delete("/api/ai/models/Note%20Test%20Provider")


def test_research_api_returns_deterministic_note_payload(monkeypatch):
    fake = _FakeGateway([json.dumps(_good_report())])
    monkeypatch.setattr(ai_mod, "load_normalized", lambda ticker: (_note_norm(), _note_metrics()))
    monkeypatch.setattr(ai_mod, "get_gateway", lambda: fake)

    c = TestClient(app)
    _register_model(c)
    try:
        r = c.post("/api/ai/research", json={"ticker": "NOTEX", "model": "Note Test Provider"})
        assert r.status_code == 200, r.text
        result = r.json()
        payload = result["payload"]
        assert payload["artifact"] == "concise_research_note"
        assert payload["note_schema"] == "apex.note.v1"
        assert payload["rating"]["code"] == "NOT RATED"
        assert "error" in payload["valuation"]["dcf"]
        assert payload["forecast"]["periods"] == []
    finally:
        c.delete("/api/ai/models/Note%20Test%20Provider")


def _modelable_norm():
    return {
        "ticker": "TEST",
        "retrieved_at": "2026-01-01T00:00:00Z",
        "info": {
            "longName": "Test Co",
            "exchange": "NASDAQ",
            "currency": "USD",
            "sector": "Technology",
            "sharesOutstanding": 1000,
            "marketCap": 10_000,
        },
        "annual": {
            "income_statement": [
                {"period_end": "2025-12-31", "items": {"revenue": 1000, "gross_profit": 400, "operating_income": 200, "ebit": 200, "ebitda": 250, "net_income": 120, "tax_expense": 30, "pretax_income": 150, "interest_expense": 20, "cost_of_revenue": 600, "operating_expense": 200, "diluted_eps": 0.12, "da": 50}},
            ],
            "balance_sheet": [
                {"period_end": "2025-12-31", "items": {"total_assets": 2000, "current_assets": 800, "current_liabilities": 400, "cash": 100, "total_debt": 500, "equity": 900, "accounts_receivable": 150, "inventory": 100, "accounts_payable": 80, "ppe_net": 800, "shares_issued": 1000}},
            ],
            "cash_flow": [
                {"period_end": "2025-12-31", "items": {"operating_cash_flow": 180, "capex": -60, "free_cash_flow": 120, "dividends_paid": 0}},
            ],
        },
        "quarterly": {},
        "price_history": [{"date": f"2025-{m:02d}-01", "close": 10 + m / 10} for m in range(1, 13)],
        "price_summary": {"last_close": 17.2, "previous_close": 17.0, "change": 0.2, "change_pct": 0.01, "low_52w": 8.5, "high_52w": 18.0, "last_date": "2026-01-01"},
        "data_quality": {"alerts": [], "retrieved_at": "2026-01-01"},
    }


def test_concise_note_export_uses_research_payload_and_qa():
    from app.services.metrics import compute_metrics
    from app.services.note_engine import build_note_payload_from_data

    normalized = _modelable_norm()
    payload = build_note_payload_from_data(
        "TEST",
        normalized,
        compute_metrics(normalized),
        {"years": 3, "wacc": 0.10},
    )
    body = {
        "ticker": "TEST",
        "title": "Test Co — concise research note",
        "report": {
            "executive_summary": _good_report()["executive_summary"],
            "business_overview": "A modelable test company.",
            "financial_performance": "Revenue and cash flow are model inputs for the forecast.",
            "strengths": ["Positive reported cash flow."],
            "risks": ["Forecast assumptions may not be realised."],
            "catalysts": ["Next quarterly print."],
            "valuation_view": "The deterministic target is the model estimate, not guidance.",
            "conclusion": _good_report()["conclusion"],
        },
        "research_payload": payload,
        "rating": payload["rating"],
        "dcf": payload["valuation"]["dcf"],
        "forecast": payload["forecast"],
        "price_summary": payload["price"] | {"last_close": payload["price"]["current"]},
        "price_history": payload["price"]["series"],
        "company": payload["meta"] | {"last_data_date": payload["forecast"]["base_period"]},
        "actuals": payload["historical"]["metrics"][0],
        "data_quality": payload["data_quality"],
    }
    c = TestClient(app)
    r = c.post("/api/export/pdf", json=body)
    assert r.status_code == 200, r.text
    assert r.headers.get("X-APEX-QC-Status") == "passed"
    pages, text, tight = _extract(r.content)
    assert pages >= 1
    assert "Modeltarget(E)" in tight
    assert "Lastclose" in tight
    assert "Exhibit1" in tight
    assert "(P)" in tight


def test_concise_note_qa_blocks_missing_target():
    from app.services.pdf_qa import run_note_pdf_qa
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas
    from io import BytesIO

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    c.drawString(72, 720, "Some concise note text without the target price.")
    c.save()
    body = {
        "rating": {"code": "BUY", "target_price": 123.0},
        "dcf": {},
        "forecast": {"periods": []},
    }
    issues = run_note_pdf_qa(buffer.getvalue(), body)
    assert any(issue["level"] == "error" and issue["check"] == "pdf.target_missing" for issue in issues)
