from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from lib.ai.engine import AIEngine
from lib.ai.provider import build_provider
from lib.analysis.calculator import calculate
from lib.analysis.context import build_context
from lib.analysis.normalizer import normalize
from lib.config import Settings
from lib.data.adapter import YFinanceAdapter
from lib.data.cache import TTLCache
from lib.exceptions import AIProviderError, AppError, InvalidTickerError
from lib.rendering.blocks import AnalysisDocument, ChartBlock, ChartPoint

_TICKER_RE = re.compile(r"^[A-Za-z0-9.\-^=]{1,25}$")
_MAX_TICKERS = 5

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


def parse_tickers(raw: str) -> list[str]:
    tickers: list[str] = []
    for part in re.split(r"[,\s]+", raw.strip()):
        ticker = part.strip().upper()
        if not ticker:
            continue
        if not _TICKER_RE.match(ticker):
            raise InvalidTickerError(part)
        if ticker not in tickers:
            tickers.append(ticker)
    if not tickers:
        raise InvalidTickerError(raw or "(empty)")
    if len(tickers) > _MAX_TICKERS:
        raise AppError(f"Maximum {_MAX_TICKERS} tickers per analysis.", status_code=400)
    return tickers


class AnalysisPipeline:
    """fetch -> normalize -> calculate -> context -> AI -> validate -> resolve."""

    def __init__(self, adapter: YFinanceAdapter, engine: AIEngine):
        self._adapter = adapter
        self._engine = engine

    def run(
        self,
        tickers: list[str],
        user_request: str,
        status: Callable[[str], None],
    ) -> dict[str, Any]:
        status("Fetching data...")
        raw = [self._adapter.fetch(ticker) for ticker in tickers]

        status("Preparing financial context...")
        financials = [normalize(item) for item in raw]
        derived = [calculate(item) for item in financials]
        context = build_context(financials, derived, user_request)

        status("AI analyzing...")
        document = self._engine.analyze(context)

        status("Rendering analysis...")
        blocks = self._resolve_charts(document, context)
        return {
            "title": document.title,
            "summary": document.summary,
            "blocks": [block.model_dump() for block in blocks],
            "meta": context["meta"],
        }

    def _resolve_charts(
        self, document: AnalysisDocument, context: dict[str, Any]
    ) -> list[Any]:
        series_index: dict[str, list[dict[str, Any]]] = {}
        for company in context["companies"]:
            for name, points in (company.get("series") or {}).items():
                series_index.setdefault(name, points)
        blocks: list[Any] = []
        for block in document.blocks:
            if isinstance(block, ChartBlock) and block.ref is not None:
                points = [
                    ChartPoint(label=p["label"], value=p["value"])
                    for p in series_index.get(block.ref, [])
                ]
                block = block.model_copy(update={"data": points, "ref": None})
            blocks.append(block)
        return blocks


def create_app(settings: Settings, pipeline: AnalysisPipeline | None = None) -> FastAPI:
    app = FastAPI(title="Equity Research Engine")
    app.state.settings = settings

    if pipeline is None:
        cache = TTLCache(settings.cache_ttl_seconds)
        adapter = YFinanceAdapter(timeout=settings.yfinance_timeout_seconds, cache=cache)
        provider = build_provider(settings)
        engine = AIEngine(provider, timeout=settings.ai_timeout_seconds) if provider is not None else None
        pipeline = AnalysisPipeline(adapter, engine) if engine is not None else None

    @app.exception_handler(AppError)
    async def app_error_handler(request, exc: AppError):
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=exc.status_code, content={"error": exc.message})

    @app.get("/api/analyze")
    async def analyze(
        tickers: str = Query(..., description="One or more tickers, comma-separated"),
        request: str = Query("Analyze this company."),
        provider: str | None = Query(None, description="AI provider override (gemini|openrouter|groq)"),
        key: str | None = Query(None, description="AI provider API key for this request"),
    ):
        parsed = parse_tickers(tickers)
        return StreamingResponse(_stream_analysis(parsed, request, provider, key), media_type="text/event-stream")

    def _ephemeral_pipeline(provider_name: str | None, api_key: str | None):
        if not provider_name or not api_key:
            return None
        from lib.ai.provider import GeminiProvider, GroqProvider, OpenRouterProvider

        providers = {
            "gemini": (GeminiProvider, settings.gemini_model),
            "groq": (GroqProvider, settings.groq_model),
            "openrouter": (OpenRouterProvider, settings.openrouter_model),
        }
        entry = providers.get(provider_name)
        if entry is None:
            raise AppError(f"Unknown AI provider '{provider_name}'.", status_code=400)
        factory, model = entry
        if not model:
            raise AppError(f"No model configured for provider '{provider_name}'.", status_code=400)
        engine = AIEngine(factory(api_key, model), timeout=settings.ai_timeout_seconds)
        cache = TTLCache(settings.cache_ttl_seconds)
        adapter = YFinanceAdapter(timeout=settings.yfinance_timeout_seconds, cache=cache)
        return AnalysisPipeline(adapter, engine)

    async def _stream_analysis(parsed: list[str], request: str, provider_name: str | None = None, api_key: str | None = None):
        queue: asyncio.Queue = asyncio.Queue()

        def run() -> None:
            try:
                active = pipeline
                if provider_name and api_key:
                    active = _ephemeral_pipeline(provider_name, api_key)
                if active is None:
                    raise AIProviderError("AI provider is not configured. Set an AI provider key in the UI or server env.")
                result = active.run(parsed, request, lambda s: queue.put_nowait(("status", s)))
                queue.put_nowait(("result", result))
            except AppError as exc:
                queue.put_nowait(("error", {"message": exc.message, "status": exc.status_code}))
            except Exception:
                queue.put_nowait(("error", {"message": "Unexpected server error.", "status": 500}))
            finally:
                queue.put_nowait(None)

        task = asyncio.get_event_loop().run_in_executor(None, run)
        while True:
            item = await queue.get()
            if item is None:
                break
            kind, payload = item
            yield f"event: {kind}\ndata: {json.dumps(payload, default=str)}\n\n"
        await task

    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")
    return app
