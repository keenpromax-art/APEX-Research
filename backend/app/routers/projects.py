from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import AuditLog, Project, SavedModel, get_session

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _audit(db: Session, action: str, entity: str, detail: dict[str, Any]) -> None:
    db.add(AuditLog(action=action, entity=entity, detail=detail))


class ProjectIn(BaseModel):
    name: str
    ticker: str
    description: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


@router.get("")
def list_projects(db: Session = Depends(get_session)):
    rows = db.query(Project).order_by(Project.updated_at.desc()).all()
    return [{"id": r.id, "name": r.name, "ticker": r.ticker, "description": r.description, "updated_at": r.updated_at.isoformat()} for r in rows]


@router.post("")
def create_project(body: ProjectIn, db: Session = Depends(get_session)):
    row = Project(name=body.name, ticker=body.ticker.upper(), description=body.description, data=body.data)
    db.add(row)
    db.flush()
    _audit(db, "create", "project", {"id": row.id, "ticker": row.ticker})
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "ticker": row.ticker}


@router.get("/{pid}")
def get_project(pid: int, db: Session = Depends(get_session)):
    row = db.query(Project).filter(Project.id == pid).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return {"id": row.id, "name": row.name, "ticker": row.ticker, "description": row.description, "data": row.data, "updated_at": row.updated_at.isoformat()}


@router.put("/{pid}")
def update_project(pid: int, body: ProjectIn, db: Session = Depends(get_session)):
    row = db.query(Project).filter(Project.id == pid).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    row.name = body.name
    row.ticker = body.ticker.upper()
    row.description = body.description
    row.data = body.data
    _audit(db, "update", "project", {"id": row.id, "ticker": row.ticker})
    db.commit()
    return {"id": row.id, "name": row.name, "ticker": row.ticker, "updated_at": row.updated_at.isoformat()}


@router.delete("/{pid}")
def delete_project(pid: int, db: Session = Depends(get_session)):
    row = db.query(Project).filter(Project.id == pid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    db.delete(row)
    _audit(db, "delete", "project", {"id": pid})
    db.commit()
    return {"deleted": pid}


# Saved models
class ModelIn(BaseModel):
    name: str
    kind: str
    ticker: str | None = None
    project_id: int | None = None
    assumptions: dict[str, Any] = Field(default_factory=dict)
    results: dict[str, Any] = Field(default_factory=dict)


@router.get("/models/saved")
def list_saved(db: Session = Depends(get_session)):
    rows = db.query(SavedModel).order_by(SavedModel.updated_at.desc()).all()
    return [{"id": r.id, "name": r.name, "kind": r.kind, "ticker": r.ticker, "project_id": r.project_id, "updated_at": r.updated_at.isoformat()} for r in rows]


@router.post("/models/saved")
def save_model(body: ModelIn, db: Session = Depends(get_session)):
    row = SavedModel(name=body.name, kind=body.kind, ticker=body.ticker, project_id=body.project_id, assumptions=body.assumptions, results=body.results)
    db.add(row)
    db.flush()
    _audit(db, "create", "saved_model", {"id": row.id, "kind": row.kind})
    db.commit()
    db.refresh(row)
    return {"id": row.id}


@router.get("/models/saved/{mid}")
def get_saved(mid: int, db: Session = Depends(get_session)):
    row = db.query(SavedModel).filter(SavedModel.id == mid).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return {"id": row.id, "name": row.name, "kind": row.kind, "ticker": row.ticker, "assumptions": row.assumptions, "results": row.results}


@router.put("/models/saved/{mid}")
def update_saved(mid: int, body: ModelIn, db: Session = Depends(get_session)):
    row = db.query(SavedModel).filter(SavedModel.id == mid).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    row.name = body.name
    row.kind = body.kind
    row.ticker = body.ticker
    row.project_id = body.project_id
    row.assumptions = body.assumptions
    row.results = body.results
    _audit(db, "update", "saved_model", {"id": mid})
    db.commit()
    return {"id": row.id, "updated_at": row.updated_at.isoformat()}


@router.delete("/models/saved/{mid}")
def delete_saved(mid: int, db: Session = Depends(get_session)):
    row = db.query(SavedModel).filter(SavedModel.id == mid).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    db.delete(row)
    _audit(db, "delete", "saved_model", {"id": mid})
    db.commit()
    return {"deleted": mid}
