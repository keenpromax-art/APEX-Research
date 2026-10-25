from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import Partner, PartnerArtifact, ReportRun, SessionLocal, init_db
from app.main import app


def _cleanup(name: str) -> None:
    db = SessionLocal()
    try:
        rows = db.query(Partner).filter(Partner.name == name).all()
        for row in rows:
            db.query(PartnerArtifact).filter(PartnerArtifact.partner_id == row.id).delete()
            db.delete(row)
        db.commit()
    finally:
        db.close()


def _create_report(title: str = "Partner fixture report") -> int:
    db = SessionLocal()
    try:
        row = ReportRun(
            ticker="PTEST",
            company_name="Partner Test Co",
            title=title,
            report_type="quick",
            status="complete",
            rating="HOLD",
            target_price=12.0,
            current_price=10.0,
            currency="USD",
            horizon="12M",
            config={"report_type": "quick"},
            payload={"rating": {"code": "HOLD", "target_price": 12.0}, "price": {"current": 10.0}},
            warnings=[],
            source_snapshot={},
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row.id
    finally:
        db.close()


def _delete_report(report_id: int) -> None:
    db = SessionLocal()
    try:
        db.query(PartnerArtifact).filter(PartnerArtifact.report_run_id == report_id).delete()
        row = db.get(ReportRun, report_id)
        if row is not None:
            db.delete(row)
        db.commit()
    finally:
        db.close()


def test_partner_artifact_lifecycle(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "partner_admin_token", "test-admin-token")
    _cleanup("Partner Lifecycle Co")
    report_id = _create_report()
    client = TestClient(app)
    api_key = None
    try:
        created = client.post(
            "/api/partners",
            json={"name": "Partner Lifecycle Co", "contact_email": "partner@example.com"},
            headers={"X-APEX-Admin-Token": "test-admin-token"},
        )
        assert created.status_code == 201, created.text
        body = created.json()
        api_key = body["api_key"]
        assert body["partner"]["api_key_prefix"] == api_key[:8]

        no_admin = client.get("/api/partners")
        assert no_admin.status_code in (401, 503)
        bad_key = client.get("/api/partner/artifacts", headers={"X-API-Key": "bad"})
        assert bad_key.status_code == 401

        grant = client.post(
            f"/api/partners/{body['partner']['id']}/artifacts",
            json={"report_run_id": report_id, "external_id": "partner-report-1", "status": "published"},
            headers={"X-APEX-Admin-Token": "test-admin-token"},
        )
        assert grant.status_code == 201, grant.text

        listing = client.get("/api/partner/artifacts", headers={"X-API-Key": api_key})
        assert listing.status_code == 200
        assert len(listing.json()["items"]) == 1

        detail = client.get("/api/partner/artifacts/partner-report-1", headers={"X-API-Key": api_key})
        assert detail.status_code == 200
        assert detail.json()["payload"]["rating"]["target_price"] == 12.0
        assert detail.json()["report_run"]["ticker"] == "PTEST"

        updated = client.patch(
            "/api/partner/artifacts/partner-report-1",
            json={"title": "Partner-facing title", "notes": "Partner note", "status": "reviewed"},
            headers={"X-API-Key": api_key},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["title"] == "Partner-facing title"

        pdf = client.get("/api/partner/artifacts/partner-report-1/pdf", headers={"X-API-Key": api_key})
        assert pdf.status_code == 410  # fixture has no stored PDF

        versions = client.get("/api/partner/artifacts/partner-report-1/versions", headers={"X-API-Key": api_key})
        assert versions.status_code == 200
        assert any(row["id"] == report_id for row in versions.json())
    finally:
        _cleanup("Partner Lifecycle Co")
        _delete_report(report_id)
