from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import core


def _fake_norm():
    return {
        "ticker": "TEST",
        "retrieved_at": "2026-01-01T00:00:00Z",
        "info": {"longName": "Test Co", "exchange": "NASDAQ", "currency": "USD", "sector": "Tech", "sharesOutstanding": 1000},
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
        "quarterly": {},
        "data_quality": {"alerts": [], "retrieved_at": "2026-01-01"},
    }


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(core, "_fetch_normalized", lambda t: (_fake_norm(), __import__("app.services.metrics", fromlist=["compute_metrics"]).compute_metrics(_fake_norm())))
    return TestClient(app)


def test_health():
    c = TestClient(app)
    r = c.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_company_endpoint(client):
    r = client.get("/api/company/TEST")
    assert r.status_code == 200
    data = r.json()
    assert data["ticker"] == "TEST"
    assert data["name"] == "Test Co"
    assert data["last_data_date"] == "2025-12-31"


def test_data_endpoint(client):
    r = client.get("/api/data/TEST")
    assert r.status_code == 200
    assert r.json()["normalized"]["ticker"] == "TEST"


def test_forecast_endpoint(client):
    r = client.post("/api/forecast/TEST", json={"years": 3, "assumptions": {"revenue_growth": 0.1}})
    assert r.status_code == 200
    assert len(r.json()["periods"]) == 3


def test_dcf_endpoint():
    c = TestClient(app)
    r = c.post("/api/valuation/dcf", json={"fcf": [100], "wacc": 0.1, "terminal_growth": 0.0, "net_debt": 0, "shares": 10})
    assert r.status_code == 200
    assert r.json()["value_per_share"] == pytest.approx(100.0, rel=1e-3)


def test_option_endpoint():
    c = TestClient(app)
    r = c.post("/api/advanced/option", json={"S": 100, "K": 100, "T": 1, "r": 0, "sigma": 0.2})
    assert r.status_code == 200
    assert r.json()["price"] == pytest.approx(7.9656, abs=1e-2)


def test_projects_crud():
    c = TestClient(app)
    r = c.post("/api/projects", json={"name": "Test Project", "ticker": "test"})
    assert r.status_code == 200
    pid = r.json()["id"]
    r = c.get(f"/api/projects/{pid}")
    assert r.status_code == 200
    assert r.json()["ticker"] == "TEST"
    r = c.delete(f"/api/projects/{pid}")
    assert r.status_code == 200


def test_saved_models_crud():
    c = TestClient(app)
    body = {
        "name": "LBO snapshot",
        "kind": "lbo",
        "ticker": "test",
        "assumptions": {"entry_ebitda": 100, "entry_multiple": 8},
        "results": {"moic": 2.4},
    }
    r = c.post("/api/projects/models/saved", json=body)
    assert r.status_code == 200
    mid = r.json()["id"]

    r = c.get(f"/api/projects/models/saved/{mid}")
    assert r.status_code == 200
    saved = r.json()
    assert saved["kind"] == "lbo"
    assert saved["assumptions"]["entry_ebitda"] == 100

    r = c.get("/api/projects/models/saved")
    assert r.status_code == 200
    assert any(row["id"] == mid for row in r.json())

    updated = {**body, "name": "LBO snapshot v2", "results": {"moic": 2.6}}
    r = c.put(f"/api/projects/models/saved/{mid}", json=updated)
    assert r.status_code == 200
    assert c.get(f"/api/projects/models/saved/{mid}").json()["name"] == "LBO snapshot v2"

    r = c.delete(f"/api/projects/models/saved/{mid}")
    assert r.status_code == 200
    assert c.get(f"/api/projects/models/saved/{mid}").status_code == 404


def test_forecast_endpoint_balances(client):
    r = client.post("/api/forecast/TEST", json={"years": 5, "assumptions": {}})
    assert r.status_code == 200
    data = r.json()
    assert data["summary"]["balance_ok"] is True
    assert data["summary"]["max_balance_check"] < 1.0
    assert len(data["periods"]) == 5


def test_reverse_dcf_endpoint():
    c = TestClient(app)
    flows = [100.0, 110.0, 121.0]
    forward = c.post(
        "/api/valuation/dcf",
        json={"fcf": flows, "wacc": 0.10, "terminal_growth": 0.025, "net_debt": 50, "shares": 10},
    ).json()
    r = c.post(
        "/api/valuation/reverse-dcf",
        json={
            "fcf": flows,
            "current_price": forward["value_per_share"],
            "shares": 10,
            "net_debt": 50,
            "terminal_growth": 0.025,
        },
    )
    assert r.status_code == 200
    assert r.json()["implied_wacc"] == pytest.approx(0.10, abs=1e-5)


def test_wacc_endpoint():
    c = TestClient(app)
    r = c.post(
        "/api/wacc",
        json={
            "risk_free": 0.04,
            "beta": 1.2,
            "market_premium": 0.06,
            "cost_of_debt": 0.08,
            "tax_rate": 0.25,
            "equity_weight": 0.6,
            "debt_weight": 0.4,
        },
    )
    assert r.status_code == 200
    assert r.json()["wacc"] == pytest.approx(0.6 * 0.112 + 0.4 * 0.06)


def test_lbo_endpoint_and_validation():
    c = TestClient(app)
    r = c.post(
        "/api/advanced/lbo",
        json={"entry_ebitda": 100, "entry_multiple": 8, "exit_multiple": 9, "hold_years": 5},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["moic"] is not None
    assert len(data["schedule"]) == 5

    r = c.post("/api/advanced/lbo", json={"entry_ebitda": 0, "entry_multiple": 8, "exit_multiple": 9})
    assert r.status_code == 422


def test_bond_endpoint():
    c = TestClient(app)
    r = c.post("/api/advanced/bond", json={"face": 1000, "coupon_rate": 0.05, "ytm": 0.05, "years": 10, "freq": 2})
    assert r.status_code == 200
    assert r.json()["price"] == pytest.approx(1000.0, abs=1e-6)


def test_exports_return_files():
    c = TestClient(app)
    payload = {
        "ticker": "TEST",
        "title": "Test & Co <report>",
        "forecast": {"periods": [{"year": 1, "revenue": 100.0, "ebitda": 25.0, "net_income": 10.0, "fcf": 8.0}]},
        "dcf": {"wacc": 0.1, "value_per_share": 42.0, "warnings": []},
        "report": {"executive_summary": "Solid & <safe> text"},
    }
    r = c.post("/api/export/xlsx", json=payload)
    assert r.status_code == 200
    assert r.content[:2] == b"PK"
    assert "spreadsheetml" in r.headers["content-type"]

    r = c.post("/api/export/pdf", json=payload)
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")
    assert r.headers["content-type"] == "application/pdf"


def test_jobs_endpoint_returns_list():
    c = TestClient(app)
    r = c.get("/api/ai/jobs?limit=5")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_ai_model_crud_masks_key():
    c = TestClient(app)
    body = {
        "name": "Test Provider",
        "provider": "openai_compatible",
        "model_id": "test-model",
        "base_url": "http://127.0.0.1:9/v1",
        "api_key": "super-secret",
        "enabled": True,
    }
    r = c.post("/api/ai/models", json=body)
    assert r.status_code == 200
    try:
        r = c.post("/api/ai/models", json=body)
        assert r.status_code == 409

        listed = c.get("/api/ai/models").json()
        model = next(row for row in listed if row["name"] == "Test Provider")
        assert model["has_key"] is True
        assert model["source"] == "db"
        assert "api_key" not in model

        r = c.put("/api/ai/models/Test%20Provider", json={"enabled": False})
        assert r.status_code == 200
        assert r.json()["enabled"] is False
        listed = c.get("/api/ai/models").json()
        assert next(row for row in listed if row["name"] == "Test Provider")["enabled"] is False

        missing_base = {k: v for k, v in body.items() if k != "base_url"}
        missing_base["name"] = "No Base"
        assert c.post("/api/ai/models", json=missing_base).status_code == 422
    finally:
        r = c.delete("/api/ai/models/Test%20Provider")
        assert r.status_code == 200
