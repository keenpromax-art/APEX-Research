from __future__ import annotations

from typing import Any

from .demo import demo_normalized
from .metrics import compute_metrics
from .normalizer import normalize_statements
from .yfinance_adapter import YFinanceAdapter

_adapter = YFinanceAdapter()


def load_normalized(ticker: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Fetch and normalize a ticker, or return the synthetic DEMO fixture."""
    if ticker.strip().upper() == "DEMO":
        normalized = demo_normalized()
        return normalized, compute_metrics(normalized)
    raw = _adapter.fetch(ticker)
    normalized = normalize_statements(raw)
    return normalized, compute_metrics(normalized)


def refresh(ticker: str) -> tuple[dict[str, Any], dict[str, Any]]:
    if ticker.strip().upper() == "DEMO":
        return load_normalized(ticker)
    raw = _adapter.fetch(ticker, force_refresh=True)
    normalized = normalize_statements(raw)
    return normalized, compute_metrics(normalized)
