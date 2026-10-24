from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import init_db
from .routers.core import router as core_router
from .routers.ai import router as ai_router, load_from_db
from .routers.export import router as export_router
from .routers.projects import router as projects_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    from .db import SessionLocal

    db = SessionLocal()
    try:
        load_from_db(db)
    finally:
        db.close()
    yield


settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="AI-assisted equity research with deterministic financial models.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(core_router)
app.include_router(ai_router)
app.include_router(export_router)
app.include_router(projects_router)


@app.get("/")
def root():
    return {
        "service": "apex-terminal",
        "version": app.version,
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health():
    return {"status": "ok", "service": "apex-terminal", "version": app.version}
