"""Partner-facing API for immutable report artifacts.

Partners authenticate with a server-issued API key. They can view reports,
payloads, source snapshots, QA warnings, PDFs and prior versions, and can
update only partner-facing metadata on their own artifact copy. The immutable
ReportRun row and PDF are never overwritten by this API.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import AuditLog, Partner, PartnerArtifact, ReportRun, get_session

router = APIRouter(tags=["partners"])


class PartnerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    contact_email: str | None = Field(default=None, max_length=320)
    enabled: bool = True


class PartnerUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    contact_email: str | None = Field(default=None, max_length=320)
    enabled: bool | None = None


class ArtifactGrant(BaseModel):
    report_run_id: int = Field(ge=1)
    external_id: str = Field(min_length=1, max_length=120)
    title: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=4000)
    status: str = Field(default="published", max_length=40)


class ArtifactUpdate(BaseModel):
    external_id: str | None = Field(default=None, min_length=1, max_length=120)
    title: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=4000)
    status: str | None = Field(default=None, max_length=40)


def _hash_key(api_key: str) -> str:
    return hashlib.sha256((api_key + get_settings().secret_key).encode("utf-8")).hexdigest()


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _require_admin(token: str | None) -> None:
    expected = get_settings().partner_admin_token
    if not expected:
        raise HTTPException(status_code=503, detail="Partner API administration is disabled: set PARTNER_ADMIN_TOKEN.")
    if not token or not secrets.compare_digest(str(token), expected):
        raise HTTPException(status_code=401, detail="Invalid or missing X-APEX-Admin-Token.")


def _partner_from_key(api_key: str | None, db: Session) -> Partner:
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key.")
    row = db.query(Partner).filter(Partner.api_key_hash == _hash_key(api_key)).first()
    if row is None or not row.enabled:
        raise HTTPException(status_code=401, detail="Invalid or disabled partner key.")
    return row


def _artifact_or_404(partner: Partner, external_id: str, db: Session) -> tuple[PartnerArtifact, ReportRun]:
    artifact = (
        db.query(PartnerArtifact)
        .filter(PartnerArtifact.partner_id == partner.id, PartnerArtifact.external_id == external_id)
        .first()
    )
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found for this partner.")
    report = db.get(ReportRun, artifact.report_run_id)
    if report is None:
        raise HTTPException(status_code=410, detail="Underlying report artifact is no longer available.")
    return artifact, report


def _partner_summary(row: Partner) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "contact_email": row.contact_email,
        "enabled": bool(row.enabled),
        "api_key_prefix": row.api_key_prefix,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _artifact_summary(artifact: PartnerArtifact, report: ReportRun) -> dict[str, Any]:
    payload = report.payload or {}
    return {
        "external_id": artifact.external_id,
        "status": artifact.status,
        "title": artifact.title or report.title,
        "notes": artifact.notes,
        "partner_updated_at": artifact.updated_at.isoformat() if artifact.updated_at else None,
        "report_run": {
            "id": report.id,
            "ticker": report.ticker,
            "company_name": report.company_name,
            "report_type": report.report_type,
            "version_status": report.status,
            "rating": report.rating,
            "target_price": report.target_price,
            "current_price": report.current_price,
            "currency": report.currency,
            "horizon": report.horizon,
            "ai_model": report.ai_model,
            "page_count": report.page_count,
            "pdf_size": report.pdf_size,
            "previous_version_id": report.previous_version_id,
            "warnings": report.warnings or [],
            "pdf_qa": payload.get("pdf_qa") or [],
            "created_at": report.created_at.isoformat() if report.created_at else None,
            "updated_at": report.updated_at.isoformat() if report.updated_at else None,
        },
    }


@router.post("/api/partners", status_code=201)
def create_partner(
    body: PartnerCreate,
    admin_token: str | None = Header(default=None, alias="X-APEX-Admin-Token"),
    db: Session = Depends(get_session),
):
    _require_admin(admin_token)
    api_key = secrets.token_urlsafe(32)
    row = Partner(
        name=body.name.strip(),
        contact_email=body.contact_email,
        enabled=1 if body.enabled else 0,
        api_key_hash=_hash_key(api_key),
        api_key_prefix=api_key[:8],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    db.add(AuditLog(action="partner.create", entity=f"partner:{row.id}", detail={"name": row.name}))
    db.commit()
    # The plaintext key is returned exactly once and never stored or logged.
    return {"partner": _partner_summary(row), "api_key": api_key}


@router.get("/api/partners")
def list_partners(
    admin_token: str | None = Header(default=None, alias="X-APEX-Admin-Token"),
    db: Session = Depends(get_session),
):
    _require_admin(admin_token)
    rows = db.query(Partner).order_by(Partner.id.desc()).all()
    return [_partner_summary(row) for row in rows]


@router.patch("/api/partners/{partner_id}")
def update_partner(
    partner_id: int,
    body: PartnerUpdate,
    admin_token: str | None = Header(default=None, alias="X-APEX-Admin-Token"),
    db: Session = Depends(get_session),
):
    _require_admin(admin_token)
    row = db.get(Partner, partner_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Partner not found.")
    if body.name is not None:
        row.name = body.name.strip()
    if body.contact_email is not None:
        row.contact_email = body.contact_email
    if body.enabled is not None:
        row.enabled = 1 if body.enabled else 0
    db.commit()
    db.refresh(row)
    return _partner_summary(row)


@router.post("/api/partners/{partner_id}/artifacts", status_code=201)
def grant_artifact(
    partner_id: int,
    body: ArtifactGrant,
    admin_token: str | None = Header(default=None, alias="X-APEX-Admin-Token"),
    db: Session = Depends(get_session),
):
    _require_admin(admin_token)
    partner = db.get(Partner, partner_id)
    if partner is None:
        raise HTTPException(status_code=404, detail="Partner not found.")
    report = db.get(ReportRun, body.report_run_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report artifact not found.")
    row = PartnerArtifact(
        partner_id=partner.id,
        report_run_id=report.id,
        external_id=body.external_id.strip(),
        title=body.title,
        notes=body.notes,
        status=body.status,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="This report or external_id is already granted to the partner.") from error
    db.refresh(row)
    db.add(AuditLog(action="partner.artifact.grant", entity=f"partner:{partner.id}", detail={"external_id": row.external_id, "report_run_id": report.id}))
    db.commit()
    return _artifact_summary(row, report)


@router.get("/api/partner/artifacts")
def list_partner_artifacts(
    status: str | None = None,
    ticker: str | None = None,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    api_key: str | None = Header(default=None, alias="X-API-Key"),
    db: Session = Depends(get_session),
):
    partner = _partner_from_key(api_key, db)
    query = (
        db.query(PartnerArtifact, ReportRun)
        .join(ReportRun, PartnerArtifact.report_run_id == ReportRun.id)
        .filter(PartnerArtifact.partner_id == partner.id)
        .order_by(ReportRun.id.desc())
    )
    if status:
        query = query.filter(PartnerArtifact.status == status)
    if ticker:
        query = query.filter(ReportRun.ticker == ticker.strip().upper())
    rows = query.offset(offset).limit(limit).all()
    return {
        "partner": {"id": partner.id, "name": partner.name},
        "limit": limit,
        "offset": offset,
        "items": [_artifact_summary(artifact, report) for artifact, report in rows],
    }


@router.get("/api/partner/artifacts/{external_id}")
def get_partner_artifact(
    external_id: str,
    include_versions: bool = Query(default=False),
    api_key: str | None = Header(default=None, alias="X-API-Key"),
    db: Session = Depends(get_session),
):
    partner = _partner_from_key(api_key, db)
    artifact, report = _artifact_or_404(partner, external_id, db)
    result = {
        **_artifact_summary(artifact, report),
        "payload": report.payload,
        "config": report.config,
        "source_snapshot": report.source_snapshot,
    }
    if include_versions:
        query = (
            db.query(ReportRun)
            .filter(
                ReportRun.ticker == report.ticker,
                ReportRun.report_type == report.report_type,
            )
            .order_by(ReportRun.id.desc())
        )
        result["versions"] = [
            {
                "id": row.id,
                "status": row.status,
                "rating": row.rating,
                "target_price": row.target_price,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "previous_version_id": row.previous_version_id,
                "page_count": row.page_count,
            }
            for row in query.limit(25).all()
        ]
    return result


@router.get("/api/partner/artifacts/{external_id}/pdf")
def get_partner_artifact_pdf(
    external_id: str,
    download: bool = True,
    api_key: str | None = Header(default=None, alias="X-API-Key"),
    db: Session = Depends(get_session),
):
    partner = _partner_from_key(api_key, db)
    _artifact, report = _artifact_or_404(partner, external_id, db)
    if not report.pdf:
        raise HTTPException(status_code=410, detail="This artifact has no stored PDF.")
    filename = f"apex-research-{report.ticker}-{report.id}.pdf"
    return Response(
        content=report.pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'{"attachment" if download else "inline"}; filename="{filename}"'},
    )


@router.get("/api/partner/artifacts/{external_id}/versions")
def list_partner_versions(
    external_id: str,
    limit: int = Query(default=25, ge=1, le=100),
    api_key: str | None = Header(default=None, alias="X-API-Key"),
    db: Session = Depends(get_session),
):
    partner = _partner_from_key(api_key, db)
    _artifact, report = _artifact_or_404(partner, external_id, db)
    rows = (
        db.query(ReportRun)
        .filter(ReportRun.ticker == report.ticker, ReportRun.report_type == report.report_type)
        .order_by(ReportRun.id.desc())
        .limit(limit)
        .all()
    )
    artifact_rows = _partner_artifacts(partner, db)
    granted_ids = {row.report_run_id for row in artifact_rows}
    return [
        {
            "id": row.id,
            "status": row.status,
            "rating": row.rating,
            "target_price": row.target_price,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "previous_version_id": row.previous_version_id,
            "page_count": row.page_count,
            "is_granted": row.id in granted_ids,
        }
        for row in rows
    ]


def _partner_artifacts(partner: Partner, db: Session) -> list[PartnerArtifact]:
    return db.query(PartnerArtifact).filter(PartnerArtifact.partner_id == partner.id).all()


@router.patch("/api/partner/artifacts/{external_id}")
def update_partner_artifact(
    external_id: str,
    body: ArtifactUpdate,
    api_key: str | None = Header(default=None, alias="X-API-Key"),
    db: Session = Depends(get_session),
):
    partner = _partner_from_key(api_key, db)
    artifact, report = _artifact_or_404(partner, external_id, db)
    if body.external_id is not None and body.external_id != artifact.external_id:
        exists = (
            db.query(PartnerArtifact)
            .filter(
                PartnerArtifact.partner_id == partner.id,
                PartnerArtifact.external_id == body.external_id,
            )
            .first()
        )
        if exists is not None:
            raise HTTPException(status_code=409, detail="Partner external_id is already in use.")
        artifact.external_id = body.external_id.strip()
    if body.title is not None:
        artifact.title = body.title.strip()
    if body.notes is not None:
        artifact.notes = body.notes
    if body.status is not None:
        artifact.status = body.status.strip()
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Partner external_id is already in use.") from error
    db.refresh(artifact)
    db.add(AuditLog(action="partner.artifact.update", entity=f"partner:{partner.id}", detail={"external_id": artifact.external_id, "report_run_id": report.id}))
    db.commit()
    return _artifact_summary(artifact, report)
