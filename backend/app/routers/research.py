from __future__ import annotations

import io
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import AuditLog, ReportRun, get_session
from ..exceptions import DataError, TickerNotFoundError
from ..services.ai_state import get_gateway
from ..services import report_narrative
from ..services.pdf_qa import run_pdf_qa
from ..services.pdf_report import build_research_pdf
from ..services.report_engine import DEFAULT_CONFIG, build_report_payload, run_qa
from ..services.yfinance_adapter import RateLimitedError
from .ai import load_from_db

router = APIRouter(prefix="/api/research", tags=["research"])


class ResearchIn(BaseModel):
    ticker: str = Field(min_length=1, max_length=40)
    report_type: str = Field(default="full", pattern="^(quick|full)$")
    title: str | None = Field(default=None, max_length=300)
    years: int = Field(default=5, ge=1, le=10)
    horizon: str = Field(default="12M", max_length=20)
    terminal_mode: str = Field(default="growth", pattern="^(growth|multiple)$")
    terminal_growth: float = Field(default=0.025, ge=-0.05, le=0.10)
    exit_multiple: float = Field(default=10.0, ge=0.5, le=100.0)
    wacc: float | None = Field(default=None, ge=0.0001, le=1.0)
    wacc_inputs: dict[str, float] | None = None
    assumptions: dict[str, Any] | None = None
    rating_mode: str = Field(default="auto", pattern="^(auto|manual)$")
    manual_rating: str | None = Field(default=None, max_length=20)
    manual_target_price: float | None = Field(default=None, ge=0)
    ai_model: str | None = Field(default=None, max_length=200)
    force_refresh: bool = False
    project_id: int | None = Field(default=None, ge=1)
    peers: list[str] | None = None
    source_documents: list[dict[str, str]] | None = None
    report_date: str | None = Field(default=None, max_length=10)


class RebuildIn(BaseModel):
    config: dict[str, Any] | None = None


def _to_engine_config(body: ResearchIn) -> dict[str, Any]:
    cfg = dict(DEFAULT_CONFIG)  # start from documented defaults
    cfg.update(
        {
            "ticker": body.ticker.strip().upper(),
            "report_type": body.report_type,
            "title": body.title,
            "years": body.years,
            "horizon": body.horizon,
            "terminal_mode": body.terminal_mode,
            "terminal_growth": body.terminal_growth,
            "exit_multiple": body.exit_multiple,
            "rating_mode": body.rating_mode,
            "manual_rating": body.manual_rating,
            "manual_target_price": body.manual_target_price,
            "ai_model": body.ai_model,
            "force_refresh": bool(body.force_refresh),
        }
    )
    if body.peers:
        cfg["peers"] = [str(p).strip().upper() for p in body.peers if str(p).strip()][:10]
    if body.source_documents:
        cfg["source_documents"] = body.source_documents[:20]
    if body.report_date:
        cfg["report_date"] = body.report_date.strip()[:10]
    if body.wacc is not None:
        cfg["wacc"] = body.wacc
    if body.wacc_inputs:
        cfg["wacc_inputs"] = {k: v for k, v in body.wacc_inputs.items() if isinstance(v, (int, float))}
    if body.assumptions:
        cfg["assumptions"] = body.assumptions
    return cfg


def _http_for_data(error: Exception) -> HTTPException:
    if isinstance(error, RateLimitedError):
        return HTTPException(status_code=503, detail=str(error))
    if isinstance(error, TickerNotFoundError):
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, DataError):
        return HTTPException(status_code=502, detail=str(error))
    return HTTPException(status_code=500, detail=f"Report generation failed: {error}")


def _resolve_ai_model(name: str | None, db: Session):
    """Return (name, ModelConfig | None); never blocks the deterministic report."""
    load_from_db(db)
    gateway = get_gateway()
    if name:
        config = gateway.get(name)
        if config is None:
            raise HTTPException(status_code=404, detail=f"AI model '{name}' not found")
        if not config.enabled:
            raise HTTPException(status_code=400, detail=f"AI model '{name}' is disabled")
        return name, config
    enabled = [model for model in gateway.list_models() if model["enabled"]]
    if not enabled:
        return None, None
    return enabled[0]["name"], gateway.get(enabled[0]["name"])


def _page_count(pdf: bytes) -> int | None:
    try:
        from pypdf import PdfReader

        return len(PdfReader(io.BytesIO(pdf)).pages)
    except Exception:
        return None


def _summary(row: ReportRun) -> dict[str, Any]:
    return {
        "id": row.id,
        "ticker": row.ticker,
        "company_name": row.company_name,
        "title": row.title,
        "report_type": row.report_type,
        "status": row.status,
        "rating": row.rating,
        "target_price": row.target_price,
        "current_price": row.current_price,
        "upside": (row.payload or {}).get("rating", {}).get("upside"),
        "currency": row.currency,
        "horizon": row.horizon,
        "ai_model": row.ai_model,
        "page_count": row.page_count,
        "pdf_size": row.pdf_size,
        "previous_version_id": row.previous_version_id,
        "project_id": row.project_id,
        "warnings": row.warnings or [],
        "pdf_qa": (row.payload or {}).get("pdf_qa") or [],
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _generate(body: ResearchIn, db: Session) -> ReportRun:
    cfg = _to_engine_config(body)
    ticker = cfg["ticker"]
    try:
        payload = build_report_payload(ticker, cfg)
    except (RateLimitedError, TickerNotFoundError, DataError) as error:
        raise _http_for_data(error) from error

    warnings: list[str] = []
    ai_model_name = None
    ai_config = None
    try:
        ai_model_name, ai_config = _resolve_ai_model(body.ai_model, db)
    except HTTPException:
        raise
    if ai_config is not None:
        cfg["ai_model"] = ai_model_name or cfg.get("ai_model")
        narrative, narrative_warnings = report_narrative.generate_narrative(get_gateway(), ai_config, payload)
        warnings.extend(narrative_warnings)
        if narrative:
            payload["narrative"] = narrative
            payload["narrative_model"] = ai_model_name
    elif body.ai_model:
        warnings.append(f"AI model '{body.ai_model}' is not configured; the report contains deterministic content only.")

    qc_issues = run_qa(payload, cfg)
    payload["qc"] = qc_issues

    levels = {issue.get("level") for issue in qc_issues}
    if "error" in levels:
        status = "failed"
    elif (payload.get("rating") or {}).get("code") in (None, "NOT RATED") or "warning" in levels or warnings:
        status = "preliminary"
    else:
        status = "complete"

    try:
        pdf = build_research_pdf(payload, cfg)
    except (RateLimitedError, TickerNotFoundError, DataError) as error:
        raise _http_for_data(error) from error

    pdf_issues = run_pdf_qa(pdf, payload, cfg)
    payload["pdf_qa"] = pdf_issues
    pdf_levels = {issue.get("level") for issue in pdf_issues}
    if "error" in pdf_levels:
        status = "failed"
        for issue in pdf_issues:
            if issue.get("level") == "error":
                qc_issues.append(issue)
    else:
        qc_issues.extend(issue for issue in pdf_issues if issue.get("level") == "warning")

    rating = payload.get("rating") or {}
    meta = payload.get("meta") or {}
    price = payload.get("price") or {}
    snapshot = {
        "sources": payload.get("sources") or [],
        "data_quality": payload.get("data_quality") or {},
        "fiscal_note": payload.get("historical", {}).get("fiscal_note"),
        "periods": payload.get("historical", {}).get("periods"),
    }
    row = ReportRun(
        ticker=ticker,
        company_name=meta.get("name") or ticker,
        title=(body.title or f"{meta.get('name') or ticker} — {rating.get('code') or 'NOT RATED'} ({body.report_type})")[:300],
        report_type=body.report_type,
        status=status,
        rating=(rating.get("code") or "NOT RATED"),
        target_price=rating.get("target_price"),
        current_price=price.get("current"),
        currency=meta.get("currency"),
        horizon=(rating.get("horizon") or body.horizon),
        ai_model=ai_model_name,
        config=cfg,
        payload=payload,
        warnings=warnings,
        source_snapshot=snapshot,
        project_id=body.project_id,
        pdf=pdf,
        pdf_size=len(pdf),
        page_count=_page_count(pdf),
    )
    db.add(row)
    db.add(AuditLog(action="research.generate", entity=f"report:{ticker}", detail={"status": status, "rating": row.rating}))
    db.commit()
    db.refresh(row)
    return row


@router.post("/generate")
def generate_report(body: ResearchIn, db: Session = Depends(get_session)):
    row = _generate(body, db)
    return _summary(row)


@router.post("/reports/{report_id}/rebuild")
def rebuild_report(report_id: int, body: RebuildIn | None = None, db: Session = Depends(get_session)):
    previous = db.get(ReportRun, report_id)
    if previous is None:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")
    cfg = dict(previous.config or {})
    if body and body.config:
        cfg.update({k: v for k, v in body.config.items() if k != "ticker"})
    regenerated = ResearchIn(
        ticker=previous.ticker,
        report_type=cfg.get("report_type") or "full",
        title=previous.title,
        years=int(cfg.get("years") or 5),
        horizon=str(cfg.get("horizon") or "12M"),
        terminal_mode=str(cfg.get("terminal_mode") or "growth"),
        terminal_growth=float(cfg.get("terminal_growth") or 0.025),
        exit_multiple=float(cfg.get("exit_multiple") or 10.0),
        wacc=cfg.get("wacc"),
        wacc_inputs=cfg.get("wacc_inputs"),
        assumptions=cfg.get("assumptions"),
        rating_mode=str(cfg.get("rating_mode") or "auto"),
        manual_rating=cfg.get("manual_rating"),
        manual_target_price=cfg.get("manual_target_price"),
        ai_model=cfg.get("ai_model"),
        force_refresh=bool(cfg.get("force_refresh")),
        project_id=previous.project_id,
    )
    row = _generate(regenerated, db)
    row.previous_version_id = previous.id
    db.commit()
    db.refresh(row)
    return _summary(row)


@router.get("/reports")
def list_reports(ticker: str | None = None, limit: int = 25, db: Session = Depends(get_session)):
    query = db.query(ReportRun)
    if ticker:
        query = query.filter(ReportRun.ticker == ticker.strip().upper())
    rows = query.order_by(ReportRun.id.desc()).limit(max(1, min(limit, 100))).all()
    return [_summary(row) for row in rows]


@router.get("/reports/{report_id}")
def get_report(report_id: int, db: Session = Depends(get_session)):
    row = db.get(ReportRun, report_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")
    return {**_summary(row), "config": row.config, "payload": row.payload, "source_snapshot": row.source_snapshot}


@router.get("/reports/{report_id}/pdf")
def get_report_pdf(report_id: int, download: bool = True, db: Session = Depends(get_session)):
    row = db.get(ReportRun, report_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")
    if not row.pdf:
        raise HTTPException(status_code=410, detail="This report has no stored PDF")
    filename = f"apex-research-{row.ticker}-{row.id}.pdf"
    headers = {"Content-Disposition": f'{"attachment" if download else "inline"}; filename="{filename}"'}
    return Response(content=row.pdf, media_type="application/pdf", headers=headers)


@router.get("/reports/{report_id}/preview")
def get_report_preview(report_id: int, max_pages: int = 12, db: Session = Depends(get_session)):
    """Render the stored PDF to PNG page images (base64 data URLs) for in-browser preview."""
    import base64

    row = db.get(ReportRun, report_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")
    if not row.pdf:
        raise HTTPException(status_code=410, detail="This report has no stored PDF")
    try:
        import pymupdf  # type: ignore
    except Exception as error:
        raise HTTPException(status_code=501, detail="PDF preview renderer unavailable on this host") from error
    try:
        doc = pymupdf.open(stream=row.pdf, filetype="pdf")
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Stored PDF could not be opened: {error}") from error
    try:
        limit = max(1, min(int(max_pages or 12), doc.page_count, 20))
        pages = []
        for index in range(limit):
            pix = doc[index].get_pixmap(dpi=100)
            encoded = base64.b64encode(pix.tobytes("png")).decode("ascii")
            pages.append({
                "number": index + 1,
                "width": pix.width,
                "height": pix.height,
                "image": f"data:image/png;base64,{encoded}",
            })
        return {"id": row.id, "page_count": doc.page_count, "rendered": len(pages), "pages": pages}
    finally:
        doc.close()


@router.delete("/reports/{report_id}")
def delete_report(report_id: int, db: Session = Depends(get_session)):
    row = db.get(ReportRun, report_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")
    db.add(AuditLog(action="research.delete", entity=f"report:{row.ticker}", detail={"id": row.id, "title": row.title}))
    db.delete(row)
    db.commit()
    return {"deleted": report_id}
