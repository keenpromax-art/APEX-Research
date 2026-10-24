from __future__ import annotations

import concurrent.futures
import json
import pickle
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import pandas as pd
import yfinance as yf

from ..exceptions import TickerNotFoundError, YFinanceError, YFinanceTimeoutError
from ..config import get_settings

CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache"
try:
    from yfinance.exceptions import YFRateLimitError
except Exception:  # pragma: no cover
    try:
        from yfinance import YFRateLimitError  # type: ignore
    except Exception:
        YFRateLimitError = KeyError  # type: ignore

_QUARANTINE_TTL = 300.0  # seconds to remember a rate-limit state per ticker


@dataclass
class RawTickerData:
    ticker: str
    retrieved_at: str
    info: dict[str, Any] | None = None
    income_statement: pd.DataFrame | None = None
    quarterly_income_statement: pd.DataFrame | None = None
    balance_sheet: pd.DataFrame | None = None
    quarterly_balance_sheet: pd.DataFrame | None = None
    cash_flow: pd.DataFrame | None = None
    quarterly_cash_flow: pd.DataFrame | None = None
    price_history: pd.DataFrame | None = None
    dividends: pd.Series | None = None
    splits: pd.Series | None = None
    shares_outstanding: pd.Series | None = None
    earnings_dates: pd.DataFrame | None = None
    major_holders: pd.DataFrame | None = None
    institutional_holders: pd.DataFrame | None = None
    data_quality: dict[str, Any] = field(default_factory=dict)


_RATE_LIMIT_CLASS = YFRateLimitError if YFRateLimitError is not KeyError else None


def _safe(callable_: Callable[[], Any]) -> Any | None:
    try:
        result = callable_()
    except Exception as exc:
        if _RATE_LIMIT_CLASS is not None and isinstance(exc, _RATE_LIMIT_CLASS):
            raise
        return None
    if result is None:
        return None
    if isinstance(result, pd.DataFrame) and result.empty:
        return None
    if isinstance(result, pd.Series) and result.empty:
        return None
    if isinstance(result, dict) and not result:
        return None
    return result


class RateLimitedError(YFinanceError):
    def __init__(self, ticker: str):
        super().__init__(ticker, "Yahoo Finance rate limit is active for this network. Wait a few minutes and retry.")


class YFinanceAdapter:
    """The ONLY module allowed to call yfinance.

    Cache policy:
      - In-memory cache for the process lifetime.
      - Persistent disk cache under backend/.cache with a freshness window
        (settings.cache_ttl_seconds, default 1h). Stale data is served only
        when a fresh fetch fails due to rate limiting, and is then flagged.
      - Explicit rate-limit quarantine so repeated calls during an active
        Yahoo throttle fail fast with a clear error instead of hammering.

    Transport policy:
      - yfinance 1.7's internal cookie/crumb bootstrap can be rate-limited even
        when the same Yahoo endpoints are reachable. We therefore warm a
        curl_cffi (browser-impersonating) session, obtain the crumb ourselves and
        pre-seed yfinance's YfData. yfinance remains the statement parser/API;
        this only fixes its authentication bootstrap.
    """

    def __init__(self, timeout: float | None = None):
        self._timeout = timeout or get_settings().yfinance_timeout
        self._mem: dict[str, RawTickerData] = {}
        self._mem_until: dict[str, float] = {}
        self._quarantine: dict[str, float] = {}
        self._session = None
        self._crumb: str | None = None

    # ---------- Yahoo/yfinance session bootstrap ----------
    def _warm_session(self):
        try:
            from curl_cffi import requests as curl_requests
        except Exception:
            return None, None
        try:
            if self._session is None:
                self._session = curl_requests.Session(impersonate="chrome")
            # Establish the anonymous session cookie; 404 is expected/harmless.
            try:
                self._session.get("https://fc.yahoo.com", timeout=20, allow_redirects=True)
            except Exception:
                pass
            if not self._crumb:
                r = self._session.get(
                    "https://query1.finance.yahoo.com/v1/test/getcrumb",
                    timeout=20,
                    allow_redirects=True,
                )
                text = (r.text or "").strip()
                if r.status_code == 200 and text and "<html>" not in text and "Too Many Requests" not in text:
                    self._crumb = text
            return self._session, self._crumb
        except Exception:
            return None, None

    def _make_ticker(self, ticker: str):
        session, crumb = self._warm_session()
        tk = yf.Ticker(ticker, session=session) if session is not None else yf.Ticker(ticker)
        if crumb and hasattr(tk, "_data"):
            try:
                tk._data._cookie = True
                tk._data._crumb = crumb
            except Exception:
                pass
        return tk

    def _invalidate_session(self):
        self._session = None
        self._crumb = None


    # ---------- cache helpers ----------
    def _disk_path(self, key: str) -> Path:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        return CACHE_DIR / f"ticker_{key.replace('/', '_')}.pkl"

    def _load_disk(self, key: str) -> RawTickerData | None:
        p = self._disk_path(key)
        if not p.exists():
            return None
        try:
            obj = pickle.loads(p.read_bytes())
            if isinstance(obj, dict):
                return obj.get("data")
            return obj
        except Exception:
            return None

    def _save_disk(self, key: str, data: RawTickerData) -> None:
        try:
            p = self._disk_path(key)
            p.write_bytes(pickle.dumps({"data": data, "saved_at": time.time()}, protocol=pickle.HIGHEST_PROTOCOL))
        except Exception:
            pass

    def _disk_age(self, key: str) -> float | None:
        p = self._disk_path(key)
        if not p.exists():
            return None
        try:
            return time.time() - p.stat().st_mtime
        except Exception:
            return None

    def _stale_cached(self, key: str, reason: str) -> RawTickerData | None:
        stale = self._load_disk(key)
        if stale is None:
            return None
        quality = dict(stale.data_quality or {})
        alerts = list(quality.get("alerts", []))
        alerts.append({"level": "warning", "message": f"Serving cached data: {reason}"})
        stale.data_quality = {**quality, "stale": True, "stale_reason": reason, "alerts": alerts}
        return stale

    # ---------- public ----------
    def fetch(self, ticker: str, force_refresh: bool = False) -> RawTickerData:
        key = ticker.upper().strip()
        now = time.time()

        if not force_refresh:
            cached = self._mem.get(key)
            if cached is not None and self._mem_until.get(key, 0) > now:
                return cached
            disk = self._load_disk(key)
            age = self._disk_age(key)
            if disk is not None and age is not None and age <= get_settings().cache_ttl_seconds:
                self._mem[key] = disk
                self._mem_until[key] = now + get_settings().cache_ttl_seconds
                return disk

        q_until = self._quarantine.get(key, 0)
        if q_until and now < q_until:
            stale = self._stale_cached(key, "Yahoo Finance rate limit is active")
            if stale is not None:
                return stale
            raise RateLimitedError(key)

        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(self._fetch_uncached, key)
                raw = future.result(timeout=self._timeout)
        except concurrent.futures.TimeoutError:
            self._quarantine[key] = now + _QUARANTINE_TTL
            stale = self._stale_cached(key, "Yahoo Finance timed out")
            if stale is not None:
                return stale
            raise YFinanceTimeoutError(key, self._timeout)
        except RateLimitedError:
            self._quarantine[key] = now + _QUARANTINE_TTL
            self._invalidate_session()
            stale = self._stale_cached(key, "Yahoo Finance rate limit is active")
            if stale is not None:
                return stale
            raise
        except YFRateLimitError:
            self._quarantine[key] = now + _QUARANTINE_TTL
            self._invalidate_session()
            stale = self._stale_cached(key, "Yahoo Finance rate limit is active")
            if stale is not None:
                return stale
            raise RateLimitedError(key)
        except TickerNotFoundError:
            raise
        except YFinanceTimeoutError:
            stale = self._stale_cached(key, "Yahoo Finance timed out")
            if stale is not None:
                return stale
            raise
        except Exception as exc:
            stale = self._stale_cached(key, f"data refresh failed ({exc})")
            if stale is not None:
                return stale
            raise YFinanceError(key, str(exc))

        if self._is_empty(raw):
            stale = self._stale_cached(key, "Yahoo Finance returned an empty response")
            if stale is not None:
                return stale
            self._quarantine[key] = now + _QUARANTINE_TTL
            raise TickerNotFoundError(ticker)

        self._quarantine.pop(key, None)
        self._mem[key] = raw
        self._mem_until[key] = now + get_settings().cache_ttl_seconds
        self._save_disk(key, raw)
        return raw

    def _fetch_uncached(self, ticker: str) -> RawTickerData:
        tk = self._make_ticker(ticker)
        retrieved_at = datetime.now(timezone.utc).isoformat()
        try:
            info = _safe(lambda: tk.info)
        except YFRateLimitError:
            raise RateLimitedError(ticker)
        except Exception:
            info = None
        try:
            income = self._sf(lambda: tk.income_stmt)
            q_income = self._sf(lambda: tk.quarterly_income_stmt)
            balance = self._sf(lambda: tk.balance_sheet)
            q_balance = self._sf(lambda: tk.quarterly_balance_sheet)
            cashflow = self._sf(lambda: tk.cashflow)
            q_cashflow = self._sf(lambda: tk.quarterly_cashflow)
            history = self._sf(lambda: tk.history(period="5y", interval="1d", auto_adjust=False))
            dividends = self._sf(lambda: tk.dividends)
            splits = self._sf(lambda: tk.splits)
            shares = self._sf(lambda: tk.get_shares_full(start="2015-01-01"))
            earnings_dates = self._sf(lambda: tk.earnings_dates)
            major_holders = self._sf(lambda: tk.major_holders)
            institutional_holders = self._sf(lambda: tk.institutional_holders)
        except YFRateLimitError:
            raise RateLimitedError(ticker)

        raw = RawTickerData(
            ticker=ticker,
            retrieved_at=retrieved_at,
            info=info,
            income_statement=income,
            quarterly_income_statement=q_income,
            balance_sheet=balance,
            quarterly_balance_sheet=q_balance,
            cash_flow=cashflow,
            quarterly_cash_flow=q_cashflow,
            price_history=history,
            dividends=dividends,
            splits=splits,
            shares_outstanding=shares,
            earnings_dates=earnings_dates,
            major_holders=major_holders,
            institutional_holders=institutional_holders,
        )
        raw.data_quality = self._quality(raw)
        return raw

    def _sf(self, fn: Callable[[], Any]) -> Any | None:
        try:
            return _safe(fn)
        except YFRateLimitError:
            raise

    @staticmethod
    def _is_empty(raw: RawTickerData) -> bool:
        has_info = bool(raw.info)
        has_statements = any(
            [
                raw.income_statement is not None,
                raw.balance_sheet is not None,
                raw.cash_flow is not None,
            ]
        )
        has_history = raw.price_history is not None and not raw.price_history.empty
        return not (has_info or has_statements or has_history)

    @staticmethod
    def _quality(raw: RawTickerData) -> dict[str, Any]:
        alerts = []
        for name, df in [
            ("annual income statement", raw.income_statement),
            ("annual balance sheet", raw.balance_sheet),
            ("annual cash flow", raw.cash_flow),
            ("quarterly income statement", raw.quarterly_income_statement),
            ("quarterly balance sheet", raw.quarterly_balance_sheet),
            ("quarterly cash flow", raw.quarterly_cash_flow),
        ]:
            if df is None:
                alerts.append({"level": "warning", "message": f"Missing {name}"})
            elif df.shape[1] < 2:
                alerts.append({"level": "info", "message": f"{name} has limited periods ({df.shape[1]})"})
        if raw.price_history is None or raw.price_history.empty:
            alerts.append({"level": "warning", "message": "No price history available"})
        if not raw.info:
            alerts.append({"level": "warning", "message": "Company info unavailable"})
        for stmt_name, df in [("income statement", raw.income_statement), ("balance sheet", raw.balance_sheet), ("cash flow", raw.cash_flow)]:
            if df is None:
                continue
            nan_ratio = float(df.isna().sum().sum()) / max(1, df.size)
            if nan_ratio > 0.5:
                alerts.append({"level": "info", "message": f"{stmt_name}: {nan_ratio:.0%} of cells are missing"})
        return {"alerts": alerts, "retrieved_at": raw.retrieved_at}
