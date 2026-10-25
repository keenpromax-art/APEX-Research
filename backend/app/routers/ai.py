from __future__ import annotations

import json
from typing import Any, Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import AIProviderConfig, ResearchJob, SessionLocal, get_session
from ..config import get_settings
from ..exceptions import AIError, AITimeoutError, DataError, TickerNotFoundError
from ..services.ai_gateway import ModelConfig
from ..services.ai_state import get_gateway, seed_from_env
from ..services.data_access import load_normalized
from ..services.note_engine import build_note_payload_from_data
from ..services.note_narrative import (
    build_facts,
    build_research_messages,
    figure_correction_message,
    validate_report_figures,
)
from ..services.yfinance_adapter import RateLimitedError

router = APIRouter(prefix="/api/ai", tags=["ai"])


class ProviderIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider: str = Field(min_length=1, max_length=60)
    model_id: str = Field(min_length=1, max_length=200)
    base_url: str | None = None
    api_key: str | None = None
    capabilities: dict[str, bool] = Field(default_factory=dict)
    params: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class ProviderUpdate(BaseModel):
    model_id: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    capabilities: dict[str, bool] | None = None
    params: dict[str, Any] | None = None
    enabled: bool | None = None


class ResearchIn(BaseModel):
    ticker: str = Field(min_length=1, max_length=40)
    model: str | None = None
    temperature: float = 0.3
    max_tokens: int = 4096
    years: int | None = Field(default=None, ge=1, le=10)
    horizon: str | None = Field(default=None, max_length=20)
    terminal_mode: str | None = Field(default=None, pattern="^(growth|multiple)$")
    terminal_growth: float | None = Field(default=None, ge=-0.05, le=0.10)
    exit_multiple: float | None = Field(default=None, ge=0.5, le=100.0)
    wacc: float | None = Field(default=None, ge=0.0001, le=1.0)
    wacc_inputs: dict[str, Any] | None = None
    assumptions: dict[str, Any] | None = None


def _to_config(row: AIProviderConfig) -> ModelConfig:
    return ModelConfig(
        name=row.name,
        provider=row.provider,
        model_id=row.model_id,
        base_url=row.base_url,
        api_key=row.api_key_encrypted,
        capabilities=row.capabilities or {},
        params=row.params or {},
        enabled=bool(row.enabled),
        source="db",
    )


def load_from_db(db: Session) -> None:
    gateway = get_gateway()
    for model in list(gateway.list_models()):
        gateway.unregister(model["name"])
    seed_from_env()
    for row in db.query(AIProviderConfig).all():
        gateway.register(_to_config(row))


def _model_or_404(name: str | None, db: Session) -> tuple[str, ModelConfig]:
    load_from_db(db)
    gateway = get_gateway()
    if not name:
        enabled = [model for model in gateway.list_models() if model["enabled"]]
        if not enabled:
            raise HTTPException(status_code=400, detail="No AI models configured. Add one in the AI Control Center.")
        name = enabled[0]["name"]
    config = gateway.get(name)
    if config is None:
        raise HTTPException(status_code=404, detail=f"Model '{name}' not found")
    if not config.enabled:
        raise HTTPException(status_code=400, detail=f"Model '{name}' is disabled")
    return name, config


def _ai_http(error: Exception) -> HTTPException:
    if isinstance(error, AITimeoutError):
        return HTTPException(status_code=504, detail=str(error))
    if isinstance(error, AIError):
        return HTTPException(status_code=502, detail=str(error))
    return HTTPException(status_code=500, detail=f"AI generation failed: {error}")


def _note_config(body: ResearchIn) -> dict[str, Any]:
    return {
        "years": body.years or 3,
        "horizon": body.horizon or "12M",
        "terminal_mode": body.terminal_mode or "growth",
        "terminal_growth": body.terminal_growth if body.terminal_growth is not None else 0.025,
        "exit_multiple": body.exit_multiple if body.exit_multiple is not None else 10.0,
        "wacc": body.wacc,
        "wacc_inputs": body.wacc_inputs or {},
        "assumptions": body.assumptions or {},
    }


def _data_http(error: Exception) -> HTTPException:
    if isinstance(error, RateLimitedError):
        return HTTPException(status_code=503, detail=str(error))
    if isinstance(error, TickerNotFoundError):
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, DataError):
        return HTTPException(status_code=502, detail=str(error))
    return HTTPException(status_code=500, detail=f"Data fetch failed: {error}")


def _parse_json(content: str) -> dict[str, Any]:
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text[:-3]
    start = text.find("{")
    end = text.rfind("}")
    candidate = text[start : end + 1] if start >= 0 and end > start else text
    try:
        parsed = json.loads(candidate)
    except Exception:
        return {"executive_summary": content, "raw": content}
    if not isinstance(parsed, dict):
        return {"executive_summary": content, "raw": content}
    return parsed


def _create_job(db: Session, ticker: str) -> int:
    job = ResearchJob(ticker=ticker.upper(), status="running", progress=10)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job.id


def _finish_job(
    job_id: int,
    status: str,
    *,
    result: dict[str, Any] | None = None,
    error: str | None = None,
    progress: int = 100,
) -> None:
    db = SessionLocal()
    try:
        job = db.query(ResearchJob).filter(ResearchJob.id == job_id).first()
        if job is not None:
            job.status = status
            job.progress = progress
            job.result = result
            job.error = error
            db.commit()
    finally:
        db.close()


def _load_research_inputs(
    ticker: str,
    note_config: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], list[dict[str, str]], dict[str, Any]]:
    try:
        normalized, metrics = load_normalized(ticker)
    except DataError as error:
        raise _data_http(error)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Data fetch failed: {error}")
    try:
        note_payload = build_note_payload_from_data(ticker, normalized, metrics, note_config)
    except DataError as error:
        raise _data_http(error)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Note model failed: {error}")
    return (
        normalized,
        metrics,
        note_payload,
        build_research_messages(ticker, normalized, metrics, note_payload),
        build_facts(ticker, normalized, metrics, note_payload),
    )


def _finalize_report(
    facts: dict[str, Any],
    messages: list[dict[str, str]],
    content: str,
    complete,  # callable(list[dict[str, str]]) -> str for the retry pass
    note_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Parse the AI note, then verify every figure against engine facts.

    One constrained retry repairs unverified figures; anything still
    unverified is attached as `figure_warnings` so the UI and PDF can
    surface it instead of silently trusting invented numbers.
    """
    report = _parse_json(content)
    warnings = validate_report_figures(report, facts)
    if warnings:
        report = _parse_json(complete(messages + [figure_correction_message(warnings)]))
        warnings = validate_report_figures(report, facts)
    report.setdefault(
        "disclaimer",
        "AI-assisted analysis. All financial figures come from the deterministic data engine; verify before investment use.",
    )
    if not report.get("sources_limitations") and note_payload:
        limitations: list[str] = []
        for gap in (note_payload.get("gaps") or [])[:6]:
            limitations.append(f"{gap.get('area')}: {gap.get('detail')}")
        forecast_status = "Forecast periods are deterministic model estimates (E), not guidance." if (note_payload.get("forecast") or {}).get("periods") else "No deterministic forecast is available for this company."
        limitations.append(forecast_status)
        limitations.append("All figures are provider-reported, engine-calculated or clearly labelled model estimates; no external source independently verifies them.")
        report["sources_limitations"] = limitations
    if warnings:
        report["figure_warnings"] = warnings
    return report


@router.get("/providers")
def providers():
    """Provider catalog with default base URLs so the UI matches the gateway."""
    settings = get_settings()
    return [
        {
            "provider": "openrouter",
            "label": "OpenRouter",
            "base_url": settings.openrouter_base_url,
            "requires_base_url": False,
            "model_hint": "deepseek/deepseek-chat-v3.1:free",
        },
        {
            "provider": "groq",
            "label": "Groq",
            "base_url": settings.groq_base_url,
            "requires_base_url": False,
            "model_hint": "llama-3.3-70b-versatile",
        },
        {
            "provider": "nvidia",
            "label": "NVIDIA NIM",
            "base_url": settings.nvidia_base_url,
            "requires_base_url": False,
            "model_hint": "meta/llama-3.1-70b-instruct",
        },
        {
            "provider": "openai_compatible",
            "label": "OpenAI-compatible",
            "base_url": None,
            "requires_base_url": True,
            "model_hint": "vendor/model-name",
        },
    ]


@router.get("/models")
def list_models(db: Session = Depends(get_session)):
    load_from_db(db)
    return get_gateway().list_models()


@router.post("/models")
def add_model(body: ProviderIn, db: Session = Depends(get_session)):
    load_from_db(db)
    name = body.name.strip()
    if get_gateway().get(name) is not None:
        raise HTTPException(status_code=409, detail=f"A model named '{name}' already exists")
    if body.provider == "openai_compatible" and not body.base_url:
        raise HTTPException(status_code=422, detail="base_url is required for openai_compatible providers")
    row = AIProviderConfig(
        name=name,
        provider=body.provider,
        model_id=body.model_id,
        base_url=body.base_url,
        api_key_encrypted=body.api_key,
        capabilities=body.capabilities or {},
        params=body.params or {},
        enabled=1 if body.enabled else 0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    get_gateway().register(_to_config(row))
    return {"id": row.id, "name": row.name}


@router.put("/models/{name}")
def update_model(name: str, body: ProviderUpdate, db: Session = Depends(get_session)):
    load_from_db(db)
    config = get_gateway().get(name)
    if config is None:
        raise HTTPException(status_code=404, detail="model not found")
    if config.source == "env":
        raise HTTPException(status_code=409, detail="Environment-provided models are managed by .env and cannot be edited here")
    row = db.query(AIProviderConfig).filter(AIProviderConfig.name == name).first()
    if row is None:
        raise HTTPException(status_code=404, detail="model not found")
    if body.model_id is not None:
        row.model_id = body.model_id
    if body.base_url is not None:
        row.base_url = body.base_url
    if body.api_key is not None:
        row.api_key_encrypted = body.api_key
    if body.capabilities is not None:
        row.capabilities = body.capabilities
    if body.params is not None:
        row.params = body.params
    if body.enabled is not None:
        row.enabled = 1 if body.enabled else 0
    db.commit()
    get_gateway().register(_to_config(row))
    return {"id": row.id, "name": row.name, "enabled": bool(row.enabled)}


@router.delete("/models/{name}")
def delete_model(name: str, db: Session = Depends(get_session)):
    load_from_db(db)
    config = get_gateway().get(name)
    if config is not None and config.source == "env":
        raise HTTPException(status_code=409, detail="Environment-provided models cannot be deleted here")
    row = db.query(AIProviderConfig).filter(AIProviderConfig.name == name).first()
    if row is not None:
        db.delete(row)
        db.commit()
    get_gateway().unregister(name)
    if config is None and row is None:
        raise HTTPException(status_code=404, detail="model not found")
    return {"deleted": name}


@router.post("/models/{name}/test")
def test_model(name: str, db: Session = Depends(get_session)):
    load_from_db(db)
    config = get_gateway().get(name)
    if config is None:
        raise HTTPException(status_code=404, detail="model not found")
    return get_gateway().test_connection(config)


@router.post("/generate")
def generate(body: dict[str, Any], db: Session = Depends(get_session)):
    name, config = _model_or_404(body.get("model"), db)
    try:
        content = get_gateway().generate(
            config,
            body.get("messages", []),
            temperature=body.get("temperature", 0.2),
            max_tokens=body.get("max_tokens", 2048),
            json_mode=body.get("json_mode", True),
        )
    except Exception as error:
        raise _ai_http(error)
    return {"model": name, "content": content}


@router.post("/research")
def research(body: ResearchIn, db: Session = Depends(get_session)):
    ticker = body.ticker.strip()
    name, config = _model_or_404(body.model, db)
    job_id = _create_job(db, ticker)
    try:
        note_cfg = _note_config(body)
        _normalized, _metrics, note_payload, messages, facts = _load_research_inputs(ticker, note_cfg)

        def complete(msgs: list[dict[str, str]]) -> str:
            return get_gateway().generate(
                config,
                msgs,
                temperature=body.temperature,
                max_tokens=body.max_tokens,
                json_mode=True,
            )

        report = _finalize_report(facts, messages, complete(messages), complete, note_payload)
        _finish_job(job_id, "complete", result={"report": report, "model": name, "payload": note_payload})
        return {"ticker": ticker.upper(), "model": name, "report": report, "payload": note_payload, "job_id": job_id}
    except HTTPException as error:
        _finish_job(job_id, "failed", error=str(error.detail), progress=100)
        raise
    except Exception as error:
        _finish_job(job_id, "failed", error=str(error), progress=100)
        if isinstance(error, AIError) or isinstance(error, DataError):
            raise _ai_http(error) if isinstance(error, AIError) else _data_http(error)
        raise HTTPException(status_code=500, detail=f"Research generation failed: {error}")


@router.post("/research/stream")
def research_stream(body: ResearchIn, db: Session = Depends(get_session)):
    ticker = body.ticker.strip()
    name, config = _model_or_404(body.model, db)
    _normalized, _metrics, note_payload, messages, facts = _load_research_inputs(ticker, _note_config(body))
    job_id = _create_job(db, ticker)

    def event(event_name: str, payload: dict[str, Any]) -> str:
        return f"event: {event_name}\ndata: {json.dumps(payload, default=str)}\n\n"

    def stream() -> Iterator[str]:
        chunks: list[str] = []
        try:
            yield event("status", {"stage": "generating", "model": name, "job_id": job_id})
            for chunk in get_gateway().generate_stream(
                config,
                messages,
                temperature=body.temperature,
                max_tokens=body.max_tokens,
            ):
                chunks.append(chunk)
                yield event("token", {"text": chunk})
            yield event("status", {"stage": "verifying_figures", "model": name, "job_id": job_id})
            content = "".join(chunks)

            def complete(msgs: list[dict[str, str]]) -> str:
                return get_gateway().generate(
                    config,
                    msgs,
                    temperature=body.temperature,
                    max_tokens=body.max_tokens,
                    json_mode=True,
                )

            report = _finalize_report(facts, messages, content, complete, note_payload)
            _finish_job(job_id, "complete", result={"report": report, "model": name, "payload": note_payload})
            yield event("done", {"ticker": ticker.upper(), "model": name, "report": report, "payload": note_payload, "job_id": job_id})
        except Exception as error:
            _finish_job(job_id, "failed", error=str(error), progress=100)
            yield event("error", {"detail": str(error)})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/jobs")
def list_jobs(limit: int = 25, db: Session = Depends(get_session)):
    rows = db.query(ResearchJob).order_by(ResearchJob.created_at.desc()).limit(max(1, min(limit, 100))).all()
    return [
        {
            "id": row.id,
            "ticker": row.ticker,
            "status": row.status,
            "progress": row.progress,
            "error": row.error,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
        for row in rows
    ]


@router.get("/jobs/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_session)):
    row = db.query(ResearchJob).filter(ResearchJob.id == job_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="job not found")
    return {
        "id": row.id,
        "ticker": row.ticker,
        "status": row.status,
        "progress": row.progress,
        "result": row.result,
        "error": row.error,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
